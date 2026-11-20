/**
 * Statistics: histogram (overlaid per log) plus a metrics table for one
 * numeric field, filtered by visible range / selection / enabled / auto / teleop.
 */
import { useCallback, useMemo } from 'react';
import { panelStore, updatePanel, type StatsSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore } from '../state/time';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useSeriesTick } from '../lib/useSeries';
import { useSettledView } from '../lib/useSettled';
import { T } from '../lib/theme';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { computeStats, histogram, type Stats } from '@core/analyzers/stats';
import { formatValue } from '../lib/format';
import { formatTime } from '@core/alignment';
import { useFieldIndex } from '../lib/fields';
import { withAlpha } from '../lib/colors';
import { Toolbar, ToolSelect } from '../components/Toolbar';
import { PanelFieldStrip } from '../components/FieldStrip';
import { setCursor } from '../state/time';

/** Raw-time windows for a phase in one log. */
export function phaseWindows(log: LogEntry, phase: StatsSettings['phase'], view: [number, number], selection: [number, number] | null): [number, number][] {
  switch (phase) {
    case 'view':
      return [[view[0] - log.offset, view[1] - log.offset]];
    case 'selection':
      return selection ? [[selection[0] - log.offset, selection[1] - log.offset]] : [];
    case 'full':
      return [[log.startTs, log.endTs]];
    case 'enabled':
      return log.robotState.ranges.filter((r) => r.mode !== 'disabled').map((r) => [r.start, r.end]);
    case 'auto':
      return log.robotState.ranges.filter((r) => r.mode === 'auto').map((r) => [r.start, r.end]);
    case 'teleop':
      return log.robotState.ranges.filter((r) => r.mode === 'teleop').map((r) => [r.start, r.end]);
  }
}

export function statsOver(t: Float64Array, v: Float64Array, windows: [number, number][]): { stats: Stats | undefined; values: number[] } {
  const values: number[] = [];
  let agg: Stats | undefined;
  for (const [a, b] of windows) {
    const s = computeStats(t, v, a, b);
    if (!s) continue;
    for (let i = 0; i < t.length; i++) if (t[i] >= a && t[i] <= b && Number.isFinite(v[i])) values.push(v[i]);
    if (!agg) agg = { ...s };
    else {
      const n = agg.count + s.count;
      agg.mean = (agg.mean * agg.count + s.mean * s.count) / n;
      agg.timeMean = (agg.timeMean * agg.count + s.timeMean * s.count) / n;
      agg.count = n;
      if (s.min < agg.min) {
        agg.min = s.min;
        agg.minT = s.minT;
      }
      if (s.max > agg.max) {
        agg.max = s.max;
        agg.maxT = s.maxT;
      }
      agg.last = s.last;
    }
  }
  if (agg && windows.length > 1 && values.length) {
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
    agg.median = q(0.5);
    agg.p05 = q(0.05);
    agg.p95 = q(0.95);
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    agg.stdev = Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length);
  }
  return { stats: agg, values };
}

const STATIC_VIEW: [number, number] = [0, 0];

export function StatsPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as StatsSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  // The visible range only matters for the "Visible range" phase, and only once panning pauses.
  const settled = useSettledView();
  const view = settings.phase === 'view' ? settled : STATIC_VIEW;
  const selection = useStore(timeStore, (s) => (settings.phase === 'selection' ? s.selection : null));
  const fields = useFieldIndex();
  const tick = useSeriesTick();

  const rows = useMemo(() => {
    if (!settings.key) return [];
    return logs.map((log) => {
      const s = client.peekSeries(log.id, settings.key!);
      if (!s || s.kind !== 'number') return { log, stats: undefined, values: [] as number[] };
      const { stats, values } = statsOver(s.t, s.v, phaseWindows(log, settings.phase, view, selection));
      return { log, stats, values };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, settings.key, settings.phase, view, selection, tick]);

  const draw = useCallback(
    (dc: DrawContext) => {
      const { ctx, width, height } = dc;
      const all = rows.flatMap((r) => r.values);
      if (!all.length) return;
      let min = Infinity;
      let max = -Infinity;
      for (const v of all) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const hists = rows.map((r) => ({ log: r.log, h: histogram(r.values, settings.bins, min, max) }));
      const peak = Math.max(1, ...hists.flatMap((h) => h.h.counts));
      const x0 = 40;
      const x1 = width - 8;
      const y0 = 8;
      const y1 = height - 18;
      const bw = (x1 - x0) / settings.bins;
      hists.forEach((h, li) => {
        const n = hists.length;
        const sub = bw / n;
        h.h.counts.forEach((c, i) => {
          const bh = (c / peak) * (y1 - y0);
          ctx.fillStyle = withAlpha(h.log.color, 0.8);
          ctx.fillRect(x0 + i * bw + li * sub, y1 - bh, Math.max(1, sub - 1), bh);
        });
      });
      ctx.fillStyle = T().fg2;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const f = fields.get(settings.key ?? '');
      for (let i = 0; i <= 4; i++) {
        const v = min + ((max - min) * i) / 4;
        ctx.fillText(formatValue(v, f?.unit), x0 + ((x1 - x0) * i) / 4, y1 + 3);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(peak), x0 - 4, y0 + 4);
      ctx.fillText('0', x0 - 4, y1);
    },
    [rows, settings.bins, settings.key, fields],
  );
  const ref = useCanvas(draw, [], [rows, settings.bins]);

  const f = settings.key ? fields.get(settings.key) : undefined;
  const metric = (label: string, get: (s: Stats) => string, onClick?: (s: Stats, log: LogEntry) => void) => (
    <tr key={label}>
      <td>{label}</td>
      {rows.map((r) => (
        <td key={r.log.id} className={`mono${onClick ? ' link' : ''}`} onClick={() => r.stats && onClick?.(r.stats, r.log)}>
          {r.stats ? get(r.stats) : '—'}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="panel stats-panel">
      <PanelFieldStrip id={id} />
      <Toolbar>
        <ToolSelect
          value={settings.phase}
          onChange={(v) => updatePanel<StatsSettings>(id, { phase: v as StatsSettings['phase'] })}
          options={[
            ['view', 'Visible range'],
            ['selection', 'Selection'],
            ['enabled', 'Enabled'],
            ['auto', 'Autonomous'],
            ['teleop', 'Teleop'],
            ['full', 'Full log'],
          ]}
        />
        <ToolSelect
          value={String(settings.bins)}
          onChange={(v) => updatePanel<StatsSettings>(id, { bins: Number(v) })}
          options={[
            ['10', '10 bins'],
            ['30', '30 bins'],
            ['60', '60 bins'],
            ['100', '100 bins'],
          ]}
        />
      </Toolbar>
      {!settings.key ? (
        <div className="panel-placeholder">
          {settings.note ? (
            <div className="placeholder-note">
              {settings.note}
              <span className="hint">Drag a numeric field here or click “Field”.</span>
            </div>
          ) : (
            'Drag a numeric field here or click “Field”.'
          )}
        </div>
      ) : (
        <div className="stats-body">
          <div className="canvas-host hist">
            <canvas ref={ref} />
          </div>
          <div className="scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{f?.unit ? `Metric (${f.unit})` : 'Metric'}</th>
                  {rows.map((r) => (
                    <th key={r.log.id} style={{ color: r.log.color }}>
                      {r.log.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metric('Samples', (s) => String(s.count))}
                {metric(
                  'Min',
                  (s) => `${formatValue(s.min)} @ ${formatTime(s.minT + 0)}`,
                  (s, log) => setCursor(s.minT + log.offset),
                )}
                {metric(
                  'Max',
                  (s) => `${formatValue(s.max)} @ ${formatTime(s.maxT + 0)}`,
                  (s, log) => setCursor(s.maxT + log.offset),
                )}
                {metric('Mean', (s) => formatValue(s.mean))}
                {metric('Mean (time-weighted)', (s) => formatValue(s.timeMean))}
                {metric('Median', (s) => formatValue(s.median))}
                {metric('5th / 95th pct', (s) => `${formatValue(s.p05)} / ${formatValue(s.p95)}`)}
                {metric('Std dev', (s) => formatValue(s.stdev))}
                {metric('First / last', (s) => `${formatValue(s.first)} / ${formatValue(s.last)}`)}
              </tbody>
            </table>
            {rows.length > 1 && rows.every((r) => r.stats) && (
              <div className="hint">
                Δ mean ({rows[1].log.name} − {rows[0].log.name}): <b>{formatValue(rows[1].stats!.mean - rows[0].stats!.mean, f?.unit)}</b> · Δ min:{' '}
                <b>{formatValue(rows[1].stats!.min - rows[0].stats!.min, f?.unit)}</b>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
