/**
 * Settings: general behavior and performance, appearance (theme, log and
 * mode colors), keybinds, and the demo logs.
 */
import { useEffect, useState } from 'react';
import { settingsStore, updateSettings, DEFAULT_LOG_COLORS, DEFAULT_MODE_COLORS, type ModeColors, type ThemeId } from '../state/settings';
import { uiStore, toast, type SettingsTab } from '../state/ui';
import { sessionStore, setBrownoutThreshold, allSeasons } from '../state/session';
import { useStore } from '../state/store';
import { THEME_LABELS } from '../lib/theme';
import { ACTIONS, type ActionGroup } from '../lib/actions';
import { comboFromEvent, formatCombo, keyFor, setKeybind, resetKeybind, resetAllKeybinds, keyCapture } from '../lib/keybinds';
import { loadDemo } from '../lib/files';
import { pickJson } from '../lib/persist';
import { parseFieldJson } from '@core/field';
import { MODE_LABEL } from '../lib/colors';
import { hasTagVariants, bundledTags } from '../lib/fieldAssets';
import { Icon } from './Icon';

const TABS: [SettingsTab, string][] = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['keybinds', 'Keybinds'],
  ['demo', 'Demo logs'],
];

export function SettingsModal() {
  const tab = useStore(uiStore, (s) => s.settingsTab);
  const close = () => uiStore.set({ settingsOpen: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !keyCapture.active && uiStore.get().dialogs.length === 0) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal settings" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Settings</strong>
          <span className="toolbar-spacer" />
          <button onClick={close} title="Close">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-nav">
            {TABS.map(([id, label]) => (
              <button key={id} className={`settings-tab${tab === id ? ' active' : ''}`} onClick={() => uiStore.set({ settingsTab: id })}>
                {label}
              </button>
            ))}
          </div>
          <div className="settings-page scroll">
            {tab === 'general' && <General />}
            {tab === 'appearance' && <Appearance />}
            {tab === 'keybinds' && <Keybinds />}
            {tab === 'demo' && <Demo onLoaded={close} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Where match videos are kept, so Brownout can offer the right one when a log opens. */
function VideoFolder() {
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    void window.brownout?.getVideoFolder().then(setFolder);
  }, []);
  return (
    <div className="setting-row plain">
      <span>
        <span className="setting-label">Videos folder</span>
        <span className="setting-help" data-testid="video-folder">
          {folder ?? 'Not set.'} When a log opens without a video, Brownout looks next to the log file and in this folder for a video whose name says the match
          (Q12, qm12, Qual 12, Match 12) and offers it. Nothing opens until you say so.
        </span>
      </span>
      <button className="btn" data-testid="video-folder-pick" onClick={() => void window.brownout?.pickVideoFolder().then((p) => p && setFolder(p))}>
        Choose…
      </button>
      {folder && (
        <button className="btn" onClick={() => void window.brownout?.clearVideoFolder().then(() => setFolder(null))}>
          Clear
        </button>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="setting-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="setting-label">{label}</span>
        {help && <span className="setting-help">{help}</span>}
      </span>
    </label>
  );
}

function General() {
  const s = useStore(settingsStore, (x) => x);
  const threshold = useStore(sessionStore, (x) => x.brownoutThreshold);
  const seasonId = useStore(sessionStore, (x) => x.seasonId);
  const tags = useStore(sessionStore, (x) => x.fieldTags);
  const tagVariant = useStore(sessionStore, (x) => x.tagVariant);
  const customFields = useStore(sessionStore, (x) => x.customFields);
  const bundled = bundledTags(seasonId, tagVariant).length;
  const loadTags = async () => {
    const f = await pickJson('Load a WPILib field JSON (AprilTag layout)');
    if (!f) return;
    try {
      const parsed = parseFieldJson(JSON.parse(f.text));
      if (!parsed.tags.length) throw new Error('no tags found in the file');
      sessionStore.set({ fieldTags: parsed.tags });
      toast(`Loaded ${parsed.tags.length} AprilTags from ${f.name}.`);
    } catch (e) {
      toast(`Could not read ${f.name}: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };
  return (
    <>
      <h3>Performance</h3>
      <Toggle
        checked={s.potato}
        onChange={(v) => updateSettings({ potato: v })}
        label="Potato mode"
        help="For slow laptops or very dense logs: draws at most 30 times a second at 1× resolution with coarser graphs, no hover readouts in other panels, short field trails, and tables that update only when you stop moving."
      />
      <Toggle checked={s.offerPotato} onChange={(v) => updateSettings({ offerPotato: v })} label="Offer Potato mode when drawing is slow" />

      <h3>Layout</h3>
      <Toggle
        checked={s.compact}
        onChange={(v) => updateSettings({ compact: v })}
        label="Always use compact view"
        help="Compact view keeps each toolbar to its most-used buttons and moves the rest into the three-dot menu, collapses a graph's field chips to a count, and shortens the header and timeline bar. Off (default): only narrow panels and windows switch to it."
      />

      <h3>Time control</h3>
      <Toggle
        checked={s.panelsMoveTime}
        onChange={(v) => updateSettings({ panelsMoveTime: v })}
        label="Let graphs and the field move time"
        help="Off (default): only the timeline bar at the bottom pans, zooms and places the cursor; the mouse wheel on a graph zooms its value axis. On: click a graph to place the cursor, drag to pan, wheel to zoom time (Ctrl+wheel for the value axis)."
      />

      <h3>Startup</h3>
      <Toggle
        checked={s.restoreSession}
        onChange={(v) => updateSettings({ restoreSession: v })}
        label="Reopen the last session's logs on launch"
        help={window.brownout ? undefined : 'Desktop app only: the browser build cannot reopen files by path.'}
      />

      {window.brownout && (
        <>
          <h3>Match videos</h3>
          <VideoFolder />
        </>
      )}

      <h3>Robot &amp; field</h3>
      <div className="setting-row plain">
        <span className="setting-label">Brownout threshold</span>
        <select className="tool-select" value={String(threshold)} onChange={(e) => void setBrownoutThreshold(Number(e.target.value))}>
          <option value="6.3">6.3 V (roboRIO 1)</option>
          <option value="6.75">6.75 V (roboRIO 2 default)</option>
          <option value="7">7.0 V</option>
          <option value="7.5">7.5 V</option>
        </select>
      </div>
      <div className="setting-row plain">
        <span className="setting-label">Season field</span>
        <select className="tool-select" value={seasonId} onChange={(e) => sessionStore.set({ seasonId: e.target.value })}>
          {allSeasons({ ...sessionStore.get(), customFields }).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">AprilTag map</span>
          <span className="setting-help">
            {tags
              ? `Using your own file: ${tags.length} tags.`
              : bundled
                ? `${bundled} tags for this season are built in. The 2D field draws them and lines to the tags each camera sees.`
                : 'This season has no built-in tag map. Load a WPILib field JSON to draw tags on the 2D field.'}
          </span>
        </span>
        {!tags && hasTagVariants(seasonId) && (
          <select
            className="tool-select"
            value={tagVariant}
            onChange={(e) => sessionStore.set({ tagVariant: e.target.value as 'welded' | 'andymark' })}
            title="The welded and AndyMark fields place a few tags slightly differently"
          >
            <option value="welded">Welded field</option>
            <option value="andymark">AndyMark field</option>
          </select>
        )}
        <button className="btn" onClick={() => void loadTags()}>
          Load your own…
        </button>
        {tags && (
          <button className="btn" onClick={() => sessionStore.set({ fieldTags: null })}>
            Use built-in
          </button>
        )}
      </div>
    </>
  );
}

function Appearance() {
  const s = useStore(settingsStore, (x) => x);
  const setLog = (i: number, c: string) => updateSettings({ logColors: s.logColors.map((x, k) => (k === i ? c : x)) });
  const setMode = (k: keyof ModeColors, c: string) => updateSettings({ modeColors: { ...s.modeColors, [k]: c } });
  return (
    <>
      <h3>Theme</h3>
      <div className="theme-cards">
        {THEME_LABELS.map(([id, label]) => (
          <button key={id} className={`theme-card theme-${id}${s.theme === id ? ' active' : ''}`} onClick={() => updateSettings({ theme: id as ThemeId })}>
            <span className="theme-swatch">
              <i />
              <i />
              <i />
            </span>
            {label}
          </button>
        ))}
      </div>

      <h3>Log colors</h3>
      <div className="setting-help">The first log you open gets the first color, and so on.</div>
      <div className="color-row">
        {s.logColors.map((c, i) => (
          <label key={i} className="color-pick" title={`Log ${i + 1}`}>
            <input type="color" value={c} onChange={(e) => setLog(i, e.target.value)} />
            <span>{i + 1}</span>
          </label>
        ))}
        <button className="btn" onClick={() => updateSettings({ logColors: DEFAULT_LOG_COLORS })}>
          Reset
        </button>
      </div>

      <h3>Robot mode colors</h3>
      <div className="setting-help">Used for the timeline's mode lanes and the shading behind graphs.</div>
      <div className="color-row">
        {(Object.keys(DEFAULT_MODE_COLORS) as (keyof ModeColors)[]).map((k) => (
          <label key={k} className="color-pick wide" title={MODE_LABEL[k]}>
            <input type="color" value={s.modeColors[k]} onChange={(e) => setMode(k, e.target.value)} />
            <span>{MODE_LABEL[k]}</span>
          </label>
        ))}
        <button className="btn" onClick={() => updateSettings({ modeColors: DEFAULT_MODE_COLORS })}>
          Reset
        </button>
      </div>
    </>
  );
}

function Keybinds() {
  const overrides = useStore(settingsStore, (x) => x.keybinds);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    keyCapture.active = capturing !== null;
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      let combo: string | null;
      if (e.key === 'Backspace' || e.key === 'Delete') combo = '';
      else combo = comboFromEvent(e);
      if (combo === null) return; // bare modifier: keep waiting
      const unbound = setKeybind(capturing, combo);
      setNote(unbound.length ? `${formatCombo(combo)} was taken from “${unbound.join('”, “')}”, which now has no shortcut.` : null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      keyCapture.active = false;
    };
  }, [capturing]);

  const groups: ActionGroup[] = ['Playback', 'Navigate', 'Zoom', 'Edit', 'Files & layout', 'View', 'Robot'];
  return (
    <>
      <div className="setting-help">
        Click a shortcut, then press the new keys. <b>Backspace</b> removes it, <b>Esc</b> cancels. A combination can only do one thing: assigning one that is
        in use takes it from the other command.
      </div>
      {note && <div className="keybind-note">{note}</div>}
      {groups.map((g) => (
        <div key={g}>
          <h3>{g}</h3>
          <table className="keybind-table">
            <tbody>
              {ACTIONS.filter((a) => a.group === g).map((a) => {
                const key = keyFor(a);
                const changed = overrides[a.id] !== undefined;
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td>
                      <button
                        className={`keycap${capturing === a.id ? ' capturing' : ''}${key ? '' : ' unbound'}`}
                        data-action={a.id}
                        onClick={() => setCapturing(capturing === a.id ? null : a.id)}
                      >
                        {capturing === a.id ? 'Press keys…' : key ? formatCombo(key) : 'none'}
                      </button>
                    </td>
                    <td>
                      {changed && (
                        <button
                          className="chip-btn"
                          title={`Reset to ${a.defaultKey ? formatCombo(a.defaultKey) : 'none'}`}
                          onClick={() => {
                            const unbound = resetKeybind(a.id);
                            setNote(unbound.length ? `Reset took the shortcut from “${unbound.join('”, “')}”.` : null);
                          }}
                        >
                          reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="settings-footer">
        <button
          className="btn"
          onClick={() => {
            resetAllKeybinds();
            setNote(null);
          }}
        >
          Reset all to defaults
        </button>
      </div>
    </>
  );
}

function Demo({ onLoaded }: { onLoaded: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h3>Demo logs</h3>
      <p className="setting-text">
        Three example matches to try the app with: qualification matches 12, 18 and 23 from a made-up event. They are synthetic (generated, not from a real
        robot) and include a brownout, loop overruns, a camera dropout, PathPlanner-style auto paths, swerve module states, motor currents, both alliances and
        two code versions, so every panel and the comparison tools have something to show. A “Demo robot” profile with its power subsystems comes with them.
      </p>
      <p className="setting-text">
        Loading them closes any logs you have open and switches to the Quick Look layout. You will be asked first if that would lose anything.
      </p>
      <button
        className="btn primary"
        disabled={busy}
        data-testid="load-demo"
        onClick={async () => {
          setBusy(true);
          const ok = await loadDemo();
          setBusy(false);
          if (ok) onLoaded();
        }}
      >
        {busy ? 'Loading…' : 'Load demo logs'}
      </button>
    </>
  );
}
