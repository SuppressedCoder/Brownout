/**
 * Match videos, one per log. What is remembered (per log file name): the
 * video's path and its sync, stored as "log time minus video time" in
 * seconds, so video time = raw log time - logMinusVideo.
 */
import { createStore } from './store';

export interface VideoEntry {
  /** File path on this computer (desktop app); missing in the browser build. */
  path?: string;
  name: string;
  /** Raw log seconds minus video seconds; null until the user syncs it. */
  logMinusVideo: number | null;
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
        };
    }
    return out;
  } catch {
    return {};
  }
}

export const videoStore = createStore<VideoState>({ byLog: load(), urls: {} });

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

export function setVideoSync(logFile: string, logMinusVideo: number | null): void {
  videoStore.set((s) => (s.byLog[logFile] ? { byLog: { ...s.byLog, [logFile]: { ...s.byLog[logFile], logMinusVideo } } } : {}));
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
