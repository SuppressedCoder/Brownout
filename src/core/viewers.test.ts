import { describe, it, expect } from 'vitest';
import { WpilogWriter } from './wpilog/writer';
import { LogData, type FieldInfo } from './log';
import { detectCameras, analyzeCameras, tagIdsFromValue, poseFromValue } from './vision';
import { controllerKeys, decodeButtons, decodePov } from './controller';
import { commandsFromNames, commandsFromBooleans, detectCommandSources } from './commands';
import { reportHtml, matchClock, matchTitle, type ReportInput } from './report';
import type { ModeRange } from './robotState';

const field = (key: string, kind: FieldInfo['kind'], structName?: string): FieldInfo => ({ key, kind, type: kind, count: 1, structName }) as FieldInfo;

describe('cameras and AprilTags', () => {
  it('reads tag IDs from a plain list and from a Limelight botpose array', () => {
    expect(tagIdsFromValue([7, 8], false)).toEqual([7, 8]);
    expect(tagIdsFromValue([], false)).toEqual([]);
    // 11 header values, then 7 per tag starting with its ID
    const botpose = [1, 2, 0, 0, 0, 90, 20, 2, 1, 2, 0.1, 7, 0, 0, 0, 2, 2, 0.1, 12, 0, 0, 0, 3, 3, 0.2];
    expect(tagIdsFromValue(botpose, true)).toEqual([7, 12]);
  });

  it('reads a robot pose from a struct, a struct array and a botpose array', () => {
    expect(poseFromValue({ translation: { x: 1, y: 2 }, rotation: { value: 0.5 } })).toEqual({ x: 1, y: 2, theta: 0.5 });
    expect(
      poseFromValue([
        { translation: { x: 1, y: 2 }, rotation: { value: 0 } },
        { translation: { x: 3, y: 4 }, rotation: { value: 0 } },
      ])?.x,
    ).toBe(3);
    expect(poseFromValue([])).toBeUndefined();
    const p = poseFromValue([1, 2, 0, 0, 0, 90, 20, 1, 0, 2, 0.1]);
    expect(p?.x).toBe(1);
    expect(p?.theta).toBeCloseTo(Math.PI / 2, 9);
    // tag count 0: Limelight has no estimate
    expect(poseFromValue([0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0])).toBeUndefined();
  });

  it('finds cameras from field names, each part optional', () => {
    const cams = detectCameras([
      field('/Vision/Camera0/TagIds', 'number[]'),
      field('/RealOutputs/Vision/Camera0/RobotPoses', 'struct[]', 'Pose2d'),
      field('/RealOutputs/Vision/Camera0/TagPoses', 'struct[]', 'Pose3d'),
      field('/Vision/Camera1/TagIds', 'number[]'),
      field('NT:/limelight-front/botpose_wpiblue', 'number[]'),
      field('NT:/limelight-front/botpose', 'number[]'),
      field('/Shooter/Cam/TargetIds', 'number[]'),
      field('/Drive/Speeds', 'number[]'),
    ]);
    expect(cams.map((c) => c.name)).toEqual(['Camera 0', 'Camera 1', 'limelight-front', 'Cam']);
    expect(cams[0]).toMatchObject({
      tagIdsKey: '/Vision/Camera0/TagIds',
      poseKey: '/RealOutputs/Vision/Camera0/RobotPoses',
      tagPosesKey: '/RealOutputs/Vision/Camera0/TagPoses',
    });
    expect(cams[1].poseKey).toBeUndefined();
    expect(cams[2]).toMatchObject({ poseKey: 'NT:/limelight-front/botpose_wpiblue', tagIdsKey: 'NT:/limelight-front/botpose_wpiblue' });
    expect(detectCameras([field('/Drive/Speeds', 'number[]')])).toEqual([]);
  });

  it('measures how long a camera saw a tag and finds blind stretches', () => {
    const w = new WpilogWriter();
    const us = (s: number) => Math.round(s * 1e6);
    const ids = w.start('/Vision/Camera0/TagIds', 'int64[]');
    // 0-4 s tag 7, 4-8 s nothing, 8-10 s tags 7 and 8
    for (let k = 0; k <= 100; k++) {
      const t = k / 10;
      w.int64Array(ids, us(t), t < 4 ? [7] : t < 8 ? [] : [7, 8]);
    }
    const log = new LogData(w.toBytes());
    const ranges: ModeRange[] = [
      { start: 0, end: 2, mode: 'disabled' },
      { start: 2, end: 10, mode: 'teleop' },
    ];
    const { summaries, series } = analyzeCameras(
      log,
      [{ id: 'c', name: 'Front', tagIdsKey: '/Vision/Camera0/TagIds', poseKey: '/Missing/Pose' }],
      ranges,
      undefined,
    );
    expect(summaries[0].seenFraction).toBeCloseTo(0.5, 2); // 2-4 and 8-10 of 2-10
    expect(summaries[0].blind).toHaveLength(1);
    expect(summaries[0].blind[0].start).toBeCloseTo(4, 5);
    expect(summaries[0].blind[0].end).toBeCloseTo(8, 5);
    expect(summaries[0].missing).toEqual(['/Missing/Pose']);
    expect(series[0].seen!.labels[0]).toBe('7');
    expect(series[0].seen!.labels[90]).toBe('7, 8');
    expect(series[0].seen!.counts[50]).toBe(0);
    // a camera with nothing logged reports nothing rather than failing
    const none = analyzeCameras(log, [{ id: 'x', name: 'Empty' }], ranges, undefined);
    expect(Number.isNaN(none.summaries[0].seenFraction)).toBe(true);
    expect(none.series[0].seen).toBeUndefined();
  });
});

describe('controllers', () => {
  it('finds AdvantageKit and DataLog joystick fields', () => {
    const ak = new Set([
      '/DriverStation/Joystick0/ButtonValues',
      '/DriverStation/Joystick0/AxisValues',
      '/DriverStation/Joystick0/POVs',
      '/DriverStation/Joystick0/Name',
    ]);
    expect(controllerKeys((k) => ak.has(k), 0, false)).toEqual({
      buttons: '/DriverStation/Joystick0/ButtonValues',
      axes: '/DriverStation/Joystick0/AxisValues',
      povs: '/DriverStation/Joystick0/POVs',
      name: '/DriverStation/Joystick0/Name',
      povMode: 'angle',
    });
    expect(controllerKeys((k) => ak.has(k), 1, false)).toBeNull();
    const ak27 = new Set(['/DriverStation/Joystick0/ButtonValues', '/DriverStation/Joystick0/POVValues']);
    expect(controllerKeys((k) => ak27.has(k), 0, true)).toMatchObject({ povs: '/DriverStation/Joystick0/POVValues', povMode: 'mask', axes: undefined });
    const ds = new Set(['DS:joystick2/buttons', 'DS:joystick2/axes', 'DS:joystick2/povs']);
    expect(controllerKeys((k) => ds.has(k), 2, false)).toEqual({
      buttons: 'DS:joystick2/buttons',
      axes: 'DS:joystick2/axes',
      povs: 'DS:joystick2/povs',
      povMode: 'angle',
    });
  });

  it('decodes buttons from a bit mask or a boolean list', () => {
    expect(decodeButtons(0b101, 4)).toEqual([true, false, true, false]);
    expect(decodeButtons([true, false, 1, 0])).toEqual([true, false, true, false]);
    expect(decodeButtons(undefined)).toEqual([]);
    // bit 31 and above still work (no 32-bit wraparound)
    expect(decodeButtons(2 ** 31, 32)[31]).toBe(true);
  });

  it('decodes the D-pad as an angle or as direction bits', () => {
    expect(decodePov(-1, 'angle')).toBeNull();
    expect(decodePov(0, 'angle')).toEqual({ x: 0, y: 1 });
    expect(decodePov(90, 'angle')).toEqual({ x: 1, y: 0 });
    expect(decodePov(225, 'angle')).toEqual({ x: -1, y: -1 });
    expect(decodePov(0, 'mask')).toBeNull();
    expect(decodePov(1, 'mask')).toEqual({ x: 0, y: 1 });
    expect(decodePov(2 | 4, 'mask')).toEqual({ x: 1, y: -1 });
    expect(decodePov(8, 'mask')).toEqual({ x: -1, y: 0 });
  });
});

describe('commands', () => {
  it('turns the scheduler name lists into runs', () => {
    const t = [0, 1, 2, 3, 4];
    const lists = [['Drive'], ['Drive', 'Intake'], ['Drive'], ['Drive', 'Intake', 'Intake'], ['Drive', 'Shoot']];
    const rows = commandsFromNames(t, lists, 6);
    expect(rows.map((r) => r.name)).toEqual(['Drive', 'Intake', 'Shoot']);
    expect(rows[0].runs).toEqual([{ start: 0, end: 6, open: true }]);
    expect(rows[1].runs).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
    expect(rows[1].total).toBe(2);
    expect(rows[2].runs[0]).toEqual({ start: 4, end: 6, open: true });
    expect(commandsFromNames([], [], 5)).toEqual([]);
  });

  it('turns one boolean per command into runs', () => {
    const rows = commandsFromBooleans(
      [
        { name: 'Shoot', t: [0, 5, 6], v: [false, true, false] },
        { name: 'Climb', t: [0, 8], v: [false, true] },
        { name: 'Never', t: [0], v: [false] },
      ],
      10,
    );
    expect(rows.map((r) => r.name)).toEqual(['Shoot', 'Climb']);
    expect(rows[0].runs).toEqual([{ start: 5, end: 6 }]);
    expect(rows[1].runs).toEqual([{ start: 8, end: 10, open: true }]);
  });

  it('finds the scheduler first, then one-flag-per-command folders', () => {
    const src = detectCommandSources([
      field('/RealOutputs/CommandsUnique/Shoot_1a', 'boolean'),
      field('/RealOutputs/CommandsAll/Shoot', 'boolean'),
      field('/RealOutputs/CommandsAll/Intake', 'boolean'),
      field('NT:/SmartDashboard/Scheduler/Names', 'string[]'),
      field('NT:/SmartDashboard/Scheduler/Ids', 'number[]'),
    ]);
    expect(src[0]).toEqual({ kind: 'names', key: 'NT:/SmartDashboard/Scheduler/Names' });
    expect(src[1]).toEqual({
      kind: 'booleans',
      prefix: '/RealOutputs/CommandsAll/',
      keys: ['/RealOutputs/CommandsAll/Intake', '/RealOutputs/CommandsAll/Shoot'],
    });
    expect(src[2]).toMatchObject({ kind: 'booleans', prefix: '/RealOutputs/CommandsUnique/' });
    expect(detectCommandSources([field('/Drive/Speed', 'number')])).toEqual([]);
  });
});

describe('match report', () => {
  const ranges: ModeRange[] = [
    { start: 0, end: 10, mode: 'disabled' },
    { start: 10, end: 25, mode: 'auto' },
    { start: 25, end: 160, mode: 'teleop' },
  ];
  const input: ReportInput = {
    name: 'NYROC Q12 <b>',
    fileName: 'FRC_20260321_143012_NYROC_Q12.wpilog',
    matchInfo: { eventName: 'NYROC', matchType: 'Qualification', matchNumber: 12, alliance: 'blue', station: 2 },
    robotState: { ranges, source: 'x', modeSource: 'x', firstEnable: 10, autoStart: 10, teleopStart: 25 },
    startTs: 0,
    endTs: 160,
    truncated: false,
    loggers: ['AdvantageKit'],
    power: {
      voltageKey: '/SystemStats/BatteryVoltage',
      enabledTime: 150,
      minVoltage: 6.1,
      minVoltageT: 82,
      timeBelowWarn: 3,
      timeBelowBrownout: 0.4,
      brownoutCount: 1,
      brownoutDuration: 0.4,
      brownoutsInferred: false,
      peakCurrent: 310,
      peakCurrentT: 82,
      avgCurrent: 60,
      energyWh: 30,
      internalResistance: 0.021,
      brownouts: [{ start: 82, end: 82.4 }],
      dips: [{ t: 82.1, voltage: 6.1, current: 310, topChannels: [{ channel: 3, amps: 80 }] }],
      findings: [],
      missing: [],
    },
    events: [
      { t: 40, kind: 'overrun', text: 'Loop 43.2 ms' },
      { t: 50, kind: 'overrun', text: 'Loop 120.0 ms' },
      { t: 60, kind: 'error', text: 'CAN frame not received <id 4>' },
    ],
    subsystems: {
      hasData: true,
      range: [0, 160],
      stats: [
        { id: 'drive', name: 'Drive', energyWh: 18, share: 0.6, avgCurrent: 35, peakCurrent: 180, peakT: 82, peakVoltage: 6.4, missing: [] },
        { id: 'elev', name: 'Elevator & "arm"', energyWh: 9, share: 0.3, avgCurrent: 15, peakCurrent: 120, peakT: 82.1, missing: [] },
      ],
      unassigned: { id: '__unassigned', name: 'Not assigned', energyWh: 3, share: 0.1, avgCurrent: 5, peakCurrent: 20, peakT: 30, missing: [] },
      totalEnergyWh: 30,
      totalSource: 'totalCurrent',
      brownouts: [
        {
          start: 82,
          end: 82.4,
          minVoltage: 6.1,
          minT: 82.1,
          atDip: [
            { id: 'drive', amps: 180 },
            { id: 'elev', amps: 110 },
            { id: '__unassigned', amps: 12 },
          ],
          before: [{ id: 'drive', amps: 150 }],
          totalAtDip: 302,
        },
      ],
      dips: [],
      warnings: [],
    },
    cameras: [{ id: 'c0', name: 'Front', missing: [], seenFraction: 0.62, blind: [{ start: 100, end: 109 }], meanError: 0.12, maxError: 0.9 }],
    missing: ['Loop time'],
    profileName: 'Comp bot',
    batteryLabel: 'B7',
    threshold: 6.75,
    voltage: { t: [0, 40, 82, 82.2, 160], v: [12.6, 11.8, 6.1, 9, 12.1] },
    when: null,
    generatedAt: 1_780_000_000_000,
    appVersion: '0.5.0',
  };

  it('formats times since the first enable with the mode', () => {
    expect(matchClock(input.robotState, 82)).toBe('1:12.0 teleop');
    expect(matchClock(input.robotState, 12.5)).toBe('0:02.5 auto');
    expect(matchClock(input.robotState, 4)).toBe('-0:06.0 disabled');
    expect(matchTitle(input.matchInfo, 'x')).toBe('NYROC · Qualification 12');
    expect(matchTitle({}, 'My log')).toBe('My log');
  });

  it('builds one self-contained page that names what caused the brownout', () => {
    const html = reportHtml(input);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // no scripts, no outside requests, and log text is escaped
    expect(html).not.toMatch(/<script|https?:\/\/|<link|<img/i);
    expect(html).toContain('NYROC Q12 &lt;b&gt;');
    expect(html).toContain('CAN frame not received &lt;id 4&gt;');
    expect(html).toContain('Elevator &amp; &quot;arm&quot;');
    expect(html).toContain('Drive 180 A, Elevator &amp; &quot;arm&quot; 110 A, Not assigned 12 A');
    expect(html).toContain('1:12.0 teleop');
    expect(html).toContain('21 mΩ');
    expect(html).toContain('2 loop overruns, 2 while enabled. The longest while enabled: 120 ms at 0:40.0 teleop; 43 ms at 0:30.0 teleop');
    expect(html).toContain('<td>Front</td><td class="r">62%</td>');
    expect(html).toContain('1 stretch with no tag, longest 9.00 s');
    expect(html).toContain('<svg');
    expect(html).toContain('Battery</dt><dd>B7');
  });

  it('still makes a report when most things are not logged', () => {
    const bare = reportHtml({
      ...input,
      power: {
        enabledTime: 0,
        timeBelowWarn: 0,
        timeBelowBrownout: 0,
        brownoutCount: 0,
        brownoutDuration: 0,
        brownoutsInferred: false,
        brownouts: [],
        dips: [],
        findings: [],
        missing: [],
      },
      events: [],
      subsystems: null,
      cameras: [],
      voltage: undefined,
      robotState: { ranges: [], source: null, modeSource: null },
    });
    expect(bare).toContain('Battery voltage is not in this log');
    expect(bare).toContain('No power subsystems are set up');
    expect(bare).toContain('No loop overruns.');
    expect(bare).not.toContain('<svg');
    expect(bare).not.toContain('<h2>Vision</h2>');
  });
});
