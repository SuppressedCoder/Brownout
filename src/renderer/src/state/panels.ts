/**
 * Settings for every panel in the grid, keyed by dockview panel id. Layouts
 * (dockview JSON) and these settings are saved together.
 */
import { createStore } from './store';
import type { IconName } from '../lib/icons';

export type PanelType =
  'graph' | 'table' | 'console' | 'field' | 'stats' | 'power' | 'paths' | 'compare' | 'info' | 'swerve' | 'controller' | 'commands' | 'video';

export interface GraphSeriesRef {
  key: string;
  axis: 'left' | 'right';
}
export interface GraphSettings {
  type: 'graph';
  series: GraphSeriesRef[];
  mode: 'overlay' | 'stacked' | 'difference';
  /** 'all' or a log id */
  source: string;
  showModes: boolean;
  thresholds: number[];
  /** Follows the shared timeline's visible range; when false the graph keeps its own `view`. */
  linked: boolean;
  view?: [number, number];
  /** Manual value-axis ranges; null/undefined = auto-fit to the visible data. */
  yLeft?: [number, number] | null;
  yRight?: [number, number] | null;
  /** The full legend box is open (click the legend strip above the plot). */
  legendOpen?: boolean;
  /** Shown in place of the plot while there are no fields: what a preset wanted and this log lacks. */
  note?: string;
}
export interface TableSettings {
  type: 'table';
  keys: string[];
  mode: 'changes' | 'cursor';
}
export interface ConsoleSettings {
  type: 'console';
  filter: string;
  errors: boolean;
  warnings: boolean;
  infos: boolean;
  events: boolean;
}
export interface FieldSettings {
  type: 'field';
  /** Extra pose keys (Pose2d, Pose2d[], Translation2d[]) besides the robot-pose role. */
  keys: string[];
  trailSeconds: number;
  showPath: boolean;
  showTarget: boolean;
  showTags: boolean;
  source: string;
  rotate: boolean;
  /** Camera lines, estimates and readout (default on). */
  showCameras?: boolean;
  /** Draw the season's field picture (default on). */
  showImage?: boolean;
  /** Draw the robot's parts from its profile (default on). */
  showParts?: boolean;
  /** Parts (layer ids) not to draw. */
  hiddenParts?: string[];
  /** Write each log's name by its robot (default on). */
  showLabels?: boolean;
  /** 0.15 .. 1: how strongly the field picture shows. */
  imageBrightness?: number;
  /** 1 = whole field fits the panel. */
  zoom?: number;
  /** Field point (blue-wall meters) at the panel center; undefined = field center. */
  center?: [number, number];
}
export interface StatsSettings {
  type: 'stats';
  key: string | null;
  phase: 'view' | 'selection' | 'enabled' | 'auto' | 'teleop' | 'full';
  bins: number;
  /** Shown while no field is chosen: what a preset wanted and this log lacks. */
  note?: string;
}
export interface PowerSettings {
  type: 'power';
  /** Report on the time selection when there is one (else the whole log). */
  followSelection?: boolean;
}
export interface ControllerSettings {
  type: 'controller';
  /** 'all' or a log id */
  source: string;
  /** Driver Station slot, 0 to 5. */
  index: number;
}
export interface CommandsSettings {
  type: 'commands';
  /** 'all' or a log id */
  source: string;
  /** A string[] field listing the running commands; empty = found automatically. */
  sourceKey?: string;
}
export interface VideoSettings {
  type: 'video';
  /** Log this panel's video belongs to; empty = the primary log. */
  logId?: string;
}
export interface SwerveSettings {
  type: 'swerve';
  /** 'all' or a log id */
  source: string;
  showSetpoints: boolean;
}
export interface PathsSettings {
  type: 'paths';
}
export interface CompareSettings {
  type: 'compare';
  /** Extra numeric keys to add as min/mean/max columns. */
  keys: string[];
  phase: 'enabled' | 'auto' | 'teleop' | 'full';
}
export interface InfoSettings {
  type: 'info';
}

export type PanelSettings =
  | GraphSettings
  | TableSettings
  | ConsoleSettings
  | FieldSettings
  | StatsSettings
  | PowerSettings
  | PathsSettings
  | CompareSettings
  | InfoSettings
  | SwerveSettings
  | ControllerSettings
  | CommandsSettings
  | VideoSettings;

export const PANEL_TITLES: Record<PanelType, string> = {
  graph: 'Line graph',
  table: 'Table',
  console: 'Console & events',
  field: '2D field',
  stats: 'Statistics',
  power: 'Power report',
  paths: 'Path analysis',
  compare: 'Compare matches',
  info: 'Log info & health',
  swerve: 'Swerve drive',
  controller: 'Controller',
  commands: 'Commands',
  video: 'Video',
};

/** What the "+ Add panel" menu shows. */
export const PANEL_CATALOG: { type: PanelType; icon: IconName; description: string }[] = [
  { type: 'graph', icon: 'graph', description: 'Signals over time; overlay, stack or subtract logs' },
  { type: 'field', icon: 'field', description: 'Robot poses, trails and paths on the field' },
  { type: 'table', icon: 'table', description: 'Value changes, or values at the cursor' },
  { type: 'console', icon: 'console', description: 'Console output, alerts and events from every log' },
  { type: 'stats', icon: 'stats', description: 'Histogram and min / mean / max for one signal' },
  { type: 'power', icon: 'power', description: 'Power by subsystem, brownout causes, battery health' },
  { type: 'swerve', icon: 'swerve', description: 'Module speeds and angles, measured against setpoints' },
  { type: 'controller', icon: 'gamepad', description: 'Driver sticks, triggers and buttons at the cursor' },
  { type: 'commands', icon: 'commands', description: 'Which commands ran when, one row per command' },
  { type: 'video', icon: 'video', description: 'A match video synced to the log' },
  { type: 'paths', icon: 'paths', description: 'Path-following error for each auto path' },
  { type: 'compare', icon: 'compare', description: 'One row of key metrics per log' },
  { type: 'info', icon: 'info', description: 'File facts, alignment and missing signals' },
];

export function defaultSettings(type: PanelType): PanelSettings {
  switch (type) {
    case 'graph':
      return { type, series: [], mode: 'overlay', source: 'all', showModes: true, thresholds: [], linked: true };
    case 'table':
      return { type, keys: [], mode: 'changes' };
    case 'console':
      return { type, filter: '', errors: true, warnings: true, infos: true, events: true };
    case 'field':
      return { type, keys: [], trailSeconds: 5, showPath: true, showTarget: true, showTags: true, source: 'all', rotate: false };
    case 'stats':
      return { type, key: null, phase: 'view', bins: 30 };
    case 'power':
      return { type };
    case 'paths':
      return { type };
    case 'compare':
      return { type, keys: [], phase: 'enabled' };
    case 'info':
      return { type };
    case 'swerve':
      return { type, source: 'all', showSetpoints: true };
    case 'controller':
      return { type, source: 'all', index: 0 };
    case 'commands':
      return { type, source: 'all' };
    case 'video':
      return { type };
  }
}

export interface PanelsState {
  panels: Record<string, PanelSettings>;
}

export const panelStore = createStore<PanelsState>({ panels: {} });

let nextPanel = 1;
export function newPanelId(type: PanelType): string {
  return `${type}-${Date.now().toString(36)}-${nextPanel++}`;
}

/**
 * Panels that belong to a view (Video review, Power) rather than the grid. Their settings live in
 * the panel store like any panel's, but are never saved into layouts or presets.
 */
export const VIEW_PANEL_PREFIX = 'view:';
export const isViewPanel = (id: string): boolean => id.startsWith(VIEW_PANEL_PREFIX);

export function ensurePanel(id: string, type: PanelType, init?: Partial<PanelSettings>): void {
  panelStore.set((st) => {
    if (st.panels[id]) return {};
    return { panels: { ...st.panels, [id]: { ...defaultSettings(type), ...(init as object) } as PanelSettings } };
  });
}

export function updatePanel<T extends PanelSettings>(id: string, patch: Partial<T> | ((s: T) => Partial<T>)): void {
  panelStore.set((st) => {
    const cur = st.panels[id] as T | undefined;
    if (!cur) return {};
    const p = typeof patch === 'function' ? patch(cur) : patch;
    return { panels: { ...st.panels, [id]: { ...cur, ...p } } };
  });
}

export function removePanelSettings(id: string): void {
  panelStore.set((st) => {
    if (!st.panels[id]) return {};
    const panels = { ...st.panels };
    delete panels[id];
    return { panels };
  });
}

const POSE_STRUCTS = ['Pose2d', 'Pose3d', 'Translation2d'];

/** Whether a panel type can show a field of this kind. */
export function panelAccepts(type: PanelType, kind: string, structName?: string): boolean {
  switch (type) {
    case 'graph':
      return kind === 'number' || kind === 'boolean' || kind === 'string';
    case 'table':
      return true;
    case 'field':
      return (kind === 'struct' || kind === 'struct[]') && POSE_STRUCTS.includes(structName ?? '');
    case 'stats':
    case 'compare':
      return kind === 'number';
    default:
      return false;
  }
}

/** Add a field to a panel in the way that panel type understands. Returns false when the panel can't show it. */
export function addFieldToPanel(id: string, key: string, kind: string, structName?: string): boolean {
  const s = panelStore.get().panels[id];
  if (!s || !panelAccepts(s.type, kind, structName)) return false;
  switch (s.type) {
    case 'graph':
      if (!s.series.some((x) => x.key === key)) updatePanel<GraphSettings>(id, { series: [...s.series, { key, axis: 'left' }] });
      return true;
    case 'table':
      if (!s.keys.includes(key)) updatePanel<TableSettings>(id, { keys: [...s.keys, key] });
      return true;
    case 'field':
      if (!s.keys.includes(key)) updatePanel<FieldSettings>(id, { keys: [...s.keys, key] });
      return true;
    case 'stats':
      updatePanel<StatsSettings>(id, { key });
      return true;
    case 'compare':
      if (!s.keys.includes(key)) updatePanel<CompareSettings>(id, { keys: [...s.keys, key] });
      return true;
    default:
      return false;
  }
}

/**
 * Add several fields to one panel. Returns how many it took and which it
 * skipped (wrong kind for the panel; a statistics panel shows one field, so
 * it takes the first number and skips the rest).
 */
export function addFieldsToPanel<F extends { key: string; kind: string; structName?: string }>(id: string, items: F[]): { added: number; skipped: F[] } {
  const type = panelStore.get().panels[id]?.type;
  const skipped: F[] = [];
  let added = 0;
  for (const it of items) {
    if (type === 'stats' && added >= 1) skipped.push(it);
    else if (addFieldToPanel(id, it.key, it.kind, it.structName)) added++;
    else skipped.push(it);
  }
  return { added, skipped };
}

/** Smart drop: which panel type fits a field (UI spec §3.8). */
export function panelTypeForField(kind: string, structName?: string, key?: string): PanelType {
  if (kind === 'struct' || kind === 'struct[]') {
    if (structName === 'Pose2d' || structName === 'Pose3d' || structName === 'Translation2d') return 'field';
    return 'graph';
  }
  if (kind === 'number' || kind === 'number[]') return 'graph';
  if (kind === 'boolean') return 'graph';
  if (kind === 'string') return key && /console|messages/i.test(key) ? 'console' : 'table';
  return 'table';
}
