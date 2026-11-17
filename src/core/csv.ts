/**
 * CSV export in AdvantageScope's "table" convention: Timestamp, then one
 * column per key. Rows are emitted at every change of any column within the
 * range; values are sample-and-hold.
 */
export interface CsvColumn {
  name: string;
  t: Float64Array; // aligned seconds
  v: ArrayLike<unknown>;
}

export function toCsv(columns: CsvColumn[], t0: number, t1: number): string {
  const times = new Set<number>();
  for (const c of columns) for (let i = 0; i < c.t.length; i++) if (c.t[i] >= t0 && c.t[i] <= t1) times.add(c.t[i]);
  const sorted = [...times].sort((a, b) => a - b);
  const idx = columns.map(() => -1);
  const lines: string[] = ['Timestamp,' + columns.map((c) => quote(c.name)).join(',')];
  // seed hold-over values
  columns.forEach((c, k) => {
    let i = -1;
    while (i + 1 < c.t.length && c.t[i + 1] < t0) i++;
    idx[k] = i;
  });
  for (const t of sorted) {
    const cells = columns.map((c, k) => {
      while (idx[k] + 1 < c.t.length && c.t[idx[k] + 1] <= t) idx[k]++;
      return idx[k] < 0 ? '' : fmt(c.v[idx[k]]);
    });
    lines.push(`${t.toFixed(6)},${cells.join(',')}`);
  }
  return lines.join('\n') + '\n';
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) return quote(`[${v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('; ')}]`);
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('-');
  if (typeof v === 'object') return quote(JSON.stringify(v));
  return String(v);
}

function quote(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
