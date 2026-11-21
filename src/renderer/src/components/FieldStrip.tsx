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
import { panelStore, updatePanel, type GraphSettings, type PanelSettings, type StatsSettings, type TableSettings } from '../state/panels';
import { useFieldIndex, type FieldLike, type FieldSpec } from '../lib/fields';
import { FIELD_DASHES } from '../lib/colors';
import { FieldList, FieldSlot, KeyText, type FieldListItem } from './FieldSlot';
import { sessionStore } from '../state/session';
import { uiStore } from '../state/ui';
import { shownKeys, pointAtField } from '../lib/panelLinks';
import { showView } from '../lib/actions';

const POSES = ['Pose2d', 'Pose3d', 'Translation2d'];
/** What each kind of panel takes (the same rules as panelAccepts in state/panels.ts). */
export const PANEL_SPECS: Partial<Record<PanelSettings['type'], FieldSpec | undefined>> = {
  graph: { types: ['number', 'boolean', 'string'] },
  table: undefined,
  compare: { types: ['number'] },
  stats: { types: ['number'] },
  field: { types: [...POSES, ...POSES.map((p) => `${p}[]`)] },
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

export function PanelFieldStrip({ id }: { id: string }) {
  const s = useStore(panelStore, (st) => st.panels[id]);
  const fields = useFieldIndex();
  const logs = useStore(sessionStore, (st) => st.logs);
  if (!s) return null;
  const spec = PANEL_SPECS[s.type];

  if (s.type === 'graph') {
    const g = s as GraphSettings;
    const numeric = (k: string) => (fields.get(k)?.kind ?? 'number') === 'number';
    const items: FieldListItem[] = g.series.map((x, i) => ({
      key: x.key,
      swatch: <LineSwatch index={i} />,
      extra: numeric(x.key) ? (
        <button
          className="chip-btn axis-btn"
          title="Left or right axis"
          onClick={() =>
            updatePanel<GraphSettings>(id, { series: g.series.map((y, j) => (j === i ? { ...y, axis: y.axis === 'left' ? 'right' : 'left' } : y)) })
          }
          data-testid="axis-toggle"
        >
          {x.axis === 'left' ? 'L' : 'R'}
        </button>
      ) : undefined,
    }));
    const insert = (at: number, fs: FieldLike[]) =>
      updatePanel<GraphSettings>(id, (cur) => {
        const keys = fs.map((f) => f.key);
        const kept = cur.series.filter((x) => !keys.includes(x.key));
        const before = cur.series.slice(0, at).filter((x) => !keys.includes(x.key)).length;
        return { series: [...kept.slice(0, before), ...keys.map((key) => ({ key, axis: 'left' as const })), ...kept.slice(before)] };
      });
    const replace = (at: number, f: FieldLike) =>
      updatePanel<GraphSettings>(id, (cur) => ({
        series: cur.series.map((x, i) => (i === at ? { ...x, key: f.key } : x)).filter((x, i) => i === at || x.key !== f.key),
      }));
    return (
      <StripRow>
        <FieldList
          items={items}
          spec={spec}
          panel={id}
          onInsert={insert}
          onReplace={replace}
          onRemove={(i) => updatePanel<GraphSettings>(id, (cur) => ({ series: cur.series.filter((_, j) => j !== i) }))}
          testId="strip-list"
        />
      </StripRow>
    );
  }

  if (s.type === 'table' || s.type === 'compare' || s.type === 'field') {
    const keys = s.keys;
    const set = (next: string[]) => updatePanel<TableSettings>(id, { keys: next });
    // the 2D field also draws the robot, its path and the cameras, from the robot profile: shown first, set in Robot setup
    const auto = s.type === 'field' ? shownKeys(s, logs).filter((k) => !keys.includes(k)) : [];
    return (
      <StripRow>
        <FieldList
          items={keys.map((key) => ({ key }))}
          spec={spec}
          panel={id}
          onInsert={(at, fs) =>
            set(
              insertKeys(
                keys,
                at,
                fs.map((f) => f.key),
              ),
            )
          }
          onReplace={(at, f) => set(replaceKey(keys, at, f.key))}
          onRemove={(i) => set(keys.filter((_, j) => j !== i))}
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
                    onClick={() => (uiStore.set({ setupTab: 'field' }), showView('robot'))}
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

  if (s.type === 'stats') {
    return (
      <StripRow>
        <FieldSlot inline spec={spec} value={s.key ?? undefined} panel={id} onPick={(key) => updatePanel<StatsSettings>(id, { key })} testId="strip-slot" />
      </StripRow>
    );
  }
  return null;
}
