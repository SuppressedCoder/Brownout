/**
 * Field geometry: season presets, the two coordinate frames (blue wall ≤2026,
 * field center 2027), and alliance flipping (vision & pathing spec §1).
 * Brownout keeps one internal frame: field center, +X toward the blue wall...
 * except that for drawing we use a simple "blue wall, +X toward red" canvas
 * mapping, so every pose is converted to blue-wall for the 2D field panel.
 */

export type FieldFrame = 'blueWall' | 'center';
export type Symmetry = 'rotational' | 'mirrored';

export interface AprilTag {
  id: number;
  x: number; // blue-wall frame meters
  y: number;
  z?: number;
  yaw?: number; // radians
}

export interface SeasonPreset {
  id: string;
  name: string;
  length: number; // m
  width: number; // m
  symmetry: Symmetry;
  endgameSeconds: number;
  /** Frame that logs from this season use. */
  logFrame: FieldFrame;
  tags: AprilTag[];
}

export const SEASONS: SeasonPreset[] = [
  { id: '2024', name: '2024 Crescendo', length: 16.541, width: 8.211, symmetry: 'mirrored', endgameSeconds: 20, logFrame: 'blueWall', tags: [] },
  { id: '2025', name: '2025 Reefscape', length: 17.548, width: 8.052, symmetry: 'rotational', endgameSeconds: 20, logFrame: 'blueWall', tags: [] },
  { id: '2026', name: '2026 Rebuilt', length: 16.541, width: 8.069, symmetry: 'rotational', endgameSeconds: 20, logFrame: 'blueWall', tags: [] },
  { id: '2027', name: '2027 (kickoff TBD)', length: 16.541, width: 8.069, symmetry: 'rotational', endgameSeconds: 20, logFrame: 'center', tags: [] },
];

export interface Pose {
  x: number;
  y: number;
  theta: number; // radians
}

/** Center frame -> blue-wall frame (WPILib migration rule, inverted). */
export function centerToBlueWall(p: Pose, L: number, W: number): Pose {
  return { x: L / 2 - p.x, y: W / 2 - p.y, theta: p.theta - Math.PI };
}
export function blueWallToCenter(p: Pose, L: number, W: number): Pose {
  return { x: L / 2 - p.x, y: W / 2 - p.y, theta: p.theta + Math.PI };
}

/** Flip a blue-wall pose to the other alliance per the season symmetry. */
export function flipAlliance(p: Pose, L: number, W: number, symmetry: Symmetry): Pose {
  if (symmetry === 'rotational') return { x: L - p.x, y: W - p.y, theta: p.theta - Math.PI };
  return { x: L - p.x, y: p.y, theta: Math.PI - p.theta };
}

/** Parse a WPILib fields-library JSON (field-tags + field dimensions). */
export function parseFieldJson(json: unknown): { length?: number; width?: number; tags: AprilTag[] } {
  const j = json as {
    field?: { length?: number; width?: number };
    tags?: {
      ID: number;
      pose: { translation: { x: number; y: number; z: number }; rotation: { quaternion: { W: number; X: number; Y: number; Z: number } } };
    }[];
  };
  const tags: AprilTag[] = [];
  for (const t of j.tags ?? []) {
    const q = t.pose.rotation.quaternion;
    // yaw from quaternion
    const yaw = Math.atan2(2 * (q.W * q.Z + q.X * q.Y), 1 - 2 * (q.Y * q.Y + q.Z * q.Z));
    tags.push({ id: t.ID, x: t.pose.translation.x, y: t.pose.translation.y, z: t.pose.translation.z, yaw });
  }
  return { length: j.field?.length, width: j.field?.width, tags };
}

/** Read a Pose2d/Pose3d-shaped decoded struct (or [x,y,deg] array) into a Pose. */
export function toPose(v: unknown): Pose | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    if (v.length >= 3 && typeof v[0] === 'number') return { x: v[0], y: v[1], theta: (v[2] * Math.PI) / 180 };
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const tr = o.translation as Record<string, number> | undefined;
  const rot = o.rotation as Record<string, unknown> | undefined;
  if (tr && typeof tr.x === 'number') {
    let theta = 0;
    if (rot) {
      if (typeof rot.value === 'number') theta = rot.value;
      else if (rot.q && typeof rot.q === 'object') {
        const q = rot.q as Record<string, number>;
        theta = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
      }
    }
    return { x: tr.x, y: tr.y, theta };
  }
  if (typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: o.y, theta: typeof o.theta === 'number' ? o.theta : 0 };
  return undefined;
}

export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
