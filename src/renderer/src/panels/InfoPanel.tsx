/**
 * Log info & logging health: file facts, era, loggers, match info, metadata,
 * alignment anchors, role mapping (with overrides), and which recommended
 * signals are present or missing with how-to-log snippets.
 */
import { useState } from 'react';
import { panelStore, type InfoSettings } from '../state/panels';
import { sessionStore, setRoleOverride, setManualOffset, type LogEntry } from '../state/session';
import { useStore } from '../state/store';
import { formatDuration } from '@core/alignment';
import { fileSize } from '../lib/format';
import { ROLE_LABELS, type Role } from '@core/roles';
import { Toolbar, ToolSelect } from '../components/Toolbar';
import { Icon } from '../components/Icon';
import { GuideLink } from '../components/Guide';

export function InfoPanel({ id }: { id: string }) {
  useStore(panelStore, (s) => s.panels[id] as InfoSettings);
  const logs = useStore(sessionStore, (s) => s.logs);
  const [which, setWhich] = useState<string>('');
  const log = logs.find((l) => l.id === which) ?? logs[0];
  const [showHow, setShowHow] = useState<string | null>(null);
  const [showRoles, setShowRoles] = useState(false);

  if (!log) return <div className="panel-placeholder">Open a log to see its info.</div>;

  const rs = log.robotState;
  const fmt = (t?: number) => (t === undefined ? '—' : `${(t - log.startTs).toFixed(2)} s into log`);
  const missing = log.health.filter((h) => !h.present);
  const present = log.health.filter((h) => h.present);
  const wall = rs.epochOffset !== undefined ? new Date((log.startTs + rs.epochOffset) * 1000) : null;

  return (
    <div className="panel info-panel">
      <Toolbar>
        <ToolSelect value={log.id} onChange={setWhich} options={logs.map((l) => [l.id, l.name])} />
        <span className="toolbar-note" style={{ color: log.color }}>
          <Icon name="dot" size={12} />
        </span>
      </Toolbar>
      <div className="scroll info-body">
        <table className="kv">
          <tbody>
            <Row k="File" v={`${log.fileName} · ${fileSize(log.size)}`} />
            <Row
              k="Duration"
              v={`${formatDuration(log.endTs - log.startTs)} · ${log.recordCount.toLocaleString()} records · ${log.fields.filter((f) => !f.generated).length} entries${log.truncated ? ' · truncated tail' : ''}`}
            />
            {log.repairedTimestamps > 0 && (
              <Row
                k="Repaired times"
                v={`${log.repairedTimestamps.toLocaleString()} records had an impossible time stamp (usually values from a camera or coprocessor sent before its clock was synchronized). They are shown at the moment they were written to the log.`}
              />
            )}
            <Row k="Parsed in" v={`${log.loadMs.toFixed(0)} ms`} />
            <Row
              k="Era"
              v={log.era === '2027' ? '2027 (Systemcore / field-center frame)' : log.era === '2026' ? '≤2026 (roboRIO / blue-wall frame)' : 'unknown'}
            />
            <Row k="Loggers" v={log.loggers.join(', ') || '—'} />
            <Row k="Event / match" v={`${log.matchInfo.eventName ?? '—'} ${log.matchInfo.matchType ?? ''} ${log.matchInfo.matchNumber ?? ''}`.trim()} />
            <Row
              k="Alliance"
              v={log.matchInfo.alliance ? `${log.matchInfo.alliance} ${log.matchInfo.station ?? ''}${log.matchInfo.fmsAttached ? ' · FMS attached' : ''}` : '—'}
            />
            <Row k="Auto routine" v={log.autoRoutine ?? '—'} />
            <Row k="Wall clock" v={wall ? wall.toLocaleString() : '— (no systemTime / EpochTimeMicros)'} />
            <Row k="Robot state from" v={rs.source ? `${rs.source}${rs.modeSource ? ` + ${rs.modeSource}` : ''}` : 'not found — log DriverStation data'} />
            <Row k="First enable" v={fmt(rs.firstEnable)} />
            <Row k="Auto / teleop start" v={`${fmt(rs.autoStart)} / ${fmt(rs.teleopStart)}`} />
            <Row
              k="Alignment offset"
              v={
                <span>
                  {log.offset.toFixed(3)} s{' '}
                  <input
                    className="tool-input"
                    style={{ width: 80 }}
                    type="number"
                    step="0.1"
                    value={log.manualOffset}
                    onChange={(e) => setManualOffset(log.id, Number(e.target.value) || 0)}
                    title="Manual nudge (seconds), added to the alignment anchor"
                  />{' '}
                  nudge
                </span>
              }
            />
          </tbody>
        </table>

        {Object.keys(log.metadata).length > 0 && (
          <>
            <h4>Metadata &amp; versions</h4>
            <table className="kv">
              <tbody>
                {Object.entries(log.metadata).map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </tbody>
            </table>
          </>
        )}

        <h4>
          Logging health · {present.length}/{log.health.length} recommended signals
        </h4>
        <GuideLink section="8-the-panels-what-each-is-for-what-it-needs-how-to-use-it">What each panel needs, and the code to log it</GuideLink>
        <div className="health">
          {log.health.map((h) => (
            <div key={h.role} className={`health-item ${h.present ? 'ok' : 'missing'}`}>
              <span className="mark">
                <Icon name={h.present ? 'check' : 'close'} size={12} />
              </span>
              <span className="label">{ROLE_LABELS[h.role]}</span>
              <span className="key mono">{h.key ?? h.why}</span>
              {!h.present && (
                <button className="chip-btn" onClick={() => setShowHow(showHow === h.role ? null : h.role)}>
                  how to log
                </button>
              )}
              {showHow === h.role && <pre className="howto">{h.howTo}</pre>}
            </div>
          ))}
          {missing.length === 0 && <div className="hint">All recommended signals present.</div>}
        </div>

        <h4 className="clickable" onClick={() => setShowRoles(!showRoles)}>
          <Icon name={showRoles ? 'chevronDown' : 'chevronRight'} size={10} /> Field names (role mapping, saved in the robot profile)
        </h4>
        {showRoles && (
          <table className="kv">
            <tbody>
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <tr key={role}>
                  <th>{ROLE_LABELS[role]}</th>
                  <td>
                    <RoleSelect log={log} role={role} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <th>{k}</th>
      <td>{v}</td>
    </tr>
  );
}

function RoleSelect({ log, role }: { log: LogEntry; role: Role }) {
  const candidates = log.roleCandidates[role] ?? [];
  const current = log.roles[role] ?? '';
  const [custom, setCustom] = useState(false);
  if (custom)
    return (
      <input
        className="tool-input"
        placeholder="exact field key"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void setRoleOverride(log.id, role, (e.target as HTMLInputElement).value || undefined);
            setCustom(false);
          }
          if (e.key === 'Escape') setCustom(false);
        }}
      />
    );
  return (
    <select
      className="tool-select"
      value={current}
      onChange={(e) => {
        if (e.target.value === '__custom') setCustom(true);
        else void setRoleOverride(log.id, role, e.target.value || undefined);
      }}
    >
      <option value="">— not found —</option>
      {candidates.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {current && !candidates.includes(current) && <option value={current}>{current}</option>}
      <option value="__custom">Other key…</option>
    </select>
  );
}
