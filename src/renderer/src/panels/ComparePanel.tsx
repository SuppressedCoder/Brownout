/**
 * Compare matches: one row per log, columns of match info and key metrics
 * (power, loop overruns, errors, path error), plus any numeric field the user
 * drops in (min / mean / max over the chosen phase). Click a column to sort.
 */
import { useMemo, useState } from 'react';
import { panelStore, updatePanel, type CompareSettings } from '../state/panels';
import { sessionStore, makePrimary, type LogEntry } from '../state/session';
import { setCursor, setView } from '../state/time';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useSeriesTick } from '../lib/useSeries';
import { formatDuration } from '@core/alignment';
import { formatValue } from '../lib/format';
import { shortKey, useFieldIndex } from '../lib/fields';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer } from '../components/Toolbar';
import { FieldPicker } from '../components/FieldPicker';
import { phaseWindows, statsOver } from './StatsPanel';
import { Icon } from '../components/Icon';

const NO_VIEW: [number, number] = [0, 0];

interface Col {
  id: string;
  label: string;
  value: (log: LogEntry) => number | string | undefined;
  format?: (v: number | string | undefined) => string;
  onClick?: (log: LogEntry) => void;
  title?: string;
}

export function ComparePanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as CompareSettings);
  const logs = useStore(sessionStore, (s) => s.logs);
  const fields = useFieldIndex();
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [picker, setPicker] = useState(false);
  const tick = useSeriesTick();

  const cols = useMemo((): Col[] => {
    const jumpTo = (log: LogEntry, t?: number) => {
      if (t === undefined) return;
      const at = t + log.offset;
      setCursor(at);
      setView(at - 2, at + 2);
    };
    const base: Col[] = [
      { id: 'event', label: 'Event', value: (l) => l.matchInfo.eventName ?? '' },
      {
        id: 'match',
        label: 'Match',
        value: (l) => (l.matchInfo.matchNumber !== undefined ? `${(l.matchInfo.matchType ?? '').slice(0, 1)}${l.matchInfo.matchNumber}` : ''),
      },
      { id: 'alliance', label: 'Alliance', value: (l) => (l.matchInfo.alliance ? `${l.matchInfo.alliance} ${l.matchInfo.station ?? ''}` : '') },
      { id: 'auto', label: 'Auto', value: (l) => l.autoRoutine ?? '' },
      { id: 'git', label: 'Code', value: (l) => (l.metadata.GitSHA ?? l.metadata.gitSha ?? '').slice(0, 7) },
      { id: 'enabled', label: 'Enabled', value: (l) => l.power.enabledTime, format: (v) => formatDuration(v as number) },
      {
        id: 'minv',
        label: 'Min V',
        value: (l) => l.power.minVoltage,
        format: (v) => (v === undefined ? '—' : `${(v as number).toFixed(2)}`),
        onClick: (l) => jumpTo(l, l.power.minVoltageT),
      },
      { id: 'avgv', label: 'Avg V', value: (l) => l.power.avgVoltage, format: (v) => (v === undefined ? '—' : `${(v as number).toFixed(2)}`) },
      { id: 'bo', label: 'Brownouts', value: (l) => l.power.brownoutCount, onClick: (l) => jumpTo(l, l.power.findings.find((f) => f.severity === 'error')?.t) },
      {
        id: 'peak',
        label: 'Peak A',
        value: (l) => l.power.peakCurrent,
        format: (v) => (v === undefined ? '—' : `${(v as number).toFixed(0)}`),
        onClick: (l) => jumpTo(l, l.power.peakCurrentT),
      },
      { id: 'wh', label: 'Wh', value: (l) => l.power.energyWh, format: (v) => (v === undefined ? '—' : `${(v as number).toFixed(1)}`) },
      {
        id: 'rint',
        label: 'R int',
        value: (l) => l.power.internalResistance,
        format: (v) => (v === undefined ? '—' : `${((v as number) * 1000).toFixed(0)} mΩ`),
      },
      {
        id: 'overruns',
        label: 'Overruns',
        value: (l) => l.events.filter((e) => e.kind === 'overrun').length,
        onClick: (l) => jumpTo(l, l.events.find((e) => e.kind === 'overrun')?.t),
      },
      {
        id: 'errors',
        label: 'Errors',
        value: (l) => l.console.filter((c) => c.severity === 'error').length,
        onClick: (l) => jumpTo(l, l.console.find((c) => c.severity === 'error')?.t),
      },
      {
        id: 'patherr',
        label: 'Path max err',
        value: (l) => (l.pathSegments.length ? Math.max(...l.pathSegments.map((s) => s.maxPosError ?? 0)) : undefined),
        format: (v) => (v === undefined ? '—' : `${((v as number) * 100).toFixed(1)} cm`),
      },
      {
        id: 'enderr',
        label: 'Path end err',
        value: (l) => (l.pathSegments.length ? Math.max(...l.pathSegments.map((s) => s.endPosError ?? 0)) : undefined),
        format: (v) => (v === undefined ? '—' : `${((v as number) * 100).toFixed(1)} cm`),
      },
    ];
    for (const key of settings.keys) {
      const f = fields.get(key);
      const st = (l: LogEntry) => {
        const s = client.peekSeries(l.id, key);
        if (!s || s.kind !== 'number') return undefined;
        return statsOver(s.t, s.v, phaseWindows(l, settings.phase, NO_VIEW, null)).stats;
      };
      const fmt = (v: number | string | undefined) => (v === undefined ? '—' : formatValue(v, f?.unit));
      base.push(
        { id: `${key}:min`, label: `${shortKey(key)} min`, value: (l) => st(l)?.min, format: fmt, onClick: (l) => jumpTo(l, st(l)?.minT), title: key },
        { id: `${key}:mean`, label: `${shortKey(key)} mean`, value: (l) => st(l)?.mean, format: fmt, title: key },
        { id: `${key}:max`, label: `${shortKey(key)} max`, value: (l) => st(l)?.max, format: fmt, onClick: (l) => jumpTo(l, st(l)?.maxT), title: key },
      );
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.keys, settings.phase, fields, tick]);

  const rows = useMemo(() => {
    const r = logs.map((log) => ({ log, values: cols.map((c) => c.value(log)) }));
    if (sort) {
      const ci = cols.findIndex((c) => c.id === sort.id);
      r.sort((a, b) => {
        const x = a.values[ci];
        const y = b.values[ci];
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return r;
  }, [logs, cols, sort]);

  // Spread row: numeric columns' max − min across logs
  const spread = cols.map((c, i) => {
    const nums = rows.map((r) => r.values[i]).filter((v): v is number => typeof v === 'number');
    return nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : undefined;
  });

  return (
    <div className="panel compare-panel">
      <Toolbar>
        <ToolButton onClick={() => setPicker(true)} title="Add min/mean/max columns for a numeric field">
          + Metric field
        </ToolButton>
        <ToolSelect
          value={settings.phase}
          onChange={(v) => updatePanel<CompareSettings>(id, { phase: v as CompareSettings['phase'] })}
          options={[
            ['enabled', 'Enabled'],
            ['auto', 'Auto'],
            ['teleop', 'Teleop'],
            ['full', 'Full log'],
          ]}
          title="Phase for added metric fields"
        />
        <ToolSpacer />
        {settings.keys.map((k) => (
          <span className="chip" key={k} title={k}>
            {shortKey(k)}
            <button className="chip-btn" onClick={() => updatePanel<CompareSettings>(id, { keys: settings.keys.filter((x) => x !== k) })}>
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
      </Toolbar>
      {logs.length === 0 ? (
        <div className="panel-placeholder">Open two or more logs to compare them.</div>
      ) : (
        <div className="scroll">
          <table className="data-table compare">
            <thead>
              <tr>
                <th>Log</th>
                {cols.map((c) => (
                  <th
                    key={c.id}
                    className="sortable"
                    title={c.title ?? 'Click to sort'}
                    onClick={() => setSort((s) => (s?.id === c.id ? { id: c.id, dir: s.dir === 1 ? -1 : 1 } : { id: c.id, dir: 1 }))}
                  >
                    {c.label}
                    {sort?.id === c.id ? <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} size={10} /> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, values }) => (
                <tr key={log.id}>
                  <td
                    style={{ color: log.color, whiteSpace: 'nowrap' }}
                    className="clickable"
                    title="Make this the primary log (alignment reference)"
                    onClick={() => makePrimary(log.id)}
                  >
                    {log.name}
                    {logs[0]?.id === log.id ? <Icon name="starFilled" size={10} className="primary-star" /> : null}
                  </td>
                  {cols.map((c, i) => (
                    <td key={c.id} className={`mono${c.onClick ? ' link' : ''}`} onClick={() => c.onClick?.(log)}>
                      {c.format ? c.format(values[i]) : values[i] === undefined ? '—' : String(values[i])}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="spread">
                  <td>Spread</td>
                  {cols.map((c, i) => (
                    <td key={c.id} className="mono">
                      {spread[i] === undefined ? '' : c.format ? c.format(spread[i]) : String(spread[i])}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {picker && (
        <FieldPicker
          filter={(f) => f.kind === 'number'}
          onClose={() => setPicker(false)}
          onPick={(key) => !settings.keys.includes(key) && updatePanel<CompareSettings>(id, { keys: [...settings.keys, key] })}
        />
      )}
    </div>
  );
}
