/**
 * LogData: a loaded WPILOG with a field list (including generated struct and
 * array children) and lazy, cached decoding into column storage.
 */
import { WpilogReader, decodePrimitive, type EntryInfo } from './wpilog/reader';
import { StructRegistry, WELL_KNOWN_SCHEMAS, getLeaf } from './struct/structDecoder';
import { detectUnit } from './units';

export type FieldKind = 'number' | 'boolean' | 'string' | 'number[]' | 'boolean[]' | 'string[]' | 'struct' | 'struct[]' | 'json' | 'raw';

export interface FieldInfo {
  /** Full key, e.g. "/RealOutputs/Odometry/Robot/translation/x". */
  key: string;
  /** WPILOG type string (for generated children: the parent's). */
  type: string;
  kind: FieldKind;
  structName?: string;
  count: number;
  metadata: string;
  unit?: string;
  /** Generated from a struct or array parent. */
  generated: boolean;
  hidden: boolean;
  firstTs: number;
  lastTs: number;
}

export interface NumberSeries {
  kind: 'number';
  t: Float64Array;
  v: Float64Array;
}
export interface BooleanSeries {
  kind: 'boolean';
  t: Float64Array;
  v: Uint8Array;
}
export interface StringSeries {
  kind: 'string';
  t: Float64Array;
  v: string[];
}
export interface ArraySeries {
  kind: 'array';
  t: Float64Array;
  v: (number[] | boolean[] | string[])[];
}
export interface StructSeries {
  kind: 'struct';
  t: Float64Array;
  /** One object per sample (or an array of objects for struct[]). */
  v: unknown[];
}
export interface RawSeries {
  kind: 'raw';
  t: Float64Array;
  v: Uint8Array[];
}
export type Series = NumberSeries | BooleanSeries | StringSeries | ArraySeries | StructSeries | RawSeries;

interface Generated {
  parentKey: string;
  leafPath?: string; // struct leaf path
  arrayIndex?: number; // array element
}

export class LogData {
  readonly reader: WpilogReader;
  readonly structs = new StructRegistry();
  readonly fields: FieldInfo[] = [];
  private byKey = new Map<string, FieldInfo>();
  private entryOf = new Map<string, EntryInfo>();
  private generated = new Map<string, Generated>();
  private cache = new Map<string, Series>();

  constructor(buffer: ArrayBuffer | Uint8Array, onProgress?: (fraction: number) => void) {
    this.reader = new WpilogReader(buffer, onProgress);
    for (const [n, s] of Object.entries(WELL_KNOWN_SCHEMAS)) this.structs.add(n, s);
    this.loadSchemas();
    this.buildFields();
  }

  get startTs(): number {
    return this.reader.index.minTs / 1e6;
  }
  get endTs(): number {
    return this.reader.index.maxTs / 1e6;
  }

  private loadSchemas(): void {
    for (const e of this.reader.index.entries) {
      if (e.type !== 'structschema') continue;
      const m = e.name.match(/\/\.schema\/struct:(.+)$/);
      if (!m) continue;
      const recs = this.reader.recordsOf(e.index);
      if (recs.offsets.length === 0) continue;
      const data = this.reader.payload(recs.offsets[0], recs.sizes[0]);
      this.structs.add(m[1], new TextDecoder().decode(data));
    }
  }

  private buildFields(): void {
    for (const e of this.reader.index.entries) {
      const hidden = isHiddenName(e.name);
      const info: FieldInfo = {
        key: e.name,
        type: e.type,
        kind: kindOf(e.type),
        count: e.count,
        metadata: e.metadata,
        generated: false,
        hidden,
        firstTs: e.minTs / 1e6,
        lastTs: e.maxTs / 1e6,
      };
      if (e.type.startsWith('struct:')) info.structName = e.type.slice(7).replace(/\[\]$/, '');
      info.unit = detectUnit(e.name, e.metadata, undefined);
      // Avoid key collisions between different types with the same name
      if (this.byKey.has(e.name)) info.key = `${e.name} (${e.type})`;
      this.add(info, e);
      if (!hidden) this.generateChildren(info, e);
    }
    this.fields.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  private add(info: FieldInfo, e?: EntryInfo): void {
    this.fields.push(info);
    this.byKey.set(info.key, info);
    if (e) this.entryOf.set(info.key, e);
  }

  private generateChildren(parent: FieldInfo, e: EntryInfo): void {
    if (parent.count === 0) return;
    if (parent.kind === 'struct' && parent.structName && this.structs.has(parent.structName)) {
      for (const leaf of this.structs.leaves(parent.structName)) {
        const key = `${parent.key}/${leaf.path}`;
        this.add({
          key,
          type: parent.type,
          kind: leaf.kind,
          count: parent.count,
          metadata: '',
          unit: leaf.unit ?? detectUnit(key, '', undefined),
          generated: true,
          hidden: false,
          firstTs: parent.firstTs,
          lastTs: parent.lastTs,
        });
        this.generated.set(key, { parentKey: parent.key, leafPath: leaf.path });
      }
    } else if (parent.kind === 'number[]' || parent.kind === 'boolean[]' || parent.kind === 'string[]') {
      // Use the first record to learn the array length (like AdvantageScope).
      const recs = this.reader.recordsOf(e.index);
      let maxLen = 0;
      const probe = Math.min(recs.offsets.length, 3);
      for (let i = 0; i < probe; i++) {
        const v = decodePrimitive(e.type, this.reader.payload(recs.offsets[i], recs.sizes[i])) as unknown[];
        maxLen = Math.max(maxLen, v.length);
      }
      const kind = parent.kind.replace('[]', '') as 'number' | 'boolean' | 'string';
      for (let i = 0; i < Math.min(maxLen, 64); i++) {
        const key = `${parent.key}/${i}`;
        this.add({
          key,
          type: parent.type,
          kind,
          count: parent.count,
          metadata: '',
          unit: parent.unit,
          generated: true,
          hidden: false,
          firstTs: parent.firstTs,
          lastTs: parent.lastTs,
        });
        this.generated.set(key, { parentKey: parent.key, arrayIndex: i });
      }
      const lenKey = `${parent.key}/length`;
      this.add({
        key: lenKey,
        type: parent.type,
        kind: 'number',
        count: parent.count,
        metadata: '',
        generated: true,
        hidden: false,
        firstTs: parent.firstTs,
        lastTs: parent.lastTs,
      });
      this.generated.set(lenKey, { parentKey: parent.key, arrayIndex: -1 });
    } else if (parent.kind === 'struct[]' && parent.structName) {
      const lenKey = `${parent.key}/length`;
      this.add({
        key: lenKey,
        type: parent.type,
        kind: 'number',
        count: parent.count,
        metadata: '',
        generated: true,
        hidden: false,
        firstTs: parent.firstTs,
        lastTs: parent.lastTs,
      });
      this.generated.set(lenKey, { parentKey: parent.key, arrayIndex: -1 });
    }
  }

  field(key: string): FieldInfo | undefined {
    return this.byKey.get(key);
  }

  /** Decode (and cache) a field as a column series. Timestamps in seconds (raw log time). */
  series(key: string): Series | undefined {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const info = this.byKey.get(key);
    if (!info) return undefined;
    const gen = this.generated.get(key);
    let out: Series | undefined;
    if (gen) out = this.deriveGenerated(info, gen);
    else out = this.decodeEntry(info);
    if (out) this.cache.set(key, out);
    return out;
  }

  private decodeEntry(info: FieldInfo): Series | undefined {
    const e = this.entryOf.get(info.key);
    if (!e) return undefined;
    const recs = this.reader.recordsOf(e.index);
    const n = recs.offsets.length;
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = recs.timestamps[i] / 1e6;
    const payload = (i: number) => this.reader.payload(recs.offsets[i], recs.sizes[i]);
    switch (info.kind) {
      case 'number': {
        const v = new Float64Array(n);
        for (let i = 0; i < n; i++) v[i] = decodePrimitive(e.type, payload(i)) as number;
        return { kind: 'number', t, v };
      }
      case 'boolean': {
        const v = new Uint8Array(n);
        for (let i = 0; i < n; i++) v[i] = (decodePrimitive(e.type, payload(i)) as boolean) ? 1 : 0;
        return { kind: 'boolean', t, v };
      }
      case 'string':
      case 'json': {
        const v = new Array<string>(n);
        for (let i = 0; i < n; i++) v[i] = decodePrimitive('string', payload(i)) as string;
        return { kind: 'string', t, v };
      }
      case 'number[]':
      case 'boolean[]':
      case 'string[]': {
        const v = new Array<number[] | boolean[] | string[]>(n);
        for (let i = 0; i < n; i++) v[i] = decodePrimitive(e.type, payload(i)) as number[];
        return { kind: 'array', t, v };
      }
      case 'struct': {
        const name = info.structName!;
        if (!this.structs.has(name)) return { kind: 'raw', t, v: Array.from({ length: n }, (_, i) => payload(i)) };
        const v = new Array<unknown>(n);
        for (let i = 0; i < n; i++) v[i] = this.structs.decode(name, payload(i));
        return { kind: 'struct', t, v };
      }
      case 'struct[]': {
        const name = info.structName!;
        if (!this.structs.has(name)) return { kind: 'raw', t, v: Array.from({ length: n }, (_, i) => payload(i)) };
        const v = new Array<unknown>(n);
        for (let i = 0; i < n; i++) v[i] = this.structs.decodeArray(name, payload(i));
        return { kind: 'struct', t, v };
      }
      default:
        return { kind: 'raw', t, v: Array.from({ length: n }, (_, i) => payload(i)) };
    }
  }

  private deriveGenerated(info: FieldInfo, gen: Generated): Series | undefined {
    const parent = this.series(gen.parentKey);
    if (!parent) return undefined;
    const n = parent.t.length;
    if (gen.leafPath !== undefined && parent.kind === 'struct') {
      if (info.kind === 'number') {
        const v = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const x = getLeaf(parent.v[i], gen.leafPath);
          v[i] = typeof x === 'number' ? x : NaN;
        }
        return { kind: 'number', t: parent.t, v };
      }
      if (info.kind === 'boolean') {
        const v = new Uint8Array(n);
        for (let i = 0; i < n; i++) v[i] = getLeaf(parent.v[i], gen.leafPath) ? 1 : 0;
        return { kind: 'boolean', t: parent.t, v };
      }
      const v = new Array<string>(n);
      for (let i = 0; i < n; i++) v[i] = String(getLeaf(parent.v[i], gen.leafPath) ?? '');
      return { kind: 'string', t: parent.t, v };
    }
    if (gen.arrayIndex !== undefined && (parent.kind === 'array' || parent.kind === 'struct')) {
      if (gen.arrayIndex === -1) {
        const v = new Float64Array(n);
        for (let i = 0; i < n; i++) v[i] = (parent.v[i] as unknown[]).length;
        return { kind: 'number', t: parent.t, v };
      }
      const idx = gen.arrayIndex;
      if (info.kind === 'number') {
        const v = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const x = (parent.v[i] as unknown[])[idx];
          v[i] = typeof x === 'number' ? x : NaN;
        }
        return { kind: 'number', t: parent.t, v };
      }
      if (info.kind === 'boolean') {
        const v = new Uint8Array(n);
        for (let i = 0; i < n; i++) v[i] = (parent.v[i] as unknown[])[idx] ? 1 : 0;
        return { kind: 'boolean', t: parent.t, v };
      }
      const v = new Array<string>(n);
      for (let i = 0; i < n; i++) v[i] = String((parent.v[i] as unknown[])[idx] ?? '');
      return { kind: 'string', t: parent.t, v };
    }
    return undefined;
  }

  /** Value of a field at time t (sample-and-hold), or undefined before the first sample. */
  valueAt(key: string, t: number): unknown {
    const s = this.series(key);
    if (!s) return undefined;
    const i = indexAtOrBefore(s.t, t);
    if (i < 0) return undefined;
    return s.v[i];
  }
}

export function kindOf(type: string): FieldKind {
  switch (type) {
    case 'boolean':
      return 'boolean';
    case 'int64':
    case 'float':
    case 'double':
      return 'number';
    case 'string':
      return 'string';
    case 'json':
      return 'json';
    case 'boolean[]':
      return 'boolean[]';
    case 'int64[]':
    case 'float[]':
    case 'double[]':
      return 'number[]';
    case 'string[]':
      return 'string[]';
  }
  if (type.startsWith('struct:')) return type.endsWith('[]') ? 'struct[]' : 'struct';
  return 'raw';
}

export function isHiddenName(name: string): boolean {
  return (
    name.includes('/.schema/') ||
    name.startsWith('/.schema') ||
    name.startsWith('$') ||
    name.includes('/$') ||
    name.startsWith('NT:/$') ||
    name.startsWith('NT:$')
  );
}

/** Index of the last sample with t[i] <= t, or -1. Binary search. */
export function indexAtOrBefore(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (hi < 0 || x < t[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
