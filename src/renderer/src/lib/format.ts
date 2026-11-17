import { formatTime } from '@core/alignment';
import type { TimeFormat } from '../state/time';
import type { LogEntry } from '../state/session';
import { modeAt } from '@core/robotState';

export function formatValue(v: unknown, unit?: string): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    const s = Math.abs(v) >= 1000 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(3) : v.toPrecision(4);
    return unit ? `${trimZeros(s)} ${unit}` : trimZeros(s);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return `${v.length} bytes`;
  if (Array.isArray(v)) return `[${v.map((x) => formatValue(x)).join(', ')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.entries(o)
      .map(([k, x]) => `${k}: ${formatValue(x)}`)
      .join(', ')}}`;
  }
  return String(v);
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Time display for the readout: relative to alignment zero, raw, match time or wall clock. */
export function formatTimeFor(t: number, fmt: TimeFormat, log?: LogEntry): string {
  switch (fmt) {
    case 'relative':
      return formatTime(t);
    case 'raw': {
      if (!log) return formatTime(t);
      return `${(t - log.offset).toFixed(3)} s`;
    }
    case 'match': {
      if (!log) return formatTime(t);
      return matchTimeLabel(t, log) ?? formatTime(t);
    }
    case 'clock': {
      if (!log || log.robotState.epochOffset === undefined) return formatTime(t);
      const d = new Date((t - log.offset + log.robotState.epochOffset) * 1000);
      return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }
  }
}

/** "TELEOP 1:12 left" style label from mode ranges (or logged match time when present). */
export function matchTimeLabel(t: number, log: LogEntry): string | undefined {
  const raw = t - log.offset;
  const r = modeAt(log.robotState.ranges, raw);
  if (!r || r.mode === 'disabled') return r?.estop ? 'E-STOP' : 'DISABLED';
  const total = r.mode === 'auto' ? 15 : 135;
  const left = Math.max(0, Math.min(total, r.end - raw));
  const m = Math.floor(left / 60);
  const s = Math.floor(left - m * 60);
  const label = r.mode === 'auto' ? 'AUTO' : r.mode === 'teleop' ? 'TELEOP' : 'UTILITY';
  return `${label} ${m}:${String(s).padStart(2, '0')} left`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortName(name: string): string {
  // FRC_20260321_143012_NYROC_Q12.wpilog -> NYROC Q12
  const m = name.match(/^(?:FRC|WPILIB|FIRST_DS)_\d{8}_\d{6}(?:_([A-Za-z0-9]+))?(?:_([A-Za-z]+\d+(?:_\d+)?))?\.wpilog$/i);
  if (m) {
    if (m[1] && m[2]) return `${m[1]} ${m[2]}`;
    if (m[2]) return m[2];
    if (m[1]) return m[1];
  }
  return name.replace(/\.wpilog$/i, '');
}
