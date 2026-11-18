/**
 * Commands: one row per command, with a bar whenever it ran. Reads the
 * command scheduler's list of running commands (normally
 * NT:/SmartDashboard/Scheduler/Names), or one true/false field per command
 * (see core/commands.ts). Rows that are running at the cursor are lit, and
 * clicking a bar jumps to where that run starts. With several logs each row
 * has one lane per log.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { panelStore, updatePanel, type CommandsSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore, setCursor } from '../state/time';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { useSeriesTick } from '../lib/useSeries';
import { commandsFromNames, commandsFromBooleans, detectCommandSources, type CommandRow, type CommandSource } from '@core/commands';
import type { FieldInfo } from '@core/log';
import { formatTime } from '@core/alignment';
import { T } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { drawCursor, drawTimeAxis, fitText } from '../lib/draw';
import { Toolbar, ToolButton, ToolSelect, ToolGroup } from '../components/Toolbar';
import { FieldPicker } from '../components/FieldPicker';
import { Icon } from '../components/Icon';
import { shortKey } from '../lib/fields';

/** Width of the command-name column: wider panels give long command names more room. */
const labelW = (width: number) => Math.round(Math.min(340, Math.max(220, width * 0.42)));
const AXIS_H = 20;
const LANE = 9;

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
      m.set(r.name, r);
      const at = r.runs[0].start + log.offset;
      if (!first.has(r.name) || at < first.get(r.name)!) first.set(r.name, at);
    }
    byLog.set(log.id, m);
  }
  const names = [...first.keys()].sort((a, b) => first.get(a)! - first.get(b)! || a.localeCompare(b));
  return { logs, names, byLog, rowH: Math.max(20, logs.length * LANE + 8), headH: logs.length * 16 + 8 };
}

export function CommandsPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as CommandsSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  useSeriesTick();
  const [picker, setPicker] = useState(false);
  const draw = useCallback((dc: DrawContext) => drawCommands(dc, id), [id]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore], [id]);
  const L = layout(settings);
  const height = L.headH + L.names.length * L.rowH + AXIS_H;
  const anySource = logs.some((l) => sourceFor(l, settings.sourceKey));
  const autoSource = logs.map((l) => sourceFor(l, undefined)).find(Boolean);
  const hostRef = useRef<HTMLDivElement>(null);

  // hit testing: tooltip on hover, jump on click
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
      if (x < labelW(r.width) || y < 0) return null;
      const row = Math.floor(y / lay.rowH);
      const name = lay.names[row];
      if (!name) return null;
      const lane = Math.floor((y - row * lay.rowH - 4) / LANE);
      const log = lay.logs[Math.max(0, Math.min(lay.logs.length - 1, lane))];
      const [t0, t1] = timeStore.get().view;
      const t = t0 + ((x - labelW(r.width)) / (r.width - labelW(r.width) - 8)) * (t1 - t0);
      const run = lay.byLog
        .get(log.id)
        ?.get(name)
        ?.runs.find((u) => t >= u.start + log.offset && t <= u.end + log.offset);
      return run ? { name, log, run } : null;
    };
    const onMove = (e: MouseEvent) => {
      const h = hit(e);
      el.style.cursor = h ? 'pointer' : 'default';
      el.title = h
        ? `${h.name} · ${h.log.name}\n${formatTime(h.run.start + h.log.offset)} to ${formatTime(h.run.end + h.log.offset)} (${(h.run.end - h.run.start).toFixed(2)} s${h.run.open ? ', still running when the log ended' : ''})\nClick to jump to its start`
        : '';
    };
    const onClick = (e: MouseEvent) => {
      const h = hit(e);
      if (h) setCursor(h.run.start + h.log.offset);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', onClick);
    };
  }, [ref, id]);

  return (
    <div className="panel commands-panel">
      <Toolbar>
        <ToolButton icon="plus" onClick={() => setPicker(true)} title="Choose the field that lists the running commands (a string array)">
          Source field
        </ToolButton>
        {settings.sourceKey ? (
          <ToolGroup className="chip">
            <span title={settings.sourceKey}>{shortKey(settings.sourceKey, 3)}</span>
            <button
              className="chip-btn"
              title="Go back to finding the commands automatically"
              onClick={() => updatePanel<CommandsSettings>(id, { sourceKey: undefined })}
            >
              <Icon name="close" size={10} />
            </button>
          </ToolGroup>
        ) : (
          autoSource && (
            <ToolGroup className="toolbar-note">
              <span title={autoSource.kind === 'names' ? autoSource.key : `${autoSource.keys.length} true/false fields under ${autoSource.prefix}`}>
                from {autoSource.kind === 'names' ? shortKey(autoSource.key, 2) : shortKey(autoSource.prefix, 2)}
              </span>
            </ToolGroup>
          )
        )}
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
            If the log keeps the list under another name, pick it with Source field.
          </div>
        </div>
      ) : (
        <div className="scroll commands-body">
          <div className="canvas-host" ref={hostRef} style={{ height, flex: 'none' }} data-testid="commands-chart" data-rows={L.names.length}>
            <canvas ref={ref} />
          </div>
        </div>
      )}
      {picker && (
        <FieldPicker
          title="Field that lists the running commands"
          filter={(f) => f.kind === 'string[]'}
          onClose={() => setPicker(false)}
          onPick={(key) => updatePanel<CommandsSettings>(id, { sourceKey: key })}
        />
      )}
    </div>
  );
}

function drawCommands(dc: DrawContext, id: string) {
  const { ctx, width, height } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as CommandsSettings | undefined;
  if (!settings) return;
  const lay = layout(settings);
  const time = timeStore.get();
  const [t0, t1] = time.view;
  const LABEL_W = labelW(width);
  const x0 = LABEL_W;
  const x1 = width - 8;
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  const cur = time.hover ?? time.cursor;

  // header: what is running at the cursor, per log
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';
  lay.logs.forEach((log, i) => {
    const y = 4 + i * 16 + 8;
    ctx.fillStyle = log.color;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, log.name, LABEL_W - 14), 8, y);
    const rows = lay.byLog.get(log.id);
    let text = 'no command list in this log';
    if (rows) {
      const running = cur === null ? [] : lay.names.filter((n) => rows.get(n)?.runs.some((u) => cur >= u.start + log.offset && cur < u.end + log.offset));
      text = cur === null ? 'set the cursor to see what is running' : running.length ? `running: ${running.join(', ')}` : 'nothing running';
    }
    ctx.fillStyle = rows ? pal.fg : pal.fg2;
    ctx.fillText(fitText(ctx, text, x1 - x0), x0, y);
  });

  const top = lay.headH;
  lay.names.forEach((name, r) => {
    const y = top + r * lay.rowH;
    ctx.fillStyle = r % 2 ? pal.rowBg : pal.plotBg;
    ctx.fillRect(0, y, width, lay.rowH);
    let active = false;
    lay.logs.forEach((log, li) => {
      const row = lay.byLog.get(log.id)?.get(name);
      if (!row) return;
      const ly = y + 4 + li * LANE;
      for (const u of row.runs) {
        const a = u.start + log.offset;
        const b = u.end + log.offset;
        if (b < t0 || a > t1) continue;
        const on = cur !== null && cur >= a && cur < b;
        if (on) active = true;
        const xa = Math.max(x0, xOf(a));
        const xb = Math.min(x1, xOf(b));
        ctx.fillStyle = on ? log.color : withAlpha(log.color, 0.62);
        ctx.fillRect(xa, ly, Math.max(1.5, xb - xa), LANE - 2);
      }
    });
    // label column
    ctx.fillStyle = pal.bg2;
    ctx.fillRect(0, y, LABEL_W - 4, lay.rowH);
    const primary = lay.logs.map((l) => lay.byLog.get(l.id)?.get(name)).find(Boolean);
    const stat = primary ? `${primary.total >= 100 ? primary.total.toFixed(0) : primary.total.toFixed(1)} s · ${primary.runs.length}×` : '';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.fg2;
    ctx.fillText(stat, LABEL_W - 10, y + lay.rowH / 2);
    const statW = ctx.measureText(stat).width;
    ctx.font = active ? 'bold 11px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = active ? pal.strong : pal.fg;
    ctx.fillText(fitText(ctx, name, LABEL_W - 26 - statW), 8, y + lay.rowH / 2);
  });
  const bottom = top + lay.names.length * lay.rowH;
  drawTimeAxis(ctx, x0, x1, Math.min(bottom, height - AXIS_H), t0, t1, top);
  if (cur !== null && cur >= t0 && cur <= t1) drawCursor(ctx, xOf(cur), top, bottom, pal.cursor);
}
