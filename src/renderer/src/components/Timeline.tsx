/**
 * The global timeline: transport bar (playback, go-to-time, zoom), overview
 * strip with a draggable window, one mode lane per log (Alt-drag a lane to
 * nudge that log's alignment), event markers, a battery strip, user tracks
 * and bookmarks. Drag the top edge to resize; the button cycles
 * compact / standard / expanded.
 *
 * This is the one place that moves time: click sets the cursor, drag pans,
 * the wheel zooms. The visible range is clamped to the session, so the
 * overview window can't leave the strip.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionStore, sessionExtent, nudgeLog, removeBookmark, removeTimelineTrack, type LogEntry, type SessionState } from '../state/session';
import {
  timeStore,
  setCursor,
  setHover,
  setView,
  zoomTo,
  zoomAround,
  zoomBy,
  setSpan,
  gotoTime,
  setPlaying,
  stepCursor,
  jumpPhase,
  type TimeFormat,
} from '../state/time';
import { settingsStore } from '../state/settings';
import { uiStore } from '../state/ui';
import { useStore } from '../state/store';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { drawModeBands, drawTimeAxis, drawCursor } from '../lib/draw';
import { EVENT_GLYPHS, MODE_LABEL, withAlpha, stringColor } from '../lib/colors';
import { T, modeSolid, toneColor } from '../lib/theme';
import { client } from '../worker/client';
import { visibleIndexRange } from '@core/decimate';
import { formatTime, parseTimeInput, parseSpanInput, formatSpan } from '@core/alignment';
import { formatTimeFor, matchTimeLabel } from '../lib/format';
import { fieldIndex, shortKey } from '../lib/fields';
import { indexAtOrBefore } from '@core/log';
import { ToolButton, ToolSelect, ToolSpacer, ToolGroup, OverflowRow, useCompactWidth } from './Toolbar';
import { Caret } from './Icon';
import { drawIcon } from '../lib/icons';
import { MenuButton, MenuItem } from './Menu';
import { bookmarkAtCursor, cycleTimeline } from '../lib/actions';
import { keyHint } from '../lib/keybinds';

const LABEL_W = 110;
const OVERVIEW_H = 18;
const LANE_H = 14;
const AXIS_H = 16;
const MIN_H = OVERVIEW_H + AXIS_H + 8;

interface Row {
  kind: 'mode' | 'events' | 'battery' | 'track' | 'bookmarks';
  y: number;
  h: number;
  log?: LogEntry;
  key?: string;
  label: string;
}

interface Layout {
  x0: number;
  x1: number;
  rows: Row[];
}

/** A track's label: the camera's name for a tags-seen track, else the last two parts of the key. */
function trackLabel(key: string): string {
  const cam = /^\/Brownout\/Vision\/(.+)\/TagsSeen$/.exec(key);
  return cam ? `${cam[1]} tags` : shortKey(key, 2);
}

export function Timeline() {
  const mode = useStore(sessionStore, (s) => s.timelineMode);
  const custom = useStore(sessionStore, (s) => s.timelineHeight);
  const rowsH = useStore(sessionStore, (s) => rowsHeight(s));
  const layoutRef = useRef<Layout>({ x0: LABEL_W, x1: 100, rows: [] });
  const draw = useCallback((dc: DrawContext) => drawTimeline(dc, layoutRef), []);
  const ref = useCanvas(draw, [timeStore, sessionStore], []);
  useTimelineInteraction(ref, layoutRef);

  const natural = OVERVIEW_H + 4 + rowsH + AXIS_H + 4;
  const cap = mode === 'compact' ? 110 : mode === 'standard' ? 210 : Math.floor(window.innerHeight * 0.45);
  const auto = Math.max(mode === 'compact' ? MIN_H : 60, Math.min(natural, cap));
  const height = custom ?? auto;

  // Drag the top edge to any height
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const h = Math.round(Math.min(window.innerHeight * 0.7, Math.max(MIN_H, startH + (startY - ev.clientY))));
      sessionStore.set({ timelineHeight: h });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className={`timeline ${mode}`}>
      <div
        className="timeline-resizer"
        onPointerDown={onResizeDown}
        onDoubleClick={() => sessionStore.set({ timelineHeight: null })}
        title="Drag to resize the timeline · double-click for automatic height"
      />
      <Transport />
      <div className="canvas-host" style={{ height }} data-testid="timeline-canvas">
        <canvas ref={ref} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transport bar

function Transport() {
  const playing = useStore(timeStore, (s) => s.playing);
  const speed = useStore(timeStore, (s) => s.speed);
  const fmt = useStore(timeStore, (s) => s.timeFormat);
  const loop = useStore(timeStore, (s) => s.loop);
  const mode = useStore(sessionStore, (s) => s.timelineMode);
  const hasSel = useStore(timeStore, (s) => s.selection !== null);
  useStore(settingsStore, (s) => s.keybinds);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(ref, 1080);
  return (
    <div className="transport" ref={ref}>
      <OverflowRow compact={compact} moreTitle="More timeline controls" testId="transport-more">
        <ToolButton low icon="skipBack" text="Back 1 s" onClick={() => stepCursor(-1)} title={`Back 1 s (${keyHint('jumpBack')})`} />
        <ToolButton
          icon={playing ? 'pause' : 'play'}
          text={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying(!playing)}
          title={`Play / pause (${keyHint('play')})`}
          active={playing}
          testId="play-btn"
        />
        <ToolButton low icon="skipForward" text="Forward 1 s" onClick={() => stepCursor(1)} title={`Forward 1 s (${keyHint('jumpForward')})`} />
        <ToolSelect
          low
          value={String(speed)}
          onChange={(v) => timeStore.set({ speed: Number(v) })}
          options={[
            ['0.25', '0.25×'],
            ['0.5', '0.5×'],
            ['1', '1×'],
            ['2', '2×'],
            ['4', '4×'],
          ]}
          title="Playback speed"
        />
        <ToolButton
          low
          icon="refresh"
          text="Loop over the selection"
          active={loop}
          onClick={() => timeStore.set({ loop: !loop })}
          title="Loop playback over the selection"
        />
        <ToolGroup>
          <TimeBox compact={compact} />
        </ToolGroup>
        <ToolSelect
          low
          value={fmt}
          onChange={(v) => timeStore.set({ timeFormat: v as TimeFormat })}
          options={[
            ['relative', 'Aligned time'],
            ['match', 'Match time'],
            ['raw', 'Raw log time'],
            ['clock', 'Wall clock'],
          ]}
          title="How the time readout is shown"
        />
        <ToolSpacer />
        <ToolGroup>
          <ZoomBox />
        </ToolGroup>
        <ToolButton onClick={() => zoomTo('full')} title={`Zoom to the full log (${keyHint('zoomFull')})`}>
          Full
        </ToolButton>
        <ToolButton low onClick={() => zoomTo('auto')} title={`Zoom to autonomous (${keyHint('zoomAuto')})`}>
          Auto
        </ToolButton>
        <ToolButton low onClick={() => zoomTo('teleop')} title={`Zoom to teleop (${keyHint('zoomTeleop')})`}>
          Teleop
        </ToolButton>
        <MenuButton
          low
          label={
            <>
              More <Caret />
            </>
          }
          testId="zoom-menu"
          align="right"
          title="Other phases and fixed spans"
        >
          {(close) => (
            <>
              <MenuItem label="Enabled" hint={keyHint('zoomEnabled')} onClick={() => (close(), zoomTo('enabled'))} />
              <MenuItem label="Endgame (last 20 s)" onClick={() => (close(), zoomTo('endgame'))} />
              <MenuItem label="Selection" hint={keyHint('zoomSelection')} disabled={!hasSel} onClick={() => (close(), zoomTo('selection'))} />
              <div className="menu-sep" />
              {SPAN_PICKS.map(([s, label]) => (
                <MenuItem key={s} label={label} onClick={() => (close(), setSpan(s))} />
              ))}
            </>
          )}
        </MenuButton>
        <ToolButton
          low
          icon="phasePrev"
          text="Previous mode change"
          onClick={() => jumpPhase(-1)}
          title={`Previous robot-mode change (${keyHint('prevPhase')})`}
        />
        <ToolButton low icon="phaseNext" text="Next mode change" onClick={() => jumpPhase(1)} title={`Next robot-mode change (${keyHint('nextPhase')})`} />
        <ToolButton icon="bookmark" text="Bookmark" onClick={() => void bookmarkAtCursor()} title={`Bookmark at the cursor (${keyHint('bookmark')})`} />
        <ToolButton
          low
          icon={mode === 'compact' ? 'heightCompact' : mode === 'standard' ? 'heightStandard' : 'heightExpanded'}
          text={`Timeline height: ${mode}`}
          onClick={cycleTimeline}
          title={`Timeline height: ${mode} · click to cycle (${keyHint('cycleTimeline')}) · or drag the top edge`}
        />
      </OverflowRow>
    </div>
  );
}

/** The time readout. Click it (or press the go-to key) to type a time to jump to. */
function TimeBox({ compact }: { compact: boolean }) {
  const cursor = useStore(timeStore, (s) => s.cursor);
  const hover = useStore(timeStore, (s) => s.hover);
  const selection = useStore(timeStore, (s) => s.selection);
  const fmt = useStore(timeStore, (s) => s.timeFormat);
  const primary = useStore(sessionStore, (s) => s.logs[0]);
  const gotoEpoch = useStore(uiStore, (s) => s.gotoEpoch);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seenEpoch = useRef(gotoEpoch);

  const begin = useCallback(() => {
    const c = timeStore.get().cursor;
    setText(c === null ? '' : formatTime(c).replace(/^\+/, ''));
    setBad(false);
    setEditing(true);
  }, []);
  useEffect(() => {
    if (gotoEpoch !== seenEpoch.current) {
      seenEpoch.current = gotoEpoch;
      begin();
    }
  }, [gotoEpoch, begin]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <form
        className="goto-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = parseTimeInput(text);
          if (t === null) {
            setBad(true);
            return;
          }
          gotoTime(t);
          setEditing(false);
        }}
      >
        <span className="mono">t =</span>
        <input
          ref={inputRef}
          className={`tool-input goto-input${bad ? ' bad' : ''}`}
          data-testid="goto-input"
          value={text}
          placeholder="1:23.4 or 83.4"
          title="Aligned time: m:ss.s or seconds (a leading − is before t = 0). Enter to go, Esc to cancel."
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </form>
    );
  }
  const t = hover ?? cursor;
  return (
    <span className="readout mono">
      <button className="goto-btn mono" data-testid="goto-btn" onClick={begin} title={`Click to type a time to jump to (${keyHint('gotoTime')})`}>
        {t === null ? 't = —' : `t = ${formatTimeFor(t, fmt, primary)}`}
      </button>
      {primary && t !== null && fmt !== 'match' ? <span className="match-time"> {matchTimeLabel(t, primary)}</span> : null}
      {selection && !compact ? (
        <span className="sel">
          {' '}
          · sel {formatTime(selection[0])} to {formatTime(selection[1])} ({(selection[1] - selection[0]).toFixed(2)} s)
        </span>
      ) : null}
    </span>
  );
}

const SPAN_PICKS: [number, string][] = [
  [1, '1 second'],
  [5, '5 seconds'],
  [15, '15 seconds (auto length)'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [150, '2:30 (full match)'],
];

/** Zoom control: − / +, the visible span (type to set it), quick picks and zoom-to-phase. */
function ZoomBox() {
  const view = useStore(timeStore, (s) => s.view);
  const span = view[1] - view[0];
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (text === null) return;
    const v = parseSpanInput(text);
    if (v === null) {
      setBad(true);
      return;
    }
    setSpan(v);
    setText(null);
    setBad(false);
  };
  return (
    <span className="zoom-box">
      <span className="toolbar-note">Zoom</span>
      <ToolButton icon="minus" text="Zoom out" onClick={() => zoomBy(1.5)} title={`Zoom out (${keyHint('zoomOut')})`} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <input
          className={`tool-input span-input${bad ? ' bad' : ''}`}
          data-testid="span-input"
          value={text ?? formatSpan(span)}
          title="How much time is visible. Type e.g. 10, 30s, 500ms, 1:30 or 2m and press Enter."
          onFocus={(e) => {
            setText(formatSpan(span));
            e.target.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
          onBlur={() => {
            setText(null);
            setBad(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
      </form>
      <ToolButton icon="plus" text="Zoom in" onClick={() => zoomBy(1 / 1.5)} title={`Zoom in (${keyHint('zoomIn')})`} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout and drawing

function visibleLogs(st: SessionState): LogEntry[] {
  return st.logs.filter((l) => l.visible);
}

/** Total height of the rows the current mode shows (mirrors computeLayout). */
function rowsHeight(st: SessionState): number {
  const logs = visibleLogs(st);
  let h = logs.length * LANE_H;
  if (st.timelineMode !== 'compact' || st.timelineHeight !== null) {
    if (logs.some((l) => l.events.length)) h += LANE_H + 2;
    if (logs.some((l) => l.roles.batteryVoltage)) h += LANE_H * logs.length;
    if (st.bookmarks.length) h += LANE_H;
    const maxTracks = st.timelineMode === 'standard' && st.timelineHeight === null ? 2 : 50;
    h += st.timelineTracks.slice(0, maxTracks).length * LANE_H * Math.max(1, logs.length);
  }
  return h;
}

function computeLayout(width: number): Layout {
  const st = sessionStore.get();
  const logs = visibleLogs(st);
  const rows: Row[] = [];
  let y = OVERVIEW_H + 4;
  const push = (r: Omit<Row, 'y'>) => {
    rows.push({ ...r, y });
    y += r.h;
  };
  for (const l of logs) push({ kind: 'mode', h: LANE_H, log: l, label: l.name });
  // A hand-set height shows every row that fits; compact shows only the mode lanes.
  if (st.timelineMode !== 'compact' || st.timelineHeight !== null) {
    if (logs.some((l) => l.events.length)) push({ kind: 'events', h: LANE_H + 2, label: 'Events' });
    if (logs.some((l) => l.roles.batteryVoltage)) push({ kind: 'battery', h: LANE_H * logs.length, label: 'Battery' });
    if (st.bookmarks.length) push({ kind: 'bookmarks', h: LANE_H, label: 'Bookmarks' });
    const maxTracks = st.timelineMode === 'standard' && st.timelineHeight === null ? 2 : 50;
    for (const key of st.timelineTracks.slice(0, maxTracks)) push({ kind: 'track', h: LANE_H * Math.max(1, logs.length), key, label: trackLabel(key) });
  }
  return { x0: LABEL_W, x1: width - 8, rows };
}

// --- strip caches: bucketing a signal per pixel is only redone when the view changes ---

interface Run {
  x: number;
  w: number;
  color: string;
}
interface StripCache {
  v: Float64Array;
  offset: number;
  t0: number;
  t1: number;
  px: number;
  extra: string;
  runs: Run[];
}
const stripCache = new Map<string, StripCache>();
const minMaxCache = new WeakMap<Float64Array, [number, number]>();

function seriesMinMax(v: Float64Array): [number, number] {
  const c = minMaxCache.get(v);
  if (c) return c;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const r: [number, number] = [min, max];
  minMaxCache.set(v, r);
  return r;
}

/** Colored runs for a numeric strip: one bucket per `step` px (min or max per bucket), held forward over gaps. */
function stripRuns(
  cacheKey: string,
  t: Float64Array,
  v: Float64Array,
  offset: number,
  t0: number,
  t1: number,
  width: number,
  step: number,
  pick: 'min' | 'max',
  extra: string,
  colorOf: (value: number) => string,
): Run[] {
  const px = Math.max(1, Math.floor(width / step));
  const c = stripCache.get(cacheKey);
  if (c && c.v === v && c.offset === offset && c.t0 === t0 && c.t1 === t1 && c.px === px && c.extra === extra) return c.runs;
  const [i0, i1] = visibleIndexRange(t, offset, t0, t1);
  const buckets = new Float64Array(px).fill(pick === 'min' ? Infinity : -Infinity);
  for (let i = i0; i <= i1; i++) {
    const b = Math.floor(((t[i] + offset - t0) / (t1 - t0)) * px);
    if (b < 0 || b >= px) continue;
    const y = v[i];
    if (pick === 'min' ? y < buckets[b] : y > buckets[b]) buckets[b] = y;
  }
  // hold-over value entering the view from the left
  let last = i0 >= 0 && i0 < t.length && t[i0] + offset <= t0 ? v[i0] : NaN;
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let b = 0; b < px; b++) {
    let y = buckets[b];
    if (!Number.isFinite(y)) y = last;
    if (!Number.isFinite(y)) {
      cur = null;
      continue;
    }
    last = y;
    const color = colorOf(y);
    if (cur && cur.color === color) cur.w += step;
    else {
      cur = { x: b * step, w: step, color };
      runs.push(cur);
    }
  }
  stripCache.set(cacheKey, { v, offset, t0, t1, px, extra, runs });
  if (stripCache.size > 200) stripCache.delete(stripCache.keys().next().value as string);
  return runs;
}

function drawTimeline(dc: DrawContext, layoutRef: React.MutableRefObject<Layout>) {
  const { ctx, width, height, potato } = dc;
  const pal = T();
  const st = sessionStore.get();
  const time = timeStore.get();
  const logs = visibleLogs(st);
  const layout = computeLayout(width);
  layoutRef.current = layout;
  const { x0, x1 } = layout;
  const [t0, t1] = time.view;
  const [e0, e1] = sessionExtent(st.logs);
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  const xOv = (t: number) => x0 + ((t - e0) / (e1 - e0)) * (x1 - x0);
  const fields = fieldIndex(st.logs);
  const step = potato ? 3 : 1;

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  // Overview strip: primary log's modes (solid) and the visible-range box. Everything is
  // clipped to the strip so it can never paint over the "Overview" label.
  ctx.fillStyle = pal.fg2;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Overview', x0 - 6, OVERVIEW_H / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, x1 - x0, OVERVIEW_H);
  ctx.clip();
  ctx.fillStyle = pal.bg3;
  ctx.fillRect(x0, 0, x1 - x0, OVERVIEW_H);
  if (logs[0]) drawModeBands(ctx, logs[0], x0, x1, 2, OVERVIEW_H - 2, e0, e1, true);
  for (let i = 1; i < Math.min(logs.length, 4); i++) {
    // thin lines for other logs' enabled periods
    const l = logs[i];
    for (const r of l.robotState.ranges) {
      if (r.mode === 'disabled') continue;
      ctx.fillStyle = l.color;
      ctx.fillRect(xOv(r.start + l.offset), OVERVIEW_H - 3 - (i - 1) * 2, Math.max(1, xOv(r.end + l.offset) - xOv(r.start + l.offset)), 1.5);
    }
  }
  const bx = Math.max(x0, xOv(t0));
  const bw = Math.max(3, Math.min(x1, xOv(t1)) - bx);
  ctx.fillStyle = pal.selection;
  ctx.fillRect(bx, 0, bw, OVERVIEW_H);
  ctx.strokeStyle = pal.cursor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + 0.75, 0.75, bw - 1.5, OVERVIEW_H - 1.5);
  if (time.cursor !== null) drawCursor(ctx, xOv(time.cursor), 0, OVERVIEW_H, pal.hoverCursor);
  ctx.restore();

  // Rows
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, OVERVIEW_H + 2, width, height - OVERVIEW_H - AXIS_H - 2);
  ctx.clip();
  const readoutT = time.hover ?? time.cursor;
  for (const row of layout.rows) {
    if (row.y > height) break;
    ctx.fillStyle = pal.rowBg;
    ctx.fillRect(x0, row.y, x1 - x0, row.h - 1);
    ctx.fillStyle = row.log ? row.log.color : pal.fg2;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label.slice(0, 18), x0 - 6, row.y + Math.min(row.h, LANE_H) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, row.y, x1 - x0, row.h);
    ctx.clip();
    switch (row.kind) {
      case 'mode': {
        const l = row.log!;
        drawModeBands(ctx, l, x0, x1, row.y + 1, row.y + row.h - 2, t0, t1, true);
        // labels inside wide bands
        ctx.fillStyle = pal.onBand;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        for (const r of l.robotState.ranges) {
          if (r.mode === 'disabled') continue;
          const a = Math.max(x0, xOf(r.start + l.offset));
          const b = Math.min(x1, xOf(r.end + l.offset));
          if (b - a > 50) ctx.fillText(MODE_LABEL[r.estop ? 'estop' : r.mode], a + 3, row.y + row.h / 2);
        }
        if (l.manualOffset !== 0) {
          ctx.fillStyle = pal.fg;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`nudge ${l.manualOffset >= 0 ? '+' : ''}${l.manualOffset.toFixed(2)} s`, x1 - 3, row.y + row.h / 2);
        }
        break;
      }
      case 'events': {
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        logs.forEach((l, li) => {
          let lastX = -Infinity;
          for (const e of l.events) {
            const t = e.t + l.offset;
            if (t < t0 || t > t1) continue;
            const x = xOf(t);
            if (potato && x - lastX < 6) continue; // thin out stacked markers
            lastX = x;
            const g = EVENT_GLYPHS[e.kind];
            drawIcon(ctx, g.icon, x, row.y + row.h / 2 - 1, Math.min(12, row.h - 1), toneColor(g.tone));
            ctx.fillStyle = l.color;
            ctx.fillRect(x - 1, row.y + row.h - 3 - li, 2, 2);
          }
        });
        break;
      }
      case 'battery': {
        logs.forEach((l, li) => {
          const key = l.roles.batteryVoltage;
          const s = key ? client.peekSeries(l.id, key) : undefined;
          const yy = row.y + li * LANE_H;
          if (!s || s.kind !== 'number') return;
          const runs = stripRuns(`bat|${l.id}`, s.t, s.v, l.offset, t0, t1, x1 - x0, step, 'min', `${st.brownoutThreshold}|${pal.id}`, (v) =>
            voltageColor(v, st.brownoutThreshold),
          );
          for (const r of runs) {
            ctx.fillStyle = r.color;
            ctx.fillRect(x0 + r.x, yy + 1, r.w, LANE_H - 3);
          }
        });
        break;
      }
      case 'bookmarks': {
        for (const b of st.bookmarks) {
          if (b.t < t0 || b.t > t1) continue;
          const x = xOf(b.t);
          ctx.fillStyle = pal.warn;
          ctx.beginPath();
          ctx.moveTo(x - 4, row.y + 1);
          ctx.lineTo(x + 4, row.y + 1);
          ctx.lineTo(x, row.y + row.h - 2);
          ctx.fill();
          ctx.fillStyle = pal.fg;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(b.text.slice(0, 30), x + 6, row.y + row.h / 2);
        }
        break;
      }
      case 'track': {
        const key = row.key!;
        const f = fields.get(key);
        logs.forEach((l, li) => {
          const yy = row.y + li * LANE_H;
          const s = client.peekSeries(l.id, key);
          if (!s) return;
          if (s.kind === 'boolean' || s.kind === 'string') {
            const [i0, i1] = visibleIndexRange(s.t, l.offset, t0, t1);
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            let lastEnd = -Infinity;
            for (let i = i0; i <= i1; i++) {
              const a = Math.max(x0, xOf(s.t[i] + l.offset));
              const b = Math.min(x1, i + 1 < s.t.length ? xOf(s.t[i + 1] + l.offset) : x1);
              if (b <= a) continue;
              if (b < lastEnd + 0.5) continue; // sub-pixel segment already covered
              lastEnd = b;
              if (s.kind === 'boolean') {
                if (!s.v[i]) continue;
                ctx.fillStyle = withAlpha(l.color, 0.75);
                ctx.fillRect(a, yy + 1, Math.max(1, b - a), LANE_H - 3);
              } else {
                const sv = String(s.v[i]);
                if (!sv) continue;
                ctx.fillStyle = stringColor(sv);
                ctx.fillRect(a, yy + 1, Math.max(1, b - a), LANE_H - 3);
                if (b - a > 20) {
                  ctx.fillStyle = '#111';
                  ctx.fillText(sv.slice(0, Math.floor((b - a) / 5.5)), a + 2, yy + LANE_H / 2);
                }
              }
            }
          } else if (s.kind === 'number') {
            // color-mapped strip from min..max over the whole series
            const [min, max] = seriesMinMax(s.v);
            const runs = stripRuns(`trk|${l.id}|${key}`, s.t, s.v, l.offset, t0, t1, x1 - x0, step, 'max', '', (v) => {
              const f01 = max > min ? Math.round(((v - min) / (max - min)) * 24) / 24 : 0.5;
              return `hsl(${(1 - f01) * 220} 70% ${35 + f01 * 25}%)`;
            });
            for (const r of runs) {
              ctx.fillStyle = r.color;
              ctx.fillRect(x0 + r.x, yy + 1, r.w, LANE_H - 3);
            }
          }
          // readout
          if (readoutT !== null && f) {
            const i = indexAtOrBefore(s.t, readoutT - l.offset);
            if (i >= 0) {
              const v = s.kind === 'boolean' ? !!s.v[i] : s.v[i];
              const text = typeof v === 'number' ? v.toFixed(2) : String(v);
              ctx.font = '9px ui-monospace, monospace';
              ctx.textAlign = 'right';
              const tw = ctx.measureText(text).width;
              ctx.fillStyle = pal.legendBg;
              ctx.fillRect(x1 - tw - 6, yy + 1, tw + 6, LANE_H - 3);
              ctx.fillStyle = pal.strong;
              ctx.fillText(text, x1 - 3, yy + LANE_H / 2);
            }
          }
        });
        break;
      }
    }
    ctx.restore();
    // per-log color ticks beside multi-log rows
    if (row.kind === 'battery' || row.kind === 'track') {
      logs.forEach((l, li) => {
        ctx.fillStyle = l.color;
        ctx.fillRect(x0 - 4, row.y + li * LANE_H + 2, 2, LANE_H - 4);
      });
    }
  }
  ctx.restore();

  // Selection, cursor, hover
  const yTop = OVERVIEW_H + 2;
  const yBot = height - AXIS_H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, yTop, x1 - x0, height - yTop);
  ctx.clip();
  if (time.selection) {
    ctx.fillStyle = pal.selection;
    ctx.fillRect(xOf(time.selection[0]), yTop, xOf(time.selection[1]) - xOf(time.selection[0]), yBot - yTop);
  }
  drawTimeAxis(ctx, x0, x1, yBot, t0, t1, yTop);
  if (time.cursor !== null && time.cursor >= t0 && time.cursor <= t1) drawCursor(ctx, xOf(time.cursor), yTop, height, pal.cursor);
  if (time.hover !== null && time.hover >= t0 && time.hover <= t1) drawCursor(ctx, xOf(time.hover), yTop, height, pal.hoverCursor, true);
  ctx.restore();
  // mode legend
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lx = 4;
  for (const m of ['auto', 'teleop', 'test', 'estop']) {
    const w = 14 + ctx.measureText(MODE_LABEL[m]).width;
    if (lx + w > x0 - 6) break;
    ctx.fillStyle = modeSolid(m);
    ctx.fillRect(lx, height - AXIS_H + 4, 8, 8);
    ctx.fillStyle = pal.fg2;
    ctx.fillText(MODE_LABEL[m], lx + 10, height - AXIS_H + 8);
    lx += w;
  }
}

function voltageColor(v: number, brownout: number): string {
  const p = T();
  if (v < brownout) return p.err;
  if (v < 8.5) return '#f28e2b';
  if (v < 10.5) return p.dark ? '#edc948' : '#d6a800';
  return p.ok;
}

// ---------------------------------------------------------------------------
// Pointer interaction

function useTimelineInteraction(ref: React.RefObject<HTMLCanvasElement | null>, layoutRef: React.MutableRefObject<Layout>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    type Drag =
      | { kind: 'pan'; startX: number; view: [number, number]; moved: boolean }
      | { kind: 'select'; startT: number }
      | { kind: 'nudge'; log: LogEntry; startX: number; applied: number }
      | { kind: 'ov-move'; startX: number; view: [number, number] }
      | { kind: 'ov-left'; view: [number, number] }
      | { kind: 'ov-right'; view: [number, number] };
    let drag: Drag | null = null;
    const pos = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const tOf = (x: number) => {
      const { x0, x1 } = layoutRef.current;
      const [a, b] = timeStore.get().view;
      return a + ((x - x0) / (x1 - x0)) * (b - a);
    };
    const tOv = (x: number) => {
      const { x0, x1 } = layoutRef.current;
      const [a, b] = sessionExtent();
      return a + ((Math.min(x1, Math.max(x0, x)) - x0) / (x1 - x0)) * (b - a);
    };
    const rowAt = (y: number) => layoutRef.current.rows.find((r) => y >= r.y && y < r.y + r.h);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = pos(e);
      const { x0, x1 } = layoutRef.current;
      el.setPointerCapture(e.pointerId);
      const view = [...timeStore.get().view] as [number, number];
      if (y < OVERVIEW_H) {
        if (x < x0 - 2) return;
        const [e0, e1] = sessionExtent();
        const xa = x0 + ((view[0] - e0) / (e1 - e0)) * (x1 - x0);
        const xb = x0 + ((view[1] - e0) / (e1 - e0)) * (x1 - x0);
        // inside the box wins over the edge handles when the box is narrow
        const edge = Math.min(5, Math.max(2, (xb - xa) / 4));
        if (Math.abs(x - xa) < edge) drag = { kind: 'ov-left', view };
        else if (Math.abs(x - xb) < edge) drag = { kind: 'ov-right', view };
        else if (x > xa && x < xb) drag = { kind: 'ov-move', startX: x, view };
        else {
          const span = view[1] - view[0];
          const c = tOv(x);
          setView(c - span / 2, c + span / 2);
          drag = { kind: 'ov-move', startX: x, view: [...timeStore.get().view] as [number, number] };
        }
        return;
      }
      if (x < x0) {
        // Alt-click a track label removes that track (or all bookmarks)
        const row = rowAt(y);
        if (row?.kind === 'track' && e.altKey && row.key) removeTimelineTrack(row.key);
        if (row?.kind === 'bookmarks' && e.altKey) for (const b of sessionStore.get().bookmarks) removeBookmark(b.id);
        return;
      }
      const row = rowAt(y);
      if (e.altKey && row?.kind === 'mode' && row.log) {
        drag = { kind: 'nudge', log: row.log, startX: x, applied: 0 };
        return;
      }
      if (e.shiftKey) {
        drag = { kind: 'select', startT: tOf(x) };
        return;
      }
      drag = { kind: 'pan', startX: x, view, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = pos(e);
      const { x0, x1 } = layoutRef.current;
      const pxToSec = (dx: number, view: [number, number]) => (dx / (x1 - x0)) * (view[1] - view[0]);
      if (!drag) {
        setHover(y >= OVERVIEW_H && x >= x0 ? tOf(x) : null);
        el.style.cursor = y < OVERVIEW_H ? 'ew-resize' : e.altKey && rowAt(y)?.kind === 'mode' ? 'grab' : 'crosshair';
        return;
      }
      switch (drag.kind) {
        case 'pan': {
          if (Math.abs(x - drag.startX) > 3) drag.moved = true;
          if (drag.moved) {
            const dt = pxToSec(x - drag.startX, drag.view);
            setView(drag.view[0] - dt, drag.view[1] - dt);
          }
          break;
        }
        case 'select': {
          const t = tOf(x);
          timeStore.set({ selection: [Math.min(drag.startT, t), Math.max(drag.startT, t)] });
          break;
        }
        case 'nudge': {
          const want = pxToSec(x - drag.startX, timeStore.get().view);
          nudgeLog(drag.log.id, want - drag.applied);
          drag.applied = want;
          break;
        }
        case 'ov-move': {
          const [e0, e1] = sessionExtent();
          const dt = ((x - drag.startX) / (x1 - x0)) * (e1 - e0);
          setView(drag.view[0] + dt, drag.view[1] + dt);
          break;
        }
        case 'ov-left':
          setView(Math.min(tOv(x), drag.view[1] - 0.05), drag.view[1], 'resize');
          break;
        case 'ov-right':
          setView(drag.view[0], Math.max(tOv(x), drag.view[0] + 0.05), 'resize');
          break;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const { x, y } = pos(e);
      if (drag.kind === 'pan' && !drag.moved && y >= OVERVIEW_H) setCursor(tOf(x));
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = pos(e);
      const { x0, x1 } = layoutRef.current;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // horizontal scroll pans
        const [a, b] = timeStore.get().view;
        const dt = ((e.deltaX || e.deltaY) / (x1 - x0)) * (b - a);
        setView(a + dt, b + dt);
        return;
      }
      const factor = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.18 * Math.min(3, Math.abs(e.deltaY) / 50 + 0.5));
      // over the overview strip, zoom around the middle of the box
      const [a, b] = timeStore.get().view;
      zoomAround(y < OVERVIEW_H ? (a + b) / 2 : tOf(Math.min(x1, Math.max(x0, x))), factor);
    };
    const onLeave = () => setHover(null);
    const onDbl = (e: MouseEvent) => {
      const { y } = pos(e);
      if (y >= OVERVIEW_H) zoomTo('full');
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current]);
}
