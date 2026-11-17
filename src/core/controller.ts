/**
 * Driver controllers as the loggers record them.
 *
 * - AdvantageKit: /DriverStation/Joystick<N>/ButtonValues (bit mask),
 *   AxisValues (number[]), POVs (2026, degrees) or POVValues (2027, direction bits).
 * - WPILib DataLogManager (DriverStation.startDataLog): DS:joystick<N>/buttons
 *   (boolean[]), /axes (number[]), /povs (number[]).
 */
export interface ControllerKeys {
  buttons?: string;
  axes?: string;
  povs?: string;
  name?: string;
  /** How POV values are encoded. */
  povMode: 'angle' | 'mask';
}

export function controllerKeys(has: (key: string) => boolean, index: number, era2027: boolean): ControllerKeys | null {
  for (const prefix of ['/DriverStation/Joystick', 'NT:/AdvantageKit/DriverStation/Joystick']) {
    const p = `${prefix}${index}/`;
    if (has(p + 'ButtonValues') || has(p + 'AxisValues')) {
      const mask = has(p + 'POVValues');
      return {
        buttons: has(p + 'ButtonValues') ? p + 'ButtonValues' : undefined,
        axes: has(p + 'AxisValues') ? p + 'AxisValues' : undefined,
        povs: mask ? p + 'POVValues' : has(p + 'POVs') ? p + 'POVs' : undefined,
        name: has(p + 'Name') ? p + 'Name' : undefined,
        povMode: mask ? 'mask' : 'angle',
      };
    }
  }
  const d = `DS:joystick${index}/`;
  if (has(d + 'buttons') || has(d + 'axes'))
    return {
      buttons: has(d + 'buttons') ? d + 'buttons' : undefined,
      axes: has(d + 'axes') ? d + 'axes' : undefined,
      povs: has(d + 'povs') ? d + 'povs' : undefined,
      povMode: era2027 ? 'mask' : 'angle',
    };
  return null;
}

/** Pressed state per button (index 0 is button 1), from a bit mask or a boolean list. */
export function decodeButtons(v: unknown, count = 16): boolean[] {
  if (Array.isArray(v)) return v.map((x) => !!x);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const out: boolean[] = [];
    for (let i = 0; i < count; i++) out.push(Math.floor(v / 2 ** i) % 2 === 1);
    return out;
  }
  return [];
}

/**
 * D-pad direction as (x, y) with right and up positive, or null when it is centered.
 * 'angle': degrees clockwise from up, -1 centered (WPILib through 2026).
 * 'mask': up 1, right 2, down 4, left 8, combined for diagonals (WPILib 2027).
 */
export function decodePov(v: unknown, mode: 'angle' | 'mask'): { x: number; y: number } | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (mode === 'mask') {
    if (v <= 0 || v > 15) return null;
    const x = (v & 2 ? 1 : 0) - (v & 8 ? 1 : 0);
    const y = (v & 1 ? 1 : 0) - (v & 4 ? 1 : 0);
    return x || y ? { x, y } : null;
  }
  if (v < 0) return null;
  const a = (v * Math.PI) / 180;
  return { x: Math.round(Math.sin(a)), y: Math.round(Math.cos(a)) };
}

export type ControllerLayout = 'xbox' | 'playstation' | 'list';

export interface PadMap {
  /** Axis indices. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
  /** Triggers that are buttons, not axes, give a button number here instead. */
  /** Button numbers (1-based, as WPILib counts them). */
  south: number;
  east: number;
  west: number;
  north: number;
  lb: number;
  rb: number;
  back: number;
  start: number;
  ls: number;
  rs: number;
  /** Face-button captions: south, east, west, north. */
  face: [string, string, string, string];
  /** Triggers rest at -1 and reach +1 (PlayStation through 2026) instead of 0..1. */
  triggerBipolar: boolean;
}

/** WPILib's XboxController and PS4Controller / PS5Controller numbering (through 2026). */
export const PAD_MAPS: Record<'xbox' | 'playstation', PadMap> = {
  xbox: {
    lx: 0,
    ly: 1,
    lt: 2,
    rt: 3,
    rx: 4,
    ry: 5,
    south: 1,
    east: 2,
    west: 3,
    north: 4,
    lb: 5,
    rb: 6,
    back: 7,
    start: 8,
    ls: 9,
    rs: 10,
    face: ['A', 'B', 'X', 'Y'],
    triggerBipolar: false,
  },
  playstation: {
    lx: 0,
    ly: 1,
    rx: 2,
    lt: 3,
    rt: 4,
    ry: 5,
    west: 1,
    south: 2,
    east: 3,
    north: 4,
    lb: 5,
    rb: 6,
    back: 9,
    start: 10,
    ls: 11,
    rs: 12,
    face: ['Cross', 'Circle', 'Square', 'Triangle'],
    triggerBipolar: true,
  },
};
