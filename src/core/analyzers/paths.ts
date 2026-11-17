/**
 * Path-following analysis (vision & pathing spec §3.3): path-active segments
 * from the logged active path, position/heading error series against the
 * target pose, and a per-path summary.
 */
import type { LogData } from '../log';
import { indexAtOrBefore } from '../log';
import { toPose, wrapAngle, type Pose } from '../field';

export interface PathSegment {
  index: number;
  name: string;
  start: number; // raw s
  end: number;
  duration: number;
  maxPosError?: number;
  rmsPosError?: number;
  maxHeadingError?: number; // rad
  endPosError?: number;
  endHeadingError?: number;
  startPosError?: number;
  points: Pose[];
}

export interface PathAnalysis {
  segments: PathSegment[];
  /** Error series (raw time): e_xy in meters, e_theta in radians. */
  errorT: Float64Array;
  posError: Float64Array;
  headingError: Float64Array;
}

export function analyzePaths(log: LogData, activePathKey?: string, targetPoseKey?: string, robotPoseKey?: string): PathAnalysis | undefined {
  const ap = activePathKey ? log.series(activePathKey) : undefined;
  const tp = targetPoseKey ? log.series(targetPoseKey) : undefined;
  const rp = robotPoseKey ? log.series(robotPoseKey) : undefined;
  if (!ap || ap.kind !== 'struct') return undefined;

  // Segments: an active path becomes non-empty, then empty (or changes).
  const segments: PathSegment[] = [];
  let cur: PathSegment | null = null;
  for (let i = 0; i < ap.t.length; i++) {
    const arr = ap.v[i] as unknown[];
    const pts = Array.isArray(arr) ? (arr.map(toPose).filter(Boolean) as Pose[]) : [];
    if (pts.length >= 2) {
      if (cur && samePath(cur.points, pts)) continue;
      if (cur) cur.end = ap.t[i];
      cur = { index: segments.length, name: `Path ${segments.length + 1}`, start: ap.t[i], end: log.endTs, duration: 0, points: pts };
      segments.push(cur);
    } else if (cur) {
      cur.end = ap.t[i];
      cur = null;
    }
  }

  // Error series from target vs actual
  let errorT = new Float64Array(0);
  let posError = new Float64Array(0);
  let headingError = new Float64Array(0);
  if (tp && tp.kind === 'struct' && rp && rp.kind === 'struct') {
    const n = tp.t.length;
    errorT = new Float64Array(n);
    posError = new Float64Array(n);
    headingError = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const target = toPose(tp.v[i]);
      const j = indexAtOrBefore(rp.t, tp.t[i]);
      const actual = j >= 0 ? toPose(rp.v[j]) : undefined;
      errorT[i] = tp.t[i];
      if (!target || !actual) {
        posError[i] = NaN;
        headingError[i] = NaN;
        continue;
      }
      posError[i] = Math.hypot(target.x - actual.x, target.y - actual.y);
      headingError[i] = wrapAngle(target.theta - actual.theta);
    }
  }

  // PathPlanner keeps the last active path published after the path ends, but it stops
  // publishing the target pose: a path that went quiet ended at its last target.
  if (tp && tp.kind === 'struct' && tp.t.length) {
    for (const seg of segments) {
      const j = indexAtOrBefore(tp.t, seg.end);
      if (j >= 0 && tp.t[j] >= seg.start && seg.end - tp.t[j] > 1) seg.end = tp.t[j];
    }
  }

  for (const seg of segments) {
    seg.duration = seg.end - seg.start;
    if (errorT.length) {
      let max = 0;
      let ss = 0;
      let n = 0;
      let maxH = 0;
      for (let i = 0; i < errorT.length; i++) {
        if (errorT[i] < seg.start || errorT[i] > seg.end) continue;
        const e = posError[i];
        if (!Number.isFinite(e)) continue;
        n++;
        ss += e * e;
        if (e > max) max = e;
        const h = Math.abs(headingError[i]);
        if (h > maxH) maxH = h;
      }
      if (n) {
        seg.maxPosError = max;
        seg.rmsPosError = Math.sqrt(ss / n);
        seg.maxHeadingError = maxH;
      }
    }
    if (rp && rp.kind === 'struct') {
      const last = seg.points[seg.points.length - 1];
      const j = indexAtOrBefore(rp.t, seg.end);
      const actual = j >= 0 ? toPose(rp.v[j]) : undefined;
      if (actual) {
        seg.endPosError = Math.hypot(last.x - actual.x, last.y - actual.y);
        seg.endHeadingError = Math.abs(wrapAngle(last.theta - actual.theta));
      }
      if (seg.index === 0) {
        const k = indexAtOrBefore(rp.t, seg.start);
        const a0 = k >= 0 ? toPose(rp.v[k]) : undefined;
        if (a0) seg.startPosError = Math.hypot(seg.points[0].x - a0.x, seg.points[0].y - a0.y);
      }
    }
  }
  return { segments, errorT, posError, headingError };
}

function samePath(a: Pose[], b: Pose[]): boolean {
  if (a.length !== b.length) return false;
  const la = a[a.length - 1];
  const lb = b[b.length - 1];
  return Math.abs(a[0].x - b[0].x) < 1e-6 && Math.abs(a[0].y - b[0].y) < 1e-6 && Math.abs(la.x - lb.x) < 1e-6 && Math.abs(la.y - lb.y) < 1e-6;
}
