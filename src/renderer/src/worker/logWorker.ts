/// <reference lib="webworker" />
/**
 * The data core runs here, off the UI thread: index, decode, analyze.
 * Series are sent to the renderer once per field and cached there.
 */
import { LogData, type FieldInfo, type Series } from '@core/log';
import { computeRobotState, computeMatchInfo, detectEra } from '@core/robotState';
import { checkLoggingHealth, readMetadata, detectLogger } from '@core/analyzers/health';
import { extractConsole, extractEvents, type PointEvent } from '@core/analyzers/events';
import { analyzePower, DEFAULT_THRESHOLDS, type PowerReport } from '@core/analyzers/power';
import { computeSubsystems, UNASSIGNED } from '@core/analyzers/subsystems';
import { analyzePaths } from '@core/analyzers/paths';
import { resolveRole, resolveRoleCandidates, type Role } from '@core/roles';
import type { WorkerRequest, WorkerResponse, LogSummary } from './protocol';
import { DERIVED_PREFIX, SUBSYSTEM_PREFIX, VISION_PREFIX } from './protocol';
import { analyzeCameras } from '@core/vision';
import { findPoseJumps, findDisagreements, annotateFindings, describeFinding, type PoseFinding } from '@core/analyzers/poseDeviations';
import { commandRowsFromLog, type CommandRow } from '@core/commands';
import type { ModeRange } from '@core/robotState';

interface Loaded {
  log: LogData;
  name: string;
  path?: string;
  size: number;
  derived: Map<string, Series>;
  derivedFields: FieldInfo[];
  /** Current per subsystem, rebuilt whenever the robot profile's subsystems change. */
  subDerived: Map<string, Series>;
  subFields: FieldInfo[];
  /** Tags seen, tag count and estimate error per camera, rebuilt whenever the cameras change. */
  camDerived: Map<string, Series>;
  camFields: FieldInfo[];
  power?: PowerReport;
  roles: Partial<Record<Role, string>>;
  ranges: ModeRange[];
  /** Auto paths, to say which one a finding happened in. */
  pathSpans: { name: string; start: number; end: number }[];
  /** The log's commands, read once when first needed. */
  commandRows?: CommandRow[];
}

/** The log's commands from its best source, cached. */
function commandsOf(L: Loaded): CommandRow[] {
  if (!L.commandRows) L.commandRows = commandRowsFromLog(L.log);
  return L.commandRows;
}

const visionEvent = (f: PoseFinding): PointEvent => ({ t: f.start, kind: 'vision', text: describeFinding(f), finding: f });

const allFields = (L: Loaded): FieldInfo[] => [...L.log.fields, ...L.derivedFields, ...L.subFields, ...L.camFields];

const logs = new Map<string, Loaded>();
const ROLES: Role[] = [
  'batteryVoltage',
  'brownout',
  'totalCurrent',
  'pdhChannelCurrents',
  'totalEnergy',
  'robotPose',
  'activePath',
  'targetPose',
  'visionPose',
  'loopTime',
  'canUtilization',
  'console',
  'gitSha',
  'autoRoutine',
  'swerveMeasured',
  'swerveSetpoint',
  'chassisSpeeds',
  'matchTime',
];

/** m/s: no FRC robot drives faster; a faster pose step is a correction, not motion. */
const MAX_ROBOT_SPEED = 8;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function summarize(id: string, L: Loaded, overrides: Partial<Record<Role, string>> | undefined, brownoutThreshold: number, loadMs: number): LogSummary {
  const log = L.log;
  const robotState = computeRobotState(log);
  const roles: Partial<Record<Role, string>> = {};
  const roleCandidates: Partial<Record<Role, string[]>> = {};
  for (const r of ROLES) {
    const c = resolveRoleCandidates(log, r, overrides);
    if (c.length) {
      roles[r] = c[0];
      roleCandidates[r] = c.slice(0, 8);
    }
  }
  const consoleLines = extractConsole(log);
  const events = extractEvents(log, consoleLines);
  let poseJumps: PoseFinding[] = [];
  const power = analyzePower(log, robotState.ranges, { ...DEFAULT_THRESHOLDS, brownout: brownoutThreshold });
  L.power = power;
  L.roles = roles;
  L.ranges = robotState.ranges;
  const paths = analyzePaths(log, roles.activePath, roles.targetPose, roles.robotPose);

  // Derived fields
  L.derived.clear();
  L.derivedFields = [];
  const addDerived = (key: string, unit: string | undefined, t: Float64Array, v: Float64Array) => {
    L.derived.set(key, { kind: 'number', t, v });
    L.derivedFields.push({
      key,
      type: 'double',
      kind: 'number',
      count: t.length,
      metadata: '',
      unit,
      generated: true,
      hidden: false,
      firstTs: t[0] ?? 0,
      lastTs: t[t.length - 1] ?? 0,
    });
  };
  if (paths && paths.errorT.length) {
    addDerived(`${DERIVED_PREFIX}Path/PositionError`, 'm', paths.errorT, paths.posError);
    addDerived(`${DERIVED_PREFIX}Path/HeadingError`, 'rad', paths.errorT, paths.headingError);
  }
  // Pose x/y/heading convenience + speed from pose
  if (roles.robotPose) {
    const s = log.series(roles.robotPose);
    if (s && s.kind === 'struct' && s.t.length > 2) {
      const n = s.t.length;
      const speed = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const a = s.v[i - 1] as { translation?: { x: number; y: number } };
        const b = s.v[i] as { translation?: { x: number; y: number } };
        const dt = s.t[i] - s.t[i - 1];
        const v = a.translation && b.translation && dt > 0 ? Math.hypot(b.translation.x - a.translation.x, b.translation.y - a.translation.y) / dt : NaN;
        // A step faster than any robot drives is the pose estimator snapping to a vision measurement
        // (or an odometry reset), not motion: leave a gap rather than a 30 m/s spike.
        speed[i] = v > MAX_ROBOT_SPEED ? NaN : v;
      }
      addDerived(`${DERIVED_PREFIX}Pose/Speed`, 'm/s', s.t, speed);
      // Steps faster than a robot drives, while enabled: the position snapping to vision (or a reset)
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = (s.v[i] as { translation?: { x: number; y: number } }).translation;
        x[i] = p ? p.x : NaN;
        y[i] = p ? p.y : NaN;
      }
      poseJumps = findPoseJumps(s.t, x, y, robotState.ranges);
    }
  }
  // Electrical power = V * I
  if (roles.batteryVoltage && roles.totalCurrent) {
    const vs = log.series(roles.batteryVoltage);
    const cs = log.series(roles.totalCurrent);
    if (vs?.kind === 'number' && cs?.kind === 'number') {
      const n = cs.t.length;
      const p = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const v = log.valueAt(roles.batteryVoltage, cs.t[i]);
        p[i] = typeof v === 'number' ? v * cs.v[i] : NaN;
      }
      addDerived(`${DERIVED_PREFIX}Power/Watts`, 'W', cs.t, p);
    }
  }

  let autoRoutine: string | undefined;
  if (roles.autoRoutine) {
    const s = log.series(roles.autoRoutine);
    if (s && s.kind === 'string') {
      // the value selected when auto started (or the last value)
      const t = robotState.autoStart ?? Infinity;
      let pick = '';
      for (let i = 0; i < s.t.length; i++) if (s.t[i] <= t && s.v[i]) pick = s.v[i];
      if (!pick)
        for (let i = s.t.length - 1; i >= 0; i--)
          if (s.v[i]) {
            pick = s.v[i];
            break;
          }
      autoRoutine = pick || undefined;
    }
  }

  L.pathSpans = (paths?.segments ?? []).map((p) => ({ name: p.name, start: p.start, end: p.end }));
  if (poseJumps.length) {
    annotateFindings(poseJumps, commandsOf(L), L.pathSpans);
    events.push(...poseJumps.map(visionEvent));
    events.sort((a, b) => a.t - b.t);
  }
  return {
    id,
    name: L.name,
    path: L.path,
    size: L.size,
    fields: allFields(L),
    startTs: log.startTs,
    endTs: log.endTs,
    recordCount: log.reader.index.recordCount,
    truncated: log.reader.index.truncated,
    repairedTimestamps: log.reader.index.repairedTimestamps,
    robotState,
    matchInfo: computeMatchInfo(log),
    era: detectEra(log),
    loggers: detectLogger(log),
    metadata: readMetadata(log),
    health: checkLoggingHealth(log),
    console: consoleLines,
    events,
    power,
    pathSegments: paths?.segments ?? [],
    autoRoutine,
    roles,
    roleCandidates,
    loadMs,
  };
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'open': {
        const t0 = performance.now();
        const id = msg.id;
        post({ type: 'progress', id, stage: 'index', fraction: 0 });
        const log = new LogData(msg.buffer, (fraction) => post({ type: 'progress', id, stage: 'index', fraction }));
        const L: Loaded = {
          log,
          name: msg.name,
          path: msg.path,
          size: msg.buffer.byteLength,
          derived: new Map(),
          derivedFields: [],
          subDerived: new Map(),
          subFields: [],
          camDerived: new Map(),
          camFields: [],
          roles: {},
          ranges: [],
          pathSpans: [],
        };
        logs.set(msg.id, L);
        post({ type: 'progress', id, stage: 'analyze', fraction: 1 });
        const summary = summarize(msg.id, L, msg.roleOverrides, DEFAULT_THRESHOLDS.brownout, performance.now() - t0);
        post({ type: 'opened', summary });
        break;
      }
      case 'close':
        logs.delete(msg.id);
        break;
      case 'reanalyze': {
        const L = logs.get(msg.id);
        if (!L) return;
        const summary = summarize(msg.id, L, msg.roleOverrides, msg.brownoutThreshold, 0);
        post({ type: 'reanalyzed', summary });
        break;
      }
      case 'subsystems': {
        const L = logs.get(msg.id);
        if (!L || !L.power) {
          post({ type: 'subsystems', id: msg.id, seq: msg.seq, report: null });
          return;
        }
        const { report, series } = computeSubsystems(L.log, {
          defs: msg.defs,
          voltageKey: L.roles.batteryVoltage,
          totalCurrentKey: L.roles.totalCurrent,
          channelsKey: L.roles.pdhChannelCurrents,
          range: msg.range,
          brownouts: L.power.brownouts,
          dips: L.power.dips,
          enabled: L.ranges.filter((r) => r.mode !== 'disabled'),
        });
        if (!msg.updateDerived) {
          post({ type: 'subsystems', id: msg.id, seq: msg.seq, report });
          return;
        }
        L.subDerived.clear();
        L.subFields = [];
        if (series && report.hasData) {
          const used = new Set<string>();
          const add = (name: string, v: Float64Array) => {
            let safe = name.replace(/\//g, '-').trim() || 'Subsystem';
            while (used.has(safe)) safe += ' (2)';
            used.add(safe);
            const key = `${SUBSYSTEM_PREFIX}${safe}/Current`;
            L.subDerived.set(key, { kind: 'number', t: series.t, v });
            L.subFields.push({
              key,
              type: 'double',
              kind: 'number',
              count: v.length,
              metadata: '',
              unit: 'A',
              generated: true,
              hidden: false,
              firstTs: series.t[0] ?? 0,
              lastTs: series.t[series.t.length - 1] ?? 0,
            });
          };
          for (const d of msg.defs) if (series.current[d.id]) add(d.name, series.current[d.id]);
          if (series.current[UNASSIGNED]) add('Unassigned', series.current[UNASSIGNED]);
        }
        post({ type: 'subsystems', id: msg.id, seq: msg.seq, report, fields: allFields(L) });
        break;
      }
      case 'cameras': {
        const L = logs.get(msg.id);
        if (!L) {
          post({ type: 'cameras', id: msg.id, seq: msg.seq, summaries: null });
          return;
        }
        const { summaries, series } = analyzeCameras(L.log, msg.cameras, L.ranges, L.roles.robotPose);
        L.camDerived.clear();
        L.camFields = [];
        const used = new Set<string>();
        const field = (key: string, kind: 'number' | 'string', unit: string | undefined, t: Float64Array): FieldInfo => ({
          key,
          type: kind === 'number' ? 'double' : 'string',
          kind,
          count: t.length,
          metadata: '',
          unit,
          generated: true,
          hidden: false,
          firstTs: t[0] ?? 0,
          lastTs: t[t.length - 1] ?? 0,
        });
        for (const c of series) {
          let safe = c.name.replace(/\//g, '-').trim() || 'Camera';
          while (used.has(safe)) safe += ' (2)';
          used.add(safe);
          const base = `${VISION_PREFIX}${safe}/`;
          if (c.seen) {
            L.camDerived.set(`${base}TagsSeen`, { kind: 'string', t: c.seen.t, v: c.seen.labels });
            L.camFields.push(field(`${base}TagsSeen`, 'string', undefined, c.seen.t));
            L.camDerived.set(`${base}TagCount`, { kind: 'number', t: c.seen.t, v: c.seen.counts });
            L.camFields.push(field(`${base}TagCount`, 'number', undefined, c.seen.t));
          }
          if (c.error) {
            L.camDerived.set(`${base}EstimateError`, { kind: 'number', t: c.error.t, v: c.error.v });
            L.camFields.push(field(`${base}EstimateError`, 'number', 'm', c.error.t));
          }
        }
        // where a camera stayed far from the robot position
        const findings: PoseFinding[] = [];
        for (const c of series) if (c.error) findings.push(...findDisagreements(c.name, c.error.t, c.error.v, L.ranges));
        findings.sort((a, b) => a.start - b.start);
        annotateFindings(findings, commandsOf(L), L.pathSpans);
        post({ type: 'cameras', id: msg.id, seq: msg.seq, summaries, fields: allFields(L), findings });
        break;
      }
      case 'series': {
        const L = logs.get(msg.id);
        if (!L) {
          post({ type: 'series', id: msg.id, key: msg.key, series: null });
          return;
        }
        const s = L.derived.get(msg.key) ?? L.subDerived.get(msg.key) ?? L.camDerived.get(msg.key) ?? L.log.series(msg.key) ?? null;
        if (!s) {
          post({ type: 'series', id: msg.id, key: msg.key, series: null });
          return;
        }
        // Copy typed arrays so the worker keeps its cache; transfer the copies.
        const t = s.t.slice();
        const transfer: Transferable[] = [t.buffer];
        let series: Series;
        if (s.kind === 'number') {
          const v = s.v.slice();
          transfer.push(v.buffer);
          series = { kind: 'number', t, v };
        } else if (s.kind === 'boolean') {
          const v = s.v.slice();
          transfer.push(v.buffer);
          series = { kind: 'boolean', t, v };
        } else if (s.kind === 'raw') {
          series = { kind: 'raw', t, v: s.v.map((b) => b.slice()) };
        } else series = { ...s, t } as Series;
        post({ type: 'series', id: msg.id, key: msg.key, series }, transfer);
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: e instanceof Error ? e.message : String(e) });
  }
};
