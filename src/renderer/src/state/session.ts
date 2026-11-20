/**
 * Session state: the logs that are open, how they are aligned, the season,
 * selections and bookmarks. The time store (cursor, view, selection) is
 * separate because it changes at animation rate.
 */
import { createStore } from './store';
import type { LogSummary } from '../worker/protocol';
import { client } from '../worker/client';
import { computeOffset, type AlignMode } from '@core/alignment';
import { SEASONS, type AprilTag, type SeasonPreset } from '@core/field';
import type { Role } from '@core/roles';
import { shortName } from '../lib/format';
import { timeStore, fitView, reclampView, timeBounds } from './time';
import { settingsStore } from './settings';
import type { LoadStage } from '../worker/protocol';
import type { SubsystemReport } from '@core/analyzers/subsystems';
import type { CameraSummary } from '@core/vision';
import { profileStore, profileById, chooseProfile, updateProfile } from './profiles';
import { DEFAULT_THRESHOLDS } from '@core/analyzers/power';

export interface LogEntry extends LogSummary {
  /** Original file name (name holds the short display name, e.g. "NYROC Q12"). */
  fileName: string;
  /** Index into the settings' log colors; `color` is derived from it. */
  colorIndex: number;
  color: string;
  /** aligned = raw + offset (includes the manual nudge) */
  offset: number;
  manualOffset: number;
  visible: boolean;
  /** Copy of the robot profile's field-name corrections this log was analyzed with. */
  roleOverrides: Partial<Record<Role, string>>;
  /** Robot profile (state/profiles.ts) this log uses. */
  profileId: string;
  /** Power by subsystem for the whole log; undefined until computed, null when the profile has no subsystems. */
  subsystems?: SubsystemReport | null;
  /** How well each camera saw the field; undefined until computed. */
  cameras?: CameraSummary[];
}

export interface Bookmark {
  id: string;
  t: number; // aligned seconds
  text: string;
}

export type TagVariant = 'welded' | 'andymark';

export interface SessionState {
  logs: LogEntry[];
  /** Which bundled AprilTag map to use for seasons that have two. */
  tagVariant: TagVariant;
  /** Field pictures the user loaded (the picture itself lives in lib/fieldAssets.ts). */
  customFields: { id: string; name: string; length: number; width: number }[];
  alignMode: AlignMode;
  seasonId: string;
  normalizeAlliance: boolean;
  selectedKeys: string[];
  bookmarks: Bookmark[];
  brownoutThreshold: number;
  fieldTags: AprilTag[] | null;
  /** Logs currently being read / indexed / analyzed. */
  loadingItems: LoadingItem[];
  sidebarOpen: boolean;
  /** Sidebar width in px set by dragging its edge; null = the default. */
  sidebarWidth: number | null;
  timelineMode: 'compact' | 'standard' | 'expanded';
  /** Height in px set by dragging the timeline's top edge; null = automatic for the mode. */
  timelineHeight: number | null;
  /** Extra timeline tracks the user added: field keys. */
  timelineTracks: string[];
  /** The timeline covers the whole log; false = only the match (auto start to teleop end), when the logs have one. */
  wholeLog: boolean;
  /** Which view fills the window: the panel grid, Video review or Power. */
  view: AppView;
}

export type AppView = 'panels' | 'video' | 'power' | 'robot';

/** The narrowest the sidebar can be dragged (px). */
export const SIDEBAR_MIN = 220;

export interface LoadingItem {
  id: string;
  name: string;
  stage: LoadStage;
  fraction: number;
}

/** A log to open: bytes already in memory, or a path for the main process to read. */
export type LogSource = { name: string; data: ArrayBuffer; path?: string } | { path: string; name?: string };

export const sessionStore = createStore<SessionState>({
  logs: [],
  tagVariant: 'welded',
  customFields: [],
  alignMode: 'autoStart',
  seasonId: '2026',
  normalizeAlliance: true,
  selectedKeys: [],
  bookmarks: [],
  brownoutThreshold: 6.75,
  fieldTags: null,
  loadingItems: [],
  sidebarOpen: true,
  sidebarWidth: null,
  timelineMode: 'standard',
  timelineHeight: null,
  timelineTracks: [],
  wholeLog: false,
  view: 'panels',
});

let nextLogId = 1;

/** Built-in seasons plus any field pictures the user loaded. */
export function allSeasons(st: SessionState = sessionStore.get()): SeasonPreset[] {
  return [
    ...SEASONS,
    ...st.customFields.map((c): SeasonPreset => ({
      id: c.id,
      name: c.name,
      length: c.length,
      width: c.width,
      symmetry: 'rotational',
      endgameSeconds: 20,
      logFrame: 'blueWall',
      tags: [],
    })),
  ];
}

export function currentSeason(): SeasonPreset {
  const st = sessionStore.get();
  return allSeasons(st).find((s) => s.id === st.seasonId) ?? SEASONS.find((s) => s.id === '2026')!;
}

function recomputeOffsets(logs: LogEntry[], mode: AlignMode): LogEntry[] {
  if (!logs.length) return logs;
  const anchors = (l: LogEntry) => ({
    startTs: l.startTs,
    firstEnable: l.robotState.firstEnable,
    autoStart: l.robotState.autoStart,
    teleopStart: l.robotState.teleopStart,
    epochOffset: l.robotState.epochOffset,
  });
  const primary = anchors(logs[0]);
  return logs.map((l) => ({ ...l, offset: computeOffset(mode, anchors(l), primary) + l.manualOffset }));
}

function setLoading(id: string, patch: Partial<LoadingItem> | null): void {
  sessionStore.set((st) => ({
    loadingItems: patch === null ? st.loadingItems.filter((x) => x.id !== id) : st.loadingItems.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}

client.onProgress = (id, stage, fraction) => setLoading(id, { stage, fraction });

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Lowest color index no open log is using, so closing and reopening logs doesn't duplicate colors. */
function freeColorIndex(logs: LogEntry[]): number {
  const n = settingsStore.get().logColors.length;
  for (let i = 0; i < n; i++) if (!logs.some((l) => l.colorIndex === i)) return i;
  return logs.length % n;
}

/**
 * Open logs. Each shows up in the header with a progress bar while it is
 * read (main process), indexed and analyzed (worker). Returns the names of
 * the sources that failed.
 */
export async function openSources(sources: LogSource[], onError?: (name: string, message: string) => void): Promise<string[]> {
  if (!sources.length) return [];
  const s = sessionStore.get();
  const wasEmpty = s.logs.length === 0;
  const prevExtent = timeBounds();
  const prevView = timeStore.get().view;
  const tol = (prevExtent[1] - prevExtent[0]) * 0.02;
  const wasFull = Math.abs(prevView[0] - prevExtent[0]) < tol && Math.abs(prevView[1] - prevExtent[1]) < tol;
  const items = sources.map((src) => ({ src, id: `log${nextLogId++}`, name: 'data' in src ? src.name : (src.name ?? baseName(src.path)) }));
  sessionStore.set((st) => ({
    loadingItems: [
      ...st.loadingItems,
      ...items.map((it) => ({ id: it.id, name: it.name, stage: ('data' in it.src ? 'index' : 'read') as LoadStage, fraction: 0 })),
    ],
  }));
  const failed: string[] = [];
  for (const it of items) {
    try {
      let data: ArrayBuffer;
      let path: string | undefined;
      if ('data' in it.src) {
        data = it.src.data;
        path = it.src.path;
      } else {
        if (!window.brownout) throw new Error('Reading files by path needs the desktop app');
        const f = await window.brownout.readFile(it.src.path);
        data = f.data;
        path = f.path;
      }
      setLoading(it.id, { stage: 'index', fraction: 0 });
      let summary = await client.open(it.id, it.name, data, path);
      // The robot profile brings its field-name corrections; the session brings its brownout threshold.
      const keys = new Set(summary.fields.map((f) => f.key));
      const profile = profileById(chooseProfile(summary.name, (k) => keys.has(k)));
      const threshold = sessionStore.get().brownoutThreshold;
      if (Object.keys(profile.roleOverrides).length || threshold !== DEFAULT_THRESHOLDS.brownout) {
        setLoading(it.id, { stage: 'analyze', fraction: 1 });
        summary = await client.reanalyze(it.id, profile.roleOverrides, threshold);
      }
      profileStore.set({ lastUsedId: profile.id });
      sessionStore.set((st) => {
        const colorIndex = freeColorIndex(st.logs);
        const entry: LogEntry = {
          ...summary,
          fileName: summary.name,
          name: uniqueName(shortName(summary.name), st.logs),
          colorIndex,
          color: settingsStore.get().logColors[colorIndex],
          offset: 0,
          manualOffset: 0,
          visible: true,
          roleOverrides: profile.roleOverrides,
          profileId: profile.id,
        };
        return { logs: recomputeOffsets([...st.logs, entry], st.alignMode), loadingItems: st.loadingItems.filter((x) => x.id !== it.id) };
      });
    } catch (e) {
      setLoading(it.id, null);
      failed.push(it.name);
      onError?.(it.name, e instanceof Error ? e.message : String(e));
    }
  }
  if ((wasEmpty || wasFull) && sessionStore.get().logs.length) fitView();
  return failed;
}

function uniqueName(base: string, logs: LogEntry[]): string {
  if (!logs.some((l) => l.name === base)) return base;
  let i = 2;
  while (logs.some((l) => l.name === `${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export function removeLog(id: string): void {
  client.close(id);
  sessionStore.set((st) => ({
    logs: recomputeOffsets(
      st.logs.filter((l) => l.id !== id),
      st.alignMode,
    ),
  }));
}

/** A log as the windows share it (lib/windowSync.ts): by path, with what the user set on it. */
export interface SharedLog {
  path: string;
  manualOffset: number;
  visible: boolean;
  colorIndex: number;
}

/**
 * Put the open logs in the shared order, with the shared offsets, visibility and colors. Logs
 * not in the list must already be closed; logs without a path (not shared) stay at the end.
 */
export function arrangeSharedLogs(list: SharedLog[]): void {
  sessionStore.set((st) => {
    const byPath = new Map(st.logs.filter((l) => l.path).map((l) => [l.path!, l]));
    const colors = settingsStore.get().logColors;
    const logs: LogEntry[] = [];
    for (const s of list) {
      const l = byPath.get(s.path);
      if (l) logs.push({ ...l, manualOffset: s.manualOffset, visible: s.visible, colorIndex: s.colorIndex, color: colors[s.colorIndex] ?? l.color });
    }
    return { logs: recomputeOffsets([...logs, ...st.logs.filter((l) => !l.path)], st.alignMode) };
  });
}

export function closeAll(): void {
  for (const l of sessionStore.get().logs) client.close(l.id);
  sessionStore.set({ logs: [], bookmarks: [], selectedKeys: [] });
}

export function setAlignMode(mode: AlignMode): void {
  sessionStore.set((st) => ({ alignMode: mode, logs: recomputeOffsets(st.logs, mode) }));
  fitView();
}

export function nudgeLog(id: string, deltaSeconds: number): void {
  sessionStore.set((st) => ({
    logs: recomputeOffsets(
      st.logs.map((l) => (l.id === id ? { ...l, manualOffset: l.manualOffset + deltaSeconds } : l)),
      st.alignMode,
    ),
  }));
}

export function setManualOffset(id: string, manualOffset: number): void {
  sessionStore.set((st) => ({
    logs: recomputeOffsets(
      st.logs.map((l) => (l.id === id ? { ...l, manualOffset } : l)),
      st.alignMode,
    ),
  }));
}

export function setLogVisible(id: string, visible: boolean): void {
  sessionStore.set((st) => ({ logs: st.logs.map((l) => (l.id === id ? { ...l, visible } : l)) }));
}

export function makePrimary(id: string): void {
  sessionStore.set((st) => {
    const l = st.logs.find((x) => x.id === id);
    if (!l) return {};
    return { logs: recomputeOffsets([l, ...st.logs.filter((x) => x.id !== id)], st.alignMode) };
  });
}

/** Re-run analysis for every open log that uses a profile (after its field-name corrections change). */
async function reanalyzeProfile(profileId: string): Promise<void> {
  const profile = profileById(profileId);
  for (const l of sessionStore.get().logs) {
    if (l.profileId !== profileId) continue;
    const summary = await client.reanalyze(l.id, profile.roleOverrides, sessionStore.get().brownoutThreshold);
    sessionStore.set((st) => ({
      logs: recomputeOffsets(
        st.logs.map((x) =>
          x.id === l.id
            ? {
                ...x,
                ...summary,
                name: x.name,
                roleOverrides: profile.roleOverrides,
                subsystems: undefined,
                events: keepCameraFindings(summary.events, x.events),
              }
            : x,
        ),
        st.alignMode,
      ),
    }));
  }
}

/** Correct which field plays a role. Saved in the robot profile, so it applies to every log from that robot. */
export async function setProfileRole(profileId: string, role: Role, key: string | undefined): Promise<void> {
  updateProfile(profileId, (p) => {
    const roleOverrides = { ...p.roleOverrides };
    if (key) roleOverrides[role] = key;
    else delete roleOverrides[role];
    return { roleOverrides };
  });
  await reanalyzeProfile(profileId);
}

export async function setRoleOverride(id: string, role: Role, key: string | undefined): Promise<void> {
  const l = sessionStore.get().logs.find((x) => x.id === id);
  if (l) await setProfileRole(l.profileId, role, key);
}

/** Use another robot profile for a log. Remembered for that file. */
export async function assignProfile(logId: string, profileId: string): Promise<void> {
  const l = sessionStore.get().logs.find((x) => x.id === logId);
  if (!l || l.profileId === profileId) return;
  const profile = profileById(profileId);
  profileStore.set((s) => ({ lastUsedId: profile.id, assignments: { ...s.assignments, [l.fileName]: profile.id } }));
  const summary = await client.reanalyze(l.id, profile.roleOverrides, sessionStore.get().brownoutThreshold);
  sessionStore.set((st) => ({
    logs: recomputeOffsets(
      st.logs.map((x) =>
        x.id === logId
          ? {
              ...x,
              ...summary,
              name: x.name,
              roleOverrides: profile.roleOverrides,
              profileId: profile.id,
              subsystems: undefined,
              events: keepCameraFindings(summary.events, x.events),
            }
          : x,
      ),
      st.alignMode,
    ),
  }));
}

/** The profile the sidebar and settings act on: the primary log's, or the last one used. */
export function activeProfileId(): string {
  return profileById(sessionStore.get().logs[0]?.profileId ?? profileStore.get().lastUsedId).id;
}

export async function setBrownoutThreshold(v: number): Promise<void> {
  sessionStore.set({ brownoutThreshold: v });
  for (const l of sessionStore.get().logs) {
    const summary = await client.reanalyze(l.id, l.roleOverrides, v);
    sessionStore.set((st) => ({
      logs: recomputeOffsets(
        st.logs.map((x) =>
          x.id === l.id ? { ...x, ...summary, name: x.name, subsystems: undefined, events: keepCameraFindings(summary.events, x.events) } : x,
        ),
        st.alignMode,
      ),
    }));
  }
}

/** Union of aligned time ranges over visible logs. */
export function sessionExtent(logs = sessionStore.get().logs): [number, number] {
  let a = Infinity;
  let b = -Infinity;
  for (const l of logs) {
    if (!l.visible) continue;
    a = Math.min(a, l.startTs + l.offset);
    b = Math.max(b, l.endTs + l.offset);
  }
  if (!Number.isFinite(a)) return [0, 10];
  if (b - a < 0.1) b = a + 1;
  return [a, b];
}

const MATCH_PAD = 2;

/**
 * The match across visible logs: earliest auto start (else first enable) to the latest
 * teleop end (else last disable), 2 s padding each side, inside the session extent.
 * Null when no log has robot-mode data.
 */
export function matchExtent(logs = sessionStore.get().logs): [number, number] | null {
  let a = Infinity;
  let b = -Infinity;
  for (const l of logs) {
    if (!l.visible) continue;
    const rs = l.robotState;
    const start = rs.autoStart ?? rs.firstEnable;
    const end = rs.teleopEnd ?? rs.lastDisable;
    if (start === undefined || end === undefined || !(end > start)) continue;
    a = Math.min(a, start + l.offset);
    b = Math.max(b, end + l.offset);
  }
  if (!Number.isFinite(a)) return null;
  const [e0, e1] = sessionExtent(logs);
  const lo = Math.max(e0, a - MATCH_PAD);
  const hi = Math.min(e1, b + MATCH_PAD);
  return hi - lo >= 1 ? [lo, hi] : null;
}

// Keep the visible range inside the timeline's range whenever logs are added, removed, hidden or
// re-aligned, or the timeline switches between the match and the whole log.
let lastLogs: LogEntry[] = sessionStore.get().logs;
let lastWhole = sessionStore.get().wholeLog;
sessionStore.subscribe((st) => {
  if (st.logs === lastLogs && st.wholeLog === lastWhole) return;
  lastLogs = st.logs;
  lastWhole = st.wholeLog;
  reclampView();
});

// Log colors follow the settings.
let lastColors = settingsStore.get().logColors;
settingsStore.subscribe((st) => {
  if (st.logColors === lastColors) return;
  lastColors = st.logColors;
  sessionStore.set((ss) => ({ logs: ss.logs.map((l) => ({ ...l, color: st.logColors[l.colorIndex % st.logColors.length] })) }));
});

export function setSelectedKeys(keys: string[]): void {
  sessionStore.set({ selectedKeys: keys });
}

export function toggleSelectedKey(key: string, exclusive = false): void {
  sessionStore.set((st) => {
    if (exclusive) return { selectedKeys: [key] };
    return { selectedKeys: st.selectedKeys.includes(key) ? st.selectedKeys.filter((k) => k !== key) : [...st.selectedKeys, key] };
  });
}

export function addBookmark(t: number, text = ''): void {
  sessionStore.set((st) => ({ bookmarks: [...st.bookmarks, { id: `b${Date.now()}`, t, text }] }));
}
export function removeBookmark(id: string): void {
  sessionStore.set((st) => ({ bookmarks: st.bookmarks.filter((b) => b.id !== id) }));
}
export function addTimelineTrack(key: string): void {
  sessionStore.set((st) => (st.timelineTracks.includes(key) ? {} : { timelineTracks: [...st.timelineTracks, key] }));
}
export function removeTimelineTrack(key: string): void {
  sessionStore.set((st) => ({ timelineTracks: st.timelineTracks.filter((k) => k !== key) }));
}

export const primaryLog = (): LogEntry | undefined => sessionStore.get().logs[0];

/** A re-analysis brings the log's own events; camera disagreements come from the camera analysis, so carry them over. */
function keepCameraFindings(fresh: LogEntry['events'], old: LogEntry['events']): LogEntry['events'] {
  const cam = old.filter((e) => e.kind === 'vision' && e.finding?.kind === 'disagree');
  return cam.length ? [...fresh, ...cam].sort((a, b) => a.t - b.t) : fresh;
}
