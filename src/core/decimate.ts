/**
 * Per-pixel min/max decimation. A graph `width` px wide gets at most ~2
 * points per pixel per signal, and single-sample spikes (brownout dips,
 * current peaks) are never lost.
 */
import { indexAtOrBefore } from './log';

export interface Decimated {
  /** x in aligned seconds, y value; pairs (min, max) per bucket, step-rendered. */
  x: Float64Array;
  y: Float64Array;
  n: number;
}

/**
 * @param t raw sample times (sorted)
 * @param v values
 * @param offset added to raw times to get aligned time
 * @param t0,t1 visible aligned range
 * @param width pixels
 */
export function decimateMinMax(t: Float64Array, v: Float64Array, offset: number, t0: number, t1: number, width: number): Decimated {
  const n = t.length;
  if (n === 0 || width <= 0 || t1 <= t0) return { x: new Float64Array(0), y: new Float64Array(0), n: 0 };
  // Start one sample before the range (sample-and-hold), end one after.
  let i0 = indexAtOrBefore(t, t0 - offset);
  if (i0 < 0) i0 = 0;
  let i1 = indexAtOrBefore(t, t1 - offset) + 1;
  if (i1 > n - 1) i1 = n - 1;
  const count = i1 - i0 + 1;
  const px = Math.max(1, Math.floor(width));
  if (count <= px * 2) {
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      x[k] = t[i0 + k] + offset;
      y[k] = v[i0 + k];
    }
    return { x, y, n: count };
  }
  const secPerPx = (t1 - t0) / px;
  const xs: number[] = [];
  const ys: number[] = [];
  // Always include the hold-over sample before the range
  xs.push(t[i0] + offset);
  ys.push(v[i0]);
  let i = i0 + 1;
  while (i <= i1) {
    const bucketStart = Math.floor((t[i] + offset - t0) / secPerPx);
    let min = Infinity;
    let max = -Infinity;
    let minI = i;
    let maxI = i;
    let first = i;
    while (i <= i1 && Math.floor((t[i] + offset - t0) / secPerPx) === bucketStart) {
      const y = v[i];
      if (y < min) {
        min = y;
        minI = i;
      }
      if (y > max) {
        max = y;
        maxI = i;
      }
      i++;
    }
    const last = i - 1;
    // first, min, max (in time order), last — keeps the step shape right
    const picks = new Set([first, minI, maxI, last]);
    const ordered = [...picks].sort((a, b) => a - b);
    for (const k of ordered) {
      xs.push(t[k] + offset);
      ys.push(v[k]);
    }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), n: xs.length };
}

/** Index range [i0, i1] of samples overlapping an aligned window (inclusive, with hold-over). */
export function visibleIndexRange(t: Float64Array, offset: number, t0: number, t1: number): [number, number] {
  const n = t.length;
  if (!n) return [0, -1];
  let i0 = indexAtOrBefore(t, t0 - offset);
  if (i0 < 0) i0 = 0;
  let i1 = indexAtOrBefore(t, t1 - offset) + 1;
  if (i1 > n - 1) i1 = n - 1;
  return [i0, i1];
}
