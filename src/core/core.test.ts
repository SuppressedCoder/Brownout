import { describe, it, expect } from 'vitest';
import { WpilogWriter } from './wpilog/writer';
import { WpilogReader, decodePrimitive } from './wpilog/reader';
import { StructRegistry, WELL_KNOWN_SCHEMAS, parseStructSchema } from './struct/structDecoder';
import { LogData } from './log';
import { computeRobotState, computeMatchInfo, detectEra } from './robotState';
import { computeOffset, parseTimeInput, parseSpanInput, formatSpan, clampWindow } from './alignment';
import { decimateMinMax } from './decimate';
import { analyzePower } from './analyzers/power';
import { computeSubsystems, suggestSubsystems, batteryRating, UNASSIGNED } from './analyzers/subsystems';
import { toCsv } from './csv';
import { detectUnit } from './units';
import { evalNumber } from './mathExpr';

describe('WPILOG round trip', () => {
  it('writes and reads primitives', () => {
    const w = new WpilogWriter('hdr');
    const d = w.start('/a/double', 'double', '{"units":"V"}');
    const b = w.start('/a/bool', 'boolean');
    const s = w.start('/a/str', 'string');
    const arr = w.start('/a/arr', 'double[]');
    w.double(d, 1_000_000, 12.5);
    w.double(d, 2_000_000, 11.5);
    w.boolean(b, 1_500_000, true);
    w.string(s, 3_000_000, 'hello');
    w.doubleArray(arr, 1_000_000, [1, 2, 3]);
    const bytes = w.toBytes();
    expect(WpilogReader.isWpilog(bytes)).toBe(true);
    const r = new WpilogReader(bytes);
    expect(r.index.extraHeader).toBe('hdr');
    expect(r.index.entries.map((e) => e.name)).toEqual(['/a/double', '/a/bool', '/a/str', '/a/arr']);
    expect(r.index.recordCount).toBe(5);
    const e = r.getEntry('/a/double')!;
    expect(e.count).toBe(2);
    expect(e.metadata).toBe('{"units":"V"}');
    const recs = r.recordsOf(e.index);
    expect(decodePrimitive('double', r.payload(recs.offsets[1], recs.sizes[1]))).toBe(11.5);
    expect(recs.timestamps[0]).toBe(1_000_000);
  });

  it('matches the spec example record bytes', () => {
    // int64 entry ID 1, value 3, at t = 1 s: 20 01 08 40 42 0f 03 00 00 00 00 00 00 00
    const w = new WpilogWriter();
    const id = w.start('x', 'int64');
    w.int64(id, 1_000_000, 3);
    const bytes = w.toBytes();
    const tail = Array.from(bytes.slice(bytes.length - 14));
    expect(tail).toEqual([0x20, 0x01, 0x08, 0x40, 0x42, 0x0f, 0x03, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('tolerates a truncated tail and merges re-started entries', () => {
    const w = new WpilogWriter();
    const id = w.start('/x', 'double');
    w.double(id, 10, 1);
    w.finish(id);
    const id2 = w.start('/x', 'double');
    w.double(id2, 20, 2);
    w.double(id2, 30, 3);
    const bytes = w.toBytes();
    const cut = bytes.slice(0, bytes.length - 5);
    const r = new WpilogReader(cut);
    expect(r.index.truncated).toBe(true);
    expect(r.index.entries.length).toBe(1);
    expect(r.index.entries[0].count).toBe(2);
  });

  it('sorts out-of-order timestamps', () => {
    const w = new WpilogWriter();
    const id = w.start('/x', 'double');
    w.double(id, 30, 3);
    w.double(id, 10, 1);
    w.double(id, 20, 2);
    const log = new LogData(w.toBytes());
    const s = log.series('/x')!;
    expect(s.kind).toBe('number');
    expect(Array.from(s.t)).toEqual([1e-5, 2e-5, 3e-5]);
    expect(Array.from((s as { v: Float64Array }).v)).toEqual([1, 2, 3]);
  });
});

describe('struct decoding', () => {
  it('parses and decodes Pose2d', () => {
    const reg = new StructRegistry();
    for (const [n, s] of Object.entries(WELL_KNOWN_SCHEMAS)) reg.add(n, s);
    expect(reg.size('Pose2d')).toBe(24);
    const b = new Uint8Array(24);
    const v = new DataView(b.buffer);
    v.setFloat64(0, 1.5, true);
    v.setFloat64(8, 2.5, true);
    v.setFloat64(16, 0.25, true);
    const p = reg.decode('Pose2d', b)!;
    expect(p).toEqual({ translation: { x: 1.5, y: 2.5 }, rotation: { value: 0.25 } });
    expect(reg.leaves('Pose2d').map((l) => l.path)).toEqual(['translation/x', 'translation/y', 'rotation/value']);
  });

  it('decodes the 2027 ControlWord bit-fields', () => {
    const reg = new StructRegistry();
    reg.add('ControlWord', WELL_KNOWN_SCHEMAS.ControlWord);
    expect(reg.size('ControlWord')).toBe(8);
    // opModeHash = 5, robotMode = 1 (autonomous), enabled, fmsAttached, dsAttached
    const word = 5n | (1n << 56n) | (1n << 58n) | (1n << 60n) | (1n << 61n);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, word, true);
    const cw = reg.decode('ControlWord', b)!;
    expect(cw.opModeHash).toBe(5);
    expect(cw.robotMode).toBe('autonomous');
    expect(cw.enabled).toBe(true);
    expect(cw.eStop).toBe(false);
    expect(cw.fmsAttached).toBe(true);
    expect(cw.dsAttached).toBe(true);
  });

  it('handles arrays and enums in schemas', () => {
    const s = parseStructSchema('T', 'enum {a=0, b=1} int8 mode; double vals[3]; char name[4]');
    expect(s.fields.length).toBe(3);
    expect(s.fields[0].enum).toEqual({ 0: 'a', 1: 'b' });
    expect(s.fields[1].arrayLen).toBe(3);
    const reg = new StructRegistry();
    reg.add('T', 'enum {a=0, b=1} int8 mode; double vals[3]; char name[4]');
    expect(reg.size('T')).toBe(1 + 24 + 4);
  });
});

function makeMatchLog(): LogData {
  const w = new WpilogWriter();
  const us = (s: number) => Math.round(s * 1e6);
  const en = w.start('/DriverStation/Enabled', 'boolean');
  const au = w.start('/DriverStation/Autonomous', 'boolean');
  const v = w.start('/SystemStats/BatteryVoltage', 'double');
  const bo = w.start('/SystemStats/BrownedOut', 'boolean');
  const cur = w.start('/PowerDistribution/TotalCurrent', 'double');
  const ev = w.start('/DriverStation/EventName', 'string');
  const st = w.start('/DriverStation/AllianceStation', 'int64');
  const sys = w.start('systemTime', 'int64');
  w.string(ev, us(0), 'NYROC');
  w.int64(st, us(0), 4);
  w.int64(sys, us(0.5), 1_700_000_000_000_000);
  w.boolean(en, us(0), false);
  w.boolean(au, us(0), false);
  w.boolean(bo, us(0), false);
  for (let k = 0; k < 600; k++) {
    const t = k / 10;
    const enabled = t >= 10 && t < 55;
    const auto = t >= 10 && t < 25;
    const volt = t >= 40 && t < 40.3 ? 6.2 : enabled ? 11.8 : 12.6;
    w.double(v, us(t), volt);
    w.double(cur, us(t), enabled ? 40 : 2);
    if (t === 10 || t === 55) w.boolean(en, us(t), enabled);
    if (Math.abs(t - 10) < 1e-9) w.boolean(au, us(t), true);
    if (Math.abs(t - 25) < 1e-9) w.boolean(au, us(t), false);
    if (Math.abs(t - 40) < 1e-9) w.boolean(bo, us(t), true);
    if (Math.abs(t - 40.3) < 1e-9) w.boolean(bo, us(t), false);
  }
  w.boolean(en, us(55), false);
  return new LogData(w.toBytes());
}

describe('robot state and analysis', () => {
  it('finds mode ranges, anchors and match info', () => {
    const log = makeMatchLog();
    const rs = computeRobotState(log);
    expect(rs.source).toBe('/DriverStation/Enabled');
    expect(rs.ranges.map((r) => r.mode)).toEqual(['disabled', 'auto', 'teleop', 'disabled']);
    expect(rs.autoStart).toBeCloseTo(10, 5);
    expect(rs.teleopStart).toBeCloseTo(25, 5);
    expect(rs.firstEnable).toBeCloseTo(10, 5);
    expect(rs.epochOffset).toBeCloseTo(1_700_000_000 - 0.5, 3);
    const mi = computeMatchInfo(log);
    expect(mi.eventName).toBe('NYROC');
    expect(mi.alliance).toBe('blue');
    expect(mi.station).toBe(2);
    expect(detectEra(log)).toBe('2026');
  });

  it('computes alignment offsets', () => {
    const a = { startTs: 1, autoStart: 11, firstEnable: 11, teleopStart: 26, epochOffset: 1000 };
    const b = { startTs: 2, autoStart: 30, firstEnable: 30, teleopStart: 45, epochOffset: 1500 };
    expect(computeOffset('autoStart', a, a)).toBe(-11);
    expect(computeOffset('autoStart', b, a)).toBe(-30);
    expect(computeOffset('logStart', b, a)).toBe(-2);
    expect(computeOffset('raw', b, a)).toBe(0);
    // wall clock: b is 500 s later than a in real time; aligned so a starts at 0
    expect(computeOffset('wallClock', b, a)).toBe(500 - 1);
    expect(computeOffset('wallClock', a, a)).toBe(-1);
  });

  it('builds a power report with a brownout', () => {
    const log = makeMatchLog();
    const rs = computeRobotState(log);
    const rep = analyzePower(log, rs.ranges);
    expect(rep.voltageKey).toBe('/SystemStats/BatteryVoltage');
    expect(rep.brownoutCount).toBe(1);
    expect(rep.brownoutsInferred).toBe(false);
    expect(rep.minVoltage).toBeCloseTo(6.2, 5);
    expect(rep.minVoltageT).toBeCloseTo(40, 5);
    expect(rep.avgVoltage!).toBeLessThan(12);
    expect(rep.energyWh!).toBeGreaterThan(0);
    expect(rep.findings.some((f) => f.title === 'Brownout')).toBe(true);
  });
});

describe('decimation and export', () => {
  it('keeps spikes when decimating', () => {
    const n = 10000;
    const t = new Float64Array(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = i * 0.01;
      v[i] = 12;
    }
    v[5000] = 6; // one-sample dip
    const d = decimateMinMax(t, v, 0, 0, 100, 200);
    expect(d.n).toBeLessThan(1000);
    expect(Math.min(...Array.from(d.y))).toBe(6);
  });

  it('exports CSV with sample-and-hold rows', () => {
    const csv = toCsv(
      [
        { name: 'a', t: Float64Array.from([0, 1, 2]), v: [1, 2, 3] },
        { name: 'b', t: Float64Array.from([0.5]), v: ['x,y'] },
      ],
      0,
      2,
    );
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Timestamp,a,b');
    expect(lines.length).toBe(5);
    expect(lines[2]).toBe('0.500000,1,"x,y"');
    expect(lines[4]).toBe('2.000000,3,"x,y"');
  });

  it('detects units', () => {
    expect(detectUnit('/x/PositionMeters', '', undefined)).toBe('m');
    expect(detectUnit('/x/y', '{"units":"V"}', undefined)).toBe('V');
    expect(detectUnit('/x/y', '{"properties":{"unit":"A"},"source":"NT"}', undefined)).toBe('A');
    expect(detectUnit('/LoggedRobot/FullCycleMS', '', undefined)).toBe('ms');
  });
});

describe('time input and view clamping', () => {
  it('parses typed times', () => {
    expect(parseTimeInput('1:23.4')).toBeCloseTo(83.4);
    expect(parseTimeInput('+0:05')).toBe(5);
    expect(parseTimeInput('-10')).toBe(-10);
    expect(parseTimeInput(' 83.4s ')).toBeCloseTo(83.4);
    expect(parseTimeInput('2:75')).toBeNull();
    expect(parseTimeInput('banana')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
  });

  it('parses and formats spans', () => {
    expect(parseSpanInput('30')).toBe(30);
    expect(parseSpanInput('500ms')).toBe(0.5);
    expect(parseSpanInput('2m')).toBe(120);
    expect(parseSpanInput('1:30')).toBe(90);
    expect(parseSpanInput('1.5 min')).toBe(90);
    expect(parseSpanInput('0')).toBeNull();
    expect(parseSpanInput('wide')).toBeNull();
    expect(formatSpan(0.25)).toBe('250 ms');
    expect(formatSpan(12.5)).toBe('12.5 s');
    expect(formatSpan(155)).toBe('2:35');
    expect(parseSpanInput(formatSpan(155))).toBe(155);
  });

  it('keeps the visible window inside the session', () => {
    // panning past the start keeps the span and stops at the edge
    expect(clampWindow(-50, -20, 0, 100, 'pan')).toEqual([0, 30]);
    expect(clampWindow(90, 120, 0, 100, 'pan')).toEqual([70, 100]);
    // zooming out further than the session shows exactly the session
    expect(clampWindow(-500, 500, 0, 100, 'pan')).toEqual([0, 100]);
    // resizing clamps each edge on its own
    expect(clampWindow(-10, 40, 0, 100, 'resize')).toEqual([0, 40]);
    expect(clampWindow(60, 140, 0, 100, 'resize')).toEqual([60, 100]);
    // too narrow is refused
    expect(clampWindow(5, 5.001, 0, 100, 'pan')).toBeNull();
  });
});

describe('power by subsystem', () => {
  /** 20 s at 10 Hz: drive on PDH channels 0 and 1 (10 A each), a shooter field at 20 A, and an elevator field that spikes to 200 A during a brownout at t = 10 s. */
  function makeLog(): LogData {
    const w = new WpilogWriter();
    const us = (s: number) => Math.round(s * 1e6);
    const v = w.start('/SystemStats/BatteryVoltage', 'double');
    const tot = w.start('/PowerDistribution/TotalCurrent', 'double');
    const ch = w.start('/PowerDistribution/ChannelCurrent', 'double[]');
    const sh = w.start('/Shooter/SupplyCurrentAmps', 'double');
    const shStator = w.start('/Shooter/StatorCurrentAmps', 'double');
    const el = w.start('/Elevator/SupplyCurrentAmps', 'double');
    const elSet = w.start('/Elevator/CurrentLimitAmps', 'double');
    for (let k = 0; k <= 200; k++) {
      const t = k / 10;
      const spike = t >= 10 && t < 10.5;
      const elev = spike ? 200 : 5;
      w.double(v, us(t), spike ? 6 : 12);
      w.double(tot, us(t), 10 + 10 + 20 + elev + 5); // 5 A that no subsystem claims
      w.doubleArray(ch, us(t), [10, 10, 0, 0]);
      w.double(sh, us(t), 20);
      w.double(shStator, us(t), 40);
      w.double(el, us(t), elev);
      w.double(elSet, us(t), 60);
    }
    return new LogData(w.toBytes());
  }
  const defs = [
    { id: 'drive', name: 'Drive', channels: [0, 1], fields: [] },
    { id: 'shooter', name: 'Shooter', channels: [], fields: ['/Shooter/SupplyCurrentAmps'] },
    { id: 'elevator', name: 'Elevator', channels: [], fields: ['/Elevator/SupplyCurrentAmps'] },
  ];
  const input = {
    defs,
    voltageKey: '/SystemStats/BatteryVoltage',
    totalCurrentKey: '/PowerDistribution/TotalCurrent',
    channelsKey: '/PowerDistribution/ChannelCurrent',
    brownouts: [{ start: 10, end: 10.5 }],
    dips: [{ t: 10.2, voltage: 6 }],
  };

  it('splits energy and current between subsystems and the unassigned rest', () => {
    const { report, series } = computeSubsystems(makeLog(), input);
    expect(report.hasData).toBe(true);
    const by = Object.fromEntries(report.stats.map((s) => [s.id, s]));
    expect(by.drive.avgCurrent).toBeCloseTo(20, 1);
    expect(by.shooter.avgCurrent).toBeCloseTo(20, 1);
    expect(by.elevator.peakCurrent).toBe(200);
    expect(by.elevator.peakT).toBeCloseTo(10, 5);
    expect(by.elevator.peakVoltage).toBe(6);
    expect(report.unassigned!.avgCurrent).toBeCloseTo(5, 1);
    // drive and shooter draw the same current at the same voltage
    expect(by.drive.energyWh).toBeCloseTo(by.shooter.energyWh, 6);
    // 20 A at 12 V for 19.5 s plus 20 A at 6 V for 0.5 s
    expect(by.drive.energyWh).toBeCloseTo((20 * 12 * 19.5 + 20 * 6 * 0.5) / 3600, 3);
    const shares = report.stats.reduce((a, s) => a + s.share, 0) + report.unassigned!.share;
    expect(shares).toBeCloseTo(1, 6);
    expect(series!.current.drive.length).toBe(201);
    expect(series!.current[UNASSIGNED][50]).toBeCloseTo(5, 6);
  });

  it('names what was drawing at a brownout and at a dip', () => {
    const { report } = computeSubsystems(makeLog(), input);
    expect(report.brownouts).toHaveLength(1);
    const b = report.brownouts[0];
    expect(b.atDip[0]).toEqual({ id: 'elevator', amps: 200 });
    expect(b.totalAtDip).toBe(245);
    expect(b.minVoltage).toBe(6);
    // the half second before the brownout is ordinary driving
    expect(b.before[0].amps).toBeCloseTo(20, 6);
    expect(b.before.find((d) => d.id === 'elevator')!.amps).toBeCloseTo(5, 6);
    expect(report.dips[0].draws[0].id).toBe('elevator');
  });

  it('reports on a time range only', () => {
    const { report } = computeSubsystems(makeLog(), { ...input, range: [0, 5] });
    expect(report.stats.find((s) => s.id === 'elevator')!.peakCurrent).toBe(5);
    expect(report.brownouts).toHaveLength(0);
  });

  it('flags missing sources and stator current', () => {
    const { report } = computeSubsystems(makeLog(), {
      ...input,
      defs: [
        { id: 'a', name: 'Arm', channels: [9], fields: ['/Arm/Nope'] },
        { id: 's', name: 'Shooter', channels: [], fields: ['/Shooter/StatorCurrentAmps'] },
      ],
    });
    expect(report.stats[0].missing).toEqual(['/Arm/Nope', 'channel 9']);
    expect(report.warnings.some((w) => /stator/i.test(w))).toBe(true);
  });

  it('works without a total current by summing the channels', () => {
    const { report } = computeSubsystems(makeLog(), { ...input, totalCurrentKey: undefined, defs: [defs[0]] });
    expect(report.totalSource).toBe('channelSum');
    expect(report.unassigned!.avgCurrent).toBeCloseTo(0, 6);
  });

  it('suggests subsystems from field names, preferring supply current', () => {
    const s = suggestSubsystems(makeLog().fields);
    expect(s.map((d) => d.name)).toEqual(['Elevator', 'Shooter']);
    expect(s.find((d) => d.name === 'Shooter')!.fields).toEqual(['/Shooter/SupplyCurrentAmps']);
    expect(s.find((d) => d.name === 'Elevator')!.fields).toEqual(['/Elevator/SupplyCurrentAmps']);
  });

  it('rates battery resistance', () => {
    expect(batteryRating(0.014)).toBe('good');
    expect(batteryRating(0.022)).toBe('fair');
    expect(batteryRating(0.03)).toBe('weak');
    expect(batteryRating(undefined)).toBe('unknown');
  });
});

describe('math in number boxes', () => {
  it('works out what was typed', () => {
    expect(evalNumber('0.09448 * 360')).toBeCloseTo(34.0128, 10);
    expect(evalNumber('12')).toBe(12);
    expect(evalNumber(' -0.5 ')).toBe(-0.5);
    expect(evalNumber('1e-3')).toBe(0.001);
    expect(evalNumber('(27 + 3) / 39.37')).toBeCloseTo(0.762, 3);
    expect(evalNumber('2 + 3 * 4')).toBe(14);
    expect(evalNumber('2^3^2')).toBe(512);
    expect(evalNumber('2 ** 10')).toBe(1024);
    expect(evalNumber('-2^2')).toBe(-4);
    expect(evalNumber('10 % 3')).toBe(1);
    expect(evalNumber('6 × 7 ÷ 2')).toBe(21);
    expect(evalNumber('sqrt(2) / 2')).toBeCloseTo(Math.SQRT1_2, 12);
    expect(evalNumber('pi / 2')).toBeCloseTo(Math.PI / 2, 12);
    expect(evalNumber('max(1, 4, 2)')).toBe(4);
    expect(evalNumber('atan2(1, 1)')).toBeCloseTo(Math.PI / 4, 12);
    expect(evalNumber('--3')).toBe(3);
  });
  it('says no to anything that is not a number', () => {
    for (const bad of ['', 'abc', '1 +', '(2', '2)', '1/0', 'sqrt(-1)', '2 pi', 'alert(1)', 'x * 2', '1,2', 'Math.PI', '3 ; 4'])
      expect(evalNumber(bad), bad).toBeNull();
  });
  it('time boxes keep their formats and take math in seconds too', () => {
    expect(parseTimeInput('1:30')).toBe(90);
    expect(parseTimeInput('60 + 12.5')).toBe(72.5);
    expect(parseSpanInput('500ms')).toBe(0.5);
    expect(parseSpanInput('2 * 60')).toBe(120);
    expect(parseSpanInput('1 - 2')).toBeNull();
  });
});
