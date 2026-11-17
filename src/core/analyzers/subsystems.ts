/**
 * Power by subsystem. A subsystem is a named set of current sources: PDH/PDP
 * channel numbers and/or logged current fields (one per motor controller).
 * From those this works out who used the energy, each subsystem's highest
 * current peak, and who was drawing at every voltage dip and brownout.
 *
 * Everything is resampled (zero-order hold) onto one time base, in raw log
 * seconds. Energy is E = sum(V * I * dt).
 */
import type { LogData, FieldInfo } from '../log';
import { indexAtOrBefore } from '../log';

export interface SubsystemDef {
  id: string;
  name: string;
  /** PDH / PDP channel numbers. */
  channels: number[];
  /** Keys of logged current fields (amps). */
  fields: string[];
}

export interface SubsystemInput {
  defs: SubsystemDef[];
  voltageKey?: string;
  totalCurrentKey?: string;
  channelsKey?: string;
  /** Raw-time range to report on; default the whole log. */
  range?: [number, number];
  /** Brownouts found by the power report (raw seconds). */
  brownouts: { start: number; end: number }[];
  /** Voltage dips found by the power report. */
  dips: { t: number; voltage: number }[];
  /** When the robot was enabled (raw seconds). Given, averages are over enabled time only. */
  enabled?: { start: number; end: number }[];
}

/** id is a SubsystemDef id, or UNASSIGNED. */
export interface Draw {
  id: string;
  amps: number;
}
export const UNASSIGNED = '__unassigned';

export interface SubsystemStat {
  id: string;
  name: string;
  energyWh: number;
  /** Fraction of the total energy, 0..1 (NaN when the total is unknown). */
  share: number;
  avgCurrent: number;
  peakCurrent: number;
  peakT: number;
  /** Battery voltage at the peak. */
  peakVoltage?: number;
  /** Assigned sources that this log does not have. */
  missing: string[];
}

export interface BrownoutBreakdown {
  start: number;
  end: number;
  minVoltage?: number;
  minT: number;
  /** Draw at the lowest-voltage instant, largest first. */
  atDip: Draw[];
  /** Mean draw over the half second before the brownout started, largest first. */
  before: Draw[];
  totalAtDip?: number;
}

export interface DipBreakdown {
  t: number;
  voltage: number;
  total?: number;
  draws: Draw[];
}

export interface SubsystemReport {
  /** False when no assigned source exists in this log. */
  hasData: boolean;
  range: [number, number];
  stats: SubsystemStat[];
  /** Current not covered by any subsystem; null when the total is unknown. */
  unassigned: SubsystemStat | null;
  totalEnergyWh?: number;
  /**
   * Set when battery voltage is not logged: energy is then an estimate at this
   * voltage, and shares are shares of charge (amp-seconds).
   */
  voltageAssumed?: number;
  /** Where the total came from. */
  totalSource: 'totalCurrent' | 'channelSum' | 'none';
  brownouts: BrownoutBreakdown[];
  dips: DipBreakdown[];
  warnings: string[];
}

export interface SubsystemSeries {
  t: Float64Array;
  /** Amps per subsystem id (and UNASSIGNED when known), on `t`. */
  current: Record<string, Float64Array>;
}

/** Zero-order-hold reader that walks forward through a series as the base time advances. */
function holdReader<T>(t: Float64Array, get: (i: number) => T, empty: T): (x: number) => T {
  let i = -1;
  let last = -Infinity;
  return (x: number) => {
    if (x < last) i = indexAtOrBefore(t, x);
    else while (i + 1 < t.length && t[i + 1] <= x) i++;
    last = x;
    return i < 0 ? empty : get(i);
  };
}

export function computeSubsystems(log: LogData, input: SubsystemInput): { report: SubsystemReport; series: SubsystemSeries | null } {
  const warnings: string[] = [];
  const vsAny = input.voltageKey ? log.series(input.voltageKey) : undefined;
  const vs = vsAny?.kind === 'number' ? vsAny : undefined;
  const tsAny = input.totalCurrentKey ? log.series(input.totalCurrentKey) : undefined;
  const totalS = tsAny?.kind === 'number' ? tsAny : undefined;
  const chAny = input.channelsKey ? log.series(input.channelsKey) : undefined;
  const chs = chAny?.kind === 'array' ? chAny : undefined;
  const range: [number, number] = input.range ?? [log.startTs, log.endTs];

  // Resolve sources
  const usesChannels = input.defs.some((d) => d.channels.length > 0);
  const channelCount = chs && chs.v.length ? (chs.v[chs.v.length - 1] as number[]).length : 0;
  const sources = input.defs.map((d) => {
    const missing: string[] = [];
    const fields: { t: Float64Array; v: Float64Array }[] = [];
    for (const k of d.fields) {
      const s = log.series(k);
      if (s?.kind === 'number' && s.t.length) {
        fields.push(s);
        // Battery (supply) current hardly goes below zero; stator and torque current swing both ways
        let low = 0;
        let below = 0;
        for (let i = 0; i < s.v.length; i++) {
          if (s.v[i] < low) low = s.v[i];
          if (s.v[i] < -NEGATIVE_AMPS) below++;
        }
        if (low < -NEGATIVE_AMPS && below > 2 && !/stator/i.test(k))
          warnings.push(
            `${d.name}: “${k}” goes down to ${low.toFixed(0)} A. Current from the battery is rarely below zero, so this may be stator or torque current, which overstates what the battery supplies. Use supply current if it is logged.`,
          );
      } else missing.push(k);
      if (/stator/i.test(k))
        warnings.push(
          `${d.name}: “${k}” looks like stator current. Stator current is higher than what the battery supplies; use supply current if it is logged.`,
        );
    }
    const channels: number[] = [];
    for (const c of d.channels) {
      if (chs && c >= 0 && c < channelCount) channels.push(c);
      else missing.push(`channel ${c}`);
    }
    return { def: d, fields, channels, missing };
  });
  if (usesChannels && !chs) warnings.push('PDH/PDP channel currents are not in this log, so channel assignments are ignored.');

  // Time base: every moment any assigned source changed, so no source's peak falls between samples.
  // (Total current is used only when nothing is assigned.)
  const stamps: Float64Array[] = [];
  if (chs && sources.some((s) => s.channels.length)) stamps.push(chs.t);
  for (const s of sources) for (const f of s.fields) stamps.push(f.t);
  let base = mergeTimes(stamps);
  const hasData = !!base;
  if (!base) base = totalS?.t ?? chs?.t;

  const emptyStat = (d: { id: string; name: string }, missing: string[]): SubsystemStat => ({
    id: d.id,
    name: d.name,
    energyWh: 0,
    share: NaN,
    avgCurrent: 0,
    peakCurrent: 0,
    peakT: range[0],
    missing,
  });
  const report: SubsystemReport = {
    hasData,
    range,
    stats: sources.map((s) => emptyStat(s.def, s.missing)),
    unassigned: null,
    totalSource: totalS ? 'totalCurrent' : chs ? 'channelSum' : 'none',
    brownouts: [],
    dips: [],
    warnings,
  };
  if (!base || base.length < 2) return { report, series: null };

  const n = base.length;
  const nSub = sources.length;
  const knowTotal = report.totalSource !== 'none';
  const cur: Float64Array[] = sources.map(() => new Float64Array(n));
  const un = knowTotal ? new Float64Array(n) : null;
  const total = knowTotal ? new Float64Array(n) : null;
  const volt = vs ? new Float64Array(n) : null;

  const readCh = chs ? holdReader(chs.t, (i) => chs.v[i] as number[], [] as number[]) : null;
  const readTotal = totalS ? holdReader(totalS.t, (i) => totalS.v[i], NaN) : null;
  const readV = vs ? holdReader(vs.t, (i) => vs.v[i], NaN) : null;
  const readers = sources.map((s) => s.fields.map((f) => holdReader(f.t, (i) => f.v[i], 0)));
  const num = (x: number) => (Number.isFinite(x) ? x : 0);

  let overCount = 0;
  for (let i = 0; i < n; i++) {
    const t = base[i];
    const arr = readCh ? readCh(t) : null;
    let sum = 0;
    for (let s = 0; s < nSub; s++) {
      let a = 0;
      if (arr) for (const c of sources[s].channels) a += num(arr[c]);
      for (const r of readers[s]) a += num(r(t));
      cur[s][i] = a;
      sum += a;
    }
    if (total && un) {
      let tot = readTotal ? readTotal(t) : NaN;
      if (!Number.isFinite(tot) && arr) {
        tot = 0;
        for (const a of arr) tot += num(a);
      }
      tot = num(tot);
      total[i] = tot;
      un[i] = Math.max(0, tot - sum);
      if (sum > tot * 1.15 + 3) overCount++;
    }
    if (volt && readV) volt[i] = readV(t);
  }
  if (overCount > n * 0.1)
    warnings.push(
      'The subsystems add up to more than the measured total current for much of the log. A motor may be assigned twice (once by channel and once by field), or a field may be stator current.',
    );

  // Stats over the range
  const i0 = Math.max(0, indexAtOrBefore(base, range[0]));
  const i1 = Math.min(n - 1, Math.max(i0, indexAtOrBefore(base, range[1])));
  // Each sample holds until the next one, the way NetworkTables logs values (only when they change)
  // and the way every graph draws them.
  const dts = new Float64Array(n);
  for (let i = 0; i + 1 < n; i++) dts[i] = Math.max(0, base[i + 1] - base[i]);
  // Seconds of each sample's hold during which the robot was enabled (all of it when not told)
  const enabledDts = input.enabled && input.enabled.length ? overlapWith(base, input.enabled) : dts;
  const stat = (name: { id: string; name: string }, a: Float64Array, missing: string[]): SubsystemStat => {
    let e = 0;
    let q = 0;
    let dur = 0;
    let peak = -Infinity;
    let peakI = i0;
    for (let i = i0; i <= i1; i++) {
      const v = volt ? volt[i] : NOMINAL_VOLTS;
      if (Number.isFinite(v)) e += v * a[i] * dts[i];
      q += a[i] * enabledDts[i];
      dur += enabledDts[i];
      if (a[i] > peak) {
        peak = a[i];
        peakI = i;
      }
    }
    return {
      id: name.id,
      name: name.name,
      energyWh: e / 3600,
      share: NaN,
      avgCurrent: dur > 0 ? q / dur : 0,
      peakCurrent: Number.isFinite(peak) ? peak : 0,
      peakT: base![peakI],
      peakVoltage: volt && Number.isFinite(volt[peakI]) ? volt[peakI] : undefined,
      missing,
    };
  };
  report.stats = sources.map((s, k) => stat(s.def, cur[k], s.missing));
  if (un) report.unassigned = stat({ id: UNASSIGNED, name: 'Unassigned' }, un, []);
  const sumE = report.stats.reduce((a, s) => a + s.energyWh, 0) + (report.unassigned?.energyWh ?? 0);
  report.totalEnergyWh = sumE;
  if (!volt) report.voltageAssumed = NOMINAL_VOLTS;
  for (const s of report.stats) s.share = sumE > 0 ? s.energyWh / sumE : 0;
  if (report.unassigned) report.unassigned.share = sumE > 0 ? report.unassigned.energyWh / sumE : 0;

  // Who was drawing at an instant / over a window
  const ids = [...sources.map((s) => s.def.id), ...(un ? [UNASSIGNED] : [])];
  const arrays = [...cur, ...(un ? [un] : [])];
  const ranked = (get: (a: Float64Array) => number): Draw[] =>
    arrays
      .map((a, k) => ({ id: ids[k], amps: get(a) }))
      .filter((d) => d.amps > 0.05)
      .sort((x, y) => y.amps - x.amps);
  const at = (t: number) => Math.max(0, indexAtOrBefore(base!, t));
  const meanOver = (a: Float64Array, ta: number, tb: number) => {
    const ia = at(ta);
    // [ta, tb): the sample at tb itself belongs to what comes next
    let ib = at(tb);
    if (base![ib] >= tb && ib > ia) ib--;
    ib = Math.max(ia, ib);
    let s = 0;
    for (let i = ia; i <= ib; i++) s += a[i];
    return s / (ib - ia + 1);
  };

  for (const b of input.brownouts) {
    if (b.end < range[0] || b.start > range[1]) continue;
    // lowest voltage from just before the flag to its end (the flag trails the dip)
    let minI = at(b.start);
    if (volt) {
      const ia = at(b.start - 0.25);
      const ib = Math.max(ia, at(b.end));
      for (let i = ia; i <= ib; i++) if (volt[i] < volt[minI]) minI = i;
    }
    report.brownouts.push({
      start: b.start,
      end: b.end,
      minVoltage: volt && Number.isFinite(volt[minI]) ? volt[minI] : undefined,
      minT: base[minI],
      atDip: ranked((a) => a[minI]),
      before: ranked((a) => meanOver(a, b.start - 0.5, b.start)),
      totalAtDip: total ? total[minI] : undefined,
    });
  }
  for (const d of input.dips) {
    if (d.t < range[0] || d.t > range[1]) continue;
    const i = at(d.t);
    report.dips.push({ t: d.t, voltage: d.voltage, total: total ? total[i] : undefined, draws: ranked((a) => a[i]) });
  }
  report.dips.sort((a, b) => a.voltage - b.voltage);

  const current: Record<string, Float64Array> = {};
  sources.forEach((s, k) => (current[s.def.id] = cur[k]));
  if (un) current[UNASSIGNED] = un;
  return { report, series: { t: base, current } };
}

/** All timestamps of several series, sorted, without repeats. */
function mergeTimes(arrays: Float64Array[]): Float64Array | undefined {
  const some = arrays.filter((a) => a.length > 0);
  if (some.length === 0) return undefined;
  if (some.length === 1) return some[0];
  const total = some.reduce((a, x) => a + x.length, 0);
  // far too many points to merge quickly: the densest source alone is detailed enough
  if (total > 1_500_000) return some.reduce((a, x) => (x.length > a.length ? x : a));
  const all = new Float64Array(total);
  let o = 0;
  for (const a of some) {
    all.set(a, o);
    o += a.length;
  }
  all.sort();
  let n = 1;
  for (let i = 1; i < total; i++) if (all[i] !== all[n - 1]) all[n++] = all[i];
  return all.slice(0, n);
}

/** For each interval [t[i], t[i+1]): how many of its seconds fall inside the given ranges. */
function overlapWith(t: Float64Array, ranges: { start: number; end: number }[]): Float64Array {
  const out = new Float64Array(t.length);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let r = 0;
  for (let i = 0; i + 1 < t.length; i++) {
    const a = t[i];
    const b = t[i + 1];
    while (r < sorted.length && sorted[r].end <= a) r++;
    let sum = 0;
    for (let k = r; k < sorted.length && sorted[k].start < b; k++) sum += Math.max(0, Math.min(b, sorted[k].end) - Math.max(a, sorted[k].start));
    out[i] = sum;
  }
  return out;
}

/** Amps: a current field that goes further below zero than this is probably not battery current. */
const NEGATIVE_AMPS = 10;

/** Used for the energy estimate when battery voltage is not in the log. */
const NOMINAL_VOLTS = 12;

const SKIP = /powerdistribution|\/pdh\/|\/pdp\/|systemstats|setpoint|limit|target|desired|goal|threshold|\/brownout\//i;
const CURRENT = /(current|amps|amperes)/i;
const STRIP = [
  /^NT:/,
  /^\/AdvantageKit/,
  /^\/RealOutputs/,
  /^\/ReplayOutputs/,
  /^\/SmartDashboard/,
  /^\/Shuffleboard/,
  /^\/Robot(?=\/)/,
  // folders that only say "these are the subsystems": the name after them is the subsystem
  /^\/(Subsystems?|Mechanisms?|Hardware|Devices|Motors)(?=\/)/i,
];

/**
 * Guess subsystems from field names: every logged current is grouped by its
 * top-level folder ("/Drive/Module0/DriveCurrentAmps" goes to "Drive").
 * Supply current is preferred over stator current for the same motor.
 */
export function suggestSubsystems(fields: FieldInfo[]): SubsystemDef[] {
  const candidates = fields.filter(
    (f) =>
      f.kind === 'number' && !f.generated && !f.hidden && f.count > 1 && CURRENT.test(f.key) && !SKIP.test(f.key) && (!f.unit || /^a(mps?)?$/i.test(f.unit)),
  );
  const hasSupplySibling = (f: FieldInfo) => {
    const dir = f.key.slice(0, f.key.lastIndexOf('/') + 1);
    return candidates.some((o) => o !== f && o.key.startsWith(dir) && /supply/i.test(o.key.slice(dir.length)) && !o.key.slice(dir.length).includes('/'));
  };
  const groups = new Map<string, string[]>();
  for (const f of candidates) {
    if (/stator|torque/i.test(f.key) && hasSupplySibling(f)) continue;
    let k = f.key;
    for (let pass = 0; pass < 3; pass++) for (const re of STRIP) k = k.replace(re, '');
    const parts = k.split('/').filter(Boolean);
    const name = parts.length > 1 ? parts[0] : 'Other';
    groups.set(name, [...(groups.get(name) ?? []), f.key]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, keys]) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, channels: [], fields: keys }));
}

/** A rough rating of battery + wiring resistance measured from a match log (ohms). Rule of thumb, not a spec. */
export function batteryRating(ohms: number | undefined): 'good' | 'fair' | 'weak' | 'unknown' {
  if (ohms === undefined || !Number.isFinite(ohms)) return 'unknown';
  if (ohms <= 0.018) return 'good';
  if (ohms <= 0.025) return 'fair';
  return 'weak';
}
