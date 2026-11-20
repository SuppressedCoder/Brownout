/**
 * Undo and redo (Ctrl+Z, Ctrl+Shift+Z, Edit menu) for what the user changes:
 *
 * - the panels: added, removed, moved, their settings, the timeline tracks
 *   (a resize alone or a zoom is not a step; see layoutSignature);
 * - the logs: opened, closed, their offsets, colors, hidden or shown, order,
 *   the alignment mode, match or whole log, and bookmarks;
 * - the robot profiles (parts, subsystems, cameras, ...).
 *
 * Moving around in time (cursor, zoom, playback) is navigation, not an edit,
 * and is never undone. Text boxes keep their own Ctrl+Z (the shortcut handler
 * leaves them alone).
 *
 * How: after changes settle (400 ms, and not while logs load) the state is
 * kept as a step. Only changes that follow the user's own input (a click, a
 * key) become steps; anything else (a panel filling in its defaults, a log
 * finishing loading at startup, a change made in another window) is taken
 * into the current step, so undo never fights it. Undoing a step puts back
 * only the parts that step changed. Undoing a closed log opens it again from
 * its file (lib/windowSync.ts).
 */
import { grid, type SavedLayout } from '../components/Grid';
import { panelStore } from '../state/panels';
import { sessionStore } from '../state/session';
import { profileStore, type ProfilesState } from '../state/profiles';
import { layoutSignature } from '../state/presets';
import { toast } from '../state/ui';
import { sessionNow, applySessionShape, type SharedSession } from './windowSync';

type ProfilesPart = Pick<ProfilesState, 'profiles' | 'assignments'>;

interface Step {
  layout: SavedLayout | null;
  layoutSig: string;
  session: SharedSession;
  sessionSig: string;
  profiles: ProfilesPart;
}

const MAX_STEPS = 100;
const SETTLE_MS = 400;

const steps: Step[] = [];
/** The step that matches the app now. */
let at = -1;
let timer = 0;
let applying = false;
/** When the user last clicked or pressed a key, and when that input was last used up by a step. */
let lastInput = -Infinity;
let usedAt = 0;
/** A change counts as the user's when it follows input not yet used up, from the last 15 s (opening a log through a dialog takes a while). */
const USER_WINDOW_MS = 15000;
const userActed = () => lastInput > usedAt && performance.now() - lastInput < USER_WINDOW_MS;
let started = false;

function now(): Step {
  const session = sessionNow();
  const p = profileStore.get();
  return {
    layout: grid.save(),
    layoutSig: layoutSignature(),
    session,
    sessionSig: JSON.stringify(session),
    profiles: { profiles: p.profiles, assignments: p.assignments },
  };
}

const sameLayout = (a: Step, b: Step) => a.layoutSig === b.layoutSig;
const sameSession = (a: Step, b: Step) => a.sessionSig === b.sessionSig;
const sameProfiles = (a: Step, b: Step) => a.profiles.profiles === b.profiles.profiles && a.profiles.assignments === b.profiles.assignments;

function schedule(): void {
  if (applying) return;
  clearTimeout(timer);
  timer = window.setTimeout(keep, SETTLE_MS);
}

/** Keep the state as a step if it changed: a new step after the user's input, otherwise part of the current one. */
function keep(): void {
  clearTimeout(timer);
  timer = 0;
  if (applying || at < 0) return;
  if (sessionStore.get().loadingItems.length) {
    schedule();
    return;
  }
  const s = now();
  const cur = steps[at];
  if (sameLayout(s, cur) && sameSession(s, cur) && sameProfiles(s, cur)) {
    steps[at] = s; // sizes and view state follow along
    return;
  }
  if (!userActed()) {
    steps[at] = s;
    return;
  }
  usedAt = performance.now();
  steps.splice(at + 1);
  steps.push(s);
  if (steps.length > MAX_STEPS) steps.shift();
  at = steps.length - 1;
}

/** What changed between two steps, for the toast. */
function describe(a: Step, b: Step): string {
  const parts: string[] = [];
  if (!sameLayout(a, b)) {
    const n = (s: Step) => Object.keys(s.layout?.panels ?? {}).length;
    parts.push(n(a) !== n(b) ? (n(a) < n(b) ? 'added panel' : 'removed panel') : 'panel change');
  }
  if (!sameSession(a, b)) {
    if (a.session.logs.length !== b.session.logs.length) parts.push(a.session.logs.length < b.session.logs.length ? 'opened log' : 'closed log');
    else if (JSON.stringify(a.session.bookmarks) !== JSON.stringify(b.session.bookmarks)) parts.push('bookmark');
    else parts.push('log change');
  }
  if (!sameProfiles(a, b)) parts.push('robot profile change');
  return parts.join(', ');
}

/** Put back the parts that differ between the step now and the one to go to. */
async function goTo(target: number): Promise<void> {
  const from = steps[at];
  const to = steps[target];
  applying = true;
  try {
    if (!sameLayout(from, to) && to.layout) grid.load(to.layout);
    if (!sameProfiles(from, to)) profileStore.set(to.profiles);
    if (!sameSession(from, to)) await applySessionShape(to.session);
  } finally {
    at = target;
    // what actually happened (a log that would not reopen) becomes the step
    steps[at] = now();
    // the undo key itself is not input for a new step
    usedAt = performance.now();
    applying = false;
  }
}

let busy = false;
async function move(dir: -1 | 1): Promise<void> {
  if (busy || at < 0) return;
  // a change still settling is a step of its own, undone first
  if (timer) keep();
  const target = at + dir;
  if (target < 0 || target >= steps.length) {
    toast(dir < 0 ? 'Nothing to undo.' : 'Nothing to redo.');
    return;
  }
  busy = true;
  const what = dir < 0 ? describe(steps[target], steps[at]) : describe(steps[at], steps[target]);
  try {
    await goTo(target);
    toast(`${dir < 0 ? 'Undone' : 'Redone'}: ${what}`);
  } finally {
    busy = false;
  }
}

export const undo = (): Promise<void> => move(-1);
export const redo = (): Promise<void> => move(1);

/** Start keeping steps from the state as it is now (after startup has restored the last session). */
export function startUndo(): void {
  if (started) return;
  started = true;
  steps.push(now());
  at = 0;
  const acted = () => {
    if (!applying) lastInput = performance.now();
  };
  window.addEventListener('pointerdown', acted, true);
  window.addEventListener('keydown', acted, true);
  window.addEventListener('drop', acted, true);
  panelStore.subscribe(schedule);
  sessionStore.subscribe(schedule);
  profileStore.subscribe(schedule);
  grid.onLayoutChange(schedule);
}
