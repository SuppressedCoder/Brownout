/** Opening logs: file dialog, drag-and-drop, the bundled demo, and last-session restore. */
import { sessionStore, openSources, closeAll, setManualOffset, type LogSource } from '../state/session';
import { ensureDemoProfile } from './power';
import { profileStore } from '../state/profiles';
import { settingsStore } from '../state/settings';
import { confirmDialog, toast } from '../state/ui';
import { applyPreset, layoutUnsaved } from '../state/presets';

export const DEMO_FILES = ['FRC_20260321_143012_NYROC_Q12.wpilog', 'FRC_20260321_171844_NYROC_Q18.wpilog', 'FRC_20260322_094502_NYROC_Q23.wpilog'];

const SESSION_KEY = 'brownout.session.v1';

function reportError(name: string, message: string): void {
  toast(`Could not open ${name}: ${message}`, 'error');
}

export async function openLogs(sources: LogSource[]): Promise<void> {
  await openSources(sources, reportError);
}

export async function openViaDialog(): Promise<void> {
  if (window.brownout) {
    const paths = await window.brownout.pickLogPaths();
    await openLogs(paths.map((path) => ({ path })));
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.wpilog';
  input.onchange = async () => {
    const list = Array.from(input.files ?? []);
    await openLogs(await Promise.all(list.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
  };
  input.click();
}

/** Files dropped on the window. In the desktop app the path is kept so the session can be restored. */
export async function openDropped(files: File[]): Promise<void> {
  const sources: LogSource[] = [];
  for (const f of files) {
    const path = window.brownout?.pathForFile(f);
    if (path) sources.push({ path, name: f.name });
    else sources.push({ name: f.name, data: await f.arrayBuffer() });
  }
  await openLogs(sources);
}

async function demoSources(): Promise<LogSource[]> {
  if (window.brownout) {
    const files = await window.brownout.openDemoLogs();
    if (!files.length) throw new Error('This build has no demo logs. Run `npm run make-demo` before building.');
    return files;
  }
  const out: LogSource[] = [];
  for (const name of DEMO_FILES) {
    const r = await fetch(`./demo/${name}`);
    if (!r.ok) throw new Error(`Demo log ${name} not found`);
    out.push({ name, data: await r.arrayBuffer() });
  }
  return out;
}

/**
 * Load the three example matches. Replaces the open logs and the layout, so
 * it asks first when there is something to lose. Returns false if cancelled.
 */
export async function loadDemo(ask = true): Promise<boolean> {
  const hasLogs = sessionStore.get().logs.length > 0;
  const unsaved = layoutUnsaved();
  if (ask && (hasLogs || unsaved)) {
    const what =
      hasLogs && unsaved
        ? 'close your open logs and replace your unsaved layout'
        : hasLogs
          ? 'close your open logs and reset the layout'
          : 'replace your unsaved layout';
    if (!(await confirmDialog('Load the demo logs?', `Are you sure? This will ${what}.`, 'Load demo'))) return false;
  }
  try {
    const sources = await demoSources();
    closeAll();
    // the demo robot's profile (power subsystems) goes with the demo logs
    const demoProfile = ensureDemoProfile();
    profileStore.set((st) => ({ assignments: { ...st.assignments, ...Object.fromEntries(sources.map((src) => [src.name, demoProfile])) } }));
    await openLogs(sources);
    applyPreset({ kind: 'builtin', id: 'quick' });
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session restore

interface SavedSession {
  logs: { path: string; manualOffset: number }[];
}

let saving = false;
let restored = false;

export function startSessionSaving(): void {
  if (saving) return;
  saving = true;
  let last = '';
  const save = () => {
    const s = sessionStore.get();
    // while logs are still loading the list is incomplete; wait
    if (s.loadingItems.length) return;
    const data: SavedSession = { logs: s.logs.filter((l) => l.path).map((l) => ({ path: l.path!, manualOffset: l.manualOffset })) };
    const text = JSON.stringify(data);
    if (text === last) return;
    last = text;
    try {
      localStorage.setItem(SESSION_KEY, text);
    } catch {
      /* ignore */
    }
  };
  sessionStore.subscribe(save);
}

/**
 * Reopen the logs from the last session (desktop app only). Runs once: in
 * development React runs the startup effect twice, and restoring twice used
 * to open every log twice, doubling the session on each relaunch. A path
 * already open, or listed twice in the saved session, is opened once.
 */
export async function restoreSession(): Promise<void> {
  if (restored || !window.brownout || !settingsStore.get().restoreSession) return;
  restored = true;
  let saved: SavedSession;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    saved = JSON.parse(raw) as SavedSession;
  } catch {
    return;
  }
  if (!Array.isArray(saved.logs)) return;
  const open = new Set(sessionStore.get().logs.map((l) => l.path));
  const logs = saved.logs.filter((l) => typeof l?.path === 'string' && !open.has(l.path) && (open.add(l.path), true));
  if (!logs.length) return;
  const failed = await openSources(logs.map((l) => ({ path: l.path })));
  for (const l of logs) {
    if (!l.manualOffset) continue;
    const entry = sessionStore.get().logs.find((x) => x.path === l.path);
    if (entry) setManualOffset(entry.id, l.manualOffset);
  }
  if (failed.length) toast(`Could not reopen ${failed.length === 1 ? failed[0] : `${failed.length} logs`} from your last session (moved or deleted).`);
}
