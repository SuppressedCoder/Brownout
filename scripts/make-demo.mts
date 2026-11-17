/**
 * Generates synthetic 2026-style match logs with AdvantageKit and
 * DataLogManager keys, structs, a brownout, loop overruns, console errors and
 * PathPlanner-style path data. Each match starts at a different raw time and
 * has a different pre-match idle, so alignment is exercised.
 *
 *   npm run make-demo            -> fixtures/demo/*.wpilog
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WpilogWriter } from '../src/core/wpilog/writer.ts';
import { WELL_KNOWN_SCHEMAS } from '../src/core/struct/structDecoder.ts';
import { parseFieldJson } from '../src/core/field.ts';

// The real 2026 tag positions, so the demo cameras see tags that are actually in front of them
const TAGS = parseFieldJson(JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'src/renderer/src/assets/fields/tags-2026-welded.json'), 'utf8'))).tags;

interface MatchSpec {
  file: string;
  event: string;
  matchNumber: number;
  alliance: 'red' | 'blue';
  station: number;
  idleBefore: number; // seconds of disabled before auto
  rawStart: number; // first timestamp (s)
  brownoutAt?: number; // seconds after teleop start
  /** Seconds after teleop start: Camera0 reads 1.1 m off for 1 s, then the pose snaps 0.6 m toward it and drifts back over 3 s. */
  visionGlitchAt?: number;
  epoch: number; // unix seconds at log start
  auto: string;
  gitSha: string;
  pathOffset: number; // meters of path-following error bias
  batteryR: number; // internal resistance ohms
  voc: number;
  shooterGain: number;
}

const L = 16.541;
const W = 8.069;
const DT = 0.02;

const matches: MatchSpec[] = [
  {
    file: 'FRC_20260321_143012_NYROC_Q12.wpilog',
    event: 'NYROC',
    matchNumber: 12,
    alliance: 'blue',
    station: 2,
    idleBefore: 42,
    rawStart: 0.73,
    epoch: 1774102212,
    auto: '4 Piece Center',
    gitSha: 'a1b2c3d',
    pathOffset: 0.04,
    batteryR: 0.018,
    voc: 12.7,
    shooterGain: 1.0,
    visionGlitchAt: 40,
  },
  {
    file: 'FRC_20260321_171844_NYROC_Q18.wpilog',
    event: 'NYROC',
    matchNumber: 18,
    alliance: 'red',
    station: 1,
    idleBefore: 77,
    rawStart: 1.21,
    brownoutAt: 61,
    epoch: 1774112324,
    auto: '4 Piece Center',
    gitSha: 'a1b2c3d',
    pathOffset: 0.11,
    batteryR: 0.022,
    voc: 12.4,
    shooterGain: 0.93,
  },
  {
    file: 'FRC_20260322_094502_NYROC_Q23.wpilog',
    event: 'NYROC',
    matchNumber: 23,
    alliance: 'blue',
    station: 3,
    idleBefore: 25,
    rawStart: 0.5,
    epoch: 1774172702,
    auto: '3 Piece Left',
    gitSha: 'f00dbab',
    pathOffset: 0.06,
    batteryR: 0.021,
    voc: 12.8,
    shooterGain: 1.02,
  },
];

function pose(x: number, y: number, theta: number): Uint8Array {
  const b = new Uint8Array(24);
  const v = new DataView(b.buffer);
  v.setFloat64(0, x, true);
  v.setFloat64(8, y, true);
  v.setFloat64(16, theta, true);
  return b;
}
function poseArray(poses: [number, number, number][]): Uint8Array {
  const b = new Uint8Array(24 * poses.length);
  poses.forEach((p, i) => b.set(pose(p[0], p[1], p[2]), i * 24));
  return b;
}
function swerveStates(states: [number, number][]): Uint8Array {
  const b = new Uint8Array(16 * states.length);
  const v = new DataView(b.buffer);
  states.forEach(([speed, angle], i) => {
    v.setFloat64(i * 16, speed, true);
    v.setFloat64(i * 16 + 8, angle, true);
  });
  return b;
}
function chassis(vx: number, vy: number, omega: number): Uint8Array {
  const b = new Uint8Array(24);
  const v = new DataView(b.buffer);
  v.setFloat64(0, vx, true);
  v.setFloat64(8, vy, true);
  v.setFloat64(16, omega, true);
  return b;
}

// A simple auto path (blue side): start -> pickup -> score, as Bézier-ish waypoints.
function pathPoints(name: string): [number, number, number][] {
  const base: [number, number, number][] =
    name === '4 Piece Center'
      ? [
          [1.4, 4.03, 0],
          [2.2, 4.1, 0.05],
          [2.9, 4.4, 0.2],
          [3.4, 5.0, 0.5],
          [3.6, 5.6, 0.9],
          [3.2, 6.2, 1.5],
          [2.4, 6.6, 2.4],
          [1.6, 6.3, 2.9],
        ]
      : [
          [1.4, 6.5, 0.4],
          [2.3, 6.9, 0.3],
          [3.5, 7.0, 0.1],
          [4.6, 6.6, -0.3],
          [5.2, 5.8, -0.8],
          [4.6, 5.0, -1.4],
          [3.5, 4.6, -2.0],
        ];
  return base;
}

function flip(p: [number, number, number]): [number, number, number] {
  return [L - p[0], W - p[1], p[2] - Math.PI];
}

function lerpPath(pts: [number, number, number][], s: number): [number, number, number] {
  const n = pts.length - 1;
  const f = Math.min(Math.max(s, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function makeLog(m: MatchSpec): Uint8Array {
  const rand = rng(m.matchNumber * 7919);
  const w = new WpilogWriter('');
  const us = (t: number) => Math.round(t * 1e6);
  const T0 = m.rawStart;
  const autoStart = T0 + m.idleBefore;
  const autoEnd = autoStart + 15;
  const teleopStart = autoEnd + 3; // field transition pause
  const teleopEnd = teleopStart + 135;
  const logEnd = teleopEnd + 20;

  // schemas
  for (const n of ['Translation2d', 'Rotation2d', 'Pose2d', 'SwerveModuleState', 'ChassisSpeeds']) {
    const id = w.start(`/.schema/struct:${n}`, 'structschema', '', us(T0));
    w.string(id, us(T0), WELL_KNOWN_SCHEMAS[n]);
  }
  const meta = (k: string, v: string) => {
    const id = w.start(`/RealMetadata/${k}`, 'string', '', us(T0));
    w.string(id, us(T0), v);
  };
  meta('GitSHA', m.gitSha);
  meta('GitBranch', 'main');
  meta('RuntimeType', 'RIO2');
  meta('ProjectName', 'Brownout-Demo-2026');

  const E = {
    enabled: w.start('/DriverStation/Enabled', 'boolean'),
    auto: w.start('/DriverStation/Autonomous', 'boolean'),
    test: w.start('/DriverStation/Test', 'boolean'),
    fms: w.start('/DriverStation/FMSAttached', 'boolean'),
    dsAttached: w.start('/DriverStation/DSAttached', 'boolean'),
    matchTime: w.start('/DriverStation/MatchTime', 'double'),
    eventName: w.start('/DriverStation/EventName', 'string'),
    matchType: w.start('/DriverStation/MatchType', 'int64'),
    matchNumber: w.start('/DriverStation/MatchNumber', 'int64'),
    station: w.start('/DriverStation/AllianceStation', 'int64'),
    voltage: w.start('/SystemStats/BatteryVoltage', 'double', '{"units":"V"}'),
    brownedOut: w.start('/SystemStats/BrownedOut', 'boolean'),
    epoch: w.start('/SystemStats/EpochTimeMicros', 'int64'),
    canUtil: w.start('/SystemStats/CANBus/Utilization', 'double'),
    totalCurrent: w.start('/PowerDistribution/TotalCurrent', 'double', '{"units":"A"}'),
    channelCurrent: w.start('/PowerDistribution/ChannelCurrent', 'double[]', '{"units":"A"}'),
    pdVoltage: w.start('/PowerDistribution/Voltage', 'double'),
    cycle: w.start('/LoggedRobot/FullCycleMS', 'double'),
    userCode: w.start('/LoggedRobot/UserCodeMS', 'double'),
    robotPose: w.start('/RealOutputs/Odometry/Robot', 'struct:Pose2d'),
    traj: w.start('/RealOutputs/Odometry/Trajectory', 'struct:Pose2d[]'),
    trajSetpoint: w.start('/RealOutputs/Odometry/TrajectorySetpoint', 'struct:Pose2d'),
    swerveMeas: w.start('/RealOutputs/SwerveStates/Measured', 'struct:SwerveModuleState[]'),
    swerveSet: w.start('/RealOutputs/SwerveStates/Setpoints', 'struct:SwerveModuleState[]'),
    chassis: w.start('/RealOutputs/SwerveChassisSpeeds/Measured', 'struct:ChassisSpeeds'),
    shooterSupply: w.start('/Shooter/SupplyCurrentAmps', 'double', '{"units":"A"}'),
    shooterStator: w.start('/Shooter/StatorCurrentAmps', 'double', '{"units":"A"}'),
    elevatorSupply: w.start('/Elevator/SupplyCurrentAmps', 'double', '{"units":"A"}'),
    intakeSupply: w.start('/Intake/SupplyCurrentAmps', 'double', '{"units":"A"}'),
    superState: w.start('/RealOutputs/Superstructure/State', 'string'),
    hasPiece: w.start('/RealOutputs/Intake/HasPiece', 'boolean'),
    shooterVel: w.start('/RealOutputs/Shooter/VelocityRPM', 'double'),
    turret: w.start('/Shooter/TurretPositionRad', 'double', '{"units":"rad"}'),
    shooterSet: w.start('/RealOutputs/Shooter/SetpointRPM', 'double'),
    elevatorPos: w.start('/RealOutputs/Elevator/PositionMeters', 'double'),
    elevatorSet: w.start('/RealOutputs/Elevator/SetpointMeters', 'double'),
    gyroYaw: w.start('/Drive/Gyro/YawPosition', 'struct:Rotation2d'),
    console: w.start('/RealOutputs/Console', 'string'),
    autoChooser: w.start('NT:/SmartDashboard/Auto Chooser/active', 'string', '{"properties":{},"source":"NT"}'),
    autoOptions: w.start('NT:/SmartDashboard/Auto Chooser/options', 'string[]', '{"properties":{},"source":"NT"}'),
    tagIds: w.start('/Vision/Camera0/TagIds', 'int64[]'),
    camPoses: w.start('/RealOutputs/Vision/Camera0/RobotPoses', 'struct:Pose2d[]'),
    tagIds1: w.start('/Vision/Camera1/TagIds', 'int64[]'),
    cam1Connected: w.start('/Vision/Camera1/Connected', 'boolean'),
    camPoses1: w.start('/RealOutputs/Vision/Camera1/RobotPoses', 'struct:Pose2d[]'),
    joyName: w.start('/DriverStation/Joystick0/Name', 'string'),
    joyButtons: w.start('/DriverStation/Joystick0/ButtonValues', 'int64'),
    joyAxes: w.start('/DriverStation/Joystick0/AxisValues', 'double[]'),
    joyPovs: w.start('/DriverStation/Joystick0/POVs', 'int64[]'),
    scheduler: w.start('NT:/SmartDashboard/Scheduler/Names', 'string[]'),
    camConnected: w.start('/Vision/Camera0/Connected', 'boolean'),
    alerts: w.start('NT:/SmartDashboard/Alerts/errors', 'string[]', '{"properties":{},"source":"NT"}'),
    systemTime: w.start('systemTime', 'int64', '{"source":"DataLogManager","format":"time_t_us"}'),
    messages: w.start('messages', 'string'),
    radio: w.start('/RadioStatus/Connected', 'boolean'),
  };

  // Static values
  w.string(E.eventName, us(T0), m.event);
  w.int64(E.matchType, us(T0), 2);
  w.int64(E.matchNumber, us(T0), m.matchNumber);
  w.int64(E.station, us(T0), (m.alliance === 'red' ? 0 : 3) + (m.station - 1));
  w.boolean(E.fms, us(T0), true);
  w.boolean(E.dsAttached, us(T0), true);
  w.stringArray(E.autoOptions, us(T0), ['4 Piece Center', '3 Piece Left', 'Do Nothing']);
  w.string(E.autoChooser, us(T0), m.auto);
  w.boolean(E.camConnected, us(T0), true);
  w.boolean(E.cam1Connected, us(T0), true);
  w.string(E.joyName, us(T0), 'Controller (Xbox One For Windows)');
  w.boolean(E.radio, us(T0), true);
  w.string(E.console, us(T0), '********** Robot program starting **********');
  w.string(E.messages, us(T0), `Logging to ${m.file}`);
  w.string(E.console, us(T0 + 0.3), `[AdvantageKit] Log file: ${m.file}`);

  const pathBlue = pathPoints(m.auto);
  const path = m.alliance === 'red' ? pathBlue.map(flip) : pathBlue;
  const start = path[0];
  let x = start[0] + (rand() - 0.5) * 0.15;
  let y = start[1] + (rand() - 0.5) * 0.15;
  let theta = start[2];
  let turret = 0;
  let enabled = false;
  let auto = false;
  let prevEnabled: boolean | null = null;
  let prevAuto: boolean | null = null;
  let prevState = '';
  let hasPiece = true;
  let prevPiece: boolean | null = null;
  let brownedOut = false;
  let prevBrown: boolean | null = null;
  let shooterVel = 0;
  let elevator = 0;
  let lastEpochT = -10;
  let lastAlerts = '';
  let activePath: [number, number, number][] = [];
  let prevPathLen = -1;
  let camDrop = false;
  let lastSeen = ['', ''];
  let lastJoy = '';
  let lastCommands = 'x';
  /**
   * What a camera sees: the (up to three) nearest tags within 5.5 m and 40 degrees of where it points, and the pose
   * it would estimate from them (noisier with distance). `yaw` is the camera's direction on the robot.
   */
  const cameraView = (yaw: number): [number[], [number, number, number][]] => {
    const dir = theta + yaw;
    const inView = TAGS.map((tg) => ({ id: tg.id, d: Math.hypot(tg.x - x, tg.y - y), bearing: Math.atan2(tg.y - y, tg.x - x) }))
      .filter((tg) => tg.d < 5.5 && tg.d > 0.4 && Math.abs(Math.atan2(Math.sin(tg.bearing - dir), Math.cos(tg.bearing - dir))) < 0.7)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    if (!inView.length) return [[], []];
    const noise = 0.03 + 0.035 * inView[0].d;
    return [inView.map((tg) => tg.id).sort((a, b) => a - b), [[x + (rand() - 0.5) * 2 * noise, y + (rand() - 0.5) * 2 * noise, theta + (rand() - 0.5) * 0.06]]];
  };

  for (let t = T0; t < logEnd; t += DT) {
    const ts = us(t);
    const inAuto = t >= autoStart && t < autoEnd;
    const inTeleop = t >= teleopStart && t < teleopEnd;
    enabled = inAuto || inTeleop;
    auto = inAuto;
    if (enabled !== prevEnabled) {
      w.boolean(E.enabled, ts, enabled);
      prevEnabled = enabled;
      if (enabled) w.string(E.console, ts, inAuto ? 'Autonomous enabled' : 'Teleop enabled');
      else if (t > T0 + 1) w.string(E.console, ts, 'Robot disabled');
    }
    if (auto !== prevAuto) {
      w.boolean(E.auto, ts, auto);
      w.boolean(E.test, ts, false);
      prevAuto = auto;
    }
    // match time
    const matchTime = inAuto ? 15 - (t - autoStart) : inTeleop ? 135 - (t - teleopStart) : -1;
    if (Math.round(t * 50) % 5 === 0) w.double(E.matchTime, ts, Number(matchTime.toFixed(2)));

    // Motion
    let vx = 0;
    let vy = 0;
    let omega = 0;
    let setX = x;
    let setY = y;
    let setTheta = theta;
    let state = 'IDLE';
    if (inAuto) {
      const s = (t - autoStart) / 13; // finish the path in 13 s
      if (s <= 1) {
        const target = lerpPath(path, s);
        const next = lerpPath(path, Math.min(1, s + 0.01));
        setX = target[0];
        setY = target[1];
        setTheta = target[2];
        const biasX = m.pathOffset * Math.sin(s * 6.28) + (rand() - 0.5) * 0.02;
        const biasY = m.pathOffset * Math.cos(s * 4.1) + (rand() - 0.5) * 0.02;
        x = target[0] + biasX;
        y = target[1] + biasY;
        theta = target[2] + (rand() - 0.5) * 0.03;
        vx = (next[0] - target[0]) / 0.13;
        vy = (next[1] - target[1]) / 0.13;
        omega = (next[2] - target[2]) / 0.13;
        if (activePath.length === 0) activePath = path;
        state = s < 0.45 ? 'INTAKING' : s < 0.5 ? 'HOLDING' : 'SHOOTING';
        hasPiece = s < 0.45 || s > 0.55;
      } else {
        activePath = [];
        state = 'IDLE';
      }
    } else if (inTeleop) {
      const tt = t - teleopStart;
      // wander around the alliance half
      const cx = m.alliance === 'red' ? L - 4 : 4;
      const cy = W / 2;
      const nx = cx + 2.6 * Math.sin(tt * 0.21) + 0.8 * Math.sin(tt * 0.71);
      const ny = cy + 2.2 * Math.cos(tt * 0.17) + 0.5 * Math.cos(tt * 0.53);
      vx = (nx - x) / DT;
      vy = (ny - y) / DT;
      const nth = Math.atan2(vy, vx);
      omega = (nth - theta) / DT;
      x = nx;
      y = ny;
      theta = theta + Math.max(-3, Math.min(3, omega)) * DT;
      activePath = [];
      const cycle = tt % 12;
      state = cycle < 4 ? 'INTAKING' : cycle < 7 ? 'HOLDING' : cycle < 8.5 ? 'SHOOTING' : 'IDLE';
      hasPiece = cycle >= 2 && cycle < 8;
      elevator = cycle >= 5 && cycle < 9 ? 0.6 : 0;
    } else {
      activePath = [];
      elevator = 0;
    }

    // Shooter
    const shooterSet = state === 'SHOOTING' || state === 'HOLDING' ? 3500 : 0;
    shooterVel += (shooterSet * m.shooterGain - shooterVel) * 0.12 + (rand() - 0.5) * 40;
    // The path follower can ask for a jump between waypoints; a real drivetrain tops out around 4.6 m/s
    const vmag = Math.hypot(vx, vy);
    if (vmag > 4.6) {
      vx *= 4.6 / vmag;
      vy *= 4.6 / vmag;
    }
    omega = Math.max(-3, Math.min(3, omega));
    // Currents
    const stall = m.brownoutAt !== undefined && inTeleop && t - teleopStart > m.brownoutAt && t - teleopStart < m.brownoutAt + 0.5;
    const driveI = enabled ? Math.min(120, Math.hypot(vx, vy) * 22 + Math.abs(omega) * 8) : 0;
    const shooterI = !enabled ? 0 : shooterVel > 100 && Math.abs(shooterSet * m.shooterGain - shooterVel) > 300 ? 60 : shooterVel > 100 ? 18 : 0;
    // the elevator stalls against its hard stop in the brownout match
    const elevI = !enabled ? 0 : (elevator > 0 ? 12 : 1) + (stall ? 230 : 0);
    const intakeI = enabled && state === 'INTAKING' ? 14 + (rand() - 0.5) * 2 : 0;
    let total = 2.5 + driveI + shooterI + elevI + intakeI;
    if (!enabled) total = 2.5 + (rand() - 0.5) * 0.5;
    const voltage = m.voc - total * m.batteryR - (enabled ? 0.15 : 0) + (rand() - 0.5) * 0.04 - (t - T0) * 0.0006;
    const chCur = new Array(24).fill(0).map((_, ch) => {
      if (ch < 8) return driveI / 8 + (rand() - 0.5) * 0.8; // 4 drive + 4 steer
      if (ch === 10) return shooterI * 0.5;
      if (ch === 11) return shooterI * 0.5;
      if (ch === 12) return elevI;
      if (ch === 13) return intakeI;
      if (ch === 20) return 2.0; // rio
      if (ch === 22) return 0.5; // radio
      return (rand() - 0.5) * 0.1;
    });
    brownedOut = voltage < 6.75;
    if (brownedOut !== prevBrown) {
      w.boolean(E.brownedOut, ts, brownedOut);
      prevBrown = brownedOut;
      if (brownedOut) w.string(E.console, ts, 'Warning: Brownout detected! Outputs disabled.');
    }
    w.double(E.voltage, ts, Number(voltage.toFixed(3)));
    w.double(E.pdVoltage, ts, Number((voltage - 0.05).toFixed(3)));
    w.double(E.totalCurrent, ts, Number(total.toFixed(2)));
    if (Math.round(t * 50) % 2 === 0) {
      w.doubleArray(
        E.channelCurrent,
        ts,
        chCur.map((c) => Number(c.toFixed(2))),
      );
      // per-motor currents as the motor controllers report them
      w.double(E.shooterSupply, ts, Number(shooterI.toFixed(2)));
      w.double(E.shooterStator, ts, Number((shooterI * 1.9).toFixed(2)));
      w.double(E.elevatorSupply, ts, Number(elevI.toFixed(2)));
      w.double(E.intakeSupply, ts, Number(intakeI.toFixed(2)));
    }

    // Loop timing with occasional overruns
    let cycleMs = 4 + rand() * 3;
    if (inTeleop && rand() < 0.0015) {
      cycleMs = 28 + rand() * 15;
      w.string(
        E.console,
        ts,
        `Warning  1  Loop time of 0.02s overrun\n  edu.wpi.first.wpilibj.IterativeRobotBase.printLoopOverrunMessage(IterativeRobotBase.java:412)`,
      );
    }
    w.double(E.cycle, ts, Number(cycleMs.toFixed(2)));
    w.double(E.userCode, ts, Number((cycleMs * 0.6).toFixed(2)));
    if (Math.round(t * 50) % 25 === 0) w.double(E.canUtil, ts, Number((0.55 + 0.1 * Math.sin(t) + rand() * 0.05).toFixed(3)));

    // Pose and path. A bad vision reading in one match snaps the logged pose off the true one for a moment.
    const glitchT = m.visionGlitchAt !== undefined ? teleopStart + m.visionGlitchAt : Infinity;
    const poseBias = t >= glitchT + 1 && t < glitchT + 4 ? 0.6 * (1 - (t - glitchT - 1) / 3) : 0;
    w.record(E.robotPose, ts, pose(x + poseBias, y, theta));
    w.record(
      E.gyroYaw,
      ts,
      (() => {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, theta, true);
        return b;
      })(),
    );
    if (activePath.length !== prevPathLen) {
      w.record(E.traj, ts, poseArray(activePath));
      prevPathLen = activePath.length;
    }
    if (inAuto) w.record(E.trajSetpoint, ts, pose(setX, setY, setTheta));
    // Swerve: robot-relative chassis speeds, and each module's velocity = v + omega x r (order FL, FR, BL, BR)
    const rvx = vx * Math.cos(theta) + vy * Math.sin(theta);
    const rvy = -vx * Math.sin(theta) + vy * Math.cos(theta);
    const MOD: [number, number][] = [
      [0.29, 0.29],
      [0.29, -0.29],
      [-0.29, 0.29],
      [-0.29, -0.29],
    ];
    const setp: [number, number][] = MOD.map(([rx, ry]) => {
      const mx = rvx - omega * ry;
      const my = rvy + omega * rx;
      const sp = Math.hypot(mx, my);
      return [sp, sp > 0.02 ? Math.atan2(my, mx) : 0];
    });
    const measured: [number, number][] = setp.map(([sp, an], i) => [sp + (rand() - 0.5) * 0.1, an + (i === 2 ? 0.08 : 0) + (rand() - 0.5) * 0.02]);
    w.record(E.swerveMeas, ts, swerveStates(measured));
    w.record(E.swerveSet, ts, swerveStates(setp));
    w.record(E.chassis, ts, chassis(rvx, rvy, omega));

    // Mechanisms
    if (state !== prevState) {
      w.string(E.superState, ts, state);
      prevState = state;
    }
    if (hasPiece !== prevPiece) {
      w.boolean(E.hasPiece, ts, hasPiece);
      prevPiece = hasPiece;
    }
    w.double(E.shooterVel, ts, Number(shooterVel.toFixed(1)));
    w.double(E.shooterSet, ts, shooterSet);
    // The turret tracks the hub while a piece is held, and parks facing forward otherwise
    {
      const aim = state === 'SHOOTING' || state === 'HOLDING' ? Math.atan2(4.03 - y, 4.6 - x) - theta : 0;
      const err = Math.atan2(Math.sin(aim - turret), Math.cos(aim - turret));
      turret += Math.max(-0.12, Math.min(0.12, err * 0.2));
      w.double(E.turret, ts, Number(turret.toFixed(4)));
    }
    w.double(E.elevatorSet, ts, elevator);
    w.double(E.elevatorPos, ts, Number((elevator + (rand() - 0.5) * 0.004).toFixed(4)));

    // Vision: tags seen depend on position; camera drops for 3 s in Q18
    if (Math.round(t * 50) % 2 === 0) {
      if (m.brownoutAt !== undefined && inTeleop && t - teleopStart > 30 && t - teleopStart < 33) {
        if (!camDrop) {
          w.boolean(E.camConnected, ts, false);
          camDrop = true;
          w.string(E.console, ts, 'Error: Camera "Camera0" disconnected');
        }
        w.int64Array(E.tagIds, ts, []);
        w.record(E.camPoses, ts, poseArray([]));
        lastSeen[0] = '';
      } else {
        if (camDrop) {
          w.boolean(E.camConnected, ts, true);
          camDrop = false;
        }
        let [seen, est] = cameraView(0);
        // the glitch: a misread tag puts the estimate 1.1 m off for a second
        if (m.visionGlitchAt !== undefined && t >= teleopStart + m.visionGlitchAt && t < teleopStart + m.visionGlitchAt + 1) {
          seen = seen.length ? seen : [7];
          est = [[x + 1.1, y, theta]];
        }
        if (seen.join() !== lastSeen[0]) {
          w.int64Array(E.tagIds, ts, seen);
          lastSeen[0] = seen.join();
        }
        w.record(E.camPoses, ts, poseArray(est));
      }
    }

    // The rear camera never drops
    if (Math.round(t * 50) % 2 === 0) {
      const [seen, est] = cameraView(Math.PI);
      if (seen.join() !== lastSeen[1]) {
        w.int64Array(E.tagIds1, ts, seen);
        lastSeen[1] = seen.join();
      }
      w.record(E.camPoses1, ts, poseArray(est));
    }

    // Driver controller (AdvantageKit layout, Xbox numbering): left stick drives, right stick turns
    const clampAxis = (a: number) => Math.max(-1, Math.min(1, Math.abs(a) < 0.03 ? 0 : a));
    const axes =
      inTeleop && enabled ? [clampAxis(-vy / 4.6), clampAxis(-vx / 4.6), 0, state === 'SHOOTING' ? 1 : 0, clampAxis(-omega / 3), 0] : [0, 0, 0, 0, 0, 0];
    const buttons = inTeleop && enabled ? (state === 'INTAKING' ? 1 : 0) + (elevator > 0 ? 8 : 0) + (state === 'SHOOTING' ? 32 : 0) : 0;
    const pov = inTeleop && enabled && (t - teleopStart) % 20 < 0.6 ? 0 : -1;
    const joy = `${axes.map((a) => a.toFixed(2)).join()}|${buttons}|${pov}`;
    if (joy !== lastJoy) {
      w.doubleArray(
        E.joyAxes,
        ts,
        axes.map((a) => Number(a.toFixed(3))),
      );
      w.int64(E.joyButtons, ts, buttons);
      w.int64Array(E.joyPovs, ts, [pov]);
      lastJoy = joy;
    }

    // Command scheduler: the names of the commands running now
    const commands: string[] = [];
    if (enabled && inAuto) commands.push(m.auto);
    if (enabled && inTeleop) {
      commands.push('DriveWithJoysticks');
      if (state === 'INTAKING') commands.push('IntakeCommand');
      if (state === 'HOLDING' || state === 'SHOOTING') commands.push('SpinUpShooter');
      if (state === 'SHOOTING') commands.push('ShootSequence');
      if (elevator > 0) commands.push('ElevatorToHeight');
    }
    if (commands.join('|') !== lastCommands) {
      w.stringArray(E.scheduler, ts, commands);
      lastCommands = commands.join('|');
    }

    // Alerts
    const alerts = camDrop ? ['Camera0 disconnected'] : [];
    const aKey = alerts.join('|');
    if (aKey !== lastAlerts) {
      w.stringArray(E.alerts, ts, alerts);
      lastAlerts = aKey;
    }

    // Wall clock every 5 s
    if (t - lastEpochT >= 5) {
      const epochUs = Math.round((m.epoch + (t - T0)) * 1e6);
      w.int64(E.epoch, ts, epochUs);
      w.int64(E.systemTime, ts, epochUs);
      lastEpochT = t;
    }
  }
  w.string(E.messages, us(logEnd), 'Log closed');
  return w.toBytes();
}

// Written to fixtures/demo (tests, bench, smoke) and to the renderer's public
// folder so the in-app "Demo" button can fetch them.
const outDirs = [resolve(import.meta.dirname, '..', 'fixtures', 'demo'), resolve(import.meta.dirname, '..', 'src', 'renderer', 'public', 'demo')];
for (const d of outDirs) mkdirSync(d, { recursive: true });
for (const m of matches) {
  const bytes = makeLog(m);
  for (const d of outDirs) writeFileSync(resolve(d, m.file), bytes);
  console.log(`${m.file}: ${(bytes.length / 1e6).toFixed(1)} MB`);
}
