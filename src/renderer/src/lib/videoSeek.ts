/**
 * Smooth seeking for match videos.
 *
 * Setting `currentTime` while the previous seek is still decoding makes
 * Chromium drop that seek and start over from the last keyframe. Dragging a
 * slider or scrubbing the timeline fires a seek per mouse move, so with phone
 * video (few keyframes) the picture freezes until the drag stops.
 *
 * `chaseSeek` runs one seek at a time per video. While a seek is running it
 * only remembers the newest target; when the seek lands it goes straight
 * there, skipping everything in between. The picture keeps up as fast as the
 * decoder can.
 */

const pending = new WeakMap<HTMLVideoElement, number>();
const hooked = new WeakSet<HTMLVideoElement>();

/** Seeks issued and seek requests skipped, for the UI test and DevTools. */
export const seekStats = { requested: 0, issued: 0 };

function issue(v: HTMLVideoElement, t: number): void {
  seekStats.issued++;
  v.currentTime = t;
}

/** Seek `v` to `t` seconds (clamped to the video), one seek at a time. */
export function chaseSeek(v: HTMLVideoElement, t: number): void {
  seekStats.requested++;
  const end = Number.isFinite(v.duration) ? v.duration : Infinity;
  const target = Math.max(0, Math.min(end, t));
  if (!hooked.has(v)) {
    hooked.add(v);
    v.addEventListener('seeked', () => {
      const next = pending.get(v);
      if (next === undefined) return;
      pending.delete(v);
      if (Math.abs(v.currentTime - next) > 1e-3) issue(v, next);
    });
    // a new source drops whatever was waiting
    v.addEventListener('emptied', () => pending.delete(v));
  }
  if (v.seeking) {
    pending.set(v, target);
    return;
  }
  pending.delete(v);
  if (Math.abs(v.currentTime - target) > 1e-3) issue(v, target);
}

/** Where the video is headed: the waiting target while a seek runs, else its current time. */
export function seekTarget(v: HTMLVideoElement): number {
  return pending.get(v) ?? v.currentTime;
}
