/**
 * Console & events: console output, DataLogManager messages, alerts and
 * point events from every open log, interleaved by aligned time and tagged
 * with the log's color. Filter text (prefix a word with ! to exclude).
 *
 * The list does not re-render as the cursor moves; the current row is
 * highlighted by toggling a class on the existing element.
 */
import { memo, useMemo, useRef } from 'react';
import { panelStore, updatePanel, type ConsoleSettings } from '../state/panels';
import { sessionStore } from '../state/session';
import { setCursor, setView, timeStore } from '../state/time';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { formatTime } from '@core/alignment';
import { EVENT_GLYPHS } from '../lib/colors';
import { severityColor, toneColor } from '../lib/theme';
import { useCursorEffect } from '../lib/useSettled';
import { Toolbar, ToolButton, ToolInput, ToolSpacer } from '../components/Toolbar';
import { Icon } from '../components/Icon';
import type { IconName } from '../lib/icons';

interface Row {
  t: number;
  color: string;
  logName: string;
  severity: 'error' | 'warning' | 'info';
  text: string;
  icon?: IconName;
  glyphColor?: string;
}

/** Explicit "jump to this line": moves the cursor and brings it into view. */
function jumpTo(t: number) {
  setCursor(t);
  const [a, b] = timeStore.get().view;
  if (t < a || t > b) setView(t - (b - a) / 2, t + (b - a) / 2);
}

const RowList = memo(function RowList({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={`console-row sev-${r.severity}`} onClick={() => jumpTo(r.t)} title={`${r.logName} · click to jump`}>
          <span className="log-bar" style={{ background: r.color }} />
          <span className="mono time">{formatTime(r.t, 3)}</span>
          <span className="glyph" style={{ color: r.glyphColor ?? severityColor(r.severity) }}>
            {r.icon ? (
              <Icon name={r.icon} size={12} />
            ) : r.severity === 'error' ? (
              <Icon name="error" size={12} />
            ) : r.severity === 'warning' ? (
              <Icon name="warning" size={12} />
            ) : null}
          </span>
          <span className="text">{r.text}</span>
        </div>
      ))}
    </>
  );
});

export function ConsolePanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as ConsoleSettings);
  const logs = useStore(sessionStore, (s) => s.logs);
  const potato = useStore(settingsStore, (s) => s.potato);
  const theme = useStore(settingsStore, (s) => s.theme);
  const listRef = useRef<HTMLDivElement>(null);
  const maxRows = potato ? 1000 : 5000;

  const { rows, total } = useMemo(() => {
    const out: Row[] = [];
    const words = settings.filter.split(/\s+/).filter(Boolean);
    const include = words.filter((w) => !w.startsWith('!')).map((w) => w.toLowerCase());
    const exclude = words.filter((w) => w.startsWith('!') && w.length > 1).map((w) => w.slice(1).toLowerCase());
    const pass = (text: string) => {
      const l = text.toLowerCase();
      return include.every((w) => l.includes(w)) && !exclude.some((w) => l.includes(w));
    };
    for (const log of logs) {
      if (!log.visible) continue;
      for (const c of log.console) {
        if (c.severity === 'error' && !settings.errors) continue;
        if (c.severity === 'warning' && !settings.warnings) continue;
        if (c.severity === 'info' && !settings.infos) continue;
        if (!pass(c.text)) continue;
        out.push({ t: c.t + log.offset, color: log.color, logName: log.name, severity: c.severity, text: c.text });
      }
      if (settings.events) {
        for (const e of log.events) {
          if (e.kind === 'error' || e.kind === 'warning' || e.kind === 'alert') continue; // already console lines
          if (!pass(e.text)) continue;
          const g = EVENT_GLYPHS[e.kind];
          out.push({
            t: e.t + log.offset,
            color: log.color,
            logName: log.name,
            severity: e.kind === 'brownout' ? 'error' : 'warning',
            text: e.text,
            icon: g.icon,
            glyphColor: toneColor(g.tone),
          });
        }
      }
    }
    out.sort((a, b) => a.t - b.t);
    return { rows: out.slice(0, maxRows), total: out.length };
    // theme: glyph colors are baked into the rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, settings, maxRows, theme]);

  // Highlight the last line at or before the cursor, without re-rendering the list.
  useCursorEffect(
    (cursor) => {
      const list = listRef.current;
      if (!list) return;
      list.querySelector('.console-row.current')?.classList.remove('current');
      if (cursor === null || !rows.length) return;
      let lo = 0;
      let hi = rows.length - 1;
      if (rows[0].t > cursor) return;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid].t <= cursor) lo = mid;
        else hi = mid - 1;
      }
      const el = list.children[lo] as HTMLElement | undefined;
      if (!el) return;
      el.classList.add('current');
      el.scrollIntoView({ block: 'nearest' });
    },
    150,
    [rows],
  );

  return (
    <div className="panel console-panel">
      <Toolbar>
        <ToolInput
          value={settings.filter}
          onChange={(v) => updatePanel<ConsoleSettings>(id, { filter: v })}
          placeholder="filter… (!word excludes)"
          width={200}
        />
        <ToolButton active={settings.errors} onClick={() => updatePanel<ConsoleSettings>(id, { errors: !settings.errors })}>
          <span style={{ color: severityColor('error') }}>
            <Icon name="error" size={12} />
          </span>{' '}
          Errors
        </ToolButton>
        <ToolButton active={settings.warnings} onClick={() => updatePanel<ConsoleSettings>(id, { warnings: !settings.warnings })}>
          <span style={{ color: severityColor('warning') }}>
            <Icon name="warning" size={12} />
          </span>{' '}
          Warnings
        </ToolButton>
        <ToolButton active={settings.infos} onClick={() => updatePanel<ConsoleSettings>(id, { infos: !settings.infos })}>
          Info
        </ToolButton>
        <ToolButton
          active={settings.events}
          onClick={() => updatePanel<ConsoleSettings>(id, { events: !settings.events })}
          title="Brownouts, reboots, loop overruns, disconnects"
        >
          Events
        </ToolButton>
        <ToolSpacer />
        <span className="toolbar-note">{total > rows.length ? `first ${rows.length} of ${total} lines · filter to narrow` : `${rows.length} lines`}</span>
      </Toolbar>
      <div className="scroll console-list" ref={listRef}>
        <RowList rows={rows} />
        {rows.length === 0 && <div className="hint">{logs.length ? 'No console output matches.' : 'Open a log to see its console output.'}</div>}
      </div>
    </div>
  );
}
