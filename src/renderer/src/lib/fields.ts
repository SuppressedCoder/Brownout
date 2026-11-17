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

/** The type a field shows on its badge: its struct name, else its kind ("Pose2d", "number", "boolean[]"). */
export function typeLabel(f: { kind: string; structName?: string }): string {
  return f.structName ?? f.kind;
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
  return labels.find((t) => t.toLowerCase().startsWith(w)) ?? null;
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
