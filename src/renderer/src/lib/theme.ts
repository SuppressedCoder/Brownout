/**
 * Theme palettes. One object per theme feeds both the CSS variables (set on
 * the root element) and the canvas drawing code, which calls T() each frame.
 */
import { settingsStore, type ThemeId, type ModeColors } from '../state/settings';
import { withAlpha, type Tone } from './colors';

export interface Palette {
  id: ThemeId;
  dark: boolean;
  bg: string;
  bg2: string;
  bg3: string;
  line: string;
  fg: string;
  fg2: string;
  /** Maximum-contrast text (white on dark themes, black on light). */
  strong: string;
  accent: string;
  activeBg: string;
  hoverBg: string;
  warn: string;
  err: string;
  ok: string;
  errText: string;
  warnText: string;
  // canvas
  plotBg: string;
  grid: string;
  rowBg: string;
  selection: string;
  cursor: string;
  hoverCursor: string;
  legendBg: string;
  /** Text drawn on top of solid mode bands / state segments. */
  onBand: string;
  fieldBg: string;
  fieldLine: string;
  fieldGrid: string;
  /** Alpha used for mode shading behind graphs. */
  modeAlpha: number;
}

const PALETTES: Record<ThemeId, Palette> = {
  dark: {
    id: 'dark',
    dark: true,
    bg: '#15171c',
    bg2: '#1b1e25',
    bg3: '#23262e',
    line: '#2e323b',
    fg: '#e8eaed',
    fg2: '#9aa0a6',
    strong: '#ffffff',
    accent: '#4f9ef7',
    activeBg: '#2b4a75',
    hoverBg: 'rgba(255,255,255,0.06)',
    warn: '#edc948',
    err: '#e15759',
    ok: '#59a14f',
    errText: '#ff9da7',
    warnText: '#f1d978',
    plotBg: '#1b1e25',
    grid: 'rgba(255,255,255,0.08)',
    rowBg: 'rgba(255,255,255,0.035)',
    selection: 'rgba(255,255,255,0.08)',
    cursor: '#ffffff',
    hoverCursor: 'rgba(255,255,255,0.45)',
    legendBg: 'rgba(20,22,28,0.84)',
    onBand: 'rgba(0,0,0,0.78)',
    fieldBg: '#2a2f3a',
    fieldLine: 'rgba(255,255,255,0.35)',
    fieldGrid: 'rgba(255,255,255,0.06)',
    modeAlpha: 0.13,
  },
  light: {
    id: 'light',
    dark: false,
    bg: '#ffffff',
    bg2: '#f1f3f6',
    bg3: '#e4e8ee',
    line: '#c9cfd8',
    fg: '#1c2026',
    fg2: '#5a6370',
    strong: '#000000',
    accent: '#1b6fd1',
    activeBg: '#cfe2fb',
    hoverBg: 'rgba(0,0,0,0.06)',
    warn: '#a87900',
    err: '#c6303a',
    ok: '#2f7d32',
    errText: '#b3202a',
    warnText: '#8a6300',
    plotBg: '#f7f8fa',
    grid: 'rgba(0,0,0,0.09)',
    rowBg: 'rgba(0,0,0,0.04)',
    selection: 'rgba(0,0,0,0.08)',
    cursor: '#000000',
    hoverCursor: 'rgba(0,0,0,0.45)',
    legendBg: 'rgba(255,255,255,0.9)',
    onBand: 'rgba(0,0,0,0.82)',
    fieldBg: '#dfe4ea',
    fieldLine: 'rgba(0,0,0,0.45)',
    fieldGrid: 'rgba(0,0,0,0.07)',
    modeAlpha: 0.2,
  },
  contrast: {
    id: 'contrast',
    dark: true,
    bg: '#000000',
    bg2: '#0c0c0c',
    bg3: '#1c1c1c',
    line: '#777777',
    fg: '#ffffff',
    fg2: '#d6d6d6',
    strong: '#ffffff',
    accent: '#7cc0ff',
    activeBg: '#0f4f8f',
    hoverBg: 'rgba(255,255,255,0.14)',
    warn: '#ffe14d',
    err: '#ff6b6b',
    ok: '#6fe06f',
    errText: '#ff9a9a',
    warnText: '#ffe14d',
    plotBg: '#000000',
    grid: 'rgba(255,255,255,0.22)',
    rowBg: 'rgba(255,255,255,0.08)',
    selection: 'rgba(255,255,255,0.16)',
    cursor: '#ffffff',
    hoverCursor: 'rgba(255,255,255,0.7)',
    legendBg: 'rgba(0,0,0,0.92)',
    onBand: '#000000',
    fieldBg: '#161616',
    fieldLine: 'rgba(255,255,255,0.7)',
    fieldGrid: 'rgba(255,255,255,0.14)',
    modeAlpha: 0.24,
  },
};

export const THEME_LABELS: [ThemeId, string][] = [
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['contrast', 'High contrast'],
];

/** The current palette (cheap: one store read). */
export function T(): Palette {
  return PALETTES[settingsStore.get().theme] ?? PALETTES.dark;
}

export function modeSolid(mode: keyof ModeColors | string): string {
  const m = settingsStore.get().modeColors as unknown as Record<string, string>;
  return m[mode] ?? m.disabled;
}

/** Translucent mode color for shading behind graphs. */
export function modeFill(mode: string): string {
  const p = T();
  return withAlpha(modeSolid(mode), mode === 'estop' ? p.modeAlpha * 2.2 : mode === 'disabled' ? p.modeAlpha * 0.7 : p.modeAlpha);
}

export function toneColor(tone: Tone): string {
  const p = T();
  switch (tone) {
    case 'err':
      return p.err;
    case 'warn':
      return p.warn;
    case 'orange':
      return p.dark ? '#f28e2b' : '#c9670a';
    case 'pink':
      return p.dark ? '#ff9da7' : '#c2417a';
    case 'purple':
      return p.dark ? '#c39bd3' : '#7b4a94';
  }
}

export function severityColor(sev: string): string {
  const p = T();
  return sev === 'error' ? p.err : sev === 'warning' ? p.warn : p.fg2;
}

/** The colors panels are marked with, by number (tabs, the field list); see lib/panelLinks.ts. */
const PANEL_COLORS_DARK = ['#4f9ef7', '#59c27a', '#f28e2b', '#b07aa1', '#edc948', '#76b7b2', '#ff9da7', '#9c9ede'];
const PANEL_COLORS_LIGHT = ['#1b6fd1', '#2f8a4a', '#c9670a', '#8a4f7d', '#a87900', '#2f7f79', '#c2417a', '#5a5fc0'];
export function panelColors(): string[] {
  return T().dark ? PANEL_COLORS_DARK : PANEL_COLORS_LIGHT;
}

export function applyTheme(): void {
  const p = T();
  const root = document.documentElement;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--bg', p.bg);
  set('--bg2', p.bg2);
  set('--bg3', p.bg3);
  set('--line', p.line);
  set('--fg', p.fg);
  set('--fg2', p.fg2);
  set('--strong', p.strong);
  set('--accent', p.accent);
  set('--active-bg', p.activeBg);
  set('--hover-bg', p.hoverBg);
  set('--warn', p.warn);
  set('--err', p.err);
  set('--ok', p.ok);
  set('--err-text', p.errText);
  set('--warn-text', p.warnText);
  set('--accent-soft', withAlpha(p.accent, 0.2));
  panelColors().forEach((c, i) => set(`--panel-${i + 1}`, c));
  set('--on-panel', p.dark ? 'rgba(0,0,0,0.85)' : '#ffffff');
  root.dataset.theme = p.id;
  root.style.colorScheme = p.dark ? 'dark' : 'light';
}

let last = '';
export function startTheme(): void {
  applyTheme();
  settingsStore.subscribe((s) => {
    if (s.theme !== last) {
      last = s.theme;
      applyTheme();
    }
  });
}
