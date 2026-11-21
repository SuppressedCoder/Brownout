/**
 * Table: one row per value change within the visible range (columns per
 * key × log), or the values at the cursor (rows per key, columns per log).
 *
 * The change list recomputes only after panning/zooming pauses, and the
 * current row is highlighted without re-rendering the table.
 */
import { memo, useMemo, useRef } from 'react';
import { panelStore, updatePanel, type TableSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore, setCursor } from '../state/time';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useSeriesTick } from '../lib/useSeries';
import { useSettledView, useCursorEffect } from '../lib/useSettled';
import { formatValue } from '../lib/format';
import { formatTime } from '@core/alignment';
import { indexAtOrBefore, type Series } from '@core/log';
import { useFieldIndex, shortKey, type MergedField } from '../lib/fields';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer } from '../components/Toolbar';
import { PanelFieldStrip } from '../components/FieldStrip';
import { Icon } from '../components/Icon';

interface Col {
  key: string;
  log: LogEntry;
  series: Series | null | undefined;
}

function valueAt(c: Col, t: number, fields: Map<string, MergedField>): string {
  if (!c.series) return c.series === null ? '—' : '…';
  const i = indexAtOrBefore(c.series.t, t - c.log.offset);
  if (i < 0) return '';
  const v = c.series.kind === 'boolean' ? !!c.series.v[i] : c.series.v[i];
  return formatValue(v, fields.get(c.key)?.unit);
}

const ChangeRows = memo(function ChangeRows({ rows, cols, fields }: { rows: number[]; cols: Col[]; fields: Map<string, MergedField> }) {
  return (
    <>
      {rows.map((t) => (
        <tr key={t} onClick={() => setCursor(t)}>
          <td className="mono">{formatTime(t, 3)}</td>
          {cols.map((c, i) => (
            <td key={i} className="mono">
              {valueAt(c, t, fields)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
});

export function TablePanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as TableSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const potato = useStore(settingsStore, (s) => s.potato);
  const view = useSettledView();
  const fields = useFieldIndex();
  const tick = useSeriesTick();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const maxRows = potato ? 500 : 2000;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cols = useMemo<Col[]>(
    () => settings.keys.flatMap((key) => logs.map((log) => ({ key, log, series: client.peekSeries(log.id, key) }))),
    [settings.keys, logs, tick],
  );

  const rows = useMemo(() => {
    if (settings.mode === 'cursor') return [];
    const times = new Set<number>();
    for (const c of cols) {
      if (!c.series) continue;
      const s = c.series;
      const i0 = Math.max(0, indexAtOrBefore(s.t, view[0] - c.log.offset));
      for (let i = i0; i < s.t.length; i++) {
        const t = s.t[i] + c.log.offset;
        if (t > view[1]) break;
        times.add(Math.round(t * 1e6) / 1e6);
        if (times.size > maxRows * 4) break;
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const step = sorted.length > maxRows ? Math.ceil(sorted.length / maxRows) : 1;
    return sorted.filter((_, i) => i % step === 0);
  }, [cols, view, settings.mode, maxRows]);

  useCursorEffect(
    (cursor) => {
      const body = bodyRef.current;
      if (!body) return;
      body.querySelector('tr.current')?.classList.remove('current');
      if (cursor === null || !rows.length || rows[0] > cursor) return;
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid] <= cursor) lo = mid;
        else hi = mid - 1;
      }
      (body.children[lo] as HTMLElement | undefined)?.classList.add('current');
    },
    100,
    [rows, settings.mode],
  );

  return (
    <div className="panel table-panel">
      <PanelFieldStrip id={id} />
      <Toolbar>
        <ToolSelect
          value={settings.mode}
          onChange={(v) => updatePanel<TableSettings>(id, { mode: v as TableSettings['mode'] })}
          options={[
            ['changes', 'Rows per change (visible range)'],
            ['cursor', 'Values at cursor'],
          ]}
        />
        <ToolSpacer />
        {settings.keys.length > 0 && <ToolButton onClick={() => updatePanel<TableSettings>(id, { keys: [] })}>Clear</ToolButton>}
      </Toolbar>
      {settings.keys.length === 0 ? (
        <div className="panel-placeholder" />
      ) : settings.mode === 'cursor' ? (
        <CursorTable id={id} keys={settings.keys} logs={logs} cols={cols} fields={fields} />
      ) : (
        <div className="scroll">
          <table className="data-table sticky">
            <thead>
              <tr>
                <th>Time</th>
                {cols.map((c, i) => (
                  <th key={i} style={{ color: c.log.color }} title={`${c.log.name}: ${c.key}`}>
                    {logs.length > 1 ? `${c.log.name} · ` : ''}
                    {shortKey(c.key)}
                    {i % logs.length === logs.length - 1 && (
                      <button className="chip-btn" onClick={() => updatePanel<TableSettings>(id, { keys: settings.keys.filter((k) => k !== c.key) })}>
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              <ChangeRows rows={rows} cols={cols} fields={fields} />
            </tbody>
          </table>
          {rows.length === 0 && <div className="hint">No value changes in the visible range.</div>}
        </div>
      )}
    </div>
  );
}

/** Values at the cursor. Small (one row per field), so it simply follows the cursor. */
function CursorTable({ id, keys, logs, cols, fields }: { id: string; keys: string[]; logs: LogEntry[]; cols: Col[]; fields: Map<string, MergedField> }) {
  const cursor = useStore(timeStore, (s) => s.cursor);
  return (
    <div className="scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Field</th>
            {logs.map((l) => (
              <th key={l.id} style={{ color: l.color }}>
                {l.name}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td title={key}>{shortKey(key, 3)}</td>
              {logs.map((l) => {
                const c = cols.find((x) => x.key === key && x.log.id === l.id);
                return (
                  <td key={l.id} className="mono">
                    {cursor === null || !c ? '—' : valueAt(c, cursor, fields)}
                  </td>
                );
              })}
              <td>
                <button className="chip-btn" onClick={() => updatePanel<TableSettings>(id, { keys: keys.filter((k) => k !== key) })}>
                  <Icon name="close" size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor === null && <div className="hint">Click the timeline to set the cursor.</div>}
    </div>
  );
}
