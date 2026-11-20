/**
 * Robot appearance editor: the extra parts drawn on top of the robot on the
 * 2D field. A part is a rectangle, an ellipse, or a picture / SVG. Parts sit
 * still by default; any part can be linked to a logged angle (a turret, a
 * hood, a swerve module) and then turns around its pivot as the log plays.
 * A part can be attached to another part: it moves with that part, and its
 * own angle adds on top (a wrist on an arm). The pivot is dragged in the
 * preview or picked from the part's center and ends.
 * Everything is stored in the robot profile.
 *
 * The test angle lives in a small store, not React state, so moving it only
 * redraws the preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { profileStore, updateProfile, newId, PART_LIMIT, type Layer } from '../state/profiles';
import { undo, redo, undoStore } from '../lib/undo';
import { NumberInput } from './NumberInput';
import { settingsStore } from '../state/settings';
import { uiStore, toast } from '../state/ui';
import { useStore, createStore, type Store } from '../state/store';
import { useCanvas } from '../lib/useCanvas';
import { drawLayers, linkAngle, ancestors, enterPart, enterPivotFrame } from '../lib/robotDraw';
import { fieldAssetTicker } from '../lib/fieldAssets';
import { T } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { shortKey } from '../lib/fields';
import { FieldSlot } from './FieldSlot';
import type { FieldSpec } from '../lib/fields';
import { Icon } from './Icon';

const MAX_LAYERS = 24;
const MAX_RASTER = 512;
const MAX_SVG_BYTES = 300_000;
const PART_COLORS = ['#f2c94c', '#56ccf2', '#bb6bd9', '#6fcf97', '#f2994a', '#eb5757', '#e0e0e0'];
const snap = (v: number) => Math.round(v * 200) / 200;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** A part turns with a logged number (an angle). */
export const ANGLE: FieldSpec = { types: ['number'], label: 'number (angle)' };

/** Undo a linked part's turn about its pivot, for a point in the robot frame. */
function undoTurn(l: Layer, x: number, y: number, preview: number): { x: number; y: number } {
  if (!l.link) return { x, y };
  const a = -linkAngle(l, null, 0, preview);
  const dx = x - l.pivot.x;
  const dy = y - l.pivot.y;
  return { x: l.pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: l.pivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** A point in the robot frame, in the frame a part's pivot is given in (undoing the turns of the parts it hangs from). */
function toPivotFrame(l: Layer, layers: Layer[], x: number, y: number, preview: number): { x: number; y: number } {
  let p = { x, y };
  for (const a of ancestors(l, layers)) p = undoTurn(a, p.x, p.y, preview);
  return p;
}

/** A point in the robot frame, in the part's own frame (undoing the parts it hangs from, its turn, position and rotation). */
function toLocal(l: Layer, layers: Layer[], x: number, y: number, preview: number): { x: number; y: number } {
  const q = toPivotFrame(l, layers, x, y, preview);
  const p = undoTurn(l, q.x, q.y, preview);
  const r = (-l.rotation * Math.PI) / 180;
  const dx = p.x - l.x;
  const dy = p.y - l.y;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

/** How far the part is turned in all: the parts it hangs from, and its own link. */
function totalTurn(l: Layer, layers: Layer[], preview: number): number {
  let a = linkAngle(l, null, 0, preview);
  for (const p of ancestors(l, layers)) a += linkAngle(p, null, 0, preview);
  return a;
}

/** Where on a part it can turn around, in its own frame (before its fixed rotation). */
const ANCHORS: [string, string, (l: Layer) => [number, number]][] = [
  ['center', 'its center', () => [0, 0]],
  ['back', 'its back end', (l) => [-l.length / 2, 0]],
  ['front', 'its front end', (l) => [l.length / 2, 0]],
  ['left', 'its left side', (l) => [0, l.width / 2]],
  ['right', 'its right side', (l) => [0, -l.width / 2]],
];

/** The robot-frame point for an anchor on a part. */
function anchorPoint(l: Layer, id: string): { x: number; y: number } {
  const [ax, ay] = (ANCHORS.find((a) => a[0] === id) ?? ANCHORS[0])[2](l);
  const r = (l.rotation * Math.PI) / 180;
  return { x: l.x + ax * Math.cos(r) - ay * Math.sin(r), y: l.y + ax * Math.sin(r) + ay * Math.cos(r) };
}

/** Which anchor the pivot sits on, or 'custom'. */
function anchorOf(l: Layer): string {
  for (const [id] of ANCHORS) {
    const p = anchorPoint(l, id);
    if (Math.abs(p.x - l.pivot.x) < 1e-3 && Math.abs(p.y - l.pivot.y) < 1e-3) return id;
  }
  return 'custom';
}

/** Parts a part may be attached to: not itself, and not a part that hangs from it. */
function parentChoices(l: Layer, layers: Layer[]): Layer[] {
  return layers.filter((x) => x.id !== l.id && !ancestors(x, layers).some((a) => a.id === l.id));
}

function hit(l: Layer, layers: Layer[], x: number, y: number, preview: number): boolean {
  const p = toLocal(l, layers, x, y, preview);
  const hx = Math.max(l.length / 2, 0.02);
  const hy = Math.max(l.width / 2, 0.02);
  if (l.kind === 'ellipse') return (p.x / hx) ** 2 + (p.y / hy) ** 2 <= 1;
  return Math.abs(p.x) <= hx && Math.abs(p.y) <= hy;
}

export function guessUnit(key: string): 'rad' | 'deg' | 'rot' {
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
  memory,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  title?: string;
  testId?: string;
  /** What it sets, so math typed into it is remembered (see NumberInput). */
  memory?: string;
}) {
  // takes math too ("0.09448 * 360"), and remembers it
  return (
    <NumberInput value={value} onCommit={(v) => v !== null && onChange(v)} min={min} max={max} format={fmt} title={title} testId={testId} memory={memory} />
  );
}

export function RobotEditor({ profileId }: { profileId: string }) {
  // select the list, then find: the selector must not close over a prop
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const [selected, setSelected] = useState<string | null>(null);
  // the test angle, in degrees: a store so the slider redraws only the preview
  const test = useMemo(() => createStore({ deg: 0 }), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const view = useRef({ cx: 0, cy: 0, scale: 100 });
  // The camera stays where the user puts it (wheel zooms, dragging empty space pans). It fits the
  // robot once when the editor opens and when asked (Fit, double-click empty space), never by
  // itself: refitting while a part was dragged outward zoomed out under the pointer, which pushed
  // the part further out, which zoomed out more.
  const cam = useRef<{ ox: number; oy: number; scale: number | null }>({ ox: 0, oy: 6, scale: null });
  const camTick = useMemo(() => createStore({ n: 0 }), []);
  const moveCam = (c: Partial<{ ox: number; oy: number; scale: number | null }>) => {
    Object.assign(cam.current, c);
    camTick.set((s) => ({ n: s.n + 1 }));
  };
  const fit = () => moveCam({ ox: 0, oy: 6, scale: null });
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    px: number;
    py: number;
    pivotFollows: boolean;
    /** Dragging the pivot marker rather than the part. */
    pivot: boolean;
    /** The part's total turn when the drag began, to move it in its own directions. */
    turn: number;
  } | null>(null);
  const layers = profile?.layers ?? [];
  const sel = layers.find((l) => l.id === selected) ?? null;
  const previewNow = () => (test.get().deg * Math.PI) / 180;
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
      // fit (when asked): the robot with room around it for parts that stick out
      if (cam.current.scale === null) {
        const span =
          Math.max(p.robot.length, p.robot.width, ...p.layers.map((l) => 2 * Math.max(Math.abs(l.x) + l.length / 2, Math.abs(l.y) + l.width / 2))) * 1.25;
        cam.current.scale = Math.max(2, Math.min(width, height - 24) / Math.max(span, 0.5));
      }
      const scale = cam.current.scale;
      const cx = width / 2 + cam.current.ox;
      const cy = height / 2 + cam.current.oy;
      view.current = { cx, cy, scale };
      // where the robot is on screen, for the UI test
      canvasRef.current?.setAttribute('data-view', `${cx.toFixed(1)} ${cy.toFixed(1)} ${scale.toFixed(3)}`);
      // grid: 10 cm, or 1 m when zoomed far out
      const gridM = 0.1 * scale >= 6 ? 0.1 : 1;
      const step = gridM * scale;
      if (step >= 6) {
        ctx.strokeStyle = pal.fieldGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ((cx % step) + step) % step; x < width; x += step) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, height);
        }
        for (let y = ((cy % step) + step) % step; y < height; y += step) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(width, Math.round(y) + 0.5);
        }
        ctx.stroke();
      }
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
      const preview = (test.get().deg * Math.PI) / 180;
      drawLayers(ctx, p.layers, scale, null, 0, preview);
      const s = p.layers.find((l) => l.id === selected);
      if (s) {
        ctx.save();
        enterPart(ctx, s, p.layers, scale, null, 0, preview);
        ctx.strokeStyle = pal.strong;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect((-s.length * scale) / 2 - 2, (-s.width * scale) / 2 - 2, s.length * scale + 4, s.width * scale + 4);
        ctx.restore();
        if (s.link) {
          // pivot marker (drag it to move the pivot), in the frame of the parts it hangs from
          ctx.save();
          enterPivotFrame(ctx, s, p.layers, scale, null, 0, preview);
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
          ctx.restore();
        }
      }
      ctx.restore();
      ctx.fillStyle = pal.fg2;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Front', Math.min(width - 24, Math.max(24, cx)), 6);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(step >= 6 ? `Grid: ${gridM === 1 ? '1 m' : '10 cm'}` : '', 8, height - 6);
    },
    [profileStore, settingsStore, fieldAssetTicker, test, camTick],
    [profileId, selected],
  );

  /** Screen position (inside the canvas) to the robot frame: up is forward, left is left. */
  const toRobot = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return { x: -(e.clientY - r.top - v.cy) / v.scale, y: -(e.clientX - r.left - v.cx) / v.scale };
  };
  /** Drag the view: the middle button anywhere, the left button on empty space (a click there clears the selection). */
  const panFrom = (e: React.MouseEvent, clickClears: boolean) => {
    const start = { x: e.clientX, y: e.clientY, ox: cam.current.ox, oy: cam.current.oy };
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      moveCam({ ox: start.ox + ev.clientX - start.x, oy: start.oy + ev.clientY - start.y });
    };
    const onUp = () => {
      if (canvasRef.current) canvasRef.current.style.cursor = '';
      if (!moved && clickClears) setSelected(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // wheel zooms around the pointer, without limits that matter: Fit brings the robot back
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current;
      if (c.scale === null) return;
      const r = el.getBoundingClientRect();
      const factor = Math.exp((e.deltaY > 0 ? -1 : 1) * 0.15 * Math.min(3, Math.abs(e.deltaY) / 50 + 0.5));
      const next = Math.max(2, Math.min(20000, c.scale * factor));
      // keep the point under the pointer where it is
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const v = view.current;
      const rx = -(sy - v.cy) / v.scale;
      const ry = -(sx - v.cx) / v.scale;
      moveCam({ scale: next, ox: sx + ry * next - r.width / 2, oy: sy + rx * next - r.height / 2 });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef.current]);
  const onDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      panFrom(e, false);
      return;
    }
    if (e.button !== 0) return;
    const p = toRobot(e);
    const preview = previewNow();
    const clamp = (v: number) => snap(Math.max(-PART_LIMIT, Math.min(PART_LIMIT, v)));
    // the selected part's pivot marker comes first: it sits on top of parts
    const onPivot = (() => {
      if (!sel?.link) return false;
      // a pivot at the part's center sits under the part: a plain drag moves the part, Alt-drag the pivot
      if (Math.abs(sel.pivot.x - sel.x) < 1e-6 && Math.abs(sel.pivot.y - sel.y) < 1e-6 && !e.altKey) return false;
      const q = toPivotFrame(sel, layers, p.x, p.y, preview);
      return Math.hypot(q.x - sel.pivot.x, q.y - sel.pivot.y) * view.current.scale <= 9;
    })();
    // else the last part drawn (on top) under the pointer
    const top = onPivot ? sel : [...layers].reverse().find((l) => hit(l, layers, p.x, p.y, preview));
    if (!top) {
      panFrom(e, true);
      return;
    }
    setSelected(top.id);
    const pivotFollows = Math.abs(top.pivot.x - top.x) < 1e-6 && Math.abs(top.pivot.y - top.y) < 1e-6;
    // the pivot, and a part turning about its own center, move in the directions of the parts they hang from;
    // a part turning about another point moves in its own turned directions
    const own = linkAngle(top, null, 0, preview);
    drag.current = {
      id: top.id,
      startX: p.x,
      startY: p.y,
      x: top.x,
      y: top.y,
      px: top.pivot.x,
      py: top.pivot.y,
      pivotFollows,
      pivot: onPivot,
      turn: onPivot || pivotFollows ? totalTurn(top, layers, preview) - own : totalTurn(top, layers, preview),
    };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const q = toRobot(ev);
      // the pointer's move, turned back into the part's own directions
      const mx = q.x - d.startX;
      const my = q.y - d.startY;
      const c = Math.cos(-d.turn);
      const sn = Math.sin(-d.turn);
      const dx = mx * c - my * sn;
      const dy = mx * sn + my * c;
      if (d.pivot) {
        patch(d.id, { pivot: { x: clamp(d.px + dx), y: clamp(d.py + dy) } });
        return;
      }
      const x = clamp(d.x + dx);
      const y = clamp(d.y + dy);
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
        <div className="robot-preview-bar">
          <span className="hint">Wheel zooms. Drag empty space to move the view.</span>
          <span className="toolbar-spacer" />
          <button className="btn" onClick={fit} title="Show the whole robot again (or double-click empty space)" data-testid="robot-fit">
            Fit
          </button>
        </div>
        <div className="robot-canvas-host">
          <canvas
            ref={canvasRef}
            onMouseDown={onDown}
            onDoubleClick={(e) => {
              const p = toRobot(e);
              if (!layers.some((l) => hit(l, layers, p.x, p.y, previewNow()))) fit();
            }}
            data-testid="robot-preview"
            title="Drag a part to move it. Drag the round marker to move a part's pivot (Alt-drag when the pivot is at the part's center). Wheel zooms; drag empty space to move the view; double-click empty space to fit."
          />
        </div>
        {anyLinked && <TestAngle store={test} />}
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
                <Num
                  value={sel.x}
                  memory={`${profileId}:${sel.id}:x`}
                  min={-PART_LIMIT}
                  max={PART_LIMIT}
                  title="Forward of the robot's center (m)"
                  onChange={(v) => patch(sel.id, { x: v })}
                  testId="layer-x"
                />{' '}
                forward,
                <Num
                  value={sel.y}
                  memory={`${profileId}:${sel.id}:y`}
                  min={-PART_LIMIT}
                  max={PART_LIMIT}
                  title="Left of the robot's center (m)"
                  onChange={(v) => patch(sel.id, { y: v })}
                  testId="layer-y"
                />{' '}
                left (m)
              </span>
            </div>
            <div className="robot-pair" title="Length runs along the robot's front-to-back direction, width across it">
              Size
              <span className="size-inputs">
                <Num
                  value={sel.length}
                  memory={`${profileId}:${sel.id}:length`}
                  min={0.01}
                  max={PART_LIMIT}
                  title="Length (m)"
                  onChange={(v) => patch(sel.id, { length: v })}
                  testId="layer-length"
                />{' '}
                ×
                <Num
                  value={sel.width}
                  memory={`${profileId}:${sel.id}:width`}
                  min={0.01}
                  max={PART_LIMIT}
                  title="Width (m)"
                  onChange={(v) => patch(sel.id, { width: v })}
                />{' '}
                m
              </span>
            </div>
            <div className="robot-pair">
              Turned
              <span className="size-inputs">
                <Num
                  value={sel.rotation}
                  memory={`${profileId}:${sel.id}:rotation`}
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
            <div className="robot-pair" title="Attach this part to another: it then moves with that part's turn (a claw on an arm, a wrist on an elbow)">
              Attached to
              <select
                className="tool-select"
                value={sel.parent ?? ''}
                onChange={(e) => patch(sel.id, { parent: e.target.value || null })}
                data-testid="layer-parent"
              >
                <option value="">the robot</option>
                {parentChoices(sel, layers).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.link ? '' : ' (does not turn)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="robot-link">
              <FieldSlot
                label="Turns with"
                spec={ANGLE}
                value={sel.link?.key}
                onPick={(key) =>
                  patch(sel.id, {
                    link: { key, unit: sel.link?.unit ?? guessUnit(key), offset: sel.link?.offset ?? 0, invert: sel.link?.invert ?? false },
                    pivot: sel.link ? sel.pivot : { x: sel.x, y: sel.y },
                  })
                }
                onClear={() => patch(sel.id, { link: null })}
                testId="layer-link"
              />
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
                      <Num
                        value={sel.link.offset}
                        memory={`${profileId}:${sel.id}:link.offset`}
                        min={-360}
                        max={360}
                        onChange={(v) => patch(sel.id, { link: { ...sel.link!, offset: v } })}
                      />{' '}
                      °
                    </span>
                  </div>
                  <div className="robot-pair" title="The point the part turns around. You can also drag the round marker in the preview.">
                    Turns around
                    <select
                      className="tool-select"
                      value={anchorOf(sel)}
                      onChange={(e) => e.target.value !== 'custom' && patch(sel.id, { pivot: anchorPoint(sel, e.target.value) })}
                      data-testid="layer-anchor"
                    >
                      {ANCHORS.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                      <option value="custom">a point I set</option>
                    </select>
                  </div>
                  <div className="robot-pair" title="The pivot, measured from the robot's center with every angle at zero">
                    Pivot
                    <span className="size-inputs">
                      <Num
                        value={sel.pivot.x}
                        memory={`${profileId}:${sel.id}:pivot.x`}
                        min={-PART_LIMIT}
                        max={PART_LIMIT}
                        title="Forward (m)"
                        onChange={(v) => patch(sel.id, { pivot: { ...sel.pivot, x: v } })}
                        testId="layer-pivot-x"
                      />{' '}
                      forward,
                      <Num
                        value={sel.pivot.y}
                        memory={`${profileId}:${sel.id}:pivot.y`}
                        min={-PART_LIMIT}
                        max={PART_LIMIT}
                        title="Left (m)"
                        onChange={(v) => patch(sel.id, { pivot: { ...sel.pivot, y: v } })}
                        testId="layer-pivot-y"
                      />{' '}
                      left
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Preview only: turns every linked part by this angle, as a logged angle would. Re-renders only itself. */
function TestAngle({ store }: { store: Store<{ deg: number }> }) {
  const deg = useStore(store, (s) => s.deg);
  return (
    <label className="robot-test" title="Preview only: turns every linked part by this angle, as a logged angle would">
      Test angle
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={deg}
        onChange={(e) => store.set({ deg: Number(e.target.value) })}
        data-testid="robot-test-angle"
      />
      <span className="mono">{deg}°</span>
    </label>
  );
}

/** Undo and redo, here too (Ctrl+Z and Ctrl+Shift+Z also work while the editor is open). */
function UndoButtons() {
  const { canUndo, canRedo } = useStore(undoStore, (s) => s);
  return (
    <>
      <button className="btn" onClick={() => void undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" data-testid="robot-undo">
        <Icon name="undo" size={12} /> Undo
      </button>
      <button className="btn" onClick={() => void redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" data-testid="robot-redo">
        <Icon name="redo" size={12} /> Redo
      </button>
    </>
  );
}

/** The editor as a dialog (opened from Robot setup, Robot and the 2D field's Display menu). */
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
          <UndoButtons />
          <button className="btn primary" onClick={close} data-testid="robot-done">
            Done
          </button>
        </div>
        <RobotEditor profileId={profileId} />
      </div>
    </div>
  );
}
