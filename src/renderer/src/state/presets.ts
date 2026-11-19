/**
 * Presets = layouts. Built-in presets (lib/presets.ts) find fields by role;
 * user presets are saved layouts with exact field names. This store tracks
 * which preset is active and whether the layout has changed since.
 */
import { createStore } from './store';
import { grid, type SavedLayout } from '../components/Grid';
import { PRESETS } from '../lib/presets';
import { panelStore } from './panels';
import { sessionStore } from './session';
import { askText, askChoice, askChecklist, confirmDialog, toast } from './ui';
import { saveText, pickJson } from '../lib/persist';

export interface UserPreset {
  name: string;
  layout: SavedLayout;
  updatedAt: number;
}
export interface ActivePreset {
  kind: 'builtin' | 'user';
  /** Built-in id, or the user preset's name. */
  id: string;
}
export interface PresetState {
  user: UserPreset[];
  active: ActivePreset | null;
  modified: boolean;
  hasPanels: boolean;
}

const PRESETS_KEY = 'brownout.presets.v1';
const STATE_KEY = 'brownout.presetState.v1';
const FILE_VERSION = 1;

function loadUser(): UserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const list = raw ? (JSON.parse(raw) as UserPreset[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string' && p.layout?.dock) : [];
  } catch {
    return [];
  }
}

export const presetStore = createStore<PresetState>({ user: loadUser(), active: null, modified: false, hasPanels: false });

// another window saved its presets: take its list, so this window never writes an older one back
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === PRESETS_KEY && presetStore.set({ user: loadUser() }));

let baseline: string | null = null;
let applying = false;
let checkTimer = 0;

function saveUser(): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presetStore.get().user));
  } catch (e) {
    toast(`Could not save presets: ${e instanceof Error ? e.message : e}`, 'error');
  }
}
function saveState(): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ active: presetStore.get().active, baseline }));
  } catch {
    /* ignore */
  }
}

/** View state that shouldn't count as "the layout changed". */
const VIEW_KEYS = new Set(['view', 'yLeft', 'yRight', 'zoom', 'center', 'legendOpen', 'imageBrightness']);

/** A string that changes when panels, their arrangement or their settings change (not sizes or zoom). */
export function layoutSignature(): string {
  const l = grid.save();
  if (!l) return '';
  type Node = { type: string; data: Node[] | { views: string[] } };
  const strip = (n: Node): unknown => (n.type === 'branch' ? (n.data as Node[]).map(strip) : (n.data as { views: string[] }).views);
  const root = (l.dock.grid as unknown as { root: Node }).root;
  // Sorted by panel id: dockview and the panel store don't keep the same order across a reload.
  const byId = (x: [string, unknown], y: [string, unknown]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  const titles = Object.values(l.dock.panels as Record<string, { id: string; title?: string }>)
    .map((p) => [p.id, p.title] as [string, unknown])
    .sort(byId);
  const panels = Object.entries(l.panels).sort(byId);
  return JSON.stringify({ g: strip(root), o: l.dock.grid.orientation, p: panels, t: l.timelineTracks, titles }, (k, v) => (VIEW_KEYS.has(k) ? undefined : v));
}

function check(): void {
  if (applying) return;
  const hasPanels = grid.panelIds().length > 0;
  const modified = baseline !== null && presetStore.get().active !== null && layoutSignature() !== baseline;
  presetStore.set({ hasPanels, modified });
}
function scheduleCheck(): void {
  if (checkTimer) window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(check, 200);
}

/** The layout as it is now becomes the reference for "(modified)". */
function setBaseline(active: ActivePreset | null): void {
  baseline = active ? layoutSignature() : null;
  presetStore.set({ active, modified: false, hasPanels: grid.panelIds().length > 0 });
  saveState();
}

export function startPresetTracking(restoredLayout: boolean): void {
  if (restoredLayout) {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const st = JSON.parse(raw) as { active: ActivePreset | null; baseline: string | null };
        const exists =
          st.active &&
          (st.active.kind === 'builtin' ? PRESETS.some((p) => p.id === st.active!.id) : presetStore.get().user.some((p) => p.name === st.active!.id));
        if (exists) {
          baseline = st.baseline;
          presetStore.set({ active: st.active });
        }
      }
    } catch {
      /* ignore */
    }
  }
  panelStore.subscribe(scheduleCheck);
  grid.onLayoutChange(scheduleCheck);
  let tracks = sessionStore.get().timelineTracks;
  sessionStore.subscribe((s) => {
    if (s.timelineTracks !== tracks) {
      tracks = s.timelineTracks;
      scheduleCheck();
    }
  });
  scheduleCheck();
}

export function presetLabel(s: PresetState = presetStore.get()): string {
  if (!s.active) return s.hasPanels ? 'Custom layout' : 'choose…';
  const name = s.active.kind === 'builtin' ? (PRESETS.find((p) => p.id === s.active!.id)?.name ?? s.active.id) : s.active.id;
  return s.modified ? `${name} (modified)` : name;
}

function settle(active: ActivePreset): void {
  // dockview finishes laying out on the next frames; take the baseline after that
  window.setTimeout(() => {
    applying = false;
    setBaseline(active);
  }, 150);
}

/** Apply without asking (startup default, CLI, after a confirm). */
export function applyPreset(active: ActivePreset): boolean {
  if (active.kind === 'builtin') {
    const p = PRESETS.find((x) => x.id === active.id);
    if (!p) return false;
    applying = true;
    p.apply(sessionStore.get().logs[0]);
  } else {
    const p = presetStore.get().user.find((x) => x.name === active.id);
    if (!p) return false;
    applying = true;
    grid.load(p.layout);
  }
  presetStore.set({ active, modified: false });
  settle(active);
  return true;
}

/** True when switching layouts would lose something. */
export function layoutUnsaved(): boolean {
  check();
  const s = presetStore.get();
  return s.hasPanels && (s.modified || s.active === null);
}

/** Apply a preset, asking first when the current layout has unsaved changes. */
export async function requestPreset(active: ActivePreset): Promise<boolean> {
  if (layoutUnsaved()) {
    const s = presetStore.get();
    const what = s.active ? `Your changes to “${presetLabel({ ...s, modified: false })}” aren't saved.` : "The current layout isn't saved as a preset.";
    const r = await askChoice({
      title: 'Replace the current layout?',
      message: `${what} Switching presets will discard it.`,
      options: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save as preset first…' },
        { id: 'ok', label: 'Replace', primary: true },
      ],
    });
    if (r.id === 'save') {
      if (!(await savePresetAs())) return false;
    } else if (r.id !== 'ok') return false;
  }
  return applyPreset(active);
}

function nameError(name: string, allowExisting?: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a name';
  if (PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'That name belongs to a built-in preset';
  if (n !== allowExisting && n.length > 60) return 'Keep it under 60 characters';
  return null;
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

function putPreset(name: string, layout: SavedLayout): void {
  presetStore.set((s) => {
    const p: UserPreset = { name, layout: structuredClone({ ...layout, name }), updatedAt: Date.now() };
    const i = s.user.findIndex((x) => x.name === name);
    return { user: i >= 0 ? s.user.map((x, k) => (k === i ? p : x)) : [...s.user, p] };
  });
  saveUser();
}

/** Save the current layout under a new name. Returns the name, or null if cancelled. */
export async function savePresetAs(suggested?: string): Promise<string | null> {
  const layout = grid.save();
  if (!layout || !grid.panelIds().length) {
    toast('Add a panel first: there is nothing to save yet.');
    return null;
  }
  const s = presetStore.get();
  const initial = suggested ?? (s.active?.kind === 'user' ? s.active.id : s.active ? `${presetLabel({ ...s, modified: false })} copy` : 'My preset');
  const raw = await askText({ title: 'Save layout as preset', label: 'Preset name', initial, confirmLabel: 'Save', validate: (v) => nameError(v) });
  if (raw === null) return null;
  const name = raw.trim();
  if (presetStore.get().user.some((p) => p.name === name)) {
    if (!(await confirmDialog('Overwrite preset?', `A preset named “${name}” already exists.`, 'Overwrite', true))) return null;
  }
  putPreset(name, layout);
  setBaseline({ kind: 'user', id: name });
  toast(`Saved preset “${name}”.`);
  return name;
}

/** Overwrite the active user preset with the current layout. */
export function updateActivePreset(): void {
  const s = presetStore.get();
  const layout = grid.save();
  if (!s.active || s.active.kind !== 'user' || !layout) return;
  putPreset(s.active.id, layout);
  setBaseline(s.active);
  toast(`Updated “${s.active.id}”.`);
}

export async function renamePreset(name: string): Promise<void> {
  const raw = await askText({
    title: 'Rename preset',
    label: 'New name',
    initial: name,
    confirmLabel: 'Rename',
    validate: (v) =>
      nameError(v, name) ?? (v.trim() !== name && presetStore.get().user.some((p) => p.name === v.trim()) ? 'Another preset has that name' : null),
  });
  if (raw === null || raw.trim() === name) return;
  const next = raw.trim();
  presetStore.set((s) => ({
    user: s.user.map((p) => (p.name === name ? { ...p, name: next, layout: { ...p.layout, name: next } } : p)),
    active: s.active?.kind === 'user' && s.active.id === name ? { kind: 'user', id: next } : s.active,
  }));
  saveUser();
  saveState();
}

export function duplicatePreset(name: string): void {
  const s = presetStore.get();
  const p = s.user.find((x) => x.name === name);
  if (!p) return;
  const copy = uniqueName(
    `${name} copy`,
    s.user.map((x) => x.name),
  );
  putPreset(copy, p.layout);
  toast(`Created “${copy}”.`);
}

/** Built-ins are read-only: apply one, then save it under a new name to edit the copy. */
export async function duplicateBuiltin(id: string): Promise<void> {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  if (!(await requestPreset({ kind: 'builtin', id }))) return;
  await new Promise((r) => window.setTimeout(r, 200));
  await savePresetAs(
    uniqueName(
      `${p.name} copy`,
      presetStore.get().user.map((x) => x.name),
    ),
  );
}

export async function deletePreset(name: string): Promise<void> {
  if (!(await confirmDialog('Delete preset?', `“${name}” will be removed. The current layout stays as it is.`, 'Delete', true))) return;
  presetStore.set((s) => ({ user: s.user.filter((p) => p.name !== name) }));
  saveUser();
  if (presetStore.get().active?.kind === 'user' && presetStore.get().active?.id === name) setBaseline(null);
}

interface PresetFile {
  brownoutPresets: number;
  presets: { name: string; layout: SavedLayout }[];
}

export async function exportPresets(): Promise<void> {
  const user = presetStore.get().user;
  if (!user.length) {
    toast('No saved presets to export yet. Use “Save current layout as preset…” first.');
    return;
  }
  const ids = await askChecklist({
    title: 'Export presets',
    message: 'Choose the presets to put in the file. Share it with your team; they load it with Import presets.',
    items: user.map((p) => ({ id: p.name, label: p.name, checked: true })),
    confirmLabel: 'Export…',
  });
  if (!ids) return;
  const file: PresetFile = {
    brownoutPresets: FILE_VERSION,
    presets: user.filter((p) => ids.includes(p.name)).map((p) => ({ name: p.name, layout: p.layout })),
  };
  const fileName = ids.length === 1 ? `${ids[0].replace(/[^\w-]+/g, '_')}.brownout-preset.json` : 'brownout-presets.json';
  await saveText(fileName, JSON.stringify(file, null, 2), [{ name: 'Brownout presets', extensions: ['json'] }]);
}

/** Read presets out of a file's text. Accepts preset files and single saved layouts from older versions. */
export function parsePresetFile(text: string, fallbackName: string): { name: string; layout: SavedLayout }[] {
  const j = JSON.parse(text) as Partial<PresetFile> & Partial<SavedLayout>;
  if (Array.isArray(j.presets)) return j.presets.filter((p) => p && typeof p.name === 'string' && p.layout?.dock && p.layout.panels);
  if (j.dock && j.panels) return [{ name: (j.name ?? fallbackName).trim() || fallbackName, layout: j as SavedLayout }];
  throw new Error('This file has no Brownout presets in it');
}

export async function importPresets(): Promise<void> {
  const f = await pickJson('Import presets');
  if (!f) return;
  let incoming: { name: string; layout: SavedLayout }[];
  try {
    incoming = parsePresetFile(f.text, f.name.replace(/(\.brownout(-preset)?)?\.json$/i, ''));
  } catch (e) {
    toast(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`, 'error');
    return;
  }
  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  let forAll: string | null = null;
  for (const p of incoming) {
    let name = p.name;
    const builtinClash = PRESETS.some((b) => b.name.toLowerCase() === name.toLowerCase());
    if (builtinClash)
      name = uniqueName(
        `${name} (imported)`,
        presetStore.get().user.map((x) => x.name),
      );
    const exists = presetStore.get().user.some((x) => x.name === name);
    if (exists) {
      let choice: string | null = forAll;
      if (!choice) {
        const r = await askChoice({
          title: 'Preset already exists',
          message: `You already have a preset named “${name}”. What should happen to the imported one?`,
          options: [
            { id: 'skip', label: 'Skip' },
            { id: 'both', label: 'Keep both' },
            { id: 'overwrite', label: 'Overwrite', danger: true },
          ],
          checkbox: incoming.length > 1 ? 'Do the same for the other clashes in this file' : undefined,
        });
        choice = r.id ?? 'skip';
        if (r.checked) forAll = choice;
      }
      if (choice === 'skip') {
        skipped++;
        continue;
      }
      if (choice === 'both')
        name = uniqueName(
          `${name} (imported)`,
          presetStore.get().user.map((x) => x.name),
        );
      else overwritten++;
    }
    putPreset(name, p.layout);
    if (!exists || name !== p.name) added++;
    // an overwritten active preset no longer matches what's on screen
    const a = presetStore.get().active;
    if (a?.kind === 'user' && a.id === name) scheduleCheck();
  }
  const parts = [`${added} added`];
  if (overwritten) parts.push(`${overwritten} overwritten`);
  if (skipped) parts.push(`${skipped} skipped`);
  toast(`Imported presets from ${f.name}: ${parts.join(', ')}.`);
}
