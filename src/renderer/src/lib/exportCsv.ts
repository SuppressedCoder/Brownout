/** CSV export of the active panel's fields (or every graphed field) over the selection or visible range. */
import { toCsv, type CsvColumn } from '@core/csv';
import { grid } from '../components/Grid';
import { panelStore } from '../state/panels';
import { sessionStore } from '../state/session';
import { timeStore } from '../state/time';
import { client } from '../worker/client';
import { saveText } from './persist';

export async function exportCsv(): Promise<string> {
  const active = grid.activePanelId();
  const panels = panelStore.get().panels;
  let keys: string[] = [];
  const ps = active ? panels[active] : undefined;
  if (ps?.type === 'graph') keys = ps.series.map((s) => s.key);
  else if (ps?.type === 'table') keys = ps.keys;
  else if (ps?.type === 'stats' && ps.key) keys = [ps.key];
  if (!keys.length) {
    for (const [id, p] of Object.entries(panels)) {
      if (id.startsWith('view:') && sessionStore.get().view === 'panels') continue;
      if (p.type === 'graph') keys.push(...p.series.map((s) => s.key));
      if (p.type === 'table') keys.push(...p.keys);
    }
    keys = [...new Set(keys)];
  }
  if (!keys.length) return 'Nothing to export: add fields to a graph or table first.';
  const logs = sessionStore.get().logs.filter((l) => l.visible);
  const t = timeStore.get();
  const [t0, t1] = t.selection ?? t.view;
  const columns: CsvColumn[] = [];
  for (const log of logs) {
    for (const key of keys) {
      const s = await client.getSeries(log.id, key);
      if (!s) continue;
      const aligned = new Float64Array(s.t.length);
      for (let i = 0; i < s.t.length; i++) aligned[i] = s.t[i] + log.offset;
      const v = s.kind === 'boolean' ? Array.from(s.v, (b) => !!b) : (s.v as ArrayLike<unknown>);
      columns.push({ name: logs.length > 1 ? `${log.name}:${key}` : key, t: aligned, v });
    }
  }
  const csv = toCsv(columns, t0, t1);
  const name = `brownout-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  await saveText(name, csv, [{ name: 'CSV', extensions: ['csv'] }]);
  return `Exported ${columns.length} columns, ${csv.split('\n').length - 2} rows (${t.selection ? 'selection' : 'visible range'}).`;
}
