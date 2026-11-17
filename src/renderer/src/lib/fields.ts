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
