/**
 * Keeps "power by subsystem" up to date. Whenever a log opens, is
 * re-analyzed, changes profile, or its profile's subsystems change, the
 * worker recomputes the report and the /Brownout/Subsystems/... current
 * fields for that log. Also keeps the battery history.
 */
import { sessionStore, type LogEntry } from '../state/session';
import {
  profileStore,
  profileById,
  recordBattery,
  addProfile,
  blankProfile,
  updateProfile,
  SUBSYSTEM_COLORS,
  UNASSIGNED_COLOR,
  type RobotProfile,
  type Layer,
} from '../state/profiles';
import { client } from '../worker/client';
import { UNASSIGNED, type SubsystemDef } from '@core/analyzers/subsystems';

const done = new Map<string, string>();
let timer = 0;
let running = false;
let again = false;

export function subsystemDefs(p: RobotProfile): SubsystemDef[] {
  return p.subsystems.map(({ id, name, channels, fields }) => ({ id, name, channels, fields }));
}

function signature(log: LogEntry, profile: RobotProfile): string {
  return JSON.stringify([
    subsystemDefs(profile),
    log.roles.batteryVoltage,
    log.roles.totalCurrent,
    log.roles.pdhChannelCurrents,
    log.power.brownoutCount,
    log.power.dips.length,
  ]);
}

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const open = new Set(sessionStore.get().logs.map((l) => l.id));
    for (const id of [...done.keys()]) if (!open.has(id)) done.delete(id);
    for (const log of sessionStore.get().logs) {
      const profile = profileById(log.profileId);
      const sig = signature(log, profile);
      if (done.get(log.id) === sig && log.subsystems !== undefined) continue;
      done.set(log.id, sig);
      const defs = subsystemDefs(profile);
      const r = await client.subsystems(log.id, defs, undefined, true);
      sessionStore.set((st) => ({
        logs: st.logs.map((x) => (x.id === log.id ? { ...x, subsystems: defs.length ? r.report : null, fields: r.fields ?? x.fields } : x)),
      }));
    }
    recordBatteries();
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), 150);
}

export function startPowerAnalysis(): void {
  sessionStore.subscribe(schedule);
  profileStore.subscribe(schedule);
  schedule();
}

/** Wall-clock time (ms) of a log's first enable, or its start. */
export function logWallClock(log: LogEntry): number | null {
  const off = log.robotState.epochOffset;
  if (off === undefined || off === null) return null;
  return (off + (log.robotState.firstEnable ?? log.startTs)) * 1000;
}

function recordBatteries(): void {
  const labels = profileStore.get().batteryLabels;
  for (const log of sessionStore.get().logs) {
    const label = labels[log.fileName];
    if (!label) continue;
    recordBattery({
      label,
      file: log.fileName,
      when: logWallClock(log),
      milliohm: log.power.internalResistance === undefined ? null : Math.round(log.power.internalResistance * 10000) / 10,
      minVoltage: log.power.minVoltage ?? null,
      restingVoltage: log.power.restingVoltage ?? null,
    });
  }
}

export function subsystemColor(profile: RobotProfile, id: string): string {
  if (id === UNASSIGNED) return UNASSIGNED_COLOR;
  return profile.subsystems.find((s) => s.id === id)?.color ?? UNASSIGNED_COLOR;
}
export function subsystemName(profile: RobotProfile, id: string): string {
  if (id === UNASSIGNED) return 'Unassigned';
  return profile.subsystems.find((s) => s.id === id)?.name ?? '?';
}

export const nextSubsystemColor = (p: RobotProfile): string =>
  SUBSYSTEM_COLORS.find((c) => !p.subsystems.some((s) => s.color === c)) ?? SUBSYSTEM_COLORS[p.subsystems.length % SUBSYSTEM_COLORS.length];

/** The profile that goes with the bundled demo logs, created (or refreshed) when they are loaded. */
export function ensureDemoProfile(): string {
  const name = 'Demo robot';
  const subsystems = [
    { id: 'drive', name: 'Drive', color: SUBSYSTEM_COLORS[0], channels: [0, 1, 2, 3, 4, 5, 6, 7], fields: [] },
    { id: 'shooter', name: 'Shooter', color: SUBSYSTEM_COLORS[1], channels: [], fields: ['/Shooter/SupplyCurrentAmps'] },
    { id: 'elevator', name: 'Elevator', color: SUBSYSTEM_COLORS[2], channels: [], fields: ['/Elevator/SupplyCurrentAmps'] },
    { id: 'intake', name: 'Intake', color: SUBSYSTEM_COLORS[3], channels: [], fields: ['/Intake/SupplyCurrentAmps'] },
    { id: 'electronics', name: 'Electronics', color: SUBSYSTEM_COLORS[5], channels: [20, 22], fields: [] },
  ];
  // an intake across the front, and a turret that turns with its logged angle
  const layers: Layer[] = [
    {
      id: 'intake',
      name: 'Intake',
      kind: 'rect',
      x: 0.5,
      y: 0,
      length: 0.14,
      width: 0.7,
      rotation: 0,
      opacity: 0.9,
      color: '#6fcf97',
      link: null,
      pivot: { x: 0, y: 0 },
    },
    {
      id: 'turret',
      name: 'Turret',
      kind: 'ellipse',
      x: -0.1,
      y: 0,
      length: 0.36,
      width: 0.36,
      rotation: 0,
      opacity: 0.95,
      color: '#3a3f4b',
      link: null,
      pivot: { x: -0.1, y: 0 },
    },
    {
      id: 'barrel',
      name: 'Shooter barrel',
      kind: 'rect',
      x: 0.1,
      y: 0,
      length: 0.36,
      width: 0.12,
      rotation: 0,
      opacity: 1,
      color: '#f2c94c',
      link: { key: '/Shooter/TurretPositionRad', unit: 'rad', offset: 0, invert: false },
      pivot: { x: -0.1, y: 0 },
    },
  ];
  const existing = profileStore.get().profiles.find((p) => p.name === name);
  if (existing) {
    // a demo profile from an older version has no parts yet
    if (!existing.layers.length) updateProfile(existing.id, { layers });
    return existing.id;
  }
  const p = addProfile({ ...blankProfile(name), subsystems, layers });
  updateProfile(p.id, { name });
  return p.id;
}
