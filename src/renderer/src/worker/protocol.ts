/** Messages between the renderer and the log worker. */
import type { PoseFinding } from '@core/analyzers/poseDeviations';
import type { FieldInfo, Series } from '@core/log';
import type { RobotStateSummary, MatchInfo, Era } from '@core/robotState';
import type { HealthItem } from '@core/analyzers/health';
import type { ConsoleLine, PointEvent } from '@core/analyzers/events';
import type { PowerReport } from '@core/analyzers/power';
import type { PathSegment } from '@core/analyzers/paths';
import type { Role } from '@core/roles';
import type { SubsystemDef, SubsystemReport } from '@core/analyzers/subsystems';
import type { CameraDef, CameraSummary } from '@core/vision';

export interface LogSummary {
  id: string;
  name: string;
  path?: string;
  size: number;
  fields: FieldInfo[];
  startTs: number;
  endTs: number;
  recordCount: number;
  truncated: boolean;
  /** Records whose timestamp was impossible and was replaced by the time they were written. */
  repairedTimestamps: number;
  robotState: RobotStateSummary;
  matchInfo: MatchInfo;
  era: Era;
  loggers: string[];
  metadata: Record<string, string>;
  health: HealthItem[];
  console: ConsoleLine[];
  events: PointEvent[];
  power: PowerReport;
  pathSegments: PathSegment[];
  /** Selected auto routine name, from the auto chooser when logged. */
  autoRoutine?: string;
  roles: Partial<Record<Role, string>>;
  roleCandidates: Partial<Record<Role, string[]>>;
  loadMs: number;
}

export type WorkerRequest =
  | { type: 'open'; id: string; name: string; path?: string; buffer: ArrayBuffer; roleOverrides?: Partial<Record<Role, string>> }
  | { type: 'close'; id: string }
  | { type: 'series'; id: string; key: string }
  | { type: 'reanalyze'; id: string; roleOverrides: Partial<Record<Role, string>>; brownoutThreshold: number }
  /** Power by subsystem. `updateDerived` also rebuilds the /Brownout/Subsystems/... fields (whole-log requests). */
  | { type: 'subsystems'; id: string; seq: number; defs: SubsystemDef[]; range?: [number, number]; updateDerived: boolean }
  /** Cameras: rebuilds the /Brownout/Vision/<camera>/... fields and returns how well each camera saw the field. */
  | { type: 'cameras'; id: string; seq: number; cameras: CameraDef[] };

export type LoadStage = 'read' | 'index' | 'analyze';

export type WorkerResponse =
  | { type: 'opened'; summary: LogSummary }
  | { type: 'progress'; id: string; stage: LoadStage; fraction: number }
  | { type: 'series'; id: string; key: string; series: Series | null }
  | { type: 'reanalyzed'; summary: LogSummary }
  | { type: 'subsystems'; id: string; seq: number; report: SubsystemReport | null; fields?: FieldInfo[] }
  | { type: 'cameras'; id: string; seq: number; summaries: CameraSummary[] | null; fields?: FieldInfo[]; findings?: PoseFinding[] }
  | { type: 'error'; id?: string; message: string };

/** Derived fields the worker adds to the field list. */
export const DERIVED_PREFIX = '/Brownout/';
/** Derived current-per-subsystem fields live under this prefix. */
export const SUBSYSTEM_PREFIX = '/Brownout/Subsystems/';
/** Derived per-camera fields (tags seen, tag count, estimate error) live under this prefix. */
export const VISION_PREFIX = '/Brownout/Vision/';
