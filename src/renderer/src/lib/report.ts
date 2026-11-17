/**
 * Match report: gathers what the app already knows about one log and hands
 * the page (core/report.ts) to the desktop app to print as a PDF. In the
 * browser build the page itself is downloaded, to print from the browser.
 */
import { reportHtml, matchTitle, type ReportInput } from '@core/report';
import { sessionStore, type LogEntry } from '../state/session';
import { profileStore, profileById } from '../state/profiles';
import { askChoice, toast } from '../state/ui';
import { client } from '../worker/client';
import { logWallClock } from './power';
import { downloadText } from './persist';

/** Thin a series to about `buckets` low/high pairs, so dips survive. */
export function thin(t: Float64Array, v: Float64Array, buckets = 360): { t: number[]; v: number[] } {
  const n = t.length;
  if (n <= buckets * 2) return { t: Array.from(t), v: Array.from(v) };
  const out = { t: [] as number[], v: [] as number[] };
  const per = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor(b * per);
    const i1 = Math.min(n, Math.floor((b + 1) * per));
    let lo = -1;
    let hi = -1;
    for (let i = i0; i < i1; i++) {
      if (!Number.isFinite(v[i])) continue;
      if (lo < 0 || v[i] < v[lo]) lo = i;
      if (hi < 0 || v[i] > v[hi]) hi = i;
    }
    if (lo < 0) continue;
    for (const i of lo === hi ? [lo] : lo < hi ? [lo, hi] : [hi, lo]) {
      out.t.push(t[i]);
      out.v.push(v[i]);
    }
  }
  return out;
}

/** Wait briefly for the background power and camera analyses of a log that was just opened. */
async function settled(id: string, ms = 2500): Promise<LogEntry | undefined> {
  const t0 = Date.now();
  for (;;) {
    const log = sessionStore.get().logs.find((l) => l.id === id);
    if (!log || (log.subsystems !== undefined && log.cameras !== undefined) || Date.now() - t0 > ms) return log;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function reportInput(log: LogEntry): Promise<ReportInput> {
  const profiles = profileStore.get();
  const profile = profileById(log.profileId);
  let voltage: ReportInput['voltage'];
  if (log.power.voltageKey) {
    const s = await client.getSeries(log.id, log.power.voltageKey);
    if (s && s.kind === 'number') voltage = thin(s.t, s.v as Float64Array);
  }
  return {
    name: log.name,
    fileName: log.fileName,
    matchInfo: log.matchInfo,
    robotState: log.robotState,
    startTs: log.startTs,
    endTs: log.endTs,
    truncated: log.truncated,
    loggers: log.loggers,
    autoRoutine: log.autoRoutine,
    power: log.power,
    events: log.events,
    subsystems: log.subsystems,
    cameras: log.cameras,
    missing: log.health.filter((h) => !h.present).map((h) => h.label),
    profileName: profile.name,
    batteryLabel: profiles.batteryLabels[log.fileName],
    threshold: sessionStore.get().brownoutThreshold,
    voltage,
    when: logWallClock(log),
    generatedAt: Date.now(),
    appVersion: __APP_VERSION__,
  };
}

/** Ask which log (when several are open), build the report and save it. */
export async function exportMatchReport(logId?: string): Promise<void> {
  const logs = sessionStore.get().logs;
  if (!logs.length) {
    toast('Open a log first, then make its match report.');
    return;
  }
  let id = logId ?? logs[0].id;
  if (!logId && logs.length > 1) {
    const r = await askChoice({
      title: 'Match report',
      message: 'A report covers one log. Which one?',
      options: [{ id: 'cancel', label: 'Cancel' }, ...logs.slice(0, 8).map((l, i) => ({ id: l.id, label: l.name, primary: i === 0 }))],
    });
    if (!r.id || r.id === 'cancel') return;
    id = r.id;
  }
  const log = await settled(id);
  if (!log) return;
  try {
    const input = await reportInput(log);
    const html = reportHtml(input);
    const base = `${matchTitle(log.matchInfo, log.name)} report`
      .replace(/[^\w .-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (window.brownout) {
      const path = await window.brownout.exportReport(html, `${base}.pdf`);
      if (path) toast(`Match report saved: ${path}`);
    } else {
      downloadText(`${base}.html`, html, 'text/html');
      toast('Match report downloaded as a web page. Open it and print it to make a PDF.');
    }
  } catch (e) {
    toast(`Could not make the match report: ${e instanceof Error ? e.message : String(e)}`, 'error', undefined, 9000);
  }
}
