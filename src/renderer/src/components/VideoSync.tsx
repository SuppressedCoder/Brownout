/**
 * The video sync view: the match video large, with controls of its own,
 * next to one log's auto and teleop markers and its robot speed.
 *
 * 1. Pick the log moment (auto start, the robot's first movement, ...).
 * 2. Find the same frame in the video: play it slowly, step frames.
 * 3. "This frame is ..." pairs them. Playing the video then moves a line
 *    on the log strip, so you can check that robot speed rises when the
 *    robot starts moving in the video.
 * 4. Optionally pair a second moment late in the match (teleop end). Two
 *    pairs give the video's clock speed too, for recordings that drift
 *    further out of sync as the match goes on.
 * 5. Apply saves the sync (state/videos.ts: video = rate * (raw - logMinusVideo)).
 *
 * Inside this view the video and the log are unlinked: nothing moves the
 * shared time, and the app's shortcuts are paused. Keys: Space play/pause,
 * Left/Right one frame, Shift+Left/Right one second, comma/period five
 * seconds, = / - zoom the video timeline, Enter apply, Escape cancel.
 *
 * Both strips (video and log) zoom with the wheel and pan by dragging their
 * time scale; pressing or dragging in them picks a time while the view holds
 * still. Zoomed in, the video strip shows single frames. Frame steps use the
 * video's own frame rate, measured when it loads (30 fps if it can't tell).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionStore, type LogEntry } from '../state/session';
import { uiStore, toast } from '../state/ui';
import { videoStore, setVideoSync, videoTimeAt, speedNote, RATE_LIMITS } from '../state/videos';
import { createStore, useStore, type Store } from '../state/store';
import { client } from '../worker/client';
import { DERIVED_PREFIX } from '../worker/protocol';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { drawModeBands, timeTicks } from '../lib/draw';
import { T } from '../lib/theme';
import { chaseSeek, seekTarget } from '../lib/videoSeek';
import { formatTime, parseTimeInput, clampWindow } from '@core/alignment';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer } from './Toolbar';

/** Frame rate assumed until the video's own is measured. */
const DEFAULT_FPS = 30;
/** The video strip zooms in until this many frames fill it. */
const VIDEO_MIN_FRAMES = 12;
/** The log strip zooms in to this many seconds (a few 20 ms loop cycles). */
const LOG_MIN_SPAN = 0.2;
/** Robot speed (m/s) that counts as "moving" for the first-movement marker. */
const MOVING = 0.15;
const SPEED_KEY = `${DERIVED_PREFIX}Pose/Speed`;
/** The log strip starts out showing this many seconds each side of the chosen moment. */
const STRIP_HALF = 10;

interface Marker {
  id: string;
  label: string;
  /** Raw log seconds. */
  raw: number;
}

/** A log moment and the video frame that shows it. */
interface Pair {
  raw: number;
  video: number;
  label: string;
}

interface SyncState {
  videoT: number;
  duration: number;
  playing: boolean;
  /** The video's frame rate, and whether it was measured (else assumed). */
  fps: number;
  fpsKnown: boolean;
  /** What the video strip shows (video seconds); null = all of it. */
  vView: [number, number] | null;
  /** What the log strip shows (raw log seconds); null = around the markers. */
  lView: [number, number] | null;
  /** The chosen log moment (raw seconds) and which marker it is ('custom' for a click elsewhere). */
  moment: number | null;
  momentId: string;
  /** Up to two pairs, by log time. */
  pairs: Pair[];
}

/** Two pairs closer than this in log time give too noisy a clock speed; the newer one replaces the older. */
const MIN_PAIR_GAP = 5;

interface SyncModel {
  logMinusVideo: number;
  rate: number;
  /** Why two pairs can't be used together, if they can't. */
  bad?: string;
}

/** The sync the pairs give. One pair keeps the video's earlier speed correction (`keepRate`); two set it. */
function modelOf(pairs: Pair[], keepRate: number): SyncModel | null {
  if (!pairs.length) return null;
  const a = pairs[0];
  if (pairs.length === 1) return { logMinusVideo: a.raw - a.video / keepRate, rate: keepRate };
  const b = pairs[1];
  const rate = (b.video - a.video) / (b.raw - a.raw);
  if (!(rate >= RATE_LIMITS[0] && rate <= RATE_LIMITS[1]))
    return {
      logMinusVideo: a.raw - a.video,
      rate: 1,
      bad: `These two pairs disagree too much: the video would run ${Number.isFinite(rate) && rate > 0 ? speedNote(rate) : 'backwards'}. Check that each frame really is that moment.`,
    };
  return { logMinusVideo: a.raw - a.video / rate, rate };
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
  const local = useMemo(
    () =>
      createStore<SyncState>({
        videoT: 0,
        duration: 0,
        playing: false,
        fps: DEFAULT_FPS,
        fpsKnown: false,
        vView: null,
        lView: null,
        moment: null,
        momentId: 'custom',
        pairs: [],
      }),
    [],
  );
  const st = useStore(local, (s) => ({ moment: s.moment, momentId: s.momentId, pairs: s.pairs, playing: s.playing }));
  // the speed correction a single pair keeps: the one saved for this video, if any
  const keepRate = useRef(entry?.rate ?? 1).current;
  const model = modelOf(st.pairs, keepRate);
  const hasSpeed = log.fields.some((f) => f.key === SPEED_KEY);
  const speed = useSeries(log.id, hasSpeed ? SPEED_KEY : null);
  const markers = useMemo(() => findMarkers(log, speed), [log, speed]);
  const sound = useStore(syncPrefs, (s) => s.sound);
  const rate = useStore(syncPrefs, (s) => s.rate);
  const close = useCallback(() => uiStore.set({ videoSyncFor: null }), []);
  /** While the frame rate is being measured the video plays a few muted frames; seeks asked for meanwhile wait here. */
  const probe = useRef<{ active: boolean; back: number }>({ active: false, back: 0 });

  /** Show `t` (log strip time, raw seconds) in the log strip, keeping its zoom. */
  const centerLog = useCallback(
    (t: number) => {
      const s = local.get();
      const span = s.lView ? s.lView[1] - s.lView[0] : 2 * STRIP_HALF;
      local.set({ lView: clampWindow(t - span / 2, t + span / 2, log.startTs, log.endTs, 'pan', LOG_MIN_SPAN) ?? [log.startTs, log.endTs] });
    },
    [local, log.startTs, log.endTs],
  );

  // Start from the current sync if there is one: the first marker, paired with its frame.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !markers.length) return;
    started.current = true;
    const m = markers.find((x) => x.id === 'auto') ?? markers[0];
    const synced = entry && entry.logMinusVideo !== null;
    local.set({ moment: m.raw, momentId: m.id, pairs: synced ? [{ raw: m.raw, video: videoTimeAt(m.raw, entry), label: m.label }] : [] });
    centerLog(m.raw);
  }, [markers, entry, local, centerLog]);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      const end = Number.isFinite(v.duration) ? v.duration : t;
      const target = Math.max(0, Math.min(end, t));
      local.set({ videoT: target });
      if (probe.current.active) {
        probe.current.back = target;
        return;
      }
      v.pause();
      chaseSeek(v, target);
    },
    [local],
  );
  // ...show the paired frame once the video can seek, and measure its frame rate
  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    local.set({ duration: v.duration });
    const s = local.get();
    if (s.pairs.length) seekTo(s.pairs[0].video);
  };
  const onData = () => {
    const v = videoRef.current;
    if (!v || probe.current.active || local.get().fpsKnown) return;
    probe.current = { active: true, back: local.get().videoT };
    void measureFps(v).then((fps) => {
      probe.current.active = false;
      local.set({ fps: fps ?? DEFAULT_FPS, fpsKnown: true });
      chaseSeek(v, probe.current.back);
      local.set({ videoT: probe.current.back });
    });
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

  /** Step whole frames from the frame on screen; it lands in the middle of the frame, so rounding never shows its neighbor. */
  const stepFrames = useCallback(
    (n: number) => {
      const s = local.get();
      seekTo(frameMiddle(frameIndex(s.videoT, s.fps) + n, s.fps));
    },
    [local, seekTo],
  );
  const stepSeconds = useCallback((dt: number) => seekTo(local.get().videoT + dt), [local, seekTo]);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || probe.current.active) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  /** Zoom the video timeline around what is on screen. */
  const zoomVideo = useCallback(
    (factor: number) => {
      const s = local.get();
      const all: [number, number] = [0, Math.max(s.duration, 1)];
      const [a, b] = s.vView ?? all;
      const span = Math.min(all[1], Math.max(VIDEO_MIN_FRAMES / s.fps, (b - a) * factor));
      const f = b > a ? Math.min(1, Math.max(0, (s.videoT - a) / (b - a))) : 0.5;
      local.set({ vView: clampWindow(s.videoT - span * f, s.videoT + span * (1 - f), all[0], all[1], 'pan', 1e-3) ?? all });
    },
    [local],
  );
  const pair = useCallback(() => {
    const v = videoRef.current;
    const s = local.get();
    if (!v || s.moment === null) return;
    v.pause();
    const label = markers.find((m) => m.id === s.momentId)?.label ?? `log ${formatTime(s.moment + log.offset)}`;
    const next: Pair = { raw: s.moment, video: s.videoT, label };
    // a pair near an existing one replaces it; a third replaces the nearer of the two
    let pairs = s.pairs.filter((p) => Math.abs(p.raw - next.raw) >= MIN_PAIR_GAP);
    if (pairs.length >= 2) {
      const far = Math.abs(pairs[0].raw - next.raw) > Math.abs(pairs[1].raw - next.raw) ? pairs[0] : pairs[1];
      pairs = [far];
    }
    local.set({ pairs: [...pairs, next].sort((a, b) => a.raw - b.raw) });
  }, [local, markers, log.offset]);
  const apply = useCallback(() => {
    const s = local.get();
    const m = modelOf(s.pairs, keepRate);
    if (!m || m.bad) return;
    setVideoSync(log.fileName, m.logMinusVideo, m.rate);
    toast(
      s.pairs.length === 2 && Math.abs(m.rate - 1) >= 0.0005
        ? `Synced at two moments. The video's clock runs ${speedNote(m.rate)}; Brownout plays it ${m.rate < 1 ? 'faster' : 'slower'} to match the log.`
        : `Synced: video ${clock(s.pairs[0].video)} is ${s.pairs[0].label.toLowerCase()}. The video now follows the timeline.`,
    );
    close();
  }, [local, log.fileName, close, keepRate]);

  // Keys belong to this view while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (uiStore.get().dialogs.length) return;
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range';
      e.stopPropagation();
      if (typing || el.tagName === 'SELECT') {
        if (e.key === 'Escape') (el as HTMLElement).blur();
        return;
      }
      let handled = true;
      if (e.key === ' ') togglePlay();
      else if (e.key === 'ArrowLeft') e.shiftKey ? stepSeconds(-1) : stepFrames(-1);
      else if (e.key === 'ArrowRight') e.shiftKey ? stepSeconds(1) : stepFrames(1);
      else if (e.key === ',') stepSeconds(-5);
      else if (e.key === '.') stepSeconds(5);
      else if (e.key === '=' || e.key === '+') zoomVideo(1 / 2);
      else if (e.key === '-') zoomVideo(2);
      else if (e.key === 'Enter') apply();
      else if (e.key === 'Escape') close();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [togglePlay, stepFrames, stepSeconds, zoomVideo, apply, close]);

  const momentLabel = markers.find((m) => m.id === st.momentId)?.label ?? (st.moment !== null ? `log ${formatTime(st.moment + log.offset)}` : '');
  const changed =
    !!model &&
    !!entry &&
    entry.logMinusVideo !== null &&
    (Math.abs(model.logMinusVideo - entry.logMinusVideo) > 1e-6 || Math.abs(model.rate - (entry.rate ?? 1)) > 1e-9);
  const lc = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  const status = (() => {
    if (!model) return 'Not paired yet.';
    const play = `Play the video: the white line on the log moves with it${hasSpeed ? ', and the speed line should rise when the robot starts moving' : ''}.`;
    if (st.pairs.length === 1) {
      const p = st.pairs[0];
      return `3. Paired: video ${clock(p.video)} is ${lc(p.label)}. ${play} To fine-tune, step to the exact frame and press the button again. If the video drifts later in the match, also pair a late moment such as teleop end.${keepRate !== 1 ? ` Keeps the earlier speed correction (the video's clock runs ${speedNote(keepRate)}).` : ''}${changed ? ' (Changes the saved sync.)' : ''}`;
    }
    const [a, b] = st.pairs;
    if (model.bad) return `Paired: video ${clock(a.video)} is ${lc(a.label)} and video ${clock(b.video)} is ${lc(b.label)}. ${model.bad}`;
    const speedText =
      Math.abs(model.rate - 1) < 0.0005 ? 'The video keeps time with the log.' : `The video's clock runs ${speedNote(model.rate)}; Apply corrects for that.`;
    return `3. Paired: video ${clock(a.video)} is ${lc(a.label)} and video ${clock(b.video)} is ${lc(b.label)}. ${speedText} ${play}${changed ? ' (Changes the saved sync.)' : ''}`;
  })();

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
          <button className="btn primary" onClick={apply} disabled={!model || !!model.bad} data-testid="video-sync-apply" title="Save the sync (Enter)">
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
                onLoadedData={onData}
                onPlay={() => !probe.current.active && local.set({ playing: true })}
                onPause={(e) => !probe.current.active && local.set({ playing: false, videoT: seekTarget(e.currentTarget) })}
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
              <ToolButton icon="skipBack" text="Back 1 s" onClick={() => stepSeconds(-1)} title="Back one second (Shift+Left)" />
              <ToolButton icon="frameBack" text="Back one frame" onClick={() => stepFrames(-1)} title="Back one frame (Left)" testId="video-sync-frame-back" />
              <ToolButton
                icon="frameForward"
                text="Forward one frame"
                onClick={() => stepFrames(1)}
                title="Forward one frame (Right)"
                testId="video-sync-frame-forward"
              />
              <ToolButton icon="skipForward" text="Forward 1 s" onClick={() => stepSeconds(1)} title="Forward one second (Shift+Right)" />
              <ToolButton
                icon={sound ? 'soundOn' : 'soundOff'}
                text={sound ? 'Sound on' : 'Sound off'}
                active={sound}
                onClick={() => syncPrefs.set({ sound: !sound })}
                title="Sound in this view: the start horn and the teleop bell help find the moment"
              />
              <GotoBox onGo={seekTo} />
              <Readout store={local} />
              <ToolSpacer />
              <ToolButton icon="minus" text="Zoom out" onClick={() => zoomVideo(2)} title="Show more of the video (-)" />
              <ToolButton icon="plus" text="Zoom in" onClick={() => zoomVideo(1 / 2)} title="Zoom in on the video, down to single frames (=)" />
            </Toolbar>
            <VideoTimeline store={local} onPick={seekTo} />
            <div className="vsync-log">
              <div className="vsync-markers">
                <span className="hint">1. Log moment:</span>
                {markers.map((m) => (
                  <button
                    key={m.id}
                    className={`tool-btn${st.momentId === m.id ? ' active' : ''}`}
                    onClick={() => {
                      local.set({ moment: m.raw, momentId: m.id });
                      centerLog(m.raw);
                    }}
                    data-testid={`video-sync-marker-${m.id}`}
                    title={`${m.label} at ${formatTime(m.raw + log.offset)} on the timeline`}
                  >
                    {m.label}
                  </button>
                ))}
                {!markers.length && <span className="hint">This log has no robot mode data; click the strip below to pick a moment.</span>}
                {!hasSpeed && markers.length > 0 && <span className="hint">(no robot pose in this log, so no speed line)</span>}
              </div>
              <LogStrip log={log} store={local} markers={markers} speedKey={hasSpeed ? SPEED_KEY : null} keepRate={keepRate} />
            </div>
            <div className="vsync-pair">
              <span className="hint">2. Find the same moment in the video, then</span>
              <button className="btn primary" onClick={pair} disabled={st.moment === null} data-testid="video-sync-pair">
                This frame is {momentLabel ? lc(momentLabel) : 'the moment'}
              </button>
              {st.pairs.length > 0 && (
                <button className="btn" onClick={() => local.set({ pairs: [] })} title="Forget the pairs made here and start over">
                  Clear pairs
                </button>
              )}
              <span className="vsync-status" data-testid="video-sync-status">
                {status}
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

// ---------------------------------------------------------------------------
// Frames

/** Common frame rates; a measured rate within 2% of one is taken as the nearest one. */
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240];

/** Which frame shows at time t (frame 0 starts at 0). */
function frameIndex(t: number, fps: number): number {
  return Math.floor(t * fps + 1e-6);
}

/** The middle of frame n: seeking there shows that frame, whatever the rounding. */
function frameMiddle(n: number, fps: number): number {
  return (Math.max(0, n) + 0.5) / fps;
}

/**
 * The video's frame rate, from the times of a few frames it presents while
 * playing muted. The caller puts the video back where it was. Null if it
 * could not tell (then 30 fps is assumed).
 */
function measureFps(v: HTMLVideoElement): Promise<number | null> {
  return new Promise((resolve) => {
    const times: number[] = [];
    const muted = v.muted;
    v.muted = true;
    let id = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      v.cancelVideoFrameCallback(id);
      v.pause();
      v.muted = muted;
      const d: number[] = [];
      for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
      if (d.length < 3) return resolve(null);
      d.sort((a, b) => a - b);
      const raw = 1 / d[Math.floor(d.length / 2)];
      let best: number | null = null;
      for (const f of COMMON_FPS) if (Math.abs(f - raw) / f < 0.02 && (best === null || Math.abs(f - raw) < Math.abs(best - raw))) best = f;
      resolve(best ?? Math.round(raw * 100) / 100);
    };
    const cb = (_now: number, md: VideoFrameCallbackMetadata) => {
      times.push(md.mediaTime);
      if (times.length >= 8) finish();
      else id = v.requestVideoFrameCallback(cb);
    };
    id = v.requestVideoFrameCallback(cb);
    void v.play().catch(finish);
    window.setTimeout(finish, 2000);
  });
}

function Readout({ store }: { store: Store<SyncState> }) {
  const t = useStore(store, (s) => s.videoT);
  const d = useStore(store, (s) => s.duration);
  const fps = useStore(store, (s) => s.fps);
  const known = useStore(store, (s) => s.fpsKnown);
  return (
    <span className="mono vsync-time" data-testid="video-sync-time" data-fps={known ? fps : undefined}>
      {clock(t)}
      {d ? ` / ${clock(d)}` : ''} · frame {frameIndex(t, fps)}
      {known ? ` · ${fps} fps` : ''}
    </span>
  );
}

/** Type a video time to go to it. */
function GotoBox({ onGo }: { onGo: (t: number) => void }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <form
      className="vsync-goto"
      onSubmit={(e) => {
        e.preventDefault();
        const t = parseTimeInput(text);
        if (t === null || t < 0) {
          setBad(true);
          return;
        }
        onGo(t);
        setText('');
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <input
        className={`tool-input${bad ? ' bad' : ''}`}
        value={text}
        placeholder="go to 0:41.5"
        title="Type a video time (m:ss.s or seconds) and press Enter"
        data-testid="video-sync-goto"
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Zoomable strips

const RULER_H = 18;

interface StripInput {
  /** The visible range, and everything there is. */
  view(): [number, number];
  setView(v: [number, number]): void;
  bounds(): [number, number];
  minSpan(): number;
  /** Where the plot is, in CSS px from the canvas' left edge. */
  plot(): [number, number];
  /** Press or drag in the plot (above the ruler). The view never moves while picking. */
  pick(t: number, e: PointerEvent): void;
}

/**
 * Pointer handling shared by the two strips. Press or drag in the plot picks
 * a time; the view holds still, so the time under the pointer is always the
 * time picked. Drag the ruler (or with the middle button) to pan; the wheel
 * zooms around the pointer (Shift or a sideways scroll pans); double-click
 * shows everything.
 */
function attachStripInput(el: HTMLCanvasElement, o: StripInput): () => void {
  type Drag = { kind: 'pick' } | { kind: 'pan'; startX: number; view: [number, number] };
  let drag: Drag | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, h: r.height };
  };
  const tOf = (x: number) => {
    const [x0, x1] = o.plot();
    const [a, b] = o.view();
    return a + ((Math.min(x1, Math.max(x0, x)) - x0) / (x1 - x0)) * (b - a);
  };
  const clampView = (a: number, b: number): [number, number] => {
    const [lo, hi] = o.bounds();
    return clampWindow(a, b, lo, hi, 'pan', o.minSpan()) ?? [lo, hi];
  };
  const onDown = (e: PointerEvent) => {
    const { x, y, h } = local(e);
    if (e.button === 1 || (e.button === 0 && y >= h - RULER_H)) {
      e.preventDefault();
      drag = { kind: 'pan', startX: x, view: o.view() };
      el.style.cursor = 'grabbing';
    } else if (e.button === 0) {
      drag = { kind: 'pick' };
      el.style.cursor = 'ew-resize';
      o.pick(tOf(x), e);
    } else return;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const { x, y, h } = local(e);
    if (!drag) {
      el.style.cursor = y >= h - RULER_H ? 'grab' : 'crosshair';
      return;
    }
    if (drag.kind === 'pick') o.pick(tOf(x), e);
    else {
      const [x0, x1] = o.plot();
      const [a, b] = drag.view;
      const dt = ((x - drag.startX) / (x1 - x0)) * (b - a);
      o.setView(clampView(a - dt, b - dt));
    }
  };
  const onUp = (e: PointerEvent) => {
    drag = null;
    const { y, h } = local(e);
    el.style.cursor = y >= h - RULER_H ? 'grab' : 'crosshair';
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { x } = local(e);
    const [a, b] = o.view();
    const [x0, x1] = o.plot();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dt = ((e.deltaX || e.deltaY) / (x1 - x0)) * (b - a);
      o.setView(clampView(a + dt, b + dt));
      return;
    }
    const [lo, hi] = o.bounds();
    // by how far the wheel turned (about 0.8x per notch), so quick turns that arrive merged zoom just as far
    const factor = Math.exp(Math.max(-3, Math.min(3, e.deltaY * 0.002)));
    const span = Math.min(hi - lo, Math.max(o.minSpan(), (b - a) * factor));
    const t = tOf(x);
    const f = (t - a) / (b - a);
    o.setView(clampView(t - span * f, t + span * (1 - f)));
  };
  const onDbl = () => o.setView(o.bounds());
  const onAux = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('mousedown', onAux);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('dblclick', onDbl);
    el.removeEventListener('mousedown', onAux);
  };
}

/** A clock label for a ruler tick, with as many decimals as the tick step needs. */
function tickLabel(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const ss = s.toFixed(dec);
  return `${m}:${s < 10 ? '0' : ''}${ss}`;
}

/** Ticks and labels along the bottom of a strip (times in the strip's own seconds). */
function drawRuler(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, a: number, b: number, label: (t: number, step: number) => string) {
  const pal = T();
  const ticks = timeTicks(a, b, x1 - x0);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : b - a;
  ctx.fillStyle = pal.bg3;
  ctx.fillRect(x0, y, x1 - x0, RULER_H);
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = pal.grid;
  for (const t of ticks) {
    const x = Math.round(x0 + ((t - a) / (b - a)) * (x1 - x0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.fillStyle = pal.fg2;
    ctx.fillText(label(t, step), x, y + 5);
  }
}

/**
 * The video's own timeline. Press or drag to move through the video (it lands
 * on whole frames); the wheel zooms in until single frames are wide enough to
 * click, with frame numbers when there is room.
 */
function VideoTimeline({ store, onPick }: { store: Store<SyncState>; onPick: (t: number) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const geom = useRef({ x0: 8, x1: 100 });
  const all = useCallback((): [number, number] => [0, Math.max(store.get().duration, 1)], [store]);
  const view = useCallback((): [number, number] => store.get().vView ?? all(), [store, all]);

  // keep what is on screen in view while stepping and playing
  useEffect(
    () =>
      store.subscribe((s) => {
        if (!s.vView) return;
        const [a, b] = s.vView;
        if (s.videoT >= a && s.videoT <= b) return;
        const span = b - a;
        const [lo, hi] = all();
        const v = clampWindow(s.videoT - span * 0.2, s.videoT + span * 0.8, lo, hi, 'pan', 1e-3);
        if (v) store.set({ vView: v });
      }),
    [store, all],
  );

  const draw = useCallback(
    (dc: DrawContext) => {
      const { ctx, width, height } = dc;
      const pal = T();
      const s = store.get();
      const [a, b] = view();
      const x0 = 8;
      const x1 = width - 8;
      geom.current = { x0, x1 };
      hostRef.current?.setAttribute('data-view', `${a},${b}`);
      const xOf = (t: number) => x0 + ((t - a) / (b - a)) * (x1 - x0);
      const plotBot = height - RULER_H;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = pal.rowBg;
      ctx.fillRect(x0, 0, x1 - x0, plotBot);
      // single frames, once they are at least 3 px wide
      const fd = 1 / s.fps;
      const pxPerFrame = (x1 - x0) / ((b - a) / fd);
      if (pxPerFrame >= 3) {
        const cur = frameIndex(s.videoT, s.fps);
        const i0 = Math.max(0, Math.floor(a / fd));
        const i1 = Math.ceil(b / fd);
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = i0; i <= i1; i++) {
          const xa = xOf(i * fd);
          const xb = xOf((i + 1) * fd);
          if (i === cur) {
            ctx.fillStyle = pal.selection;
            ctx.fillRect(xa, 0, xb - xa, plotBot);
          }
          ctx.fillStyle = pal.grid;
          ctx.fillRect(Math.round(xa), 0, 1, plotBot);
          if (pxPerFrame >= 34) {
            ctx.fillStyle = i === cur ? pal.strong : pal.fg2;
            ctx.fillText(String(i), (xa + xb) / 2, plotBot / 2 + 6);
          }
        }
      }
      // paired frames
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (const p of s.pairs) {
        if (p.video < a || p.video > b) continue;
        const x = Math.round(xOf(p.video));
        ctx.fillStyle = pal.accent;
        ctx.fillRect(x - 1, 0, 2, plotBot);
        ctx.fillText(p.label, x + 4, 2);
      }
      // where the video is
      const x = Math.round(xOf(s.videoT)) + 0.5;
      if (x >= x0 - 1 && x <= x1 + 1) {
        ctx.fillStyle = pal.cursor;
        ctx.fillRect(x - 0.75, 0, 1.5, plotBot);
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 7);
        ctx.closePath();
        ctx.fill();
      }
      drawRuler(ctx, x0, x1, plotBot, a, b, tickLabel);
      if (pxPerFrame < 3 && s.duration) {
        ctx.fillStyle = pal.fg2;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('wheel to zoom in to single frames', x1 - 4, 2);
      }
    },
    [store, view],
  );
  const ref = useCanvas(draw, [store], [draw]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachStripInput(el, {
      view,
      setView: (v) => store.set({ vView: v }),
      bounds: all,
      minSpan: () => VIDEO_MIN_FRAMES / store.get().fps,
      plot: () => [geom.current.x0, geom.current.x1],
      pick: (t) => {
        const fps = store.get().fps;
        onPick(frameMiddle(frameIndex(t, fps), fps));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, view, all, store, onPick]);
  return (
    <div
      className="vsync-vtimeline"
      ref={hostRef}
      title="Drag to move through the video. Wheel to zoom (down to single frames), drag the time scale to pan, double-click to see it all."
      data-testid="video-sync-timeline"
    >
      <canvas ref={ref} />
    </div>
  );
}

/**
 * This log around the chosen moment: mode bands, robot speed (with its
 * samples once zoomed in), the markers, the chosen moment and (once paired)
 * where the video is. Press or drag to pick the moment; it snaps to a marker
 * within 8 px (Alt: no snap). The view only moves when you zoom or pan it, or
 * pick a marker button.
 */
function LogStrip({
  log,
  store,
  markers,
  speedKey,
  keepRate,
}: {
  log: LogEntry;
  store: Store<SyncState>;
  markers: Marker[];
  speedKey: string | null;
  keepRate: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const geom = useRef({ x0: 8, x1: 100 });
  const bounds = useCallback((): [number, number] => [log.startTs, Math.max(log.endTs, log.startTs + 1)], [log.startTs, log.endTs]);
  const view = useCallback((): [number, number] => {
    const v = store.get().lView;
    if (v) return v;
    if (markers.length) return [Math.max(log.startTs, markers[0].raw - 8), Math.min(log.endTs, markers[markers.length - 1].raw + 8)];
    return bounds();
  }, [store, markers, log.startTs, log.endTs, bounds]);
  const draw = useCallback(
    (dc: DrawContext) => {
      const { ctx, width, height } = dc;
      const pal = T();
      const s = store.get();
      const [lo, hi] = view();
      const x0 = 8;
      const x1 = width - 8;
      geom.current = { x0, x1 };
      hostRef.current?.setAttribute('data-view', `${lo},${hi}`);
      const xOf = (raw: number) => x0 + ((raw - lo) / (hi - lo)) * (x1 - x0);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);
      const bandTop = 4;
      const bandBot = 18;
      drawModeBands(ctx, log, x0, x1, bandTop, bandBot, lo + log.offset, hi + log.offset, true);
      const top = 24;
      const bot = height - RULER_H;
      ctx.fillStyle = pal.rowBg;
      ctx.fillRect(x0, top, x1 - x0, bot - top);
      // robot speed, min/max per pixel; its samples as dots once they are 6 px apart
      const sp = speedKey ? client.peekSeries(log.id, speedKey) : null;
      if (sp && sp.kind === 'number') {
        let max = 0.5;
        let n = 0;
        for (let i = 0; i < sp.v.length; i++)
          if (sp.t[i] >= lo && sp.t[i] <= hi) {
            n++;
            if (sp.v[i] > max) max = sp.v[i];
          }
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
        if (n > 0 && (x1 - x0) / n >= 6) {
          ctx.fillStyle = pal.accent;
          for (let i = 0; i < sp.t.length; i++) {
            const t = sp.t[i];
            if (t < lo || t > hi || !Number.isFinite(sp.v[i])) continue;
            ctx.fillRect(Math.round(xOf(t)) - 1.5, yOf(sp.v[i]) - 1.5, 3, 3);
          }
        }
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
      if (s.moment !== null && s.moment >= lo && s.moment <= hi) {
        ctx.fillStyle = pal.warn;
        ctx.fillRect(Math.round(xOf(s.moment)) - 1, bandTop, 2, bot - bandTop);
      }
      // the paired moments: a small tab on the mode band
      ctx.fillStyle = pal.accent;
      for (const p of s.pairs) {
        if (p.raw < lo || p.raw > hi) continue;
        const x = Math.round(xOf(p.raw));
        ctx.fillRect(x - 3, bandTop - 3, 6, 4);
      }
      // where the video is, through the pairing
      const model = modelOf(s.pairs, keepRate);
      if (model && !model.bad) {
        const raw = model.logMinusVideo + s.videoT / model.rate;
        if (raw >= lo && raw <= hi) {
          ctx.fillStyle = pal.cursor;
          ctx.fillRect(Math.round(xOf(raw)), bandTop, 1.5, bot - bandTop);
        }
      }
      drawRuler(ctx, x0, x1, bot, lo + log.offset, hi + log.offset, (t, step) => {
        const label = tickLabel(Math.abs(t), step);
        return t < 0 ? `-${label}` : label;
      });
    },
    [log, store, markers, speedKey, keepRate, view],
  );
  const ref = useCanvas(draw, [store, sessionStore], [draw]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachStripInput(el, {
      view,
      setView: (v) => store.set({ lView: v }),
      bounds,
      minSpan: () => LOG_MIN_SPAN,
      plot: () => [geom.current.x0, geom.current.x1],
      pick: (t, e) => {
        const { x0, x1 } = geom.current;
        const [lo, hi] = view();
        const px = (raw: number) => x0 + ((raw - lo) / (hi - lo)) * (x1 - x0);
        const near = e.altKey ? undefined : markers.find((m) => Math.abs(px(m.raw) - px(t)) <= 8);
        store.set(near ? { moment: near.raw, momentId: near.id } : { moment: t, momentId: 'custom' });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, view, bounds, markers, store]);

  return (
    <div
      className="vsync-strip"
      ref={hostRef}
      title="Press or drag to pick the log moment (snaps to the markers; Alt: no snap). Wheel to zoom, drag the time scale to pan, double-click to see the whole log."
      data-testid="video-sync-strip"
    >
      <canvas ref={ref} />
    </div>
  );
}
