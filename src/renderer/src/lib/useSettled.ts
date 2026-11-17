/**
 * The visible range, but only updated once panning/zooming pauses. Tables and
 * statistics use it so they don't recompute on every frame of a drag.
 */
import { useEffect, useState } from 'react';
import { timeStore } from '../state/time';
import { settingsStore } from '../state/settings';

export function useSettledView(): [number, number] {
  const [view, setViewState] = useState<[number, number]>(() => timeStore.get().view);
  useEffect(() => {
    let timer = 0;
    let last = timeStore.get().view;
    const unsub = timeStore.subscribe((s) => {
      if (s.view === last) return;
      last = s.view;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setViewState(last), settingsStore.get().potato ? 400 : 120);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
  return view;
}

/**
 * Calls `cb` with the cursor whenever it changes, at most once per `minMs`,
 * without re-rendering the component. For highlighting the current row.
 */
export function useCursorEffect(cb: (cursor: number | null) => void, minMs: number, deps: unknown[]): void {
  useEffect(() => {
    let last = -Infinity;
    let timer = 0;
    let cursor = timeStore.get().cursor;
    const fire = () => {
      timer = 0;
      last = performance.now();
      cb(cursor);
    };
    const unsub = timeStore.subscribe((s) => {
      if (s.cursor === cursor) return;
      cursor = s.cursor;
      if (timer) return;
      const wait = minMs - (performance.now() - last);
      if (wait <= 0) fire();
      else timer = window.setTimeout(fire, wait);
    });
    cb(cursor);
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
