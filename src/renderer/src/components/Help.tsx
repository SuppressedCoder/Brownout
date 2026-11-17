/** Shortcuts & tips. The keyboard list is generated from the action registry, so it always matches the keybinds. */
import { uiStore } from '../state/ui';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { ACTIONS, type ActionGroup } from '../lib/actions';
import { formatCombo, keyFor } from '../lib/keybinds';
import { openSettings } from '../state/ui';
import { Icon } from './Icon';

export function Help() {
  useStore(settingsStore, (s) => s.keybinds);
  const moveTime = useStore(settingsStore, (s) => s.panelsMoveTime);
  const close = () => uiStore.set({ helpOpen: false });
  const groups: ActionGroup[] = ['Playback', 'Navigate', 'Zoom', 'Files & layout', 'View', 'Robot'];
  const mouse: [string, string][] = [
    ['Timeline: click', 'Place the cursor'],
    ['Timeline: drag / wheel', 'Pan / zoom time around the pointer'],
    ['Timeline: Shift+drag', 'Select a time range (statistics, export, zoom-to-selection, loop)'],
    ['Timeline: drag the overview box or its edges', 'Move / resize the visible range'],
    ['Timeline: Alt+drag a log’s mode lane', 'Nudge that log’s alignment by hand'],
    ['Timeline: drag its top edge', 'Resize the timeline'],
    ['Timeline: Alt+click a track label', 'Remove that track (or all bookmarks)'],
    ['Transport: click “t =”', 'Type a time to jump to'],
    ['Graph: wheel', moveTime ? 'Zoom time; Ctrl+wheel zooms the value axis' : 'Zoom the value axis around the pointer'],
    ['Graph: wheel or drag on an axis', 'Zoom / pan just that axis'],
    ['Graph: double-click', 'Back to auto-fit'],
    ['Graph: Shift+drag', 'Select a time range'],
    ['2D field: wheel / drag / double-click', 'Zoom / pan / fit'],
    ['2D field: Display', 'Field picture, camera lines to AprilTags, tags-seen tracks, the robot’s parts'],
    ['Video: Sync', 'Scrub the video to a moment you recognize, then say what that frame is; it follows the timeline from then on'],
    ['Commands: click a run', 'Jump to where that command started'],
    ['Any panel: hover its top-right corner', 'Copy the panel as an image'],
    ['Field tree: drag a field', 'Onto a panel to add it; onto an empty grid to create the best panel'],
    ['Field tree: double-click a field', 'Add it to the active panel'],
    ['Header: click a log name', 'Make it the primary log (alignment reference and mode shading)'],
  ];
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal help" role="dialog" aria-label="Shortcuts and tips" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Shortcuts &amp; tips</strong>
          <span className="toolbar-spacer" />
          <button
            className="link-btn"
            onClick={() => {
              close();
              openSettings('keybinds');
            }}
          >
            Edit keybinds…
          </button>
          <button onClick={close} title="Close">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="scroll help-body">
          <div className="help-cols">
            <div>
              {groups.map((g) => (
                <div key={g}>
                  <h4>{g}</h4>
                  <table className="kv">
                    <tbody>
                      {ACTIONS.filter((a) => a.group === g).map((a) => (
                        <tr key={a.id}>
                          <th className="mono">{formatCombo(keyFor(a))}</th>
                          <td>{a.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div>
              <h4>Mouse</h4>
              <table className="kv">
                <tbody>
                  {mouse.map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4>Comparing logs</h4>
              <p className="hint">
                “Auto start” puts t = 0 at the start of autonomous in every log, so matches from different days line up. “Wall clock” lines up files from the
                same match. In a graph, choose overlay (one color per log, one line style per field), stacked lanes, or A − B.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
