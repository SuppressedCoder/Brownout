/**
 * Which commands ran when. Sources:
 * - the command scheduler's list of running commands (a string[] field,
 *   normally NT:/SmartDashboard/Scheduler/Names), or
 * - one boolean field per command (true while it runs), as AdvantageKit
 *   projects log under /RealOutputs/CommandsAll/<name>.
 */
import type { FieldInfo, LogData } from './log';

export interface CommandRun {
  start: number;
  end: number;
  /** True when the log ended while it was still running. */
  open?: boolean;
}

export interface CommandRow {
  name: string;
  runs: CommandRun[];
  total: number;
}

function finish(rows: Map<string, CommandRun[]>): CommandRow[] {
  return [...rows.entries()]
    .map(([name, runs]) => ({ name, runs, total: runs.reduce((a, r) => a + (r.end - r.start), 0) }))
    .sort((a, b) => a.runs[0].start - b.runs[0].start || a.name.localeCompare(b.name));
}

/** Runs from a series of "names running now" lists. A name listed twice at once counts once. */
export function commandsFromNames(t: ArrayLike<number>, lists: ArrayLike<unknown>, endT: number): CommandRow[] {
  const rows = new Map<string, CommandRun[]>();
  const active = new Map<string, number>();
  const stop = (name: string, at: number, open = false) => {
    const start = active.get(name)!;
    active.delete(name);
    const list = rows.get(name) ?? [];
    list.push(open ? { start, end: at, open: true } : { start, end: at });
    rows.set(name, list);
  };
  for (let i = 0; i < t.length; i++) {
    const raw = lists[i];
    const now = new Set<string>(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x !== '') : []);
    for (const name of [...active.keys()]) if (!now.has(name)) stop(name, t[i]);
    for (const name of now) if (!active.has(name)) active.set(name, t[i]);
  }
  for (const name of [...active.keys()]) stop(name, Math.max(endT, active.get(name)!), true);
  return finish(rows);
}

/** Runs from one boolean series per command. */
export function commandsFromBooleans(sources: { name: string; t: ArrayLike<number>; v: ArrayLike<unknown> }[], endT: number): CommandRow[] {
  const rows = new Map<string, CommandRun[]>();
  for (const s of sources) {
    const runs: CommandRun[] = [];
    let start: number | null = null;
    for (let i = 0; i < s.t.length; i++) {
      const on = !!s.v[i];
      if (on && start === null) start = s.t[i];
      else if (!on && start !== null) {
        runs.push({ start, end: s.t[i] });
        start = null;
      }
    }
    if (start !== null) runs.push({ start, end: Math.max(endT, start), open: true });
    if (runs.length) rows.set(s.name, runs);
  }
  return finish(rows);
}

export type CommandSource = { kind: 'names'; key: string } | { kind: 'booleans'; prefix: string; keys: string[] };

/** Where this log keeps its commands, best source first. */
export function detectCommandSources(fields: FieldInfo[]): CommandSource[] {
  const out: CommandSource[] = [];
  const real = fields.filter((f) => !f.generated && !f.hidden);
  for (const f of real) if (f.kind === 'string[]' && /(^|\/)Scheduler\/Names$/.test(f.key)) out.push({ kind: 'names', key: f.key });
  for (const f of real)
    if (
      f.kind === 'string[]' &&
      !out.some((o) => o.kind === 'names' && o.key === f.key) &&
      /(running|active|scheduled).*commands?|commands?.*(running|active|names)/i.test(f.key)
    )
      out.push({ kind: 'names', key: f.key });
  const folders = new Map<string, string[]>();
  for (const f of real) {
    if (f.kind !== 'boolean') continue;
    const m = /^(.*\/Commands(?:All|Unique)?\/)[^/]+$/.exec(f.key);
    if (m) folders.set(m[1], [...(folders.get(m[1]) ?? []), f.key]);
  }
  // "CommandsAll" (one flag per command name) reads better than "CommandsUnique" (one per instance)
  for (const [prefix, keys] of [...folders.entries()].sort((a, b) => Number(/Unique\/$/.test(a[0])) - Number(/Unique\/$/.test(b[0]))))
    out.push({ kind: 'booleans', prefix, keys: keys.sort() });
  return out;
}

/** The commands from the log's best source (the commands panel lets the user pick another). Empty when it logs none. */
export function commandRowsFromLog(log: LogData): CommandRow[] {
  const src = detectCommandSources(log.fields)[0];
  if (!src) return [];
  if (src.kind === 'names') {
    const s = log.series(src.key);
    return s && s.kind === 'array' ? commandsFromNames(s.t, s.v, log.endTs) : [];
  }
  const sources: { name: string; t: ArrayLike<number>; v: ArrayLike<unknown> }[] = [];
  for (const k of src.keys) {
    const s = log.series(k);
    if (s && s.kind === 'boolean') sources.push({ name: k.slice(src.prefix.length), t: s.t, v: s.v });
  }
  return commandsFromBooleans(sources, log.endTs);
}
