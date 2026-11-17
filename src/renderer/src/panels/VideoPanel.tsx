/**
 * A match video next to the log. Pick a local file, then sync it by hand:
 * scrub the video to a moment you recognize (the robot's first move, the
 * horn) and say what that frame is: auto start, teleop start, or wherever
 * the cursor is. From then on the video follows the timeline, including
 * playback speed and scrubbing. One video per log; the file and the sync
 * are remembered for that log.
 */
import { useEffect, useRef, useState } from 'react';
import { panelStore, updatePanel, type VideoSettings } from '../state/panels';
import { sessionStore, type LogEntry } from '../state/session';
import { timeStore } from '../state/time';
import { useStore } from '../state/store';
import { videoStore, setVideo, setVideoUrl, setVideoSync, removeVideo } from '../state/videos';
import { toast } from '../state/ui';
import { formatTime } from '@core/alignment';
import { Toolbar, ToolButton, ToolSelect, ToolGroup, ToolSpacer } from '../components/Toolbar';
import { MenuButton, MenuItem, MenuSeparator } from '../components/Menu';
import { Caret } from '../components/Icon';

/** One frame at 30 fps: the step used by the frame buttons. */
const FRAME = 1 / 30;

const clock = (s: number) => {
  const m = Math.floor(Math.abs(s) / 60);
  const rest = Math.abs(s) - m * 60;
  return `${s < 0 ? '-' : ''}${m}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`;
};

export function VideoPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as VideoSettings);
  const logs = useStore(sessionStore, (s) => s.logs);
  const videos = useStore(videoStore, (s) => s);
  const log: LogEntry | undefined = logs.find((l) => l.id === settings.logId) ?? logs[0];
  const entry = log ? videos.byLog[log.fileName] : undefined;
  const url = log ? videos.urls[log.fileName] : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [videoT, setVideoT] = useState(0);
  const [note, setNote] = useState('');
  const synced = !!entry && entry.logMinusVideo !== null;

  // Reopen a remembered video
  useEffect(() => {
    setMissing(false);
    if (!log || !entry || url) return;
    if (!entry.path || !window.brownout) {
      setMissing(true);
      return;
    }
    let alive = true;
    void window.brownout.openVideo(entry.path).then((f) => {
      if (!alive) return;
      if (f) setVideoUrl(log.fileName, f.url);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [log?.fileName, entry?.path, url]);

  // Follow the timeline once synced
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !log || !url) return;
    const follow = () => {
      const e = videoStore.get().byLog[log.fileName];
      const t = timeStore.get();
      const l = sessionStore.get().logs.find((x) => x.id === log.id);
      if (!e || e.logMinusVideo === null || !l) return;
      if (t.cursor === null) {
        if (!v.paused) v.pause();
        setNote('Set the cursor on the timeline to move the video.');
        return;
      }
      const target = t.cursor - l.offset - e.logMinusVideo;
      const end = Number.isFinite(v.duration) ? v.duration : Infinity;
      if (target < 0 || target > end) {
        if (!v.paused) v.pause();
        setNote(target < 0 ? `The video starts ${clock(-target)} after this moment.` : `The video ended ${clock(target - end)} before this moment.`);
        return;
      }
      setNote('');
      if (t.playing) {
        if (v.playbackRate !== t.speed) v.playbackRate = t.speed;
        if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
        if (v.paused) void v.play().catch(() => undefined);
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.012) v.currentTime = target;
      }
    };
    const unsubs = [timeStore.subscribe(follow), videoStore.subscribe(follow), sessionStore.subscribe(follow)];
    follow();
    return () => unsubs.forEach((u) => u());
  }, [log?.id, log?.fileName, url]);

  const pick = async () => {
    if (!log) return;
    if (window.brownout) {
      const f = await window.brownout.pickVideo();
      if (f) setVideo(log.fileName, { path: f.path, name: f.name, logMinusVideo: null }, f.url);
    } else fileRef.current?.click();
  };
  const onFile = (file: File | undefined) => {
    if (file && log) setVideo(log.fileName, { name: file.name, logMinusVideo: null }, URL.createObjectURL(file));
  };
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : t, t));
  };
  const syncTo = (raw: number | undefined, what: string) => {
    const v = videoRef.current;
    if (!v || !log) return;
    if (raw === undefined) {
      toast(`This log has no ${what}.`, 'error');
      return;
    }
    setVideoSync(log.fileName, raw - v.currentTime);
    toast(`Synced: video ${clock(v.currentTime)} is ${what}. The video now follows the timeline.`);
  };
  const nudge = (frames: number) => {
    if (log && entry && entry.logMinusVideo !== null) setVideoSync(log.fileName, entry.logMinusVideo - frames * FRAME);
  };
  const cursor = useStore(timeStore, (s) => s.cursor !== null);

  return (
    <div className="panel video-panel">
      <Toolbar>
        <ToolButton icon="folder" onClick={() => void pick()} title="Choose the video file for this log" testId="video-pick">
          {entry ? 'Change video' : 'Choose video'}
        </ToolButton>
        {url && (
          <MenuButton
            label={
              <>
                {synced ? 'Synced' : 'Sync'} <Caret />
              </>
            }
            className={synced ? 'active' : ''}
            title="Line the video up with the log: scrub the video to a moment you recognize, then say what that frame is"
            testId="video-sync"
          >
            {(close) => (
              <>
                <MenuItem
                  label="This frame is auto start"
                  description="The moment autonomous was enabled"
                  onClick={() => (close(), syncTo(log?.robotState.autoStart ?? log?.robotState.firstEnable, 'auto start'))}
                />
                <MenuItem label="This frame is teleop start" onClick={() => (close(), syncTo(log?.robotState.teleopStart, 'teleop start'))} />
                <MenuItem
                  label="This frame is the cursor"
                  description={cursor ? 'Where the cursor is on the timeline now' : 'Set the cursor on the timeline first'}
                  disabled={!cursor}
                  onClick={() => (close(), syncTo(log && timeStore.get().cursor !== null ? timeStore.get().cursor! - log.offset : undefined, 'the cursor'))}
                />
                {synced && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      label="Remove the sync"
                      description="Scrub the video freely again"
                      onClick={() => (close(), log && setVideoSync(log.fileName, null))}
                    />
                  </>
                )}
              </>
            )}
          </MenuButton>
        )}
        {url && !synced && (
          <ToolButton
            icon="frameBack"
            text="Back one frame"
            onClick={() => seek((videoRef.current?.currentTime ?? 0) - FRAME)}
            title="Video back one frame (1/30 s)"
          />
        )}
        {url && !synced && (
          <ToolButton
            icon="frameForward"
            text="Forward one frame"
            onClick={() => seek((videoRef.current?.currentTime ?? 0) + FRAME)}
            title="Video forward one frame (1/30 s)"
          />
        )}
        {url && synced && (
          <ToolButton icon="frameBack" text="Video one frame earlier" onClick={() => nudge(-1)} title="Fine-tune the sync: show the video one frame earlier" />
        )}
        {url && synced && (
          <ToolButton icon="frameForward" text="Video one frame later" onClick={() => nudge(1)} title="Fine-tune the sync: show the video one frame later" />
        )}
        {logs.length > 1 && (
          <ToolGroup low className="hdr-label">
            Log
            <ToolSelect
              value={log?.id ?? ''}
              onChange={(v) => updatePanel<VideoSettings>(id, { logId: v })}
              options={logs.map((l) => [l.id, l.name])}
              title="Which log this video belongs to"
            />
          </ToolGroup>
        )}
        <ToolSpacer />
        {entry && (
          <ToolGroup low className="toolbar-note">
            <span title={entry.path ?? entry.name}>{entry.name}</span>
          </ToolGroup>
        )}
        {entry && (
          <ToolButton low onClick={() => log && removeVideo(log.fileName)} title="Forget this log's video and its sync">
            Remove
          </ToolButton>
        )}
      </Toolbar>
      <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
      {!log ? (
        <div className="panel-placeholder">Open a log, then choose its match video.</div>
      ) : !entry ? (
        <div className="panel-placeholder">
          <div>
            Choose the match video for <b style={{ color: log.color }}>{log.name}</b>, then sync it to the log.
            <br />
            MP4 (H.264) and WebM play. Phone clips recorded as HEVC may need converting first.
          </div>
        </div>
      ) : missing ? (
        <div className="panel-placeholder">
          <div>
            {entry.path ? `“${entry.name}” is not where it was.` : `“${entry.name}” has to be chosen again after a restart in the browser build.`} Choose the
            video again; its sync is kept.
          </div>
        </div>
      ) : (
        <div className="video-host">
          <video
            ref={videoRef}
            src={url}
            muted
            playsInline
            preload="auto"
            data-testid="video"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setVideoT(e.currentTarget.currentTime)}
            onSeeked={(e) => setVideoT(e.currentTarget.currentTime)}
            onError={() =>
              toast(`This video cannot be played here (${entry.name}). MP4 with H.264 and WebM work; HEVC clips need converting.`, 'error', undefined, 9000)
            }
          />
          {note && <div className="video-note">{note}</div>}
          <div className="video-bar">
            <span className="mono" data-testid="video-time">
              {clock(videoT)}
              {duration ? ` / ${clock(duration)}` : ''}
            </span>
            {synced ? (
              <span className="video-sync" data-testid="video-synced">
                Synced to <b style={{ color: log.color }}>{log.name}</b>: video 0:00 is {formatTime(entry.logMinusVideo! + log.offset)} on the timeline
              </span>
            ) : (
              <>
                <input
                  className="video-scrub"
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={videoT}
                  onChange={(e) => seek(Number(e.target.value))}
                  title="Scrub the video to a moment you recognize, then use Sync"
                  data-testid="video-scrub"
                />
                <span className="hint">not synced yet</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
