/**
 * Driver controller at the cursor: sticks, triggers, buttons and D-pad, one
 * drawing per log. Reads AdvantageKit's /DriverStation/Joystick<N>/... fields
 * or WPILib's DS:joystick<N>/... (see core/controller.ts). The layout (Xbox,
 * PlayStation, or a plain list for anything else) is saved in the robot profile.
 */
import { useCallback } from 'react';
import { panelStore, updatePanel, type ControllerSettings } from '../state/panels';
import { sessionStore, activeProfileId, type LogEntry } from '../state/session';
import { profileStore, profileById, updateProfile } from '../state/profiles';
import { timeStore } from '../state/time';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { indexAtOrBefore, type FieldInfo } from '@core/log';
import { controllerKeys, decodeButtons, decodePov, PAD_MAPS, type ControllerKeys, type ControllerLayout, type PadMap } from '@core/controller';
import { T, type Palette } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { Toolbar, ToolSelect, ToolGroup } from '../components/Toolbar';
import { GuideLink } from '../components/Guide';

const keyCache = new WeakMap<FieldInfo[], Map<number, ControllerKeys | null>>();
function keysFor(log: LogEntry, index: number): ControllerKeys | null {
  let m = keyCache.get(log.fields);
  if (!m) keyCache.set(log.fields, (m = new Map()));
  if (!m.has(index)) {
    const set = new Set(log.fields.map((f) => f.key));
    m.set(
      index,
      controllerKeys((k) => set.has(k), index, log.era === '2027'),
    );
  }
  return m.get(index) ?? null;
}

interface PadState {
  buttons: boolean[];
  axes: number[];
  pov: { x: number; y: number } | null;
  name?: string;
}

function stateAt(log: LogEntry, keys: ControllerKeys, raw: number): PadState {
  const at = (key: string | undefined): unknown => {
    if (!key) return undefined;
    const s = client.peekSeries(log.id, key);
    if (!s) return undefined;
    const i = indexAtOrBefore(s.t, raw);
    return i < 0 ? undefined : s.v[i];
  };
  const axes = at(keys.axes);
  const povs = at(keys.povs);
  const name = at(keys.name);
  return {
    buttons: decodeButtons(at(keys.buttons)),
    axes: Array.isArray(axes) ? (axes as number[]).map((a) => (Number.isFinite(a) ? a : 0)) : [],
    pov: decodePov(Array.isArray(povs) ? povs[0] : povs, keys.povMode),
    name: typeof name === 'string' ? name : undefined,
  };
}

export function ControllerPanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as ControllerSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const profileId = useStore(sessionStore, () => activeProfileId());
  const profiles = useStore(profileStore, (s) => s.profiles);
  const profile = profiles.find((p) => p.id === profileId) ?? profileById(profileId);
  const draw = useCallback((dc: DrawContext) => drawControllers(dc, id), [id]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore, profileStore], [id]);
  const found = logs.some((l) => keysFor(l, settings.index));

  return (
    <div className="panel controller-panel">
      <Toolbar>
        <ToolSelect
          value={String(settings.index)}
          onChange={(v) => updatePanel<ControllerSettings>(id, { index: Number(v) })}
          options={[0, 1, 2, 3, 4, 5].map((n) => [String(n), `Controller ${n}`])}
          title="Driver Station slot (the port used in the robot code)"
        />
        <ToolGroup className="hdr-label">
          Layout
          <ToolSelect
            value={profile.controllerLayout}
            onChange={(v) => updateProfile(profile.id, { controllerLayout: v as ControllerLayout })}
            options={[
              ['xbox', 'Xbox'],
              ['playstation', 'PlayStation'],
              ['list', 'Plain list'],
            ]}
            title="How buttons and axes are numbered. Saved in the robot profile. Use the plain list for flight sticks and button boards."
          />
        </ToolGroup>
        <ToolSelect
          low
          value={settings.source}
          onChange={(v) => updatePanel<ControllerSettings>(id, { source: v })}
          options={[['all', 'All logs'], ...logs.map((l) => [l.id, l.name] as [string, string])]}
          title="Which log(s) to show"
        />
      </Toolbar>
      <div className="canvas-host">
        <canvas ref={ref} />
        {logs.length > 0 && !found && (
          <div className="panel-placeholder">
            No controller {settings.index} in the open logs. AdvantageKit records controllers by itself; with WPILib DataLogManager, call{' '}
            <code>DriverStation.startDataLog(DataLogManager.getLog())</code> in the robot code.
            <GuideLink section="controller" />
          </div>
        )}
        {logs.length === 0 && <div className="panel-placeholder">Open a log to see the driver controller.</div>}
      </div>
    </div>
  );
}

function drawControllers(dc: DrawContext, id: string) {
  const { ctx, width, height } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as ControllerSettings | undefined;
  if (!settings) return;
  const session = sessionStore.get();
  const time = timeStore.get();
  let logs = session.logs.filter((l) => l.visible && keysFor(l, settings.index));
  if (settings.source !== 'all') logs = logs.filter((l) => l.id === settings.source);
  if (!logs.length) return;
  const tCursor = time.hover ?? time.cursor ?? time.view[1];

  // the grid of cells that keeps each drawing largest (a pad is about 1.6 : 1)
  let best = { cols: 1, score: 0 };
  for (let cols = 1; cols <= logs.length; cols++) {
    const rows = Math.ceil(logs.length / cols);
    const score = Math.min(width / cols / 1.6, height / rows);
    if (score > best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(logs.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;

  logs.forEach((log, n) => {
    const keys = keysFor(log, settings.index)!;
    const st = stateAt(log, keys, tCursor - log.offset);
    const layout = profileById(log.profileId).controllerLayout;
    const x0 = (n % cols) * cellW;
    const y0 = Math.floor(n / cols) * cellH;
    const cap = 30;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cellW, cellH);
    ctx.clip();
    if (layout === 'list') drawList(ctx, pal, st, log.color, x0 + 10, y0 + 8, cellW - 20, cellH - cap - 12);
    else drawPad(ctx, pal, st, PAD_MAPS[layout], log.color, x0 + 8, y0 + 6, cellW - 16, cellH - cap - 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px sans-serif';
    ctx.fillStyle = log.color;
    ctx.fillText(log.name, x0 + cellW / 2, y0 + cellH - cap + 2);
    ctx.fillStyle = pal.fg2;
    ctx.font = '10px sans-serif';
    ctx.fillText(st.name ?? `controller ${settings.index}`, x0 + cellW / 2, y0 + cellH - cap + 16, cellW - 12);
    ctx.restore();
  });
}

/** A gamepad fitted into the box (x, y, w, h). */
function drawPad(ctx: CanvasRenderingContext2D, pal: Palette, st: PadState, map: PadMap, color: string, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / 1.6, h); // unit: pad is 1.6 s wide, 1 s tall
  if (s < 40) return;
  const ox = x + (w - s * 1.6) / 2;
  const oy = y + (h - s) / 2;
  const P = (u: number, v: number): [number, number] => [ox + u * s, oy + v * s];
  const on = (n: number) => !!st.buttons[n - 1];
  const axis = (i: number) => st.axes[i] ?? 0;
  const lit = color;
  const dim = pal.bg3;
  const line = pal.fg2;

  // triggers (bars that fill) and bumpers
  const trig = (i: number, u: number) => {
    let v = axis(i);
    if (map.triggerBipolar) v = (v + 1) / 2;
    v = Math.max(0, Math.min(1, v));
    const [bx, by] = P(u, 0.03);
    const bw = s * 0.2;
    const bh = s * 0.07;
    ctx.fillStyle = dim;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = lit;
    ctx.fillRect(bx, by, bw * v, bh);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  };
  trig(map.lt, 0.16);
  trig(map.rt, 1.24);
  const bumper = (n: number, u: number) => {
    const [bx, by] = P(u, 0.13);
    ctx.fillStyle = on(n) ? lit : dim;
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.roundRect(bx, by, s * 0.28, s * 0.07, s * 0.03);
    ctx.fill();
    ctx.stroke();
  };
  bumper(map.lb, 0.12);
  bumper(map.rb, 1.2);

  // body
  ctx.fillStyle = withAlpha(color, 0.08);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(...P(0.06, 0.22), s * 1.48, s * 0.66, s * 0.2);
  ctx.fill();
  ctx.stroke();

  const stick = (xi: number, yi: number, press: number, u: number, v: number) => {
    const [cx, cy] = P(u, v);
    const r = s * 0.115;
    ctx.fillStyle = dim;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const dx = Math.max(-1, Math.min(1, axis(xi)));
    const dy = Math.max(-1, Math.min(1, axis(yi)));
    ctx.strokeStyle = withAlpha(lit, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * r * 0.62, cy + dy * r * 0.62);
    ctx.stroke();
    ctx.fillStyle = on(press) ? lit : pal.strong;
    ctx.beginPath();
    ctx.arc(cx + dx * r * 0.62, cy + dy * r * 0.62, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
  };
  stick(map.lx, map.ly, map.ls, 0.36, 0.44);
  stick(map.rx, map.ry, map.rs, 1.0, 0.68);

  // D-pad
  {
    const [cx, cy] = P(0.6, 0.68);
    const a = s * 0.045;
    const arm = (dx: number, dy: number) => {
      const active = !!st.pov && ((dx !== 0 && st.pov.x === dx) || (dy !== 0 && st.pov.y === -dy));
      ctx.fillStyle = active ? lit : dim;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(cx + dx * a * 2 - a, cy + dy * a * 2 - a, a * 2, a * 2);
      ctx.fill();
      ctx.stroke();
    };
    arm(0, -1);
    arm(0, 1);
    arm(-1, 0);
    arm(1, 0);
    ctx.fillStyle = dim;
    ctx.fillRect(cx - a, cy - a, a * 2, a * 2);
  }

  // face buttons: south, east, west, north
  const face = (n: number, caption: string, u: number, v: number) => {
    const [cx, cy] = P(u, v);
    const r = s * 0.052;
    ctx.fillStyle = on(n) ? lit : dim;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (s > 110) {
      ctx.fillStyle = on(n) ? pal.bg : pal.fg2;
      ctx.font = `${Math.round(r * 1.05)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(caption.length > 1 ? caption[0] : caption, cx, cy + 0.5);
    }
  };
  face(map.south, map.face[0], 1.26, 0.55);
  face(map.east, map.face[1], 1.37, 0.44);
  face(map.west, map.face[2], 1.15, 0.44);
  face(map.north, map.face[3], 1.26, 0.33);

  // back / start
  const small = (n: number, u: number) => {
    const [cx, cy] = P(u, 0.42);
    ctx.fillStyle = on(n) ? lit : dim;
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.04, cy - s * 0.02, s * 0.08, s * 0.04, s * 0.02);
    ctx.fill();
    ctx.stroke();
  };
  small(map.back, 0.66);
  small(map.start, 0.92);
}

/** Axes as bars and buttons as numbered squares, for controllers without a drawing. */
function drawList(ctx: CanvasRenderingContext2D, pal: Palette, st: PadState, color: string, x: number, y: number, w: number, h: number) {
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  const rowH = Math.max(12, Math.min(18, (h * 0.6) / Math.max(1, st.axes.length)));
  st.axes.forEach((a, i) => {
    const cy = y + i * rowH + rowH / 2;
    ctx.fillStyle = pal.fg2;
    ctx.textAlign = 'left';
    ctx.fillText(`axis ${i}`, x, cy);
    const bx = x + 48;
    const bw = w - 48 - 44;
    ctx.fillStyle = pal.bg3;
    ctx.fillRect(bx, cy - 3, bw, 6);
    const v = Math.max(-1, Math.min(1, a));
    ctx.fillStyle = color;
    ctx.fillRect(bx + bw / 2, cy - 3, (v * bw) / 2, 6);
    ctx.fillStyle = pal.fg2;
    ctx.fillRect(bx + bw / 2, cy - 5, 1, 10);
    ctx.fillStyle = pal.fg;
    ctx.textAlign = 'right';
    ctx.fillText(a.toFixed(2), x + w, cy);
  });
  const top = y + st.axes.length * rowH + 8;
  const count = Math.max(st.buttons.length ? Math.min(st.buttons.length, 32) : 0, 0);
  const size = Math.max(14, Math.min(22, w / 17));
  const perRow = Math.max(1, Math.floor(w / (size + 3)));
  for (let i = 0; i < count; i++) {
    const bx = x + (i % perRow) * (size + 3);
    const by = top + Math.floor(i / perRow) * (size + 3);
    if (by + size > y + h) break;
    ctx.fillStyle = st.buttons[i] ? color : pal.bg3;
    ctx.fillRect(bx, by, size, size);
    ctx.fillStyle = st.buttons[i] ? pal.bg : pal.fg2;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), bx + size / 2, by + size / 2 + 0.5);
  }
  const povY = top + Math.ceil(count / perRow) * (size + 3) + 8;
  if (povY < y + h) {
    ctx.fillStyle = pal.fg2;
    ctx.textAlign = 'left';
    const dir = st.pov
      ? `${st.pov.y > 0 ? 'up' : st.pov.y < 0 ? 'down' : ''}${st.pov.x && st.pov.y ? ' ' : ''}${st.pov.x > 0 ? 'right' : st.pov.x < 0 ? 'left' : ''}`
      : 'centered';
    ctx.fillText(`D-pad: ${dir}`, x, povY);
  }
}
