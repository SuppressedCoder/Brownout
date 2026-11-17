/**
 * Minimal WPILOG v1.0 writer. Used by the demo-log generator and by tests;
 * also usable for exporting filtered logs.
 */

export class WpilogWriter {
  private chunks: Uint8Array[] = [];
  private nextId = 1;
  private enc = new TextEncoder();
  private started = new Map<string, number>();

  constructor(extraHeader = '') {
    const extra = this.enc.encode(extraHeader);
    const head = new Uint8Array(12 + extra.length);
    head.set([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47]); // WPILOG
    const v = new DataView(head.buffer);
    v.setUint16(6, 0x0100, true);
    v.setUint32(8, extra.length, true);
    head.set(extra, 12);
    this.chunks.push(head);
  }

  /** Start an entry and return its id. Re-starting the same name+type returns the existing id. */
  start(name: string, type: string, metadata = '', timestampUs = 0): number {
    const key = name + '\u0000' + type;
    const existing = this.started.get(key);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    const n = this.enc.encode(name);
    const t = this.enc.encode(type);
    const m = this.enc.encode(metadata);
    const payload = new Uint8Array(1 + 4 + 4 + n.length + 4 + t.length + 4 + m.length);
    const v = new DataView(payload.buffer);
    let p = 0;
    payload[p++] = 0; // Start
    v.setUint32(p, id, true);
    p += 4;
    v.setUint32(p, n.length, true);
    p += 4;
    payload.set(n, p);
    p += n.length;
    v.setUint32(p, t.length, true);
    p += 4;
    payload.set(t, p);
    p += t.length;
    v.setUint32(p, m.length, true);
    p += 4;
    payload.set(m, p);
    this.record(0, timestampUs, payload);
    this.started.set(key, id);
    return id;
  }

  finish(id: number, timestampUs = 0): void {
    const payload = new Uint8Array(5);
    payload[0] = 1;
    new DataView(payload.buffer).setUint32(1, id, true);
    this.record(0, timestampUs, payload);
    for (const [k, v] of this.started) if (v === id) this.started.delete(k);
  }

  setMetadata(id: number, metadata: string, timestampUs = 0): void {
    const m = this.enc.encode(metadata);
    const payload = new Uint8Array(9 + m.length);
    payload[0] = 2;
    const v = new DataView(payload.buffer);
    v.setUint32(1, id, true);
    v.setUint32(5, m.length, true);
    payload.set(m, 9);
    this.record(0, timestampUs, payload);
  }

  record(id: number, timestampUs: number, payload: Uint8Array): void {
    const idLen = byteLen(id);
    const sizeLen = byteLen(payload.length);
    const tsLen = Math.max(1, byteLen(timestampUs));
    const header = new Uint8Array(1 + idLen + sizeLen + tsLen);
    header[0] = (idLen - 1) | ((sizeLen - 1) << 2) | ((tsLen - 1) << 4);
    writeUint(header, 1, id, idLen);
    writeUint(header, 1 + idLen, payload.length, sizeLen);
    writeUint(header, 1 + idLen + sizeLen, timestampUs, tsLen);
    this.chunks.push(header, payload);
  }

  // Typed helpers
  boolean(id: number, ts: number, value: boolean): void {
    this.record(id, ts, new Uint8Array([value ? 1 : 0]));
  }
  int64(id: number, ts: number, value: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(Math.trunc(value)), true);
    this.record(id, ts, b);
  }
  double(id: number, ts: number, value: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, value, true);
    this.record(id, ts, b);
  }
  float(id: number, ts: number, value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, true);
    this.record(id, ts, b);
  }
  string(id: number, ts: number, value: string): void {
    this.record(id, ts, this.enc.encode(value));
  }
  doubleArray(id: number, ts: number, values: number[]): void {
    const b = new Uint8Array(values.length * 8);
    const v = new DataView(b.buffer);
    values.forEach((x, i) => v.setFloat64(i * 8, x, true));
    this.record(id, ts, b);
  }
  int64Array(id: number, ts: number, values: number[]): void {
    const b = new Uint8Array(values.length * 8);
    const v = new DataView(b.buffer);
    values.forEach((x, i) => v.setBigInt64(i * 8, BigInt(Math.trunc(x)), true));
    this.record(id, ts, b);
  }
  booleanArray(id: number, ts: number, values: boolean[]): void {
    this.record(id, ts, new Uint8Array(values.map((b) => (b ? 1 : 0))));
  }
  stringArray(id: number, ts: number, values: string[]): void {
    const encoded = values.map((s) => this.enc.encode(s));
    const total = 4 + encoded.reduce((a, e) => a + 4 + e.length, 0);
    const b = new Uint8Array(total);
    const v = new DataView(b.buffer);
    v.setUint32(0, values.length, true);
    let p = 4;
    for (const e of encoded) {
      v.setUint32(p, e.length, true);
      p += 4;
      b.set(e, p);
      p += e.length;
    }
    this.record(id, ts, b);
  }

  toBytes(): Uint8Array {
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

function byteLen(n: number): number {
  if (n < 0x100) return 1;
  if (n < 0x10000) return 2;
  if (n < 0x1000000) return 3;
  if (n < 0x100000000) return 4;
  if (n < 2 ** 40) return 5;
  if (n < 2 ** 48) return 6;
  if (n < 2 ** 56) return 7;
  return 8;
}

function writeUint(buf: Uint8Array, offset: number, value: number, len: number): void {
  let v = value;
  for (let i = 0; i < len; i++) {
    buf[offset + i] = v % 256;
    v = Math.floor(v / 256);
  }
}
