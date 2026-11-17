/**
 * Alignment: each log gets an offset so that aligned = raw + offset.
 * t = 0 is the chosen anchor (log start, first enable, auto start, teleop
 * start) in every log, or wall-clock time relative to the primary log.
 * A manual nudge per log is added on top by the session.
 */
export type AlignMode = 'raw' | 'logStart' | 'firstEnable' | 'autoStart' | 'teleopStart' | 'wallClock';

export const ALIGN_MODES: { id: AlignMode; label: string; help: string }[] = [
  { id: 'autoStart', label: 'Auto start', help: 't = 0 when autonomous begins in each log' },
  { id: 'teleopStart', label: 'Teleop start', help: 't = 0 when teleop begins in each log' },
  { id: 'firstEnable', label: 'First enable', help: 't = 0 at the first enable edge (AdvantageScope’s rule)' },
  { id: 'logStart', label: 'Log start', help: 't = 0 at the first record of each log' },
  { id: 'wallClock', label: 'Wall clock', help: 'Real time, from systemTime / EpochTimeMicros (same-match files)' },
  { id: 'raw', label: 'Raw', help: 'No alignment: raw log timestamps' },
];

export interface AlignAnchors {
  startTs: number;
  firstEnable?: number;
  autoStart?: number;
  teleopStart?: number;
  epochOffset?: number;
}

export function computeOffset(mode: AlignMode, log: AlignAnchors, primary: AlignAnchors): number {
  switch (mode) {
    case 'raw':
      return 0;
    case 'logStart':
      return -log.startTs;
    case 'firstEnable':
      return -(log.firstEnable ?? log.startTs);
    case 'autoStart':
      return -(log.autoStart ?? log.firstEnable ?? log.startTs);
    case 'teleopStart':
      return -(log.teleopStart ?? log.firstEnable ?? log.startTs);
    case 'wallClock':
      if (log.epochOffset !== undefined && primary.epochOffset !== undefined) return log.epochOffset - primary.epochOffset - primary.startTs;
      return -log.startTs;
  }
}

/** Format aligned seconds as +m:ss.cc (or -m:ss.cc). */
export function formatTime(t: number, decimals = 2): string {
  if (!Number.isFinite(t)) return '—';
  const sign = t < 0 ? '-' : '+';
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${sign}${m}:${s.toFixed(decimals).padStart(decimals + 3, '0')}`;
}

export function formatDuration(t: number): string {
  if (!Number.isFinite(t)) return '—';
  if (t < 1) return `${(t * 1000).toFixed(0)} ms`;
  if (t < 60) return `${t.toFixed(2)} s`;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * Parse a typed time: "1:23.4", "+0:05", "-10", "83.4", "83.4s".
 * Returns seconds, or null when the text isn't a time.
 */
export function parseTimeInput(text: string): number | null {
  const m = text.trim().match(/^([+-])?\s*(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)\s*s?$/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const minutes = m[2] !== undefined ? Number(m[2]) : 0;
  const seconds = Number(m[3]);
  if (!Number.isFinite(seconds) || (m[2] !== undefined && seconds >= 60)) return null;
  return sign * (minutes * 60 + seconds);
}

/** Parse a typed duration: "30", "30s", "500ms", "2m", "1:30", "1.5 min". Returns seconds or null. */
export function parseSpanInput(text: string): number | null {
  const t = text.trim().toLowerCase();
  let m = t.match(/^(\d+):(\d+(?:\.\d*)?)$/);
  if (m) {
    const v = Number(m[1]) * 60 + Number(m[2]);
    return v > 0 ? v : null;
  }
  m = t.match(/^(\d+(?:\.\d*)?|\.\d+)\s*(ms|s|sec|secs|m|min|mins)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const v = unit === 'ms' ? n / 1000 : unit.startsWith('m') ? n * 60 : n;
  return v > 0 ? v : null;
}

/** Compact duration for the zoom box: "250 ms", "12.5 s", "2:35". */
export function formatSpan(span: number): string {
  if (!Number.isFinite(span)) return '';
  if (span < 1) return `${Math.round(span * 1000)} ms`;
  if (span < 60) return `${Number(span.toFixed(span < 10 ? 2 : 1))} s`;
  const m = Math.floor(span / 60);
  return `${m}:${String(Math.round(span - m * 60)).padStart(2, '0')}`;
}

/**
 * Fit a requested window inside [lo, hi]. 'pan' keeps the span and shifts it
 * inside; 'resize' clamps each edge independently. Returns null if the result
 * would be narrower than minSpan.
 */
export function clampWindow(a: number, b: number, lo: number, hi: number, mode: 'pan' | 'resize', minSpan = 0.01): [number, number] | null {
  if (!(b > a) || !(hi > lo)) return null;
  if (mode === 'resize') {
    const na = Math.max(a, lo);
    const nb = Math.min(b, hi);
    return nb - na >= minSpan ? [na, nb] : null;
  }
  const span = Math.min(b - a, hi - lo);
  if (span < minSpan) return null;
  let na = a;
  if (na < lo) na = lo;
  if (na + span > hi) na = hi - span;
  return [na, na + span];
}
