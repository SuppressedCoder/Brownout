/**
 * Presets ask for roles ("battery voltage", "robot pose"), not exact keys.
 * This resolves each role against a log through key tables, struct-type
 * detection and name patterns (viewer UI spec §5.2).
 */
import type { LogData, FieldInfo } from './log';

export type Role =
  | 'batteryVoltage'
  | 'brownout'
  | 'totalCurrent'
  | 'pdhChannelCurrents'
  | 'totalEnergy'
  | 'robotPose'
  | 'activePath'
  | 'targetPose'
  | 'visionPose'
  | 'loopTime'
  | 'canUtilization'
  | 'console'
  | 'gitSha'
  | 'autoRoutine'
  | 'swerveMeasured'
  | 'swerveSetpoint'
  | 'chassisSpeeds'
  | 'matchTime';

interface RoleSpec {
  exact: string[];
  /** Regex on the key (case-insensitive); optional required kind / struct name. */
  patterns?: RegExp[];
  kinds?: FieldInfo['kind'][];
  structs?: string[];
  /** Keys a pattern must not pick (exact keys and overrides are not affected). */
  exclude?: RegExp;
  /**
   * Put candidates that only cover a small part of the log last. A pose that
   * exists only while a path runs is a worse "robot pose" than one logged all match.
   */
  preferCoverage?: boolean;
}

const SPECS: Record<Role, RoleSpec> = {
  batteryVoltage: {
    exact: [
      '/SystemStats/BatteryVoltage',
      'NT:/AdvantageKit/SystemStats/BatteryVoltage',
      '/PowerDistribution/Voltage',
      'NT:/AdvantageKit/PowerDistribution/Voltage',
      '/DSLog/Status/BatteryVoltage',
      'DS:batteryVoltage',
      'NT:/SmartDashboard/BatteryVoltage',
      'NT:/Robot/BatteryVoltage',
    ],
    patterns: [/battery.?volt/i, /\/(pdh|pdp|powerdistribution)\/voltage$/i, /robotcontroller\/batteryvoltage/i, /\bvoltage$/i],
    kinds: ['number'],
  },
  brownout: {
    exact: [
      '/SystemStats/Faults/Brownout',
      '/SystemStats/BrownedOut',
      'NT:/AdvantageKit/SystemStats/BrownedOut',
      'NT:/AdvantageKit/SystemStats/Faults/Brownout',
      '/DSLog/Status/Brownout',
      'DS:brownout',
    ],
    patterns: [/brown.?out/i],
    kinds: ['boolean'],
  },
  totalCurrent: {
    exact: ['/PowerDistribution/TotalCurrent', 'NT:/AdvantageKit/PowerDistribution/TotalCurrent', '/SystemStats/TotalCurrent'],
    patterns: [/total.?current/i, /\/(pdh|pdp)\/current$/i],
    kinds: ['number'],
  },
  pdhChannelCurrents: {
    exact: ['/PowerDistribution/ChannelCurrent', 'NT:/AdvantageKit/PowerDistribution/ChannelCurrent', '/DSLog/PowerDistribution/Currents'],
    patterns: [/channel.?current/i, /(pdh|pdp).*currents?$/i],
    kinds: ['number[]'],
  },
  totalEnergy: {
    exact: ['/PowerDistribution/TotalEnergy', 'NT:/AdvantageKit/PowerDistribution/TotalEnergy'],
    patterns: [/total.?energy/i],
    kinds: ['number'],
  },
  robotPose: {
    exact: ['/RealOutputs/Odometry/Robot', 'NT:/AdvantageKit/RealOutputs/Odometry/Robot', 'NT:/PathPlanner/currentPose', 'NT:/SmartDashboard/Field/Robot'],
    patterns: [/\/odometry\/robot$/i, /estimatedpose$/i, /\/pose$/i, /robot.?(pose|position)/i, /odometry/i, /\/robot$/i],
    kinds: ['struct', 'number[]'],
    structs: ['Pose2d', 'Pose3d'],
    // what a camera thinks, or where the robot should be, is not where the robot is
    exclude: /vision|limelight|photon|camera|april|botpose|target|setpoint|goal|desired|trajectory/i,
    preferCoverage: true,
  },
  activePath: {
    exact: [
      '/RealOutputs/Odometry/Trajectory',
      'NT:/AdvantageKit/RealOutputs/Odometry/Trajectory',
      'NT:/PathPlanner/activePath',
      'NT:/SmartDashboard/Field/path',
    ],
    patterns: [/trajectory$/i, /activepath/i, /\/path$/i],
    kinds: ['struct[]'],
    structs: ['Pose2d'],
  },
  targetPose: {
    exact: ['/RealOutputs/Odometry/TrajectorySetpoint', 'NT:/AdvantageKit/RealOutputs/Odometry/TrajectorySetpoint', 'NT:/PathPlanner/targetPose'],
    patterns: [/trajectorysetpoint/i, /targetpose/i, /target pose/i],
    kinds: ['struct'],
    structs: ['Pose2d'],
  },
  visionPose: {
    exact: [],
    patterns: [/vision.*(pose|estimate)/i, /botpose/i],
    kinds: ['struct', 'number[]'],
    structs: ['Pose2d', 'Pose3d'],
  },
  loopTime: {
    exact: ['/LoggedRobot/FullCycleMS', 'NT:/AdvantageKit/LoggedRobot/FullCycleMS', '/LoggedRobot/UserCodeMS'],
    patterns: [/loop.?time/i, /cycle.?ms/i, /looptimems/i],
    kinds: ['number'],
  },
  canUtilization: {
    exact: ['/SystemStats/CANBus/Utilization', 'NT:/AdvantageKit/SystemStats/CANBus/Utilization', '/DSLog/Status/CANUtilization'],
    patterns: [/can.*util/i],
    kinds: ['number'],
  },
  console: {
    exact: ['console', '/RealOutputs/Console', 'messages', 'DS:/Dscomm/Console'],
    patterns: [/console$/i, /messages$/i],
    kinds: ['string'],
  },
  gitSha: {
    exact: ['/RealMetadata/GitSHA', '/Metadata/GitSHA', 'NT:/AdvantageKit/RealMetadata/GitSHA', 'NT:/Metadata/GitSHA'],
    patterns: [/git.?sha/i, /gitrevision/i],
    kinds: ['string'],
  },
  autoRoutine: {
    exact: ['NT:/SmartDashboard/Auto Chooser/active', 'NT:/SmartDashboard/Auto Choices/active', '/NetworkInputs/SmartDashboard/Auto Choices/active'],
    patterns: [
      /auto.*(chooser|choices|routine|selected).*\/active$/i,
      /auto.*(chooser|choices)\/selected$/i,
      /autoroutine/i,
      /selectedauto/i,
      // a SendableChooser published under any name starting with "Auto" ("Autonomous", "Auto Mode", ...)
      /auto[^/]*\/active$/i,
      /auto[^/]*\/selected$/i,
    ],
    kinds: ['string'],
  },
  swerveMeasured: {
    exact: ['/RealOutputs/SwerveStates/Measured', 'NT:/AdvantageKit/RealOutputs/SwerveStates/Measured'],
    patterns: [/swerve.*(measured|states)$/i, /(current|measured|actual|real).*modules?.?states?$/i, /modules?.?states?$/i],
    kinds: ['struct[]'],
    structs: ['SwerveModuleState', 'SwerveModuleVelocity'],
    exclude: /setpoint|desired|target|goal|command|optimi[sz]ed|reference/i,
  },
  swerveSetpoint: {
    exact: ['/RealOutputs/SwerveStates/Setpoints', 'NT:/AdvantageKit/RealOutputs/SwerveStates/Setpoints'],
    patterns: [
      /swerve.*(setpoint|desired|target)/i,
      /(setpoint|desired|target|commanded|reference).*modules?.?states?/i,
      /modules?.?states?.*(setpoint|desired|target)/i,
    ],
    kinds: ['struct[]'],
    structs: ['SwerveModuleState', 'SwerveModuleVelocity'],
  },
  chassisSpeeds: {
    exact: ['/RealOutputs/SwerveChassisSpeeds/Measured', 'NT:/AdvantageKit/RealOutputs/SwerveChassisSpeeds/Measured'],
    patterns: [/chassis.?(speeds|velocit)/i],
    kinds: ['struct'],
    structs: ['ChassisSpeeds', 'ChassisVelocities'],
  },
  matchTime: {
    exact: ['/DriverStation/MatchTime', 'NT:/AdvantageKit/DriverStation/MatchTime', 'DS:matchTime'],
    patterns: [/match.?time$/i],
    kinds: ['number'],
  },
};

function matches(f: FieldInfo, spec: RoleSpec): boolean {
  if (f.hidden || f.count === 0) return false;
  if (spec.kinds && !spec.kinds.includes(f.kind)) return false;
  if (spec.structs && f.structName && !spec.structs.includes(f.structName)) return false;
  if (spec.structs && !f.structName && f.kind.startsWith('struct')) return false;
  return true;
}

/** All candidate keys for a role, best first. */
export function resolveRoleCandidates(log: LogData, role: Role, overrides?: Partial<Record<Role, string>>): string[] {
  const spec = SPECS[role];
  const out: string[] = [];
  const ov = overrides?.[role];
  if (ov && log.field(ov)) out.push(ov);
  for (const k of spec.exact) {
    const f = log.field(k);
    if (f && matches(f, spec) && !out.includes(k)) out.push(k);
  }
  if (spec.patterns) {
    for (const re of spec.patterns) {
      for (const f of log.fields) {
        if (f.generated || out.includes(f.key)) continue;
        if (!matches(f, spec)) continue;
        if (spec.exclude?.test(f.key)) continue;
        if (re.test(f.key)) out.push(f.key);
      }
    }
  }
  if (spec.preferCoverage && out.length > 1) {
    const span = (k: string) => {
      const f = log.field(k);
      return f ? Math.max(0, f.lastTs - f.firstTs) : 0;
    };
    const best = Math.max(...out.map(span));
    const first = ov && out[0] === ov ? [ov] : [];
    const rest = out.slice(first.length);
    const wide = rest.filter((k) => span(k) >= best * 0.5);
    const narrow = rest.filter((k) => span(k) < best * 0.5);
    return [...first, ...wide, ...narrow];
  }
  return out;
}

export function resolveRole(log: LogData, role: Role, overrides?: Partial<Record<Role, string>>): string | undefined {
  return resolveRoleCandidates(log, role, overrides)[0];
}

export const ROLE_LABELS: Record<Role, string> = {
  batteryVoltage: 'Battery voltage',
  brownout: 'Brownout flag',
  totalCurrent: 'Total current',
  pdhChannelCurrents: 'PDH/PDP channel currents',
  totalEnergy: 'Total energy',
  robotPose: 'Robot pose',
  activePath: 'Active path',
  targetPose: 'Path target pose',
  visionPose: 'Vision pose estimate',
  loopTime: 'Loop time',
  canUtilization: 'CAN utilization',
  console: 'Console output',
  gitSha: 'Git SHA',
  autoRoutine: 'Auto routine',
  swerveMeasured: 'Swerve module states (measured)',
  swerveSetpoint: 'Swerve module states (setpoint)',
  chassisSpeeds: 'Chassis speeds',
  matchTime: 'Match time',
};

/**
 * The types a role takes, as the app names them ("Pose2d", "Pose3d[]",
 * "number"): what a field box for the role lists and accepts.
 */
export function roleTypes(role: Role): string[] {
  const spec = SPECS[role];
  const out: string[] = [];
  for (const k of spec.kinds ?? []) {
    if (k === 'struct') out.push(...(spec.structs ?? []));
    else if (k === 'struct[]') out.push(...(spec.structs ?? []).map((s) => `${s}[]`));
    else out.push(k);
  }
  return out;
}

/** Every role, in the groups Robot setup's Field names lists them. */
export const ROLE_GROUPS: { title: string; roles: Role[] }[] = [
  { title: 'Power', roles: ['batteryVoltage', 'totalCurrent', 'brownout', 'pdhChannelCurrents', 'totalEnergy'] },
  { title: 'Code and health', roles: ['loopTime', 'canUtilization', 'console', 'gitSha', 'autoRoutine', 'matchTime'] },
  { title: 'On the field', roles: ['robotPose', 'activePath', 'targetPose', 'visionPose', 'swerveMeasured', 'swerveSetpoint', 'chassisSpeeds'] },
];
