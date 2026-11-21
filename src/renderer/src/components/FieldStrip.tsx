/**
 * The strip under a panel's tab that lists its fields: chips with + Field
 * for panels that show several (Graph, Table, Compare, the 2D field), one
 * slot for panels that show one (Statistics). Each chip carries the line or
 * marker its field is drawn with. Drop a field on a chip to swap it (it keeps
 * its line and axis), beside one to add it there, on + Field to add it at
 * the end; or click + Field and type.
 */
import type { ReactNode } from 'react';
import { useStore } from '../state/store';
import {
  panelStore,
  updatePanel,
  type CommandsSettings,
  type GraphSettings,
  type PanelSettings,
  type StatsSettings,
  type TableSettings,
} from '../state/panels';
import { useFieldIndex, type FieldLike, type FieldSpec } from '../lib/fields';
import { FIELD_DASHES } from '../lib/colors';
import { FieldList, FieldSlot, KeyText, type FieldListItem } from './FieldSlot';
import { sessionStore } from '../state/session';
import { uiStore } from '../state/ui';
import { shownKeys, pointAtField, inPanelsStore, gridStore } from '../lib/panelLinks';
import { showView } from '../lib/actions';

const POSES = ['Pose2d', 'Pose3d', 'Translation2d'];
/** What each kind of panel takes (the same rules as panelAccepts in state/panels.ts). */
export const PANEL_SPECS: Partial<Record<PanelSettings['type'], FieldSpec | undefined>> = {
  graph: { types: ['number', 'boolean', 'string'] },
  table: undefined,
  compare: { types: ['number'] },
  stats: { types: ['number'] },
  field: { types: [...POSES, ...POSES.map((p) => `${p}[]`)] },
  commands: { types: ['string[]'] },
};

/** Put keys into a list at an index; a key already in the list moves there. */
export function insertKeys(list: string[], at: number, keys: string[]): string[] {
  const before = list.slice(0, at).filter((k) => !keys.includes(k));
  const after = list.slice(at).filter((k) => !keys.includes(k));
  return [...before, ...keys, ...after];
}

/** Swap the key at an index; the same key elsewhere in the list goes. */
export function replaceKey(list: string[], at: number, key: string): string[] {
  return list.map((k, i) => (i === at ? key : k)).filter((k, i) => i === at || k !== key);
}

/** A short line drawn the way a graph draws a field: its dash (the color is the log's). */
export function LineSwatch({ index }: { index: number }) {
  const dash = FIELD_DASHES[index % FIELD_DASHES.length];
  return (
    <svg className="line-swatch" width="18" height="8" aria-hidden>
      <line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={dash.join(' ')} />
    </svg>
  );
}

export function StripRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="field-strip" data-testid={testId ?? 'field-strip'}>
      {children}
    </div>
  );
}

/**
 * How a panel's placed fields are edited, the same from its strip and from
 * In panels: the keys in order, add at an index, swap one (a graph line keeps
 * its dash and axis), remove one. Null for panels whose fields are not a list.
 */
export interface PanelEdit {
  keys: string[];
  spec?: FieldSpec;
  /** Takes one field (Statistics): a drop swaps it. */
  single: boolean;
  insert: (at: number, fs: FieldLike[]) => void;
  replace: (at: number, f: FieldLike) => void;
  remove: (at: number) => void;
}

export function panelEdit(id: string, s: PanelSettings): PanelEdit | null {
  const spec = PANEL_SPECS[s.type];
  if (s.type === 'graph')
    return {
      keys: s.series.map((x) => x.key),
      spec,
      single: false,
      insert: (at, fs) =>
        updatePanel<GraphSettings>(id, (cur) => {
          const keys = fs.map((f) => f.key);
          const kept = cur.series.filter((x) => !keys.includes(x.key));
          const before = cur.series.slice(0, at).filter((x) => !keys.includes(x.key)).length;
          const moved = (key: string) => cur.series.find((x) => x.key === key) ?? { key, axis: 'left' as const };
          return { series: [...kept.slice(0, before), ...keys.map(moved), ...kept.slice(before)] };
        }),
      replace: (at, f) =>
        updatePanel<GraphSettings>(id, (cur) => ({
          series: cur.series.map((x, i) => (i === at ? { ...x, key: f.key } : x)).filter((x, i) => i === at || x.key !== f.key),
        })),
      remove: (at) => updatePanel<GraphSettings>(id, (cur) => ({ series: cur.series.filter((_, j) => j !== at) })),
    };
  if (s.type === 'table' || s.type === 'compare' || s.type === 'field') {
    const set = (fn: (keys: string[]) => string[]) => updatePanel<TableSettings>(id, (cur) => ({ keys: fn(cur.keys) }));
    return {
      keys: s.keys,
      spec,
      single: false,
      insert: (at, fs) =>
        set((keys) =>
          insertKeys(
            keys,
            at,
            fs.map((f) => f.key),
          ),
        ),
      replace: (at, f) => set((keys) => replaceKey(keys, at, f.key)),
      remove: (at) => set((keys) => keys.filter((_, j) => j !== at)),
    };
  }
  if (s.type === 'stats')
    return {
      keys: s.key ? [s.key] : [],
      spec,
      single: true,
      insert: (_at, fs) => fs[0] && updatePanel<StatsSettings>(id, { key: fs[0].key }),
      replace: (_at, f) => updatePanel<StatsSettings>(id, { key: f.key }),
      remove: () => updatePanel<StatsSettings>(id, { key: undefined }),
    };
  // Commands finds its list by itself; a list picked by hand can be swapped or removed (back to finding it)
  if (s.type === 'commands')
    return {
      keys: s.sourceKey ? [s.sourceKey] : [],
      spec,
      single: true,
      insert: (_at, fs) => fs[0] && updatePanel<CommandsSettings>(id, { sourceKey: fs[0].key }),
      replace: (_at, f) => updatePanel<CommandsSettings>(id, { sourceKey: f.key }),
      remove: () => updatePanel<CommandsSettings>(id, { sourceKey: undefined }),
    };
  return null;
}

/** Switch a graph line between the left and right axis. */
export function toggleAxis(id: string, key: string): void {
  updatePanel<GraphSettings>(id, (cur) => ({ series: cur.series.map((y) => (y.key === key ? { ...y, axis: y.axis === 'left' ? 'right' : 'left' } : y)) }));
}

/** Open Robot setup at what the field shows (the 2D field's robot, path and cameras come from the robot profile). */
export function openFieldSetup(): void {
  uiStore.set({ setupTab: 'field' });
  showView('robot');
}

/**
 * The strip is left out while the field list shows In panels, which lists the
 * same fields with their values and edits them the same way. Only for panels
 * in the grid (In panels lists those), and only while the field list is open.
 */
export function useStripHidden(id: string): boolean {
  const on = useStore(inPanelsStore, (s) => s.on);
  const open = useStore(sessionStore, (s) => s.sidebarOpen && (s.view === 'panels' || s.view === 'robot'));
  const inGrid = useStore(gridStore, (s) => s.order.includes(id));
  return on && open && inGrid;
}

export function PanelFieldStrip({ id }: { id: string }) {
  const s = useStore(panelStore, (st) => st.panels[id]);
  const fields = useFieldIndex();
  const logs = useStore(sessionStore, (st) => st.logs);
  const hidden = useStripHidden(id);
  if (!s || hidden) return null;
  const edit = s.type === 'commands' ? null : panelEdit(id, s);
  if (!edit) return null;

  if (s.type === 'stats') {
    return (
      <StripRow>
        <FieldSlot
          inline
          spec={edit.spec}
          value={s.key ?? undefined}
          panel={id}
          onPick={(key) => updatePanel<StatsSettings>(id, { key })}
          testId="strip-slot"
        />
      </StripRow>
    );
  }

  let items: FieldListItem[] = edit.keys.map((key) => ({ key }));
  if (s.type === 'graph') {
    const numeric = (k: string) => (fields.get(k)?.kind ?? 'number') === 'number';
    items = s.series.map((x, i) => ({
      key: x.key,
      swatch: <LineSwatch index={i} />,
      extra: numeric(x.key) ? (
        <button className="chip-btn axis-btn" title="Left or right axis" onClick={() => toggleAxis(id, x.key)} data-testid="axis-toggle">
          {x.axis === 'left' ? 'L' : 'R'}
        </button>
      ) : undefined,
    }));
  }
  // the 2D field also draws the robot, its path and the cameras, from the robot profile: shown first, set in Robot setup
  const auto = s.type === 'field' ? shownKeys(s, logs).filter((k) => !edit.keys.includes(k)) : [];
  return (
    <StripRow>
      <FieldList
        items={items}
        spec={edit.spec}
        panel={id}
        onInsert={edit.insert}
        onReplace={edit.replace}
        onRemove={edit.remove}
        testId="strip-list"
        lead={
          auto.length > 0 && (
            <>
              {auto.map((k) => (
                <span
                  key={k}
                  className="chip fchip fixed"
                  title={`${k}
From the robot profile; click to change it in Robot setup`}
                  onMouseEnter={() => pointAtField(k, id)}
                  onMouseLeave={() => pointAtField(null)}
                  onClick={openFieldSetup}
                  data-testid="fchip-auto"
                >
                  <KeyText k={k} />
                </span>
              ))}
            </>
          )
        }
      />
    </StripRow>
  );
}
