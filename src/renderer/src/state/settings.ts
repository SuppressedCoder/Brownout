/**
 * User settings: appearance, keybind overrides, performance and behavior
 * switches. Persisted to localStorage; canvases and CSS read the theme
 * through lib/theme.ts.
 */
import { createStore } from './store';

export type ThemeId = 'dark' | 'light' | 'contrast';

export interface ModeColors {
  disabled: string;
  auto: string;
  teleop: string;
  test: string;
  estop: string;
}

export interface Settings {
  theme: ThemeId;
  /** One color per open log, in the order logs are opened. */
  logColors: string[];
  modeColors: ModeColors;
  /** Action id -> key combo. Only overrides of the defaults; '' means unbound. */
  keybinds: Record<string, string>;
  /** Low-detail rendering for slow machines or very dense data. */
  potato: boolean;
  /** Offer Potato mode when frames are slow. */
  offerPotato: boolean;
  /** Let graphs and the field pan/zoom/scrub the shared time (off: only the timeline bar does). */
  panelsMoveTime: boolean;
  /** Reopen the last session's logs on launch. */
  restoreSession: boolean;
  /** Always use compact view (off: only panels and windows that are narrow). */
  compact: boolean;
}

export const DEFAULT_LOG_COLORS = ['#4f9ef7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#edc948', '#76b7b2', '#ff9da7'];
export const DEFAULT_MODE_COLORS: ModeColors = { disabled: '#6b6f78', auto: '#f5a623', teleop: '#4f9ef7', test: '#b07aa1', estop: '#e15759' };

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  logColors: DEFAULT_LOG_COLORS,
  modeColors: DEFAULT_MODE_COLORS,
  keybinds: {},
  potato: false,
  offerPotato: true,
  panelsMoveTime: false,
  restoreSession: true,
  compact: false,
};

const KEY = 'brownout.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...p,
      logColors: Array.isArray(p.logColors) && p.logColors.length === DEFAULT_LOG_COLORS.length ? p.logColors : DEFAULT_LOG_COLORS,
      modeColors: { ...DEFAULT_MODE_COLORS, ...(p.modeColors ?? {}) },
      keybinds: p.keybinds ?? {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(load());

settingsStore.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
});

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set(patch);
}

export const isPotato = (): boolean => settingsStore.get().potato;
