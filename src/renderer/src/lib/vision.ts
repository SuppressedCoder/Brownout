/**
 * Cameras for each open log. A robot profile can list its cameras by hand;
 * when it lists none, they are found from the log's field names, so the
 * camera view works with no setup. Whenever a log's cameras change, the
 * worker rebuilds that log's /Brownout/Vision/<camera>/... fields (tags
 * seen, tag count, estimate error) and its per-camera summary.
 */
import { sessionStore, addTimelineTrack, removeTimelineTrack, type LogEntry } from '../state/session';
import { profileStore, profileById, CAMERA_COLORS, type Camera } from '../state/profiles';
import { client } from '../worker/client';
import { detectCameras, type CameraDef } from '@core/vision';
import type { FieldInfo } from '@core/log';
import { VISION_PREFIX } from '../worker/protocol';

const detected = new WeakMap<FieldInfo[], Camera[]>();

/** Cameras found in a log's own field names. */
export function detectedCameras(log: LogEntry): Camera[] {
  let c = detected.get(log.fields);
  if (!c) {
    c = detectCameras(log.fields).map((d, i) => ({ ...d, color: CAMERA_COLORS[i % CAMERA_COLORS.length], mount: null }));
    detected.set(log.fields, c);
  }
  return c;
}

/** The cameras used for a log: the profile's, or the detected ones when the profile has none. */
export function camerasFor(log: LogEntry): Camera[] {
  const own = profileById(log.profileId).cameras;
  return own.length ? own : detectedCameras(log);
}

const defs = (cams: Camera[]): CameraDef[] => cams.map(({ id, name, poseKey, tagIdsKey, tagPosesKey }) => ({ id, name, poseKey, tagIdsKey, tagPosesKey }));

const done = new Map<string, string>();
let timer = 0;
let running = false;
let again = false;

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const open = new Set(sessionStore.get().logs.map((l) => l.id));
    for (const id of [...done.keys()]) if (!open.has(id)) done.delete(id);
    for (const log of sessionStore.get().logs) {
      const d = defs(camerasFor(log));
      const sig = JSON.stringify([d, log.roles.robotPose, log.robotState.ranges.length]);
      if (done.get(log.id) === sig && log.cameras !== undefined) continue;
      done.set(log.id, sig);
      const r = await client.cameras(log.id, d);
      sessionStore.set((st) => ({ logs: st.logs.map((x) => (x.id === log.id ? { ...x, cameras: r.summaries ?? [], fields: r.fields ?? x.fields } : x)) }));
      // a renamed or removed camera changes its field names: keep the timeline tracks pointing at fields that exist
      const tracks = sessionStore.get().timelineTracks;
      if (tagsSeenTracksOn(tracks) && tracks.filter((k) => k.startsWith(VISION_PREFIX) && k.endsWith('/TagsSeen')).join() !== tagsSeenKeys().join())
        setTagsSeenTracks(true);
    }
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), 180);
}

export function startVisionAnalysis(): void {
  sessionStore.subscribe(schedule);
  profileStore.subscribe(schedule);
  schedule();
}

/** Keys of the tags-seen fields across the open logs, one per camera name. */
export function tagsSeenKeys(): string[] {
  const keys = new Set<string>();
  for (const l of sessionStore.get().logs) for (const f of l.fields) if (f.key.startsWith(VISION_PREFIX) && f.key.endsWith('/TagsSeen')) keys.add(f.key);
  return [...keys].sort();
}

export const tagsSeenTracksOn = (tracks: string[]): boolean => tracks.some((k) => k.startsWith(VISION_PREFIX) && k.endsWith('/TagsSeen'));

/** Add or remove a timeline track per camera showing which tags it saw. */
export function setTagsSeenTracks(on: boolean): void {
  for (const k of sessionStore.get().timelineTracks) if (k.startsWith(VISION_PREFIX) && k.endsWith('/TagsSeen')) removeTimelineTrack(k);
  if (on) for (const k of tagsSeenKeys()) addTimelineTrack(k);
}
