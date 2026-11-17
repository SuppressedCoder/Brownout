/**
 * Draws the extra parts of a robot (robot profile "layers": shapes,
 * pictures, SVGs) on a canvas. The caller has already moved the canvas to
 * the robot's center and turned it to the robot's heading, so local +x is
 * forward and local -y is the robot's left.
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

/**
 * @param scale pixels per meter
 * @param logId log to read linked angles from (null in the editor preview)
 * @param preview angle in radians to show for linked parts when there is no log
 */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], scale: number, logId: string | null, raw: number, preview?: number): void {
  for (const l of layers) {
    ctx.save();
    ctx.globalAlpha *= l.opacity;
    if (l.link) {
      const px = l.pivot.x * scale;
      const py = -l.pivot.y * scale;
      ctx.translate(px, py);
      // canvas angles run clockwise, robot angles counter-clockwise
      ctx.rotate(-linkAngle(l, logId, raw, preview));
      ctx.translate(-px, -py);
    }
    ctx.translate(l.x * scale, -l.y * scale);
    ctx.rotate((-l.rotation * Math.PI) / 180);
    const w = l.length * scale;
    const h = l.width * scale;
    if (l.kind === 'image') {
      const img = l.src ? pictureImage(l.src) : null;
      if (img) {
        // a picture's top is the robot's front
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -h / 2, -w / 2, h, w);
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
