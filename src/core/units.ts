/**
 * Unit detection, in AdvantageScope's order of precedence: struct native
 * units (handled by the struct decoder), then metadata `unit`/`units` (top
 * level or under `properties`), then a unit suffix in the field name.
 */

const SUFFIXES: [RegExp, string][] = [
  [/MetersPerSecondSquared$/i, 'm/s²'],
  [/MetersPerSecond$/i, 'm/s'],
  [/RadiansPerSecond$/i, 'rad/s'],
  [/DegreesPerSecond$/i, 'deg/s'],
  [/RotationsPerSecond$/i, 'rot/s'],
  [/Meters$/i, 'm'],
  [/Inches$/i, 'in'],
  [/Radians$/i, 'rad'],
  [/Degrees$/i, 'deg'],
  [/Rotations$/i, 'rot'],
  [/Volts$/i, 'V'],
  [/Voltage$/i, 'V'],
  [/Amps$/i, 'A'],
  [/Current$/i, 'A'],
  [/Celsius$/i, '°C'],
  [/Temp(erature)?$/i, '°C'],
  [/Seconds$/i, 's'],
  [/Millis(econds)?$/i, 'ms'],
  [/MS$/, 'ms'],
  [/Ms$/, 'ms'],
  [/Micros$/i, 'µs'],
  [/RPM$/i, 'RPM'],
  [/Percent$/i, '%'],
  [/Watts$/i, 'W'],
  [/Joules$/i, 'J'],
  [/Hertz$/i, 'Hz'],
];

export function detectUnit(name: string, metadata: string, structUnit: string | undefined): string | undefined {
  if (structUnit) return structUnit;
  if (metadata) {
    try {
      const j = JSON.parse(metadata) as Record<string, unknown>;
      const direct = j.unit ?? j.units;
      if (typeof direct === 'string' && direct) return direct;
      const props = j.properties as Record<string, unknown> | undefined;
      const pu = props?.unit ?? props?.units;
      if (typeof pu === 'string' && pu) return pu;
    } catch {
      /* not JSON */
    }
  }
  const leaf = name.split('/').pop() ?? name;
  for (const [re, unit] of SUFFIXES) if (re.test(leaf)) return unit;
  return undefined;
}

/** Simple conversions between compatible units. Returns undefined if not convertible. */
export function convert(value: number, from: string, to: string): number | undefined {
  if (from === to) return value;
  const table: Record<string, Record<string, number>> = {
    m: { in: 39.3701, ft: 3.28084, cm: 100 },
    in: { m: 0.0254, ft: 1 / 12, cm: 2.54 },
    ft: { m: 0.3048, in: 12, cm: 30.48 },
    rad: { deg: 180 / Math.PI, rot: 1 / (2 * Math.PI) },
    deg: { rad: Math.PI / 180, rot: 1 / 360 },
    rot: { rad: 2 * Math.PI, deg: 360 },
    'rad/s': { 'deg/s': 180 / Math.PI, RPM: 60 / (2 * Math.PI) },
    'deg/s': { 'rad/s': Math.PI / 180 },
    RPM: { 'rad/s': (2 * Math.PI) / 60 },
    s: { ms: 1000, µs: 1e6 },
    ms: { s: 0.001, µs: 1000 },
    µs: { s: 1e-6, ms: 0.001 },
    'm/s': { 'ft/s': 3.28084 },
  };
  const f = table[from]?.[to];
  return f === undefined ? undefined : value * f;
}
