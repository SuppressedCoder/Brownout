/**
 * Every command the app can run from the keyboard or the native menu, in one
 * registry. Keybinds (Settings, Keybinds) and the help sheet are generated
 * from this list.
 */
import { sessionStore, addBookmark, closeAll, type AppView } from '../state/session';
import { timeStore, setPlaying, stepCursor, zoomTo, zoomBy, jumpPhase, setCursor } from '../state/time';
import { settingsStore, updateSettings } from '../state/settings';
import { uiStore, askText, openSettings, toast } from '../state/ui';
import { savePresetAs, updateActivePreset, presetStore } from '../state/presets';
import { openViaDialog } from './files';
import { exportCsv } from './exportCsv';
import { formatTime } from '@core/alignment';
import { grid } from '../components/Grid';
import { openGuide } from '../components/Guide';
import { capturePanel } from './capture';
import { exportMatchReport } from './report';

export type ActionGroup = 'Playback' | 'Navigate' | 'Zoom' | 'Files & layout' | 'View' | 'Robot';

export interface Action {
  id: string;
  label: string;
  group: ActionGroup;
  defaultKey: string;
  run: () => void;
}

export async function bookmarkAtCursor(): Promise<void> {
  const c = timeStore.get().cursor;
  if (c === null) {
    toast('Click the timeline to place the cursor, then add a bookmark.');
    return;
  }
  const text = await askText({
    title: `Bookmark at ${formatTime(c)}`,
    label: 'Note (optional)',
    placeholder: 'e.g. got hit here',
    confirmLabel: 'Add bookmark',
  });
  if (text !== null) addBookmark(c, text.trim());
}

export function cycleTimeline(): void {
  sessionStore.set((s) => ({
    timelineHeight: null,
    timelineMode: s.timelineMode === 'compact' ? 'standard' : s.timelineMode === 'standard' ? 'expanded' : 'compact',
  }));
}

export function togglePotato(): void {
  const on = !settingsStore.get().potato;
  updateSettings({ potato: on });
  toast(on ? 'Potato mode on: lower detail, faster drawing.' : 'Potato mode off.');
}

/** Switch the window between the panel grid and the Video review and Power views. */
export function showView(view: AppView): void {
  sessionStore.set({ view });
}

export const ACTIONS: Action[] = [
  { id: 'play', label: 'Play / pause', group: 'Playback', defaultKey: 'Space', run: () => setPlaying(!timeStore.get().playing) },
  { id: 'stepBack', label: 'Step back one loop cycle (20 ms)', group: 'Playback', defaultKey: 'ArrowLeft', run: () => stepCursor(-0.02) },
  { id: 'stepForward', label: 'Step forward one loop cycle (20 ms)', group: 'Playback', defaultKey: 'ArrowRight', run: () => stepCursor(0.02) },
  { id: 'jumpBack', label: 'Jump back 1 s', group: 'Playback', defaultKey: 'Shift+ArrowLeft', run: () => stepCursor(-1) },
  { id: 'jumpForward', label: 'Jump forward 1 s', group: 'Playback', defaultKey: 'Shift+ArrowRight', run: () => stepCursor(1) },

  { id: 'prevPhase', label: 'Previous robot-mode change', group: 'Navigate', defaultKey: '[', run: () => jumpPhase(-1) },
  { id: 'nextPhase', label: 'Next robot-mode change', group: 'Navigate', defaultKey: ']', run: () => jumpPhase(1) },
  { id: 'gotoTime', label: 'Go to a time…', group: 'Navigate', defaultKey: 'G', run: () => uiStore.set((s) => ({ gotoEpoch: s.gotoEpoch + 1 })) },
  { id: 'bookmark', label: 'Bookmark at the cursor', group: 'Navigate', defaultKey: 'B', run: () => void bookmarkAtCursor() },
  {
    id: 'clear',
    label: 'Clear selection and cursor',
    group: 'Navigate',
    defaultKey: 'Escape',
    run: () => {
      timeStore.set({ selection: null });
      setCursor(null);
    },
  },

  { id: 'zoomIn', label: 'Zoom in (time)', group: 'Zoom', defaultKey: '=', run: () => zoomBy(1 / 1.5) },
  { id: 'zoomOut', label: 'Zoom out (time)', group: 'Zoom', defaultKey: '-', run: () => zoomBy(1.5) },
  { id: 'zoomMatch', label: 'Zoom to the match (auto start to teleop end)', group: 'Zoom', defaultKey: 'M', run: () => zoomTo('match') },
  { id: 'zoomFull', label: 'Zoom to the whole log', group: 'Zoom', defaultKey: 'F', run: () => zoomTo('full') },
  { id: 'zoomAuto', label: 'Zoom to autonomous', group: 'Zoom', defaultKey: 'A', run: () => zoomTo('auto') },
  { id: 'zoomTeleop', label: 'Zoom to teleop', group: 'Zoom', defaultKey: 'T', run: () => zoomTo('teleop') },
  { id: 'zoomEnabled', label: 'Zoom to enabled', group: 'Zoom', defaultKey: 'E', run: () => zoomTo('enabled') },
  { id: 'zoomSelection', label: 'Zoom to the selection', group: 'Zoom', defaultKey: 'S', run: () => zoomTo('selection') },

  { id: 'open', label: 'Open logs…', group: 'Files & layout', defaultKey: 'Ctrl+O', run: () => void openViaDialog() },
  {
    id: 'savePreset',
    label: 'Save layout as preset (updates the active one)',
    group: 'Files & layout',
    defaultKey: 'Ctrl+S',
    run: () => {
      const s = presetStore.get();
      if (s.active?.kind === 'user') updateActivePreset();
      else void savePresetAs();
    },
  },
  { id: 'exportCsv', label: 'Export CSV…', group: 'Files & layout', defaultKey: 'Ctrl+E', run: () => void exportCsv().then((m) => toast(m)) },
  {
    id: 'copyImage',
    label: 'Copy the active panel as an image',
    group: 'Files & layout',
    defaultKey: 'Ctrl+Shift+C',
    run: () => void capturePanel(grid.activePanelId(), 'copy'),
  },
  {
    id: 'saveImage',
    label: 'Save the active panel as a PNG…',
    group: 'Files & layout',
    defaultKey: '',
    run: () => void capturePanel(grid.activePanelId(), 'save'),
  },
  { id: 'matchReport', label: 'Match report (PDF)…', group: 'Files & layout', defaultKey: '', run: () => void exportMatchReport() },
  { id: 'closeAll', label: 'Close all logs', group: 'Files & layout', defaultKey: '', run: () => closeAll() },
  {
    id: 'newWindow',
    label: 'New window on the same logs and time',
    group: 'View',
    defaultKey: 'Ctrl+Shift+N',
    run: () => void window.brownout?.newWindow(),
  },

  {
    id: 'toggleSidebar',
    label: 'Show / hide the field sidebar',
    group: 'View',
    defaultKey: 'Ctrl+B',
    run: () => sessionStore.set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  },
  { id: 'cycleTimeline', label: 'Cycle timeline height', group: 'View', defaultKey: 'Ctrl+T', run: cycleTimeline },
  { id: 'viewPanels', label: 'Show the panels', group: 'View', defaultKey: 'Ctrl+1', run: () => showView('panels') },
  { id: 'viewVideo', label: 'Show Video review', group: 'View', defaultKey: 'Ctrl+2', run: () => showView('video') },
  { id: 'viewPower', label: 'Show the Power view', group: 'View', defaultKey: 'Ctrl+3', run: () => showView('power') },
  { id: 'maximizePanel', label: 'Maximize / restore the active panel', group: 'View', defaultKey: 'Ctrl+Enter', run: () => grid.toggleMaximize() },
  { id: 'potato', label: 'Toggle Potato mode', group: 'View', defaultKey: 'Ctrl+Shift+P', run: togglePotato },
  { id: 'settings', label: 'Settings', group: 'View', defaultKey: 'Ctrl+,', run: () => openSettings() },
  { id: 'help', label: 'Guide, shortcuts and tips', group: 'View', defaultKey: '?', run: () => uiStore.set((s) => ({ helpOpen: !s.helpOpen })) },
  { id: 'guide', label: 'Open the guide', group: 'View', defaultKey: 'F1', run: () => openGuide() },

  { id: 'power', label: 'Power view', group: 'Robot', defaultKey: 'P', run: () => showView('power') },
  { id: 'robot', label: 'Robot profile…', group: 'Robot', defaultKey: '', run: () => openSettings('robot') },
];

export function runAction(id: string): void {
  ACTIONS.find((a) => a.id === id)?.run();
}
