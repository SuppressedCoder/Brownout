/** Color helpers that don't depend on the theme. Theme-dependent colors live in lib/theme.ts. */
import type { IconName } from './icons';

export const MODE_LABEL: Record<string, string> = { disabled: 'DISABLED', auto: 'AUTO', teleop: 'TELEOP', test: 'UTILITY', estop: 'E-STOP' };

export type Tone = 'err' | 'warn' | 'orange' | 'pink' | 'purple';

/** How each kind of event is marked on the timeline and in lists: one of the app's icons, in a tone. */
export const EVENT_GLYPHS: Record<string, { icon: IconName; tone: Tone; label: string }> = {
  brownout: { icon: 'bolt', tone: 'err', label: 'Brownout' },
  reboot: { icon: 'refresh', tone: 'orange', label: 'Program start' },
  overrun: { icon: 'clock', tone: 'warn', label: 'Loop overrun' },
  error: { icon: 'error', tone: 'err', label: 'Error' },
  warning: { icon: 'warning', tone: 'warn', label: 'Warning' },
  alert: { icon: 'alert', tone: 'pink', label: 'Alert' },
  disconnect: { icon: 'disconnect', tone: 'purple', label: 'Disconnect' },
  vision: { icon: 'target', tone: 'orange', label: 'Position and vision' },
};

/** Line dash per field index so overlaid logs keep one color per log and one style per field. */
export const FIELD_DASHES: number[][] = [[], [6, 4], [2, 3], [8, 3, 2, 3], [1, 2]];

export function withAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/** A stable color for a string (state tracks). */
export function stringColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 55%)`;
}
