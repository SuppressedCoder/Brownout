/**
 * Zoom and pan for a picture that fills a box (a video), the way the 2D field
 * does it: the wheel zooms around the pointer, a drag with the left button
 * pans, also past the edges, and double-click (or a Fit button) shows the
 * whole picture again. Nothing zooms or recenters by itself (AGENTS rule 22).
 *
 * The view is a zoom and the point of the picture at the middle of the box,
 * as fractions of the box (0.5, 0.5 is the middle), so it survives resizes.
 * The picture is drawn with zoomTransform() on an element that fills the box.
 */
import { useEffect, type RefObject } from 'react';

export const ZOOM_MAX = 40;
/** Zoomed out to a fifth of the fitted size at most: past the edges is fine, Fit brings it back. */
export const ZOOM_MIN = 0.2;

export interface ZoomView {
  zoom?: number;
  center?: [number, number];
}

export function isZoomed(v: ZoomView): boolean {
  return (v.zoom ?? 1) !== 1 || !!v.center;
}

/** The CSS transform for the picture element (transform-origin 0 0, filling the box). */
export function zoomTransform(v: ZoomView): string | undefined {
  if (!isZoomed(v)) return undefined;
  const z = v.zoom ?? 1;
  const [cx, cy] = v.center ?? [0.5, 0.5];
  return `translate(${(0.5 - cx * z) * 100}%, ${(0.5 - cy * z) * 100}%) scale(${z})`;
}

/**
 * Wire the wheel, drags and double-click on `ref` (the box). `get` reads the
 * current view, `set` stores a new one; a fit is { zoom: 1, center: undefined }.
 */
export function useZoomPan(ref: RefObject<HTMLElement | null>, get: () => ZoomView, set: (v: ZoomView) => void, deps: unknown[] = []): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag: { x: number; y: number; center: [number, number]; moved: boolean } | null = null;
    /** Pointer position as fractions of the box. */
    const frac = (e: MouseEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)];
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = get();
      const zoom = v.zoom ?? 1;
      const factor = Math.exp((e.deltaY > 0 ? -1 : 1) * 0.18 * Math.min(3, Math.abs(e.deltaY) / 50 + 0.5));
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      if (next === zoom) return;
      // keep the point of the picture under the pointer where it is
      const [px, py] = frac(e);
      const [cx, cy] = v.center ?? [0.5, 0.5];
      const ux = cx + (px - 0.5) / zoom;
      const uy = cy + (py - 0.5) / zoom;
      set({ zoom: next, center: [ux - (px - 0.5) / next, uy - (py - 0.5) / next] });
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, center: get().center ?? [0.5, 0.5], moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      el.style.cursor = 'grabbing';
      const r = el.getBoundingClientRect();
      const z = get().zoom ?? 1;
      set({
        zoom: z,
        center: [drag.center[0] - (e.clientX - drag.x) / Math.max(1, r.width) / z, drag.center[1] - (e.clientY - drag.y) / Math.max(1, r.height) / z],
      });
    };
    const onUp = () => {
      el.style.cursor = '';
      drag = null;
    };
    const onDbl = () => set({ zoom: 1, center: undefined });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, ...deps]);
}
