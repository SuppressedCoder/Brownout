/**
 * Layouts seen in a real team log (CURIE Q89, 2026 Championship): WPILib
 * DataLogManager with NetworkTables mirrored, SmartDashboard folders per
 * subsystem, three Limelights, PathPlanner telemetry, and no battery voltage.
 * Each test pins down something the synthetic demo logs did not catch.
 */
import { describe, it, expect } from 'vitest';
import { WpilogWriter } from './wpilog/writer';
import { LogData } from './log';
import { resolveRoleCandidates } from './roles';
import { extractConsole, extractEvents, message } from './analyzers/events';
import { computeSubsystems, suggestSubsystems } from './analyzers/subsystems';
import { analyzePaths } from './analyzers/paths';

const us = (s: number) => Math.round(s * 1e6);
const SD = 'NT:/SmartDashboard/';

function pose(x: number, y: number, theta: number): Uint8Array {
  return new Uint8Array(new Float64Array([x, y, theta]).buffer);
}
function poses(list: [number, number, number][]): Uint8Array {
  return new Uint8Array(new Float64Array(list.flat()).buffer);
}

describe('real log: timestamps', () => {
  /** A hand-made file whose second record has a negative 8-byte timestamp, as a Limelight writes before its clock syncs. */
  function logWithNegativeTime(): Uint8Array {
    const parts: number[] = [];
    const u32 = (v: number) => parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const str = (s: string) => {
      u32(s.length);
      for (const c of s) parts.push(c.charCodeAt(0));
    };
    const ts8 = (v: bigint) => {
      const b = new DataView(new ArrayBuffer(8));
      b.setBigInt64(0, v, true);
      for (let i = 0; i < 8; i++) parts.push(b.getUint8(i));
    };
    for (const c of 'WPILOG') parts.push(c.charCodeAt(0));
    parts.push(0x00, 0x01);
    u32(0);
    // Start record for entry 1, "NT:/limelight-launch/tx" double. Header: 1-byte id, 1-byte size, 8-byte time.
    const start: number[] = [];
    {
      const before = parts.length;
      parts.push(0);
      u32(1);
      str('NT:/limelight-launch/tx');
      str('double');
      str('');
      start.push(...parts.splice(before));
    }
    parts.push(0x70, 0, start.length);
    ts8(0n);
    parts.push(...start);
    const data = (t: bigint, v: number) => {
      parts.push(0x70, 1, 8);
      ts8(t);
      parts.push(...new Uint8Array(new Float64Array([v]).buffer));
    };
    data(1_000_000n, 1);
    data(-5_000n, 2);
    data(2_000_000n, 3);
    return new Uint8Array(parts);
  }

  it('reads an 8-byte time as signed and places an impossible one at the previous record', () => {
    const log = new LogData(logWithNegativeTime());
    expect(log.reader.index.repairedTimestamps).toBe(1);
    // the log spans 1 s to 2 s, not 1 s to 584,942 years
    expect(log.startTs).toBe(1);
    expect(log.endTs).toBe(2);
    const s = log.series('NT:/limelight-launch/tx');
    expect(s?.kind).toBe('number');
    expect(Array.from(s!.t)).toEqual([1, 1, 2]);
    expect(Array.from(s!.v as Float64Array)).toEqual([1, 2, 3]);
  });
});

describe('real log: roles', () => {
  function log(): LogData {
    const w = new WpilogWriter();
    // PathPlanner publishes its pose only while a path runs; the team's own pose is logged all match
    const pp = w.start('NT:/PathPlanner/currentPose', 'struct:Pose2d');
    const own = w.start(`${SD}Subsystems/Drive/Robot Position 2D`, 'struct:Pose2d');
    const cam = w.start(`${SD}Subsystems/Drive/Visions/limelight-launch/Pose`, 'struct:Pose2d');
    const target = w.start('NT:/PathPlanner/targetPose', 'struct:Pose2d');
    const measured = w.start(`${SD}Subsystems/Drive/Current Modules States`, 'struct:SwerveModuleState[]');
    const setpoint = w.start(`${SD}Subsystems/Drive/Target Modules States`, 'struct:SwerveModuleState[]');
    const auto = w.start(`${SD}Robot Container/Autonomous/active`, 'string');
    // four SwerveModuleStates: speed 1 m/s, angle 0 rad
    const states = new Uint8Array(new Float64Array([1, 0, 1, 0, 1, 0, 1, 0]).buffer);
    for (let k = 0; k <= 100; k++) {
      const t = k;
      w.record(own, us(t), pose(k * 0.01, 1, 0));
      w.record(cam, us(t), pose(k * 0.01, 1, 0));
      w.record(measured, us(t), states);
      w.record(setpoint, us(t), states);
      if (t >= 10 && t <= 20) {
        w.record(pp, us(t), pose(k * 0.01, 1, 0));
        w.record(target, us(t), pose(k * 0.01, 1, 0));
      }
    }
    w.string(auto, us(5), '[H] - [DEPOT SCORE]');
    return new LogData(w.toBytes());
  }

  it('prefers a pose logged all match over one that exists only while a path runs, and never a camera estimate', () => {
    const c = resolveRoleCandidates(log(), 'robotPose');
    expect(c[0]).toBe(`${SD}Subsystems/Drive/Robot Position 2D`);
    expect(c).not.toContain(`${SD}Subsystems/Drive/Visions/limelight-launch/Pose`);
    expect(c).not.toContain('NT:/PathPlanner/targetPose');
    expect(c).toContain('NT:/PathPlanner/currentPose');
  });

  it('finds swerve states and the auto chooser under team-chosen names', () => {
    const l = log();
    expect(resolveRoleCandidates(l, 'swerveMeasured')[0]).toBe(`${SD}Subsystems/Drive/Current Modules States`);
    expect(resolveRoleCandidates(l, 'swerveMeasured')).not.toContain(`${SD}Subsystems/Drive/Target Modules States`);
    expect(resolveRoleCandidates(l, 'swerveSetpoint')[0]).toBe(`${SD}Subsystems/Drive/Target Modules States`);
    expect(resolveRoleCandidates(l, 'autoRoutine')[0]).toBe(`${SD}Robot Container/Autonomous/active`);
  });
});

describe('real log: console and alerts', () => {
  function log(): LogData {
    const w = new WpilogWriter();
    const c = w.start('console', 'string');
    w.string(c, us(10), '********** Robot program startup complete **********');
    for (let k = 0; k < 6; k++)
      w.string(
        c,
        us(11 + k),
        `Warning at edu.wpi.first.wpilibj.DriverStation.reportJoystickUnpluggedWarning(DriverStation.java:1345): Joystick Button ${k} on port 1 not available, check if controller is plugged in`,
      );
    w.string(
      c,
      us(30),
      'Warning at edu.wpi.first.wpilibj.IterativeRobotBase.printLoopOverrunMessage(IterativeRobotBase.java:436): Loop time of 0.02s overrun\n',
    );
    w.string(
      c,
      us(30.1),
      'Warning at edu.wpi.first.wpilibj.Tracer.lambda$printEpochs$0(Tracer.java:62): \tSmartDashboard.updateValues(): 0.003000s\n\trobotPeriodic(): 0.176225s',
    );
    // an alert group named by the team ("Power"), recognised by its .type
    const type = w.start(`${SD}Power/.type`, 'string');
    w.string(type, us(1), 'Alerts');
    const warn = w.start(`${SD}Power/warnings`, 'string[]');
    w.stringArray(warn, us(1), []);
    w.stringArray(warn, us(40), ['Battery had below 12V!']);
    w.stringArray(warn, us(41), []);
    w.stringArray(warn, us(42), ['Battery had below 12V!']);
    w.stringArray(warn, us(60), []);
    w.stringArray(warn, us(80), ['Battery had below 12V!']);
    return new LogData(w.toBytes());
  }

  it('reads WPILib "Warning at ..." lines as warnings, keeping the message', () => {
    const lines = extractConsole(log());
    expect(lines.find((l) => l.text.includes('Joystick'))!.severity).toBe('warning');
    expect(message('Warning at a.b.C.d(C.java:1): Joystick Button 3 on port 0 not available')).toBe('Joystick Button 3 on port 0 not available');
  });

  it('does not call the first program start a restart, folds repeats, and names the slowest part of an overrun', () => {
    const l = log();
    const ev = extractEvents(l, extractConsole(l));
    expect(ev.filter((e) => e.kind === 'reboot')).toHaveLength(0);
    const joystick = ev.filter((e) => e.kind === 'warning' && e.text.includes('Joystick'));
    expect(joystick).toHaveLength(1);
    expect(joystick[0].text).toContain('6 times');
    const overrun = ev.find((e) => e.kind === 'overrun')!;
    expect(overrun.text).toBe('Loop overrun: robotPeriodic() took 176.2 ms');
  });

  it('lists alerts from a team-named alert group once per occurrence', () => {
    const l = log();
    const alerts = extractEvents(l, extractConsole(l)).filter((e) => e.kind === 'alert');
    // raised at 40, cleared at 41 and back at 42 (one occurrence), raised again at 80
    expect(alerts.map((a) => a.t)).toEqual([40, 80]);
    expect(alerts[0].text).toBe('[Alert] Power: Battery had below 12V!');
  });
});

describe('real log: power by subsystem without battery voltage', () => {
  function log(): LogData {
    const w = new WpilogWriter();
    // NetworkTables logs a value only when it changes: two motors with different update times
    const intake = w.start(`${SD}Subsystems/Intake/Motor/Current (Amps)`, 'double');
    const spin = w.start(`${SD}Subsystems/Spindexer/Motor/Current (Amps)`, 'double');
    const intakeTemp = w.start(`${SD}Subsystems/Intake/Motor/Temperature (C)`, 'double');
    const target = w.start(`${SD}Subsystems/Launcher/Left Motor/Target Velocity (RPM)`, 'double');
    w.double(intake, us(0), 0);
    w.double(intake, us(10), 20); // 20 A from 10 s to 20 s
    w.double(intake, us(20), 0);
    w.double(spin, us(0), 0);
    w.double(spin, us(15), 10); // 10 A from 15 s to 30 s, with a single sample in the middle that dips hard
    for (const t of [16, 17, 18]) w.double(spin, us(t), -30);
    w.double(spin, us(19), 10);
    w.double(spin, us(30), 0);
    w.double(intakeTemp, us(0), 30);
    w.double(target, us(0), 3000);
    w.double(intake, us(40), 0);
    return new LogData(w.toBytes());
  }

  it('groups motors by the folder after "Subsystems"', () => {
    const s = suggestSubsystems(log().fields);
    expect(s.map((d) => d.name)).toEqual(['Intake', 'Spindexer']);
    expect(s[0].fields).toEqual([`${SD}Subsystems/Intake/Motor/Current (Amps)`]);
  });

  it('estimates energy at 12 V, averages over enabled time, and flags a current that swings below zero', () => {
    const l = log();
    const defs = suggestSubsystems(l.fields);
    const { report } = computeSubsystems(l, { defs, brownouts: [], dips: [], enabled: [{ start: 10, end: 20 }] });
    expect(report.voltageAssumed).toBe(12);
    expect(report.totalSource).toBe('none');
    const intake = report.stats.find((x) => x.name === 'Intake')!;
    // 20 A for 10 s at 12 V
    expect(intake.energyWh).toBeCloseTo((20 * 12 * 10) / 3600, 6);
    // enabled 10 s to 20 s: the intake ran the whole time
    expect(intake.avgCurrent).toBeCloseTo(20, 6);
    // every sample time of every motor is kept, so the intake's peak is found even between spindexer samples
    expect(intake.peakCurrent).toBe(20);
    expect(report.stats.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 6);
    expect(report.warnings.some((w) => w.includes('Spindexer') && w.includes('-30 A'))).toBe(true);
  });
});

describe('real log: PathPlanner paths', () => {
  it('ends a path when PathPlanner stops publishing its target, not at the end of the log', () => {
    const w = new WpilogWriter();
    const ap = w.start('NT:/PathPlanner/activePath', 'struct:Pose2d[]');
    const tp = w.start('NT:/PathPlanner/targetPose', 'struct:Pose2d');
    const rp = w.start('NT:/Robot', 'struct:Pose2d');
    w.record(
      ap,
      us(10),
      poses([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    );
    for (let k = 0; k <= 20; k++) w.record(tp, us(10 + k * 0.1), pose(k * 0.05, 0, 0));
    for (let k = 0; k <= 3000; k++) w.record(rp, us(k * 0.1), pose(0, 0, 0));
    const log = new LogData(w.toBytes());
    const a = analyzePaths(log, 'NT:/PathPlanner/activePath', 'NT:/PathPlanner/targetPose', 'NT:/Robot')!;
    expect(a.segments).toHaveLength(1);
    expect(a.segments[0].end).toBeCloseTo(12, 6);
    expect(a.segments[0].duration).toBeCloseTo(2, 6);
  });
});
