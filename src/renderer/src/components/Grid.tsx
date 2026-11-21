/**
 * The dockable panel grid (dockview). Panels are React components that read
 * their settings from panelStore by panel id; dockview only stores the id.
 */
import { useCallback, useRef } from 'react';
import {
  DockviewReact,
  DockviewDefaultTab,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IWatermarkPanelProps,
} from 'dockview-react';
import { themeDark, themeLight, type DockviewApi, type SerializedDockview, type AddPanelOptions } from 'dockview';
import {
  panelStore,
  isViewPanel,
  ensurePanel,
  removePanelSettings,
  newPanelId,
  addFieldToPanel,
  addFieldsToPanel,
  panelTypeForField,
  panelAccepts,
  PANEL_TITLES,
  type PanelType,
  type PanelSettings,
} from '../state/panels';
import { SwervePanel } from '../panels/SwervePanel';
import { ControllerPanel } from '../panels/ControllerPanel';
import { CommandsPanel } from '../panels/CommandsPanel';
import { VideoPanel } from '../panels/VideoPanel';
import { CompactContext, useCompactWidth } from './Toolbar';
import { Icon } from './Icon';
import { reportAdd } from './Sidebar';
import { capturePanel } from '../lib/capture';
import { GraphPanel } from '../panels/GraphPanel';
import { TablePanel } from '../panels/TablePanel';
import { ConsolePanel } from '../panels/ConsolePanel';
import { FieldPanel } from '../panels/FieldPanel';
import { StatsPanel } from '../panels/StatsPanel';
import { PowerPanel } from '../panels/PowerPanel';
import { PathsPanel } from '../panels/PathsPanel';
import { ComparePanel } from '../panels/ComparePanel';
import { InfoPanel } from '../panels/InfoPanel';
import { hasFieldDrag, readFieldDrag, dragStore, type FieldDrag } from '../lib/dnd';
import { gridStore, linkStore, pointAtPanel, panelColorVar, shownKeys, type GridArea } from '../lib/panelLinks';
import { runAction } from '../lib/actions';
import { sessionStore } from '../state/session';
import { useStore } from '../state/store';
import { settingsStore } from '../state/settings';
import { createStore } from '../state/store';

export interface SavedLayout {
  version: 1;
  name?: string;
  dock: SerializedDockview;
  panels: Record<string, PanelSettings>;
  timelineTracks?: string[];
}

let api: DockviewApi | null = null;

/** The settings of the views' own panels, which layouts never touch. */
function viewPanelsOnly(): Record<string, PanelSettings> {
  return Object.fromEntries(Object.entries(panelStore.get().panels).filter(([id]) => isViewPanel(id)));
}
const layoutListeners = new Set<() => void>();
/** Whether one panel fills the grid right now (dockview's maximized group). */
export const maximizedStore = createStore({ maximized: false });

export const grid = {
  get api() {
    return api;
  },
  addPanel(type: PanelType, init?: Partial<PanelSettings>, position?: AddPanelOptions['position'], title?: string): string {
    const id = newPanelId(type);
    ensurePanel(id, type, init);
    api?.addPanel({ id, component: type, title: title ?? PANEL_TITLES[type], position });
    return id;
  },
  clear() {
    api?.clear();
    panelStore.set({ panels: viewPanelsOnly() });
  },
  save(): SavedLayout | null {
    if (!api) return null;
    const panels = Object.fromEntries(Object.entries(panelStore.get().panels).filter(([id]) => !isViewPanel(id)));
    return { version: 1, dock: api.toJSON(), panels, timelineTracks: sessionStore.get().timelineTracks };
  },
  load(layout: SavedLayout) {
    if (!api) return;
    // Clear first: removing the old panels drops their settings, which must not
    // hit the incoming ones when a layout with the same panel ids is reloaded.
    api.clear();
    panelStore.set({ panels: { ...viewPanelsOnly(), ...structuredClone(layout.panels) } });
    try {
      api.fromJSON(structuredClone(layout.dock));
    } catch (e) {
      console.error('layout load failed', e);
      api.clear();
    }
    if (layout.timelineTracks) sessionStore.set({ timelineTracks: layout.timelineTracks });
  },
  panelIds(): string[] {
    return api?.panels.map((p) => p.id) ?? [];
  },
  /** Called on any layout change (panels added, removed, moved, resized). */
  onLayoutChange(cb: () => void): () => void {
    layoutListeners.add(cb);
    return () => layoutListeners.delete(cb);
  },
  activePanelId(): string | undefined {
    return api?.activePanel?.id;
  },
  /** Let one panel fill the grid (the timeline stays), or put it back. Acts on the active panel when no id is given. */
  toggleMaximize(id?: string): void {
    if (!api) return;
    if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
      return;
    }
    const p = api.getPanel(id ?? api.activePanel?.id ?? '');
    if (!p) return;
    p.api.setActive();
    api.maximizeGroup(p);
  },
  /** Bring the first panel of a type to the front, or add one. Returns its id. */
  showPanel(type: PanelType): string {
    const existing = api?.panels.find((p) => panelStore.get().panels[p.id]?.type === type);
    if (existing) {
      existing.api.setActive();
      return existing.id;
    }
    return grid.addPanel(type);
  },
};

/** Number the panels in reading order and note the panel in front in each area (lib/panelLinks.ts). */
let refreshQueued = false;
function refreshGrid(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    // one panel fills the grid: the others are hidden and have no place to read; keep the numbers
    if (!api || api.hasMaximizedGroup()) return;
    const groups = api.groups.map((g) => ({ g, r: g.element.getBoundingClientRect() }));
    groups.sort((a, b) => (Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left));
    const areas: GridArea[] = groups.map(({ g }) => ({ panels: g.panels.map((p) => p.id), front: g.activePanel?.id ?? null }));
    const cur = gridStore.get();
    if (JSON.stringify(cur.areas) === JSON.stringify(areas)) return;
    gridStore.set({ order: areas.flatMap((a) => a.panels), areas });
  });
}

/** A panel's tab: its number in a square of its color, then dockview's own tab (title, close). */
function PanelTab(props: IDockviewPanelHeaderProps) {
  const id = props.api.id;
  const n = useStore(gridStore, (s) => s.order.indexOf(id) + 1);
  // lit while the pointer is on a field this panel shows
  const lit = useStore(linkStore, (s) => {
    if (!s.key || s.panel === id) return false;
    const ps = panelStore.get().panels[id];
    return !!ps && shownKeys(ps, sessionStore.get().logs).includes(s.key);
  });
  return (
    <div
      className={`panel-tab${lit ? ' linked' : ''}`}
      onMouseEnter={() => pointAtPanel(id)}
      onMouseLeave={() => pointAtPanel(null)}
      data-testid="panel-tab"
      data-n={n || undefined}
    >
      {n > 0 && (
        <span className="pn" style={{ background: panelColorVar(n) }}>
          {n}
        </span>
      )}
      <DockviewDefaultTab {...props} />
    </div>
  );
}

function wrap(Comp: React.FC<{ id: string }>): React.FC<IDockviewPanelProps> {
  return function Wrapped(props: IDockviewPanelProps) {
    return <PanelFrame id={props.api.id} Comp={Comp} />;
  };
}

/** Panels narrower than this use compact view (fewer toolbar buttons, collapsed chips). */
const COMPACT_BELOW = 520;

function PanelFrame({ id, Comp, standalone }: { id: string; Comp: React.FC<{ id: string }>; standalone?: boolean }) {
  const has = useStore(panelStore, (s) => !!s.panels[id]);
  const maximized = useStore(maximizedStore, (s) => s.maximized);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(ref, COMPACT_BELOW);
  const canTake = useStore(dragStore, (s) => {
    const t = panelStore.get().panels[id]?.type;
    return !!s.items && !!t && panelAccepts(t, s.items[0].kind, s.items[0].structName);
  });
  const linked = useStore(linkStore, (s) => {
    if (!s.key || s.panel === id) return false;
    const ps = panelStore.get().panels[id];
    return !!ps && shownKeys(ps, sessionStore.get().logs).includes(s.key);
  });
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFieldDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const el = e.currentTarget as HTMLElement;
    el.dataset.drop = dragStore.get().items?.[0]?.key ?? '';
    el.classList.add('drop-target');
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('drop-target');
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      (e.currentTarget as HTMLElement).classList.remove('drop-target');
      const items = readFieldDrag(e);
      if (!items) return;
      e.preventDefault();
      e.stopPropagation();
      const type = panelStore.get().panels[id]?.type;
      const r = addFieldsToPanel(id, items);
      if (type) reportAdd(items.length, r.added, r.skipped, PANEL_TITLES[type]);
    },
    [id],
  );
  if (!has) return <div className="panel-missing">Panel settings missing</div>;
  return (
    <div
      className={`panel-frame${compact ? ' compact' : ''}${canTake ? ' drop-lit' : ''}${linked ? ' linked' : ''}`}
      ref={ref}
      data-panel={id}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <CompactContext.Provider value={compact}>
        <Comp id={id} />
      </CompactContext.Provider>
      {!standalone && (
        <button
          className={`max-btn${maximized ? ' on' : ''}`}
          title={
            maximized ? 'Show all panels again (double-click the tab, or Ctrl+Enter)' : 'Fill the grid with this panel (double-click the tab, or Ctrl+Enter)'
          }
          aria-label={maximized ? 'Restore the panels' : 'Maximize this panel'}
          data-testid="panel-maximize"
          onClick={() => grid.toggleMaximize(id)}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
        </button>
      )}
      <button
        className="capture-btn"
        title="Copy this panel as an image (Shift-click to save a PNG)"
        aria-label="Copy panel as image"
        onClick={(e) => void capturePanel(id, e.shiftKey ? 'save' : 'copy')}
      >
        <Icon name="image" size={13} />
      </button>
    </div>
  );
}

const RAW: Record<PanelType, React.FC<{ id: string }>> = {
  graph: GraphPanel,
  table: TablePanel,
  console: ConsolePanel,
  field: FieldPanel,
  stats: StatsPanel,
  power: PowerPanel,
  paths: PathsPanel,
  compare: ComparePanel,
  info: InfoPanel,
  swerve: SwervePanel,
  controller: ControllerPanel,
  commands: CommandsPanel,
  video: VideoPanel,
};

const components = Object.fromEntries(Object.entries(RAW).map(([k, c]) => [k, wrap(c)])) as Record<PanelType, React.FC<IDockviewPanelProps>>;

/** A panel outside the grid, at a fixed place in a view. Its settings must exist (ensurePanel) under a view id. */
export function StandalonePanel({ id }: { id: string }) {
  const type = useStore(panelStore, (s) => s.panels[id]?.type);
  if (!type) return null;
  return (
    <div className="standalone-panel" data-view-panel={id}>
      <PanelFrame id={id} Comp={RAW[type]} standalone />
    </div>
  );
}

function Watermark(_props: IWatermarkPanelProps) {
  const logs = useStore(sessionStore, (s) => s.logs.length);
  const onDrop = (e: React.DragEvent) => {
    const dropped = readFieldDrag(e);
    if (!dropped) return;
    e.preventDefault();
    let rest: FieldDrag[] = dropped;
    // one new panel per kind of field, so a mixed drop loses nothing
    for (let n = 0; rest.length && n < 4; n++) {
      const type = panelTypeForField(rest[0].kind, rest[0].structName, rest[0].key);
      const id = grid.addPanel(type);
      const r: { added: number; skipped: FieldDrag[] } = addFieldsToPanel(id, rest);
      if (!r.added) {
        addFieldToPanel(id, rest[0].key, rest[0].kind, rest[0].structName);
        break;
      }
      rest = r.skipped;
    }
  };
  return (
    <div
      className="watermark"
      onDragOver={(e) => {
        if (hasFieldDrag(e)) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      {logs === 0 ? (
        <>
          <div className="wm-title">Brownout</div>
          <div>
            Open one or more <code>.wpilog</code> files, or drop them here.
          </div>
          <button className="btn primary" onClick={() => runAction('open')}>
            Open logs…
          </button>
          <div className="wm-hint">No logs handy? Settings, then Demo logs, loads three example matches.</div>
        </>
      ) : (
        <>
          <div className="wm-title">Empty grid</div>
          <div>Drag fields here, pick a preset, or use “Add panel”.</div>
        </>
      )}
    </div>
  );
}

export function Grid() {
  const theme = useStore(settingsStore, (s) => s.theme);
  const onReady = useCallback((e: DockviewReadyEvent) => {
    api = e.api;
    e.api.onDidRemovePanel((p) => removePanelSettings(p.id));
    e.api.onDidLayoutChange(() => {
      for (const l of layoutListeners) l();
    });
    e.api.onDidMaximizedGroupChange(() => {
      maximizedStore.set({ maximized: e.api.hasMaximizedGroup() });
      refreshGrid();
    });
    e.api.onDidLayoutChange(refreshGrid);
    e.api.onDidAddPanel(refreshGrid);
    e.api.onDidRemovePanel(refreshGrid);
    e.api.onDidMovePanel(refreshGrid);
    e.api.onDidActivePanelChange(refreshGrid);
    e.api.onDidActiveGroupChange(refreshGrid);
    refreshGrid();
  }, []);
  // Double-click a panel's tab to let it fill the grid, and again to put it back.
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const tab = (e.target as HTMLElement).closest('.dv-tab');
    if (!tab) return;
    grid.toggleMaximize();
  }, []);
  return (
    <div className="grid-host" onDoubleClick={onDoubleClick}>
      <DockviewReact
        components={components}
        defaultTabComponent={PanelTab}
        watermarkComponent={Watermark}
        onReady={onReady}
        theme={theme === 'light' ? themeLight : themeDark}
      />
    </div>
  );
}
