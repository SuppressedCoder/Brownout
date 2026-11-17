/**
 * Logging health: which recommended signals a log has or lacks, with
 * how-to-log snippets, plus basic log info (era, event, versions, git SHA).
 */
import type { LogData } from '../log';
import { resolveRole, type Role } from '../roles';

export interface HealthItem {
  role: Role;
  label: string;
  key?: string;
  present: boolean;
  why: string;
  howTo: string;
}

const CHECKS: { role: Role; why: string; howTo: string }[] = [
  {
    role: 'batteryVoltage',
    why: 'Needed for the power report, voltage dips and brownout inference.',
    howTo:
      'AdvantageKit logs SystemStats/BatteryVoltage automatically. DataLogManager: log RobotController.getBatteryVoltage() each loop, or call DriverStation.startDataLog(DataLogManager.getLog()).',
  },
  {
    role: 'brownout',
    why: 'Exact brownout count and duration (otherwise inferred from voltage).',
    howTo: 'AdvantageKit: SystemStats/BrownedOut (2027: SystemStats/Faults/Brownout). Otherwise log RobotController.isBrownedOut() each loop.',
  },
  {
    role: 'totalCurrent',
    why: 'Energy use, internal-resistance estimate and current at each dip.',
    howTo:
      'AdvantageKit: enable PowerDistribution logging (PowerDistribution/TotalCurrent). DogLog: DogLogOptions.withLogExtras(true). Otherwise log PowerDistribution.getTotalCurrent().',
  },
  {
    role: 'pdhChannelCurrents',
    why: 'Which mechanism was drawing current at each voltage dip.',
    howTo: 'AdvantageKit: PowerDistribution/ChannelCurrent. Otherwise log PowerDistribution.getAllCurrents() as a double[].',
  },
  {
    role: 'robotPose',
    why: 'The 2D field, auto comparison and path error analysis.',
    howTo:
      'Log your pose estimator output as a Pose2d struct, e.g. Logger.recordOutput("Odometry/Robot", pose) or Field2d.setRobotPose(pose) with DataLogManager mirroring NT.',
  },
  {
    role: 'activePath',
    why: 'PathPlanner overlay and per-path error metrics.',
    howTo:
      'PathPlannerLogging.setLogActivePathCallback(path -> Logger.recordOutput("Odometry/Trajectory", path.toArray(new Pose2d[0]))); or leave PPLibTelemetry on with DataLogManager.',
  },
  {
    role: 'targetPose',
    why: 'Path-following error (target vs actual).',
    howTo: 'PathPlannerLogging.setLogTargetPoseCallback(pose -> Logger.recordOutput("Odometry/TrajectorySetpoint", pose));',
  },
  {
    role: 'loopTime',
    why: 'Loop overruns and code-health checks.',
    howTo: 'AdvantageKit logs LoggedRobot/FullCycleMS. Otherwise time robotPeriodic() and log it in ms.',
  },
  {
    role: 'console',
    why: 'Errors and warnings in the console panel.',
    howTo: 'DataLogManager.start() captures console output; AdvantageKit logs RealOutputs/Console.',
  },
  {
    role: 'gitSha',
    why: 'Compare matches across code versions.',
    howTo: 'AdvantageKit: Logger.recordMetadata("GitSHA", BuildConstants.GIT_SHA) with the gversion plugin.',
  },
  {
    role: 'matchTime',
    why: 'Match-time readout ("TELEOP 1:12 left").',
    howTo: 'AdvantageKit logs DriverStation/MatchTime. Otherwise log DriverStation.getMatchTime().',
  },
];

export function checkLoggingHealth(log: LogData): HealthItem[] {
  return CHECKS.map((c) => {
    const key = resolveRole(log, c.role);
    return { role: c.role, label: roleLabel(c.role), key, present: !!key, why: c.why, howTo: c.howTo };
  });
}

function roleLabel(r: Role): string {
  return r
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace('Pdh ', 'PDH ');
}

export interface LogVersions {
  [name: string]: string;
}

export function readMetadata(log: LogData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of log.fields) {
    if (f.generated || f.hidden) continue;
    const m = f.key.match(/^(?:NT:)?\/(?:AdvantageKit\/)?(?:Real|Replay)?Metadata\/(.+)$/) ?? f.key.match(/^\/SystemStats\/Versions\/(.+)$/);
    if (!m) continue;
    const s = log.series(f.key);
    if (s && s.kind === 'string' && s.v.length) out[m[1]] = s.v[s.v.length - 1];
    else if (s && s.kind === 'number' && s.v.length) out[m[1]] = String(s.v[s.v.length - 1]);
  }
  return out;
}

export function detectLogger(log: LogData): string[] {
  const has = (p: (k: string) => boolean) => log.fields.some((f) => !f.generated && p(f.key));
  const out: string[] = [];
  if (has((k) => k.startsWith('/RealOutputs/') || k.startsWith('/SystemStats/') || k.startsWith('NT:/AdvantageKit/'))) out.push('AdvantageKit');
  if (has((k) => k.startsWith('NT:/'))) out.push('DataLogManager (NT mirror)');
  if (has((k) => k === 'systemTime' || k === 'messages' || k === 'console')) out.push('DataLogManager');
  if (has((k) => k.startsWith('DS:/Dscomm/'))) out.push('FIRST Driver Station');
  else if (has((k) => k.startsWith('DS:'))) out.push('DriverStation data log');
  if (has((k) => k.startsWith('/Robot/'))) out.push('Epilogue');
  if (has((k) => k.startsWith('NT:/Telemetry/'))) out.push('WPILib Telemetry');
  if (has((k) => k.startsWith('NT:/photonvision/'))) out.push('PhotonVision');
  if (has((k) => k.startsWith('NT:/limelight'))) out.push('Limelight');
  if (has((k) => k.startsWith('NT:/PathPlanner/'))) out.push('PathPlanner telemetry');
  return out;
}
