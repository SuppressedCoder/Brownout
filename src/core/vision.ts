/**
 * Cameras and AprilTags. A camera is whatever a team logs about it, each part
 * optional: where the camera thinks the robot is (a pose), which tags it sees
 * (IDs), where it thinks those tags are (tag poses). Teams fill in what they
 * have; the rest is simply not drawn.
 *
 * Understood without setup: the AdvantageKit vision template
 * (/Vision/Camera<i>/TagIds, /RealOutputs/Vision/Camera<i>/RobotPoses and
 * TagPoses) and Limelight botpose arrays mirrored from NetworkTables.
 */
import type { LogData, FieldInfo, Series } from './log';
import { indexAtOrBefore } from './log';
import { toPose, type Pose } from './field';
import type { ModeRange } from './robotState';

export interface CameraDef {
  id: string;
  name: string;
  /** Pose2d / Pose3d (or an array of them, or a Limelight botpose array): where this camera thinks the robot is. */
  poseKey?: string;
  /** Number array of the tag IDs in view (or a Limelight botpose array, which carries them). */
  tagIdsKey?: string;
  /** Pose3d[] / Pose2d[] of the tags in view, for teams that log tag positions instead of IDs. */
  tagPosesKey?: string;
}

const isBotpose = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 6 && typeof v[0] === 'number';

/**
 * Tag IDs from a logged value: a plain list of IDs, or a Limelight botpose
 * array (11 values, then 7 per tag starting with its ID).
 */
export function tagIdsFromValue(v: unknown, botpose: boolean): number[] {
  if (!Array.isArray(v)) return typeof v === 'number' && v >= 0 ? [v] : [];
  if (botpose) {
    const ids: number[] = [];
    for (let i = 11; i + 6 < v.length; i += 7) if (typeof v[i] === 'number' && v[i] > 0) ids.push(Math.round(v[i]));
    return ids;
  }
  return (v as unknown[]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0).map((x) => Math.round(x));
}

/**
 * A robot pose from a logged value: a pose struct, the last of an array of
 * pose structs, or a Limelight botpose array (x, y, z, roll, pitch, yaw in
 * degrees; index 7 is the tag count, and all zeros means "no estimate").
 */
export function poseFromValue(v: unknown): Pose | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    if (typeof v[0] === 'object') return toPose(v[v.length - 1]);
    if (isBotpose(v)) {
      if (v.length >= 8 ? !(v[7] > 0) : v[0] === 0 && v[1] === 0) return undefined;
      return { x: v[0], y: v[1], theta: (v[5] * Math.PI) / 180 };
    }
    return undefined;
  }
  return toPose(v);
}

/** Tag positions from a logged Pose3d[] / Pose2d[] (field frame of the log). */
export function tagPosesFromValue(v: unknown): Pose[] {
  if (!Array.isArray(v)) return [];
  const out: Pose[] = [];
  for (const x of v) {
    const p = typeof x === 'object' ? toPose(x) : undefined;
    if (p) out.push(p);
  }
  return out;
}

export const isBotposeKey = (key: string): boolean => /botpose/i.test(key);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'camera';
const POSE_STRUCTS = ['Pose2d', 'Pose3d'];
const isPoseField = (f: FieldInfo) => (f.kind === 'struct' || f.kind === 'struct[]') && POSE_STRUCTS.includes(f.structName ?? '');

/** Find cameras from field names. Each part is optional. */
export function detectCameras(fields: FieldInfo[]): CameraDef[] {
  const real = fields.filter((f) => !f.generated && !f.hidden);
  const byKey = new Map(real.map((f) => [f.key, f]));
  const cams: CameraDef[] = [];
  const used = new Set<string>();
  const add = (c: CameraDef) => {
    let id = c.id;
    for (let n = 2; cams.some((x) => x.id === id); n++) id = `${c.id}-${n}`;
    cams.push({ ...c, id });
    for (const k of [c.poseKey, c.tagIdsKey, c.tagPosesKey]) if (k) used.add(k);
  };

  // AdvantageKit vision template
  for (const f of real) {
    const m = /^(.*\/)?Vision\/Camera(\d+)\/TagIds$/.exec(f.key);
    if (!m || f.kind !== 'number[]') continue;
    const n = m[2];
    const out = [`/RealOutputs/Vision/Camera${n}/`, `/ReplayOutputs/Vision/Camera${n}/`, `NT:/AdvantageKit/RealOutputs/Vision/Camera${n}/`];
    const pick = (names: string[]) => {
      for (const o of out) for (const name of names) if (byKey.has(o + name) && isPoseField(byKey.get(o + name)!)) return o + name;
      return undefined;
    };
    add({
      id: `camera-${n}`,
      name: `Camera ${n}`,
      tagIdsKey: f.key,
      poseKey: pick(['RobotPosesAccepted', 'RobotPoses', 'RobotPose']),
      tagPosesKey: pick(['TagPoses']),
    });
  }

  // Limelight arrays mirrored from NetworkTables
  const lime = new Map<string, FieldInfo[]>();
  for (const f of real) {
    const m = /^(?:NT:)?\/(limelight[^/]*)\/(botpose\w*)$/i.exec(f.key);
    if (m && f.kind === 'number[]') lime.set(m[1], [...(lime.get(m[1]) ?? []), f]);
  }
  for (const [name, list] of lime) {
    const rank = (k: string) => (/botpose_orb_wpiblue$/i.test(k) ? 0 : /botpose_wpiblue$/i.test(k) ? 1 : /botpose$/i.test(k) ? 3 : 2);
    const best = [...list].sort((a, b) => rank(a.key) - rank(b.key))[0];
    add({ id: slug(name), name, poseKey: best.key, tagIdsKey: best.key });
  }

  // Anything else: a list of tag IDs, with a pose estimate from the same folder when there is one
  for (const f of real) {
    if (used.has(f.key) || f.kind !== 'number[]') continue;
    if (!/(tag|fiducial|target)_?ids?$/i.test(f.key)) continue;
    const dir = f.key.slice(0, f.key.lastIndexOf('/') + 1);
    const parts = dir.split('/').filter(Boolean);
    const pose = real.find(
      (p) =>
        p.key.startsWith(dir) &&
        !p.key.slice(dir.length).includes('/') &&
        isPoseField(p) &&
        /(robot|estimat|vision).*pose|pose.*estimat/i.test(p.key.slice(dir.length)),
    );
    add({ id: slug(parts[parts.length - 1] ?? 'camera'), name: parts[parts.length - 1] ?? 'Camera', tagIdsKey: f.key, poseKey: pose?.key });
  }
  return cams;
}

export interface CameraSummary {
  id: string;
  name: string;
  /** Sources assigned to this camera that the log does not have. */
  missing: string[];
  /** Fraction of enabled time with at least one tag in view (NaN when tags are not logged). */
  seenFraction: number;
  /** Stretches of at least `minBlind` seconds while enabled with no tag in view (raw seconds). */
  blind: { start: number; end: number }[];
  /** Distance between this camera's estimate and the robot pose, when both are logged (m). */
  meanError?: number;
  maxError?: number;
}

export interface CameraSeries {
  id: string;
  name: string;
  /** Tags in view over time: "7, 8", or "" when none. */
  seen?: { t: Float64Array; labels: string[]; counts: Float64Array };
  /** Estimate-to-pose distance over time (m). */
  error?: { t: Float64Array; v: Float64Array };
}

function tagsAt(series: Series | undefined, botpose: boolean): { t: Float64Array; ids: number[][] } | null {
  if (!series || series.kind !== 'array') return null;
  return { t: series.t, ids: series.v.map((v) => tagIdsFromValue(v, botpose)) };
}

/** Per-camera tags-seen and estimate-error series, with a summary of how well each camera saw the field. */
export function analyzeCameras(
  log: LogData,
  cameras: CameraDef[],
  ranges: ModeRange[],
  robotPoseKey: string | undefined,
  minBlind = 2,
): { summaries: CameraSummary[]; series: CameraSeries[] } {
  const enabled = ranges.filter((r) => r.mode !== 'disabled');
  const poseS = robotPoseKey ? log.series(robotPoseKey) : undefined;
  const summaries: CameraSummary[] = [];
  const out: CameraSeries[] = [];
  for (const cam of cameras) {
    const missing: string[] = [];
    const cs: CameraSeries = { id: cam.id, name: cam.name };
    const sum: CameraSummary = { id: cam.id, name: cam.name, missing, seenFraction: NaN, blind: [] };

    // Tags in view: IDs when logged, else the number of tag poses
    let seen: { t: Float64Array; ids: number[][] } | null = null;
    if (cam.tagIdsKey) {
      seen = tagsAt(log.series(cam.tagIdsKey), isBotposeKey(cam.tagIdsKey));
      if (!seen) missing.push(cam.tagIdsKey);
    }
    let counts: number[] | null = seen ? seen.ids.map((x) => x.length) : null;
    let labels: string[] | null = seen ? seen.ids.map((x) => x.join(', ')) : null;
    let st = seen?.t;
    if (cam.tagPosesKey) {
      const s = log.series(cam.tagPosesKey);
      if (!s || s.kind !== 'struct') missing.push(cam.tagPosesKey);
      else if (!seen) {
        st = s.t;
        counts = s.v.map((v) => tagPosesFromValue(v).length);
        labels = counts.map((c) => (c ? `${c} tag${c === 1 ? '' : 's'}` : ''));
      }
    }
    if (st && counts && labels) {
      cs.seen = { t: st, labels, counts: Float64Array.from(counts) };
      // time with a tag in view, and blind stretches, inside each enabled range
      let seenTime = 0;
      let total = 0;
      for (const r of enabled) {
        total += r.end - r.start;
        let i = Math.max(0, indexAtOrBefore(st, r.start));
        let blindFrom: number | null = null;
        const close = (t: number) => {
          if (blindFrom !== null && t - blindFrom >= minBlind) sum.blind.push({ start: blindFrom, end: t });
          blindFrom = null;
        };
        if (st[i] > r.start) blindFrom = r.start; // nothing logged yet
        for (; i < st.length && st[i] < r.end; i++) {
          const a = Math.max(st[i], r.start);
          const b = Math.min(i + 1 < st.length ? st[i + 1] : r.end, r.end);
          if (b <= a) continue;
          if (counts[i] > 0) {
            seenTime += b - a;
            close(a);
          } else if (blindFrom === null) blindFrom = a;
        }
        close(r.end);
      }
      sum.seenFraction = total > 0 ? seenTime / total : NaN;
    }

    // Estimate against the robot pose
    if (cam.poseKey) {
      const es = log.series(cam.poseKey);
      if (!es || (es.kind !== 'struct' && es.kind !== 'array')) missing.push(cam.poseKey);
      else if (poseS && poseS.kind === 'struct') {
        const t: number[] = [];
        const v: number[] = [];
        let total = 0;
        let max = 0;
        for (let i = 0; i < es.t.length; i++) {
          const est = poseFromValue(es.v[i]);
          if (!est) continue;
          const k = indexAtOrBefore(poseS.t, es.t[i]);
          const robot = k >= 0 ? toPose(poseS.v[k]) : undefined;
          if (!robot) continue;
          const d = Math.hypot(est.x - robot.x, est.y - robot.y);
          t.push(es.t[i]);
          v.push(d);
          total += d;
          if (d > max) max = d;
        }
        if (t.length) {
          cs.error = { t: Float64Array.from(t), v: Float64Array.from(v) };
          sum.meanError = total / t.length;
          sum.maxError = max;
        }
      }
    }
    summaries.push(sum);
    out.push(cs);
  }
  return { summaries, series: out };
}
