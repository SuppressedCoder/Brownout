/**
 * The dockable panel grid (dockview). Panels are React components that read
 * their settings from panelStore by panel id; dockview only stores the id.
 */
import { useCallback, useRef } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps, type IWatermarkPanelProps } from 'dockview-react';
import { themeDark, themeLight, type DockviewApi, type SerializedDockview, type AddPanelOptions } from 'dockview';
import {
  panelStore,
  ensurePanel,
  removePanelSettings,
  newPanelId,
  addFieldToPanel,
  addFieldsToPanel,
  panelTypeForField,
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
import { hasFieldDrag, readFieldDrag, type FieldDrag } from '../lib/dnd';
import { runAction } from '../lib/actions';
import { sessionStore } from '../state/session';
import { useStore } from '../state/store';
import { settingsStore } from '../state/settings';

export interface SavedLayout {
  version: 1;
  name?: string;
  dock: SerializedDockview;
  panels: Record<string, PanelSettings>;
  timelineTracks?: string[];
}

let api: DockviewApi | null = null;
const layoutListeners = new Set<() => void>();

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
    panelStore.set({ panels: {} });
  },
  save(): SavedLayout | null {
    if (!api) return null;
    return { version: 1, dock: api.toJSON(), panels: panelStore.get().panels, timelineTracks: sessionStore.get().timelineTracks };
  },
  load(layout: SavedLayout) {
    if (!api) return;
    // Clear first: removing the old panels drops their settings, which must not
    // hit the incoming ones when a layout with the same panel ids is reloaded.
    api.clear();
    panelStore.set({ panels: structuredClone(layout.panels) });
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

function wrap(Comp: React.FC<{ id: string }>): React.FC<IDockviewPanelProps> {
  return function Wrapped(props: IDockviewPanelProps) {
    return <PanelFrame id={props.api.id} Comp={Comp} />;
  };
}

/** Panels narrower than this use compact view (fewer toolbar buttons, collapsed chips). */
const COMPACT_BELOW = 520;

function PanelFrame({ id, Comp }: { id: string; Comp: React.FC<{ id: string }> }) {
  const has = useStore(panelStore, (s) => !!s.panels[id]);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(ref, COMPACT_BELOW);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFieldDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    (e.currentTarget as HTMLElement).classList.add('drop-target');
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
    <div className={`panel-frame${compact ? ' compact' : ''}`} ref={ref} data-panel={id} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <CompactContext.Provider value={compact}>
        <Comp id={id} />
      </CompactContext.Provider>
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

const components: Record<PanelType, React.FC<IDockviewPanelProps>> = {
  graph: wrap(GraphPanel),
  table: wrap(TablePanel),
  console: wrap(ConsolePanel),
  field: wrap(FieldPanel),
  stats: wrap(StatsPanel),
  power: wrap(PowerPanel),
  paths: wrap(PathsPanel),
  compare: wrap(ComparePanel),
  info: wrap(InfoPanel),
  swerve: wrap(SwervePanel),
  controller: wrap(ControllerPanel),
  commands: wrap(CommandsPanel),
  video: wrap(VideoPanel),
};

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
  }, []);
  return (
    <div className="grid-host">
      <DockviewReact components={components} watermarkComponent={Watermark} onReady={onReady} theme={theme === 'light' ? themeLight : themeDark} />
    </div>
  );
}
