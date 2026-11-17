/**
 * Where the robot's idea of its position and its vision disagree, and when
 * that position jumped. Either can throw off an action that aims or drives
 * by position (auto-align, a path, a shot from a spot).
 *
 * - disagree: a camera's pose estimate is more than `disagree` m from the
 *   robot pose for at least `minDuration` s while enabled. The camera or the
 *   odometry was wrong; the finding says which camera and by how much.
 * - jump: the robot pose moved further in one step than a robot can drive
 *   (`maxSpeed`), by at least `jump` m: the pose estimator snapping to a
 *   vision measurement or an odometry reset. Jumps in the first `settle`
 *   seconds of a mode (auto, teleop) are left out: robot code resets the
 *   position there on purpose.
 *
 * Each finding names what was running then (commands, the auto path), so the
 * user can see which action it may have thrown off. All times are raw seconds.
 * A log without a robot pose or camera estimates simply has no findings.
 */
import { modeAt, type ModeRange } from '../robotState';
import type { CommandRow } from '../commands';

export interface PoseFinding {
  kind: 'disagree' | 'jump';
  start: number;
  end: number;
  /** Camera estimate to robot pose (disagree), or the size of the step (jump), in m: the largest in the stretch. */
  size: number;
  /** The camera, for disagree. */
  camera?: string;
  /** Robot mode at the start. */
  mode: string;
  /** Commands and the auto path running at the start, most specific first. */
  during: string[];
}

export interface DeviationOptions {
  /** Camera estimate this far from the robot pose counts as disagreeing (m). */
  disagree: number;
  /** ...for at least this long (s). */
  minDuration: number;
  /** A camera silent for longer than this ends a stretch (s). */
  maxGap: number;
  /** A pose step at least this large (m)... */
  jump: number;
  /** ...and faster than this (m/s) is a jump, not driving. */
  maxSpeed: number;
  /** Jumps this soon after a mode starts are deliberate resets (s). */
  settle: number;
}

export const DEVIATION_DEFAULTS: DeviationOptions = { disagree: 0.5, minDuration: 0.25, maxGap: 0.5, jump: 0.25, maxSpeed: 8, settle: 0.5 };

function enabledMode(ranges: ModeRange[], t: number): string | null {
  const r = modeAt(ranges, t);
  return r && r.mode !== 'disabled' ? r.mode : null;
}

/** Steps of the robot pose faster than a robot drives, while enabled. Steps less than 0.1 s apart count as one. */
export function findPoseJumps(
  t: ArrayLike<number>,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  ranges: ModeRange[],
  o: DeviationOptions = DEVIATION_DEFAULTS,
): PoseFinding[] {
  const out: PoseFinding[] = [];
  for (let i = 1; i < t.length; i++) {
    const d = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    const dt = t[i] - t[i - 1];
    if (!(d >= o.jump) || !(dt > 0) || d / dt <= o.maxSpeed) continue;
    const r = modeAt(ranges, t[i]);
    if (!r || r.mode === 'disabled' || t[i] - r.start < o.settle) continue;
    const mode = r.mode;
    const last = out[out.length - 1];
    if (last && t[i] - last.end < 0.1) {
      last.end = t[i];
      last.size = Math.max(last.size, d);
    } else out.push({ kind: 'jump', start: t[i], end: t[i], size: d, mode, during: [] });
  }
  return out;
}

/** Stretches where a camera's estimate stays far from the robot pose, from its estimate-error series. */
export function findDisagreements(
  camera: string,
  t: ArrayLike<number>,
  err: ArrayLike<number>,
  ranges: ModeRange[],
  o: DeviationOptions = DEVIATION_DEFAULTS,
): PoseFinding[] {
  const out: PoseFinding[] = [];
  let cur: PoseFinding | null = null;
  const close = () => {
    if (cur && cur.end - cur.start >= o.minDuration) out.push(cur);
    cur = null;
  };
  for (let i = 0; i < t.length; i++) {
    const mode = enabledMode(ranges, t[i]);
    if (!mode || !(err[i] >= o.disagree)) {
      close();
      continue;
    }
    if (cur && t[i] - cur.end <= o.maxGap) {
      cur.end = t[i];
      cur.size = Math.max(cur.size, err[i]);
    } else {
      close();
      cur = { kind: 'disagree', start: t[i], end: t[i], size: err[i], camera, mode, during: [] };
    }
  }
  close();
  return out;
}

/** Fill in what was running at each finding's start: the auto path first, then commands, shortest-running first (the most specific). */
export function annotateFindings(findings: PoseFinding[], commands: CommandRow[], paths: { name: string; start: number; end: number }[], max = 3): void {
  for (const f of findings) {
    const at = f.start;
    const names: string[] = [];
    const path = paths.find((p) => at >= p.start && at <= p.end);
    if (path) names.push(path.name);
    const running: { name: string; len: number }[] = [];
    for (const c of commands) {
      const run = c.runs.find((r) => at >= r.start && at <= r.end);
      if (run) running.push({ name: c.name, len: run.end - run.start });
    }
    running.sort((a, b) => a.len - b.len);
    for (const r of running) if (!names.includes(r.name)) names.push(r.name);
    f.during = names.slice(0, max);
  }
}

/** "Position jumped 0.62 m during AutoAlign (Path 2)" style text. */
export function describeFinding(f: PoseFinding): string {
  const what =
    f.kind === 'jump'
      ? `Robot position jumped ${f.size.toFixed(2)} m`
      : `${f.camera ?? 'A camera'} was ${f.size.toFixed(2)} m from the robot position for ${(f.end - f.start).toFixed(1)} s`;
  return f.during.length ? `${what} during ${f.during[0]}${f.during.length > 1 ? ` (${f.during.slice(1).join(', ')})` : ''}` : what;
}
