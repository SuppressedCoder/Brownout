/**
 * Canvas panels draw outside React: a ResizeObserver sizes the canvas for
 * device pixels, and a redraw is scheduled (at most once per frame) whenever
 * a subscribed store changes or a series arrives.
 *
 * - Canvases with no size (panels in hidden tabs) don't draw at all.
 * - Potato mode: 1x resolution and at most ~30 draws per second.
 * - Every draw's cost is reported to the frame monitor (lib/perf.ts).
 */
import { useEffect, useRef } from 'react';
import type { Store } from '../state/store';
import { client } from '../worker/client';
import { settingsStore } from '../state/settings';
import { reportDraw } from './perf';

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  width: number; // CSS pixels
  height: number;
  dpr: number;
  potato: boolean;
}

const POTATO_FRAME_MS = 33;

export function useCanvas(
  draw: (dc: DrawContext) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: Store<any>[],
  deps: unknown[] = [],
): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    let timer = 0;
    let lastPaint = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const size = () => {
      dpr = settingsStore.get().potato ? 1 : window.devicePixelRatio || 1;
      const cw = Math.floor(w * dpr);
      const ch = Math.floor(h * dpr);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
    };
    const paint = () => {
      raf = 0;
      if (w === 0 || h === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const start = performance.now();
      lastPaint = start;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      try {
        drawRef.current({ ctx, width: w, height: h, dpr, potato: settingsStore.get().potato });
      } catch (e) {
        console.error(e);
      }
      reportDraw(performance.now() - start);
    };
    const schedule = () => {
      if (raf || timer || w === 0 || h === 0) return;
      if (settingsStore.get().potato) {
        const wait = POTATO_FRAME_MS - (performance.now() - lastPaint);
        if (wait > 1) {
          timer = window.setTimeout(() => {
            timer = 0;
            raf = requestAnimationFrame(paint);
          }, wait);
          return;
        }
      }
      raf = requestAnimationFrame(paint);
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      w = Math.floor(r.width);
      h = Math.floor(r.height);
      if (w === 0 || h === 0) return; // hidden: keep the last bitmap, draw nothing
      size();
      schedule();
    });
    ro.observe(canvas.parentElement ?? canvas);
    const unsubs = stores.map((s) => s.subscribe(schedule));
    unsubs.push(client.subscribe(schedule));
    unsubs.push(
      settingsStore.subscribe(() => {
        if (w && h) size();
        schedule();
      }),
    );
    schedule();
    return () => {
      ro.disconnect();
      unsubs.forEach((u) => u());
      if (raf) cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
