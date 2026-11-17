/**
 * The shared time state every panel follows: selected time (cursor), hover
 * time, visible range, selected range, and playback. Canvas panels subscribe
 * directly and redraw in requestAnimationFrame; React only reads it for the
 * readouts.
 *
 * The visible range never leaves the timeline's range: the match (auto start
 * to teleop end, see matchExtent) unless the timeline is set to the whole log,
 * so the overview window can't be dragged off either side.
 */
import { createStore } from './store';
import { sessionStore, sessionExtent, matchExtent } from './session';
import { settingsStore } from './settings';
import { clampWindow } from '@core/alignment';

export type TimeFormat = 'relative' | 'raw' | 'match' | 'clock';

export interface TimeState {
  cursor: number | null; // aligned seconds
  hover: number | null;
  view: [number, number];
  selection: [number, number] | null;
  playing: boolean;
  speed: number;
  loop: boolean;
  timeFormat: TimeFormat;
}

export const timeStore = createStore<TimeState>({
  cursor: null,
  hover: null,
  view: [0, 10],
  selection: null,
  playing: false,
  speed: 1,
  loop: false,
  timeFormat: 'relative',
});

export const MIN_SPAN = 0.01;

/** The range the timeline covers: the match, or the whole log when switched (or when there is no match). */
export function timeBounds(): [number, number] {
  if (sessionStore.get().wholeLog) return sessionExtent();
  return matchExtent() ?? sessionExtent();
}

/** Whether the timeline is trimmed to the match right now. */
export function trimmedToMatch(): boolean {
  return !sessionStore.get().wholeLog && matchExtent() !== null;
}

/** Show the whole log or only the match. The view is clamped to the new range. */
export function setWholeLog(whole: boolean): void {
  if (sessionStore.get().wholeLog !== whole) sessionStore.set({ wholeLog: whole });
}

/** Fit the view to the timeline's range (after logs open or the alignment changes). */
export function fitView(): void {
  const [a, b] = timeBounds();
  timeStore.set({ view: [a, b] });
}

export function setCursor(t: number | null): void {
  if (t === null) {
    timeStore.set({ cursor: null });
    return;
  }
  const [a, b] = sessionExtent();
  const c = Math.min(b, Math.max(a, t));
  // A jump to a moment outside the match (a console row before auto, say) shows the whole log.
  const [ba, bb] = timeBounds();
  if (c < ba || c > bb) setWholeLog(true);
  timeStore.set({ cursor: c });
}

/**
 * Hover preview shared across panels. Ignored during playback (panels follow
 * the playhead) and in Potato mode (saves a redraw of every panel per move).
 */
export function setHover(t: number | null): void {
  const s = timeStore.get();
  const next = s.playing || settingsStore.get().potato ? null : t;
  if (s.hover !== next) timeStore.set({ hover: next });
}

/** Set the visible range. 'pan' keeps the span and slides it inside the session; 'resize' clamps each edge. */
export function setView(a: number, b: number, mode: 'pan' | 'resize' = 'pan'): void {
  const [ea, eb] = timeBounds();
  const v = clampWindow(a, b, ea, eb, mode, MIN_SPAN);
  if (!v) return;
  const cur = timeStore.get().view;
  if (cur[0] === v[0] && cur[1] === v[1]) return;
  timeStore.set({ view: v });
}

/** Re-fit the current view after the session extent changed (logs added, removed, re-aligned). */
export function reclampView(): void {
  const [ea, eb] = timeBounds();
  const [a, b] = timeStore.get().view;
  if (b <= ea || a >= eb) {
    timeStore.set({ view: [ea, eb] });
    return;
  }
  const v = clampWindow(a, b, ea, eb, 'pan', MIN_SPAN) ?? [ea, eb];
  if (v[0] !== a || v[1] !== b) timeStore.set({ view: v as [number, number] });
  const c = timeStore.get().cursor;
  if (c !== null && (c < ea || c > eb)) timeStore.set({ cursor: Math.min(eb, Math.max(ea, c)) });
}

export function zoomAround(t: number, factor: number): void {
  const [a, b] = timeStore.get().view;
  const span = Math.max(MIN_SPAN, (b - a) * factor);
  const f = (t - a) / (b - a);
  setView(t - span * f, t + span * (1 - f));
}

/** Zoom in/out around the cursor when it is visible, else around the middle of the view. */
export function zoomBy(factor: number): void {
  const { view, cursor } = timeStore.get();
  const c = cursor !== null && cursor >= view[0] && cursor <= view[1] ? cursor : (view[0] + view[1]) / 2;
  zoomAround(c, factor);
}

/** Show exactly `span` seconds, centered on the cursor when visible. */
export function setSpan(span: number): void {
  const { view, cursor } = timeStore.get();
  const c = cursor !== null && cursor >= view[0] && cursor <= view[1] ? cursor : (view[0] + view[1]) / 2;
  setView(c - span / 2, c + span / 2);
}

export function panBy(dt: number): void {
  const [a, b] = timeStore.get().view;
  setView(a + dt, b + dt);
}

/** Move the cursor to a time and bring it into view. */
export function gotoTime(t: number): void {
  setCursor(t);
  const c = timeStore.get().cursor;
  if (c === null) return;
  const [a, b] = timeStore.get().view;
  if (c < a || c > b) {
    const span = b - a;
    setView(c - span / 2, c + span / 2);
  }
}

export type ZoomTarget = 'full' | 'match' | 'enabled' | 'auto' | 'teleop' | 'endgame' | 'selection';

export function zoomTo(target: ZoomTarget): void {
  const st = sessionStore.get();
  const logs = st.logs.filter((l) => l.visible);
  if (target === 'selection') {
    const sel = timeStore.get().selection;
    if (sel) setView(sel[0], sel[1], 'resize');
    return;
  }
  if (target === 'full') {
    setWholeLog(true);
    const [a, b] = sessionExtent();
    timeStore.set({ view: [a, b] });
    return;
  }
  if (target === 'match') {
    setWholeLog(false);
    fitView();
    return;
  }
  let a = Infinity;
  let b = -Infinity;
  for (const l of logs) {
    for (const r of l.robotState.ranges) {
      const ok =
        (target === 'enabled' && r.mode !== 'disabled') ||
        (target === 'auto' && r.mode === 'auto') ||
        (target === 'teleop' && r.mode === 'teleop') ||
        (target === 'endgame' && r.mode === 'teleop');
      if (!ok) continue;
      let start = r.start + l.offset;
      const end = r.end + l.offset;
      if (target === 'endgame') start = Math.max(start, end - 20);
      a = Math.min(a, start);
      b = Math.max(b, end);
    }
  }
  if (!Number.isFinite(a)) return;
  const pad = (b - a) * 0.03;
  // a phase outside the match range (a second enable after the match) needs the whole log
  const [ba, bb] = timeBounds();
  if (a < ba || b > bb) setWholeLog(true);
  setView(a - pad, b + pad, 'resize');
}

/** Jump the cursor to the next/previous robot-mode change across visible logs. */
export function jumpPhase(dir: 1 | -1): void {
  const st = sessionStore.get();
  const cur = timeStore.get().cursor ?? timeStore.get().view[0];
  const edges: number[] = [];
  for (const l of st.logs) if (l.visible) for (const r of l.robotState.ranges) edges.push(r.start + l.offset);
  edges.sort((a, b) => a - b);
  const next = dir === 1 ? edges.find((e) => e > cur + 1e-6) : [...edges].reverse().find((e) => e < cur - 1e-6);
  if (next === undefined) return;
  gotoTime(next);
}

// Playback loop
let rafId = 0;
let lastTs = 0;
function tick(ts: number) {
  const t = timeStore.get();
  if (!t.playing) return;
  const dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  let cur = (t.cursor ?? t.view[0]) + dt * t.speed;
  const [e0, e1] = timeBounds();
  const end = t.loop && t.selection ? t.selection[1] : e1;
  const start = t.loop && t.selection ? t.selection[0] : e0;
  if (cur >= end) {
    if (t.loop) cur = start;
    else {
      timeStore.set({ cursor: end, playing: false });
      return;
    }
  }
  const patch: Partial<TimeState> = { cursor: cur };
  // Follow the playhead when it runs off the view (page forward, or back after a loop). A view moved
  // elsewhere by hand stays where it was put: the playhead was not in it, so nothing is followed.
  const prev = t.cursor ?? t.view[0];
  const wasIn = prev >= t.view[0] - 1e-9 && prev <= t.view[1] + 1e-9;
  if (wasIn && (cur > t.view[1] || cur < t.view[0])) {
    const span = t.view[1] - t.view[0];
    const v = clampWindow(cur - span * 0.1, cur + span * 0.9, e0, e1, 'pan', MIN_SPAN);
    if (v) patch.view = v;
  }
  timeStore.set(patch);
  rafId = requestAnimationFrame(tick);
}

export function setPlaying(playing: boolean): void {
  const t = timeStore.get();
  if (playing === t.playing) return;
  if (playing) {
    const [e0, e1] = timeBounds();
    // restart from the beginning when play is pressed at the very end
    const cursor = t.cursor === null ? t.view[0] : t.cursor >= e1 - 1e-6 ? e0 : t.cursor;
    timeStore.set({ playing: true, hover: null, cursor });
    // pressing play shows the playhead once; after that the view only follows it off the edge
    const [a, b] = t.view;
    if (cursor < a || cursor > b) {
      const span = b - a;
      const v = clampWindow(cursor - span * 0.1, cursor + span * 0.9, e0, e1, 'pan', MIN_SPAN);
      if (v) timeStore.set({ view: v });
    }
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  } else {
    timeStore.set({ playing: false });
    cancelAnimationFrame(rafId);
  }
}

export function stepCursor(dt: number): void {
  const t = timeStore.get();
  gotoTime((t.cursor ?? t.view[0]) + dt);
}
