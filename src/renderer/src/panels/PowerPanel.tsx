/**
 * Power: what used the battery, by subsystem, and what caused each brownout.
 *
 * - Brownouts, each with the subsystems that were drawing at the dip and
 *   over the half second before it.
 * - Energy, average and peak current per subsystem, one column per log.
 * - A stacked current-by-subsystem chart that follows the timeline.
 * - The lowest voltage dips with who was drawing at each.
 * - Battery health: resistance estimated from the V-I slope, with a label
 *   per log so one battery can be followed across matches.
 * - The electrical summary and findings from the power report.
 *
 * Subsystems come from the log's robot profile (state/profiles.ts). With a
 * time selection, the subsystem numbers cover the selection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { panelStore, updatePanel, type PowerSettings } from '../state/panels';
import { sessionStore, setBrownoutThreshold, assignProfile, type LogEntry } from '../state/session';
import { setCursor, setView, timeStore } from '../state/time';
import { useStore } from '../state/store';
import { uiStore } from '../state/ui';
import { settingsStore } from '../state/settings';
import { profileStore, profileById, setBatteryLabel, removeBatteryRecord, UNASSIGNED_COLOR, type RobotProfile } from '../state/profiles';
import { formatTime, formatDuration } from '@core/alignment';
import type { PowerReport } from '@core/analyzers/power';
import { batteryRating, UNASSIGNED, type SubsystemReport, type SubsystemStat, type Draw } from '@core/analyzers/subsystems';
import { visibleIndexRange } from '@core/decimate';
import { ROLE_LABELS, type Role } from '@core/roles';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer, ToolGroup } from '../components/Toolbar';
import { Icon } from '../components/Icon';
import { severityColor, T } from '../lib/theme';
import { subsystemDefs, subsystemColor, subsystemName } from '../lib/power';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { drawCursor, drawTimeAxis, niceStep, formatTick } from '../lib/draw';
import { SUBSYSTEM_PREFIX } from '../worker/protocol';
import { withAlpha } from '../lib/colors';

function jump(t: number, log: LogEntry, span = 4) {
  const at = t + log.offset;
  setCursor(at);
  const [a, b] = timeStore.get().view;
  if (at < a || at > b) setView(at - span / 2, at + span / 2);
}

/** A value that only updates once it has stopped changing for `ms`. */
function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

const amps = (a: number) => (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + ' A';
const wh = (e: number) => (e >= 10 ? e.toFixed(1) : e.toFixed(2)) + ' Wh';
const pct = (s: number) => (Number.isFinite(s) ? `${(s * 100).toFixed(s < 0.1 ? 1 : 0)}%` : '');

export function PowerPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as PowerSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const threshold = useStore(sessionStore, (s) => s.brownoutThreshold);
  const profiles = useStore(profileStore, (s) => s.profiles);
  const batteryLabels = useStore(profileStore, (s) => s.batteryLabels);
  const history = useStore(profileStore, (s) => s.batteryHistory);
  useStore(settingsStore, (s) => s.theme);
  const selection = useDebounced(
    useStore(timeStore, (s) => s.selection),
    250,
  );
  const follow = settings.followSelection !== false;
  const useSel = follow && !!selection;

  // Subsystem numbers for the selection are asked for separately; the whole-log ones ride on each log.
  const [selReports, setSelReports] = useState<Record<string, SubsystemReport | null>>({});
  const defsKey = JSON.stringify(logs.map((l) => [l.id, l.offset, subsystemDefs(profileById(l.profileId)), l.subsystems ? 1 : 0]));
  useEffect(() => {
    if (!useSel || !selection) {
      setSelReports({});
      return;
    }
    let alive = true;
    void (async () => {
      const out: Record<string, SubsystemReport | null> = {};
      for (const l of sessionStore.get().logs.filter((x) => x.visible)) {
        const defs = subsystemDefs(profileById(l.profileId));
        if (!defs.length) continue;
        const r = await client.subsystems(l.id, defs, [selection[0] - l.offset, selection[1] - l.offset], false);
        out[l.id] = r.report;
      }
      if (alive) setSelReports(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSel, selection?.[0], selection?.[1], defsKey]);

  const reports = logs.map((l) => ({
    log: l,
    r: l.power,
    profile: profiles.find((p) => p.id === l.profileId) ?? profileById(l.profileId),
    sub: (useSel ? selReports[l.id] : undefined) ?? l.subsystems ?? null,
  }));
  const primaryProfile = reports[0]?.profile ?? profileById(undefined);
  const anySubsystems = reports.some((x) => x.profile.subsystems.length > 0);
  const openEditor = (profileId: string) => uiStore.set({ subsystemsFor: profileId });

  const row = (label: string, get: (r: PowerReport, log: LogEntry) => React.ReactNode, title?: string) => (
    <tr key={label} title={title}>
      <td>{label}</td>
      {reports.map(({ log, r }) => (
        <td key={log.id} className="mono">
          {get(r, log)}
        </td>
      ))}
    </tr>
  );
  const link = (t: number | undefined, log: LogEntry, text: string) =>
    t === undefined ? (
      '—'
    ) : (
      <span className="link" onClick={() => jump(t, log)}>
        {text}
      </span>
    );
  const v = (x?: number) => (x === undefined ? '—' : `${x.toFixed(2)} V`);

  const missing = new Map<Role, LogEntry[]>();
  for (const { log, r } of reports) for (const m of r.missing) missing.set(m as Role, [...(missing.get(m as Role) ?? []), log]);

  // Rows of the by-subsystem table: every subsystem name across the logs' profiles, biggest first in the primary log
  const subRows: { key: string; label: string }[] = [];
  for (const { profile } of reports)
    for (const s of profile.subsystems) if (!subRows.some((n) => n.key === s.name.toLowerCase())) subRows.push({ key: s.name.toLowerCase(), label: s.name });
  const primaryEnergy = (key: string) => reports[0]?.sub?.stats.find((s) => s.name.toLowerCase() === key)?.energyWh ?? -1;
  subRows.sort((a, b) => primaryEnergy(b.key) - primaryEnergy(a.key));

  const brownouts = reports.flatMap(({ log, sub, profile }) => (sub?.brownouts ?? []).map((b) => ({ log, b, profile })));
  const dips = reports.flatMap(({ log, sub, profile }) => (sub?.dips ?? []).slice(0, 5).map((d) => ({ log, d, profile })));
  const warnings = [...new Set(reports.flatMap(({ sub }) => sub?.warnings ?? []))];
  const labelsInUse = [...new Set(reports.map(({ log }) => batteryLabels[log.fileName]).filter(Boolean))];

  const drawList = (draws: Draw[], profile: RobotProfile, total?: number) =>
    draws.slice(0, 4).map((d) => (
      <span className="draw" key={d.id}>
        <i style={{ background: subsystemColor(profile, d.id) }} />
        {subsystemName(profile, d.id)} <b>{amps(d.amps)}</b>
        {total && total > 0 ? <span className="draw-pct"> {Math.round((d.amps / total) * 100)}%</span> : null}
      </span>
    ));

  return (
    <div className="panel power-panel">
      <Toolbar>
        <ToolButton icon="blocks" onClick={() => openEditor(primaryProfile.id)} title="Add subsystems and assign motors to them" testId="edit-subsystems">
          Subsystems
        </ToolButton>
        <ToolButton
          low
          active={follow}
          onClick={() => updatePanel<PowerSettings>(id, { followSelection: !follow })}
          title="When part of the timeline is selected (Shift-drag), report on that part only"
        >
          Follow selection
        </ToolButton>
        {profiles.length > 1 && reports[0] && (
          <ToolGroup low className="hdr-label">
            Robot
            <ToolSelect
              value={reports[0].profile.id}
              onChange={(pid) => void assignProfile(reports[0].log.id, pid)}
              options={profiles.map((p) => [p.id, p.name])}
              title={`Robot profile used for ${reports[0].log.name}. Other logs: Settings, Robot.`}
            />
          </ToolGroup>
        )}
        <ToolSpacer />
        <ToolGroup low className="hdr-label">
          Brownout at
          <ToolSelect
            value={String(threshold)}
            onChange={(x) => void setBrownoutThreshold(Number(x))}
            options={[
              ['6.3', '6.3 V (roboRIO 1)'],
              ['6.75', '6.75 V (roboRIO 2)'],
              ['7', '7.0 V'],
              ['7.5', '7.5 V'],
            ]}
          />
        </ToolGroup>
      </Toolbar>
      {logs.length === 0 ? (
        <div className="panel-placeholder">Open a log to see its power report.</div>
      ) : (
        <div className="scroll power-body">
          {useSel && selection && (
            <div className="range-note">
              Subsystem numbers cover the selection, {formatTime(selection[0])} to {formatTime(selection[1])}.{' '}
              <span className="link" onClick={() => timeStore.set({ selection: null })}>
                Clear selection
              </span>
            </div>
          )}

          <h4>
            <Icon name="bolt" size={13} /> Brownouts
          </h4>
          {reports.every(({ r }) => r.brownoutCount === 0 && !r.voltageKey && !r.brownoutKey) ? (
            <div className="hint" data-testid="brownouts-unknown">
              <Icon name="info" size={11} /> Not known: {reports.length > 1 ? 'these logs have' : 'this log has'} no battery voltage and no brownout flag. Log
              RobotController.getBatteryVoltage() and RobotController.isBrownedOut() (AdvantageKit does this by itself) to find brownouts and what caused them.
            </div>
          ) : reports.every(({ r }) => r.brownoutCount === 0) ? (
            <div className="hint">
              None.{' '}
              {reports.some(({ r }) => !r.voltageKey && !r.brownoutKey)
                ? 'At least one log has no battery voltage, so its brownouts are not known.'
                : `The battery stayed above ${threshold} V.`}
            </div>
          ) : !anySubsystems ? (
            <div className="hint">
              {reports.reduce((a, { r }) => a + r.brownoutCount, 0)} brownout(s). Set up subsystems to see what was drawing power at each one.
            </div>
          ) : (
            <div className="brownout-cards">
              {brownouts.map(({ log, b, profile }, i) => {
                const top = b.atDip[0];
                return (
                  <div className="brownout-card" key={`${log.id}-${i}`} data-testid="brownout-card">
                    <div className="bo-head">
                      <span className="log-bar" style={{ background: log.color }} />
                      <span className="link mono" onClick={() => jump(b.minT, log)} title="Jump to the lowest voltage">
                        {formatTime(b.minT + log.offset)}
                      </span>
                      <span style={{ color: log.color }}>{log.name}</span>
                      <span className="mono">
                        {b.minVoltage === undefined ? '' : `${b.minVoltage.toFixed(2)} V`} · {((b.end - b.start) * 1000).toFixed(0)} ms
                      </span>
                    </div>
                    {top ? (
                      <div className="bo-cause">
                        Biggest draw: <b style={{ color: subsystemColor(profile, top.id) }}>{subsystemName(profile, top.id)}</b>, {amps(top.amps)}
                        {b.totalAtDip ? ` of ${amps(b.totalAtDip)} (${Math.round((top.amps / b.totalAtDip) * 100)}%)` : ''}
                        {top.id === UNASSIGNED ? '. That current is not assigned to a subsystem yet.' : '.'}
                      </div>
                    ) : (
                      <div className="hint">No subsystem current at this moment.</div>
                    )}
                    <div className="bo-row">
                      <span className="bo-label">At the dip</span>
                      {drawList(b.atDip, profile, b.totalAtDip)}
                    </div>
                    <div className="bo-row">
                      <span className="bo-label">0.5 s before</span>
                      {drawList(b.before, profile)}
                    </div>
                  </div>
                );
              })}
              {reports.some(({ r, sub }) => r.brownoutCount > 0 && !sub) && <div className="hint">Working out the subsystem breakdown…</div>}
            </div>
          )}

          <h4>
            <Icon name="blocks" size={13} /> Power by subsystem
          </h4>
          {!anySubsystems ? (
            <div className="callout" data-testid="subsystems-empty">
              <div>
                Group your motors into subsystems to see which one used the most power, its highest current peaks, and what was drawing when the robot browned
                out.
              </div>
              <button className="btn primary" onClick={() => openEditor(primaryProfile.id)}>
                Set up subsystems
              </button>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table subsys-table" data-testid="subsystem-table">
                  <thead>
                    <tr>
                      <th>Subsystem</th>
                      {reports.map(({ log }) => (
                        <th key={log.id} style={{ color: log.color }}>
                          {log.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...subRows, ...(reports.some(({ sub }) => sub?.unassigned) ? [{ key: UNASSIGNED, label: 'Unassigned' }] : [])].map((rw) => (
                      <tr key={rw.key} data-subsystem={rw.label}>
                        <td>
                          <i
                            className="swatch"
                            style={{
                              background:
                                rw.key === UNASSIGNED
                                  ? UNASSIGNED_COLOR
                                  : (reports.map((x) => x.profile.subsystems.find((s) => s.name.toLowerCase() === rw.key)?.color).find(Boolean) ??
                                    UNASSIGNED_COLOR),
                            }}
                          />
                          {rw.label}
                        </td>
                        {reports.map(({ log, sub, profile }) => {
                          const st: SubsystemStat | null | undefined =
                            rw.key === UNASSIGNED ? sub?.unassigned : sub?.stats.find((s) => s.name.toLowerCase() === rw.key);
                          if (!sub)
                            return (
                              <td key={log.id} className="hint">
                                {profile.subsystems.length ? '…' : 'no subsystems in this profile'}
                              </td>
                            );
                          if (!st) return <td key={log.id}>—</td>;
                          const color = subsystemColor(profile, st.id);
                          return (
                            <td key={log.id} className="subsys-cell">
                              <div className="subsys-line">
                                <span className="mono">
                                  <b>{Number.isFinite(st.share) ? wh(st.energyWh) : amps(st.avgCurrent)}</b> {pct(st.share)}
                                </span>
                                <span className="bar">
                                  <span style={{ width: `${Number.isFinite(st.share) ? Math.max(1, st.share * 100) : 0}%`, background: color }} />
                                </span>
                              </div>
                              <div className="subsys-sub mono">
                                avg {amps(st.avgCurrent)} · peak{' '}
                                <span
                                  className="link"
                                  onClick={() => jump(st.peakT, log)}
                                  title={`Jump to this peak${st.peakVoltage === undefined ? '' : ` (battery at ${st.peakVoltage.toFixed(2)} V)`}`}
                                >
                                  {amps(st.peakCurrent)}
                                </span>
                                {st.missing.length > 0 && (
                                  <span className="warn-text" title={`Not in this log: ${st.missing.join(', ')}`}>
                                    {' '}
                                    <Icon name="warning" size={11} /> {st.missing.length} missing
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reports.some(({ sub }) => sub && !sub.hasData) && (
                <div className="hint">
                  <Icon name="warning" size={11} /> A log has none of the assigned channels or fields, so its subsystems read zero. Per-channel (PDH / PDP) or
                  per-motor supply current has to be in the log.
                </div>
              )}
              {warnings.map((w) => (
                <div className="hint warn-text" key={w}>
                  <Icon name="warning" size={11} /> {w}
                </div>
              ))}
              {reports.some(({ sub }) => sub?.voltageAssumed !== undefined && sub.hasData) && (
                <div className="hint" data-testid="voltage-assumed">
                  <Icon name="info" size={11} /> Battery voltage is not in {reports.length > 1 ? 'at least one log' : 'this log'}, so its energy is an estimate
                  at a steady {reports.find(({ sub }) => sub?.voltageAssumed !== undefined)?.sub?.voltageAssumed} V and the shares compare current only. Log
                  battery voltage (RobotController.getBatteryVoltage) for real numbers, voltage dips and brownout causes.
                </div>
              )}
              {reports.some(({ sub }) => sub && sub.hasData && sub.totalSource === 'none') && (
                <div className="hint" data-testid="total-unknown">
                  <Icon name="info" size={11} /> Total current is not in {reports.length > 1 ? 'at least one log' : 'this log'}, so the shares are of the motors
                  assigned here only. Anything without a logged current (often the drivetrain) is not counted.
                </div>
              )}
              <div className="hint">
                Energy is the sum of voltage × current over time. Averages are over the time the robot was enabled. “Unassigned” is the measured total minus
                everything assigned.
              </div>
              <SubsystemChart logIds={logs.map((l) => l.id).join(',')} />
            </>
          )}

          {anySubsystems && dips.length > 0 && (
            <>
              <h4>Lowest voltage dips</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Log</th>
                      <th>Time</th>
                      <th>Voltage</th>
                      <th>Total</th>
                      <th>Who was drawing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dips
                      .sort((a, b) => a.d.voltage - b.d.voltage)
                      .slice(0, 8)
                      .map(({ log, d, profile }, i) => (
                        <tr key={`${log.id}-${i}`} className="clickable" onClick={() => jump(d.t, log)}>
                          <td style={{ color: log.color }}>{log.name}</td>
                          <td className="mono">{formatTime(d.t + log.offset)}</td>
                          <td className="mono">{d.voltage.toFixed(2)} V</td>
                          <td className="mono">{d.total === undefined ? '—' : amps(d.total)}</td>
                          <td>{drawList(d.draws, profile, d.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h4>
            <Icon name="battery" size={13} /> Battery health
          </h4>
          <div className="table-wrap">
            <table className="data-table battery-table">
              <thead>
                <tr>
                  <th>Log</th>
                  <th>Battery label</th>
                  <th title="Estimated from how far the voltage drops as current rises: V = V0 − I·R. Includes wiring and connectors, so compare batteries on the same robot.">
                    Resistance
                  </th>
                  <th>Rating</th>
                  <th title="V0: the voltage the fit gives at zero current">Resting</th>
                  <th>Lowest</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(({ log, r }) => {
                  const rating = batteryRating(r.internalResistance);
                  return (
                    <tr key={log.id}>
                      <td style={{ color: log.color }}>{log.name}</td>
                      <td>
                        <input
                          className="tool-input battery-label"
                          placeholder="e.g. B7"
                          defaultValue={batteryLabels[log.fileName] ?? ''}
                          key={`${log.fileName}|${batteryLabels[log.fileName] ?? ''}`}
                          onBlur={(e) => setBatteryLabel(log.fileName, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          title="Which battery was in the robot. Labeled logs build a history for that battery."
                        />
                      </td>
                      <td className="mono">{r.internalResistance === undefined ? '—' : `${(r.internalResistance * 1000).toFixed(1)} mΩ`}</td>
                      <td>
                        <span className={`rating rating-${rating}`}>{rating === 'unknown' ? 'not enough data' : rating}</span>
                      </td>
                      <td className="mono">{r.restingVoltage === undefined ? '—' : `${r.restingVoltage.toFixed(2)} V`}</td>
                      <td className="mono">{link(r.minVoltageT, log, v(r.minVoltage))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hint">
            Resistance comes from the slope of voltage against current while the robot draws more than 15 A. As a rule of thumb for a match log: up to 18 mΩ
            good, up to 25 mΩ fair, above that weak. The number includes wiring, so judge a battery against others on the same robot.
          </div>
          {labelsInUse.map((label) => {
            const recs = history.filter((h) => h.label === label).sort((a, b) => (a.when ?? 0) - (b.when ?? 0));
            if (recs.length < 2) return null;
            return (
              <div key={label} className="battery-history">
                <div className="battery-history-title">
                  Battery {label}: {recs.length} labeled logs
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <tbody>
                      {recs.map((h) => (
                        <tr key={h.file}>
                          <td className="mono">{h.when ? new Date(h.when).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                          <td title={h.file}>{h.file.replace(/\.wpilog$/i, '')}</td>
                          <td className="mono">{h.milliohm === null ? '—' : `${h.milliohm.toFixed(1)} mΩ`}</td>
                          <td>
                            <span className={`rating rating-${batteryRating(h.milliohm === null ? undefined : h.milliohm / 1000)}`}>
                              {batteryRating(h.milliohm === null ? undefined : h.milliohm / 1000)}
                            </span>
                          </td>
                          <td className="mono">{h.minVoltage === null ? '—' : `low ${h.minVoltage.toFixed(2)} V`}</td>
                          <td>
                            <button className="chip-btn" title="Remove this entry from the battery's history" onClick={() => removeBatteryRecord(h.file)}>
                              <Icon name="close" size={10} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <h4>Electrical summary</h4>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {reports.map(({ log }) => (
                    <th key={log.id} style={{ color: log.color }}>
                      {log.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {row('Enabled time', (r) => formatDuration(r.enabledTime))}
                {row('Min voltage (enabled)', (r, log) => link(r.minVoltageT, log, v(r.minVoltage)), 'Click to jump to the minimum')}
                {row('Avg voltage (enabled)', (r) => v(r.avgVoltage))}
                {row('Start and end voltage', (r) => `${v(r.startVoltage)} / ${v(r.endVoltage)}`)}
                {row('Time below 8.5 V', (r) => formatDuration(r.timeBelowWarn))}
                {row(`Time below ${threshold} V`, (r) => formatDuration(r.timeBelowBrownout))}
                {row('Brownouts', (r, log) =>
                  r.brownoutCount === 0 ? (
                    '0'
                  ) : (
                    <span
                      className="link"
                      style={{ color: severityColor('error') }}
                      onClick={() => jump(r.findings.find((f) => f.severity === 'error')?.t ?? 0, log)}
                    >
                      {r.brownoutCount}
                      {r.brownoutsInferred ? ' (inferred)' : ''} · {formatDuration(r.brownoutDuration)}
                    </span>
                  ),
                )}
                {row('Peak current', (r, log) => link(r.peakCurrentT, log, r.peakCurrent === undefined ? '—' : `${r.peakCurrent.toFixed(0)} A`))}
                {row('Avg current', (r) => (r.avgCurrent === undefined ? '—' : `${r.avgCurrent.toFixed(1)} A`))}
                {row('Energy used', (r) => (r.energyWh === undefined ? '—' : `${r.energyWh.toFixed(1)} Wh`), 'Voltage × current, summed over the log')}
              </tbody>
            </table>
          </div>

          <h4>Findings</h4>
          <div className="findings">
            {reports.flatMap(({ log, r }) =>
              r.findings.map((f, i) => (
                <div key={`${log.id}-${i}`} className={`finding sev-${f.severity}`} onClick={() => jump(f.t, log)}>
                  <span className="log-bar" style={{ background: log.color }} />
                  <span className="mono time">{formatTime(f.t + log.offset)}</span>
                  <b>{f.title}</b>
                  <span className="detail">{f.detail}</span>
                </div>
              )),
            )}
            {reports.every(({ r }) => r.findings.length === 0) && <div className="hint">No power findings.</div>}
          </div>

          {missing.size > 0 && (
            <>
              <h4>Missing signals</h4>
              <div className="hint">
                {[...missing.entries()].map(([role, ls]) => (
                  <div key={role}>
                    <b>{ROLE_LABELS[role]}</b> not found in {ls.map((l) => l.name).join(', ')}. The “Log info &amp; health” panel shows how to log it.
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked current by subsystem, one lane per log, following the timeline

interface StackCache {
  t0: number;
  t1: number;
  w: number;
  src: unknown[];
  /** Cumulative amps per pixel column, one array per layer (bottom to top). */
  layers: Float32Array[];
  max: number;
}
const stackCaches = new Map<string, StackCache>();

function SubsystemChart({ logIds }: { logIds: string }) {
  const count = logIds ? logIds.split(',').length : 0;
  const draw = useCallback((dc: DrawContext) => drawStacks(dc), []);
  const ref = useCanvas(draw, [timeStore, sessionStore, profileStore], []);
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div className="canvas-host subsys-chart" ref={hostRef} style={{ height: Math.max(1, count) * 96 + 22 }} data-testid="subsystem-chart">
      <canvas ref={ref} />
    </div>
  );
}

function drawStacks(dc: DrawContext) {
  const { ctx, width, height } = dc;
  const pal = T();
  const session = sessionStore.get();
  const time = timeStore.get();
  const [t0, t1] = time.view;
  const logs = session.logs.filter((l) => l.visible);
  const LEFT = 44;
  const x0 = LEFT;
  const x1 = width - 8;
  const w = Math.max(1, Math.floor(x1 - x0));
  const AXIS = 20;
  const laneH = (height - AXIS) / Math.max(1, logs.length);
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  for (const id of [...stackCaches.keys()]) if (!logs.some((l) => l.id === id)) stackCaches.delete(id);

  logs.forEach((log, li) => {
    const top = li * laneH + 4;
    const bottom = (li + 1) * laneH - 4;
    ctx.fillStyle = pal.plotBg;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    const profile = profileById(log.profileId);
    const keys = log.fields.filter((f) => f.key.startsWith(SUBSYSTEM_PREFIX)).map((f) => f.key);
    // derived keys are in subsystem order, with Unassigned last when the total is known
    const colors = keys.map((_, i) => (i < profile.subsystems.length ? profile.subsystems[i].color : UNASSIGNED_COLOR));
    const series = keys.map((k) => client.peekSeries(log.id, k));
    ctx.fillStyle = log.color;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (!keys.length || series.some((s) => !s || s.kind !== 'number')) {
      ctx.fillStyle = pal.fg2;
      ctx.fillText(keys.length ? 'loading…' : `${log.name}: no subsystem current in this log`, x0 + 6, top + 6);
      return;
    }
    const num = series as { kind: 'number'; t: Float64Array; v: Float64Array }[];
    let c = stackCaches.get(log.id);
    if (!c || c.t0 !== t0 - log.offset || c.t1 !== t1 - log.offset || c.w !== w || c.src.length !== num.length || c.src.some((s, i) => s !== num[i])) {
      const t = num[0].t;
      const [ia, ib] = visibleIndexRange(t, log.offset, t0, t1);
      const layers = num.map(() => new Float32Array(w));
      const counts = new Uint32Array(w);
      const span = t1 - t0;
      for (let i = ia; i <= ib && i < t.length; i++) {
        const px = Math.floor(((t[i] + log.offset - t0) / span) * w);
        if (px < 0 || px >= w) continue;
        counts[px]++;
        for (let k = 0; k < num.length; k++) layers[k][px] += num[k].v[i] || 0;
      }
      // mean per column, holding the last value across empty columns, then stack
      let max = 0;
      for (let px = 0; px < w; px++) {
        let acc = 0;
        for (let k = 0; k < num.length; k++) {
          const val = counts[px] ? layers[k][px] / counts[px] : px > 0 ? layers[k][px - 1] - (k > 0 ? layers[k - 1][px - 1] : 0) : 0;
          acc += Math.max(0, val);
          layers[k][px] = acc;
        }
        if (acc > max) max = acc;
      }
      c = { t0: t0 - log.offset, t1: t1 - log.offset, w, src: num, layers, max };
      stackCaches.set(log.id, c);
    }
    const yMax = Math.max(10, niceStep(c.max, 2) * Math.ceil(c.max / niceStep(c.max, 2)));
    const yOf = (a: number) => bottom - (a / yMax) * (bottom - top);
    // layers, top one first so lower ones paint over it
    for (let k = c.layers.length - 1; k >= 0; k--) {
      ctx.fillStyle = withAlpha(colors[k], 0.85);
      ctx.beginPath();
      ctx.moveTo(x0, bottom);
      for (let px = 0; px < w; px++) ctx.lineTo(x0 + px, yOf(c.layers[k][px]));
      ctx.lineTo(x0 + w, bottom);
      ctx.closePath();
      ctx.fill();
    }
    // brownouts
    ctx.strokeStyle = pal.err;
    ctx.lineWidth = 1;
    for (const b of log.power.brownouts) {
      const x = xOf(b.start + log.offset);
      if (x < x0 || x > x1) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, top);
      ctx.lineTo(Math.round(x) + 0.5, bottom);
      ctx.stroke();
    }
    // axis
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = pal.fg2;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const a of [0, yMax / 2, yMax]) {
      ctx.fillText(formatTick(a), x0 - 4, Math.min(bottom - 5, Math.max(top + 5, yOf(a))));
      ctx.strokeStyle = pal.grid;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(yOf(a)) + 0.5);
      ctx.lineTo(x1, Math.round(yOf(a)) + 0.5);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '11px sans-serif';
    const label = `${log.name} · amps`;
    ctx.fillStyle = pal.legendBg;
    ctx.fillRect(x0 + 3, top + 2, ctx.measureText(label).width + 8, 15);
    ctx.fillStyle = log.color;
    ctx.fillText(label, x0 + 7, top + 4);
  });
  drawTimeAxis(ctx, x0, x1, height - AXIS, t0, t1, height - AXIS);
  const cur = time.hover ?? time.cursor;
  if (cur !== null && cur >= t0 && cur <= t1) drawCursor(ctx, xOf(cur), 0, height - AXIS, pal.cursor);
}
