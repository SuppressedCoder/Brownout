import { useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Grid, grid } from './components/Grid';
import { Timeline } from './components/Timeline';
import { SettingsModal } from './components/Settings';
import { Help } from './components/Help';
import { DialogHost, ToastHost } from './components/Dialogs';
import { sessionStore } from './state/session';
import { uiStore } from './state/ui';
import { useStore } from './state/store';
import { applyPreset, startPresetTracking } from './state/presets';
import { startAutosave, loadPrefs, restoreLayout } from './lib/persist';
import { startTheme } from './lib/theme';
import { ACTIONS, runAction } from './lib/actions';
import { actionForCombo, comboFromEvent, keyCapture } from './lib/keybinds';
import { openLogs, openDropped, loadDemo, restoreSession, startSessionSaving } from './lib/files';
import type { PanelType } from './state/panels';
import { SubsystemEditorModal } from './components/SubsystemEditor';
import { startPowerAnalysis } from './lib/power';
import { startVisionAnalysis } from './lib/vision';
import { CameraEditorModal } from './components/CameraEditor';
import { RobotEditorModal } from './components/RobotEditor';
import { VideoSyncModal } from './components/VideoSync';
import { VideoReview, PowerView } from './components/Views';
import { startVideoOffers } from './lib/videoOffer';
import { addCustomField } from './lib/fieldAssets';
import { startWindowSync, whenPrimary } from './lib/windowSync';
import { startUndo } from './lib/undo';

/** Inputs that are not typed into (sliders, checkboxes, ...): undo and redo still work while they have focus. */
const NOT_TYPED = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file']);

/** Below this window width the sidebar hides itself. */
const NARROW = 980;

export function App() {
  const sidebarOpen = useStore(sessionStore, (s) => s.sidebarOpen);
  const view = useStore(sessionStore, (s) => s.view);
  const helpOpen = useStore(uiStore, (s) => s.helpOpen);
  const settingsOpen = useStore(uiStore, (s) => s.settingsOpen);
  const logCount = useStore(sessionStore, (s) => s.logs.length);
  const loading = useStore(sessionStore, (s) => s.loadingItems.length);
  const readyNotified = useRef(false);
  const appliedDefault = useRef(false);

  // Startup: theme, prefs, layout, last session, Electron file / command channels
  useEffect(() => {
    startTheme();
    loadPrefs();
    const restored = restoreLayout();
    appliedDefault.current = restored;
    startAutosave();
    startPresetTracking(restored);
    startPowerAnalysis();
    startVisionAnalysis();
    startVideoOffers();
    // field pictures the user loaded earlier
    void window.brownout?.listFields().then((list) => {
      const metas = [];
      for (const f of list) {
        try {
          metas.push(addCustomField(f.id, f.json, f.image, f.mime));
        } catch {
          /* skip a field file that no longer parses */
        }
      }
      if (metas.length) sessionStore.set({ customFields: metas });
    });
    const offFiles = window.brownout?.onOpenFiles((files) => void openLogs(files));
    const offCmd = window.brownout?.onCommand((cmd) => void runCommand(cmd));
    void (async () => {
      // A second window takes the logs and time of the others; the first reopens last session's
      // logs, unless files were passed on the command line.
      const joined = await startWindowSync();
      const info = await window.brownout?.getStartupInfo();
      if (!joined && info && !info.cliFiles) await restoreSession();
      // only the primary window saves the session (the others would save the same)
      whenPrimary(startSessionSaving);
      // undo starts from the state the app opened in
      startUndo();
    })();
    return () => {
      offFiles?.();
      offCmd?.();
    };
  }, []);

  // The window title names the view, so the Window menu and the taskbar tell windows apart
  useEffect(() => {
    document.title = view === 'video' ? 'Brownout - Video review' : view === 'power' ? 'Brownout - Power' : 'Brownout';
  }, [view]);

  // First log opened with an empty grid: apply Quick Look. Also report readiness (smoke test).
  useEffect(() => {
    if (logCount > 0 && !appliedDefault.current && grid.panelIds().length === 0) {
      appliedDefault.current = true;
      applyPreset({ kind: 'builtin', id: 'quick' });
    }
    if (logCount > 0 && loading === 0 && !readyNotified.current) {
      readyNotified.current = true;
      const fields = sessionStore.get().logs.reduce((a, l) => a + l.fields.length, 0);
      setTimeout(() => window.brownout?.notifyReady({ logs: logCount, fields }), 800);
    }
  }, [logCount, loading]);

  // Keyboard shortcuts, from the action registry (Settings, Keybinds)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyCapture.active) return;
      const ui = uiStore.get();
      if (ui.dialogs.length) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (ui.helpOpen && combo === 'Escape') {
        uiStore.set({ helpOpen: false });
        return;
      }
      const el = e.target as HTMLElement;
      // typing into a text box: its keys are its own (Ctrl+Z there undoes the typing)
      const typing = el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NOT_TYPED.has((el as HTMLInputElement).type));
      if (typing) return;
      const a = actionForCombo(combo);
      if (!a) return;
      const undoRedo = a.id === 'undo' || a.id === 'redo';
      // a slider, checkbox or dropdown keeps its keys, but has no undo of its own: undo and redo still work
      if ((el.tagName === 'INPUT' || el.tagName === 'SELECT') && !undoRedo) return;
      // the settings modal handles its own keys; undo and redo also work there (and in the robot editor opened from it)
      if (ui.settingsOpen && !undoRedo) return;
      e.preventDefault();
      a.run();
    };
    // A dropdown that keeps focus after a choice would swallow shortcuts; let go of it.
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') (e.target as HTMLElement).blur();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('change', onChange);
    };
  }, []);

  // Narrow window: the sidebar gets out of the way (it can be reopened and then overlays the grid)
  useEffect(() => {
    let wasNarrow = window.innerWidth < NARROW;
    const onResize = () => {
      const narrow = window.innerWidth < NARROW;
      if (narrow && !wasNarrow) sessionStore.set({ sidebarOpen: false });
      wasNarrow = narrow;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drop .wpilog files anywhere
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      void openDropped(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app">
      <Header />
      <div className="body">
        {sidebarOpen && view === 'panels' && <Sidebar />}
        {/* the grid stays mounted (hidden) in the other views, so its layout is kept */}
        <div className="grid-wrap" style={view === 'panels' ? undefined : { display: 'none' }}>
          <Grid />
        </div>
        {view === 'video' && <VideoReview />}
        {view === 'power' && <PowerView />}
      </div>
      <Timeline />
      {helpOpen && <Help />}
      {settingsOpen && <SettingsModal />}
      <SubsystemEditorModal />
      <CameraEditorModal />
      <RobotEditorModal />
      <VideoSyncModal />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

/** Commands from the native menu and the command line: "action:<id>", "preset:<id>", "add-panel:<type>", "demo". */
async function runCommand(cmd: string): Promise<void> {
  if (cmd.startsWith('action:')) {
    const id = cmd.slice('action:'.length);
    if (ACTIONS.some((a) => a.id === id)) runAction(id);
  } else if (cmd.startsWith('preset:')) {
    applyPreset({ kind: 'builtin', id: cmd.slice('preset:'.length) });
  } else if (cmd.startsWith('add-panel:')) {
    grid.addPanel(cmd.slice('add-panel:'.length) as PanelType);
  } else if (cmd === 'demo') {
    await loadDemo(false);
  }
}
