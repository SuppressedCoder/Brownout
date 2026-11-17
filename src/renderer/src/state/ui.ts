/**
 * App-level UI state: in-app dialogs (Electron has no window.prompt), toasts,
 * and which overlay is open. Dialog helpers return promises.
 */
import { createStore } from './store';

export interface TextDialog {
  kind: 'text';
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to block confirm, or null. */
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
}
export interface ChoiceOption {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}
export interface ChoiceDialog {
  kind: 'choice';
  title: string;
  message: string;
  options: ChoiceOption[];
  /** Optional "do the same for the rest" style checkbox. */
  checkbox?: string;
  resolve: (r: { id: string | null; checked: boolean }) => void;
}
export interface ChecklistDialog {
  kind: 'checklist';
  title: string;
  message?: string;
  items: { id: string; label: string; checked: boolean }[];
  confirmLabel: string;
  resolve: (ids: string[] | null) => void;
}
export type Dialog = TextDialog | ChoiceDialog | ChecklistDialog;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  actions?: { label: string; run: () => void }[];
}

export type SettingsTab = 'general' | 'appearance' | 'robot' | 'keybinds' | 'demo';

export interface UiState {
  dialogs: Dialog[];
  toasts: Toast[];
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  helpOpen: boolean;
  /** Bumped to ask the transport bar to focus its go-to-time box. */
  gotoEpoch: number;
  /** The power-subsystems editor is open, for this robot profile id. */
  subsystemsFor: string | null;
  /** The camera editor is open, for this robot profile id. */
  camerasFor: string | null;
  /** The robot appearance editor is open, for this robot profile id. */
  robotEditorFor: string | null;
}

export const uiStore = createStore<UiState>({
  dialogs: [],
  toasts: [],
  settingsOpen: false,
  settingsTab: 'general',
  helpOpen: false,
  gotoEpoch: 0,
  subsystemsFor: null,
  camerasFor: null,
  robotEditorFor: null,
});

function push(d: Dialog): void {
  uiStore.set((s) => ({ dialogs: [...s.dialogs, d] }));
}
export function closeDialog(): void {
  uiStore.set((s) => ({ dialogs: s.dialogs.slice(1) }));
}

export function askText(opts: Omit<TextDialog, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'text', ...opts, resolve }));
}

export function askChoice(opts: Omit<ChoiceDialog, 'kind' | 'resolve'>): Promise<{ id: string | null; checked: boolean }> {
  return new Promise((resolve) => push({ kind: 'choice', ...opts, resolve }));
}

export async function confirmDialog(title: string, message: string, confirmLabel = 'Continue', danger = false): Promise<boolean> {
  const r = await askChoice({
    title,
    message,
    options: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'ok', label: confirmLabel, primary: !danger, danger },
    ],
  });
  return r.id === 'ok';
}

export function askChecklist(opts: Omit<ChecklistDialog, 'kind' | 'resolve'>): Promise<string[] | null> {
  return new Promise((resolve) => push({ kind: 'checklist', ...opts, resolve }));
}

let nextToast = 1;
export function toast(text: string, kind: 'info' | 'error' = 'info', actions?: Toast['actions'], timeoutMs = actions ? 15000 : 4500): number {
  const id = nextToast++;
  uiStore.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, actions }] }));
  if (timeoutMs > 0) window.setTimeout(() => dismissToast(id), timeoutMs);
  return id;
}
export function dismissToast(id: number): void {
  uiStore.set((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {}));
}

export function openSettings(tab?: SettingsTab): void {
  uiStore.set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab }));
}
