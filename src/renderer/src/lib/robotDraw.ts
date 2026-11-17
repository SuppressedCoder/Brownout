/**
 * Draws the extra parts of a robot (robot profile "layers": shapes,
 * pictures, SVGs) on a canvas. The caller has already moved the canvas to
 * the robot's center and turned it to the robot's heading, so local +x is
 * forward and local -y is the robot's left.
 *
 * A part can be attached to another part (`parent`): it then moves with that
 * part, turning about the parent's pivot by the parent's angle, and its own
 * angle (if it is linked) adds on top, like a wrist on an arm. Positions and
 * pivots are given with every angle at zero.
 *
 * SVG pictures are turned into bitmaps once per size and reused: drawing an
 * SVG straight onto a canvas rasterizes it again on every frame.
 */
import type { Layer } from '../state/profiles';
import { pictureImage } from './fieldAssets';
import { client } from '../worker/client';
import { indexAtOrBefore } from '@core/log';

/** A linked part's angle in radians (counter-clockwise), or its fixed offset when the field has no value yet. */
export function linkAngle(layer: Layer, logId: string | null, raw: number, preview?: number): number {
  if (!layer.link) return 0;
  const offset = (layer.link.offset * Math.PI) / 180;
  let value = preview ?? 0;
  if (logId) {
    const s = client.peekSeries(logId, layer.link.key);
    if (s && s.kind === 'number') {
      const i = indexAtOrBefore(s.t, raw);
      value = i >= 0 && Number.isFinite(s.v[i]) ? s.v[i] : 0;
      if (layer.link.unit === 'deg') value = (value * Math.PI) / 180;
      else if (layer.link.unit === 'rot') value *= Math.PI * 2;
    } else value = 0;
  }
  return (layer.link.invert ? -value : value) + offset;
}

/** The parts a part is attached to, outermost first (the one attached to the robot comes first). Stops at a loop. */
export function ancestors(layer: Layer, layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  const seen = new Set<string>([layer.id]);
  let p = layer.parent ? layers.find((l) => l.id === layer.parent) : undefined;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    out.unshift(p);
    p = p.parent ? layers.find((l) => l.id === p!.parent) : undefined;
  }
  return out;
}

/** Turn the canvas by a linked part's angle about its pivot. */
function turnAboutPivot(ctx: CanvasRenderingContext2D, l: Layer, scale: number, angle: number): void {
  if (!l.link) return;
  const px = l.pivot.x * scale;
  const py = -l.pivot.y * scale;
  ctx.translate(px, py);
  // canvas angles run clockwise, robot angles counter-clockwise
  ctx.rotate(-angle);
  ctx.translate(-px, -py);
}

/**
 * Move the canvas into a part's own frame: the turns of the parts it hangs from, its own turn, then
 * its position and fixed rotation. Afterwards the part's center is at 0,0 and its length runs along +x.
 */
export function enterPart(ctx: CanvasRenderingContext2D, l: Layer, layers: Layer[], scale: number, logId: string | null, raw: number, preview?: number): void {
  for (const a of ancestors(l, layers)) turnAboutPivot(ctx, a, scale, linkAngle(a, logId, raw, preview));
  turnAboutPivot(ctx, l, scale, linkAngle(l, logId, raw, preview));
  ctx.translate(l.x * scale, -l.y * scale);
  ctx.rotate((-l.rotation * Math.PI) / 180);
}

/** Like enterPart, but stops before the part's own turn: the frame its pivot is given in. */
export function enterPivotFrame(
  ctx: CanvasRenderingContext2D,
  l: Layer,
  layers: Layer[],
  scale: number,
  logId: string | null,
  raw: number,
  preview?: number,
): void {
  for (const a of ancestors(l, layers)) turnAboutPivot(ctx, a, scale, linkAngle(a, logId, raw, preview));
}

// --- SVGs as bitmaps -------------------------------------------------------

const rasters = new Map<string, HTMLCanvasElement>();
const RASTER_LIMIT = 48;

/** The picture to draw at about wPx x hPx device pixels: a cached bitmap for an SVG, the image itself otherwise. */
function drawable(src: string, img: HTMLImageElement, wPx: number, hPx: number): CanvasImageSource {
  if (!src.startsWith('data:image/svg')) return img;
  // sizes in steps of about 19% so zooming reuses a few bitmaps
  const bucket = (v: number) => Math.min(4096, Math.max(16, Math.round(Math.pow(2, Math.ceil(Math.log2(Math.max(1, v)) * 4) / 4))));
  const bw = bucket(wPx);
  const bh = bucket(hPx);
  const key = `${bw}x${bh}|${src.length}|${src.slice(-64)}|${src.slice(26, 90)}`;
  let c = rasters.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    c.getContext('2d')?.drawImage(img, 0, 0, bw, bh);
    rasters.set(key, c);
    if (rasters.size > RASTER_LIMIT) rasters.delete(rasters.keys().next().value as string);
  } else {
    // most recently used last
    rasters.delete(key);
    rasters.set(key, c);
  }
  return c;
}

/**
 * @param scale pixels per meter
 * @param logId log to read linked angles from (null in the editor preview)
 * @param preview angle in radians to show for linked parts when there is no log
 * @param hidden ids of parts not to draw (the field's Display menu)
 */
export function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  scale: number,
  logId: string | null,
  raw: number,
  preview?: number,
  hidden?: ReadonlySet<string>,
): void {
  for (const l of layers) {
    if (hidden?.has(l.id)) continue;
    ctx.save();
    ctx.globalAlpha *= l.opacity;
    enterPart(ctx, l, layers, scale, logId, raw, preview);
    const w = l.length * scale;
    const h = l.width * scale;
    if (l.kind === 'image') {
      const img = l.src ? pictureImage(l.src) : null;
      if (img && l.src) {
        // a picture's top is the robot's front
        ctx.rotate(Math.PI / 2);
        const m = ctx.getTransform();
        const k = Math.hypot(m.a, m.b);
        ctx.drawImage(drawable(l.src, img, h * k, w * k), -h / 2, -w / 2, h, w);
      }
    } else {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      if (l.kind === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
    }
    ctx.restore();
  }
}
