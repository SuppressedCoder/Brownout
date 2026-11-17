/** Shared canvas drawing helpers: ticks, time axis, mode shading, cursor. */
import { formatTime } from '@core/alignment';
import type { LogEntry } from '../state/session';
import { T, modeSolid, modeFill } from './theme';

export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  const m = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10;
  return m * p;
}

export function timeTicks(t0: number, t1: number, width: number): number[] {
  const span = t1 - t0;
  const target = Math.max(2, Math.floor(width / 90));
  let step = niceStep(span, target);
  // prefer "clock" steps for larger spans
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) {
    if (s >= step) {
      step = s;
      break;
    }
  }
  const out: number[] = [];
  const first = Math.ceil(t0 / step) * step;
  for (let t = first; t <= t1 + 1e-9; t += step) out.push(Math.round(t / step) * step);
  return out;
}

export function drawTimeAxis(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, t0: number, t1: number, gridTop = 0): void {
  const ticks = timeTicks(t0, t1, x1 - x0);
  ctx.save();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  const pal = T();
  ctx.fillStyle = pal.fg2;
  ctx.strokeStyle = pal.grid;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of ticks) {
    const x = x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, gridTop);
    ctx.lineTo(Math.round(x) + 0.5, y);
    ctx.stroke();
    ctx.fillText(formatTime(t, t1 - t0 < 2 ? 3 : t1 - t0 < 30 ? 2 : 0), x, y + 3);
  }
  ctx.restore();
}

/** Shade robot-mode bands of one log between y0 and y1. */
export function drawModeBands(
  ctx: CanvasRenderingContext2D,
  log: LogEntry,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  t0: number,
  t1: number,
  solid = false,
): void {
  const xOf = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  for (const r of log.robotState.ranges) {
    const a = r.start + log.offset;
    const b = r.end + log.offset;
    if (b < t0 || a > t1) continue;
    const xa = Math.max(x0, xOf(a));
    const xb = Math.min(x1, xOf(b));
    if (xb - xa < 0.5) continue;
    if (r.mode === 'disabled' && !solid) continue;
    ctx.fillStyle = solid ? modeSolid(r.estop ? 'estop' : r.mode) : modeFill(r.estop ? 'estop' : r.mode);
    ctx.fillRect(xa, y0, xb - xa, y1 - y0);
    if (r.estop) {
      ctx.save();
      ctx.strokeStyle = T().fieldLine;
      ctx.lineWidth = 1;
      for (let x = xa; x < xb; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(Math.min(xb, x + 6), y0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, color: string = T().cursor, dashed = false): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (dashed) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, y0);
  ctx.lineTo(Math.round(x) + 0.5, y1);
  ctx.stroke();
  ctx.restore();
}

export function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
  return v.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * The text, shortened with an ellipsis to fit maxWidth in the current font.
 * (fillText's own maxWidth squeezes the letters instead, which is hard to read.)
 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '\u2026').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + '\u2026' : '';
}
