/**
 * Which field is in which panel.
 *
 * - Panels in the grid are numbered in reading order (areas top to bottom,
 *   left to right; tabs in order), and each number has a color. The number
 *   and color mark the panel's tab and, in the field list, every field the
 *   panel shows.
 * - The grid's areas and the panel in front in each (gridStore) feed the
 *   field list's "In panels" sections.
 * - Pointing at a field (in the list, or a panel's chip) or at a panel's tab
 *   lights the other side (linkStore): the panels a field is in, or the
 *   fields a panel shows.
 */
import { createStore, useStore } from '../state/store';
import { panelStore, type PanelSettings, type GraphSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { camerasFor } from './vision';

export interface GridArea {
  /** Panel ids in tab order. */
  panels: string[];
  /** The panel in front. */
  front: string | null;
}

export const gridStore = createStore<{ order: string[]; areas: GridArea[] }>({ order: [], areas: [] });

/** The panel's number (1, 2, ...), or 0 when it isn't in the grid. */
export function panelNumber(id: string, order = gridStore.get().order): number {
  return order.indexOf(id) + 1;
}

/** How many colors panels cycle through (--panel-1 ... in lib/theme.ts). */
export const PANEL_COLORS = 8;
export function panelColorVar(n: number): string {
  return `var(--panel-${((Math.max(1, n) - 1) % PANEL_COLORS) + 1})`;
}

/** What the pointer is on: a field (from the list or a chip) or a panel (its tab), and the fields to light. */
export const linkStore = createStore<{ key: string | null; panel: string | null; keys: ReadonlySet<string> }>({
  key: null,
  panel: null,
  keys: new Set(),
});

export function pointAtField(key: string | null, panel: string | null = null): void {
  linkStore.set({ key, panel, keys: key ? new Set([key]) : new Set() });
}
export function pointAtPanel(panel: string | null): void {
  const s = panel ? panelStore.get().panels[panel] : undefined;
  linkStore.set({ key: null, panel, keys: new Set(s ? shownKeys(s, sessionStore.get().logs) : []) });
}

/** The fields placed in a panel by hand, in order (graph lines, table columns, the statistics field, ...). */
export function placedKeys(s: PanelSettings): string[] {
  switch (s.type) {
    case 'graph':
      return s.series.map((x) => x.key);
    case 'table':
    case 'compare':
    case 'field':
      return s.keys;
    case 'stats':
      return s.key ? [s.key] : [];
    case 'commands':
      return s.sourceKey ? [s.sourceKey] : [];
    default:
      return [];
  }
}

/** Everything a panel shows: the fields placed in it, and for the 2D field the robot, its path and the cameras' fields. */
export function shownKeys(s: PanelSettings, logs: LogEntry[]): string[] {
  const out = [...placedKeys(s)];
  if (s.type === 'field') {
    const shown = s.source === 'all' ? logs.filter((l) => l.visible) : logs.filter((l) => l.id === s.source);
    const add = (k: string | undefined) => k && !out.includes(k) && out.push(k);
    for (const l of shown) {
      add(l.roles.robotPose);
      if (s.showPath) add(l.roles.activePath);
      if (s.showTarget) add(l.roles.targetPose);
      if (s.showTags !== false) for (const c of camerasFor(l)) [c.poseKey, c.tagIdsKey, c.tagPosesKey].forEach(add);
    }
  }
  return out;
}

/**
 * For each field, the numbers of the grid panels showing it. Kept in a store
 * that changes only when the numbers do, so zooming a graph (a panel settings
 * change) doesn't re-render the field list.
 */
const fieldPanelsStore = createStore<{ map: Map<string, number[]>; sig: string }>({ map: new Map(), sig: '' });
function refreshFieldPanels(): void {
  const { order } = gridStore.get();
  const panels = panelStore.get().panels;
  const logs = sessionStore.get().logs;
  const map = new Map<string, number[]>();
  const parts: string[] = [];
  order.forEach((id, i) => {
    const s = panels[id];
    if (!s) return;
    const keys = shownKeys(s, logs);
    parts.push(keys.join(''));
    for (const k of keys) {
      const a = map.get(k);
      if (a) a.push(i + 1);
      else map.set(k, [i + 1]);
    }
  });
  const sig = parts.join('');
  if (sig !== fieldPanelsStore.get().sig) fieldPanelsStore.set({ map, sig });
}
gridStore.subscribe(refreshFieldPanels);
panelStore.subscribe(refreshFieldPanels);
sessionStore.subscribe(refreshFieldPanels);

export function useFieldPanels(): Map<string, number[]> {
  return useStore(fieldPanelsStore, (s) => s.map);
}

/** The axis a graph draws a field on, for the In panels rows. */
export function graphAxis(s: GraphSettings, key: string): 'left' | 'right' | undefined {
  return s.series.find((x) => x.key === key)?.axis;
}

/** The field list's "In panels" switch, remembered in this browser profile. */
const IN_PANELS_KEY = 'brownout.inPanels.v1';
function readInPanels(): boolean {
  try {
    return localStorage.getItem(IN_PANELS_KEY) === '1';
  } catch {
    return false;
  }
}
/** In panels' minimized sections, by panel id, remembered like the switch. */
const COLLAPSED_KEY = 'brownout.inPanels.collapsed.v1';
function readCollapsed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export const inPanelsStore = createStore({ on: readInPanels(), collapsed: readCollapsed() });
inPanelsStore.subscribe((s) => {
  try {
    localStorage.setItem(IN_PANELS_KEY, s.on ? '1' : '0');
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(s.collapsed));
  } catch {
    // private window or storage blocked: the switch just isn't remembered
  }
});

/** Minimize or restore a panel's In panels section. */
export function toggleSectionCollapsed(id: string): void {
  inPanelsStore.set((s) => ({ collapsed: s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id] }));
}
