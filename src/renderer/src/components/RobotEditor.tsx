/**
 * Robot appearance editor: the extra parts drawn on top of the robot on the
 * 2D field. A part is a rectangle, an ellipse, or a picture / SVG. Parts sit
 * still by default; any part can be linked to a logged angle (a turret, a
 * hood, a swerve module) and then turns around its pivot as the log plays.
 * Everything is stored in the robot profile.
 */
import { useEffect, useRef, useState } from 'react';
import { profileStore, updateProfile, newId, type Layer } from '../state/profiles';
import { settingsStore } from '../state/settings';
import { uiStore, toast } from '../state/ui';
import { useStore } from '../state/store';
import { useCanvas } from '../lib/useCanvas';
import { drawLayers, linkAngle } from '../lib/robotDraw';
import { fieldAssetTicker } from '../lib/fieldAssets';
import { T } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { shortKey } from '../lib/fields';
import { FieldPicker } from './FieldPicker';
import { Icon } from './Icon';

const MAX_LAYERS = 24;
const MAX_RASTER = 512;
const MAX_SVG_BYTES = 300_000;
const PART_COLORS = ['#f2c94c', '#56ccf2', '#bb6bd9', '#6fcf97', '#f2994a', '#eb5757', '#e0e0e0'];
const snap = (v: number) => Math.round(v * 200) / 200;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** A point in the robot frame, in the part's own frame (undoing its link turn, position and rotation). */
function toLocal(l: Layer, x: number, y: number, preview: number): { x: number; y: number } {
  let px = x;
  let py = y;
  if (l.link) {
    const a = -linkAngle(l, null, 0, preview);
    const dx = px - l.pivot.x;
    const dy = py - l.pivot.y;
    px = l.pivot.x + dx * Math.cos(a) - dy * Math.sin(a);
    py = l.pivot.y + dx * Math.sin(a) + dy * Math.cos(a);
  }
  const r = (-l.rotation * Math.PI) / 180;
  const dx = px - l.x;
  const dy = py - l.y;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

function hit(l: Layer, x: number, y: number, preview: number): boolean {
  const p = toLocal(l, x, y, preview);
  const hx = Math.max(l.length / 2, 0.02);
  const hy = Math.max(l.width / 2, 0.02);
  if (l.kind === 'ellipse') return (p.x / hx) ** 2 + (p.y / hy) ** 2 <= 1;
  return Math.abs(p.x) <= hx && Math.abs(p.y) <= hy;
}

function guessUnit(key: string): 'rad' | 'deg' | 'rot' {
  if (/deg/i.test(key)) return 'deg';
  if (/rotations?$|rots?$|turns?$/i.test(key)) return 'rot';
  return 'rad';
}

function readAs(file: File, how: 'text' | 'dataUrl'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    if (how === 'text') r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not a picture'));
    img.src = src;
  });
}

/** A picture file as a small data URL to keep inside the profile, with its shape. */
async function importPicture(file: File): Promise<{ src: string; aspect: number }> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    if (file.size > MAX_SVG_BYTES)
      throw new Error(`That SVG is ${Math.round(file.size / 1000)} kB. SVGs up to ${MAX_SVG_BYTES / 1000} kB can be kept in a robot profile.`);
    const text = await readAs(file, 'text');
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const src = `data:image/svg+xml;base64,${btoa(bin)}`;
    const img = await loadImage(src);
    return { src, aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1 };
  }
  const img = await loadImage(await readAs(file, 'dataUrl'));
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('That picture has no size.');
  const k = Math.min(1, MAX_RASTER / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  let src = c.toDataURL('image/webp', 0.9);
  if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
  return { src, aspect: img.naturalWidth / img.naturalHeight };
}

function Num({
  value,
  onChange,
  min,
  max,
  title,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  title?: string;
  testId?: string;
}) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) setText(fmt(value));
    else onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <input
      className="tool-input num"
      value={text}
      title={title}
      data-testid={testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function RobotEditor({ profileId }: { profileId: string }) {
  // select the list, then find: the selector must not close over a prop
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const [selected, setSelected] = useState<string | null>(null);
  const [testDeg, setTestDeg] = useState(0);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const view = useRef({ cx: 0, cy: 0, scale: 100 });
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number; px: number; py: number; pivotFollows: boolean } | null>(null);
  const layers = profile?.layers ?? [];
  const sel = layers.find((l) => l.id === selected) ?? null;
  const preview = (testDeg * Math.PI) / 180;
  const anyLinked = layers.some((l) => l.link);

  const setLayers = (fn: (l: Layer[]) => Layer[]) => updateProfile(profileId, (p) => ({ layers: fn(p.layers) }));
  const patch = (id: string, c: Partial<Layer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...c } : l)));
  const add = (l: Omit<Layer, 'id'>) => {
    if (layers.length >= MAX_LAYERS) {
      toast(`A robot can have up to ${MAX_LAYERS} parts.`, 'error');
      return;
    }
    const id = newId('layer');
    setLayers((ls) => [...ls, { ...l, id }]);
    setSelected(id);
  };
  const addShape = (kind: 'rect' | 'ellipse') => {
    const n = layers.filter((l) => l.kind === kind).length + 1;
    add({
      name: `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} ${n}`,
      kind,
      x: 0,
      y: 0,
      length: 0.3,
      width: 0.2,
      rotation: 0,
      opacity: 1,
      color: PART_COLORS[layers.length % PART_COLORS.length],
      link: null,
      pivot: { x: 0, y: 0 },
    });
  };
  const addPicture = async (file: File | undefined) => {
    if (!file || !profile) return;
    try {
      const { src, aspect } = await importPicture(file);
      // a picture's top is the robot's front: its height runs along the robot's length
      let length = profile.robot.length;
      let width = length * aspect;
      if (width > profile.robot.width) {
        width = profile.robot.width;
        length = width / aspect;
      }
      add({
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Picture',
        kind: 'image',
        x: 0,
        y: 0,
        length: snap(length),
        width: snap(width),
        rotation: 0,
        opacity: 1,
        color: '#ffffff',
        src,
        link: null,
        pivot: { x: 0, y: 0 },
      });
    } catch (e) {
      toast(`Could not add ${file.name}: ${e instanceof Error ? e.message : 'not a picture this app can read'}.`, 'error', undefined, 8000);
    }
  };
  const move = (id: string, by: -1 | 1) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const out = ls.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  const canvasRef = useCanvas(
    ({ ctx, width, height }) => {
      const pal = T();
      const p = profileStore.get().profiles.find((x) => x.id === profileId);
      ctx.fillStyle = pal.fieldBg;
      ctx.fillRect(0, 0, width, height);
      if (!p) return;
      // show the robot with room around it for parts that stick out
      const span =
        Math.max(p.robot.length, p.robot.width, ...p.layers.map((l) => 2 * Math.max(Math.abs(l.x) + l.length / 2, Math.abs(l.y) + l.width / 2))) * 1.25;
      const scale = Math.max(20, Math.min(width, height - 24) / Math.max(span, 0.5));
      const cx = width / 2;
      const cy = height / 2 + 6;
      view.current = { cx, cy, scale };
      // 10 cm grid
      ctx.strokeStyle = pal.fieldGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 0.1 * scale;
      for (let x = cx % step; x < width; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
      }
      for (let y = cy % step; y < height; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      // the robot's front points up on the screen
      ctx.rotate(-Math.PI / 2);
      const w = p.robot.length * scale;
      const h = p.robot.width * scale;
      ctx.fillStyle = withAlpha(pal.accent, 0.25);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = pal.strong;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w / 2, 0);
      ctx.stroke();
      drawLayers(ctx, p.layers, scale, null, 0, preview);
      const s = p.layers.find((l) => l.id === selected);
      if (s) {
        ctx.save();
        if (s.link) {
          ctx.translate(s.pivot.x * scale, -s.pivot.y * scale);
          ctx.rotate(-linkAngle(s, null, 0, preview));
          ctx.translate(-s.pivot.x * scale, s.pivot.y * scale);
        }
        ctx.translate(s.x * scale, -s.y * scale);
        ctx.rotate((-s.rotation * Math.PI) / 180);
        ctx.strokeStyle = pal.strong;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect((-s.length * scale) / 2 - 2, (-s.width * scale) / 2 - 2, s.length * scale + 4, s.width * scale + 4);
        ctx.restore();
        if (s.link) {
          // pivot marker
          const px = s.pivot.x * scale;
          const py = -s.pivot.y * scale;
          ctx.strokeStyle = pal.strong;
          ctx.fillStyle = pal.fieldBg;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px - 8, py);
          ctx.lineTo(px + 8, py);
          ctx.moveTo(px, py - 8);
          ctx.lineTo(px, py + 8);
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.fillStyle = pal.fg2;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Front', cx, 6);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Grid: 10 cm', 8, height - 6);
    },
    [profileStore, settingsStore, fieldAssetTicker],
    [profileId, selected, preview],
  );

  /** Screen position (inside the canvas) to the robot frame: up is forward, left is left. */
  const toRobot = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return { x: -(e.clientY - r.top - v.cy) / v.scale, y: -(e.clientX - r.left - v.cx) / v.scale };
  };
  const onDown = (e: React.MouseEvent) => {
    const p = toRobot(e);
    // the last part is drawn on top
    const top = [...layers].reverse().find((l) => hit(l, p.x, p.y, preview));
    setSelected(top?.id ?? null);
    if (!top) return;
    drag.current = {
      id: top.id,
      startX: p.x,
      startY: p.y,
      x: top.x,
      y: top.y,
      px: top.pivot.x,
      py: top.pivot.y,
      pivotFollows: Math.abs(top.pivot.x - top.x) < 1e-6 && Math.abs(top.pivot.y - top.y) < 1e-6,
    };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const q = toRobot(ev);
      const x = snap(Math.max(-3, Math.min(3, d.x + q.x - d.startX)));
      const y = snap(Math.max(-3, Math.min(3, d.y + q.y - d.startY)));
      patch(d.id, d.pivotFollows ? { x, y, pivot: { x, y } } : { x, y });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!profile) return null;
  return (
    <div className="robot-editor" data-testid="robot-editor">
      <div className="robot-preview">
        <canvas ref={canvasRef} onMouseDown={onDown} data-testid="robot-preview" />
        {anyLinked && (
          <label className="robot-test" title="Preview only: turns every linked part by this angle, as a logged angle would">
            Test angle
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={testDeg}
              onChange={(e) => setTestDeg(Number(e.target.value))}
              data-testid="robot-test-angle"
            />
            <span className="mono">{testDeg}°</span>
          </label>
        )}
      </div>
      <div className="robot-side scroll">
        <div className="robot-add">
          <button className="btn" onClick={() => addShape('rect')} data-testid="add-rect">
            <Icon name="plus" size={12} /> Rectangle
          </button>
          <button className="btn" onClick={() => addShape('ellipse')} data-testid="add-ellipse">
            <Icon name="plus" size={12} /> Ellipse
          </button>
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            title="PNG, JPEG, WebP, GIF or SVG. The top of the picture is the front of the robot."
            data-testid="add-picture"
          >
            <Icon name="image" size={12} /> Picture or SVG
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
            style={{ display: 'none' }}
            data-testid="robot-picture-file"
            onChange={(e) => (void addPicture(e.target.files?.[0]), (e.target.value = ''))}
          />
        </div>
        {layers.length === 0 ? (
          <div className="callout">
            <div>
              The robot is drawn as a plain box. Add parts on top of it: shapes for an intake or a turret, or a top-down picture of the whole robot. Drag a part
              in the preview to place it. A part can turn with a logged angle.
            </div>
          </div>
        ) : (
          <div className="robot-layers" data-testid="robot-layers">
            {[...layers].reverse().map((l) => (
              <div key={l.id} className={`robot-layer${l.id === selected ? ' selected' : ''}`} onClick={() => setSelected(l.id)} data-layer={l.name}>
                <span
                  className="robot-swatch"
                  style={
                    l.kind === 'image'
                      ? { backgroundImage: l.src ? `url("${l.src}")` : undefined }
                      : { background: l.color, borderRadius: l.kind === 'ellipse' ? '50%' : 2 }
                  }
                />
                <span className="robot-layer-name">{l.name}</span>
                {l.link && (
                  <span className="hint" title={`Turns with ${l.link.key}`}>
                    linked
                  </span>
                )}
                <button className="chip-btn" title="Draw this part above the next one" onClick={(e) => (e.stopPropagation(), move(l.id, 1))}>
                  <Icon name="arrowUp" size={11} />
                </button>
                <button className="chip-btn" title="Draw this part below the previous one" onClick={(e) => (e.stopPropagation(), move(l.id, -1))}>
                  <Icon name="arrowDown" size={11} />
                </button>
                <button
                  className="chip-btn"
                  title="Delete this part"
                  onClick={(e) => (e.stopPropagation(), setLayers((ls) => ls.filter((x) => x.id !== l.id)))}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {sel && (
          <div className="robot-form" data-testid="robot-form">
            <label>
              Name
              <input className="tool-input" value={sel.name} onChange={(e) => patch(sel.id, { name: e.target.value.slice(0, 40) })} />
            </label>
            <div className="robot-pair" title="Where the part's center is, measured from the robot's center">
              Position
              <span className="size-inputs">
                <Num value={sel.x} min={-3} max={3} title="Forward of the robot's center (m)" onChange={(v) => patch(sel.id, { x: v })} testId="layer-x" />{' '}
                forward,
                <Num value={sel.y} min={-3} max={3} title="Left of the robot's center (m)" onChange={(v) => patch(sel.id, { y: v })} testId="layer-y" /> left
                (m)
              </span>
            </div>
            <div className="robot-pair" title="Length runs along the robot's front-to-back direction, width across it">
              Size
              <span className="size-inputs">
                <Num value={sel.length} min={0.01} max={4} title="Length (m)" onChange={(v) => patch(sel.id, { length: v })} testId="layer-length" /> ×
                <Num value={sel.width} min={0.01} max={4} title="Width (m)" onChange={(v) => patch(sel.id, { width: v })} /> m
              </span>
            </div>
            <div className="robot-pair">
              Turned
              <span className="size-inputs">
                <Num
                  value={sel.rotation}
                  min={-360}
                  max={360}
                  title="Fixed rotation, counter-clockwise (degrees)"
                  onChange={(v) => patch(sel.id, { rotation: v })}
                />{' '}
                ° counter-clockwise
              </span>
            </div>
            <div className="robot-pair">
              Opacity
              <input type="range" min={0.05} max={1} step={0.05} value={sel.opacity} onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) })} />
              {sel.kind !== 'image' && <input type="color" value={sel.color} title="Color" onChange={(e) => patch(sel.id, { color: e.target.value })} />}
            </div>
            <div className="robot-link">
              <div className="robot-pair">
                <span title="The part turns around its pivot by the value of a logged number field">Turns with</span>
                <span className={`cam-slot-key mono`} title={sel.link?.key ?? 'This part does not move'}>
                  {sel.link ? shortKey(sel.link.key, 4) : <span className="hint">nothing (it stays still)</span>}
                </span>
                <button className="btn small" onClick={() => setPicking(true)} data-testid="layer-link">
                  Pick
                </button>
                {sel.link && (
                  <button className="chip-btn" title="Stop turning this part" onClick={() => patch(sel.id, { link: null })}>
                    <Icon name="close" size={10} />
                  </button>
                )}
              </div>
              {sel.link && (
                <>
                  <div className="robot-pair">
                    The field is in
                    <select
                      className="tool-select"
                      value={sel.link.unit}
                      onChange={(e) => patch(sel.id, { link: { ...sel.link!, unit: e.target.value as 'rad' | 'deg' | 'rot' } })}
                      data-testid="layer-unit"
                    >
                      <option value="rad">radians</option>
                      <option value="deg">degrees</option>
                      <option value="rot">rotations</option>
                    </select>
                    <label className="check" title="Turn the other way">
                      <input type="checkbox" checked={sel.link.invert} onChange={(e) => patch(sel.id, { link: { ...sel.link!, invert: e.target.checked } })} />{' '}
                      reversed
                    </label>
                  </div>
                  <div className="robot-pair" title="Added to the logged angle: where the part points when the field reads zero">
                    Zero offset
                    <span className="size-inputs">
                      <Num value={sel.link.offset} min={-360} max={360} onChange={(v) => patch(sel.id, { link: { ...sel.link!, offset: v } })} /> °
                    </span>
                  </div>
                  <div className="robot-pair" title="The point the part turns around, measured from the robot's center">
                    Pivot
                    <span className="size-inputs">
                      <Num value={sel.pivot.x} min={-3} max={3} title="Forward (m)" onChange={(v) => patch(sel.id, { pivot: { ...sel.pivot, x: v } })} />{' '}
                      forward,
                      <Num value={sel.pivot.y} min={-3} max={3} title="Left (m)" onChange={(v) => patch(sel.id, { pivot: { ...sel.pivot, y: v } })} /> left
                    </span>
                    <button className="btn small" onClick={() => patch(sel.id, { pivot: { x: sel.x, y: sel.y } })} title="Turn the part around its own center">
                      Center
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {picking && sel && (
        <FieldPicker
          title="Angle field for this part"
          filter={(f) => f.kind === 'number'}
          onClose={() => setPicking(false)}
          onPick={(key) => {
            patch(sel.id, {
              link: { key, unit: sel.link?.unit ?? guessUnit(key), offset: sel.link?.offset ?? 0, invert: sel.link?.invert ?? false },
              pivot: sel.link ? sel.pivot : { x: sel.x, y: sel.y },
            });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** The editor as a dialog (opened from Settings → Robot and the 2D field's Display menu). */
export function RobotEditorModal() {
  const profileId = useStore(uiStore, (s) => s.robotEditorFor);
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const close = () => uiStore.set({ robotEditorFor: null });
  useEffect(() => {
    if (!profileId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiStore.get().dialogs.length === 0 && document.querySelectorAll('.modal-backdrop').length <= 1) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profileId]);
  if (!profileId || !profile) return null;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal robot-modal" role="dialog" aria-label="Robot appearance" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Robot appearance</strong>
          <span className="modal-sub">Robot profile: {profile.name}</span>
          <span className="toolbar-spacer" />
          <button className="btn primary" onClick={close} data-testid="robot-done">
            Done
          </button>
        </div>
        <RobotEditor profileId={profileId} />
      </div>
    </div>
  );
}
