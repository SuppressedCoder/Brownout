/**
 * Match report: one self-contained HTML page (inline styles, no scripts, no
 * outside requests) that summarizes a log for the pit: brownouts and what
 * caused them, power by subsystem, battery health, loop overruns, vision
 * blind stretches. The desktop app prints it to a PDF.
 */
import type { MatchInfo, ModeRange, RobotStateSummary } from './robotState';
import type { PowerReport } from './analyzers/power';
import type { PointEvent } from './analyzers/events';
import type { SubsystemReport, Draw } from './analyzers/subsystems';
import { UNASSIGNED, batteryRating } from './analyzers/subsystems';
import type { CameraSummary } from './vision';

export interface ReportInput {
  name: string;
  fileName: string;
  matchInfo: MatchInfo;
  robotState: RobotStateSummary;
  startTs: number;
  endTs: number;
  truncated: boolean;
  loggers: string[];
  autoRoutine?: string;
  power: PowerReport;
  events: PointEvent[];
  subsystems?: SubsystemReport | null;
  cameras?: CameraSummary[];
  /** Fields the analyses wanted and this log does not have. */
  missing: string[];
  profileName: string;
  batteryLabel?: string;
  /** Brownout threshold in volts. */
  threshold: number;
  /** Battery voltage, already thinned to a few hundred points (raw seconds). */
  voltage?: { t: ArrayLike<number>; v: ArrayLike<number> };
  /** Wall-clock time of the log (ms since epoch), when logged. */
  when: number | null;
  generatedAt: number;
  appVersion: string;
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const num = (v: number | undefined, digits = 1, unit = '') => (v === undefined || !Number.isFinite(v) ? 'not logged' : `${v.toFixed(digits)}${unit}`);
const span = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(s < 10 ? 2 : 1)} s`);
const MODE_NAMES: Record<string, string> = { auto: 'auto', autonomous: 'auto', teleop: 'teleop', test: 'test', disabled: 'disabled' };

function modeAt(ranges: ModeRange[], t: number): string {
  for (const r of ranges) if (t >= r.start && t < r.end) return MODE_NAMES[r.mode] ?? String(r.mode);
  return 'disabled';
}

/** "0:42.3 teleop": time since the robot was first enabled, with the mode it was in. */
export function matchClock(state: RobotStateSummary, t: number): string {
  const zero = state.firstEnable ?? state.autoStart ?? state.teleopStart;
  if (zero === undefined) return `${t.toFixed(1)} s`;
  const d = t - zero;
  const a = Math.abs(d);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${d < 0 ? '-' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)} ${modeAt(state.ranges, t)}`;
}

export function matchTitle(m: MatchInfo, fallback: string): string {
  const type = m.matchType && !/^none$/i.test(m.matchType) ? m.matchType : '';
  const match = m.matchNumber ? `${type || 'Match'} ${m.matchNumber}` : type;
  const parts = [m.eventName, match].filter(Boolean);
  return parts.length ? parts.join(' · ') : fallback;
}

function drawsText(draws: Draw[], names: Map<string, string>, top = 3): string {
  const list = draws.filter((d) => d.amps >= 0.5).slice(0, top);
  if (!list.length) return 'nothing above 0.5 A';
  return list.map((d) => `${esc(d.id === UNASSIGNED ? 'Not assigned' : (names.get(d.id) ?? d.id))} ${d.amps.toFixed(0)} A`).join(', ');
}

const MODE_FILL: Record<string, string> = { auto: '#d9f0dd', teleop: '#dbe7fb', test: '#f3e3f7' };

/** Battery voltage over the log as an inline SVG, with mode shading, the brownout line and brownout marks. */
function voltageChart(input: ReportInput): string {
  const s = input.voltage;
  if (!s || s.t.length < 2) return '';
  const W = 720;
  const H = 150;
  const L = 34;
  const R = 8;
  const top = 8;
  const B = 20;
  const t0 = input.startTs;
  const t1 = Math.max(input.endTs, t0 + 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < s.v.length; i++) {
    const v = s.v[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return '';
  lo = Math.floor(Math.min(lo, input.threshold) - 0.5);
  hi = Math.ceil(Math.max(hi, 13));
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const Y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Battery voltage over the log">`;
  for (const r of input.robotState.ranges) {
    const fill = MODE_FILL[MODE_NAMES[r.mode] ?? ''];
    if (!fill) continue;
    out += `<rect x="${X(r.start).toFixed(1)}" y="${top}" width="${Math.max(0.5, X(r.end) - X(r.start)).toFixed(1)}" height="${H - top - B}" fill="${fill}"/>`;
  }
  for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) {
    out += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#d0d4da" stroke-width="0.5"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#555">${v} V</text>`;
  }
  out += `<line x1="${L}" x2="${W - R}" y1="${Y(input.threshold).toFixed(1)}" y2="${Y(input.threshold).toFixed(1)}" stroke="#c0392b" stroke-width="1" stroke-dasharray="4 3"/>`;
  for (const b of input.power.brownouts) {
    out += `<rect x="${X(b.start).toFixed(1)}" y="${top}" width="${Math.max(1.5, X(b.end) - X(b.start)).toFixed(1)}" height="${H - top - B}" fill="#c0392b" opacity="0.35"/>`;
  }
  let d = '';
  let pen = false;
  for (let i = 0; i < s.t.length; i++) {
    const v = s.v[i];
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${X(s.t[i]).toFixed(1)} ${Y(v).toFixed(1)}`;
    pen = true;
  }
  out += `<path d="${d}" fill="none" stroke="#1f3a5f" stroke-width="1.2" stroke-linejoin="round"/>`;
  const zero = input.robotState.firstEnable ?? t0;
  const stepS = t1 - t0 > 400 ? 120 : t1 - t0 > 150 ? 30 : 15;
  for (let t = zero; t <= t1; t += stepS) {
    out += `<text x="${X(t).toFixed(1)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#555">${Math.round(t - zero)} s</text>`;
  }
  return `${out}</svg><div class="legend"><span class="sw" style="background:${MODE_FILL.auto}"></span>auto <span class="sw" style="background:${MODE_FILL.teleop}"></span>teleop <span class="sw" style="background:#c0392b;opacity:.45"></span>brownout <span class="dash"></span>brownout threshold ${input.threshold.toFixed(2)} V · seconds since first enable</div>`;
}

const RATING_TEXT: Record<string, string> = {
  good: 'good',
  fair: 'fair: fine for practice, think twice for eliminations',
  weak: 'weak: retire this battery from matches',
  unknown: 'not enough data to rate',
};

export function reportHtml(input: ReportInput): string {
  const { power: p, robotState: st, subsystems: sub } = input;
  const names = new Map<string, string>((sub?.stats ?? []).map((s) => [s.id, s.name]));
  const title = matchTitle(input.matchInfo, input.name);
  const info: [string, string][] = [];
  if (input.matchInfo.alliance)
    info.push(['Alliance', `${input.matchInfo.alliance === 'red' ? 'Red' : 'Blue'}${input.matchInfo.station ? ` ${input.matchInfo.station}` : ''}`]);
  if (input.when !== null) info.push(['Recorded', new Date(input.when).toLocaleString()]);
  info.push(['Log length', span(input.endTs - input.startTs)]);
  info.push(['Enabled', span(p.enabledTime)]);
  if (input.autoRoutine) info.push(['Auto routine', input.autoRoutine]);
  info.push(['Robot', input.profileName]);
  if (input.batteryLabel) info.push(['Battery', input.batteryLabel]);
  if (input.loggers.length) info.push(['Logged with', input.loggers.join(', ')]);
  info.push(['File', input.fileName]);

  const rating = batteryRating(p.internalResistance);
  const tiles: [string, string, string][] = [
    [
      'Brownouts',
      String(p.brownoutCount),
      p.brownoutCount
        ? `${span(p.brownoutDuration)} in total${p.brownoutsInferred ? ', inferred from voltage' : ''}`
        : p.voltageKey
          ? 'none'
          : 'voltage not logged',
    ],
    ['Lowest voltage', num(p.minVoltage, 2, ' V'), p.minVoltageT !== undefined ? `at ${matchClock(st, p.minVoltageT)}` : ''],
    ['Peak current', num(p.peakCurrent, 0, ' A'), p.peakCurrentT !== undefined ? `at ${matchClock(st, p.peakCurrentT)}` : ''],
    [
      'Energy used',
      num(sub?.totalEnergyWh ?? p.energyWh, 1, ' Wh'),
      sub?.voltageAssumed !== undefined
        ? `estimate at ${sub.voltageAssumed} V${sub.totalSource === 'none' ? ', listed motors only' : ''}`
        : sub?.totalSource === 'none' && sub.totalEnergyWh !== undefined
          ? 'listed motors only'
          : p.avgCurrent !== undefined
            ? `average ${p.avgCurrent.toFixed(0)} A while enabled`
            : '',
    ],
    ['Battery resistance', p.internalResistance !== undefined ? `${(p.internalResistance * 1000).toFixed(0)} mΩ` : 'not known', RATING_TEXT[rating]],
  ];

  // what made the page goes in the header: a footer of its own can spill onto an empty second page
  let body = `<header><div class="kicker">Match report</div><h1>${esc(title)}</h1><div class="sub">${esc(input.name)} · made with Brownout ${esc(input.appVersion)} on ${esc(new Date(input.generatedAt).toLocaleString())} · times are minutes and seconds since the robot was first enabled</div></header>`;
  body += `<dl class="info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  if (input.truncated)
    body += `<p class="warn">This log ends mid-record: the robot lost power or the file was copied while still being written. The last moments may be missing.</p>`;
  body += `<div class="tiles">${tiles.map(([k, v, note]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="n">${esc(note)}</div></div>`).join('')}</div>`;
  const chart = voltageChart(input);
  if (chart) body += `<section><h2>Battery voltage</h2>${chart}</section>`;

  // Brownouts
  body += `<section><h2>Brownouts</h2>`;
  if (!p.voltageKey && !p.brownoutKey) body += `<p class="muted">Battery voltage is not in this log, so brownouts cannot be found.</p>`;
  else if (p.brownouts.length === 0)
    body += `<p>No brownouts. The lowest voltage was ${esc(num(p.minVoltage, 2, ' V'))}, against a threshold of ${input.threshold.toFixed(2)} V.</p>`;
  else {
    const rows = p.brownouts.slice(0, 12).map((b, i) => {
      const br = sub?.brownouts.find((x) => Math.abs(x.start - b.start) < 0.05);
      const cause = br
        ? `<td>${drawsText(br.atDip, names)}</td><td>${drawsText(br.before, names)}</td>`
        : `<td colspan="2" class="muted">${sub === null ? 'No power subsystems are set up for this robot.' : 'Not known for this brownout.'}</td>`;
      return `<tr><td>${i + 1}</td><td>${esc(matchClock(st, b.start))}</td><td>${esc(span(b.end - b.start))}</td><td>${esc(num(br?.minVoltage, 2, ' V'))}</td>${cause}</tr>`;
    });
    body += `<table><thead><tr><th>#</th><th>When</th><th>Lasted</th><th>Lowest</th><th>Drawing the most at the lowest point</th><th>In the half second before</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    if (p.brownouts.length > 12) body += `<p class="muted">${p.brownouts.length - 12} more not shown.</p>`;
    if (p.brownoutsInferred)
      body += `<p class="muted">This log has no brownout flag, so these are the times the voltage was under ${input.threshold.toFixed(2)} V.</p>`;
  }
  body += `</section>`;

  // Power by subsystem
  if (sub && sub.hasData) {
    const all = [...sub.stats, ...(sub.unassigned ? [sub.unassigned] : [])].sort((a, b) => b.energyWh - a.energyWh);
    const rows = all.map(
      (s) =>
        `<tr><td>${esc(s.id === UNASSIGNED ? 'Not assigned' : s.name)}</td><td class="r">${s.energyWh.toFixed(2)} Wh</td><td class="r">${Number.isFinite(s.share) ? `${(s.share * 100).toFixed(0)}%` : ''}</td><td class="bar"><span style="width:${Number.isFinite(s.share) ? Math.max(0, Math.min(100, s.share * 100)).toFixed(1) : 0}%"></span></td><td class="r">${s.avgCurrent.toFixed(1)} A</td><td class="r">${s.peakCurrent.toFixed(0)} A</td><td>${esc(matchClock(st, s.peakT))}${s.peakVoltage !== undefined ? `, battery at ${s.peakVoltage.toFixed(1)} V` : ''}</td></tr>`,
    );
    body += `<section><h2>Power by subsystem</h2><table><thead><tr><th>Subsystem</th><th class="r">Energy</th><th class="r">Share</th><th></th><th class="r">Average while enabled</th><th class="r">Peak</th><th>Peak was at</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    if (sub.voltageAssumed !== undefined)
      body += `<p class="muted">Battery voltage is not in this log, so energy is an estimate at a steady ${sub.voltageAssumed} V and the shares compare current only.</p>`;
    if (sub.totalSource === 'none')
      body += `<p class="muted">Total current is not in this log, so the shares are of the motors listed only. Anything without a logged current (often the drivetrain) is not counted.</p>`;
    for (const w of sub.warnings.slice(0, 4)) body += `<p class="muted">${esc(w)}</p>`;
    body += `</section>`;
  } else if (sub === null) {
    body += `<section><h2>Power by subsystem</h2><p class="muted">No power subsystems are set up for this robot. In Brownout, open Power and choose "Set up subsystems" to say which motors belong to which mechanism.</p></section>`;
  }

  // Deepest dips
  if (p.dips.length) {
    const rows = p.dips.slice(0, 5).map((d) => {
      const sd = sub?.dips.find((x) => Math.abs(x.t - d.t) < 0.05);
      const what = sd
        ? drawsText(sd.draws, names)
        : d.topChannels.length
          ? d.topChannels
              .slice(0, 3)
              .map((c) => `channel ${c.channel} ${c.amps.toFixed(0)} A`)
              .join(', ')
          : '';
      return `<tr><td>${esc(matchClock(st, d.t))}</td><td class="r">${d.voltage.toFixed(2)} V</td><td class="r">${d.current !== undefined ? `${d.current.toFixed(0)} A` : ''}</td><td>${what}</td></tr>`;
    });
    body += `<section><h2>Deepest voltage dips</h2><table><thead><tr><th>When</th><th class="r">Voltage</th><th class="r">Total current</th><th>Drawing the most</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
  }

  // Code health
  const overruns = input.events.filter((e) => e.kind === 'overrun');
  // the ones that matter happened during the match: start-up overruns while disabled are routine
  const enabledOverruns = overruns.filter((e) => modeAt(st.ranges, e.t) !== 'disabled');
  const withMs = enabledOverruns.map((e) => ({ e, ms: Number(/([\d.]+)\s*ms/.exec(e.text)?.[1] ?? NaN) }));
  const worst = withMs
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);
  const count = (k: PointEvent['kind']) => input.events.filter((e) => e.kind === k).length;
  body += `<section><h2>Code and connection</h2><ul>`;
  body += `<li>${
    overruns.length === 0
      ? 'No loop overruns.'
      : `${overruns.length} loop overrun${overruns.length === 1 ? '' : 's'}, ${enabledOverruns.length === 0 ? 'none' : enabledOverruns.length} while enabled${
          worst.length ? `. The longest while enabled: ${worst.map((x) => `${x.ms.toFixed(0)} ms at ${esc(matchClock(st, x.e.t))}`).join('; ')}` : ''
        }.`
  }</li>`;
  const reboots = input.events.filter((e) => e.kind === 'reboot' && e.t > input.startTs + 1);
  if (reboots.length)
    body += `<li class="bad">The robot program restarted ${reboots.length === 1 ? 'once' : `${reboots.length} times`} during the log: ${reboots
      .slice(0, 4)
      .map((e) => esc(matchClock(st, e.t)))
      .join('; ')}.</li>`;
  const disc = input.events.filter((e) => e.kind === 'disconnect');
  if (disc.length)
    body += `<li class="bad">${disc.length} connection loss${disc.length === 1 ? '' : 'es'}: ${disc
      .slice(0, 4)
      .map((e) => esc(matchClock(st, e.t)))
      .join('; ')}.</li>`;
  body += `<li>${count('error')} error${count('error') === 1 ? '' : 's'}, ${count('warning')} warning${count('warning') === 1 ? '' : 's'} and ${count('alert')} alert${count('alert') === 1 ? '' : 's'} in the console.</li></ul>`;
  const seen = new Set<string>();
  const firstErrors = input.events.filter((e) => e.kind === 'error' && !seen.has(e.text) && seen.add(e.text)).slice(0, 5);
  if (firstErrors.length)
    body += `<table><thead><tr><th>When</th><th>First errors</th></tr></thead><tbody>${firstErrors.map((e) => `<tr><td>${esc(matchClock(st, e.t))}</td><td class="mono">${esc(e.text)}</td></tr>`).join('')}</tbody></table>`;
  body += `</section>`;

  // Vision
  if (input.cameras && input.cameras.length) {
    const rows = input.cameras.map((c) => {
      const longest = c.blind.reduce((m, b) => Math.max(m, b.end - b.start), 0);
      const blind = c.blind.length
        ? `${c.blind.length} stretch${c.blind.length === 1 ? '' : 'es'} with no tag, longest ${span(longest)}: ${[...c.blind]
            .sort((a, b) => b.end - b.start - (a.end - a.start))
            .slice(0, 3)
            .map((b) => `${esc(matchClock(st, b.start))} for ${span(b.end - b.start)}`)
            .join('; ')}`
        : Number.isFinite(c.seenFraction)
          ? 'never blind for 2 s or more'
          : '';
      return `<tr><td>${esc(c.name)}</td><td class="r">${Number.isFinite(c.seenFraction) ? `${(c.seenFraction * 100).toFixed(0)}%` : 'not logged'}</td><td class="r">${c.meanError !== undefined ? `${c.meanError.toFixed(2)} m` : ''}</td><td class="r">${c.maxError !== undefined ? `${c.maxError.toFixed(2)} m` : ''}</td><td>${blind}</td></tr>`;
    });
    body += `<section><h2>Vision</h2><table><thead><tr><th>Camera</th><th class="r">Saw a tag</th><th class="r">Typical error</th><th class="r">Worst error</th><th>Blind while enabled</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="muted">"Saw a tag" is the share of enabled time with at least one AprilTag in view. Error is the distance between the camera's pose estimate and the robot's logged pose.</p></section>`;
  }

  // Where the robot position jumped or a camera disagreed with it, and what was running
  const vision = input.events.filter((e) => e.kind === 'vision' && e.finding);
  if (vision.length) {
    const biggest = [...vision]
      .sort((a, b) => b.finding!.size - a.finding!.size)
      .slice(0, 6)
      .sort((a, b) => a.t - b.t);
    const rows = biggest.map((e) => `<tr><td>${esc(matchClock(st, e.t))}</td><td>${esc(e.text)}</td></tr>`);
    body += `<section><h2>Position and vision</h2><table><thead><tr><th>When</th><th>What happened</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="muted">${vision.length} in all${vision.length > biggest.length ? `; the ${biggest.length} largest are listed` : ''}. A jump is the robot position moving further in one step than a robot can drive, usually a vision correction. A disagreement is a camera's estimate staying 0.5 m or more from the robot position. Either can throw off an action that aims or drives by position.</p></section>`;
  }

  if (input.missing.length)
    body += `<section><h2>Not in this log</h2><p class="muted">${input.missing.map(esc).join(', ')}. Sections that need these are shorter or left out.</p></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(title)} match report</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

const CSS = `
@page { size: letter; margin: 0.4in; }
* { box-sizing: border-box; }
body { font: 11px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b1f24; margin: 0; padding: 18px 22px; background: #fff; }
@media print { body { padding: 0; } }
header { border-bottom: 2px solid #1f3a5f; padding-bottom: 8px; margin-bottom: 10px; }
.kicker { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #1f3a5f; font-weight: 700; }
h1 { font-size: 22px; margin: 2px 0 0; }
.sub { color: #555; }
h2 { font-size: 13px; margin: 0 0 6px; color: #1f3a5f; }
section { margin-top: 12px; break-inside: avoid; }
.info { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 10px; }
.info div { display: flex; gap: 5px; }
dt { color: #666; }
dd { margin: 0; font-weight: 600; }
.tiles { display: flex; gap: 8px; }
.tile { flex: 1; border: 1px solid #d0d4da; border-radius: 6px; padding: 7px 9px; }
.tile .k { color: #666; font-size: 10px; }
.tile .v { font-size: 18px; font-weight: 700; line-height: 1.25; }
.tile .n { color: #555; font-size: 9.5px; min-height: 13px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; color: #555; border-bottom: 1px solid #9aa3ad; padding: 3px 6px; font-size: 10px; }
td { border-bottom: 1px solid #e3e6ea; padding: 3px 6px; vertical-align: top; }
.r { text-align: right; white-space: nowrap; }
.bar { width: 90px; }
.bar span { display: block; height: 8px; margin-top: 3px; background: #1f3a5f; border-radius: 2px; min-width: 1px; }
.muted { color: #666; }
.warn { background: #fff4d6; border: 1px solid #e3c466; border-radius: 4px; padding: 5px 8px; }
.bad { color: #a12b1f; font-weight: 600; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px; word-break: break-word; }
ul { margin: 0 0 6px; padding-left: 18px; }
p { margin: 5px 0; }
.legend { color: #555; font-size: 9.5px; margin-top: 2px; }
.sw { display: inline-block; width: 10px; height: 8px; margin: 0 3px 0 8px; border: 1px solid #c5cad1; vertical-align: -1px; }
.sw:first-child { margin-left: 0; }
.dash { display: inline-block; width: 14px; border-top: 1px dashed #c0392b; margin: 0 3px 0 8px; vertical-align: 3px; }
footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #d0d4da; color: #777; font-size: 9.5px; }
`;
