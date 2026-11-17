/**
 * Robot state (enabled / auto / teleop / utility), match info, era detection
 * and wall-clock anchors, resolved through priority key tables so AdvantageKit,
 * DataLogManager (≤2026 and 2027), the 2027 FIRST DS and Phoenix-converted
 * logs all work. Adapted from the mapping in frc-log-format-reference.md §1.10
 * (itself adapted from AdvantageScope's RobotState.ts, BSD-3, Littleton Robotics).
 */
import type { LogData, Series } from './log';
import { indexAtOrBefore } from './log';

export type RobotMode = 'disabled' | 'auto' | 'teleop' | 'test';

export interface ModeRange {
  start: number; // raw log seconds
  end: number;
  mode: RobotMode;
  estop?: boolean;
}

export interface MatchInfo {
  eventName?: string;
  matchType?: string;
  matchNumber?: number;
  alliance?: 'red' | 'blue';
  station?: number;
  fmsAttached?: boolean;
}

export type Era = '2026' | '2027' | 'unknown';

export interface RobotStateSummary {
  ranges: ModeRange[];
  source: string | null; // key used for enabled
  modeSource: string | null;
  firstEnable?: number;
  autoStart?: number;
  teleopStart?: number;
  autoEnd?: number;
  teleopEnd?: number;
  lastDisable?: number;
  /** epoch seconds minus raw seconds, if a wall clock is logged */
  epochOffset?: number;
  matchTimeKey?: string;
}

interface KeySpec {
  key: string;
  decode: string;
}

/** Enabled sources in priority order. */
export const ENABLED_KEYS: KeySpec[] = [
  { key: '/DriverStation/Enabled', decode: 'bool' },
  { key: 'NT:/AdvantageKit/DriverStation/Enabled', decode: 'bool' },
  { key: 'DS:controlWord/enabled', decode: 'bool' },
  { key: 'DS:enabled', decode: 'bool' },
  { key: 'DS:/Dscomm/Control/Robot/ControlData/ControlWord', decode: 'dsWordEnabled' },
  { key: '/DSLog/Status/DSDisabled', decode: 'boolInverted' },
  { key: 'RobotEnable', decode: 'bool' },
  { key: 'NT:/DriverStation/ControlWord/enabled', decode: 'bool' },
  { key: 'NT:/FMSInfo/FMSControlData', decode: 'fmsBit0' },
];

/** Mode sources in priority order. Each yields auto / teleop / test. */
export const MODE_KEYS: KeySpec[] = [
  { key: '/DriverStation/RobotMode', decode: 'modeString' },
  { key: 'NT:/AdvantageKit/DriverStation/RobotMode', decode: 'modeString' },
  { key: '/DriverStation/Autonomous', decode: 'autoBool' },
  { key: 'NT:/AdvantageKit/DriverStation/Autonomous', decode: 'autoBool' },
  { key: 'DS:controlWord/robotMode', decode: 'modeString' },
  { key: 'DS:autonomous', decode: 'autoBool' },
  { key: 'DS:/Dscomm/Control/Robot/ControlData/ControlWord', decode: 'dsWordMode' },
  { key: '/DSLog/Status/DSTeleop', decode: 'autoBoolInverted' },
  { key: 'RobotMode', decode: 'modeString' },
  { key: 'NT:/DriverStation/ControlWord/robotMode', decode: 'modeString' },
  { key: 'NT:/FMSInfo/FMSControlData', decode: 'fmsMode' },
];

/** Companion test/utility boolean for the autoBool sources. */
const TEST_KEYS: Record<string, string> = {
  '/DriverStation/Autonomous': '/DriverStation/Test',
  'NT:/AdvantageKit/DriverStation/Autonomous': 'NT:/AdvantageKit/DriverStation/Test',
  'DS:autonomous': 'DS:test',
};

const ESTOP_KEYS = ['/DriverStation/EStop', 'DS:controlWord/eStop', 'DS:estop', 'NT:/DriverStation/ControlWord/eStop'];

export const MATCH_TIME_KEYS = ['/DriverStation/MatchTime', 'NT:/AdvantageKit/DriverStation/MatchTime', 'DS:matchTime'];

export const WALL_CLOCK_KEYS: KeySpec[] = [
  { key: '/SystemStats/EpochTimeMicros', decode: 'us' },
  { key: 'NT:/AdvantageKit/SystemStats/EpochTimeMicros', decode: 'us' },
  { key: 'systemTime', decode: 'us' },
];

const EVENT_KEYS = [
  '/DriverStation/EventName',
  'NT:/AdvantageKit/DriverStation/EventName',
  'DS:/Dscomm/Control/Robot/MatchInfo/EventName',
  'NT:/DriverStation/EventName',
  'NT:/FMSInfo/EventName',
  'NT:/Netcomm/Control/MatchInfo/EventName',
  'DS:matchInfo/eventName',
];
const MATCH_TYPE_KEYS = EVENT_KEYS.map((k) => k.replace(/EventName|eventName/, (m) => (m === 'EventName' ? 'MatchType' : 'matchType')));
const MATCH_NUMBER_KEYS = EVENT_KEYS.map((k) => k.replace(/EventName|eventName/, (m) => (m === 'EventName' ? 'MatchNumber' : 'matchNumber')));
const ALLIANCE_STATION_KEYS = ['/DriverStation/AllianceStation', 'NT:/AdvantageKit/DriverStation/AllianceStation', 'DS:allianceStation', 'AllianceStation'];
const IS_RED_KEYS = ['NT:/DriverStation/IsRedAlliance', 'NT:/FMSInfo/IsRedAlliance'];
const STATION_KEYS = ['NT:/DriverStation/StationNumber', 'NT:/FMSInfo/StationNumber'];
const FMS_KEYS = ['/DriverStation/FMSAttached', 'DS:controlWord/fmsAttached', 'DS:fms', 'NT:/DriverStation/ControlWord/fmsAttached'];

function firstPresent(log: LogData, keys: string[]): string | undefined {
  return keys.find((k) => {
    const f = log.field(k);
    return f && f.count > 0;
  });
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return Number(v);
  return NaN;
}

function decodeEnabled(decode: string, v: unknown): boolean {
  switch (decode) {
    case 'bool':
      return Boolean(v);
    case 'boolInverted':
      return !v;
    case 'fmsBit0':
      return (asNumber(v) & 1) !== 0;
    case 'dsWordEnabled':
      return (asNumber(v) & 1) !== 0;
  }
  return false;
}

function decodeMode(decode: string, v: unknown, testV: unknown): 'auto' | 'teleop' | 'test' {
  switch (decode) {
    case 'modeString': {
      const s = String(v ?? '').toLowerCase();
      if (typeof v === 'number') return v === 1 ? 'auto' : v === 3 ? 'test' : 'teleop';
      if (s.startsWith('auto')) return 'auto';
      if (s === 'utility' || s === 'test') return 'test';
      return 'teleop';
    }
    case 'autoBool':
      if (testV) return 'test';
      return v ? 'auto' : 'teleop';
    case 'autoBoolInverted':
      return !v ? 'auto' : 'teleop';
    case 'fmsMode': {
      const n = asNumber(v);
      if (n & 4) return 'test';
      if (n & 2) return 'auto';
      return 'teleop';
    }
    case 'dsWordMode': {
      const m = (asNumber(v) >> 1) & 3;
      return m === 1 ? 'auto' : m === 3 ? 'test' : 'teleop';
    }
  }
  return 'teleop';
}

function sampleAt(s: Series | undefined, t: number): unknown {
  if (!s) return undefined;
  const i = indexAtOrBefore(s.t, t);
  return i < 0 ? undefined : s.v[i];
}

export function computeRobotState(log: LogData): RobotStateSummary {
  const enabledSpec = ENABLED_KEYS.find((k) => (log.field(k.key)?.count ?? 0) > 0);
  const modeSpec = MODE_KEYS.find((k) => (log.field(k.key)?.count ?? 0) > 0);
  const out: RobotStateSummary = { ranges: [], source: enabledSpec?.key ?? null, modeSource: modeSpec?.key ?? null };

  // Wall clock
  for (const w of WALL_CLOCK_KEYS) {
    const s = log.series(w.key);
    if (s && s.kind === 'number' && s.t.length) {
      // use the last sample (DS time sync may arrive late)
      const i = s.t.length - 1;
      const epoch = s.v[i] / 1e6;
      if (epoch > 1e9) {
        out.epochOffset = epoch - s.t[i];
        break;
      }
    }
  }
  out.matchTimeKey = firstPresent(log, MATCH_TIME_KEYS);

  if (!enabledSpec) {
    out.ranges = [{ start: log.startTs, end: log.endTs, mode: 'disabled' }];
    return out;
  }

  const enS = log.series(enabledSpec.key);
  const modeS = modeSpec ? log.series(modeSpec.key) : undefined;
  const testKey = modeSpec ? TEST_KEYS[modeSpec.key] : undefined;
  const testS = testKey ? log.series(testKey) : undefined;
  const estopKey = firstPresent(log, ESTOP_KEYS);
  const estopS = estopKey ? log.series(estopKey) : undefined;

  const times = new Set<number>();
  for (const s of [enS, modeS, testS, estopS]) if (s) for (let i = 0; i < s.t.length; i++) times.add(s.t[i]);
  const sorted = [...times].sort((a, b) => a - b);

  const ranges: ModeRange[] = [];
  let cur: ModeRange | null = null;
  const push = (t: number, mode: RobotMode, estop: boolean) => {
    if (cur && cur.mode === mode && Boolean(cur.estop) === estop) return;
    if (cur) cur.end = t;
    cur = { start: t, end: t, mode, estop: estop || undefined };
    ranges.push(cur);
  };
  push(log.startTs, 'disabled', false);
  for (const t of sorted) {
    const enabled = decodeEnabled(enabledSpec.decode, sampleAt(enS, t));
    const estop = Boolean(sampleAt(estopS, t));
    if (!enabled) push(t, 'disabled', estop);
    else push(t, modeSpec ? decodeMode(modeSpec.decode, sampleAt(modeS, t), sampleAt(testS, t)) : 'teleop', estop);
  }
  if (cur) (cur as ModeRange).end = log.endTs;
  out.ranges = ranges.filter((r) => r.end > r.start || ranges.length === 1);

  const firstEnabled = out.ranges.find((r) => r.mode !== 'disabled');
  out.firstEnable = firstEnabled?.start;
  const auto = out.ranges.find((r) => r.mode === 'auto');
  const teleop = out.ranges.find((r) => r.mode === 'teleop' && (!auto || r.start >= auto.start));
  out.autoStart = auto?.start;
  out.autoEnd = auto?.end;
  out.teleopStart = teleop?.start;
  out.teleopEnd = teleop?.end;
  const lastEnabled = [...out.ranges].reverse().find((r) => r.mode !== 'disabled');
  out.lastDisable = lastEnabled?.end;
  return out;
}

export function modeAt(ranges: ModeRange[], t: number): ModeRange | undefined {
  for (const r of ranges) if (t >= r.start && t < r.end) return r;
  return ranges.length && t >= ranges[ranges.length - 1].start ? ranges[ranges.length - 1] : undefined;
}

export function computeMatchInfo(log: LogData): MatchInfo {
  const info: MatchInfo = {};
  const lastValue = (keys: string[]): unknown => {
    const k = firstPresent(log, keys);
    if (!k) return undefined;
    const s = log.series(k);
    if (!s || !s.t.length) return undefined;
    // last non-empty
    for (let i = s.t.length - 1; i >= 0; i--) {
      const v = s.v[i];
      if (v !== '' && v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const ev = lastValue(EVENT_KEYS);
  if (typeof ev === 'string' && ev) info.eventName = ev;
  const mt = lastValue(MATCH_TYPE_KEYS);
  if (mt !== undefined) info.matchType = matchTypeName(mt);
  const mn = lastValue(MATCH_NUMBER_KEYS);
  if (mn !== undefined && Number.isFinite(asNumber(mn))) info.matchNumber = asNumber(mn);
  const st = lastValue(ALLIANCE_STATION_KEYS);
  if (st !== undefined) {
    const s = typeof st === 'string' ? st : String(st);
    const n = asNumber(st);
    if (typeof st === 'string') {
      const l = s.toLowerCase();
      if (l.includes('red')) info.alliance = 'red';
      else if (l.includes('blue')) info.alliance = 'blue';
      const m = s.match(/(\d)/);
      if (m) info.station = Number(m[1]);
    } else if (Number.isFinite(n)) {
      // HAL AllianceStationID: 0-2 red 1-3, 3-5 blue 1-3 (AdvantageKit logs the enum ordinal)
      info.alliance = n <= 2 ? 'red' : 'blue';
      info.station = (n % 3) + 1;
    }
  } else {
    const red = lastValue(IS_RED_KEYS);
    if (red !== undefined) info.alliance = red ? 'red' : 'blue';
    const sn = lastValue(STATION_KEYS);
    if (sn !== undefined) info.station = asNumber(sn);
  }
  const fms = lastValue(FMS_KEYS);
  if (fms !== undefined) info.fmsAttached = Boolean(fms);
  return info;
}

function matchTypeName(v: unknown): string {
  if (typeof v === 'string') return v;
  const n = asNumber(v);
  return ['None', 'Practice', 'Qualification', 'Elimination'][n] ?? String(v);
}

export function detectEra(log: LogData): Era {
  const has = (k: string) => (log.field(k)?.count ?? 0) > 0;
  if (
    log.field('DS:controlWord') ||
    has('/SystemStats/Versions/WPILib') ||
    has('/DriverStation/RobotMode') ||
    has('NT:/DriverStation/ControlWord/enabled') ||
    log.fields.some((f) => f.key.startsWith('DS:/Dscomm/'))
  )
    return '2027';
  if (has('DS:enabled') || has('/DriverStation/Autonomous') || has('NT:/FMSInfo/FMSControlData') || has('NT:/AdvantageKit/DriverStation/Autonomous'))
    return '2026';
  return 'unknown';
}
