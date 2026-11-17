/**
 * Console / event stream: merges console output, DataLogManager messages,
 * WPILib alerts and error fields into one list with severities, plus point
 * events for the timeline (brownouts, reboots, loop overruns, errors).
 */
import type { LogData } from '../log';
import { resolveRole } from '../roles';

export type Severity = 'error' | 'warning' | 'info';

export interface ConsoleLine {
  t: number; // raw seconds
  severity: Severity;
  source: string; // key
  text: string;
}

export interface PointEvent {
  t: number;
  kind: 'brownout' | 'reboot' | 'overrun' | 'error' | 'warning' | 'alert' | 'disconnect';
  text: string;
}

const CONSOLE_KEYS = ['console', 'messages', '/RealOutputs/Console', 'NT:/AdvantageKit/RealOutputs/Console', 'DS:/Dscomm/Console'];

export function severityOf(text: string): Severity {
  const l = text.toLowerCase();
  // WPILib prints "Warning at package.Class.method(File.java:12): ..." and "Error at ...": the first word decides
  if (/^\s*warning\b/.test(l)) return 'warning';
  if (/^\s*error\b/.test(l)) return 'error';
  if (/\berror\b|exception|\bfatal\b|crash|traceback|\bat [a-z][\w.$]+\(/.test(l)) return 'error';
  if (/\bwarn(ing)?\b|overrun|loop time of|not updated often enough|brownout/.test(l)) return 'warning';
  return 'info';
}

export function extractConsole(log: LogData): ConsoleLine[] {
  const out: ConsoleLine[] = [];
  const seenKeys = new Set<string>();
  const keys = [...CONSOLE_KEYS];
  const extra = resolveRole(log, 'console');
  if (extra && !keys.includes(extra)) keys.push(extra);
  for (const key of keys) {
    const f = log.field(key);
    if (!f || seenKeys.has(key) || f.count === 0) continue;
    seenKeys.add(key);
    const s = log.series(key);
    if (!s || s.kind !== 'string') continue;
    for (let i = 0; i < s.t.length; i++) {
      const text = s.v[i];
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        const stripped = stripAnsi(line);
        if (!stripped.trim()) continue;
        out.push({ t: s.t[i], severity: severityOf(stripped), source: key, text: stripped });
      }
    }
  }
  // WPILib alerts: string[] fields errors / warnings / infos in a folder named "Alerts", or in any
  // folder whose .type says "Alerts" (teams name their alert groups: "Power", "Vision", ...)
  for (const f of log.fields) {
    if (f.generated || f.kind !== 'string[]') continue;
    const m = ALERT_FIELD.exec(f.key);
    if (!m) continue;
    const dir = f.key.slice(0, f.key.length - m[0].length);
    const group = dir.slice(dir.lastIndexOf('/') + 1);
    if (group !== 'Alerts' && !isAlertGroup(log, dir)) continue;
    const sev: Severity = m[1] === 'errors' ? 'error' : m[1] === 'warnings' ? 'warning' : 'info';
    const s = log.series(f.key);
    if (!s || s.kind !== 'array') continue;
    let prev = new Set<string>();
    // an alert that clears and comes straight back is one occurrence, not many
    const cleared = new Map<string, number>();
    for (let i = 0; i < s.t.length; i++) {
      const cur = new Set(s.v[i] as string[]);
      for (const a of prev) if (!cur.has(a)) cleared.set(a, s.t[i]);
      for (const a of cur) {
        if (prev.has(a)) continue;
        const last = cleared.get(a);
        if (last !== undefined && s.t[i] - last < ALERT_REPEAT) continue;
        out.push({ t: s.t[i], severity: sev, source: 'alert', text: `[Alert] ${group === 'Alerts' ? '' : `${group}: `}${a}` });
      }
      prev = cur;
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** "Warning at edu.wpi.first.wpilibj.DriverStation.report(DriverStation.java:1345): Joystick ..." -> "Joystick ...". */
export function message(text: string): string {
  return text.replace(/^\s*(warning|error)\s+at\s+[\w.$<>]+\([^)]*\):\s*/i, '').trim() || text;
}

/** Seconds: the same message again this soon after the last one is folded into it. */
const REPEAT_WINDOW = 5;

/**
 * Fold a message that keeps repeating (WPILib prints "Joystick ... not available"
 * once a second) into its first occurrence, with a count.
 */
function foldRepeats(events: PointEvent[]): PointEvent[] {
  const out: PointEvent[] = [];
  const open = new Map<string, { e: PointEvent; last: number; n: number; text: string }>();
  for (const e of events) {
    if (e.kind !== 'warning' && e.kind !== 'error') {
      out.push(e);
      continue;
    }
    // numbers aside: "Button 3 on port 0" and "Button 1 on port 1" are the same complaint
    const key = `${e.kind}\u0000${e.text.replace(/\d+(\.\d+)?/g, '#')}`;
    const prev = open.get(key);
    if (prev && e.t - prev.last <= REPEAT_WINDOW) {
      prev.last = e.t;
      prev.n++;
      prev.e.text = `${prev.text} (${prev.n} times until ${e.t.toFixed(0)} s)`;
      continue;
    }
    const copy = { ...e };
    open.set(key, { e: copy, last: e.t, n: 1, text: e.text });
    out.push(copy);
  }
  return out;
}

const ALERT_FIELD = /\/(errors|warnings|infos)$/;
/** Seconds: an alert raised again this soon after clearing counts as the same occurrence. */
const ALERT_REPEAT = 5;

function isAlertGroup(log: LogData, dir: string): boolean {
  const f = log.field(`${dir}/.type`);
  if (!f || f.count === 0) return false;
  const s = log.series(f.key);
  return !!s && s.kind === 'string' && s.v[0] === 'Alerts';
}

/** "\tDrive.periodic(): 0.021704s" lines that WPILib's Tracer prints after a loop overrun. */
const EPOCH = /(?:^|\t)\s*([^\t()]+)\(\): (\d*\.?\d+)s\s*$/;

/** The slowest part named in the Tracer lines that follow an overrun message, if any. */
function slowestPart(console: ConsoleLine[], from: number): { name: string; ms: number } | undefined {
  let best: { name: string; ms: number } | undefined;
  for (let j = from; j < console.length && j < from + 60 && console[j].t - console[from].t <= 0.3; j++) {
    // the next overrun's details belong to the next overrun
    if (j > from && /loop time of .* overrun/i.test(console[j].text)) break;
    const m = EPOCH.exec(console[j].text);
    if (!m) continue;
    const ms = Number(m[2]) * 1000;
    if (Number.isFinite(ms) && (!best || ms > best.ms)) best = { name: m[1].trim(), ms };
  }
  return best;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export function extractEvents(log: LogData, console: ConsoleLine[]): PointEvent[] {
  const out: PointEvent[] = [];
  const bk = resolveRole(log, 'brownout');
  if (bk) {
    const s = log.series(bk);
    if (s && s.kind === 'boolean') {
      for (let i = 0; i < s.t.length; i++) if (s.v[i] && (i === 0 || !s.v[i - 1])) out.push({ t: s.t[i], kind: 'brownout', text: 'Brownout' });
    }
  }
  const lt = resolveRole(log, 'loopTime');
  if (lt) {
    const s = log.series(lt);
    if (s && s.kind === 'number') {
      let last = -Infinity;
      for (let i = 0; i < s.t.length; i++) {
        if (s.v[i] > 20 && s.t[i] - last > 0.5) {
          out.push({ t: s.t[i], kind: 'overrun', text: `Loop ${s.v[i].toFixed(1)} ms` });
          last = s.t[i];
        }
      }
    }
  }
  let starts = 0;
  for (let i = 0; i < console.length; i++) {
    const c = console[i];
    if (/robot program starting|\*{4,} Robot program startup/i.test(c.text)) {
      // every log has one start-up message; only a second one means the program restarted while logging
      if (starts++ > 0) out.push({ t: c.t, kind: 'reboot', text: 'Program restart' });
    } else if (/loop time of .* overrun/i.test(c.text)) {
      if (!lt) {
        const part = slowestPart(console, i);
        const period = /loop time of ([\d.]+)s/i.exec(c.text);
        out.push({
          t: c.t,
          kind: 'overrun',
          text: part
            ? `Loop overrun: ${part.name}() took ${part.ms.toFixed(1)} ms`
            : `Loop overrun${period ? ` (over ${(Number(period[1]) * 1000).toFixed(0)} ms)` : ''}`,
        });
      }
    } else if (EPOCH.test(c.text) || /commandscheduler loop overrun/i.test(c.text)) {
      // detail lines of an overrun, already counted above
      continue;
    } else if (/ds disconnected|lost connection|fms disconnected/i.test(c.text)) out.push({ t: c.t, kind: 'disconnect', text: c.text.slice(0, 60) });
    else if (c.source === 'alert') out.push({ t: c.t, kind: 'alert', text: c.text.slice(0, 80) });
    else if (c.severity === 'error') out.push({ t: c.t, kind: 'error', text: message(c.text).slice(0, 100) });
    else if (c.severity === 'warning' && !/loop time/i.test(c.text)) out.push({ t: c.t, kind: 'warning', text: message(c.text).slice(0, 100) });
  }
  // Timestamp reset = reboot (log continued after power loss)
  const pst = log.field('NT:/Robot/ProgramStartTime') ?? log.field('/Robot/ProgramStartTime');
  if (pst) {
    const s = log.series(pst.key);
    if (s && s.kind === 'number')
      for (let i = 1; i < s.t.length; i++) if (s.v[i] !== s.v[i - 1]) out.push({ t: s.t[i], kind: 'reboot', text: 'Program restart' });
  }
  out.sort((a, b) => a.t - b.t);
  return foldRepeats(out);
}
