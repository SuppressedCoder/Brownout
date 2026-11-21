/**
 * Tiny external store on useSyncExternalStore. Components subscribe to a
 * selector so fast-changing slices (cursor) don't re-render everything.
 * Canvas panels subscribe directly (no React) and redraw in rAF.
 */
import { useSyncExternalStore, useRef } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: (s: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(s: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) if ((p as Record<string, unknown>)[k] !== (state as Record<string, unknown>)[k]) changed = true;
      if (!changed) return;
      state = { ...state, ...p };
      for (const l of listeners) l(state);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T extends object, R>(store: Store<T>, selector: (s: T) => R): R {
  const ref = useRef<{ s: T; r: R } | null>(null);
  const getSnapshot = () => {
    const s = store.get();
    if (ref.current && ref.current.s === s) return ref.current.r;
    const r = selector(s);
    if (ref.current && shallowEqual(ref.current.r, r)) {
      ref.current = { s, r: ref.current.r };
      return ref.current.r;
    }
    ref.current = { s, r };
    return r;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // a Map or Set has no keys of its own to compare: every one would look equal to the last
  if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
