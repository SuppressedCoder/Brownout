/**
 * Line graph: numeric series on left/right axes, discrete lanes for
 * booleans/strings, min/max decimation, mode shading, shared cursor,
 * overlay / stacked / difference comparison across logs.
 *
 * The two axes zoom independently:
 * - Time (length) follows the shared timeline. By default only the timeline
 *   bar moves time; an unlinked graph, or "Let graphs and the field move
 *   time" in settings, lets the graph pan/zoom time itself.
 * - Values (height): wheel over the plot or an axis zooms around the pointer,
 *   dragging an axis pans it, double-click returns to auto-fit, and the
 *   "Y axis" menu takes typed limits.
 *
 * The legend is a one-line strip above the plot, so it never covers data;
 * click it for the full list. In compact view the field chips collapse to a
 * count and the less-used toolbar controls move into the overflow menu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NumberInput } from '../components/NumberInput';
import { evalNumber } from '@core/mathExpr';
import { panelStore, updatePanel, type GraphSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore, setCursor, setHover, setView, zoomAround } from '../state/time';
import { settingsStore } from '../state/settings';
import { askText, toast, openSettings } from '../state/ui';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { drawTimeAxis, drawModeBands, drawCursor, niceStep, formatTick } from '../lib/draw';
import { FIELD_DASHES, withAlpha, stringColor } from '../lib/colors';
import { T } from '../lib/theme';
import { decimateMinMax, visibleIndexRange, type Decimated } from '@core/decimate';
import { indexAtOrBefore } from '@core/log';
import { formatValue } from '../lib/format';
import { fieldIndex, shortKey, useFieldIndex } from '../lib/fields';
import { formatTime } from '@core/alignment';
import { FieldPicker } from '../components/FieldPicker';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer, ToolGroup, OverflowRow, useCompact } from '../components/Toolbar';
import { MenuButton } from '../components/Menu';
import { Icon, Caret } from '../components/Icon';

type Axis = 'left' | 'right';
type Range = [number, number];

interface LaneGeom {
  y0: number;
  y1: number;
  left: Range;
  right: Range;
}
/** What the last draw laid out; the pointer handlers read it. */
interface Geom {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  hasLeft: boolean;
  hasRight: boolean;
  lanes: LaneGeom[];
  view: Range;
}

interface NumSeries {
  t: Float64Array;
  v: Float64Array;
}
interface DecCache {
  a: NumSeries;
  b?: NumSeries;
  offA: number;
  offB: number;
  t0: number;
  t1: number;
  w: number;
  series: NumSeries;
  dec: Decimated;
  min: number;
  max: number;
}
let lockHintShown = false;

/** Per-panel decimation cache, so cursor/hover redraws don't re-scan the data. */
const decCaches = new Map<string, Map<string, DecCache>>();

export function GraphPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as GraphSettings);
  const logs = useStore(sessionStore, (s) => s.logs);
  const fields = useFieldIndex();
  const geomRef = useRef<Geom>({ x0: 0, x1: 1, top: 0, bottom: 1, hasLeft: true, hasRight: false, lanes: [], view: [0, 1] });
  const [pickerOpen, setPickerOpen] = useState(false);

  const draw = useCallback((dc: DrawContext) => drawGraph(dc, id, geomRef), [id]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore], [id]);
  useGraphInteraction(ref, id, geomRef);
  useEffect(() => () => void decCaches.delete(id), [id]);

  const visibleLogs = useMemo(() => logs.filter((l) => l.visible), [logs]);
  const numericCount = settings.series.filter((s) => (fields.get(s.key)?.kind ?? 'number') === 'number').length;
  const manualY = !!settings.yLeft || !!settings.yRight;

  const addThreshold = async () => {
    const v = await askText({
      title: 'Add a threshold line',
      label: 'Value on the left axis',
      initial: settings.thresholds.length ? '' : String(sessionStore.get().brownoutThreshold),
      placeholder: 'e.g. 6.75 (math works: 12 * 0.55)',
      confirmLabel: 'Add',
      validate: (x) => (evalNumber(x) !== null ? null : 'Enter a number (or math, like 12 * 0.55)'),
    });
    if (v === null) return;
    updatePanel<GraphSettings>(id, { thresholds: [...settings.thresholds, evalNumber(v)!] });
  };

  const compact = useCompact();
  const chip = (s: GraphSettings['series'][number], i: number, full: boolean) => {
    const f = fields.get(s.key);
    const numeric = (f?.kind ?? 'number') === 'number';
    return (
      <span className={`chip${full ? ' chip-row' : ''}`} key={s.key} title={s.key}>
        <svg width="18" height="8">
          <line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={FIELD_DASHES[i % FIELD_DASHES.length].join(' ')} />
        </svg>
        <span className="chip-label">{full ? s.key : shortKey(s.key)}</span>
        {f?.unit ? <span className="unit">{f.unit}</span> : null}
        {numeric && numericCount > 0 && (
          <button
            className="chip-btn"
            title="Toggle left / right axis"
            onClick={() =>
              updatePanel<GraphSettings>(id, {
                series: settings.series.map((x) => (x.key === s.key ? { ...x, axis: x.axis === 'left' ? 'right' : 'left' } : x)),
              })
            }
          >
            {s.axis === 'left' ? 'L' : 'R'}
          </button>
        )}
        <button className="chip-btn" title="Remove" onClick={() => updatePanel<GraphSettings>(id, { series: settings.series.filter((x) => x.key !== s.key) })}>
          <Icon name="close" size={10} />
        </button>
      </span>
    );
  };
  const fieldsLabel = `${settings.series.length} field${settings.series.length === 1 ? '' : 's'}`;

  return (
    <div className="panel graph-panel">
      <Toolbar>
        <ToolButton icon="plus" title="Add a field (or drag fields from the sidebar)" onClick={() => setPickerOpen(true)}>
          Field
        </ToolButton>
        {compact && settings.series.length > 0 && (
          <MenuButton
            label={
              <>
                {fieldsLabel} <Caret />
              </>
            }
            title="The fields on this graph"
            testId="graph-fields"
          >
            {() => <div className="chip-list">{settings.series.map((s, i) => chip(s, i, true))}</div>}
          </MenuButton>
        )}
        <MenuButton
          label={
            <>
              {manualY ? 'Y: manual' : 'Y: auto'} <Caret />
            </>
          }
          className={manualY ? 'active' : ''}
          title="Value-axis limits. Wheel over the plot or an axis to zoom, drag an axis to pan, double-click for auto-fit."
        >
          {() => <YAxisForm id={id} geomRef={geomRef} />}
        </MenuButton>
        <ToolSelect
          low
          value={settings.mode}
          onChange={(v) => updatePanel<GraphSettings>(id, { mode: v as GraphSettings['mode'] })}
          options={[
            ['overlay', 'Overlay logs'],
            ['stacked', 'Stacked per log'],
            ['difference', 'Difference (A − B)'],
          ]}
          title="How several logs are compared"
        />
        <ToolSelect
          low
          value={settings.source}
          onChange={(v) => updatePanel<GraphSettings>(id, { source: v })}
          options={[['all', 'All logs'], ...visibleLogs.map((l) => [l.id, l.name] as [string, string])]}
          title="Which log(s) this graph shows"
        />
        <ToolButton
          low
          active={settings.showModes}
          onClick={() => updatePanel<GraphSettings>(id, { showModes: !settings.showModes })}
          title="Shade autonomous / teleop"
        >
          Modes
        </ToolButton>
        <ToolButton
          low
          active={settings.linked}
          onClick={() => updatePanel<GraphSettings>(id, { linked: !settings.linked, view: settings.linked ? ([...timeStore.get().view] as Range) : undefined })}
          title={
            settings.linked
              ? 'On: this graph follows the timeline. Click to give it its own time range (wheel zooms, drag pans).'
              : 'Off: this graph has its own time range. Click to follow the timeline again.'
          }
          testId="graph-linked"
        >
          Linked
        </ToolButton>
        <ToolButton low icon="plus" onClick={() => void addThreshold()} title="Add a horizontal threshold line">
          Threshold
        </ToolButton>
        {settings.thresholds.length > 0 && (
          <ToolGroup low className="chip">
            <span title="Threshold lines">{settings.thresholds.map((t) => formatTick(t)).join(', ')}</span>
            <button className="chip-btn" title="Remove threshold lines" onClick={() => updatePanel<GraphSettings>(id, { thresholds: [] })}>
              <Icon name="close" size={10} />
            </button>
          </ToolGroup>
        )}
        <ToolSpacer />
        {settings.series.length > 0 && (
          <ToolButton low onClick={() => updatePanel<GraphSettings>(id, { series: [] })} title="Remove all fields">
            Clear
          </ToolButton>
        )}
      </Toolbar>
      {!compact && settings.series.length > 0 && (
        <OverflowRow
          className="series-chips"
          compact={false}
          moreTitle="The rest of the fields on this graph"
          moreLabel={(n) => `+${n} more`}
          testId="chips-more"
        >
          {settings.series.map((s, i) => chip(s, i, false))}
        </OverflowRow>
      )}
      <div className="canvas-host">
        <canvas ref={ref} />
        {settings.series.length === 0 && (
          <div className="panel-placeholder" data-testid="graph-empty">
            {settings.note ? (
              <div className="placeholder-note">
                {settings.note}
                <span className="hint">Drag fields here, or click “Field”.</span>
              </div>
            ) : (
              'Drag fields here, or click “Field”.'
            )}
          </div>
        )}
      </div>
      {pickerOpen && (
        <FieldPicker
          onClose={() => setPickerOpen(false)}
          onPick={(key) => {
            if (!settings.series.some((x) => x.key === key)) updatePanel<GraphSettings>(id, { series: [...settings.series, { key, axis: 'left' }] });
          }}
        />
      )}
    </div>
  );
}

function YAxisForm({ id, geomRef }: { id: string; geomRef: React.MutableRefObject<Geom> }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as GraphSettings);
  const row = (axis: Axis, label: string) => {
    const key = axis === 'left' ? 'yLeft' : 'yRight';
    const manual = settings[key] ?? null;
    const shown = manual ?? geomRef.current.lanes[0]?.[axis] ?? [0, 1];
    const set = (r: Range | null) => updatePanel<GraphSettings>(id, { [key]: r } as Partial<GraphSettings>);
    const edit = (i: 0 | 1, n: number | null) => {
      if (n === null) return;
      const r: Range = [shown[0], shown[1]];
      r[i] = n;
      if (r[1] > r[0]) set(r);
    };
    return (
      <div className="yaxis-row" key={axis}>
        <span className="yaxis-name">{label}</span>
        <label title="Fit the axis to the visible data">
          <input
            type="checkbox"
            checked={!manual}
            onChange={(e) => set(e.target.checked ? null : [Number(shown[0].toPrecision(4)), Number(shown[1].toPrecision(4))])}
          />{' '}
          Auto
        </label>
        <label>
          min{' '}
          <NumberInput
            memory={`${id}:${key}.min`}
            disabled={!manual}
            value={manual ? manual[0] : Number(shown[0].toPrecision(4))}
            onCommit={(v) => edit(0, v)}
          />
        </label>
        <label>
          max{' '}
          <NumberInput
            memory={`${id}:${key}.max`}
            disabled={!manual}
            value={manual ? manual[1] : Number(shown[1].toPrecision(4))}
            onCommit={(v) => edit(1, v)}
          />
        </label>
      </div>
    );
  };
  return (
    <div className="yaxis-form">
      {row('left', 'Left axis')}
      {row('right', 'Right axis')}
      <div className="yaxis-foot">
        <span className="toolbar-note">Wheel: zoom · drag an axis: pan · double-click: auto-fit</span>
        <button
          className="btn small"
          disabled={!settings.yLeft && !settings.yRight}
          onClick={() => updatePanel<GraphSettings>(id, { yLeft: null, yRight: null })}
        >
          Reset to auto
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pointer interaction

function useGraphInteraction(ref: React.RefObject<HTMLCanvasElement | null>, id: string, geomRef: React.MutableRefObject<Geom>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    type Zone = 'plot' | 'left' | 'right' | null;
    type Drag =
      | { kind: 'axis'; axes: Axis[]; startY: number; lane: LaneGeom; base: Record<Axis, Range> }
      | { kind: 'plot'; startX: number; startY: number; view: Range; lane: LaneGeom; base: Record<Axis, Range>; moved: boolean }
      | { kind: 'select'; startT: number };
    let drag: Drag | null = null;

    const cfg = () => panelStore.get().panels[id] as GraphSettings | undefined;
    const pos = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoneAt = (x: number, y: number): Zone => {
      const g = geomRef.current;
      if (y < g.top || y > g.bottom) return null;
      if (x < g.x0) return 'left';
      if (x > g.x1) return g.hasRight ? 'right' : null;
      return 'plot';
    };
    const laneAt = (y: number): LaneGeom | undefined => {
      const g = geomRef.current;
      return g.lanes.find((l) => y >= l.y0 && y <= l.y1) ?? g.lanes[0];
    };
    const tOf = (x: number) => {
      const g = geomRef.current;
      return g.view[0] + ((x - g.x0) / (g.x1 - g.x0)) * (g.view[1] - g.view[0]);
    };
    /** Can this graph move time? Its own range when unlinked; the shared one only if the setting allows. */
    const timeMode = (): 'local' | 'shared' | 'locked' => {
      const s = cfg();
      if (s && !s.linked) return 'local';
      return settingsStore.get().panelsMoveTime ? 'shared' : 'locked';
    };
    const applyView = (v: Range) => {
      if (timeMode() === 'local') {
        if (v[1] - v[0] > 0.01) updatePanel<GraphSettings>(id, { view: v });
      } else setView(v[0], v[1]);
    };
    const setRanges = (r: Partial<Record<Axis, Range>>) => {
      const patch: Partial<GraphSettings> = {};
      if (r.left && r.left[1] > r.left[0]) patch.yLeft = r.left;
      if (r.right && r.right[1] > r.right[0]) patch.yRight = r.right;
      updatePanel<GraphSettings>(id, patch);
    };
    const zoomY = (axes: Axis[], factor: number, y: number) => {
      const lane = laneAt(y);
      if (!lane) return;
      const frac = Math.min(1, Math.max(0, (lane.y1 - y) / (lane.y1 - lane.y0)));
      const out: Partial<Record<Axis, Range>> = {};
      for (const axis of axes) {
        const [a, b] = lane[axis];
        const v = a + frac * (b - a);
        out[axis] = [v - (v - a) * factor, v + (b - v) * factor];
      }
      setRanges(out);
    };
    const usedAxes = (): Axis[] => {
      const g = geomRef.current;
      const a: Axis[] = [];
      if (g.hasLeft) a.push('left');
      if (g.hasRight) a.push('right');
      return a;
    };

    const onWheel = (e: WheelEvent) => {
      const { x, y } = pos(e);
      const zone = zoneAt(x, y);
      if (!zone) return;
      e.preventDefault();
      const factor = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.18 * Math.min(3, Math.abs(e.deltaY) / 50 + 0.5));
      if (zone !== 'plot') {
        zoomY([zone], factor, y);
        return;
      }
      const tm = timeMode();
      if (tm === 'locked' || e.ctrlKey || e.metaKey) {
        zoomY(usedAxes(), factor, y);
        return;
      }
      const g = geomRef.current;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = ((e.deltaX || e.deltaY) / (g.x1 - g.x0)) * (g.view[1] - g.view[0]);
        applyView([g.view[0] + dt, g.view[1] + dt]);
        return;
      }
      const t = tOf(x);
      if (tm === 'local') applyView([t - (t - g.view[0]) * factor, t + (g.view[1] - t) * factor]);
      else zoomAround(t, factor);
    };
    const onDown = (e: PointerEvent) => {
      // the legend strip above the plot opens / closes the full legend
      if (e.button === 0 && pos(e).y < geomRef.current.top) {
        const cur = cfg();
        if (cur?.series.length) updatePanel<GraphSettings>(id, { legendOpen: !cur.legendOpen });
        return;
      }
      if (e.button !== 0) return;
      const { x, y } = pos(e);
      const zone = zoneAt(x, y);
      const lane = laneAt(y);
      if (!zone || !lane) return;
      el.setPointerCapture(e.pointerId);
      const base = { left: [...lane.left] as Range, right: [...lane.right] as Range };
      if (zone !== 'plot') drag = { kind: 'axis', axes: [zone], startY: y, lane, base };
      else if (e.shiftKey) drag = { kind: 'select', startT: tOf(x) };
      else drag = { kind: 'plot', startX: x, startY: y, view: [...geomRef.current.view] as Range, lane, base, moved: false };
    };
    const panY = (axes: Axis[], d: Extract<Drag, { lane: LaneGeom }>, y: number) => {
      const h = d.lane.y1 - d.lane.y0;
      const out: Partial<Record<Axis, Range>> = {};
      for (const axis of axes) {
        const [a, b] = d.base[axis];
        const dv = ((y - d.startY) / h) * (b - a);
        out[axis] = [a + dv, b + dv];
      }
      setRanges(out);
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = pos(e);
      if (!drag) {
        const zone = zoneAt(x, y);
        el.style.cursor = zone === 'left' || zone === 'right' ? 'ns-resize' : 'crosshair';
        setHover(zone === 'plot' ? tOf(x) : null);
        return;
      }
      if (drag.kind === 'axis') panY(drag.axes, drag, y);
      else if (drag.kind === 'select') {
        const t = tOf(x);
        timeStore.set({ selection: [Math.min(drag.startT, t), Math.max(drag.startT, t)] });
      } else {
        if (Math.abs(x - drag.startX) > 3 || Math.abs(y - drag.startY) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (timeMode() !== 'locked') {
          const g = geomRef.current;
          const dt = ((x - drag.startX) / (g.x1 - g.x0)) * (drag.view[1] - drag.view[0]);
          applyView([drag.view[0] - dt, drag.view[1] - dt]);
        }
        // vertical drag pans only axes that are already manual, so auto-fit isn't lost by accident
        const s = cfg();
        const manual = usedAxes().filter((a) => (a === 'left' ? s?.yLeft : s?.yRight));
        if (manual.length) panY(manual, drag, y);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind !== 'plot' || d.moved) return;
      if (settingsStore.get().panelsMoveTime) setCursor(tOf(pos(e).x));
      else if (!lockHintShown) {
        // say once why clicking a graph did nothing
        lockHintShown = true;
        toast(
          'Time is set from the timeline bar at the bottom. On a graph, the wheel zooms the value axis.',
          'info',
          [{ label: 'Change in Settings', run: () => openSettings('general') }],
          9000,
        );
      }
    };
    const onLeave = () => setHover(null);
    const onDbl = (e: MouseEvent) => {
      const { x, y } = pos(e);
      if (!zoneAt(x, y)) return;
      const patch: Partial<GraphSettings> = { yLeft: null, yRight: null };
      if (cfg() && !cfg()!.linked) patch.view = [...timeStore.get().view] as Range;
      updatePanel<GraphSettings>(id, patch);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, id]);
}

// ---------------------------------------------------------------------------
// Drawing

const LEFT = 56;
const RIGHT = 56;
const TOP = 8;
const BOTTOM = 20;
const LANE_H = 16;
/** Height of the one-line legend strip above the plot. */
const STRIP_H = 17;

interface Item {
  key: string;
  axis: Axis;
  idx: number;
  log: LogEntry;
  /** Offset to add to series times to get aligned time (0 for difference series). */
  offset: number;
  c: DecCache;
}

function drawGraph(dc: DrawContext, id: string, geomRef: React.MutableRefObject<Geom>) {
  const { ctx, width, height, potato } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as GraphSettings | undefined;
  if (!settings) return;
  const session = sessionStore.get();
  const time = timeStore.get();
  const [t0, t1] = settings.linked ? time.view : (settings.view ?? time.view);
  const fields = fieldIndex(session.logs);
  let logs = session.logs.filter((l) => l.visible);
  if (settings.source !== 'all') logs = logs.filter((l) => l.id === settings.source);

  const numeric = settings.series.filter((s) => (fields.get(s.key)?.kind ?? 'number') === 'number');
  const discrete = settings.series.filter((s) => {
    const k = fields.get(s.key)?.kind;
    return k === 'boolean' || k === 'string';
  });
  const hasRight = numeric.some((s) => s.axis === 'right');
  const hasLeft = numeric.some((s) => s.axis === 'left') || settings.thresholds.length > 0 || !hasRight;
  const x0 = LEFT;
  const x1 = width - (hasRight ? RIGHT : 12);
  const laneCount = discrete.length * Math.max(1, logs.length);
  const lanesH = laneCount * LANE_H;
  const plotTop = TOP + (settings.series.length ? STRIP_H : 0);
  const plotBottom = Math.max(plotTop + 20, height - BOTTOM - lanesH - (laneCount ? 4 : 0));
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  const decW = potato ? (x1 - x0) / 2 : x1 - x0;

  let cache = decCaches.get(id);
  if (!cache) {
    cache = new Map();
    decCaches.set(id, cache);
  }
  const used = new Set<string>();
  /** Decimated data for one series (or A − B), recomputed only when its inputs change. */
  const decimated = (ck: string, a: NumSeries, offA: number, b?: NumSeries, offB = 0): DecCache => {
    used.add(ck);
    const c = cache!.get(ck);
    if (c && c.a === a && c.b === b && c.offA === offA && c.offB === offB && c.t0 === t0 && c.t1 === t1 && c.w === decW) return c;
    const series = b ? differenceSeries(a, offA, b, offB, t0, t1) : a;
    const dec = decimateMinMax(series.t, series.v, b ? 0 : offA, t0, t1, decW);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < dec.n; i++) {
      const y = dec.y[i];
      if (!Number.isFinite(y)) continue;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const n: DecCache = { a, b, offA, offB, t0, t1, w: decW, series, dec, min, max };
    cache!.set(ck, n);
    return n;
  };

  // Background
  ctx.fillStyle = pal.plotBg;
  ctx.fillRect(x0, plotTop, x1 - x0, height - BOTTOM - plotTop);

  // Selection
  if (time.selection) {
    ctx.fillStyle = pal.selection;
    const sa = Math.max(x0, xOf(time.selection[0]));
    const sb = Math.min(x1, xOf(time.selection[1]));
    if (sb > sa) ctx.fillRect(sa, plotTop, sb - sa, height - BOTTOM - plotTop);
  }

  const stacked = settings.mode === 'stacked' && logs.length > 1;
  const laneRects: { log: LogEntry; y0: number; y1: number }[] = [];
  if (stacked) {
    const h = (plotBottom - plotTop) / logs.length;
    logs.forEach((l, i) => laneRects.push({ log: l, y0: plotTop + i * h, y1: plotTop + (i + 1) * h - 2 }));
  } else if (logs.length) laneRects.push({ log: logs[0], y0: plotTop, y1: plotBottom });

  if (settings.showModes) {
    if (stacked) for (const ln of laneRects) drawModeBands(ctx, ln.log, x0, x1, ln.y0, ln.y1, t0, t1);
    else if (logs[0]) drawModeBands(ctx, logs[0], x0, x1, plotTop, plotBottom, t0, t1);
  }

  const legend: { color: string; dash: number[]; label: string; value: string }[] = [];
  const readoutT = time.hover ?? time.cursor;
  const geomLanes: LaneGeom[] = [];

  const drawNumeric = (laneLogs: LogEntry[], clipTop: number, clipBottom: number) => {
    const items: Item[] = [];
    const diff = settings.mode === 'difference' && laneLogs.length >= 2;
    numeric.forEach((s, idx) => {
      if (diff) {
        const A = client.peekSeries(laneLogs[0].id, s.key);
        const B = client.peekSeries(laneLogs[1].id, s.key);
        if (!A || !B || A.kind !== 'number' || B.kind !== 'number') return;
        items.push({ key: s.key, axis: s.axis, idx, log: laneLogs[0], offset: 0, c: decimated(`diff|${s.key}`, A, laneLogs[0].offset, B, laneLogs[1].offset) });
        return;
      }
      for (const log of laneLogs) {
        const series = client.peekSeries(log.id, s.key);
        if (!series || series.kind !== 'number') continue;
        items.push({ key: s.key, axis: s.axis, idx, log, offset: log.offset, c: decimated(`${log.id}|${s.key}`, series, log.offset) });
      }
    });

    // Value ranges: manual limits, or auto-fit to the visible data (plus thresholds)
    const range: Record<Axis, Range> = { left: [Infinity, -Infinity], right: [Infinity, -Infinity] };
    for (const it of items) {
      if (it.c.min < range[it.axis][0]) range[it.axis][0] = it.c.min;
      if (it.c.max > range[it.axis][1]) range[it.axis][1] = it.c.max;
    }
    for (const th of settings.thresholds) {
      if (th < range.left[0]) range.left[0] = th;
      if (th > range.left[1]) range.left[1] = th;
    }
    for (const axis of ['left', 'right'] as const) {
      const manual = axis === 'left' ? settings.yLeft : settings.yRight;
      if (manual && manual[1] > manual[0]) {
        range[axis] = [manual[0], manual[1]];
        continue;
      }
      const r = range[axis];
      if (!Number.isFinite(r[0])) {
        r[0] = 0;
        r[1] = 1;
      }
      if (r[1] - r[0] < 1e-9) {
        r[0] -= 1;
        r[1] += 1;
      }
      const pad = (r[1] - r[0]) * 0.06;
      r[0] -= pad;
      r[1] += pad;
    }
    geomLanes.push({ y0: clipTop, y1: clipBottom, left: range.left, right: range.right });
    const yOf = (v: number, axis: Axis) => clipBottom - ((v - range[axis][0]) / (range[axis][1] - range[axis][0])) * (clipBottom - clipTop);

    // Grid + axes
    ctx.save();
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const drawAxis = (axis: Axis) => {
      const r = range[axis];
      const step = niceStep(r[1] - r[0], Math.max(2, (clipBottom - clipTop) / 34));
      const manual = axis === 'left' ? settings.yLeft : settings.yRight;
      ctx.fillStyle = manual ? pal.accent : pal.fg2;
      ctx.textAlign = axis === 'left' ? 'right' : 'left';
      for (let k = Math.ceil(r[0] / step); k * step <= r[1]; k++) {
        const v = k * step;
        const y = yOf(v, axis);
        if (axis === 'left' || !hasLeft) {
          ctx.strokeStyle = pal.grid;
          ctx.beginPath();
          ctx.moveTo(x0, Math.round(y) + 0.5);
          ctx.lineTo(x1, Math.round(y) + 0.5);
          ctx.stroke();
        }
        if (axis === 'left') ctx.fillText(formatTick(v), x0 - 6, y);
        else ctx.fillText(formatTick(v), x1 + 6, y);
      }
    };
    if (hasLeft) drawAxis('left');
    if (hasRight) drawAxis('right');
    ctx.restore();

    // Thresholds
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, clipTop, x1 - x0, clipBottom - clipTop);
    ctx.clip();
    for (const th of settings.thresholds) {
      const y = yOf(th, 'left');
      ctx.strokeStyle = pal.err;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.err;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatTick(th), x0 + 4, y - 2);
    }

    // Series
    for (const it of items) {
      const color = diff ? pal.strong : it.log.color;
      const dash = FIELD_DASHES[it.idx % FIELD_DASHES.length];
      const dec = it.c.dec;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      let lastY = 0;
      for (let i = 0; i < dec.n; i++) {
        const y = dec.y[i];
        if (!Number.isFinite(y)) {
          started = false;
          continue;
        }
        const px = xOf(dec.x[i]);
        const py = yOf(y, it.axis);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, lastY); // step (sample-and-hold)
          ctx.lineTo(px, py);
        }
        lastY = py;
      }
      if (started) ctx.lineTo(x1, lastY);
      ctx.stroke();
      // legend entry
      const f = fields.get(it.key);
      let value = '';
      if (readoutT !== null) {
        const i = indexAtOrBefore(it.c.series.t, readoutT - it.offset);
        value = i >= 0 ? formatValue(it.c.series.v[i], f?.unit) : '';
      }
      legend.push({
        color,
        dash,
        label: diff ? `${shortKey(it.key)} (${laneLogs[0].name} − ${laneLogs[1].name})` : (laneLogs.length > 1 ? `${it.log.name} · ` : '') + shortKey(it.key),
        value,
      });
    }
    ctx.restore();
  };

  if (stacked) {
    for (const ln of laneRects) {
      drawNumeric([ln.log], ln.y0 + 2, ln.y1 - 2);
      ctx.fillStyle = ln.log.color;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(ln.log.name, x1 - 4, ln.y0 + 3);
      ctx.strokeStyle = pal.line;
      ctx.beginPath();
      ctx.moveTo(x0, ln.y1 + 1);
      ctx.lineTo(x1, ln.y1 + 1);
      ctx.stroke();
    }
  } else if (laneRects.length) drawNumeric(logs, plotTop, plotBottom);
  else geomLanes.push({ y0: plotTop, y1: plotBottom, left: [0, 1], right: [0, 1] });

  // forget cached decimations for series that are no longer drawn
  for (const k of cache.keys()) if (!used.has(k)) cache.delete(k);

  geomRef.current = { x0, x1, top: plotTop, bottom: height - BOTTOM, hasLeft, hasRight, lanes: geomLanes, view: [t0, t1] };

  // Discrete lanes
  let laneY = plotBottom + 4;
  for (const s of discrete) {
    for (const log of logs) {
      const series = client.peekSeries(log.id, s.key);
      ctx.fillStyle = pal.rowBg;
      ctx.fillRect(x0, laneY, x1 - x0, LANE_H - 2);
      if (series && (series.kind === 'boolean' || series.kind === 'string')) {
        const [i0, i1] = visibleIndexRange(series.t, log.offset, t0, t1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, laneY, x1 - x0, LANE_H - 2);
        ctx.clip();
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        let lastEnd = -Infinity;
        for (let i = i0; i <= i1; i++) {
          const a = xOf(series.t[i] + log.offset);
          const b = i + 1 < series.t.length ? xOf(series.t[i + 1] + log.offset) : x1;
          if (b < lastEnd + 0.5) continue; // sub-pixel segment already covered
          lastEnd = b;
          const v = series.v[i];
          if (series.kind === 'boolean') {
            if (!v) continue;
            ctx.fillStyle = withAlpha(log.color, 0.7);
            ctx.fillRect(a, laneY, Math.max(1, b - a), LANE_H - 2);
          } else {
            const sv = String(v);
            if (!sv) continue;
            ctx.fillStyle = stringColor(sv);
            ctx.fillRect(a, laneY, Math.max(1, b - a), LANE_H - 2);
            if (b - a > 24) {
              ctx.fillStyle = '#111';
              ctx.fillText(sv.slice(0, Math.floor((b - a) / 6)), Math.max(a, x0) + 3, laneY + LANE_H / 2 - 1);
            }
          }
        }
        ctx.restore();
        let value = '';
        if (readoutT !== null) {
          const i = indexAtOrBefore(series.t, readoutT - log.offset);
          value = i >= 0 ? formatValue(series.kind === 'boolean' ? !!series.v[i] : series.v[i]) : '';
        }
        legend.push({ color: log.color, dash: [], label: (logs.length > 1 ? `${log.name} · ` : '') + shortKey(s.key), value });
      }
      ctx.fillStyle = logs.length > 1 ? log.color : pal.fg2;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(shortKey(s.key, 1).slice(0, 9), x0 - 4, laneY + LANE_H / 2 - 1);
      laneY += LANE_H;
    }
  }

  // Time axis
  drawTimeAxis(ctx, x0, x1, height - BOTTOM, t0, t1, plotTop);

  // Cursor / hover
  if (time.cursor !== null && time.cursor >= t0 && time.cursor <= t1) drawCursor(ctx, xOf(time.cursor), plotTop, height - BOTTOM, pal.cursor);
  if (time.hover !== null && time.hover >= t0 && time.hover <= t1) drawCursor(ctx, xOf(time.hover), plotTop, height - BOTTOM, pal.hoverCursor, true);
  const showDelta = time.cursor !== null && time.hover !== null;
  if (showDelta) {
    ctx.fillStyle = pal.fg;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const dt = time.hover! - time.cursor!;
    const mx = Math.min(x1 - 40, Math.max(x0 + 40, (xOf(time.cursor!) + xOf(time.hover!)) / 2));
    ctx.fillText(`Δ ${dt >= 0 ? '+' : ''}${dt.toFixed(3)} s`, mx, plotTop + 2);
  }

  // Legend: one line above the plot (never over the data). Click it for the full list.
  if (legend.length) {
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const sy = TOP + STRIP_H / 2 - 2;
    const right = x1;
    let lx = x0;
    let shown = 0;
    for (const l of legend) {
      const text = l.value ? `${l.label}  ${l.value}` : l.label;
      const w = 22 + ctx.measureText(text).width + 14;
      const reserve = shown < legend.length - 1 ? 46 : 0;
      if (lx + w > right - reserve && shown > 0) break;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(l.dash);
      ctx.beginPath();
      ctx.moveTo(lx, sy);
      ctx.lineTo(lx + 16, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.fg2;
      const maxW = right - reserve - lx - 22;
      ctx.fillText(l.label, lx + 22, sy, Math.max(20, maxW));
      if (l.value) {
        ctx.fillStyle = pal.strong;
        ctx.fillText(l.value, lx + 22 + ctx.measureText(`${l.label}  `).width, sy);
      }
      lx += w;
      shown++;
    }
    if (shown < legend.length) {
      ctx.fillStyle = pal.accent;
      ctx.textAlign = 'right';
      ctx.fillText(`+${legend.length - shown} more`, right, sy);
      ctx.textAlign = 'left';
    }
    // Full list, opened by clicking the strip
    if (settings.legendOpen) {
      const MAX_LEGEND = potato ? 8 : 16;
      const rows = legend.slice();
      if (rows.length > MAX_LEGEND) {
        const extra = rows.length - MAX_LEGEND + 1;
        rows.splice(MAX_LEGEND - 1, extra, { color: pal.fg2, dash: [], label: `and ${extra} more`, value: '' });
      }
      const rowH = 15;
      const w = Math.min(x1 - x0 - 12, 44 + Math.max(...rows.map((l) => ctx.measureText(`${l.label}  ${l.value}`).width)));
      const h = rows.length * rowH + 6;
      const bx = x0 + 6;
      const by = plotTop + 4;
      ctx.fillStyle = pal.legendBg;
      ctx.fillRect(bx, by, w, h);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      rows.forEach((l, i) => {
        const y = by + 3 + i * rowH + rowH / 2;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(l.dash);
        ctx.beginPath();
        ctx.moveTo(bx + 6, y);
        ctx.lineTo(bx + 26, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pal.fg;
        ctx.fillText(l.label, bx + 32, y);
        if (l.value) {
          ctx.textAlign = 'right';
          ctx.fillStyle = pal.strong;
          ctx.fillText(l.value, bx + w - 6, y);
          ctx.textAlign = 'left';
        }
      });
    }
    ctx.restore();
  }

  // Note for graphs with their own time range
  if (!settings.linked) {
    ctx.fillStyle = pal.warn;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`own range · ${formatTime(t0)} to ${formatTime(t1)}`, x1 - 4, plotTop + 2);
  }
}

/** A − B after resampling both with the previous value, over the union of sample times in [t0,t1]. */
function differenceSeries(A: NumSeries, offA: number, B: NumSeries, offB: number, t0: number, t1: number): NumSeries {
  const [a0, a1] = visibleIndexRange(A.t, offA, t0, t1);
  const [b0, b1] = visibleIndexRange(B.t, offB, t0, t1);
  const times: number[] = [];
  for (let i = a0; i <= a1; i++) times.push(A.t[i] + offA);
  for (let i = b0; i <= b1; i++) times.push(B.t[i] + offB);
  times.sort((x, y) => x - y);
  const t = new Float64Array(times.length);
  const v = new Float64Array(times.length);
  let ia = a0 - 1;
  let ib = b0 - 1;
  for (let k = 0; k < times.length; k++) {
    const tt = times[k];
    while (ia + 1 < A.t.length && A.t[ia + 1] + offA <= tt) ia++;
    while (ib + 1 < B.t.length && B.t[ib + 1] + offB <= tt) ib++;
    t[k] = tt;
    v[k] = ia >= 0 && ib >= 0 ? A.v[ia] - B.v[ib] : NaN;
  }
  return { t, v };
}
