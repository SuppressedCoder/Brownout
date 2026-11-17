/**
 * WPILib Packed Struct Serialization v1.0 decoder
 * (allwpilib/wpiutil/doc/struct.adoc).
 *
 * Schema grammar (summary):
 *   declarations separated by ';'
 *   [enum {a=1, b=2}] <type> <name>[ [N] ]      standard
 *   [enum {...}] <int-or-bool type> <name> : <bits>   bit-field
 * Built-in types: bool, char, int8..int64, uint8..uint64, float/float32,
 * double/float64. Anything else is another struct, inlined.
 */

export interface StructField {
  name: string;
  type: string;
  arrayLen?: number;
  bits?: number;
  enum?: Record<number, string>;
}

export interface StructSchema {
  name: string;
  fields: StructField[];
}

const PRIM_SIZE: Record<string, number> = {
  bool: 1,
  char: 1,
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

export function isPrimitive(type: string): boolean {
  return type in PRIM_SIZE;
}

export function parseStructSchema(name: string, text: string): StructSchema {
  const fields: StructField[] = [];
  // Split on ';' but not inside enum braces.
  const decls: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ';' && depth === 0) {
      decls.push(cur);
      cur = '';
    } else cur += ch;
  }
  decls.push(cur);
  for (let d of decls) {
    d = d.trim();
    if (!d) continue;
    let enumMap: Record<number, string> | undefined;
    const em = d.match(/^enum\s*\{([^}]*)\}\s*/);
    if (em) {
      enumMap = {};
      for (const part of em[1].split(',')) {
        const [k, v] = part.split('=').map((s) => s.trim());
        if (k && v !== undefined) enumMap[Number(v)] = k;
      }
      d = d.slice(em[0].length);
    }
    const bm = d.match(/^(\S+)\s+([A-Za-z_]\w*)\s*:\s*(\d+)$/);
    if (bm) {
      fields.push({ name: bm[2], type: bm[1], bits: Number(bm[3]), enum: enumMap });
      continue;
    }
    const am = d.match(/^(\S+)\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/);
    if (am) {
      fields.push({ name: am[2], type: am[1], arrayLen: Number(am[3]), enum: enumMap });
      continue;
    }
    const sm = d.match(/^(\S+)\s+([A-Za-z_]\w*)$/);
    if (sm) {
      fields.push({ name: sm[2], type: sm[1], enum: enumMap });
      continue;
    }
    throw new Error(`Bad struct declaration in ${name}: "${d}"`);
  }
  return { name, fields };
}

export type LeafKind = 'number' | 'boolean' | 'string';

export interface StructLeaf {
  /** Path relative to the struct value, e.g. "translation/x". */
  path: string;
  kind: LeafKind;
  /** Native unit hint, when known from WPILib conventions. */
  unit?: string;
}

export class StructRegistry {
  private schemas = new Map<string, StructSchema>();
  private sizes = new Map<string, number>();

  add(name: string, schemaText: string): void {
    try {
      this.schemas.set(name, parseStructSchema(name, schemaText));
      this.sizes.delete(name);
    } catch {
      // Ignore unparsable schemas; the entry falls back to raw bytes.
    }
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  get(name: string): StructSchema | undefined {
    return this.schemas.get(name);
  }

  /** Byte size of a struct, or undefined if unknown / missing nested schema. */
  size(name: string): number | undefined {
    if (PRIM_SIZE[name] !== undefined) return PRIM_SIZE[name];
    const cached = this.sizes.get(name);
    if (cached !== undefined) return cached;
    const s = this.schemas.get(name);
    if (!s) return undefined;
    let total = 0;
    // bit-field packing state
    let unitSize = 0;
    let unitBitsUsed = 0;
    for (const f of s.fields) {
      if (f.bits !== undefined) {
        const width = f.type === 'bool' ? 1 : (PRIM_SIZE[f.type] ?? 0);
        if (!width) return undefined;
        if (f.type === 'bool' && unitSize > 0 && unitBitsUsed + 1 <= unitSize * 8) {
          unitBitsUsed += 1;
          continue;
        }
        if (unitSize !== width || unitBitsUsed + f.bits > unitSize * 8) {
          unitSize = width;
          unitBitsUsed = 0;
          total += width;
        }
        unitBitsUsed += f.bits;
        continue;
      }
      unitSize = 0;
      unitBitsUsed = 0;
      const sz = this.size(f.type);
      if (sz === undefined) return undefined;
      total += sz * (f.arrayLen ?? 1);
    }
    this.sizes.set(name, total);
    return total;
  }

  /** Decode one struct value at `offset`. Returns a plain object (nested for sub-structs). */
  decode(name: string, data: Uint8Array, offset = 0): Record<string, unknown> | undefined {
    const s = this.schemas.get(name);
    if (!s) return undefined;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out: Record<string, unknown> = {};
    let pos = offset;
    let unitSize = 0;
    let unitBitsUsed = 0;
    let unitValue = 0n;
    let unitStart = 0;
    for (const f of s.fields) {
      if (f.bits !== undefined) {
        const width = f.type === 'bool' ? 1 : (PRIM_SIZE[f.type] ?? 1);
        const fits = (nb: number) => unitSize > 0 && unitBitsUsed + nb <= unitSize * 8;
        const newUnit = f.type === 'bool' ? !fits(1) : unitSize !== width || !fits(f.bits);
        if (newUnit) {
          unitSize = width;
          unitBitsUsed = 0;
          unitStart = pos;
          unitValue = readUintBig(view, pos, width, data.byteLength);
          pos += width;
        }
        const nbits = f.type === 'bool' ? 1 : f.bits;
        const mask = (1n << BigInt(nbits)) - 1n;
        let raw = (unitValue >> BigInt(unitBitsUsed)) & mask;
        unitBitsUsed += nbits;
        if (f.type === 'bool') out[f.name] = raw !== 0n;
        else {
          if (f.type.startsWith('int') && nbits > 0 && (raw >> BigInt(nbits - 1)) & 1n) raw -= 1n << BigInt(nbits);
          const n = Number(raw);
          out[f.name] = f.enum ? (f.enum[n] ?? n) : n;
        }
        void unitStart;
        continue;
      }
      unitSize = 0;
      unitBitsUsed = 0;
      const count = f.arrayLen;
      if (f.type === 'char' && count !== undefined) {
        let end = pos;
        const stop = Math.min(pos + count, data.byteLength);
        while (end < stop && data[end] !== 0) end++;
        out[f.name] = new TextDecoder().decode(data.subarray(pos, end));
        pos += count;
        continue;
      }
      const readOne = (): unknown => {
        if (PRIM_SIZE[f.type] !== undefined) {
          const v = readPrim(f.type, view, pos, data.byteLength);
          pos += PRIM_SIZE[f.type];
          if (f.enum && typeof v === 'number') return f.enum[v] ?? v;
          return v;
        }
        const sz = this.size(f.type);
        const sub = this.decode(f.type, data, pos);
        pos += sz ?? 0;
        return sub;
      };
      if (count !== undefined) {
        const arr: unknown[] = [];
        for (let i = 0; i < count; i++) arr.push(readOne());
        out[f.name] = arr;
      } else out[f.name] = readOne();
    }
    return out;
  }

  /** Decode an array of structs (payload = concatenated elements). */
  decodeArray(name: string, data: Uint8Array): Record<string, unknown>[] {
    const sz = this.size(name);
    if (!sz) return [];
    const n = Math.floor(data.byteLength / sz);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      const v = this.decode(name, data, i * sz);
      if (v) out.push(v);
    }
    return out;
  }

  /** Flat list of leaf paths with kinds, for the field tree. */
  leaves(name: string, prefix = '', depth = 0): StructLeaf[] {
    const s = this.schemas.get(name);
    if (!s || depth > 8) return [];
    const out: StructLeaf[] = [];
    for (const f of s.fields) {
      const base = prefix ? `${prefix}/${f.name}` : f.name;
      const emit = (p: string) => {
        if (PRIM_SIZE[f.type] !== undefined || f.bits !== undefined) {
          const kind: LeafKind = f.type === 'bool' ? 'boolean' : f.enum ? 'string' : 'number';
          out.push({ path: p, kind, unit: unitHint(name, f.name) });
        } else out.push(...this.leaves(f.type, p, depth + 1));
      };
      if (f.type === 'char' && f.arrayLen !== undefined) out.push({ path: base, kind: 'string' });
      else if (f.arrayLen !== undefined) {
        for (let i = 0; i < f.arrayLen; i++) emit(`${base}/${i}`);
      } else emit(base);
    }
    return out;
  }
}

function unitHint(struct: string, field: string): string | undefined {
  if (struct === 'Rotation2d' && field === 'value') return 'rad';
  if (struct === 'Translation2d' || struct === 'Translation3d') return 'm';
  if ((struct === 'ChassisSpeeds' || struct === 'ChassisVelocities') && field === 'omega') return 'rad/s';
  if (struct === 'ChassisSpeeds' || struct === 'ChassisVelocities') return 'm/s';
  if ((struct === 'SwerveModuleState' || struct === 'SwerveModuleVelocity') && field !== 'angle') return 'm/s';
  return undefined;
}

function readUintBig(view: DataView, pos: number, width: number, len: number): bigint {
  if (pos + width > len) return 0n;
  switch (width) {
    case 1:
      return BigInt(view.getUint8(pos));
    case 2:
      return BigInt(view.getUint16(pos, true));
    case 4:
      return BigInt(view.getUint32(pos, true));
    case 8:
      return view.getBigUint64(pos, true);
    default:
      return 0n;
  }
}

function readPrim(type: string, view: DataView, pos: number, len: number): unknown {
  const sz = PRIM_SIZE[type];
  if (pos + sz > len) return type === 'bool' ? false : NaN;
  switch (type) {
    case 'bool':
      return view.getUint8(pos) !== 0;
    case 'char':
      return String.fromCharCode(view.getUint8(pos));
    case 'int8':
      return view.getInt8(pos);
    case 'uint8':
      return view.getUint8(pos);
    case 'int16':
      return view.getInt16(pos, true);
    case 'uint16':
      return view.getUint16(pos, true);
    case 'int32':
      return view.getInt32(pos, true);
    case 'uint32':
      return view.getUint32(pos, true);
    case 'int64':
      return Number(view.getBigInt64(pos, true));
    case 'uint64':
      return Number(view.getBigUint64(pos, true));
    case 'float':
    case 'float32':
      return view.getFloat32(pos, true);
    case 'double':
    case 'float64':
      return view.getFloat64(pos, true);
    default:
      return NaN;
  }
}

/** Read a leaf value out of a decoded struct object by "a/b/0/c" path. */
export function getLeaf(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('/')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

/** Well-known WPILib schemas, used when a log lacks /.schema entries (e.g. older writers). */
export const WELL_KNOWN_SCHEMAS: Record<string, string> = {
  Translation2d: 'double x;double y',
  Rotation2d: 'double value',
  Pose2d: 'Translation2d translation;Rotation2d rotation',
  Transform2d: 'Translation2d translation;Rotation2d rotation',
  Translation3d: 'double x;double y;double z',
  Quaternion: 'double w;double x;double y;double z',
  Rotation3d: 'Quaternion q',
  Pose3d: 'Translation3d translation;Rotation3d rotation',
  Transform3d: 'Translation3d translation;Rotation3d rotation',
  ChassisSpeeds: 'double vx;double vy;double omega',
  ChassisVelocities: 'double vx;double vy;double omega',
  SwerveModuleState: 'double speed;Rotation2d angle',
  SwerveModuleVelocity: 'double velocity;Rotation2d angle',
  SwerveModulePosition: 'double distance;Rotation2d angle',
  Twist2d: 'double dx;double dy;double dtheta',
  ControlWord:
    'uint64 opModeHash:56;enum{unknown=0,autonomous=1,teleoperated=2,utility=3} uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
};
