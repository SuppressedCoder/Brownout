/**
 * Robot profiles. A preset says where the panels go; a profile describes the
 * robot and applies whichever preset or log is open: power subsystems and
 * their motors, swerve settings, robot size, favorite fields and field-name
 * corrections (role overrides). Profiles are saved on this computer and can
 * be exported as one file.
 *
 * This module only holds the data. Choosing a profile for a log and
 * re-running analysis live in state/session.ts and lib/power.ts.
 */
import { createStore } from './store';
import type { Role } from '@core/roles';
import type { SubsystemDef } from '@core/analyzers/subsystems';
import type { CameraDef } from '@core/vision';
import type { ControllerLayout } from '@core/controller';

export interface Subsystem extends SubsystemDef {
  color: string;
}

/** Order of the modules in logged swerve arrays. */
export type SwerveOrder = 'FL,FR,BL,BR' | 'FR,FL,BR,BL' | 'FL,FR,BR,BL' | 'FL,BL,FR,BR';
export const SWERVE_ORDERS: [SwerveOrder, string][] = [
  ['FL,FR,BL,BR', 'FL, FR, BL, BR (WPILib / AdvantageKit)'],
  ['FR,FL,BR,BL', 'FR, FL, BR, BL'],
  ['FL,FR,BR,BL', 'FL, FR, BR, BL (clockwise)'],
  ['FL,BL,FR,BR', 'FL, BL, FR, BR'],
];

export interface Camera extends CameraDef {
  color: string;
  /** Where the camera sits on the robot (m; forward, left). Lines to tags start here instead of the robot center. */
  mount?: { x: number; y: number } | null;
}

/** One piece of the robot's drawing on the 2D field: a shape, a picture or an SVG. */
export interface Layer {
  id: string;
  name: string;
  kind: 'rect' | 'ellipse' | 'image';
  /** Center in the robot frame, meters: x forward, y left. */
  x: number;
  y: number;
  /** Size in meters: length along the robot's forward axis, width across it. */
  length: number;
  width: number;
  /** Degrees, counter-clockwise. */
  rotation: number;
  opacity: number;
  /** Shapes only. */
  color: string;
  /** Pictures and SVGs: a data URL kept inside the profile. */
  src?: string;
  /** A logged angle that turns this part about its pivot. Null or missing: the part does not move. */
  link?: { key: string; unit: 'rad' | 'deg' | 'rot'; offset: number; invert: boolean } | null;
  /** Rotation center for a linked part, in the robot frame (m). */
  pivot: { x: number; y: number };
  /** The part this one is attached to: it moves with that part's turn, and its own adds on top. Missing: attached to the robot. */
  parent?: string | null;
}

/** Part positions and sizes may be up to this far out (m): generous, so a big robot or a long arm fits. */
export const PART_LIMIT = 20;

export const CAMERA_COLORS = ['#2ec4b6', '#c77dff', '#edc948', '#ff9da7', '#9be564', '#ff8c42'];

export interface RobotProfile {
  id: string;
  name: string;
  favorites: string[];
  roleOverrides: Partial<Record<Role, string>>;
  subsystems: Subsystem[];
  swerve: {
    order: SwerveOrder;
    /** Speed (m/s) that draws a full-length arrow; null = the fastest speed in the log. */
    maxSpeed: number | null;
  };
  /** Size with bumpers, meters. */
  robot: { length: number; width: number };
  /** Cameras by hand. Empty: cameras are found from field names in each log. */
  cameras: Camera[];
  /** Extra parts drawn on the robot, bottom first. */
  layers: Layer[];
  controllerLayout: ControllerLayout;
}

export interface BatteryRecord {
  label: string;
  file: string;
  /** Wall-clock time of the log (ms since epoch) when known. */
  when: number | null;
  milliohm: number | null;
  minVoltage: number | null;
  restingVoltage: number | null;
}

export interface ProfilesState {
  profiles: RobotProfile[];
  lastUsedId: string;
  /** Log file name -> profile id, for logs the user assigned by hand. */
  assignments: Record<string, string>;
  /** Log file name -> battery label. */
  batteryLabels: Record<string, string>;
  batteryHistory: BatteryRecord[];
}

export const SUBSYSTEM_COLORS = ['#4f9ef7', '#f28e2b', '#59a14f', '#b07aa1', '#edc948', '#76b7b2', '#e15759', '#ff9da7', '#9c755f', '#bab0ac'];
export const UNASSIGNED_COLOR = '#7a7f89';

const KEY = 'brownout.profiles.v1';

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function blankProfile(name: string): RobotProfile {
  return {
    id: newId('robot'),
    name,
    favorites: [],
    roleOverrides: {},
    subsystems: [],
    swerve: { order: 'FL,FR,BL,BR', maxSpeed: null },
    robot: { length: 0.9, width: 0.9 },
    cameras: [],
    layers: [],
    controllerLayout: 'xbox',
  };
}

/** Fill in anything a stored or imported profile lacks. Returns null when it is not a profile. */
export function normalizeProfile(raw: unknown): RobotProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<RobotProfile>;
  if (typeof p.name !== 'string' || !p.name.trim()) return null;
  const base = blankProfile(p.name.trim());
  const subsystems: Subsystem[] = Array.isArray(p.subsystems)
    ? p.subsystems
        .filter((s) => s && typeof s.name === 'string')
        .map((s, i) => ({
          id: typeof s.id === 'string' ? s.id : newId('sub'),
          name: s.name,
          color: typeof s.color === 'string' ? s.color : SUBSYSTEM_COLORS[i % SUBSYSTEM_COLORS.length],
          channels: Array.isArray(s.channels) ? s.channels.filter((c) => Number.isInteger(c) && c >= 0 && c < 64) : [],
          fields: Array.isArray(s.fields) ? s.fields.filter((k) => typeof k === 'string') : [],
        }))
    : [];
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const cameras: Camera[] = Array.isArray(p.cameras)
    ? p.cameras
        .filter((c) => c && typeof c.name === 'string')
        .map((c, i) => ({
          id: str(c.id) ?? newId('cam'),
          name: c.name,
          color: str(c.color) ?? CAMERA_COLORS[i % CAMERA_COLORS.length],
          poseKey: str(c.poseKey),
          tagIdsKey: str(c.tagIdsKey),
          tagPosesKey: str(c.tagPosesKey),
          mount:
            c.mount && typeof c.mount.x === 'number' && typeof c.mount.y === 'number' ? { x: num(c.mount.x, 0, -2, 2), y: num(c.mount.y, 0, -2, 2) } : null,
        }))
    : [];
  const layers: Layer[] = Array.isArray(p.layers)
    ? p.layers
        .filter((l) => l && typeof l === 'object')
        .map((l, i): Layer => ({
          id: str(l.id) ?? newId('layer'),
          name: str(l.name) ?? `Part ${i + 1}`,
          kind: l.kind === 'ellipse' || l.kind === 'image' ? l.kind : 'rect',
          x: num(l.x, 0, -PART_LIMIT, PART_LIMIT),
          y: num(l.y, 0, -PART_LIMIT, PART_LIMIT),
          length: num(l.length, 0.3, 0.01, PART_LIMIT),
          width: num(l.width, 0.3, 0.01, PART_LIMIT),
          rotation: num(l.rotation, 0, -3600, 3600),
          opacity: num(l.opacity, 1, 0.05, 1),
          color: str(l.color) ?? '#f2c94c',
          // only inline pictures: a profile file must not make the app fetch anything
          src: typeof l.src === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(l.src) ? l.src : undefined,
          link:
            l.link && typeof l.link.key === 'string' && l.link.key
              ? {
                  key: l.link.key,
                  unit: l.link.unit === 'deg' || l.link.unit === 'rot' ? l.link.unit : 'rad',
                  offset: num(l.link.offset, 0, -360, 360),
                  invert: !!l.link.invert,
                }
              : null,
          pivot: { x: num(l.pivot?.x, 0, -PART_LIMIT, PART_LIMIT), y: num(l.pivot?.y, 0, -PART_LIMIT, PART_LIMIT) },
          parent: str(l.parent) ?? null,
        }))
        .filter((l) => l.kind !== 'image' || !!l.src)
    : [];
  // a part may only hang from a part that exists, and never (through others) from itself
  for (const l of layers) {
    const seen = new Set<string>([l.id]);
    let p = l.parent ? layers.find((x) => x.id === l.parent) : undefined;
    if (l.parent && !p) l.parent = null;
    while (p) {
      if (seen.has(p.id)) {
        l.parent = null;
        break;
      }
      seen.add(p.id);
      p = p.parent ? layers.find((x) => x.id === p!.parent) : undefined;
    }
  }
  return {
    id: typeof p.id === 'string' ? p.id : base.id,
    name: base.name,
    favorites: Array.isArray(p.favorites) ? p.favorites.filter((k) => typeof k === 'string') : [],
    roleOverrides: p.roleOverrides && typeof p.roleOverrides === 'object' ? { ...p.roleOverrides } : {},
    subsystems,
    swerve: {
      order: SWERVE_ORDERS.some(([o]) => o === p.swerve?.order) ? p.swerve!.order : base.swerve.order,
      maxSpeed: typeof p.swerve?.maxSpeed === 'number' && p.swerve.maxSpeed > 0 ? p.swerve.maxSpeed : null,
    },
    robot: {
      length: typeof p.robot?.length === 'number' && Number.isFinite(p.robot.length) && p.robot.length > 0.01 ? p.robot.length : base.robot.length,
      width: typeof p.robot?.width === 'number' && Number.isFinite(p.robot.width) && p.robot.width > 0.01 ? p.robot.width : base.robot.width,
    },
    cameras,
    layers,
    controllerLayout: p.controllerLayout === 'playstation' || p.controllerLayout === 'list' ? p.controllerLayout : 'xbox',
  };
}

function load(): ProfilesState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<ProfilesState>;
      const profiles = (s.profiles ?? []).map(normalizeProfile).filter((p): p is RobotProfile => !!p);
      if (profiles.length) {
        return {
          profiles,
          lastUsedId: profiles.some((p) => p.id === s.lastUsedId) ? s.lastUsedId! : profiles[0].id,
          assignments: s.assignments ?? {},
          batteryLabels: s.batteryLabels ?? {},
          batteryHistory: Array.isArray(s.batteryHistory) ? s.batteryHistory : [],
        };
      }
    }
  } catch {
    /* fall through to a fresh state */
  }
  const first = blankProfile('My robot');
  return { profiles: [first], lastUsedId: first.id, assignments: {}, batteryLabels: {}, batteryHistory: [] };
}

export const profileStore = createStore<ProfilesState>(load());

profileStore.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
});

export function profileById(id: string | undefined): RobotProfile {
  const s = profileStore.get();
  return s.profiles.find((p) => p.id === id) ?? s.profiles.find((p) => p.id === s.lastUsedId) ?? s.profiles[0];
}

export function updateProfile(id: string, patch: Partial<RobotProfile> | ((p: RobotProfile) => Partial<RobotProfile>)): void {
  profileStore.set((s) => ({
    profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)),
  }));
}

export function uniqueProfileName(base: string, ignoreId?: string): string {
  const names = profileStore
    .get()
    .profiles.filter((p) => p.id !== ignoreId)
    .map((p) => p.name.toLowerCase());
  if (!names.includes(base.toLowerCase())) return base;
  let i = 2;
  while (names.includes(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}

export function addProfile(p: RobotProfile): RobotProfile {
  const profile = { ...p, id: newId('robot'), name: uniqueProfileName(p.name) };
  profileStore.set((s) => ({ profiles: [...s.profiles, profile] }));
  return profile;
}

/** Remove a profile (never the last one). Logs that used it fall back to the last-used profile. */
export function removeProfile(id: string): void {
  profileStore.set((s) => {
    if (s.profiles.length <= 1) return {};
    const profiles = s.profiles.filter((p) => p.id !== id);
    const assignments = Object.fromEntries(Object.entries(s.assignments).filter(([, v]) => v !== id));
    return { profiles, assignments, lastUsedId: s.lastUsedId === id ? profiles[0].id : s.lastUsedId };
  });
}

/** Every field key a profile refers to. */
export function profileKeys(p: RobotProfile): string[] {
  const out = new Set<string>(p.favorites);
  for (const k of Object.values(p.roleOverrides)) if (k) out.add(k);
  for (const s of p.subsystems) for (const k of s.fields) out.add(k);
  for (const c of p.cameras) for (const k of [c.poseKey, c.tagIdsKey, c.tagPosesKey]) if (k) out.add(k);
  for (const l of p.layers) if (l.link) out.add(l.link.key);
  return [...out];
}

/**
 * The profile for a newly opened log: the one the user assigned to this file
 * before, else the one whose field names fit the log best, else the last one used.
 */
export function chooseProfile(fileName: string, hasField: (key: string) => boolean): string {
  const s = profileStore.get();
  const assigned = s.assignments[fileName];
  if (assigned && s.profiles.some((p) => p.id === assigned)) return assigned;
  if (s.profiles.length > 1) {
    let best: { id: string; score: number } | null = null;
    for (const p of s.profiles) {
      const keys = profileKeys(p);
      if (!keys.length) continue;
      const hit = keys.filter(hasField).length;
      const score = hit / keys.length;
      if (hit > 0 && (!best || score > best.score || (score === best.score && p.id === s.lastUsedId))) best = { id: p.id, score };
    }
    if (best && best.score >= 0.5) return best.id;
  }
  return profileById(s.lastUsedId).id;
}

export function setBatteryLabel(fileName: string, label: string): void {
  profileStore.set((s) => {
    const batteryLabels = { ...s.batteryLabels };
    const trimmed = label.trim();
    if (trimmed) batteryLabels[fileName] = trimmed;
    else delete batteryLabels[fileName];
    // a relabeled log leaves its old record behind otherwise
    return { batteryLabels, batteryHistory: s.batteryHistory.filter((r) => r.file !== fileName) };
  });
}

export function recordBattery(rec: BatteryRecord): void {
  profileStore.set((s) => {
    const prev = s.batteryHistory.find((r) => r.file === rec.file);
    if (
      prev &&
      prev.label === rec.label &&
      prev.milliohm === rec.milliohm &&
      prev.minVoltage === rec.minVoltage &&
      prev.when === rec.when &&
      prev.restingVoltage === rec.restingVoltage
    )
      return {};
    return { batteryHistory: [...s.batteryHistory.filter((r) => r.file !== rec.file), rec].slice(-400) };
  });
}

export function removeBatteryRecord(file: string): void {
  profileStore.set((s) => ({ batteryHistory: s.batteryHistory.filter((r) => r.file !== file) }));
}
