/**
 * Statistics over a time window of a numeric series (sample-and-hold aware):
 * min/max/mean/median/percentiles/stdev plus time-weighted mean.
 */
import { indexAtOrBefore } from '../log';

export interface Stats {
  count: number;
  min: number;
  minT: number;
  max: number;
  maxT: number;
  mean: number;
  timeMean: number;
  median: number;
  p05: number;
  p95: number;
  stdev: number;
  first: number;
  last: number;
}

/** t0/t1 in raw seconds of the series. */
export function computeStats(t: Float64Array, v: Float64Array, t0: number, t1: number): Stats | undefined {
  let i0 = indexAtOrBefore(t, t0);
  if (i0 < 0) i0 = 0;
  const i1 = indexAtOrBefore(t, t1);
  if (i1 < i0) return undefined;
  const vals: number[] = [];
  let sum = 0;
  let wsum = 0;
  let wdur = 0;
  let min = Infinity;
  let max = -Infinity;
  let minT = 0;
  let maxT = 0;
  for (let i = i0; i <= i1; i++) {
    const y = v[i];
    if (!Number.isFinite(y)) continue;
    vals.push(y);
    sum += y;
    const a = Math.max(t[i], t0);
    const b = Math.min(i + 1 < t.length ? t[i + 1] : t1, t1);
    const dt = Math.max(0, b - a);
    wsum += y * dt;
    wdur += dt;
    if (y < min) {
      min = y;
      minT = t[i];
    }
    if (y > max) {
      max = y;
      maxT = t[i];
    }
  }
  const n = vals.length;
  if (!n) return undefined;
  const mean = sum / n;
  let ss = 0;
  for (const y of vals) ss += (y - mean) * (y - mean);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return {
    count: n,
    min,
    minT,
    max,
    maxT,
    mean,
    timeMean: wdur > 0 ? wsum / wdur : mean,
    median: q(0.5),
    p05: q(0.05),
    p95: q(0.95),
    stdev: Math.sqrt(ss / n),
    first: vals[0],
    last: vals[n - 1],
  };
}

/** Histogram over [min,max] with `bins` buckets. */
export function histogram(values: ArrayLike<number>, bins: number, min?: number, max?: number): { edges: number[]; counts: number[] } {
  let lo = min ?? Infinity;
  let hi = max ?? -Infinity;
  if (min === undefined || max === undefined) {
    for (let i = 0; i < values.length; i++) {
      const y = values[i];
      if (!Number.isFinite(y)) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { edges: [], counts: [] };
  if (hi === lo) hi = lo + 1;
  const counts = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins;
  for (let i = 0; i < values.length; i++) {
    const y = values[i];
    if (!Number.isFinite(y)) continue;
    let b = Math.floor((y - lo) / w);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  return { edges, counts };
}
