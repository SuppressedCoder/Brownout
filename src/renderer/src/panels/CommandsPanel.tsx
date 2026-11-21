/**
 * Commands: one row per command, with a bar whenever it ran. Reads the
 * command scheduler's list of running commands (normally
 * NT:/SmartDashboard/Scheduler/Names), or one true/false field per command
 * (see core/commands.ts). With several logs each row has one lane per log.
 *
 * What runs at the cursor is meant to be seen at a glance: its row is tinted
 * in the log's color with a bar at its left edge, its name is bold, and the
 * time column says how long the current run has been going. A command that
 * just started flashes its row (fading over FLASH seconds of log time), so
 * during playback the one that went off stands out. Runs not at the cursor
 * are dimmed.
 *
 * Interaction: hovering a row highlights it and outlines the run under the
 * mouse; clicking a run jumps to its start; clicking a name jumps to that
 * command's next run (Shift: the previous one). A filter finds commands by name.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { panelStore, updatePanel, type CommandsSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore, setCursor, gotoTime } from '../state/time';
import { useStore, createStore, type Store } from '../state/store';
import { toast } from '../state/ui';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { useSeriesTick } from '../lib/useSeries';
import { commandsFromNames, commandsFromBooleans, detectCommandSources, type CommandRow, type CommandSource } from '@core/commands';
import type { FieldInfo } from '@core/log';
import { formatTime } from '@core/alignment';
import { T } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { drawCursor, drawTimeAxis, fitText } from '../lib/draw';
import { Toolbar, ToolSelect, ToolInput } from '../components/Toolbar';
import { FieldSlot, KeyText } from '../components/FieldSlot';
import type { FieldSpec } from '../lib/fields';
import { StripRow, useStripHidden } from '../components/FieldStrip';
import { GuideLink } from '../components/Guide';

/** Width of the command-name column: wider panels give long command names more room. */
const labelW = (width: number) => Math.round(Math.min(340, Math.max(220, width * 0.42)));
const AXIS_H = 20;
const LANE = 10;
/** How long (log seconds) a command's row flashes after it starts. */
const FLASH = 0.75;

/** The row and run under the mouse (run: `${logId}:${index}`). */
interface Hover {
  row: number;
  run: string | null;
}

/** The field that lists the running commands. */
const COMMAND_LIST: FieldSpec = { types: ['string[]'] };

const sourceCache = new WeakMap<FieldInfo[], CommandSource[]>();
function sourceFor(log: LogEntry, override: string | undefined): CommandSource | null {
  if (override) return log.fields.some((f) => f.key === override) ? { kind: 'names', key: override } : null;
  let s = sourceCache.get(log.fields);
  if (!s) sourceCache.set(log.fields, (s = detectCommandSources(log.fields)));
  return s[0] ?? null;
}

interface Built {
  src: unknown[];
  rows: CommandRow[];
}
const rowCache = new Map<string, Built>();

/** The command runs of one log (raw seconds), or null while its series are loading / when it has none. */
function rowsFor(log: LogEntry, override: string | undefined): CommandRow[] | null {
  const source = sourceFor(log, override);
  if (!source) return null;
  const keys = source.kind === 'names' ? [source.key] : source.keys;
  const series = keys.map((k) => client.peekSeries(log.id, k));
  if (series.some((s) => s === undefined)) return null;
  const cacheKey = `${log.id}|${keys.join('|')}`;
  const hit = rowCache.get(cacheKey);
  if (hit && hit.src.length === series.length && hit.src.every((s, i) => s === series[i])) return hit.rows;
  let rows: CommandRow[] = [];
  if (source.kind === 'names') {
    const s = series[0];
    if (s && s.kind === 'array') rows = commandsFromNames(s.t, s.v, log.endTs);
  } else {
    rows = commandsFromBooleans(
      series.flatMap((s, i) => (s && s.kind === 'boolean' ? [{ name: keys[i].slice(source.prefix.length), t: s.t, v: s.v }] : [])),
      log.endTs,
    );
  }
  rowCache.set(cacheKey, { src: series, rows });
  return rows;
}

interface Layout {
  logs: LogEntry[];
  names: string[];
  byLog: Map<string, Map<string, CommandRow>>;
  rowH: number;
  headH: number;
}

/** Every word of the filter appears in the name. */
function matches(name: string, filter: string | undefined): boolean {
  if (!filter) return true;
  const n = name.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => n.includes(w));
}

function layout(settings: CommandsSettings): Layout {
  const session = sessionStore.get();
  let logs = session.logs.filter((l) => l.visible);
  if (settings.source !== 'all') logs = logs.filter((l) => l.id === settings.source);
  const byLog = new Map<string, Map<string, CommandRow>>();
  const first = new Map<string, number>();
  for (const log of logs) {
    const rows = rowsFor(log, settings.sourceKey);
    if (!rows) continue;
    const m = new Map<string, CommandRow>();
    for (const r of rows) {
      if (!matches(r.name, settings.filter)) continue;
      m.set(r.name, r);
      const at = r.runs[0].start + log.offset;
      if (!first.has(r.name) || at < first.get(r.name)!) first.set(r.name, at);
    }
    byLog.set(log.id, m);
  }
  const names = [...first.keys()].sort((a, b) => first.get(a)! - first.get(b)! || a.localeCompare(b));
  // a legend tells the lanes apart when there are several logs; one log needs none
  return { logs, names, byLog, rowH: Math.max(24, logs.length * LANE + 10), headH: logs.length > 1 ? 22 : 2 };
}

/** "2.4 s", "38 s", "1:05". */
function duration(s: number): string {
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** The start of this command's next run after the cursor (or the previous one before it), over the logs shown. */
function nextRunStart(lay: Layout, name: string, dir: 1 | -1): number | null {
  const cur = timeStore.get().cursor;
  let best: number | null = null;
  for (const log of lay.logs) {
    for (const u of lay.byLog.get(log.id)?.get(name)?.runs ?? []) {
      const a = u.start + log.offset;
      const ok = cur === null ? dir === 1 : dir === 1 ? a > cur + 1e-6 : a < cur - 1e-6;
      if (ok && (best === null || (dir === 1 ? a < best : a > best))) best = a;
    }
  }
  return best;
}

/** Where the command list comes from: found by name (shown faintly), or a text-list field dropped or typed here. */
export function CommandsSource({ id }: { id: string }) {
  const sourceKey = useStore(panelStore, (s) => (s.panels[id] as CommandsSettings | undefined)?.sourceKey);
  const logs = useStore(sessionStore, (s) => s.logs);
  const autoSource = logs
    .filter((l) => l.visible)
    .map((l) => sourceFor(l, undefined))
    .find(Boolean);
  return (
    <FieldSlot
      inline
      spec={COMMAND_LIST}
      value={sourceKey ?? (autoSource?.kind === 'names' ? autoSource.key : undefined)}
      placeholder={autoSource?.kind === 'booleans' ? <KeyText k={autoSource.prefix} /> : undefined}
      panel={id}
      onPick={(key) => updatePanel<CommandsSettings>(id, { sourceKey: key })}
      onClear={sourceKey ? () => updatePanel<CommandsSettings>(id, { sourceKey: undefined }) : undefined}
      testId="commands-source"
    />
  );
}

export function CommandsPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as CommandsSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  useSeriesTick();
  const hover = useMemo(() => createStore<Hover>({ row: -1, run: null }), []);
  const draw = useCallback((dc: DrawContext) => drawCommands(dc, id, hover), [id, hover]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore, hover], [id]);
  const L = layout(settings);
  const height = L.headH + L.names.length * L.rowH + AXIS_H;
  const anySource = logs.some((l) => sourceFor(l, settings.sourceKey));
  const stripHidden = useStripHidden(id);
  const hostRef = useRef<HTMLDivElement>(null);

  // hit testing: highlight and tooltip on hover; a run jumps to its start, a name to the next run
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hit = (e: MouseEvent) => {
      const st = panelStore.get().panels[id] as CommandsSettings | undefined;
      if (!st) return null;
      const lay = layout(st);
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top - lay.headH;
      if (y < 0) return null;
      const row = Math.floor(y / lay.rowH);
      const name = lay.names[row];
      if (!name) return null;
      const LW = labelW(r.width);
      if (x < LW) return { lay, row, name, label: true as const };
      const lane = Math.floor((y - row * lay.rowH - 5) / LANE);
      const li = Math.max(0, Math.min(lay.logs.length - 1, lane));
      const log = lay.logs[li];
      const [t0, t1] = timeStore.get().view;
      const t = t0 + ((x - LW) / (r.width - LW - 8)) * (t1 - t0);
      // a run narrower than a few pixels is still easy to hit
      const slop = (4 / Math.max(1, r.width - LW - 8)) * (t1 - t0);
      const runs = lay.byLog.get(log.id)?.get(name)?.runs ?? [];
      const ri = runs.findIndex((u) => t >= u.start + log.offset - slop && t <= u.end + log.offset + slop);
      return { lay, row, name, label: false as const, log, run: ri >= 0 ? runs[ri] : undefined, runKey: ri >= 0 ? `${log.id}:${ri}` : null };
    };
    const onMove = (e: MouseEvent) => {
      const h = hit(e);
      const next: Hover = { row: h ? h.row : -1, run: h && !h.label ? h.runKey : null };
      const prev = hover.get();
      if (prev.row !== next.row || prev.run !== next.run) hover.set(next);
      if (!h) {
        el.style.cursor = 'default';
        el.title = '';
      } else if (h.label) {
        el.style.cursor = 'pointer';
        el.title = `${h.name}\nClick: go to its next run. Shift+click: the previous one.`;
      } else if (h.run) {
        el.style.cursor = 'pointer';
        el.title = `${h.name} · ${h.log.name}\n${formatTime(h.run.start + h.log.offset)} to ${formatTime(h.run.end + h.log.offset)} (${(h.run.end - h.run.start).toFixed(2)} s${h.run.open ? ', still running when the log ended' : ''})\nClick to jump to its start`;
      } else {
        el.style.cursor = 'default';
        el.title = '';
      }
    };
    const onLeave = () => hover.set({ row: -1, run: null });
    const onClick = (e: MouseEvent) => {
      const h = hit(e);
      if (!h) return;
      if (!h.label) {
        if (h.run) setCursor(h.run.start + h.log.offset);
        return;
      }
      const t = nextRunStart(h.lay, h.name, e.shiftKey ? -1 : 1);
      if (t === null) toast(e.shiftKey ? `${h.name} has no run before the cursor.` : `${h.name} has no run after the cursor.`);
      else gotoTime(t);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('click', onClick);
    };
    // again when the canvas appears: it is not there while the panel shows a message instead
  }, [ref.current, id, hover]);

  return (
    <div className="panel commands-panel">
      {!stripHidden && (
        <StripRow>
          <CommandsSource id={id} />
        </StripRow>
      )}
      <Toolbar>
        <ToolInput
          low
          value={settings.filter ?? ''}
          onChange={(v) => updatePanel<CommandsSettings>(id, { filter: v || undefined })}
          placeholder="Filter commands"
          title="Show only commands whose names contain these words"
          width={140}
        />
        <ToolSelect
          low
          value={settings.source}
          onChange={(v) => updatePanel<CommandsSettings>(id, { source: v })}
          options={[['all', 'All logs'], ...logs.map((l) => [l.id, l.name] as [string, string])]}
          title="Which log(s) to show"
        />
      </Toolbar>
      {logs.length === 0 ? (
        <div className="panel-placeholder">Open a log to see its commands.</div>
      ) : !anySource ? (
        <div className="panel-placeholder">
          <div>
            No record of the robot's commands in this log. This panel finds it by itself; you do not add fields. The robot code has to record it:
            <br />
            WPILib: <code>SmartDashboard.putData(CommandScheduler.getInstance())</code> with <code>DataLogManager.start()</code>.
            <br />
            AdvantageKit: log <code>CommandsAll/&lt;name&gt;</code> as true while each command runs, from the scheduler&apos;s onCommandInitialize,
            onCommandFinish and onCommandInterrupt.
            <br />
            If the log keeps the list under another name, drop it on the box at the top.
            <br />
            <GuideLink section="commands">The code for both, in the guide</GuideLink>
          </div>
        </div>
      ) : (
        <div className="scroll commands-body">
          {settings.filter && L.names.length === 0 && <div className="hint commands-none">No command matches “{settings.filter}”.</div>}
          <div className="canvas-host" ref={hostRef} style={{ height, flex: 'none' }} data-testid="commands-chart" data-rows={L.names.length}>
            <canvas ref={ref} />
          </div>
        </div>
      )}
    </div>
  );
}

function drawCommands(dc: DrawContext, id: string, hoverStore: Store<Hover>) {
  const { ctx, width, height } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as CommandsSettings | undefined;
  if (!settings) return;
  const hover = hoverStore.get();
  const lay = layout(settings);
  const time = timeStore.get();
  const [t0, t1] = time.view;
  const LABEL_W = labelW(width);
  const x0 = LABEL_W;
  const x1 = width - 8;
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  // during playback the hover is ignored: what runs is what the playhead shows
  const cur = time.playing ? time.cursor : (time.hover ?? time.cursor);
  ctx.textBaseline = 'middle';

  // legend: which lane is which log, and how many commands each runs at the cursor
  if (lay.logs.length > 1) {
    let x = 8;
    const y = 11;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    for (const log of lay.logs) {
      const rows = lay.byLog.get(log.id);
      let n = 0;
      if (rows && cur !== null) for (const row of rows.values()) if (row.runs.some((u) => cur >= u.start + log.offset && cur < u.end + log.offset)) n++;
      const label = !rows ? `${log.name}: no command list` : cur === null ? log.name : `${log.name}: ${n} running`;
      ctx.fillStyle = log.color;
      ctx.fillRect(x, y - 4, 8, 8);
      x += 13;
      ctx.fillStyle = rows ? pal.fg : pal.fg2;
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 18;
      if (x > width - 40) break;
    }
  }

  const top = lay.headH;
  lay.names.forEach((name, r) => {
    const y = top + r * lay.rowH;
    // what this command is doing at the cursor, in each log
    const states = lay.logs.map((log) => {
      const row = lay.byLog.get(log.id)?.get(name);
      const run = cur === null ? undefined : row?.runs.find((u) => cur >= u.start + log.offset && cur < u.end + log.offset);
      return { log, row, run };
    });
    const on = states.find((s) => s.run);
    let flash = 0;
    let flashColor = '';
    for (const s of states) {
      if (!s.run || cur === null) continue;
      const f = 1 - (cur - (s.run.start + s.log.offset)) / FLASH;
      if (f > flash) {
        flash = f;
        flashColor = s.log.color;
      }
    }

    // row background: tinted while running, flashing just after it started
    ctx.fillStyle = r % 2 ? pal.rowBg : pal.plotBg;
    ctx.fillRect(0, y, width, lay.rowH);
    if (hover.row === r) {
      ctx.fillStyle = pal.hoverBg;
      ctx.fillRect(0, y, width, lay.rowH);
    }
    if (on) {
      ctx.fillStyle = withAlpha(on.log.color, 0.16);
      ctx.fillRect(0, y, width, lay.rowH);
    }
    if (flash > 0) {
      ctx.fillStyle = withAlpha(flashColor, 0.42 * flash);
      ctx.fillRect(0, y, width, lay.rowH);
    }

    // runs: the one at the cursor in full color and outlined, the others dimmed
    states.forEach(({ log, row, run }, li) => {
      if (!row) return;
      const ly = y + 5 + li * LANE;
      row.runs.forEach((u, ui) => {
        const a = u.start + log.offset;
        const b = u.end + log.offset;
        if (b < t0 || a > t1) return;
        const xa = Math.max(x0, xOf(a));
        const xb = Math.min(x1, xOf(b));
        const w = Math.max(2, xb - xa);
        const now = u === run;
        ctx.fillStyle = now ? log.color : withAlpha(log.color, 0.4);
        ctx.fillRect(xa, ly, w, LANE - 2);
        if (now || hover.run === `${log.id}:${ui}`) {
          ctx.strokeStyle = pal.strong;
          ctx.lineWidth = 1;
          ctx.strokeRect(xa + 0.5, ly + 0.5, Math.max(1, w - 1), LANE - 3);
        }
      });
    });

    // name column: a bar in the log's color at the edge, bold name, how long this run has been going
    ctx.fillStyle = pal.bg2;
    ctx.fillRect(0, y, LABEL_W - 4, lay.rowH);
    if (hover.row === r) {
      ctx.fillStyle = pal.hoverBg;
      ctx.fillRect(0, y, LABEL_W - 4, lay.rowH);
    }
    if (on) {
      ctx.fillStyle = withAlpha(on.log.color, 0.24);
      ctx.fillRect(0, y, LABEL_W - 4, lay.rowH);
      ctx.fillStyle = on.log.color;
      ctx.fillRect(0, y, 4, lay.rowH);
    }
    if (flash > 0) {
      ctx.fillStyle = withAlpha(flashColor, 0.5 * flash);
      ctx.fillRect(0, y, LABEL_W - 4, lay.rowH);
    }
    const primary = states.map((s) => s.row).find(Boolean);
    const stat =
      on && cur !== null ? `running ${duration(cur - (on.run!.start + on.log.offset))}` : primary ? `${duration(primary.total)} · ${primary.runs.length}×` : '';
    ctx.font = on ? 'bold 10px ui-monospace, Menlo, monospace' : '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = on ? pal.strong : pal.fg2;
    ctx.fillText(stat, LABEL_W - 10, y + lay.rowH / 2);
    const statW = ctx.measureText(stat).width;
    ctx.font = on ? 'bold 12px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = on ? pal.strong : pal.fg;
    ctx.fillText(fitText(ctx, name, LABEL_W - 28 - statW), 12, y + lay.rowH / 2);
    // a thin line between rows
    ctx.fillStyle = pal.grid;
    ctx.fillRect(0, y + lay.rowH - 1, width, 1);
  });
  const bottom = top + lay.names.length * lay.rowH;
  drawTimeAxis(ctx, x0, x1, Math.min(bottom, height - AXIS_H), t0, t1, top);
  if (cur !== null && cur >= t0 && cur <= t1) drawCursor(ctx, xOf(cur), top, bottom, pal.cursor);
}
