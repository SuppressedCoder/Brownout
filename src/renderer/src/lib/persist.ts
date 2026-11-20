/**
 * Persistence: the dockview layout + panel settings + a few session
 * preferences autosave to localStorage. Presets live in state/presets.ts,
 * settings in state/settings.ts, the open-log list in lib/files.ts.
 */
import { grid, type SavedLayout } from '../components/Grid';
import { panelStore } from '../state/panels';
import { sessionStore, SIDEBAR_MIN } from '../state/session';
import { timeStore } from '../state/time';
import { isPrimaryWindow } from './windowSync';

const KEY = 'brownout.layout.v1';
const PREFS = 'brownout.prefs.v1';

export interface Prefs {
  alignMode: string;
  seasonId: string;
  normalizeAlliance: boolean;
  timelineMode: string;
  timelineHeight: number | null;
  sidebarOpen: boolean;
  sidebarWidth?: number | null;
  timeFormat: string;
  brownoutThreshold: number;
  tagVariant: string;
  wholeLog: boolean;
  view: string;
}

let timer: number | undefined;
function scheduleSave() {
  // only the primary window saves its layout: a second window's layout is its own, for this run
  if (!isPrimaryWindow()) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      const l = grid.save();
      if (l && l.dock.panels && Object.keys(l.dock.panels).length) localStorage.setItem(KEY, JSON.stringify(l));
      else if (l) localStorage.removeItem(KEY);
      const s = sessionStore.get();
      const prefs: Prefs = {
        alignMode: s.alignMode,
        seasonId: s.seasonId,
        normalizeAlliance: s.normalizeAlliance,
        timelineMode: s.timelineMode,
        timelineHeight: s.timelineHeight,
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        timeFormat: timeStore.get().timeFormat,
        brownoutThreshold: s.brownoutThreshold,
        tagVariant: s.tagVariant,
        wholeLog: s.wholeLog,
        view: s.view,
      };
      localStorage.setItem(PREFS, JSON.stringify(prefs));
    } catch (e) {
      console.warn('autosave failed', e);
    }
  }, 400);
}

export function startAutosave(): void {
  panelStore.subscribe(scheduleSave);
  sessionStore.subscribe(scheduleSave);
  let fmt = timeStore.get().timeFormat;
  timeStore.subscribe((s) => {
    if (s.timeFormat !== fmt) {
      fmt = s.timeFormat;
      scheduleSave();
    }
  });
  grid.onLayoutChange(scheduleSave);
}

export function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<Prefs>;
    sessionStore.set({
      alignMode: (p.alignMode as never) ?? 'autoStart',
      seasonId: p.seasonId ?? '2026',
      normalizeAlliance: p.normalizeAlliance ?? true,
      timelineMode: (p.timelineMode as never) ?? 'standard',
      timelineHeight: typeof p.timelineHeight === 'number' ? p.timelineHeight : null,
      sidebarOpen: p.sidebarOpen ?? true,
      sidebarWidth: typeof p.sidebarWidth === 'number' && p.sidebarWidth >= SIDEBAR_MIN ? p.sidebarWidth : null,
      brownoutThreshold: p.brownoutThreshold ?? 6.75,
      tagVariant: p.tagVariant === 'andymark' ? 'andymark' : 'welded',
      wholeLog: p.wholeLog === true,
      view: p.view === 'video' || p.view === 'power' || p.view === 'robot' ? p.view : 'panels',
    });
    if (p.timeFormat) timeStore.set({ timeFormat: p.timeFormat as never });
  } catch {
    /* ignore */
  }
}

export function restoreLayout(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const l = JSON.parse(raw) as SavedLayout;
    if (l.version !== 1) return false;
    grid.load(l);
    return grid.panelIds().length > 0;
  } catch {
    return false;
  }
}

export function downloadText(name: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveText(name: string, text: string, filters?: { name: string; extensions: string[] }[]): Promise<void> {
  if (window.brownout) await window.brownout.saveFile(name, text, filters);
  else downloadText(name, text);
}

export async function pickJson(title: string): Promise<{ name: string; text: string } | null> {
  if (window.brownout) return window.brownout.openJsonDialog(title);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    };
    input.click();
  });
}
