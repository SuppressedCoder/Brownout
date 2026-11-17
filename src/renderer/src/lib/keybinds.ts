/** Key combos: turning keyboard events into strings like "Ctrl+Shift+P", and showing them. */
import { settingsStore, updateSettings } from '../state/settings';
import { ACTIONS, type Action } from './actions';

/** "Ctrl+Shift+ArrowLeft", "Space", "A", "?" — or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead' || k === 'Unidentified') return null;
  let key: string;
  if (k === ' ') key = 'Space';
  else if (k.length === 1) key = k.toUpperCase();
  else key = k;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // For symbols the character already says whether Shift was held ("?" vs "/").
  const isLetter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  if (e.shiftKey && (key.length > 1 || isLetter)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const PRETTY: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', Delete: 'Del' };

export function formatCombo(combo: string): string {
  if (!combo) return '—';
  return combo
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join('+');
}

/** The combo currently bound to an action ('' = unbound). */
export function keyFor(a: Action): string {
  const o = settingsStore.get().keybinds[a.id];
  return o !== undefined ? o : a.defaultKey;
}

export function keyHint(id: string): string {
  const a = ACTIONS.find((x) => x.id === id);
  const k = a ? keyFor(a) : '';
  return k ? formatCombo(k) : '';
}

export function actionForCombo(combo: string): Action | undefined {
  return ACTIONS.find((a) => keyFor(a) === combo);
}

/**
 * Bind a combo to an action. A combo can only do one thing, so any other
 * action using it is unbound; their labels are returned.
 */
export function setKeybind(id: string, combo: string): string[] {
  const next = { ...settingsStore.get().keybinds };
  const unbound: string[] = [];
  if (combo) {
    for (const a of ACTIONS) {
      if (a.id !== id && keyFor(a) === combo) {
        next[a.id] = '';
        unbound.push(a.label);
      }
    }
  }
  const target = ACTIONS.find((a) => a.id === id);
  if (target && combo === target.defaultKey) delete next[id];
  else next[id] = combo;
  updateSettings({ keybinds: next });
  return unbound;
}

export function resetKeybind(id: string): string[] {
  const a = ACTIONS.find((x) => x.id === id);
  return a ? setKeybind(id, a.defaultKey) : [];
}

export function resetAllKeybinds(): void {
  updateSettings({ keybinds: {} });
}

/** True while the settings page is waiting for a key press, so shortcuts don't fire. */
export const keyCapture = { active: false };
