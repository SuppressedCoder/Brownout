/** Field index merged across logs, for the tree and for panels. */
import type { FieldInfo, FieldKind } from '@core/log';
import { sessionStore, type LogEntry } from '../state/session';
import { useStore } from '../state/store';

export interface MergedField {
  key: string;
  kind: FieldKind;
  type: string;
  unit?: string;
  structName?: string;
  generated: boolean;
  logIds: string[];
  count: number;
}

let cacheLogs: LogEntry[] | null = null;
let cacheIndex: Map<string, MergedField> = new Map();

export function fieldIndex(logs = sessionStore.get().logs): Map<string, MergedField> {
  if (logs === cacheLogs) return cacheIndex;
  const idx = new Map<string, MergedField>();
  for (const l of logs) {
    for (const f of l.fields) {
      if (f.hidden) continue;
      const m = idx.get(f.key);
      if (m) {
        m.logIds.push(l.id);
        m.count += f.count;
        if (!m.unit && f.unit) m.unit = f.unit;
      } else
        idx.set(f.key, {
          key: f.key,
          kind: f.kind,
          type: f.type,
          unit: f.unit,
          structName: f.structName,
          generated: f.generated,
          logIds: [l.id],
          count: f.count,
        });
    }
  }
  cacheLogs = logs;
  cacheIndex = idx;
  return idx;
}

export function useFieldIndex(): Map<string, MergedField> {
  const logs = useStore(sessionStore, (s) => s.logs);
  return fieldIndex(logs);
}

export function fieldOf(key: string): MergedField | undefined {
  return fieldIndex().get(key);
}

export function fieldInLog(log: LogEntry, key: string): FieldInfo | undefined {
  return log.fields.find((f) => f.key === key);
}

/** Short display name: last path component (with parent for context). */
export function shortKey(key: string, parts = 2): string {
  const p = key.split('/').filter(Boolean);
  return p.slice(-parts).join('/');
}

/** The type a field shows on its badge: its struct name, else its kind ("Pose2d", "Pose3d[]", "number", "boolean[]"). */
export function typeLabel(f: { kind: string; structName?: string }): string {
  if (f.structName) return f.kind === 'struct[]' ? `${f.structName}[]` : f.structName;
  return f.kind;
}

/** The type labels in these fields, most common first. */
export function typeLabels(fields: Iterable<{ kind: string; structName?: string }>): string[] {
  const n = new Map<string, number>();
  for (const f of fields) {
    const t = typeLabel(f);
    n.set(t, (n.get(t) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** The type a typed word could finish as (the most common one starting with it), or null. */
export function completeType(word: string, labels: string[]): string | null {
  if (!word) return null;
  const w = word.toLowerCase();
  const fits = labels.filter((t) => t.toLowerCase().startsWith(w));
  // a type before its array ("Pose2d", then "Pose2d[]" once "[" is typed)
  return fits.find((t) => !(t.endsWith('[]') && fits.includes(t.slice(0, -2)))) ?? null;
}

/** Whether a field passes the type filters: any of them (none = every type). */
export function typeMatches(f: { kind: string; structName?: string }, types: string[]): boolean {
  if (!types.length) return true;
  const t = typeLabel(f).toLowerCase();
  return types.some((x) => x.toLowerCase() === t);
}

export function keyMatchesSearch(key: string, q: string): boolean {
  if (!q) return true;
  const k = key.toLowerCase();
  // every whitespace-separated token must appear (in order of tokens, anywhere)
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => k.includes(tok));
}

/** A field as a box or a drag knows it. */
export interface FieldLike {
  key: string;
  kind: string;
  structName?: string;
}

/**
 * What a field box takes: the types it lists on its label line ("Pose2d",
 * "number[]"), and optionally fields of other types it takes by name (a
 * Limelight botpose array), described by `also`.
 */
export interface FieldSpec {
  types: string[];
  also?: { label: string; test: (f: FieldLike) => boolean };
  /** A further rule every field must pass, and what to say when one doesn't. */
  only?: { test: (f: FieldLike) => boolean; reason: string };
  /** What the label line says instead of listing the types ("any camera field"). */
  label?: string;
}

export function specAccepts(spec: FieldSpec | undefined, f: FieldLike): boolean {
  if (!spec) return true;
  if (spec.only && !spec.only.test(f)) return false;
  return spec.types.includes(typeLabel(f)) || !!spec.also?.test(f);
}

/** The label line's types: "Pose2d · Pose3d · botpose". */
export function specLabel(spec: FieldSpec | undefined): string {
  if (!spec) return '';
  if (spec.label) return spec.label;
  return [...spec.types, ...(spec.also ? [spec.also.label] : [])].join(' · ');
}

/** Why a box can't take a field: "Takes number[]; Drive/Pose is Pose2d". */
export function specReason(spec: FieldSpec, f: FieldLike): string {
  if (spec.only && !spec.only.test(f) && (spec.types.includes(typeLabel(f)) || spec.also?.test(f))) return spec.only.reason;
  return `Takes ${specLabel(spec).replace(/ · /g, ', ')}; ${shortKey(f.key, 3)} is ${typeLabel(f)}`;
}

/** Search results in groups by the folder they are in (the key up to its last '/'), in the order they came. */
export function groupByFolder<F extends { key: string }>(list: F[]): { folder: string; fields: F[] }[] {
  const out = new Map<string, F[]>();
  for (const f of list) {
    const folder = f.key.slice(0, f.key.lastIndexOf('/') + 1);
    const g = out.get(folder);
    if (g) g.push(f);
    else out.set(folder, [f]);
  }
  // numbers in names in their natural order: 0, 1, 2 ... 10, not 0, 1, 10, 11
  const natural = (a: F, b: F) => a.key.localeCompare(b.key, undefined, { numeric: true });
  return [...out.entries()].map(([folder, fields]) => ({ folder, fields: fields.sort(natural) }));
}

/** A key split for showing: the folder (dimmed) and the name. */
export function splitKey(key: string): { folder: string; leaf: string } {
  const i = key.lastIndexOf('/', key.length - 2);
  return { folder: key.slice(0, i + 1), leaf: key.slice(i + 1) };
}

/**
 * The field typed text could finish as, for Tab: a key that starts with it
 * (ignoring a leading "/"), else one where a folder or name starts with it.
 * Fields the box takes come first. Returns the field and the rest to show
 * faintly after the typed text.
 */
export function completeKey<F extends FieldLike>(typed: string, fields: Iterable<F>, prefer?: (f: F) => boolean): { field: F; rest: string } | null {
  if (!typed) return null;
  const t = typed.toLowerCase();
  let best: { field: F; rest: string; score: number } | null = null;
  for (const f of fields) {
    const k = f.key.toLowerCase();
    let at = -1;
    let score = 0;
    if (k.startsWith(t)) at = 0;
    else if (k.startsWith('/') && k.slice(1).startsWith(t)) at = 1;
    else {
      const i = k.indexOf(`/${t}`);
      if (i >= 0) {
        at = i + 1;
        score = 2;
      }
    }
    if (at < 0) continue;
    if (prefer && !prefer(f)) score += 4;
    // shorter keys first: the closest finish
    score = score * 10000 + f.key.length;
    if (!best || score < best.score) best = { field: f, rest: f.key.slice(at + typed.length), score };
  }
  return best ? { field: best.field, rest: best.rest } : null;
}
