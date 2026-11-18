/**
 * Swerve drive: the four modules at the cursor, measured (solid) against
 * setpoint (dashed), plus the chassis velocity and rotation. One diagram
 * per log, side by side. The robot faces up; arrows are robot-relative.
 *
 * Fields come from the swerve roles (SwerveModuleState[] measured and
 * setpoints, ChassisSpeeds). Module order and the full-scale speed are
 * saved in the robot profile.
 */
import { useCallback } from 'react';
import { panelStore, updatePanel, type SwerveSettings } from '../state/panels';
import { sessionStore, activeProfileId, type LogEntry } from '../state/session';
import { profileStore, profileById, updateProfile, SWERVE_ORDERS, type SwerveOrder } from '../state/profiles';
import { timeStore } from '../state/time';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { useCanvas, type DrawContext } from '../lib/useCanvas';
import { indexAtOrBefore } from '@core/log';
import { T } from '../lib/theme';
import { withAlpha } from '../lib/colors';
import { Toolbar, ToolButton, ToolSelect, ToolGroup } from '../components/Toolbar';
import { GuideLink } from '../components/Guide';

interface ModuleState {
  speed: number;
  angle: number;
}

/** Read one decoded SwerveModuleState (2026) or SwerveModuleVelocity (2027). */
function readModule(v: unknown): ModuleState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const speed =
    typeof o.speed === 'number'
      ? o.speed
      : typeof o.velocity === 'number'
        ? o.velocity
        : typeof o.speedMetersPerSecond === 'number'
          ? o.speedMetersPerSecond
          : NaN;
  const a = o.angle as Record<string, unknown> | number | undefined;
  const angle = typeof a === 'number' ? a : a && typeof a.value === 'number' ? a.value : a && typeof a.radians === 'number' ? a.radians : NaN;
  return Number.isFinite(speed) && Number.isFinite(angle) ? { speed, angle } : null;
}

function modulesAt(log: LogEntry, key: string | undefined, raw: number): ModuleState[] | null {
  if (!key) return null;
  const s = client.peekSeries(log.id, key);
  if (!s || s.kind !== 'struct') return null;
  const i = indexAtOrBefore(s.t, raw);
  if (i < 0 || !Array.isArray(s.v[i])) return null;
  const out = (s.v[i] as unknown[]).map(readModule).filter((m): m is ModuleState => !!m);
  return out.length >= 3 ? out : null;
}

const maxCache = new WeakMap<object, number>();
/**
 * The automatic full scale: the speed the fastest module reaches, ignoring
 * the top half percent of samples (one glitchy sample must not shrink every
 * arrow), rounded up to the next 0.5 m/s.
 */
function logMaxSpeed(log: LogEntry, key: string | undefined): number {
  if (!key) return 0;
  const s = client.peekSeries(log.id, key);
  if (!s || s.kind !== 'struct') return 0;
  let m = maxCache.get(s.v);
  if (m === undefined) {
    const step = Math.max(1, Math.floor(s.v.length / 20000));
    const speeds: number[] = [];
    for (let i = 0; i < s.v.length; i += step) {
      const arr = s.v[i];
      if (!Array.isArray(arr)) continue;
      let top = 0;
      for (const x of arr) {
        const st = readModule(x);
        if (st && Math.abs(st.speed) > top) top = Math.abs(st.speed);
      }
      speeds.push(top);
    }
    speeds.sort((a, b) => a - b);
    const p = speeds.length ? speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.995))] : 0;
    m = Math.ceil(p * 2) / 2;
    maxCache.set(s.v, m);
  }
  return m;
}

/** Corner of each array index, as (forward, left) signs. */
function corners(order: SwerveOrder): [number, number][] {
  const pos: Record<string, [number, number]> = { FL: [1, 1], FR: [1, -1], BL: [-1, 1], BR: [-1, -1] };
  return order.split(',').map((c) => pos[c]);
}

export function SwervePanel({ id }: { id: string }) {
  const settings = useStore(panelStore, (s) => s.panels[id] as SwerveSettings);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const profileId = useStore(sessionStore, () => activeProfileId());
  const profiles = useStore(profileStore, (s) => s.profiles);
  const profile = profiles.find((p) => p.id === profileId) ?? profileById(profileId);
  const draw = useCallback((dc: DrawContext) => drawSwerve(dc, id), [id]);
  const ref = useCanvas(draw, [timeStore, sessionStore, panelStore, profileStore], [id]);
  const found = logs.some((l) => l.roles.swerveMeasured || l.roles.swerveSetpoint);

  return (
    <div className="panel swerve-panel">
      <Toolbar>
        <ToolButton
          active={settings.showSetpoints}
          onClick={() => updatePanel<SwerveSettings>(id, { showSetpoints: !settings.showSetpoints })}
          title="Show where each module was told to go (dashed)"
        >
          Setpoints
        </ToolButton>
        <ToolSelect
          low
          value={settings.source}
          onChange={(v) => updatePanel<SwerveSettings>(id, { source: v })}
          options={[['all', 'All logs'], ...logs.map((l) => [l.id, l.name] as [string, string])]}
          title="Which log(s) to show"
        />
        <ToolGroup low className="hdr-label">
          Order
          <ToolSelect
            value={profile.swerve.order}
            onChange={(v) => updateProfile(profile.id, { swerve: { ...profile.swerve, order: v as SwerveOrder } })}
            options={SWERVE_ORDERS}
            title="Order of the modules in the logged arrays. Saved in the robot profile."
          />
        </ToolGroup>
        <ToolGroup low className="hdr-label">
          Full scale
          <input
            className="tool-input num"
            style={{ width: 62 }}
            placeholder="auto"
            defaultValue={profile.swerve.maxSpeed ?? ''}
            key={`${profile.id}|${profile.swerve.maxSpeed ?? ''}`}
            title="Speed in m/s that draws a full-length arrow. Empty: the fastest speed in the log. Saved in the robot profile."
            onBlur={(e) => {
              const v = Number(e.target.value);
              updateProfile(profile.id, { swerve: { ...profile.swerve, maxSpeed: e.target.value.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null } });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          m/s
        </ToolGroup>
      </Toolbar>
      <div className="canvas-host">
        <canvas ref={ref} />
        {logs.length > 0 && !found && (
          <div className="panel-placeholder">
            No swerve module states found. Log a <code>SwerveModuleState[]</code> (for example <code>SwerveStates/Measured</code>), or pick the field under Log
            info &amp; health, Field names.
            <GuideLink section="swerve-drive" />
          </div>
        )}
        {logs.length === 0 && <div className="panel-placeholder">Open a log to see its swerve modules.</div>}
      </div>
    </div>
  );
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string, width: number, dashed = false) {
  const len = Math.hypot(dx, dy);
  if (len < 1.5) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(8, len * 0.45) + width;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx - ux * head * 0.6, y + dy - uy * head * 0.6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - ux * head - uy * head * 0.5, y + dy - uy * head + ux * head * 0.5);
  ctx.lineTo(x + dx - ux * head + uy * head * 0.5, y + dy - uy * head - ux * head * 0.5);
  ctx.closePath();
  if (dashed) ctx.stroke();
  else ctx.fill();
  ctx.restore();
}

function drawSwerve(dc: DrawContext, id: string) {
  const { ctx, width, height } = dc;
  const pal = T();
  const settings = panelStore.get().panels[id] as SwerveSettings | undefined;
  if (!settings) return;
  const session = sessionStore.get();
  const time = timeStore.get();
  let logs = session.logs.filter((l) => l.visible && (l.roles.swerveMeasured || l.roles.swerveSetpoint));
  if (settings.source !== 'all') logs = logs.filter((l) => l.id === settings.source);
  if (!logs.length) return;
  const tCursor = time.hover ?? time.cursor ?? time.view[1];

  // Lay the diagrams out in the grid that gives the biggest cells
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= logs.length; cols++) {
    const rows = Math.ceil(logs.length / cols);
    const size = Math.min(width / cols, height / rows);
    if (size > best.size) best = { cols, size };
  }
  const cols = best.cols;
  const rows = Math.ceil(logs.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;

  const scales = new Set<number>();
  logs.forEach((log, n) => {
    const profile = profileById(log.profileId);
    const cx = (n % cols) * cellW + cellW / 2;
    const textH = 34;
    const cy = Math.floor(n / cols) * cellH + (cellH - textH) / 2 + 2;
    const size = Math.max(40, Math.min(cellW, cellH - textH) - 16);
    const raw = tCursor - log.offset;
    const measured = modulesAt(log, log.roles.swerveMeasured, raw);
    const setpoint = settings.showSetpoints ? modulesAt(log, log.roles.swerveSetpoint, raw) : null;
    const scaleSpeed = profile.swerve.maxSpeed ?? Math.max(0.5, logMaxSpeed(log, log.roles.swerveMeasured ?? log.roles.swerveSetpoint));
    scales.add(scaleSpeed);
    const pos = corners(profile.swerve.order);
    // chassis outline, proportioned like the robot
    const aspect = profile.robot.width / profile.robot.length;
    const bodyH = size * 0.46;
    const bodyW = bodyH * Math.min(1.6, Math.max(0.6, aspect));
    const arm = size * 0.24;
    ctx.strokeStyle = withAlpha(log.color, 0.9);
    ctx.fillStyle = withAlpha(log.color, 0.1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(cx - bodyW / 2, cy - bodyH / 2, bodyW, bodyH);
    ctx.fill();
    ctx.stroke();
    // front mark
    ctx.fillStyle = withAlpha(log.color, 0.9);
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - bodyH / 2);
    ctx.lineTo(cx + 6, cy - bodyH / 2);
    ctx.lineTo(cx, cy - bodyH / 2 - 7);
    ctx.fill();

    // robot frame (forward, left) -> screen (right, down)
    const sx = (fwd: number, left: number) => -left;
    const sy = (fwd: number) => -fwd;
    const vec = (m: ModuleState): [number, number] => {
      // longer than full scale is capped so a glitch cannot shoot across the panel
      const k = Math.max(-1.35, Math.min(1.35, m.speed / scaleSpeed)) * arm;
      const f = Math.cos(m.angle) * k;
      const l = Math.sin(m.angle) * k;
      return [sx(f, l), sy(f)];
    };
    const count = Math.min(4, Math.max(measured?.length ?? 0, setpoint?.length ?? 0));
    for (let i = 0; i < count; i++) {
      const p = pos[i] ?? [0, 0];
      const mx = cx - (p[1] * bodyW) / 2;
      const my = cy - (p[0] * bodyH) / 2;
      const m = measured?.[i];
      const sp = setpoint?.[i];
      // wheel, turned to the measured (or commanded) angle
      const ang = (m ?? sp)?.angle ?? 0;
      ctx.save();
      ctx.translate(mx, my);
      // module direction on screen is (-sin a, -cos a): the wheel's long side lies along it
      ctx.rotate(-ang - Math.PI / 2);
      ctx.fillStyle = pal.bg3;
      ctx.strokeStyle = pal.fg2;
      ctx.lineWidth = 1;
      const wl = Math.max(10, size * 0.085);
      const ww = wl * 0.45;
      ctx.beginPath();
      ctx.rect(-wl / 2, -ww / 2, wl, ww);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (sp) {
        const [dx, dy] = vec(sp);
        arrow(ctx, mx, my, dx, dy, pal.fg2, 1.5, true);
      }
      if (m) {
        const [dx, dy] = vec(m);
        arrow(ctx, mx, my, dx, dy, log.color, 2.5);
      }
      if (size > 190 && m) {
        ctx.fillStyle = pal.fg2;
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.textAlign = p[1] > 0 ? 'right' : 'left';
        ctx.textBaseline = p[0] > 0 ? 'bottom' : 'top';
        const label = profile.swerve.order.split(',')[i];
        ctx.fillText(`${label} ${m.speed.toFixed(1)}`, mx + (p[1] > 0 ? -wl : wl), my + (p[0] > 0 ? -wl * 0.8 : wl * 0.8));
      }
    }

    // chassis velocity and rotation: logged ChassisSpeeds, else worked out from the modules
    let vx = NaN;
    let vy = NaN;
    let omega = NaN;
    if (log.roles.chassisSpeeds) {
      const s = client.peekSeries(log.id, log.roles.chassisSpeeds);
      if (s && s.kind === 'struct') {
        const i = indexAtOrBefore(s.t, raw);
        const o = i >= 0 ? (s.v[i] as Record<string, number>) : undefined;
        if (o && typeof o.vx === 'number') {
          vx = o.vx;
          vy = o.vy;
          omega = o.omega;
        }
      }
    }
    if (!Number.isFinite(vx) && measured) {
      const hx = profile.robot.length * 0.35;
      const hy = profile.robot.width * 0.35;
      vx = 0;
      vy = 0;
      omega = 0;
      measured.slice(0, 4).forEach((m, i) => {
        const p = pos[i] ?? [0, 0];
        const mvx = Math.cos(m.angle) * m.speed;
        const mvy = Math.sin(m.angle) * m.speed;
        vx += mvx / measured.length;
        vy += mvy / measured.length;
        // omega from the part of each module's velocity that is tangent to its position
        const rx = p[0] * hx;
        const ry = p[1] * hy;
        omega += (rx * mvy - ry * mvx) / (rx * rx + ry * ry) / measured.length;
      });
    }
    if (Number.isFinite(vx)) {
      const k = (arm / scaleSpeed) * Math.min(1, (1.35 * scaleSpeed) / Math.max(1e-6, Math.hypot(vx, vy)));
      arrow(ctx, cx, cy, sx(vx * k, vy * k), sy(vx * k), pal.strong, 3);
      // an arc shorter than about 10 degrees is just noise around zero
      if (Number.isFinite(omega) && Math.abs((omega * profile.robot.length * 0.5) / scaleSpeed) > 0.04) {
        const radius = profile.robot.length * 0.5;
        const frac = Math.max(-1, Math.min(1, (omega * radius) / scaleSpeed));
        const r = size * 0.11;
        const a0 = -Math.PI / 2;
        // positive omega is counter-clockwise, which on screen is a negative angle
        const a1 = a0 - frac * Math.PI * 1.5;
        ctx.strokeStyle = pal.warn;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1, frac > 0);
        ctx.stroke();
        const ex = cx + Math.cos(a1) * r;
        const ey = cy + Math.sin(a1) * r;
        const dir = frac > 0 ? -1 : 1;
        arrow(
          ctx,
          ex - Math.cos(a1 + (dir * Math.PI) / 2) * 0.01,
          ey,
          Math.cos(a1 + (dir * Math.PI) / 2) * 7,
          Math.sin(a1 + (dir * Math.PI) / 2) * 7,
          pal.warn,
          2,
        );
      }
    }

    // caption
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px sans-serif';
    ctx.fillStyle = log.color;
    const capY =
      cy + bodyH / 2 + arm + 6 > Math.floor(n / cols) * cellH + cellH - textH ? Math.floor(n / cols) * cellH + cellH - textH : cy + bodyH / 2 + arm + 6;
    ctx.fillText(log.name, cx, capY);
    ctx.fillStyle = pal.fg;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const speed = Number.isFinite(vx) ? Math.hypot(vx, vy) : NaN;
    ctx.fillText(
      measured || setpoint
        ? `${Number.isFinite(speed) ? speed.toFixed(2) : '—'} m/s · ${Number.isFinite(omega) ? ((omega * 180) / Math.PI).toFixed(0) : '—'}°/s`
        : 'no data at this time',
      cx,
      capY + 15,
    );
  });

  // key
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = pal.fg2;
  ctx.fillText(
    `solid: measured${settings.showSetpoints ? ' · dashed: setpoint' : ''} · thick: chassis · front is up${scales.size === 1 ? ` · full scale ${[...scales][0]} m/s` : ''}`,
    width - 6,
    height - 3,
  );
}
