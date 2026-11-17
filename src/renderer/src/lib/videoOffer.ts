/**
 * Offering a log's match video.
 *
 * When a log opens without a video, the main process lists the video files
 * next to the log file and in the videos folder chosen in Settings (names and
 * paths only), and core/videoMatch.ts picks the ones whose names say this
 * match ("Q12", "qm12", "Qual 12"). The best one is offered in a message;
 * nothing is opened until the user says "Use it". "Not now" is remembered
 * for that log file and video. The empty video panel lists the same matches.
 */
import { sessionStore, type LogEntry } from '../state/session';
import { videoStore, setVideo } from '../state/videos';
import { toast, uiStore } from '../state/ui';
import { panelStore, updatePanel, isViewPanel, VIEW_PANEL_PREFIX, type VideoSettings } from '../state/panels';
import { grid } from '../components/Grid';
import { logMatchKey, rankVideos, type VideoCandidate } from '@core/videoMatch';

const DECLINED_KEY = 'brownout.videoOffers.v1';

function declined(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(DECLINED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function decline(key: string): void {
  const s = declined();
  s.add(key);
  try {
    localStorage.setItem(DECLINED_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* storage unavailable */
  }
}

/** Video files that name this log's match, best first. Empty in the browser build or when the log's match is unknown. */
export async function findVideosFor(log: LogEntry): Promise<VideoCandidate[]> {
  if (!window.brownout) return [];
  const key = logMatchKey(log.matchInfo, log.fileName);
  if (!key) return [];
  const files = await window.brownout.listVideosNear(log.path);
  return rankVideos(files, key);
}

/** Attach a found video to the log, show it in a video panel, and open the sync view. */
export async function useVideoFor(log: LogEntry, c: VideoCandidate): Promise<boolean> {
  const f = await window.brownout?.openVideo(c.path);
  if (!f) {
    toast(`Could not open ${c.name}: it moved or is not a video Brownout can play.`, 'error');
    return false;
  }
  setVideo(log.fileName, { path: f.path, name: f.name, logMinusVideo: null }, f.url);
  // in the Video review view, show it there
  if (sessionStore.get().view === 'video') {
    updatePanel<VideoSettings>(`${VIEW_PANEL_PREFIX}video`, { logId: log.id });
    uiStore.set({ videoSyncFor: log.id });
    return true;
  }
  // a video panel in the grid showing this log: one already set to it, else one whose log has no video, else a new one
  const panels = Object.entries(panelStore.get().panels).filter(([id, p]) => p.type === 'video' && !isViewPanel(id)) as [string, VideoSettings][];
  const logs = sessionStore.get().logs;
  const logOf = (p: VideoSettings) => logs.find((l) => l.id === p.logId) ?? logs[0];
  const byLog = videoStore.get().byLog;
  const mine = panels.find(([, p]) => logOf(p)?.id === log.id);
  const free = panels.find(([, p]) => {
    const l = logOf(p);
    return !l || !byLog[l.fileName] || l.id === log.id;
  });
  if (mine) grid.api?.getPanel(mine[0])?.api.setActive();
  else if (free) {
    updatePanel<VideoSettings>(free[0], { logId: log.id });
    grid.api?.getPanel(free[0])?.api.setActive();
  } else grid.addPanel('video', { logId: log.id } as Partial<VideoSettings>);
  uiStore.set({ videoSyncFor: log.id });
  return true;
}

async function offer(log: LogEntry): Promise<void> {
  if (videoStore.get().byLog[log.fileName]) return;
  const found = await findVideosFor(log);
  const no = declined();
  const best = found.find((c) => !no.has(`${log.fileName}|${c.path}`));
  if (!best) return;
  // still open, and still without a video?
  const cur = sessionStore.get().logs.find((l) => l.id === log.id);
  if (!cur || videoStore.get().byLog[cur.fileName]) return;
  toast(`Found a video that looks like ${cur.name}: ${best.name}`, 'info', [
    { label: 'Use it', run: () => void useVideoFor(cur, best) },
    { label: 'Not now', run: () => decline(`${cur.fileName}|${best.path}`) },
  ]);
}

let started = false;

/** Offer a video for every log that opens without one (desktop app only). */
export function startVideoOffers(): void {
  if (started || !window.brownout) return;
  started = true;
  const seen = new Set<string>();
  const check = () => {
    for (const l of sessionStore.get().logs) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      void offer(l);
    }
  };
  sessionStore.subscribe(check);
  check();
}
