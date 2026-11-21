/**
 * "In panels": the field list as a preview of what the panels show. One
 * section per area of the grid, for the panel in front there (switch a tab
 * and its section follows), each scrolling on its own. A row is a field the
 * panel shows, drawn the way the panel draws it (a graph's line and axis,
 * the 2D field's robot or camera), with its value at the cursor for every
 * log in the log's color. A field in two panels is in both sections; the
 * pointer on one lights the others. While it is on, the panels' strips are
 * hidden and their fields are edited here: drop on a section to add, on a
 * row to swap, on a row's edge to add there; + Field, remove, L / R. Rows
 * drag like the field list's, to another section or to a new place.
 *
 * Values are written straight into their spans when the cursor moves, so
 * moving it re-renders nothing (AGENTS rule 13).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { panelStore, PANEL_TITLES, panelAccepts, addFieldsToPanel, type PanelSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore } from '../state/time';
import { toast } from '../state/ui';
import { gridStore, linkStore, pointAtField, panelColorVar, shownKeys, inPanelsStore, toggleSectionCollapsed } from '../lib/panelLinks';
import { useFieldIndex, keyMatchesSearch, groupByFolder, specAccepts, specReason } from '../lib/fields';
import { dragStore, hasFieldDrag, readFieldDrag, setFieldDrag } from '../lib/dnd';
import { FolderGroups } from './FolderGroups';
import { camerasFor } from '../lib/vision';
import { client } from '../worker/client';
import { indexAtOrBefore } from '@core/log';
import { formatValue } from '../lib/format';
import { grid } from './Grid';
import { FieldList, FieldSlot, KeyText } from './FieldSlot';
import { LineSwatch, panelEdit, toggleAxis, openFieldSetup, type PanelEdit } from './FieldStrip';
import { reportAdd } from './Sidebar';
import { Icon } from './Icon';

/** The value of a field at a time in one log, as the inspector shows it. */
function valueText(log: LogEntry, key: string, t: number | null, unit?: string): string {
  const s = client.peekSeries(log.id, key);
  if (s === null) return 'not in this log';
  if (s === undefined) return '…';
  if (t === null) return '';
  const i = indexAtOrBefore(s.t, t - log.offset);
  if (i < 0) return '—';
  const v = s.kind === 'boolean' ? !!s.v[i] : s.v[i];
  return poseText(v) ?? formatValue(v, unit);
}

/** A pose on one line: "x 4.34  y 4.72  12.0°" (a Pose3d shows z too); null for anything else. */
function poseText(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as { translation?: Record<string, number>; rotation?: Record<string, unknown> };
  const t = o.translation;
  if (!t || typeof t.x !== 'number' || typeof t.y !== 'number') return null;
  const parts = [`x ${t.x.toFixed(2)}`, `y ${t.y.toFixed(2)}`];
  if (typeof t.z === 'number') parts.push(`z ${t.z.toFixed(2)}`);
  const r = o.rotation as { value?: number; q?: { w: number; x: number; y: number; z: number } } | undefined;
  let yaw: number | null = null;
  if (r && typeof r.value === 'number') yaw = r.value;
  else if (r?.q) {
    const { w, x, y, z } = r.q;
    yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }
  if (yaw !== null) parts.push(`${((yaw * 180) / Math.PI).toFixed(1)}°`);
  return parts.join('  ');
}

function CursorValue({ log, k, unit }: { log: LogEntry; k: string; unit?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = '';
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const ts = timeStore.get();
      const text = valueText(log, k, ts.hover ?? ts.cursor, unit);
      if (text !== last) el.textContent = last = text;
    };
    update();
    const a = timeStore.subscribe(update);
    const b = client.subscribe(update);
    return () => {
      a();
      b();
    };
  }, [log, k, unit]);
  return <span ref={ref} className="mono ip-num" data-testid="ip-value" />;
}

/** How the panel draws a field: a graph's line and axis (click L / R to switch), the 2D field's robot or camera, or nothing. */
function Swatch({ id, s, k, logs }: { id: string; s: PanelSettings; k: string; logs: LogEntry[] }) {
  if (s.type === 'graph') {
    const i = s.series.findIndex((x) => x.key === k);
    if (i < 0) return null;
    return (
      <span className="ip-style">
        <LineSwatch index={i} />
        <button className="chip-btn ip-axis" title="Left or right axis" onClick={(e) => (e.stopPropagation(), toggleAxis(id, k))} data-testid="ip-axis">
          {s.series[i].axis === 'left' ? 'L' : 'R'}
        </button>
      </span>
    );
  }
  if (s.type === 'field') {
    if (logs.some((l) => l.roles.robotPose === k))
      return (
        <span className="ip-style">
          <svg width="14" height="10" aria-hidden>
            <rect x="3" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      );
    for (const l of logs) {
      const cam = camerasFor(l).find((c) => c.poseKey === k || c.tagIdsKey === k || c.tagPosesKey === k);
      if (cam)
        return (
          <span className="ip-style" title={cam.name}>
            <span className="dot" style={{ background: cam.color }} />
          </span>
        );
    }
    return (
      <span className="ip-style">
        <svg width="14" height="10" aria-hidden>
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
        </svg>
      </span>
    );
  }
  return null;
}

/** Where a dragged field would land on a row: its top or bottom edge adds it there, the middle swaps the row's field. */
type Over = { key: string; mode: 'before' | 'after' | 'swap'; bad: boolean };

function Row({
  id,
  k,
  name,
  s,
  logs,
  unit,
  kind,
  edit,
  over,
  setOver,
}: {
  id: string;
  k: string;
  name: string;
  s: PanelSettings;
  logs: LogEntry[];
  unit?: string;
  /** The field's kind and struct, for dragging the row to another panel. */
  kind?: { kind: string; structName?: string };
  edit: PanelEdit | null;
  over: Over | null;
  setOver: (o: Over | null) => void;
}) {
  const linked = useStore(linkStore, (x) => x.key === k);
  const at = edit ? edit.keys.indexOf(k) : -1;
  // the 2D field's robot, path and cameras come from the robot profile: set in Robot setup
  const fromProfile = at < 0 && s.type === 'field';

  const where = (e: React.DragEvent): Over['mode'] => {
    if (edit?.single) return 'swap';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'swap';
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!edit || at < 0 || !hasFieldDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const mode = where(e);
    const f = dragStore.get().items?.[0];
    const bad = !!f && !specAccepts(edit.spec, f);
    if (over?.key !== k || over.mode !== mode || over.bad !== bad) setOver({ key: k, mode, bad });
  };
  const onDrop = (e: React.DragEvent) => {
    if (!edit || at < 0) return;
    const items = readFieldDrag(e);
    setOver(null);
    if (!items?.length) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = items.filter((f) => specAccepts(edit.spec, f));
    if (!ok.length) {
      if (edit.spec) toast(specReason(edit.spec, items[0]), 'error');
      return;
    }
    const mode = where(e);
    if (mode === 'swap') {
      edit.replace(at, ok[0]);
      if (ok.length > 1 && !edit.single) edit.insert(at + 1, ok.slice(1));
    } else edit.insert(mode === 'before' ? at : at + 1, ok);
  };

  const mine = over?.key === k ? over : null;
  const cls = mine ? (mine.bad ? ' bad' : mine.mode === 'swap' ? ' over' : ` gap-${mine.mode}`) : '';
  return (
    <div
      className={`ip-row${linked ? ' linked' : ''}${cls}${fromProfile ? ' from-profile' : ''}`}
      onMouseEnter={() => pointAtField(k)}
      onMouseLeave={() => pointAtField(null)}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={fromProfile ? openFieldSetup : undefined}
      draggable={!!kind}
      onDragStart={kind ? (e) => setFieldDrag(e, [{ key: k, ...kind }]) : undefined}
      data-key={k}
      data-testid="ip-row"
    >
      <div className="ip-key" title={fromProfile ? `${k}\nFrom the robot profile; click to change it in Robot setup` : k}>
        <Swatch id={id} s={s} k={k} logs={logs} />
        <KeyText k={name} />
        {at >= 0 && edit && (
          <button
            className="chip-btn ip-remove"
            title="Remove from the panel"
            aria-label={`Remove ${k} from the panel`}
            onClick={(e) => (e.stopPropagation(), edit.remove(at))}
            data-testid="ip-remove"
          >
            <Icon name="close" size={10} />
          </button>
        )}
      </div>
      <div className="ip-vals">
        {logs.map((l) => (
          <span className="ip-val" key={l.id}>
            <span className="dot" style={{ background: l.color }} />
            <CursorValue log={l} k={k} unit={unit} />
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One area of the grid: the panel in front there. It takes fields like the
 * panel and its strip do (the strip is hidden while In panels is on): drop
 * anywhere to add, on a row to swap, on a row's edge to add there; + Field
 * types one in.
 */
function Section({ id, n, q, logs, all }: { id: string | null; n: number; q: string; logs: LogEntry[]; all: LogEntry[] }) {
  const panels = useStore(panelStore, (st) => st.panels);
  const fields = useFieldIndex();
  const dragged = useStore(dragStore, (d) => d.items);
  const [over, setOver] = useState<Over | null>(null);
  const [target, setTarget] = useState(false);
  // a drag that ends anywhere (dropped elsewhere, or Esc) leaves no mark behind
  useEffect(() => {
    if (dragged) return;
    setOver(null);
    setTarget(false);
  }, [dragged]);
  const collapsed = useStore(inPanelsStore, (st) => st.collapsed);
  const s = id ? panels[id] : undefined;
  const edit = id && s ? panelEdit(id, s) : null;
  const shown = s ? shownKeys(s, all) : [];
  const keys = shown.filter((k) => keyMatchesSearch(k, q));
  const min = !!id && collapsed.includes(id);
  const title = (id && grid.api?.getPanel(id)?.title) || (s ? PANEL_TITLES[s.type] : '');
  const canTake = !!s && !!dragged && dragged.length > 0 && panelAccepts(s.type, dragged[0].kind, dragged[0].structName);

  const onDragOver = (e: React.DragEvent) => {
    if (!s || !hasFieldDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!target) setTarget(true);
    if (over) setOver(null);
  };
  const onDrop = (e: React.DragEvent) => {
    setTarget(false);
    setOver(null);
    const items = readFieldDrag(e);
    if (!id || !s || !items) return;
    e.preventDefault();
    const r = addFieldsToPanel(id, items);
    reportAdd(items.length, r.added, r.skipped, PANEL_TITLES[s.type]);
  };

  // a panel that never shows a field (console, log info), or finds its own (Commands), has nothing to list
  if (!id || !s || (!shown.length && (!edit || s.type === 'commands'))) return null;

  return (
    <section
      className={`ip-sec${canTake ? ' drop-lit' : ''}${target ? ' drop-target' : ''}${min ? ' collapsed' : ''}`}
      data-testid="ip-section"
      data-panel={id ?? undefined}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          setTarget(false);
          setOver(null);
        }
      }}
      onDrop={onDrop}
    >
      <button
        className="ip-head"
        onClick={() => toggleSectionCollapsed(id)}
        aria-expanded={!min}
        title={min ? 'Show this panel\u2019s fields' : 'Minimize'}
        data-testid="ip-toggle"
      >
        <Icon name={min ? 'chevronRight' : 'chevronDown'} size={10} />
        {n > 0 && (
          <span className="pn" style={{ background: panelColorVar(n) }}>
            {n}
          </span>
        )}
        <span className="ip-title">{title}</span>
        {min && <span className="ip-count">{shown.length}</span>}
      </button>
      {!min && (
        <div className="ip-body">
          {/* fields that share a folder sit in a box under it, in the panel's order */}
          {
            <FolderGroups
              groups={groupByFolder(
                keys.map((key) => ({ key })),
                { sort: false },
              )}
              testId="ip-group"
              row={({ key }, name) => {
                const f = fields.get(key);
                return (
                  <Row
                    id={id}
                    k={key}
                    name={name}
                    s={s}
                    logs={logs}
                    unit={f?.unit}
                    kind={f ? { kind: f.kind, structName: f.structName } : undefined}
                    edit={edit}
                    over={over}
                    setOver={setOver}
                  />
                );
              }}
            />
          }
          {!keys.length && q && <div className="hint">No matches.</div>}
          {edit && !edit.single && (
            <div className="ip-add">
              <FieldList items={[]} spec={edit.spec} panel={id} onInsert={(_at, fs) => edit.insert(edit.keys.length, fs)} onRemove={() => {}} testId="ip-add" />
            </div>
          )}
          {edit?.single && !edit.keys.length && s.type !== 'commands' && (
            <div className="ip-add">
              <FieldSlot inline spec={edit.spec} value={undefined} panel={id} onPick={(_key, f) => edit.insert(0, [f])} testId="ip-slot" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function InPanels({ q }: { q: string }) {
  const areas = useStore(gridStore, (s) => s.areas);
  const order = useStore(gridStore, (s) => s.order);
  const all = useStore(sessionStore, (s) => s.logs);
  const logs = all.filter((l) => l.visible);
  if (!areas.length) return <div className="hint">No panels.</div>;
  return (
    <div className="in-panels" data-testid="in-panels">
      {areas.map((a, ai) => (
        <Section key={ai} id={a.front} n={a.front ? order.indexOf(a.front) + 1 : 0} q={q} logs={logs} all={all} />
      ))}
    </div>
  );
}
