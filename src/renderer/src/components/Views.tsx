/**
 * The two purpose-built views next to the panel grid (header switch, Ctrl+1/2/3):
 *
 * - Video review: one log's match video and its 2D field side by side, at the
 *   same height (both are wide: 16:9 and about 2:1, so side by side is what
 *   fits a laptop), and below them the moments worth checking: where the
 *   robot position jumped or a camera disagreed with it, brownouts and
 *   connection losses. Click one to go there.
 * - Power: the battery and current graph across the top, the power report
 *   (who used the energy, what caused each brownout) below it.
 *
 * The views' panels are ordinary panels kept outside the grid (ids starting
 * with "view:"), so they work exactly like their grid versions and are never
 * saved into layouts or presets. The timeline stays below every view.
 */
import { useEffect } from 'react';
import { sessionStore, type LogEntry } from '../state/session';
import { panelStore, ensurePanel, updatePanel, VIEW_PANEL_PREFIX, type VideoSettings, type FieldSettings, type GraphSettings } from '../state/panels';
import { useStore } from '../state/store';
import { gotoTime } from '../state/time';
import { StandalonePanel } from './Grid';
import { Icon } from './Icon';
import { EVENT_GLYPHS } from '../lib/colors';
import { toneColor } from '../lib/theme';
import { batteryGraph } from '../lib/presets';
import { matchClock } from '@core/report';
import type { PointEvent } from '@core/analyzers/events';

const VIDEO = `${VIEW_PANEL_PREFIX}video`;
const FIELD = `${VIEW_PANEL_PREFIX}field`;
const BATTERY = `${VIEW_PANEL_PREFIX}battery`;
const POWER = `${VIEW_PANEL_PREFIX}power`;

/** The kinds of moment the Video review lists: things a video can confirm. */
const REVIEW_KINDS: PointEvent['kind'][] = ['vision', 'brownout', 'disconnect', 'reboot'];

export function VideoReview() {
  const logs = useStore(sessionStore, (s) => s.logs);
  const ready = useStore(panelStore, (s) => !!s.panels[VIDEO] && !!s.panels[FIELD]);
  const logId = useStore(panelStore, (s) => (s.panels[VIDEO] as VideoSettings | undefined)?.logId);
  const fieldSource = useStore(panelStore, (s) => (s.panels[FIELD] as FieldSettings | undefined)?.source);
  const log = logs.find((l) => l.id === logId) ?? logs[0];
  useEffect(() => {
    ensurePanel(VIDEO, 'video');
    ensurePanel(FIELD, 'field', { trailSeconds: 5 } as Partial<FieldSettings>);
  }, []);
  // the field shows the log whose video this is
  useEffect(() => {
    if (ready && log && fieldSource !== log.id) updatePanel<FieldSettings>(FIELD, { source: log.id });
  }, [ready, log?.id, fieldSource]);
  if (!logs.length)
    return (
      <div className="view-empty" data-testid="video-review">
        Open a log to review its match video next to the field.
      </div>
    );
  if (!ready) return null;
  return (
    <div className="app-view video-review" data-testid="video-review">
      <div className="vr-main">
        <StandalonePanel id={VIDEO} />
        <StandalonePanel id={FIELD} />
      </div>
      {log && <Moments log={log} />}
    </div>
  );
}

/** The moments of one log worth checking against the video, in match order. */
function Moments({ log }: { log: LogEntry }) {
  const items = log.events.filter((e) => REVIEW_KINDS.includes(e.kind));
  const hasPose = !!log.roles.robotPose;
  const hasEstimates = (log.cameras ?? []).some((c) => c.meanError !== undefined);
  const lacking = !hasPose
    ? 'This log has no robot pose, so Brownout cannot check the position against vision.'
    : !hasEstimates
      ? 'No camera in this log logs a pose estimate, so only position jumps are checked. Drop each camera’s estimate field on the field in Robot setup to compare them.'
      : '';
  return (
    <div className="vr-moments" data-testid="video-review-moments">
      <div className="vr-moments-head">
        <strong>Moments to check</strong>
        <span className="hint">
          {log.name}: where the position jumped or a camera disagreed with it, brownouts, connection losses and restarts. Click one to go there.
        </span>
      </div>
      <div className="vr-list scroll">
        {items.map((e, i) => {
          const g = EVENT_GLYPHS[e.kind];
          return (
            <button key={i} className="vr-item" onClick={() => gotoTime(e.t + log.offset)} title="Go to this moment" data-testid="video-review-item">
              <Icon name={g.icon} size={13} className="vr-icon" />
              <span className="mono vr-when" style={{ color: toneColor(g.tone) }}>
                {matchClock(log.robotState, e.t)}
              </span>
              <span className="vr-text">{e.text}</span>
            </button>
          );
        })}
        {!items.length && (
          <div className="hint vr-none">{lacking || 'Nothing found: no position jumps, camera disagreements, brownouts or connection losses.'}</div>
        )}
        {items.length > 0 && lacking && <div className="hint vr-none">{lacking}</div>}
      </div>
    </div>
  );
}

export function PowerView() {
  const primary = useStore(sessionStore, (s) => s.logs[0]);
  const ready = useStore(panelStore, (s) => !!s.panels[BATTERY] && !!s.panels[POWER]);
  const empty = useStore(panelStore, (s) => ((s.panels[BATTERY] as GraphSettings | undefined)?.series.length ?? 0) === 0);
  useEffect(() => {
    ensurePanel(POWER, 'power');
    ensurePanel(BATTERY, 'graph', batteryGraph(sessionStore.get().logs[0]).settings);
  }, []);
  // the graph was set up before a log was open: fill it now
  useEffect(() => {
    if (ready && empty && primary) updatePanel<GraphSettings>(BATTERY, batteryGraph(primary).settings);
  }, [ready, empty, primary?.id]);
  if (!primary)
    return (
      <div className="view-empty" data-testid="power-view">
        Open a log to see what used the battery and what caused each brownout.
      </div>
    );
  if (!ready) return null;
  return (
    <div className="app-view power-view" data-testid="power-view">
      <div className="pv-graph">
        <StandalonePanel id={BATTERY} />
      </div>
      <div className="pv-report">
        <StandalonePanel id={POWER} />
      </div>
    </div>
  );
}
