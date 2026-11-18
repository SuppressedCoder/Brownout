/**
 * Path analysis: per-path summary (duration, max/RMS/end error, start-pose
 * error) for every log, grouped so the same path can be compared across
 * matches. Error series are available as /Brownout/Path/* fields for graphs.
 */
import { panelStore, type PathsSettings, type GraphSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { setCursor, setView } from '../state/time';
import { useStore } from '../state/store';
import { formatTime } from '@core/alignment';
import { Toolbar, ToolButton } from '../components/Toolbar';
import { grid } from '../components/Grid';
import { DERIVED_PREFIX } from '../worker/protocol';
import { GuideLink } from '../components/Guide';

const deg = (r?: number) => (r === undefined ? '—' : `${((r * 180) / Math.PI).toFixed(1)}°`);
const m = (x?: number) => (x === undefined ? '—' : `${(x * 100).toFixed(1)} cm`);

export function PathsPanel({ id }: { id: string }) {
  useStore(panelStore, (s) => s.panels[id] as PathsSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const rows = logs.flatMap((log) => log.pathSegments.map((seg) => ({ log, seg })));

  const jump = (log: LogEntry, start: number, end: number) => {
    setCursor(start + log.offset);
    setView(start + log.offset - 0.5, end + log.offset + 0.5);
  };

  return (
    <div className="panel paths-panel">
      <Toolbar>
        <ToolButton
          onClick={() =>
            grid.addPanel(
              'graph',
              {
                series: [
                  { key: `${DERIVED_PREFIX}Path/PositionError`, axis: 'left' },
                  { key: `${DERIVED_PREFIX}Path/HeadingError`, axis: 'right' },
                ],
              } as Partial<GraphSettings>,
              undefined,
              'Path error',
            )
          }
          title="Open a graph of position and heading error vs time"
        >
          Error graph
        </ToolButton>
        <span className="toolbar-note">Max / RMS / end error from the logged target pose vs the actual pose while each path is active.</span>
      </Toolbar>
      {rows.length === 0 ? (
        <div className="panel-placeholder">
          <div>
            No active-path data. Log PathPlanner’s active path and target pose.
            <GuideLink section="path-analysis" />
          </div>
        </div>
      ) : (
        <div className="scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Log</th>
                <th>Auto</th>
                <th>Path</th>
                <th>Start</th>
                <th>Duration</th>
                <th>Start-pose err</th>
                <th>Max err</th>
                <th>RMS err</th>
                <th>Max heading err</th>
                <th>End err</th>
                <th>End heading err</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, seg }) => (
                <tr key={`${log.id}-${seg.index}`} className="clickable" onClick={() => jump(log, seg.start, seg.end)}>
                  <td style={{ color: log.color }}>{log.name}</td>
                  <td>{autoName(log)}</td>
                  <td>{seg.name}</td>
                  <td className="mono">{formatTime(seg.start + log.offset)}</td>
                  <td className="mono">{seg.duration.toFixed(2)} s</td>
                  <td className="mono">{m(seg.startPosError)}</td>
                  <td className="mono">{m(seg.maxPosError)}</td>
                  <td className="mono">{m(seg.rmsPosError)}</td>
                  <td className="mono">{deg(seg.maxHeadingError)}</td>
                  <td className="mono">{m(seg.endPosError)}</td>
                  <td className="mono">{deg(seg.endHeadingError)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function autoName(log: LogEntry): string {
  return log.autoRoutine ?? '—';
}
