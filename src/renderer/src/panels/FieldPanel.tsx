/**
 * 2D field: one robot per log (log color, bumpers by alliance), trails, the
 * active path and target pose (PathPlanner), extra Pose2d / Pose2d[] fields,
 * AprilTag markers with visible-tag lines, and "normalize alliance".
 * Poses are drawn in the blue-wall frame; 2027 (center-frame) logs are converted.
 *
 * The season's real field picture is drawn underneath (lib/fieldAssets.ts).
 *
 * Wheel zooms around the pointer, drag pans, double-click (or Fit) shows the
 * whole field again. Nothing zooms or recenters by itself, and the view is not
 * held to the field: zoom out past it, drag it anywhere.
 */
import { useCallback, useEffect, useRef } from 'react';
import { panelStore, updatePanel, type FieldSettings } from '../state/panels';
import { sessionStore, currentSeason, allSeasons, type LogEntry } from '../state/session';
import { profileStore, profileById, type Layer } from '../state/profiles';
import { camerasFor, tagsSeenTracksOn, setTagsSeenTracks } from '../lib/vision';
import { drawLayers } from '../lib/robotDraw';
import { uiStore } from '../state/ui';
import { tagIdsFromValue, tagPosesFromValue, poseFromValue, isBotposeKey } from '@core/vision';
import { fieldPicture, pictureImage, bundledTags, hasTagVariants, fieldAssetTicker, addCustomField, removeCustomField } from '../lib/fieldAssets';
import { MenuButton, MenuItem, MenuSeparator, MenuLabel } from '../components/Menu';
import { Caret } from '../components/Icon';
import { toast } from '../state/ui';
import { timeStore, setCursor, setHover } from '../state/time';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { indexAtOrBefore } from '@core/log';
import { centerToBlueWall, flipAlliance, toPose, type Pose, type SeasonPreset } from '@core/field';
import { withAlpha } from '../lib/colors';
import { T } from '../lib/theme';
import { fieldIndex, shortKey } from '../lib/fields';
import { Toolbar, ToolButton, ToolSelect, ToolSpacer } from '../components/Toolbar';
import { PanelFieldStrip } from '../components/FieldStrip';

const MAX_ZOOM = 40;
/** Zoomed out to a fifth of the fitted size at most: past the field is fine, Fit brings it back. */
const MIN_ZOOM = 0.2;
const DEFAULT_BRIGHTNESS = 0.55;

/** Field ↔ canvas mapping of the last draw. */
interface View {
  cx: number;
  cy: number;
  scale: number;
  center: [number, number];
  sign: 1 | -1;
  fit: number;
}

export function FieldPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as FieldSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const normalize = useStore(sessionStore, (s) => s.normalizeAlliance);
  const seasonId = useStore(sessionStore, (s) => s.seasonId);
  const tagVariant = useStore(sessionStore, (s) => s.tagVariant);
  const customFields = useStore(sessionStore, (s) => s.customFields);
  const customTags = useStore(sessionStore, (s) => !!s.fieldTags);
  const tagsTracks = useStore(sessionStore, (s) => tagsSeenTracksOn(s.timelineTracks));
  const viewRef = useRef<View | null>(null);

  const draw = useCallback((dc: DrawContext) => drawField(dc, id, viewRef), [id]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore, profileStore, fieldAssetTicker], [id]);
  useFieldInteraction(ref, id, viewRef);
  const zoomed = (settings.zoom ?? 1) !== 1 || !!settings.center;
  const set = (patch: Partial<FieldSettings>) => updatePanel<FieldSettings>(id, patch);
  const hasPicture = !!fieldPicture(seasonId);
  const showImage = settings.showImage !== false;
  const isCustom = seasonId.startsWith('custom-');
  // the parts of every robot shown (usually one profile)
  const profiles = useStore(profileStore, (s) => s.profiles);
  const partList = [...new Set(logs.map((l) => l.profileId))].flatMap((pid) => (profiles.find((p) => p.id === pid) ?? profileById(pid)).layers);

  const loadPicture = async () => {
    try {
      const f = await window.brownout?.importField();
      if (!f) return;
      const meta = addCustomField(f.id, f.json, f.image, f.mime);
      sessionStore.set((st) => ({ customFields: [...st.customFields.filter((c) => c.id !== meta.id), meta], seasonId: meta.id }));
      toast(`Loaded the field picture “${meta.name}” (${meta.length.toFixed(2)} × ${meta.width.toFixed(2)} m).`);
    } catch (e) {
      toast(
        `Could not load that field: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e}`,
        'error',
        undefined,
        8000,
      );
    }
  };
  const removePicture = async () => {
    await window.brownout?.removeField(seasonId);
    removeCustomField(seasonId);
    sessionStore.set((st) => ({ customFields: st.customFields.filter((c) => c.id !== seasonId), seasonId: '2026' }));
  };

  return (
    <div className="panel field-panel">
      <PanelFieldStrip id={id} />
      <Toolbar>
        <MenuButton
          label={
            <>
              Display <Caret />
            </>
          }
          title="What the field shows: picture, path, target, tags, alliance, rotation"
          testId="field-display"
        >
          {(close) => (
            <>
              <MenuItem
                label="Field picture"
                description={hasPicture ? 'The real field drawing for this season' : 'No picture for this season'}
                checked={showImage && hasPicture}
                disabled={!hasPicture}
                onClick={() => set({ showImage: !showImage })}
              />
              {hasPicture && showImage && (
                <label className="menu-slider">
                  Brightness
                  <input
                    type="range"
                    min={0.15}
                    max={1}
                    step={0.05}
                    value={settings.imageBrightness ?? DEFAULT_BRIGHTNESS}
                    onChange={(e) => set({ imageBrightness: Number(e.target.value) })}
                  />
                </label>
              )}
              <MenuSeparator />
              <MenuItem
                label="Active path"
                description="The path being followed (PathPlanner)"
                checked={settings.showPath}
                onClick={() => set({ showPath: !settings.showPath })}
              />
              <MenuItem
                label="Target pose"
                description="Where the path says the robot should be, with an error line"
                checked={settings.showTarget}
                onClick={() => set({ showTarget: !settings.showTarget })}
              />
              <MenuItem
                label="AprilTags"
                description="Tag positions, and lines to the tags a camera sees"
                checked={settings.showTags}
                onClick={() => set({ showTags: !settings.showTags })}
              />
              <MenuItem
                label="Cameras"
                description="Lines to the tags each camera sees, and a ghost robot where it thinks the robot is"
                checked={settings.showCameras !== false}
                onClick={() => set({ showCameras: settings.showCameras === false })}
              />
              <MenuItem
                label="Tags-seen tracks on the timeline"
                description="One row per camera: which tags it saw, and when it saw none"
                checked={tagsTracks}
                onClick={() => setTagsSeenTracks(!tagsTracks)}
              />
              <MenuItem
                icon="gear"
                label="Set up cameras…"
                description="Which fields each camera logs, its color and where it is mounted"
                onClick={() => (close(), uiStore.set({ camerasFor: logs[0]?.profileId ?? profileById(undefined).id }))}
              />
              <MenuItem
                label="Robot names"
                description="Each log's name by its robot"
                checked={settings.showLabels !== false}
                onClick={() => set({ showLabels: settings.showLabels === false })}
              />
              <MenuItem
                label="Robot parts"
                description={partList.length ? 'The shapes and pictures added in the robot editor' : 'No parts yet: add them with Edit the robot'}
                checked={settings.showParts !== false && partList.length > 0}
                disabled={!partList.length}
                onClick={() => set({ showParts: settings.showParts === false })}
                testId="field-show-parts"
              />
              {settings.showParts !== false &&
                partList.map((l) => (
                  <MenuItem
                    key={l.id}
                    label={l.name}
                    description="Robot part"
                    checked={!(settings.hiddenParts ?? []).includes(l.id)}
                    onClick={() =>
                      set({
                        hiddenParts: (settings.hiddenParts ?? []).includes(l.id)
                          ? (settings.hiddenParts ?? []).filter((x) => x !== l.id)
                          : [...(settings.hiddenParts ?? []), l.id],
                      })
                    }
                    testId="field-part"
                  />
                ))}
              <MenuItem
                icon="robot"
                label="Edit the robot…"
                description="Add shapes, pictures or SVGs to the robot, and link parts to logged angles"
                onClick={() => (close(), uiStore.set({ robotEditorFor: logs[0]?.profileId ?? profileById(undefined).id }))}
              />
              {hasTagVariants(seasonId) && !customTags && (
                <>
                  <MenuLabel>Tag map</MenuLabel>
                  <MenuItem label="Welded field" checked={tagVariant === 'welded'} onClick={() => sessionStore.set({ tagVariant: 'welded' })} />
                  <MenuItem label="AndyMark field" checked={tagVariant === 'andymark'} onClick={() => sessionStore.set({ tagVariant: 'andymark' })} />
                </>
              )}
              <MenuSeparator />
              <MenuItem
                label="Normalize alliance"
                description="Flip red-alliance runs onto the blue side so autos overlay"
                checked={normalize}
                onClick={() => sessionStore.set({ normalizeAlliance: !normalize })}
              />
              <MenuItem
                label="Rotate 180°"
                description="The view from the red driver station"
                checked={settings.rotate}
                onClick={() => set({ rotate: !settings.rotate })}
              />
              {window.brownout && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon="upload"
                    label="Load your own field picture…"
                    description="A WPILib / PathWeaver field JSON next to its image"
                    onClick={() => (close(), void loadPicture())}
                  />
                  {isCustom && <MenuItem icon="trash" label="Remove this field picture" onClick={() => void removePicture()} />}
                </>
              )}
            </>
          )}
        </MenuButton>
        <ToolButton
          disabled={!zoomed}
          onClick={() => set({ zoom: 1, center: undefined })}
          title={zoomed ? 'Show the whole field again (double-click the field does the same)' : 'The whole field is showing. Wheel zooms, drag pans.'}
          testId="field-fit"
        >
          Fit
        </ToolButton>
        <ToolSelect
          low
          value={seasonId}
          onChange={(v) => sessionStore.set({ seasonId: v })}
          options={allSeasons({ ...sessionStore.get(), customFields }).map((x) => [x.id, x.name])}
          title="Season field"
        />
        <ToolSelect
          low
          value={String(settings.trailSeconds)}
          onChange={(v) => set({ trailSeconds: Number(v) })}
          options={[
            ['0', 'No trail'],
            ['2', 'Trail 2 s'],
            ['5', 'Trail 5 s'],
            ['15', 'Trail 15 s'],
            ['1000', 'Whole log'],
          ]}
          title="How much of the robot's path trails behind it"
        />
        <ToolSpacer />
      </Toolbar>
      <div className="canvas-host">
        <canvas ref={ref} />
        {logs.length > 0 && !logs.some((l) => l.roles.robotPose) && settings.keys.length === 0 && (
          <div className="panel-placeholder">
            No robot pose found. Log a <code>Pose2d</code> (e.g. <code>Odometry/Robot</code>) or add a pose field.
          </div>
        )}
      </div>
    </div>
  );
}

/** Convert a logged pose to the blue-wall drawing frame, optionally normalized to blue. */
function posePrep(p: Pose | undefined, log: LogEntry, season: SeasonPreset, normalize: boolean): Pose | undefined {
  if (!p) return undefined;
  let q = p;
  if (log.era === '2027') q = centerToBlueWall(q, season.length, season.width);
  if (normalize && log.matchInfo.alliance === 'red') q = flipAlliance(q, season.length, season.width, season.symmetry);
  return q;
}

// ---------------------------------------------------------------------------
// Zoom / pan

function useFieldInteraction(ref: React.RefObject<HTMLCanvasElement | null>, id: string, viewRef: React.MutableRefObject<View | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag: { x: number; y: number; center: [number, number]; moved: boolean } | null = null;
    const pos = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    /** Canvas point → field meters. */
    const toField = (v: View, x: number, y: number): [number, number] => [
      v.center[0] + ((x - v.cx) / v.scale) * v.sign,
      v.center[1] - ((y - v.cy) / v.scale) * v.sign,
    ];

    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current;
      if (!v) return;
      e.preventDefault();
      const { x, y } = pos(e);
      const s = panelStore.get().panels[id] as FieldSettings | undefined;
      const zoom = s?.zoom ?? 1;
      const factor = Math.exp((e.deltaY > 0 ? -1 : 1) * 0.18 * Math.min(3, Math.abs(e.deltaY) / 50 + 0.5));
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      if (next === zoom) return;
      // keep the field point under the pointer where it is (no snapping back to the whole field: Fit does that)
      const [fx, fy] = toField(v, x, y);
      const scale = v.fit * next;
      const center: [number, number] = [fx - ((x - v.cx) / scale) * v.sign, fy + ((y - v.cy) / scale) * v.sign];
      updatePanel<FieldSettings>(id, { zoom: next, center });
    };
    const onDown = (e: PointerEvent) => {
      const v = viewRef.current;
      if (e.button !== 0 || !v) return;
      el.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      drag = { x, y, center: [...v.center] as [number, number], moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const v = viewRef.current;
      if (!v) return;
      const { x, y } = pos(e);
      if (drag) {
        if (Math.abs(x - drag.x) > 3 || Math.abs(y - drag.y) > 3) drag.moved = true;
        if (!drag.moved) return;
        el.style.cursor = 'grabbing';
        updatePanel<FieldSettings>(id, { center: [drag.center[0] - ((x - drag.x) / v.scale) * v.sign, drag.center[1] + ((y - drag.y) / v.scale) * v.sign] });
        return;
      }
      // Optional: Alt-hover scrubs time along a trail (only when panels may move time)
      if (e.altKey && settingsStore.get().panelsMoveTime) {
        const [fx, fy] = toField(v, x, y);
        setHover(nearestTrailTime(fx, fy));
      }
    };
    const onUp = (e: PointerEvent) => {
      el.style.cursor = '';
      const d = drag;
      drag = null;
      if (d && !d.moved && e.altKey && settingsStore.get().panelsMoveTime) {
        const h = timeStore.get().hover;
        if (h !== null) setCursor(h);
      }
    };
    const onDbl = () => updatePanel<FieldSettings>(id, { zoom: 1, center: undefined });
    const onLeave = () => setHover(null);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, id]);
}

/** Aligned time of the trail point nearest a field position, or null when nothing is close. */
function nearestTrailTime(fx: number, fy: number): number | null {
  const session = sessionStore.get();
  const season = currentSeason();
  let best: { t: number; d: number } | null = null;
  for (const log of session.logs) {
    const pk = log.roles.robotPose;
    if (!log.visible || !pk) continue;
    const s = client.peekSeries(log.id, pk);
    if (!s || s.kind !== 'struct') continue;
    const step = Math.max(1, Math.floor(s.t.length / 4000));
    for (let i = 0; i < s.t.length; i += step) {
      const p = posePrep(toPose(s.v[i]), log, season, session.normalizeAlliance);
      if (!p) continue;
      const d = Math.hypot(p.x - fx, p.y - fy);
      if (!best || d < best.d) best = { t: s.t[i] + log.offset, d };
    }
  }
  return best && best.d < 0.35 ? best.t : null;
}

// ---------------------------------------------------------------------------
// Drawing

function drawField(dc: DrawContext, id: string, viewRef: React.MutableRefObject<View | null>) {
  const { ctx, width, height, potato } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as FieldSettings | undefined;
  if (!settings) return;
  const session = sessionStore.get();
  const time = timeStore.get();
  const season = currentSeason();
  const L = season.length;
  const W = season.width;
  const pad = 14;
  const fit = Math.max(1e-6, Math.min((width - pad * 2) / L, (height - pad * 2) / W));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, settings.zoom ?? 1));
  const scale = fit * zoom;
  const sign: 1 | -1 = settings.rotate ? -1 : 1;
  // Keep at least part of the field in view
  // the view goes wherever it is dragged, also off the field: Fit (or double-click) brings it back
  const center: [number, number] = settings.center ?? [L / 2, W / 2];
  const cx = width / 2;
  const cy = height / 2;
  viewRef.current = { cx, cy, scale, center, sign, fit };
  const X = (x: number) => cx + (x - center[0]) * scale * sign;
  const Y = (y: number) => cy - (y - center[1]) * scale * sign;

  // Field rectangle in canvas space
  const fx0 = Math.min(X(0), X(L));
  const fy0 = Math.min(Y(0), Y(W));
  const fw = L * scale;
  const fh = W * scale;
  const blueLeft = sign === 1; // blue wall is at x = 0
  ctx.fillStyle = pal.fieldBg;
  ctx.fillRect(fx0, fy0, fw, fh);
  const pic = settings.showImage !== false ? fieldPicture(season.id) : undefined;
  const img = pic ? pictureImage(pic.url) : null;
  if (pic && img) {
    // The picture's playable-area corners map onto the field rectangle; its margins spill outside.
    const k = fw / (pic.bottomRight[0] - pic.topLeft[0]);
    const ky = fh / (pic.bottomRight[1] - pic.topLeft[1]);
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0.15, settings.imageBrightness ?? DEFAULT_BRIGHTNESS));
    ctx.imageSmoothingQuality = potato ? 'low' : 'high';
    ctx.translate(X(0), Y(W));
    ctx.scale(sign * k, sign * ky);
    ctx.drawImage(img, -pic.topLeft[0], -pic.topLeft[1]);
    ctx.restore();
    ctx.strokeStyle = pal.fieldLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, fw - 1, fh - 1);
  } else {
    ctx.fillStyle = 'rgba(79,158,247,0.13)';
    ctx.fillRect(blueLeft ? fx0 : fx0 + fw / 2, fy0, fw / 2, fh);
    ctx.fillStyle = 'rgba(225,87,89,0.13)';
    ctx.fillRect(blueLeft ? fx0 + fw / 2 : fx0, fy0, fw / 2, fh);
    // 1 m grid
    ctx.strokeStyle = pal.fieldGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = 1; m < L; m++) {
      ctx.moveTo(X(m), fy0);
      ctx.lineTo(X(m), fy0 + fh);
    }
    for (let m = 1; m < W; m++) {
      ctx.moveTo(fx0, Y(m));
      ctx.lineTo(fx0 + fw, Y(m));
    }
    ctx.stroke();
    ctx.strokeStyle = pal.fieldLine;
    ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, fw - 1, fh - 1);
    ctx.beginPath();
    ctx.moveTo(X(L / 2), fy0);
    ctx.lineTo(X(L / 2), fy0 + fh);
    ctx.stroke();
  }
  ctx.fillStyle = pal.fg2;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(blueLeft ? 'BLUE' : 'RED', fx0 + 4, fy0 + fh - 3);
  ctx.textAlign = 'right';
  ctx.fillText(blueLeft ? 'RED' : 'BLUE', fx0 + fw - 4, fy0 + fh - 3);

  // Tags
  const tags = session.fieldTags ?? bundledTags(season.id, session.tagVariant);
  if (settings.showTags && tags.length) {
    for (const tg of tags) {
      const tx = X(tg.x);
      const ty = Y(tg.y);
      ctx.fillStyle = pal.strong;
      ctx.fillRect(tx - 3, ty - 3, 6, 6);
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 3.5, ty - 3.5, 7, 7);
      if (scale > 26) {
        const label = String(tg.id);
        ctx.font = '9px sans-serif';
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = pal.legendBg;
        ctx.fillRect(tx + 5, ty - 6, lw + 4, 12);
        ctx.fillStyle = pal.fg;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(label, tx + 7, ty);
      }
    }
  }

  const tCursor = time.hover ?? time.cursor ?? time.view[1];
  const fieldsIdx = fieldIndex(session.logs);
  let logs = session.logs.filter((l) => l.visible);
  if (settings.source !== 'all') logs = logs.filter((l) => l.id === settings.source);
  // Potato mode: short, sparse trails
  const trailSeconds = potato ? Math.min(settings.trailSeconds, 3) : settings.trailSeconds;
  const maxTrailPts = potato ? 150 : 1500;

  const readout: { color: string; log: string; text: string }[] = [];
  for (const log of logs) {
    const raw = tCursor - log.offset;
    const profile = profileById(log.profileId);
    const hiddenParts = new Set(settings.hiddenParts ?? []);
    const size = profile.robot;
    let robot: Pose | undefined;
    const prep = (p: Pose | undefined) => posePrep(p, log, season, session.normalizeAlliance);
    const poseKey = log.roles.robotPose;
    const poseS = poseKey ? client.peekSeries(log.id, poseKey) : undefined;

    // Active path
    if (settings.showPath && log.roles.activePath) {
      const ps = client.peekSeries(log.id, log.roles.activePath);
      if (ps && ps.kind === 'struct') {
        const i = indexAtOrBefore(ps.t, raw);
        if (i >= 0) {
          const pts = (ps.v[i] as unknown[]).map(toPose).map(prep).filter(Boolean) as Pose[];
          drawPolyline(ctx, pts, X, Y, withAlpha(log.color, 0.9), 2, [6, 4]);
        }
      }
    }
    // Extra pose fields
    for (const k of settings.keys) {
      const f = fieldsIdx.get(k);
      const s = client.peekSeries(log.id, k);
      if (!s || s.kind !== 'struct') continue;
      const i = indexAtOrBefore(s.t, raw);
      if (i < 0) continue;
      if (f?.kind === 'struct[]') {
        const pts = (s.v[i] as unknown[]).map(toPose).map(prep).filter(Boolean) as Pose[];
        drawPolyline(ctx, pts, X, Y, withAlpha(log.color, 0.7), 1.5, [2, 3]);
        for (const p of pts.slice(0, potato ? 50 : 200)) {
          ctx.fillStyle = withAlpha(log.color, 0.7);
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.y), 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const p = prep(toPose(s.v[i]));
        if (p) drawRobot(ctx, p, X, Y, scale, sign, size, log.color, 'ghost', shortKey(k, 1));
      }
    }
    // Target pose + whisker
    let target: Pose | undefined;
    if (settings.showTarget && log.roles.targetPose) {
      const ts = client.peekSeries(log.id, log.roles.targetPose);
      if (ts && ts.kind === 'struct') {
        const i = indexAtOrBefore(ts.t, raw);
        // only while a path is active (target updates stop afterwards): require a sample within 0.5 s
        if (i >= 0 && raw - ts.t[i] < 0.5) target = prep(toPose(ts.v[i]));
      }
    }
    // Trail + robot
    if (poseS && poseS.kind === 'struct') {
      const i = indexAtOrBefore(poseS.t, raw);
      if (i >= 0) {
        if (trailSeconds > 0) {
          let j0 = indexAtOrBefore(poseS.t, raw - trailSeconds);
          if (j0 < 0) j0 = 0;
          const n = i - j0 + 1;
          const step = Math.max(1, Math.floor(n / maxTrailPts));
          const pts: Pose[] = [];
          for (let j = j0; j <= i; j += step) {
            const p = prep(toPose(poseS.v[j]));
            if (p) pts.push(p);
          }
          drawPolyline(ctx, pts, X, Y, withAlpha(log.color, 0.55), 1.5, []);
        }
        const p = prep(toPose(poseS.v[i]));
        if (p) {
          if (target) {
            ctx.strokeStyle = pal.strong;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(X(p.x), Y(p.y));
            ctx.lineTo(X(target.x), Y(target.y));
            ctx.stroke();
            drawRobot(ctx, target, X, Y, scale, sign, size, pal.strong, 'ghost');
          }
          drawRobot(
            ctx,
            p,
            X,
            Y,
            scale,
            sign,
            size,
            log.color,
            'solid',
            settings.showLabels !== false ? log.name : undefined,
            log.matchInfo.alliance,
            settings.showParts !== false ? { layers: profile.layers, logId: log.id, raw, hidden: hiddenParts } : undefined,
          );
          robot = p;
        }
      }
    }

    // Cameras: lines to the tags in view, and a ghost where each camera thinks the robot is
    if (settings.showCameras !== false) {
      const flipTags = session.normalizeAlliance && log.matchInfo.alliance === 'red';
      let ghosts = 0;
      for (const cam of camerasFor(log)) {
        const pts: { x: number; y: number; id?: number }[] = [];
        let ids: number[] | null = null;
        if (cam.tagIdsKey && tags.length) {
          const sr = client.peekSeries(log.id, cam.tagIdsKey);
          if (sr && sr.kind === 'array') {
            const k = indexAtOrBefore(sr.t, raw);
            ids = k >= 0 ? tagIdsFromValue(sr.v[k], isBotposeKey(cam.tagIdsKey)) : [];
            for (const tid of ids) {
              const tg = tags.find((x) => x.id === tid);
              if (!tg) continue;
              // the layout is in the blue-wall frame; a red run drawn on the blue side has its tags flipped with it
              const q = flipTags ? flipAlliance({ x: tg.x, y: tg.y, theta: 0 }, season.length, season.width, season.symmetry) : tg;
              pts.push({ x: q.x, y: q.y, id: tid });
            }
          }
        } else if (cam.tagPosesKey) {
          const sr = client.peekSeries(log.id, cam.tagPosesKey);
          if (sr && sr.kind === 'struct') {
            const k = indexAtOrBefore(sr.t, raw);
            if (k >= 0)
              for (const tp of tagPosesFromValue(sr.v[k])) {
                const q = prep(tp);
                if (q) pts.push(q);
              }
          }
        }
        let origin: { x: number; y: number } | undefined = robot;
        if (robot && cam.mount) {
          const c = Math.cos(robot.theta);
          const sn = Math.sin(robot.theta);
          origin = { x: robot.x + cam.mount.x * c - cam.mount.y * sn, y: robot.y + cam.mount.x * sn + cam.mount.y * c };
        }
        for (const pt of pts) {
          const tx = X(pt.x);
          const ty = Y(pt.y);
          if (origin) {
            ctx.strokeStyle = withAlpha(cam.color, 0.95);
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(X(origin.x), Y(origin.y));
            ctx.lineTo(tx, ty);
            ctx.stroke();
          }
          ctx.fillStyle = cam.color;
          ctx.fillRect(tx - 5, ty - 5, 10, 10);
          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 1;
          ctx.strokeRect(tx - 5.5, ty - 5.5, 11, 11);
          if (pt.id !== undefined) {
            const label = String(pt.id);
            ctx.font = 'bold 10px sans-serif';
            const lw = ctx.measureText(label).width;
            ctx.fillStyle = pal.legendBg;
            ctx.fillRect(tx + 7, ty - 7, lw + 6, 14);
            ctx.fillStyle = cam.color;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(label, tx + 10, ty);
          }
        }
        if (origin && cam.mount && robot) {
          ctx.fillStyle = cam.color;
          ctx.beginPath();
          ctx.arc(X(origin.x), Y(origin.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
        let off: number | undefined;
        if (cam.poseKey) {
          const sr = client.peekSeries(log.id, cam.poseKey);
          if (sr && (sr.kind === 'struct' || sr.kind === 'array')) {
            const k = indexAtOrBefore(sr.t, raw);
            const est = k >= 0 ? prep(poseFromValue(sr.v[k])) : undefined;
            if (est) {
              drawRobot(ctx, est, X, Y, scale, sign, size, cam.color, 'ghost', cam.name, undefined, undefined, ghosts++);
              if (robot) off = Math.hypot(est.x - robot.x, est.y - robot.y);
            }
          }
        }
        const seenText = ids
          ? ids.length
            ? `tag${ids.length === 1 ? '' : 's'} ${ids.join(', ')}`
            : 'no tags'
          : pts.length
            ? `${pts.length} tag${pts.length === 1 ? '' : 's'}`
            : cam.tagPosesKey
              ? 'no tags'
              : '';
        const offText =
          off === undefined ? (cam.poseKey ? 'no estimate' : '') : width >= 520 ? `estimate ${off.toFixed(2)} m from the robot` : `${off.toFixed(2)} m off`;
        const text = [seenText, offText].filter(Boolean).join(' · ');
        if (text) readout.push({ color: cam.color, log: log.color, text: `${cam.name}: ${text}` });
      }
    }
  }

  // Camera readout, bottom left
  if (readout.length) {
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // keep the readout to about a quarter of a small panel
    const maxRows = Math.max(2, Math.min(6, Math.floor((height * 0.28) / 15)));
    const rowsShown =
      readout.length > maxRows
        ? [...readout.slice(0, maxRows - 1), { color: 'transparent', log: 'transparent', text: `and ${readout.length - maxRows + 1} more cameras` }]
        : readout;
    const bw = 34 + Math.max(...rowsShown.map((r) => ctx.measureText(r.text).width));
    const bh = rowsShown.length * 15 + 6;
    const by = height - bh - 18;
    ctx.fillStyle = pal.legendBg;
    ctx.fillRect(6, by, bw, bh);
    rowsShown.forEach((r, i) => {
      const y = by + 3 + i * 15 + 7.5;
      ctx.fillStyle = r.log;
      ctx.fillRect(10, y - 5, 3, 10);
      ctx.fillStyle = r.color;
      ctx.fillRect(17, y - 4, 8, 8);
      ctx.fillStyle = pal.fg;
      ctx.fillText(r.text, 30, y);
    });
  }

  // Caption and legend stay fixed to the panel while the field zooms under them
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const rows = logs.map((log) => `${log.name}${log.matchInfo.alliance ? ` (${log.matchInfo.alliance})` : ''}${log.roles.robotPose ? '' : ' — no pose'}`);
  if (rows.length) {
    const w = 30 + Math.max(...rows.map((r) => ctx.measureText(r).width));
    ctx.fillStyle = pal.legendBg;
    ctx.fillRect(6, 6, w, rows.length * 15 + 6);
    rows.forEach((r, i) => {
      ctx.fillStyle = logs[i].color;
      ctx.fillRect(12, 11 + i * 15, 10, 10);
      ctx.fillStyle = pal.fg;
      ctx.fillText(r, 26, 9 + i * 15);
    });
  }
  ctx.fillStyle = pal.fg2;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    `${season.name} · ${L.toFixed(2)} × ${W.toFixed(2)} m${session.normalizeAlliance ? ' · normalized to blue' : ''}${zoom !== 1 ? ` · ${zoom.toFixed(1)}×` : ''}`,
    width - 6,
    height - 3,
  );
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Pose[],
  X: (x: number) => number,
  Y: (y: number) => number,
  color: string,
  width: number,
  dash: number[],
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(X(pts[0].x), Y(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
  ctx.stroke();
  ctx.restore();
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  p: Pose,
  X: (x: number) => number,
  Y: (y: number) => number,
  scale: number,
  sign: 1 | -1,
  size: { length: number; width: number },
  color: string,
  style: 'solid' | 'ghost',
  label?: string,
  alliance?: 'red' | 'blue',
  parts?: { layers: Layer[]; logId: string; raw: number; hidden?: ReadonlySet<string> },
  /** Put the label under the robot, on this line (0 = first): for camera estimates, which sit on top of the robot. */
  labelBelow: number | false = false,
) {
  const pal = T();
  const cx = X(p.x);
  const cy = Y(p.y);
  // canvas y points down, so a counter-clockwise field heading is a negative canvas rotation; the 180° view adds π
  const ang = sign === 1 ? -p.theta : Math.PI - p.theta;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const w = size.length * scale;
  const h = size.width * scale;
  ctx.lineWidth = style === 'solid' ? 3 : 1.5;
  ctx.setLineDash(style === 'solid' ? [] : [4, 3]);
  ctx.strokeStyle = style === 'solid' ? (alliance === 'red' ? '#e15759' : alliance === 'blue' ? '#4f9ef7' : color) : color;
  ctx.fillStyle = style === 'solid' ? withAlpha(color, 0.55) : withAlpha(color, 0.06);
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  // heading arrow
  ctx.setLineDash([]);
  ctx.strokeStyle = style === 'solid' ? pal.strong : color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w / 2, 0);
  ctx.stroke();
  if (parts && parts.layers.length) drawLayers(ctx, parts.layers, scale, parts.logId, parts.raw, undefined, parts.hidden);
  ctx.restore();
  if (label) {
    ctx.fillStyle = style === 'solid' ? pal.strong : color;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = labelBelow !== false ? 'top' : 'bottom';
    // a turned robot reaches further than half its width: clear its corners
    const reach = Math.hypot(w, h) / 2;
    ctx.fillText(label, cx, labelBelow !== false ? cy + reach + 2 + labelBelow * 11 : cy - h / 2 - 2);
  }
}
