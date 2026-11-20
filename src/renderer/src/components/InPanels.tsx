/**
 * "In panels": the field list as a preview of what the panels show. One
 * section per area of the grid, for the panel in front there (switch a tab
 * and its section follows), each scrolling on its own. A row is a field the
 * panel shows, drawn the way the panel draws it (a graph's line and axis,
 * the 2D field's robot or camera), with its value at the cursor for every
 * log in the log's color. A field in two panels is in both sections; the
 * pointer on one lights the others.
 *
 * Values are written straight into their spans when the cursor moves, so
 * moving it re-renders nothing (AGENTS rule 13).
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { panelStore, PANEL_TITLES, type PanelSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore } from '../state/time';
import { gridStore, linkStore, pointAtField, panelColorVar, shownKeys } from '../lib/panelLinks';
import { useFieldIndex, keyMatchesSearch } from '../lib/fields';
import { camerasFor } from '../lib/vision';
import { client } from '../worker/client';
import { indexAtOrBefore } from '@core/log';
import { formatValue } from '../lib/format';
import { grid } from './Grid';
import { KeyText } from './FieldSlot';
import { LineSwatch } from './FieldStrip';

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

/** How the panel draws a field: a graph's line and axis, the 2D field's robot or camera, or nothing. */
function Swatch({ s, k, logs }: { s: PanelSettings; k: string; logs: LogEntry[] }) {
  if (s.type === 'graph') {
    const i = s.series.findIndex((x) => x.key === k);
    if (i < 0) return null;
    return (
      <span className="ip-style">
        <LineSwatch index={i} />
        <span className="ip-axis">{s.series[i].axis === 'left' ? 'L' : 'R'}</span>
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

function Row({ k, s, logs, unit }: { k: string; s: PanelSettings; logs: LogEntry[]; unit?: string }) {
  const linked = useStore(linkStore, (x) => x.key === k);
  return (
    <div
      className={`ip-row${linked ? ' linked' : ''}`}
      onMouseEnter={() => pointAtField(k)}
      onMouseLeave={() => pointAtField(null)}
      data-key={k}
      data-testid="ip-row"
    >
      <div className="ip-key" title={k}>
        <Swatch s={s} k={k} logs={logs} />
        <KeyText k={k} />
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

export function InPanels({ q }: { q: string }) {
  const areas = useStore(gridStore, (s) => s.areas);
  const order = useStore(gridStore, (s) => s.order);
  const panels = useStore(panelStore, (s) => s.panels);
  const all = useStore(sessionStore, (s) => s.logs);
  const logs = all.filter((l) => l.visible);
  const fields = useFieldIndex();
  if (!areas.length) return <div className="hint">No panels.</div>;
  return (
    <div className="in-panels" data-testid="in-panels">
      {areas.map((a, ai) => {
        const id = a.front;
        const s = id ? panels[id] : undefined;
        const n = id ? order.indexOf(id) + 1 : 0;
        const keys = s ? shownKeys(s, all).filter((k) => keyMatchesSearch(k, q)) : [];
        const title = (id && grid.api?.getPanel(id)?.title) || (s ? PANEL_TITLES[s.type] : '');
        return (
          <section className="ip-sec" key={ai} data-testid="ip-section">
            <div className="ip-head">
              {n > 0 && (
                <span className="pn" style={{ background: panelColorVar(n) }}>
                  {n}
                </span>
              )}
              <span className="ip-title">{title}</span>
            </div>
            <div className="ip-body">
              {s && keys.map((k) => <Row key={k} k={k} s={s} logs={logs} unit={fields.get(k)?.unit} />)}
              {s && !keys.length && <div className="hint">{q ? 'No matches.' : 'No fields.'}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
