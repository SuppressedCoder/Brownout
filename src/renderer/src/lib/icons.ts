/**
 * Brownout's own icon set. Every icon is drawn on a 16 x 16 grid with one
 * line weight, as plain path data, so the same definitions serve the React
 * <Icon> component (SVG) and the canvases (Path2D). The interface uses no
 * emoji or pictograph characters: add an icon here instead.
 */
export interface IconDef {
  /** Paths drawn as lines (1.5 units, round caps). */
  stroke?: string[];
  /** Paths filled solid. */
  fill?: string[];
}

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const STAR = 'M8 1.9l1.85 3.9 4.25.55-3.1 2.95.78 4.2L8 11.45 4.22 13.5 5 9.3 1.9 6.35l4.25-.55z';
const BOLT = 'M9.2 1.8 3.8 9h3.6l-.6 5.2L12.2 7H8.6z';
const FRAME = 'M2.5 2.5h11v11h-11z';

export const ICONS = {
  menu: { stroke: ['M2.5 4.5h11M2.5 8h11M2.5 11.5h11'] },
  folder: { stroke: ['M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.5h6c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z'] },
  download: { stroke: ['M8 2.5v8M4.8 7.4 8 10.6l3.2-3.2M2.8 13.5h10.4'] },
  upload: { stroke: ['M8 10.6v-8M4.8 5.7 8 2.5l3.2 3.2M2.8 13.5h10.4'] },
  close: { stroke: ['M4 4l8 8M12 4l-8 8'] },
  check: { stroke: ['M3 8.6l3.2 3.1L13 4.8'] },
  chevronDown: { stroke: ['M4 6.2l4 4 4-4'] },
  chevronRight: { stroke: ['M6.2 4l4 4-4 4'] },
  chevronUp: { stroke: ['M4 9.8l4-4 4 4'] },
  star: { stroke: [STAR] },
  starFilled: { stroke: [STAR], fill: [STAR] },
  gear: {
    stroke: [
      'M6.90 3.23L7.08 1.46L8.92 1.46L9.10 3.23L10.60 3.84L11.97 2.73L13.27 4.03L12.16 5.40L12.77 6.90L14.54 7.08L14.54 8.92L12.77 9.10L12.16 10.60L13.27 11.97L11.97 13.27L10.60 12.16L9.10 12.77L8.92 14.54L7.08 14.54L6.90 12.77L5.40 12.16L4.03 13.27L2.73 11.97L3.84 10.60L3.23 9.10L1.46 8.92L1.46 7.08L3.23 6.90L3.84 5.40L2.73 4.03L4.03 2.73L5.40 3.84z',
      circle(8, 8, 1.9),
    ],
  },
  help: { stroke: [circle(8, 8, 6), 'M6.1 6.3a1.95 1.95 0 1 1 2.9 1.7c-.6.35-1 .8-1 1.5'], fill: [circle(8, 11.6, 0.8)] },
  potato: {
    stroke: ['M3.9 5.1C5.2 2.9 8.3 2 10.9 3.2c2.9 1.3 3.9 4.6 2.5 7.2-1.3 2.5-4.6 3.6-7.6 2.6C2.6 11.9 2 8.2 3.9 5.1z'],
    fill: [circle(6.6, 6.6, 0.7), circle(10.2, 7.4, 0.7), circle(7.6, 10.1, 0.7)],
  },
  pencil: { stroke: ['M10.6 2.9l2.5 2.5-7.4 7.4-3 .5.5-3zM9.2 4.3l2.5 2.5'] },
  copy: { stroke: ['M6.5 5.5H12a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z', 'M3 10.3V4a1 1 0 0 1 1-1h6.3'] },
  trash: { stroke: ['M2.8 4.5h10.4M6.3 4.5V3h3.4v1.5M4.3 4.5l.6 8.3c0 .4.4.7.8.7h4.6c.4 0 .8-.3.8-.7l.6-8.3M6.8 7v4M9.2 7v4'] },
  refresh: { stroke: ['M12.9 8a4.9 4.9 0 1 1-1.5-3.5', 'M13 2.6v2.7h-2.7'] },
  plus: { stroke: ['M8 3v10M3 8h10'] },
  minus: { stroke: ['M3 8h10'] },
  play: { fill: ['M5 3.2l8 4.8-8 4.8z'] },
  pause: { fill: ['M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z'] },
  skipBack: { stroke: ['M4 3.5v9'], fill: ['M12.5 3.5v9L6 8z'] },
  skipForward: { stroke: ['M12 3.5v9'], fill: ['M3.5 3.5v9L10 8z'] },
  phasePrev: { stroke: ['M3 3v10M13 8H6M8.8 5.2 6 8l2.8 2.8'] },
  phaseNext: { stroke: ['M13 3v10M3 8h7M7.2 5.2 10 8l-2.8 2.8'] },
  bookmark: { stroke: ['M4.5 2.5h7v11L8 10.9l-3.5 2.6z'] },
  heightCompact: { stroke: [FRAME], fill: ['M2.5 11h11v2.5h-11z'] },
  heightStandard: { stroke: [FRAME], fill: ['M2.5 8h11v5.5h-11z'] },
  heightExpanded: { stroke: [FRAME], fill: ['M2.5 5h11v8.5h-11z'] },
  track: { stroke: ['M2 4.5h12M2 11.5h12'], fill: ['M4 6.5h5v3H4z'] },
  more: { fill: [circle(3.5, 8, 1.2), circle(8, 8, 1.2), circle(12.5, 8, 1.2)] },
  graph: { stroke: ['M2.5 2.5v11h11M4.8 10.4l2.4-3.2 2.3 1.9 3.4-4.8'] },
  field: { stroke: ['M1.8 3.8h12.4v8.4H1.8zM8 3.8v8.4', circle(8, 8, 1.7)] },
  table: { stroke: ['M2.2 3h11.6v10H2.2zM2.2 6.4h11.6M2.2 9.7h11.6M6.4 3v10'] },
  console: { stroke: ['M2 3h12v10H2zM4.6 6.2 6.8 8l-2.2 1.8M8.2 10h3.2'] },
  stats: { stroke: ['M2.5 13.5h11M4.2 13.5V9.2M7 13.5V4M9.8 13.5V6.8M12.4 13.5v-2.8'] },
  power: { stroke: [BOLT] },
  bolt: { stroke: [BOLT], fill: [BOLT] },
  paths: { stroke: ['M3.6 12.2C3.6 6.4 12.4 9.6 12.4 3.8'], fill: [circle(3.6, 12.2, 1.3), circle(12.4, 3.8, 1.3)] },
  compare: { stroke: ['M2.8 5.3h9.4M9.8 2.9l2.4 2.4-2.4 2.4M13.2 10.7H3.8M6.2 8.3l-2.4 2.4 2.4 2.4'] },
  info: { stroke: [circle(8, 8, 6), 'M8 7.3v4.1'], fill: [circle(8, 4.9, 0.8)] },
  swerve: { stroke: ['M4.2 4.2h7.6v7.6H4.2z', 'M2 2.6l1.8 2M12.2 2.6l1.8 2M2 11.4l1.8 2M12.2 11.4l1.8 2', 'M8 10.2V6M6.5 7.4 8 5.9l1.5 1.5'] },
  warning: { stroke: ['M8 2.4l6.2 10.8H1.8zM8 6.6v3.2'], fill: [circle(8, 11.5, 0.75)] },
  error: { stroke: [circle(8, 8, 6), 'M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4'] },
  clock: { stroke: [circle(8, 8, 6), 'M8 4.6V8l2.3 1.5'] },
  alert: { stroke: ['M8 1.8l6.2 6.2L8 14.2 1.8 8zM8 5.2v3.4'], fill: [circle(8, 10.6, 0.75)] },
  disconnect: { stroke: [circle(8, 8, 6), 'M3.8 12.2l8.4-8.4'] },
  image: { stroke: ['M2.2 3.2h11.6v9.6H2.2zM2.2 10.6l3.2-3.2 2.6 2.6 2-2 3.8 3.8'], fill: [circle(5.4, 6, 1)] },
  robot: { stroke: ['M3 6h10v7H3zM8 6V3.4'], fill: [circle(8, 2.8, 0.9), circle(6, 9.3, 0.9), circle(10, 9.3, 0.9)] },
  battery: { stroke: ['M1.8 5h11v6h-11zM14.2 7v2'], fill: ['M3.3 6.5h4.5v3H3.3z'] },
  blocks: { stroke: ['M2.5 3h4.5v4H2.5zM9 3h4.5v4H9zM5.8 9.5h4.5v4H5.8z'] },
  dot: { fill: [circle(8, 8, 3)] },
  gamepad: {
    stroke: [
      'M4.6 4.5h6.8c1.9 0 3.1 1.5 3.3 3.4l.3 2.6c.2 1.6-1.7 2.4-2.7 1.2L10.9 10H5.1l-1.4 1.7c-1 1.2-2.9.4-2.7-1.2l.3-2.6c.2-1.9 1.4-3.4 3.3-3.4z',
      'M4.2 7.3h2.2M5.3 6.2v2.2',
    ],
    fill: [circle(10.9, 7.3, 0.8)],
  },
  commands: { stroke: ['M2 4h12M2 8h12M2 12h12'], fill: ['M3.5 2.8h4v2.4h-4zM7 6.8h5.5v2.4H7zM4.5 10.8h3.5v2.4H4.5z'] },
  video: { stroke: ['M2 4.2h8.4v7.6H2zM10.4 7l3.6-2v6l-3.6-2'] },
  frameBack: { stroke: ['M9.8 4 5.8 8l4 4M3.5 4v8'] },
  frameForward: { stroke: ['M6.2 4l4 4-4 4M12.5 4v8'] },
  maximize: { stroke: ['M2.5 6.2V2.5h3.7M9.8 2.5h3.7v3.7M13.5 9.8v3.7H9.8M6.2 13.5H2.5V9.8'] },
  restore: { stroke: ['M6.2 2.5v3.7H2.5M9.8 2.5v3.7h3.7M13.5 9.8H9.8v3.7M2.5 9.8h3.7v3.7'] },
  soundOn: { stroke: ['M2.5 6.2h2.4L8.4 3.4v9.2L4.9 9.8H2.5z', 'M10.8 5.7a3.3 3.3 0 0 1 0 4.6M12.6 3.9a5.8 5.8 0 0 1 0 8.2'] },
  soundOff: { stroke: ['M2.5 6.2h2.4L8.4 3.4v9.2L4.9 9.8H2.5z', 'M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6'] },
  arrowUp: { stroke: ['M8 12.5v-9M4.5 7 8 3.5 11.5 7'] },
  arrowDown: { stroke: ['M8 3.5v9M4.5 9 8 12.5 11.5 9'] },
  report: { stroke: ['M4 2h5.5L12.5 5v9H4zM9.5 2v3h3M6 8h4.5M6 10.5h4.5'] },
  layers: { stroke: ['M8 2.5 14 6 8 9.5 2 6zM2.6 9.2 8 12.4l5.4-3.2'] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

const pathCache = new Map<string, { stroke: Path2D[]; fill: Path2D[] }>();

/** Draw an icon on a canvas, centered at (cx, cy). */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string): void {
  let p = pathCache.get(name);
  if (!p) {
    const d: IconDef = ICONS[name];
    p = { stroke: (d.stroke ?? []).map((s) => new Path2D(s)), fill: (d.fill ?? []).map((s) => new Path2D(s)) };
    pathCache.set(name, p);
  }
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 16, size / 16);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const s of p.fill) ctx.fill(s);
  for (const s of p.stroke) ctx.stroke(s);
  ctx.restore();
}
