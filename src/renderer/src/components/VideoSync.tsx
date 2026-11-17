/**
 * The video sync view: the match video large, with controls of its own,
 * next to one log's auto and teleop markers and its robot speed.
 *
 * 1. Pick the log moment (auto start, the robot's first movement, ...).
 * 2. Find the same frame in the video: play it slowly, step frames.
 * 3. "This frame is ..." pairs them. Playing the video then moves a line
 *    on the log strip, so you can check that robot speed rises when the
 *    robot starts moving in the video.
 * 4. Apply saves the sync (state/videos.ts: logMinusVideo = raw - video).
 *
 * Inside this view the video and the log are unlinked: nothing moves the
 * shared time, and the app's shortcuts are paused. Keys: Space play/pause,
 * Left/Right one frame, Shift+Left/Right one second, comma/period five
 * seconds, Enter apply, Escape cancel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionStore, type LogEntry } from '../state/session';
import { uiStore, toast } from '../state/ui';
import { videoStore, setVideoSync } from '../state/videos';
import { createStore, useStore, type Store } from '../state/store';
import { client } from '../worker/client';
import { DERIVED_PREFIX } from '../worker/protocol';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { drawModeBands, drawTimeAxis } from '../lib/draw';
import { T } from '../lib/theme';
import { chaseSeek, seekTarget } from '../lib/videoSeek';
import { formatTime } from '@core/alignment';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer } from './Toolbar';

/** One frame at 30 fps: the step of the frame buttons and arrow keys. */
const FRAME = 1 / 30;
/** Robot speed (m/s) that counts as "moving" for the first-movement marker. */
const MOVING = 0.15;
const SPEED_KEY = `${DERIVED_PREFIX}Pose/Speed`;
/** The log strip shows this many seconds each side of the chosen moment. */
const STRIP_HALF = 10;

interface Marker {
  id: string;
  label: string;
  /** Raw log seconds. */
  raw: number;
}

interface SyncState {
  videoT: number;
  duration: number;
  playing: boolean;
  /** The chosen log moment (raw seconds) and which marker it is ('custom' for a click elsewhere). */
  moment: number | null;
  momentId: string;
  /** Video time paired with the moment; null until "This frame is ..." is pressed. */
  paired: number | null;
}

const clock = (s: number) => {
  const m = Math.floor(Math.abs(s) / 60);
  const rest = Math.abs(s) - m * 60;
  return `${s < 0 ? '-' : ''}${m}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`;
};

/** The moments a match video shows clearly, from the log's robot state and speed. */
function findMarkers(log: LogEntry, speed: { t: Float64Array; v: Float64Array } | null): Marker[] {
  const rs = log.robotState;
  const out: Marker[] = [];
  const start = rs.autoStart ?? rs.firstEnable;
  if (start !== undefined) out.push({ id: 'auto', label: rs.autoStart !== undefined ? 'Auto start' : 'First enable', raw: start });
  if (speed && start !== undefined) {
    for (let i = 0; i < speed.t.length; i++) {
      if (speed.t[i] >= start && speed.v[i] > MOVING) {
        out.push({ id: 'move', label: 'Robot starts moving', raw: speed.t[i] });
        break;
      }
    }
  }
  if (rs.teleopStart !== undefined) out.push({ id: 'teleop', label: 'Teleop start', raw: rs.teleopStart });
  if (rs.teleopEnd !== undefined) out.push({ id: 'end', label: 'Teleop end', raw: rs.teleopEnd });
  return out.sort((a, b) => a.raw - b.raw);
}

export function VideoSyncModal() {
  const logId = useStore(uiStore, (s) => s.videoSyncFor);
  const logs = useStore(sessionStore, (s) => s.logs);
  const log = logs.find((l) => l.id === logId);
  if (!logId || !log) return null;
  return <VideoSync key={logId} log={log} />;
}

function VideoSync({ log }: { log: LogEntry }) {
  const videos = useStore(videoStore, (s) => s);
  const entry = videos.byLog[log.fileName];
  const url = videos.urls[log.fileName];
  const videoRef = useRef<HTMLVideoElement>(null);
  const local = useMemo(() => createStore<SyncState>({ videoT: 0, duration: 0, playing: false, moment: null, momentId: 'custom', paired: null }), []);
  const st = useStore(local, (s) => ({ moment: s.moment, momentId: s.momentId, paired: s.paired, playing: s.playing }));
  const hasSpeed = log.fields.some((f) => f.key === SPEED_KEY);
  const speed = useSeries(log.id, hasSpeed ? SPEED_KEY : null);
  const markers = useMemo(() => findMarkers(log, speed), [log, speed]);
  const sound = useStore(syncPrefs, (s) => s.sound);
  const rate = useStore(syncPrefs, (s) => s.rate);
  const close = useCallback(() => uiStore.set({ videoSyncFor: null }), []);

  // Start from the current sync if there is one: the first marker, paired with its frame.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !markers.length) return;
    started.current = true;
    const m = markers.find((x) => x.id === 'auto') ?? markers[0];
    const lmv = entry?.logMinusVideo ?? null;
    local.set({ moment: m.raw, momentId: m.id, paired: lmv === null ? null : m.raw - lmv });
  }, [markers, entry, local]);
  // ...and show that frame once the video can seek
  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    local.set({ duration: v.duration });
    const s = local.get();
    if (s.paired !== null) {
      chaseSeek(v, s.paired);
      local.set({ videoT: seekTarget(v) });
    }
  };

  // While playing, follow every presented frame (timeupdate only fires a few times a second).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !st.playing) return;
    const cb = (_now: number, md: VideoFrameCallbackMetadata) => {
      local.set({ videoT: md.mediaTime });
      id = v.requestVideoFrameCallback(cb);
    };
    let id = v.requestVideoFrameCallback(cb);
    return () => v.cancelVideoFrameCallback(id);
  }, [st.playing, local]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate, url]);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      chaseSeek(v, t);
      local.set({ videoT: seekTarget(v) });
    },
    [local],
  );
  const step = useCallback((dt: number) => videoRef.current && seekTo(seekTarget(videoRef.current) + dt), [seekTo]);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  const pair = useCallback(() => {
    const v = videoRef.current;
    if (!v || local.get().moment === null) return;
    v.pause();
    local.set({ paired: seekTarget(v) });
  }, [local]);
  const apply = useCallback(() => {
    const s = local.get();
    if (s.moment === null || s.paired === null) return;
    setVideoSync(log.fileName, s.moment - s.paired);
    const label = markers.find((m) => m.id === s.momentId)?.label.toLowerCase() ?? 'the chosen moment';
    toast(`Synced: video ${clock(s.paired)} is ${label}. The video now follows the timeline.`);
    close();
  }, [local, log.fileName, markers, close]);

  // Keys belong to this view while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (uiStore.get().dialogs.length) return;
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range';
      e.stopPropagation();
      if (typing || el.tagName === 'SELECT') return;
      let handled = true;
      if (e.key === ' ') togglePlay();
      else if (e.key === 'ArrowLeft') step(e.shiftKey ? -1 : -FRAME);
      else if (e.key === 'ArrowRight') step(e.shiftKey ? 1 : FRAME);
      else if (e.key === ',') step(-5);
      else if (e.key === '.') step(5);
      else if (e.key === 'Enter') apply();
      else if (e.key === 'Escape') close();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [togglePlay, step, apply, close]);

  const momentLabel = markers.find((m) => m.id === st.momentId)?.label ?? (st.moment !== null ? `log ${formatTime(st.moment + log.offset)}` : '');
  const changed =
    st.paired !== null && st.moment !== null && entry && entry.logMinusVideo !== null && Math.abs(st.moment - st.paired - entry.logMinusVideo) > 1e-6;

  return (
    <div className="modal-backdrop">
      <div className="modal video-sync-modal" role="dialog" aria-label="Sync the video" data-testid="video-sync-view">
        <div className="modal-head">
          <strong>Sync the video</strong>
          <span className="modal-sub">
            {entry?.name ?? 'No video'} with <b style={{ color: log.color }}>{log.name}</b>
          </span>
          <span className="toolbar-spacer" />
          <button className="btn" onClick={close} data-testid="video-sync-cancel">
            Cancel
          </button>
          <button className="btn primary" onClick={apply} disabled={st.paired === null} data-testid="video-sync-apply" title="Save the sync (Enter)">
            Apply
          </button>
        </div>
        {!url ? (
          <div className="panel-placeholder">Choose this log&apos;s video in the video panel first.</div>
        ) : (
          <div className="vsync-body">
            <div className="vsync-video">
              <video
                ref={videoRef}
                src={url}
                muted={!sound}
                playsInline
                preload="auto"
                data-testid="video-sync-video"
                onLoadedMetadata={onMeta}
                onTimeUpdate={(e) => !local.get().playing && local.set({ videoT: seekTarget(e.currentTarget) })}
                onSeeked={(e) => local.set({ videoT: seekTarget(e.currentTarget) })}
                onPlay={() => local.set({ playing: true })}
                onPause={(e) => local.set({ playing: false, videoT: seekTarget(e.currentTarget) })}
              />
            </div>
            <Toolbar>
              <ToolButton
                icon={st.playing ? 'pause' : 'play'}
                text={st.playing ? 'Pause' : 'Play'}
                active={st.playing}
                onClick={togglePlay}
                title="Play or pause the video (Space)"
                testId="video-sync-play"
              />
              <ToolSelect
                value={String(rate)}
                onChange={(v) => syncPrefs.set({ rate: Number(v) })}
                options={[
                  ['0.25', '0.25×'],
                  ['0.5', '0.5×'],
                  ['1', '1×'],
                ]}
                title="Playback speed in this view"
              />
              <ToolButton icon="skipBack" text="Back 1 s" onClick={() => step(-1)} title="Back one second (Shift+Left)" />
              <ToolButton icon="frameBack" text="Back one frame" onClick={() => step(-FRAME)} title="Back one frame (Left)" testId="video-sync-frame-back" />
              <ToolButton
                icon="frameForward"
                text="Forward one frame"
                onClick={() => step(FRAME)}
                title="Forward one frame (Right)"
                testId="video-sync-frame-forward"
              />
              <ToolButton icon="skipForward" text="Forward 1 s" onClick={() => step(1)} title="Forward one second (Shift+Right)" />
              <ToolButton
                icon={sound ? 'soundOn' : 'soundOff'}
                text={sound ? 'Sound on' : 'Sound off'}
                active={sound}
                onClick={() => syncPrefs.set({ sound: !sound })}
                title="Sound in this view: the start horn and the teleop bell help find the moment"
              />
              <Readout store={local} />
              <ToolSpacer />
            </Toolbar>
            <Scrub store={local} onSeek={seekTo} />
            <div className="vsync-log">
              <div className="vsync-markers">
                <span className="hint">1. Log moment:</span>
                {markers.map((m) => (
                  <button
                    key={m.id}
                    className={`tool-btn${st.momentId === m.id ? ' active' : ''}`}
                    onClick={() => local.set({ moment: m.raw, momentId: m.id, paired: null })}
                    data-testid={`video-sync-marker-${m.id}`}
                    title={`${m.label} at ${formatTime(m.raw + log.offset)} on the timeline`}
                  >
                    {m.label}
                  </button>
                ))}
                {!markers.length && <span className="hint">This log has no robot mode data; click the strip below to pick a moment.</span>}
                {!hasSpeed && markers.length > 0 && <span className="hint">(no robot pose in this log, so no speed line)</span>}
              </div>
              <LogStrip log={log} store={local} markers={markers} speedKey={hasSpeed ? SPEED_KEY : null} />
            </div>
            <div className="vsync-pair">
              <span className="hint">2. Find the same moment in the video, then</span>
              <button className="btn primary" onClick={pair} disabled={st.moment === null} data-testid="video-sync-pair">
                This frame is {momentLabel ? momentLabel.charAt(0).toLowerCase() + momentLabel.slice(1) : 'the moment'}
              </button>
              <span className="vsync-status" data-testid="video-sync-status">
                {st.paired === null || st.moment === null
                  ? 'Not paired yet.'
                  : `3. Paired: video ${clock(st.paired)} is ${momentLabel.toLowerCase()}. Play the video: the white line on the log moves with it${hasSpeed ? ', and the speed line should rise when the robot starts moving' : ''}. To fine-tune, step to the exact frame and press the button again, then Apply.${changed ? ' (Changes the saved sync.)' : ''}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Per-run choices for the sync view (not saved). */
const syncPrefs = createStore({ sound: true, rate: 0.5 });

/** Load one number series for this view. */
function useSeries(logId: string, key: string | null): { t: Float64Array; v: Float64Array } | null {
  const [series, setSeries] = useState<{ t: Float64Array; v: Float64Array } | null>(null);
  useEffect(() => {
    setSeries(null);
    if (!key) return;
    let alive = true;
    void client.getSeries(logId, key).then((x) => {
      if (alive && x && x.kind === 'number') setSeries({ t: x.t, v: x.v });
    });
    return () => {
      alive = false;
    };
  }, [logId, key]);
  return series;
}

function Readout({ store }: { store: Store<SyncState> }) {
  const t = useStore(store, (s) => s.videoT);
  const d = useStore(store, (s) => s.duration);
  return (
    <span className="mono vsync-time" data-testid="video-sync-time">
      {clock(t)}
      {d ? ` / ${clock(d)}` : ''}
    </span>
  );
}

function Scrub({ store, onSeek }: { store: Store<SyncState>; onSeek: (t: number) => void }) {
  const t = useStore(store, (s) => s.videoT);
  const d = useStore(store, (s) => s.duration);
  return (
    <input
      className="vsync-scrub"
      type="range"
      min={0}
      max={d || 0}
      step={0.001}
      value={t}
      onChange={(e) => onSeek(Number(e.target.value))}
      title="Drag to move through the video"
      data-testid="video-sync-scrub"
    />
  );
}

/** This log around its markers: mode bands, robot speed, the markers, the chosen moment and (once paired) where the video is. */
function LogStrip({ log, store, markers, speedKey }: { log: LogEntry; store: Store<SyncState>; markers: Marker[]; speedKey: string | null }) {
  const rangeRef = useRef<[number, number]>([log.startTs, log.endTs]);
  const geomRef = useRef({ x0: 0, x1: 1 });
  const draw = useCallback(
    (dc: DrawContext) => {
      const { ctx, width, height } = dc;
      const pal = T();
      const s = store.get();
      // raw seconds shown: 10 s each side of the chosen moment (close enough to see single frames
      // of difference in robot speed), else the markers with some room, else the whole log
      let lo = log.startTs;
      let hi = log.endTs;
      if (s.moment !== null) {
        lo = Math.max(log.startTs, s.moment - STRIP_HALF);
        hi = Math.min(log.endTs, s.moment + STRIP_HALF);
      } else if (markers.length) {
        lo = Math.max(log.startTs, markers[0].raw - 8);
        hi = Math.min(log.endTs, markers[markers.length - 1].raw + 8);
      }
      if (!(hi > lo)) hi = lo + 1;
      rangeRef.current = [lo, hi];
      const x0 = 8;
      const x1 = width - 8;
      geomRef.current = { x0, x1 };
      const xOf = (raw: number) => x0 + ((raw - lo) / (hi - lo)) * (x1 - x0);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);
      const bandTop = 4;
      const bandBot = 18;
      drawModeBands(ctx, log, x0, x1, bandTop, bandBot, lo + log.offset, hi + log.offset, true);
      const top = 24;
      const bot = height - 18;
      ctx.fillStyle = pal.rowBg;
      ctx.fillRect(x0, top, x1 - x0, bot - top);
      // robot speed, min/max per pixel
      const sp = speedKey ? client.peekSeries(log.id, speedKey) : null;
      if (sp && sp.kind === 'number') {
        let max = 0.5;
        for (let i = 0; i < sp.v.length; i++) if (sp.t[i] >= lo && sp.t[i] <= hi && sp.v[i] > max) max = sp.v[i];
        const yOf = (v: number) => bot - 2 - (v / max) * (bot - top - 6);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        let px = -1;
        let mn = Infinity;
        let mx = -Infinity;
        let started = false;
        const flush = () => {
          if (px < 0 || !Number.isFinite(mn)) return;
          if (!started) {
            ctx.moveTo(px, yOf(mn));
            started = true;
          } else ctx.lineTo(px, yOf(mn));
          ctx.lineTo(px, yOf(mx));
        };
        for (let i = 0; i < sp.t.length; i++) {
          const t = sp.t[i];
          if (t < lo || t > hi) continue;
          const v = sp.v[i];
          if (!Number.isFinite(v)) continue;
          const x = Math.round(xOf(t));
          if (x !== px) {
            flush();
            px = x;
            mn = mx = v;
          } else {
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        flush();
        ctx.stroke();
        ctx.fillStyle = pal.fg2;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`robot speed, 0 to ${max.toFixed(1)} m/s`, x1 - 4, top + 3);
      }
      // markers, labeled at the top (staggered so neighbors don't overlap)
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'top';
      let lastLabelEnd = -Infinity;
      let row = 0;
      for (const m of markers) {
        if (m.raw < lo || m.raw > hi) continue;
        const x = Math.round(xOf(m.raw)) + 0.5;
        ctx.save();
        ctx.strokeStyle = pal.fg2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bot);
        ctx.stroke();
        ctx.restore();
        const w = ctx.measureText(m.label).width;
        const right = x > x1 - w - 10;
        const lx = right ? x - 3 - w : x + 3;
        row = lx < lastLabelEnd + 4 ? row + 1 : 0;
        lastLabelEnd = lx + w;
        ctx.fillStyle = s.moment === m.raw ? pal.strong : pal.fg2;
        ctx.textAlign = 'left';
        ctx.fillText(m.label, lx, top + 3 + row * 12);
      }
      // the chosen moment
      if (s.moment !== null) {
        ctx.fillStyle = pal.warn;
        ctx.fillRect(Math.round(xOf(s.moment)) - 1, bandTop, 2, bot - bandTop);
      }
      // where the video is, through the pairing
      if (s.paired !== null && s.moment !== null) {
        const raw = s.moment + (s.videoT - s.paired);
        if (raw >= lo && raw <= hi) {
          ctx.fillStyle = pal.cursor;
          ctx.fillRect(Math.round(xOf(raw)), bandTop, 1.5, bot - bandTop);
        }
      }
      drawTimeAxis(ctx, x0, x1, bot, lo + log.offset, hi + log.offset, top);
    },
    [log, store, markers, speedKey],
  );
  const ref = useCanvas(draw, [store, sessionStore], [draw]);

  // Click or drag on the strip to pick the log moment; it snaps to a marker within 8 px.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down = false;
    const pick = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const { x0, x1 } = geomRef.current;
      const [lo, hi] = rangeRef.current;
      const x = Math.min(x1, Math.max(x0, e.clientX - r.left));
      const raw = lo + ((x - x0) / (x1 - x0)) * (hi - lo);
      const near = markers.find((m) => Math.abs(x0 + ((m.raw - lo) / (hi - lo)) * (x1 - x0) - x) <= 8);
      store.set(near ? { moment: near.raw, momentId: near.id, paired: null } : { moment: raw, momentId: 'custom', paired: null });
    };
    const onDown = (e: PointerEvent) => {
      down = true;
      el.setPointerCapture(e.pointerId);
      pick(e);
    };
    const onMove = (e: PointerEvent) => down && pick(e);
    const onUp = () => (down = false);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, markers, store]);

  return (
    <div className="vsync-strip" title="Click to pick the log moment (snaps to the markers)" data-testid="video-sync-strip">
      <canvas ref={ref} />
    </div>
  );
}
