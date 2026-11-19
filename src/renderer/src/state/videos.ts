/**
 * Match videos, one per log. What is remembered (per log file name): the
 * video's path and its sync: "log time minus video time" in seconds and,
 * when the video's clock runs at a different speed from the robot's, the
 * video seconds per log second (`rate`, default 1):
 *
 *   video time = rate * (raw log time - logMinusVideo)
 *
 * With rate 1 that is the original one-number sync. A rate comes from
 * pairing two moments in the sync view (auto start and teleop end, say):
 * a recording whose clock is a little slow or fast drifts further out of
 * sync as the match goes on, which one number cannot fix.
 */
import { createStore } from './store';

export interface VideoEntry {
  /** File path on this computer (desktop app); missing in the browser build. */
  path?: string;
  name: string;
  /** Raw log seconds minus video seconds; null until the user syncs it. */
  logMinusVideo: number | null;
  /** Video seconds per log second, when two moments were paired; missing = 1. */
  rate?: number;
}

/** Rates outside this are taken as a mistaken pairing rather than a slow or fast clock. */
export const RATE_LIMITS: [number, number] = [0.8, 1.25];

/** "1.8% slow" for a video whose clock gives 0.982 video seconds per log second. */
export function speedNote(rate: number): string {
  const pct = Math.abs(1 - rate) * 100;
  return `${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}% ${rate < 1 ? 'slow' : 'fast'}`;
}

/** Where the video is at a raw log time. */
export function videoTimeAt(raw: number, e: VideoEntry): number {
  return (e.rate ?? 1) * (raw - (e.logMinusVideo ?? 0));
}

/** The raw log time a video time shows. */
export function rawTimeAt(video: number, e: VideoEntry): number {
  return (e.logMinusVideo ?? 0) + video / (e.rate ?? 1);
}

interface VideoState {
  byLog: Record<string, VideoEntry>;
  /** Playable addresses for this run (not saved). Keyed by log file name. */
  urls: Record<string, string>;
}

const KEY = 'brownout.videos.v1';

function load(): Record<string, VideoEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const out: Record<string, VideoEntry> = {};
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Partial<VideoEntry>>)) {
      if (v && typeof v.name === 'string')
        out[k] = {
          path: typeof v.path === 'string' ? v.path : undefined,
          name: v.name,
          logMinusVideo: typeof v.logMinusVideo === 'number' && Number.isFinite(v.logMinusVideo) ? v.logMinusVideo : null,
          rate: typeof v.rate === 'number' && v.rate >= RATE_LIMITS[0] && v.rate <= RATE_LIMITS[1] && v.rate !== 1 ? v.rate : undefined,
        };
    }
    return out;
  } catch {
    return {};
  }
}

export const videoStore = createStore<VideoState>({ byLog: load(), urls: {} });

// another window saved them: take its copy, so this window never writes an older one back
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === KEY && videoStore.set({ byLog: load() }));

let saved = videoStore.get().byLog;
videoStore.subscribe((s) => {
  if (s.byLog === saved) return;
  saved = s.byLog;
  try {
    localStorage.setItem(KEY, JSON.stringify(s.byLog));
  } catch {
    /* storage unavailable */
  }
});

export function setVideo(logFile: string, entry: VideoEntry, url: string): void {
  videoStore.set((s) => ({ byLog: { ...s.byLog, [logFile]: entry }, urls: { ...s.urls, [logFile]: url } }));
}

export function setVideoUrl(logFile: string, url: string): void {
  videoStore.set((s) => ({ urls: { ...s.urls, [logFile]: url } }));
}

/** Set the sync. `rate` undefined keeps the video's speed correction; null clears the sync and the correction. */
export function setVideoSync(logFile: string, logMinusVideo: number | null, rate?: number): void {
  videoStore.set((s) => {
    const e = s.byLog[logFile];
    if (!e) return {};
    const r = logMinusVideo === null ? undefined : rate === undefined ? e.rate : rate === 1 ? undefined : rate;
    return { byLog: { ...s.byLog, [logFile]: { ...e, logMinusVideo, rate: r } } };
  });
}

export function removeVideo(logFile: string): void {
  videoStore.set((s) => {
    const byLog = { ...s.byLog };
    const urls = { ...s.urls };
    delete byLog[logFile];
    delete urls[logFile];
    return { byLog, urls };
  });
}
