/**
 * WPILOG v1.0 reader: one index pass over the file, then lazy decoding of
 * individual entries. Follows allwpilib/datalog/doc/datalog.adoc.
 *
 * - All multi-byte values are little endian.
 * - Timestamps are integer microseconds; no ordering guarantee.
 * - Control records use entry ID 0; the first payload byte is the type.
 * - Truncated tails are common (power loss): we stop cleanly.
 * - Entry IDs may be reused after a Finish; we merge by name + type.
 *
 * No DOM, Node or Electron imports: this runs in a Web Worker, in Node tests
 * and in a future CLI.
 */

export interface EntryInfo {
  /** Index into WpilogIndex.entries (stable id for this reader). */
  index: number;
  name: string;
  type: string;
  metadata: string;
  /** Number of data records. */
  count: number;
  /** Minimum and maximum timestamp (µs) across records, or NaN if none. */
  minTs: number;
  maxTs: number;
  /** Total payload bytes. */
  bytes: number;
}

export interface WpilogIndex {
  version: number;
  extraHeader: string;
  entries: EntryInfo[];
  /** Total number of data records. */
  recordCount: number;
  /** Byte length actually consumed (may be less than the buffer if truncated). */
  consumed: number;
  truncated: boolean;
  /** First and last timestamp over all data records (µs). */
  minTs: number;
  maxTs: number;
  /**
   * Data records whose timestamp was impossible (negative or absurdly large)
   * and were placed at the time of the record written just before them.
   */
  repairedTimestamps: number;
}

/**
 * Largest timestamp taken at face value (µs). Timestamps are signed 64-bit
 * microseconds; anything negative or past this is treated as damaged.
 */
const MAX_TS = 2 ** 53;

/** Record offsets per entry: offset into the file of each record's payload, its size and timestamp. */
interface EntryRecords {
  offsets: number[];
  sizes: number[];
  timestamps: number[];
}

export class WpilogReader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly index: WpilogIndex;
  private records: EntryRecords[] = [];
  private textDecoder = new TextDecoder('utf-8');

  /** @param onProgress called with 0..1 roughly every 4 MB during the index pass */
  constructor(buffer: ArrayBuffer | Uint8Array, onProgress?: (fraction: number) => void) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.index = this.buildIndex(onProgress);
  }

  static isWpilog(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    return bytes[0] === 0x57 && bytes[1] === 0x50 && bytes[2] === 0x49 && bytes[3] === 0x4c && bytes[4] === 0x4f && bytes[5] === 0x47;
  }

  private readUint(offset: number, len: number): number {
    const v = this.view;
    switch (len) {
      case 1:
        return v.getUint8(offset);
      case 2:
        return v.getUint16(offset, true);
      case 3:
        return v.getUint16(offset, true) | (v.getUint8(offset + 2) << 16);
      case 4:
        return v.getUint32(offset, true);
      default: {
        // 5..8 bytes: combine as a double (safe to 2^53, far beyond any real log)
        let lo = v.getUint32(offset, true);
        let hi = 0;
        for (let i = 4; i < len; i++) hi += v.getUint8(offset + i) * 2 ** (8 * (i - 4));
        return lo + hi * 2 ** 32;
      }
    }
  }

  /**
   * A record timestamp: a signed integer of 1 to 8 bytes, in microseconds.
   * Read signed, because NetworkTables logs values from a device that
   * connected before its clock was synchronized (a Limelight, a coprocessor)
   * with a slightly negative time, which as an unsigned number is about 2^64.
   */
  private readTs(offset: number, len: number): number {
    if (len < 8) return this.readUint(offset, len);
    return this.view.getInt32(offset + 4, true) * 2 ** 32 + this.view.getUint32(offset, true);
  }

  private str(offset: number, len: number): string {
    return this.textDecoder.decode(this.bytes.subarray(offset, offset + len));
  }

  private buildIndex(onProgress?: (fraction: number) => void): WpilogIndex {
    const b = this.bytes;
    const v = this.view;
    if (!WpilogReader.isWpilog(b)) throw new Error('Not a WPILOG file (bad magic)');
    const version = v.getUint16(6, true);
    if (version >> 8 !== 1) throw new Error(`Unsupported WPILOG version ${version >> 8}.${version & 0xff}`);
    const extraLen = v.getUint32(8, true);
    const extraHeader = this.str(12, Math.min(extraLen, b.length - 12));
    let pos = 12 + extraLen;

    const entries: EntryInfo[] = [];
    const records: EntryRecords[] = [];
    // live entry id -> entry index
    const live = new Map<number, number>();
    // name|type -> entry index, for merging re-started entries
    const byKey = new Map<string, number>();
    let recordCount = 0;
    let truncated = false;
    let minTs = Infinity;
    let maxTs = -Infinity;
    let lastGoodTs = 0;
    let repairedTimestamps = 0;
    const end = b.length;

    const PROGRESS_STEP = 4 * 1024 * 1024;
    let nextProgress = PROGRESS_STEP;

    while (pos < end) {
      if (pos + 1 > end) break;
      if (onProgress && pos >= nextProgress) {
        onProgress(pos / end);
        nextProgress = pos + PROGRESS_STEP;
      }
      const bits = b[pos];
      const idLen = (bits & 0x3) + 1;
      const sizeLen = ((bits >> 2) & 0x3) + 1;
      const tsLen = ((bits >> 4) & 0x7) + 1;
      const headerLen = 1 + idLen + sizeLen + tsLen;
      if (pos + headerLen > end) {
        truncated = true;
        break;
      }
      const entryId = this.readUint(pos + 1, idLen);
      const size = this.readUint(pos + 1 + idLen, sizeLen);
      let ts = this.readTs(pos + 1 + idLen + sizeLen, tsLen);
      // An impossible time: the file is written roughly in order, so the record just before it says when this one arrived
      const badTs = ts < 0 || ts > MAX_TS;
      if (badTs) ts = lastGoodTs;
      else lastGoodTs = ts;
      const payload = pos + headerLen;
      if (payload + size > end) {
        truncated = true;
        break;
      }

      if (entryId === 0) {
        // control record
        if (size >= 1) {
          const type = b[payload];
          if (type === 0 && size >= 17) {
            // Start
            let p = payload + 1;
            const id = v.getUint32(p, true);
            p += 4;
            const nameLen = v.getUint32(p, true);
            p += 4;
            const name = this.str(p, Math.min(nameLen, payload + size - p));
            p += nameLen;
            let typeStr = '';
            let meta = '';
            if (p + 4 <= payload + size) {
              const typeLen = v.getUint32(p, true);
              p += 4;
              typeStr = this.str(p, Math.min(typeLen, payload + size - p));
              p += typeLen;
            }
            if (p + 4 <= payload + size) {
              const metaLen = v.getUint32(p, true);
              p += 4;
              meta = this.str(p, Math.min(metaLen, payload + size - p));
            }
            const key = name + '\u0000' + typeStr;
            let idx = byKey.get(key);
            if (idx === undefined) {
              idx = entries.length;
              entries.push({ index: idx, name, type: typeStr, metadata: meta, count: 0, minTs: NaN, maxTs: NaN, bytes: 0 });
              records.push({ offsets: [], sizes: [], timestamps: [] });
              byKey.set(key, idx);
            } else if (meta && !entries[idx].metadata) {
              entries[idx].metadata = meta;
            }
            live.set(id, idx);
          } else if (type === 1 && size >= 5) {
            // Finish
            const id = v.getUint32(payload + 1, true);
            live.delete(id);
          } else if (type === 2 && size >= 9) {
            // Set metadata
            const id = v.getUint32(payload + 1, true);
            const len = v.getUint32(payload + 5, true);
            const idx = live.get(id);
            if (idx !== undefined) entries[idx].metadata = this.str(payload + 9, Math.min(len, size - 9));
          }
        }
      } else {
        const idx = live.get(entryId);
        if (idx !== undefined) {
          const r = records[idx];
          r.offsets.push(payload);
          r.sizes.push(size);
          r.timestamps.push(ts);
          const e = entries[idx];
          e.count++;
          e.bytes += size;
          if (!(ts >= e.minTs)) e.minTs = ts;
          if (!(ts <= e.maxTs)) e.maxTs = ts;
          if (ts < minTs) minTs = ts;
          if (ts > maxTs) maxTs = ts;
          if (badTs) repairedTimestamps++;
          recordCount++;
        }
      }
      pos = payload + size;
    }

    this.records = records;
    return {
      version,
      extraHeader,
      entries,
      recordCount,
      consumed: pos,
      truncated,
      minTs: recordCount ? minTs : 0,
      maxTs: recordCount ? maxTs : 0,
      repairedTimestamps,
    };
  }

  getEntry(name: string, type?: string): EntryInfo | undefined {
    return this.index.entries.find((e) => e.name === name && (type === undefined || e.type === type));
  }

  /** Sorted record list (by timestamp) of an entry: returns timestamps (µs) and payload byte ranges. */
  recordsOf(entryIndex: number): { timestamps: Float64Array; offsets: Int32Array; sizes: Int32Array } {
    const r = this.records[entryIndex];
    const n = r.timestamps.length;
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    // Only sort when needed (most logs are in order).
    let sorted = true;
    for (let i = 1; i < n; i++) {
      if (r.timestamps[i] < r.timestamps[i - 1]) {
        sorted = false;
        break;
      }
    }
    if (!sorted) order.sort((a, b) => r.timestamps[a] - r.timestamps[b]);
    const timestamps = new Float64Array(n);
    const offsets = new Int32Array(n);
    const sizes = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const j = order[i];
      timestamps[i] = r.timestamps[j];
      offsets[i] = r.offsets[j];
      sizes[i] = r.sizes[j];
    }
    return { timestamps, offsets, sizes };
  }

  payload(offset: number, size: number): Uint8Array {
    return this.bytes.subarray(offset, offset + size);
  }
}

/** Decode a primitive payload according to its WPILOG type string. */
export function decodePrimitive(type: string, data: Uint8Array): unknown {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (type) {
    case 'boolean':
      return data.length ? data[0] !== 0 : false;
    case 'int64':
      return data.length >= 8 ? Number(v.getBigInt64(0, true)) : NaN;
    case 'float':
      return data.length >= 4 ? v.getFloat32(0, true) : NaN;
    case 'double':
      return data.length >= 8 ? v.getFloat64(0, true) : NaN;
    case 'string':
    case 'json':
      return new TextDecoder().decode(data);
    case 'boolean[]': {
      const out = new Array<boolean>(data.length);
      for (let i = 0; i < data.length; i++) out[i] = data[i] !== 0;
      return out;
    }
    case 'int64[]': {
      const n = Math.floor(data.length / 8);
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) out[i] = Number(v.getBigInt64(i * 8, true));
      return out;
    }
    case 'float[]': {
      const n = Math.floor(data.length / 4);
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) out[i] = v.getFloat32(i * 4, true);
      return out;
    }
    case 'double[]': {
      const n = Math.floor(data.length / 8);
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) out[i] = v.getFloat64(i * 8, true);
      return out;
    }
    case 'string[]': {
      if (data.length < 4) return [];
      const count = v.getUint32(0, true);
      const out: string[] = [];
      let p = 4;
      const td = new TextDecoder();
      for (let i = 0; i < count && p + 4 <= data.length; i++) {
        const len = v.getUint32(p, true);
        p += 4;
        out.push(td.decode(data.subarray(p, Math.min(p + len, data.length))));
        p += len;
      }
      return out;
    }
    default:
      return data;
  }
}
