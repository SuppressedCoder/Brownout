/**
 * Power report analyzer (requirements §8, item 8). Works from what the robot
 * logged: battery voltage, brownout flag, PDH channel currents, total current,
 * energy. Every finding carries a raw-time stamp so the UI can jump to it.
 */
import type { LogData } from '../log';
import { indexAtOrBefore } from '../log';
import { resolveRole } from '../roles';
import type { ModeRange } from '../robotState';

export interface Finding {
  t: number; // raw seconds
  end?: number;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
}

export interface PowerThresholds {
  brownout: number; // V: roboRIO 1 6.3, roboRIO 2 6.75
  warn: number; // V: e.g. 8.5
  peakCurrent: number; // A: for internal resistance peaks
}

export const DEFAULT_THRESHOLDS: PowerThresholds = { brownout: 6.75, warn: 8.5, peakCurrent: 15 };

export interface PowerReport {
  voltageKey?: string;
  brownoutKey?: string;
  currentKey?: string;
  channelsKey?: string;
  energyKey?: string;
  enabledTime: number;
  minVoltage?: number;
  minVoltageT?: number;
  avgVoltage?: number;
  startVoltage?: number;
  endVoltage?: number;
  timeBelowWarn: number;
  timeBelowBrownout: number;
  brownoutCount: number;
  brownoutDuration: number;
  brownoutsInferred: boolean;
  peakCurrent?: number;
  peakCurrentT?: number;
  avgCurrent?: number;
  energyWh?: number;
  internalResistance?: number; // ohms, from V-I slope at peaks
  /** Open-circuit voltage estimate: the intercept of the same V-I fit. */
  restingVoltage?: number;
  /** Brownout intervals (raw seconds), logged or inferred. */
  brownouts: { start: number; end: number }[];
  dips: VoltageDip[];
  findings: Finding[];
  missing: string[];
}

export interface VoltageDip {
  t: number;
  voltage: number;
  current?: number;
  topChannels: { channel: number; amps: number }[];
}

function enabledMask(ranges: ModeRange[], t: number): boolean {
  for (const r of ranges) if (t >= r.start && t < r.end) return r.mode !== 'disabled';
  return false;
}

export function analyzePower(log: LogData, ranges: ModeRange[], th: PowerThresholds = DEFAULT_THRESHOLDS): PowerReport {
  const voltageKey = resolveRole(log, 'batteryVoltage');
  const brownoutKey = resolveRole(log, 'brownout');
  const currentKey = resolveRole(log, 'totalCurrent');
  const channelsKey = resolveRole(log, 'pdhChannelCurrents');
  const energyKey = resolveRole(log, 'totalEnergy');
  const report: PowerReport = {
    voltageKey,
    brownoutKey,
    currentKey,
    channelsKey,
    energyKey,
    enabledTime: ranges.filter((r) => r.mode !== 'disabled').reduce((a, r) => a + (r.end - r.start), 0),
    timeBelowWarn: 0,
    timeBelowBrownout: 0,
    brownoutCount: 0,
    brownoutDuration: 0,
    brownoutsInferred: false,
    brownouts: [],
    dips: [],
    findings: [],
    missing: [],
  };
  if (!voltageKey) report.missing.push('batteryVoltage');
  if (!brownoutKey) report.missing.push('brownout');
  if (!currentKey) report.missing.push('totalCurrent');
  if (!channelsKey) report.missing.push('pdhChannelCurrents');

  const vsAny = voltageKey ? log.series(voltageKey) : undefined;
  const vs = vsAny && vsAny.kind === 'number' ? vsAny : undefined;
  const csAny = currentKey ? log.series(currentKey) : undefined;
  const cs = csAny && csAny.kind === 'number' ? csAny : undefined;
  const chs = channelsKey ? log.series(channelsKey) : undefined;

  if (vs && vs.kind === 'number' && vs.t.length) {
    let sum = 0;
    let dur = 0;
    let min = Infinity;
    let minT = 0;
    const anyEnabled = ranges.some((r) => r.mode !== 'disabled');
    for (let i = 0; i < vs.t.length; i++) {
      const t = vs.t[i];
      const v = vs.v[i];
      if (!Number.isFinite(v)) continue;
      const next = i + 1 < vs.t.length ? vs.t[i + 1] : t;
      const dt = Math.max(0, next - t);
      if (anyEnabled && !enabledMask(ranges, t)) continue;
      sum += v * dt;
      dur += dt;
      if (v < min) {
        min = v;
        minT = t;
      }
      if (v < th.warn) report.timeBelowWarn += dt;
      if (v < th.brownout) report.timeBelowBrownout += dt;
    }
    report.startVoltage = vs.v[0];
    report.endVoltage = vs.v[vs.t.length - 1];
    if (dur > 0) report.avgVoltage = sum / dur;
    if (Number.isFinite(min)) {
      report.minVoltage = min;
      report.minVoltageT = minT;
    }
  }

  // Brownouts: logged flag, else inferred from voltage below threshold
  const bs = brownoutKey ? log.series(brownoutKey) : undefined;
  const brownoutEvents: { start: number; end: number }[] = [];
  if (bs && bs.kind === 'boolean' && bs.t.length) {
    let start: number | null = null;
    for (let i = 0; i < bs.t.length; i++) {
      if (bs.v[i] && start === null) start = bs.t[i];
      else if (!bs.v[i] && start !== null) {
        brownoutEvents.push({ start, end: bs.t[i] });
        start = null;
      }
    }
    if (start !== null) brownoutEvents.push({ start, end: log.endTs });
  } else if (vs && vs.kind === 'number') {
    report.brownoutsInferred = true;
    let start: number | null = null;
    for (let i = 0; i < vs.t.length; i++) {
      const below = vs.v[i] < th.brownout;
      if (below && start === null) start = vs.t[i];
      else if (!below && start !== null) {
        brownoutEvents.push({ start, end: vs.t[i] });
        start = null;
      }
    }
    if (start !== null) brownoutEvents.push({ start, end: log.endTs });
  }
  report.brownouts = brownoutEvents;
  report.brownoutCount = brownoutEvents.length;
  report.brownoutDuration = brownoutEvents.reduce((a, e) => a + (e.end - e.start), 0);
  for (const e of brownoutEvents) {
    report.findings.push({
      t: e.start,
      end: e.end,
      severity: 'error',
      title: report.brownoutsInferred ? `Voltage below ${th.brownout} V` : 'Brownout',
      detail: `${((e.end - e.start) * 1000).toFixed(0)} ms` + (vs ? `, ${fmtV(voltageAt(vs, e.start))}` : ''),
    });
  }

  // Current and energy
  if (cs && cs.kind === 'number' && cs.t.length) {
    let peak = -Infinity;
    let peakT = 0;
    let sum = 0;
    let dur = 0;
    for (let i = 0; i < cs.t.length; i++) {
      const c = cs.v[i];
      if (!Number.isFinite(c)) continue;
      const next = i + 1 < cs.t.length ? cs.t[i + 1] : cs.t[i];
      const dt = Math.max(0, next - cs.t[i]);
      if (c > peak) {
        peak = c;
        peakT = cs.t[i];
      }
      sum += c * dt;
      dur += dt;
    }
    if (Number.isFinite(peak)) {
      report.peakCurrent = peak;
      report.peakCurrentT = peakT;
    }
    if (dur > 0) report.avgCurrent = sum / dur;
    // Energy = ∫ V I dt (Wh)
    if (vs && vs.kind === 'number') {
      let e = 0;
      for (let i = 0; i + 1 < cs.t.length; i++) {
        const dt = cs.t[i + 1] - cs.t[i];
        if (dt <= 0 || dt > 5) continue;
        e += voltageAt(vs, cs.t[i]) * cs.v[i] * dt;
      }
      report.energyWh = e / 3600;
      // Internal resistance from V-I slope at samples above the peak threshold
      const fit = fitInternalResistance(vs, cs, th.peakCurrent);
      report.internalResistance = fit?.r;
      report.restingVoltage = fit?.v0;
    }
  }
  const es = energyKey ? log.series(energyKey) : undefined;
  if (es && es.kind === 'number' && es.t.length && report.energyWh === undefined) {
    report.energyWh = (es.v[es.t.length - 1] - es.v[0]) / 3600;
  }

  // Voltage dips: local minima below the warn threshold, at least 1 s apart
  if (vs && vs.kind === 'number') {
    const dips: VoltageDip[] = [];
    let lastT = -Infinity;
    for (let i = 1; i + 1 < vs.t.length; i++) {
      const v = vs.v[i];
      if (v >= th.warn) continue;
      if (vs.v[i - 1] < v || vs.v[i + 1] < v) continue;
      if (vs.t[i] - lastT < 1) {
        const last = dips[dips.length - 1];
        if (last && v < last.voltage) {
          last.voltage = v;
          last.t = vs.t[i];
        }
        continue;
      }
      lastT = vs.t[i];
      const dip: VoltageDip = { t: vs.t[i], voltage: v, topChannels: [] };
      if (cs && cs.kind === 'number') dip.current = valueAt(cs.t, cs.v, vs.t[i]);
      if (chs && chs.kind === 'array') {
        const j = indexAtOrBefore(chs.t, vs.t[i]);
        if (j >= 0) {
          const arr = chs.v[j] as number[];
          dip.topChannels = arr
            .map((amps, channel) => ({ channel, amps }))
            .sort((a, b) => b.amps - a.amps)
            .slice(0, 3);
        }
      }
      dips.push(dip);
    }
    report.dips = dips
      .sort((a, b) => a.voltage - b.voltage)
      .slice(0, 10)
      .sort((a, b) => a.t - b.t);
    for (const d of report.dips) {
      if (brownoutEvents.some((e) => d.t >= e.start - 0.05 && d.t <= e.end + 0.05)) continue;
      report.findings.push({
        t: d.t,
        severity: d.voltage < th.brownout + 0.5 ? 'warning' : 'info',
        title: `Voltage dip to ${fmtV(d.voltage)}`,
        detail:
          (d.current !== undefined ? `${d.current.toFixed(0)} A total` : '') +
          (d.topChannels.length ? ` · top: ${d.topChannels.map((c) => `ch${c.channel} ${c.amps.toFixed(0)} A`).join(', ')}` : ''),
      });
    }
  }
  report.findings.sort((a, b) => a.t - b.t);
  return report;
}

function valueAt(t: Float64Array, v: Float64Array, x: number): number {
  const i = indexAtOrBefore(t, x);
  return i < 0 ? NaN : v[i];
}
function voltageAt(vs: { t: Float64Array; v: Float64Array }, x: number): number {
  return valueAt(vs.t, vs.v, x);
}
function fmtV(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(2)} V` : '—';
}

/** Least-squares slope of V against I over samples with I > threshold: R_int ≈ -dV/dI. */
function fitInternalResistance(
  vs: { t: Float64Array; v: Float64Array },
  cs: { t: Float64Array; v: Float64Array },
  minI: number,
): { r: number; v0: number } | undefined {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < cs.t.length; i++) {
    const I = cs.v[i];
    if (!(I > minI)) continue;
    const V = voltageAt(vs, cs.t[i]);
    if (!Number.isFinite(V)) continue;
    n++;
    sx += I;
    sy += V;
    sxx += I * I;
    sxy += I * V;
  }
  if (n < 10) return undefined;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return undefined;
  const slope = (n * sxy - sx * sy) / denom;
  const r = -slope;
  // V = V0 - I R, so V0 is the intercept
  return r > 0 && r < 1 ? { r, v0: (sy - slope * sx) / n } : undefined;
}
