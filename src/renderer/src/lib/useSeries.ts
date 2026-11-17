/** React hook: a series from the cache, re-rendering when it arrives. */
import { useSyncExternalStore } from 'react';
import type { Series } from '@core/log';
import { client } from '../worker/client';

export function useSeries(logId: string | undefined, key: string | null | undefined): Series | null | undefined {
  return useSyncExternalStore(
    client.subscribe.bind(client),
    () => (logId && key ? client.peekSeries(logId, key) : null),
    () => null,
  );
}

/** Re-render whenever any series arrives (for components reading many series). */
const tickCounter = { value: 0 };
client.subscribe(() => tickCounter.value++);
export function useSeriesTick(): number {
  return useSyncExternalStore(
    client.subscribe.bind(client),
    () => tickCounter.value,
    () => 0,
  );
}
