/**
 * Frame-cost monitor. Canvases report how long each draw took; if drawing
 * regularly eats most of a frame, the app offers Potato mode (once per run).
 */
import { settingsStore, updateSettings } from '../state/settings';
import { toast } from '../state/ui';

const WINDOW = 90; // frames considered
const SLOW_MS = 28; // total draw time per frame that counts as slow
const SLOW_FRAMES = 30; // slow frames within the window that trigger the offer

let frameCost = 0;
let frameScheduled = false;
const history: number[] = [];
let offered = false;

function endFrame() {
  frameScheduled = false;
  history.push(frameCost);
  frameCost = 0;
  if (history.length > WINDOW) history.shift();
  if (offered || history.length < WINDOW) return;
  const s = settingsStore.get();
  if (s.potato || !s.offerPotato) return;
  let slow = 0;
  for (const c of history) if (c > SLOW_MS) slow++;
  if (slow >= SLOW_FRAMES) {
    offered = true;
    toast('Drawing is running slowly with this much data.', 'info', [
      { label: 'Turn on Potato mode', run: () => updateSettings({ potato: true }) },
      { label: "Don't ask again", run: () => updateSettings({ offerPotato: false }) },
    ]);
  }
}

export function reportDraw(ms: number): void {
  frameCost += ms;
  if (!frameScheduled) {
    frameScheduled = true;
    // close the frame after every canvas scheduled for this frame has drawn
    requestAnimationFrame(endFrame);
  }
}

/** Average draw cost per active frame over the recent window, for the settings page. */
export function recentFrameCost(): number {
  if (!history.length) return 0;
  return history.reduce((a, b) => a + b, 0) / history.length;
}
