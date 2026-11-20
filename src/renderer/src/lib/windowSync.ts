/**
 * Several windows on the same logs and time. Launching Brownout again, or
 * Window > New window (Ctrl+Shift+N), opens another window in the running
 * app. The windows share:
 *
 * - the open logs (by path), their order, offsets, visibility and colors,
 *   the alignment mode, match or whole log, and the bookmarks;
 * - time: the cursor, the view, the selection and playback.
 *
 * Each window keeps its own view (Panels, Video review, Power), layout,
 * sidebar and timeline size, so one can show the video while another shows
 * graphs. Each window reads the logs itself (its own worker), so a second
 * window costs the memory of the logs again.
 *
 * How: every window sends its shared state to the main process when it
 * changes ('sync'); main passes it to the other windows and keeps the latest
 * for a window that opens later. A window takes what it is sent and does not
 * send it back. Time is only sent while a window's logs match the shared
 * ones, so a window still loading never narrows the others' view.
 * Playback runs in the window where Play was pressed; the others show the
 * cursor it sends (applySharedTime).
 *
 * The first window is the primary: only it saves the layout and the session
 * (a second window would overwrite them with its own). When it closes, the
 * next one takes over.
 */
import { sessionStore, openSources, removeLog, arrangeSharedLogs, setAlignMode, type SharedLog, type Bookmark } from '../state/session';
import { timeStore, applySharedTime, type TimeState } from '../state/time';
import type { AlignMode } from '@core/alignment';

export interface SharedSession {
  logs: SharedLog[];
  alignMode: AlignMode;
  wholeLog: boolean;
  bookmarks: Bookmark[];
}
type SharedTime = Pick<TimeState, 'cursor' | 'view' | 'selection' | 'playing' | 'speed' | 'loop' | 'timeFormat'>;

let primary = true;
const onPrimary: (() => void)[] = [];
let started: Promise<boolean> | null = null;

/** The last shared state this window sent or was sent (JSON), and this window's own. */
let sharedSession: string | null = null;
let sharedTime: string | null = null;
let localSession = '';
/** The logs this window should have; reconcile() works toward it. */
let target: SharedSession | null = null;
/** Taking another window's logs: changes made meanwhile are not sent. */
let busy = 0;

export const isPrimaryWindow = (): boolean => primary;

/** Run now in the primary window, or when this window becomes the primary. */
export function whenPrimary(fn: () => void): void {
  if (primary) fn();
  else onPrimary.push(fn);
}

/** The logs and what is set on them, as the windows share them (also what undo keeps, lib/undo.ts). */
export function sessionNow(): SharedSession {
  const s = sessionStore.get();
  return {
    logs: s.logs.filter((l) => l.path).map((l) => ({ path: l.path!, manualOffset: l.manualOffset, visible: l.visible, colorIndex: l.colorIndex })),
    alignMode: s.alignMode,
    wholeLog: s.wholeLog,
    bookmarks: s.bookmarks,
  };
}

function timeNow(): SharedTime {
  const t = timeStore.get();
  return { cursor: t.cursor, view: t.view, selection: t.selection, playing: t.playing, speed: t.speed, loop: t.loop, timeFormat: t.timeFormat };
}

/** This window has the shared logs and is not loading or taking any: its time can be shared. */
function settled(): boolean {
  return !busy && !sessionStore.get().loadingItems.length && (sharedSession === null || localSession === sharedSession);
}

function sessionChanged(): void {
  localSession = JSON.stringify(sessionNow());
  if (busy || sessionStore.get().loadingItems.length || localSession === sharedSession) return;
  sharedSession = localSession;
  window.brownout?.syncSend('session', JSON.parse(localSession));
  timeChanged();
}

let lastTime: SharedTime | null = null;
/** Taking another window's time: the store change this causes is not news to send back. */
let taking = false;
function timeChanged(): void {
  if (taking) return;
  const t = timeStore.get();
  // hover moves often and is not shared: skip unless a shared field changed
  if (lastTime && (Object.keys(lastTime) as (keyof SharedTime)[]).every((k) => lastTime![k] === t[k])) return;
  if (!settled()) return;
  lastTime = timeNow();
  const json = JSON.stringify(lastTime);
  if (json === sharedTime) return;
  sharedTime = json;
  pendingTime = lastTime;
  // playback changes the cursor on every step; the other windows draw at most 60 times a second
  // (useCanvas), so send at most that often, and always the newest
  const wait = SEND_MS - (performance.now() - lastSent);
  if (wait > 0) {
    if (!sendTimer) sendTimer = window.setTimeout(sendTime, wait);
    return;
  }
  sendTime();
}

const SEND_MS = 1000 / 60;
let lastSent = 0;
let sendTimer = 0;
let pendingTime: SharedTime | null = null;
function sendTime(): void {
  clearTimeout(sendTimer);
  sendTimer = 0;
  lastSent = performance.now();
  if (pendingTime) window.brownout?.syncSend('time', pendingTime);
  pendingTime = null;
}

function takeTime(t: SharedTime): void {
  // what this window was about to send is older than what it was just sent
  clearTimeout(sendTimer);
  sendTimer = 0;
  pendingTime = null;
  // listeners run inside the store update: without this the window would send the time straight
  // back, and the playing window would keep jumping back to the cursor it sent a moment ago
  taking = true;
  try {
    applySharedTime(t);
  } finally {
    taking = false;
  }
  lastTime = timeNow();
  sharedTime = JSON.stringify(lastTime);
}

let reconciling: Promise<void> | null = null;
let again = false;
/** Open and close logs until this window has the shared ones, then take their order, offsets and the shared time. */
function reconcile(): Promise<void> {
  if (reconciling) {
    again = true;
    return reconciling;
  }
  // cleared once it settles (reconcileNow may finish without waiting, before this assignment)
  const p: Promise<void> = reconcileNow().finally(() => {
    reconciling = null;
    if (again) void reconcile();
  });
  reconciling = p;
  return p;
}
async function reconcileNow(): Promise<void> {
  busy++;
  try {
    do {
      again = false;
      const want = target!;
      const paths = new Set(want.logs.map((l) => l.path));
      const have = new Set<string>();
      for (const l of sessionStore.get().logs) {
        if (!l.path) continue;
        if (!paths.has(l.path) || have.has(l.path)) removeLog(l.id);
        else have.add(l.path);
      }
      const missing = want.logs.filter((l) => !have.has(l.path)).map((l) => ({ path: l.path }));
      if (missing.length) await openSources(missing);
      if (again) continue;
      if (sessionStore.get().alignMode !== want.alignMode) setAlignMode(want.alignMode);
      sessionStore.set({ wholeLog: want.wholeLog, bookmarks: want.bookmarks });
      arrangeSharedLogs(want.logs);
    } while (again);
  } finally {
    busy--;
  }
  // opening logs may have fitted the view: take the shared time again
  if (sharedTime) takeTime(JSON.parse(sharedTime) as SharedTime);
  // a log that would not open here: tell the others
  sessionChanged();
}

/**
 * Make this window's logs match a shape (undo and redo, lib/undo.ts): logs missing are opened again
 * from their files, others closed, then order, offsets and the rest are set. The other windows follow.
 */
export function applySessionShape(shape: SharedSession): Promise<void> {
  target = shape;
  return reconcile();
}

function receive(kind: 'session' | 'time', data: unknown): void {
  if (kind === 'time') takeTime(data as SharedTime);
  else {
    target = data as SharedSession;
    sharedSession = JSON.stringify(target);
    void reconcile();
  }
}

/**
 * Join the other windows (desktop app only). Returns true when this is not the
 * first window: it then has the shared logs and should not reopen the last session.
 */
export function startWindowSync(): Promise<boolean> {
  return (started ??= (async () => {
    const api = window.brownout;
    if (!api?.windowInfo) return false;
    const info = await api.windowInfo();
    primary = info.primary;
    api.onSync(receive);
    api.onPrimary(() => {
      primary = true;
      for (const fn of onPrimary.splice(0)) fn();
    });
    sessionStore.subscribe(sessionChanged);
    timeStore.subscribe(timeChanged);
    localSession = JSON.stringify(sessionNow());
    if (!primary) {
      if (info.shared.time) takeTime(info.shared.time as SharedTime);
      if (info.shared.session) receive('session', info.shared.session);
    }
    return !primary;
  })());
}
