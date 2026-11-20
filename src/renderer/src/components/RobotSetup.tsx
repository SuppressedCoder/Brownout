/**
 * Robot setup (header: Robot, Ctrl+4): the one place for everything the
 * robot profile holds, built around the field, like AdvantageScope's
 * drag-and-drop field.
 *
 * - Left: the field list, to drag from.
 * - Middle: the 2D field showing a log that uses this profile. Drop a field
 *   on it and a menu at the drop point asks what it is, offering only what
 *   that kind of field can be: the robot's position, what a camera sees or
 *   thinks, the path, swerve states, an angle that turns a robot part. The
 *   answer goes into the profile, so every log from this robot follows, and
 *   the field shows it at once.
 * - Right: the profile in tabs. "On the field" lists what the field shows and
 *   where each piece comes from (found by name, or set here); the others are
 *   the robot (size, parts, swerve), cameras, power subsystems, field names,
 *   and which profile each open log uses with the favorites.
 *
 * The field is an ordinary field panel kept outside the grid (a "view:" id),
 * like the other views' panels.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sessionStore, setProfileRole, activeProfileId, type LogEntry } from '../state/session';
import { panelStore, ensurePanel, updatePanel, VIEW_PANEL_PREFIX, type FieldSettings } from '../state/panels';
import { profileStore, profileById, updateProfile, newId, CAMERA_COLORS, type Camera, type RobotProfile } from '../state/profiles';
import { useStore } from '../state/store';
import { toast, uiStore } from '../state/ui';
import { readFieldDrag, hasFieldDrag, type FieldDrag } from '../lib/dnd';
import { detectedCameras } from '../lib/vision';
import { shortKey } from '../lib/fields';
import { ROLE_LABELS, type Role } from '@core/roles';
import { StandalonePanel } from './Grid';
import { MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { Icon } from './Icon';
import type { IconName } from '../lib/icons';
import { ProfileBar, RobotSection, NamesSection, LogsSection } from './RobotSettings';
import { CameraEditor } from './CameraEditor';
import { SubsystemEditor } from './SubsystemEditor';
import { guessUnit } from './RobotEditor';

const FIELD = `${VIEW_PANEL_PREFIX}setup-field`;

type Tab = 'field' | 'robot' | 'cameras' | 'power' | 'names' | 'logs';
const TABS: [Tab, string][] = [
  ['field', 'On the field'],
  ['robot', 'Robot'],
  ['cameras', 'Cameras'],
  ['power', 'Power'],
  ['names', 'Field names'],
  ['logs', 'Logs'],
];

/** The roles the field draws, in the order "On the field" lists them. */
const FIELD_ROLES: Role[] = ['robotPose', 'activePath', 'targetPose', 'visionPose', 'swerveMeasured', 'swerveSetpoint', 'chassisSpeeds'];

export function RobotSetup() {
  const logs = useStore(sessionStore, (s) => s.logs);
  const profiles = useStore(profileStore, (s) => s.profiles);
  const wanted = useStore(uiStore, (s) => s.setupProfile);
  const tab = useStore(uiStore, (s) => s.setupTab);
  const ready = useStore(panelStore, (s) => !!s.panels[FIELD]);
  const fieldSource = useStore(panelStore, (s) => (s.panels[FIELD] as FieldSettings | undefined)?.source);
  const profile = profiles.find((p) => p.id === wanted) ?? profileById(activeProfileId());
  // the field shows a log that uses this profile (or the first log, to drop fields from it)
  const log = logs.find((l) => l.profileId === profile.id) ?? logs[0];
  const [menu, setMenu] = useState<{ x: number; y: number; field: FieldDrag } | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    ensurePanel(FIELD, 'field', { trailSeconds: 3 } as Partial<FieldSettings>);
  }, []);
  useEffect(() => {
    if (ready && log && fieldSource !== log.id) updatePanel<FieldSettings>(FIELD, { source: log.id });
  }, [ready, log?.id, fieldSource]);

  const onProfile = (id: string) => uiStore.set({ setupProfile: id });
  const setTab = (t: Tab) => uiStore.set({ setupTab: t });

  // drops on the field are answered here, before the field panel would add them to itself
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFieldDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    const items = readFieldDrag(e);
    setOver(false);
    if (!items) return;
    e.preventDefault();
    e.stopPropagation();
    if (items.length > 1) toast('Drop one field at a time: each one is a different thing on the field.');
    setMenu({ x: e.clientX, y: e.clientY, field: items[0] });
  };

  return (
    <div className="app-view robot-setup" data-testid="robot-setup">
      <div
        className={`rs-field${over ? ' drop-ready' : ''}`}
        onDragOverCapture={onDragOver}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDropCapture={onDrop}
        data-testid="setup-field"
      >
        {ready && logs.length > 0 && <StandalonePanel id={FIELD} />}
        {logs.length === 0 && <div className="view-empty">Open a log from this robot, then drag its fields onto the field.</div>}
        <div className="rs-drop-hint">
          <Icon name="target" size={12} /> {over ? 'Drop it to say what it is' : 'Drag a field from the list onto the field to say what it is'}
        </div>
      </div>
      <div className="rs-side">
        <ProfileBar profile={profile} onProfile={onProfile} />
        <div className="rs-tabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              className={`rs-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
              role="tab"
              aria-selected={tab === t}
              data-testid={`setup-tab-${t}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="rs-body scroll">
          {tab === 'field' && <OnTheField profile={profile} log={log} />}
          {tab === 'robot' && <RobotSection profile={profile} />}
          {tab === 'cameras' && <CameraEditor profileId={profile.id} />}
          {tab === 'power' && <SubsystemEditor profileId={profile.id} />}
          {tab === 'names' && <NamesSection profile={profile} />}
          {tab === 'logs' && <LogsSection profile={profile} />}
        </div>
      </div>
      {menu && <DropMenu {...menu} profile={profile} log={log} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What a dropped field can be

interface Choice {
  label: string;
  description?: string;
  icon?: IconName;
  apply: () => void | Promise<void>;
}

const POSE = ['Pose2d', 'Pose3d'];
const isPose = (f: FieldDrag) => (f.kind === 'struct' && POSE.includes(f.structName ?? '')) || (f.kind === 'number[]' && /pose/i.test(f.key));
const isPoseList = (f: FieldDrag) => f.kind === 'struct[]' && POSE.includes(f.structName ?? '');
const isBotpose = (f: FieldDrag) => f.kind === 'number[]' && /botpose/i.test(f.key);

/** The cameras the profile draws: its own list, or the ones found by name in its logs when it has none. */
function camerasOf(profile: RobotProfile): Camera[] {
  if (profile.cameras.length) return profile.cameras;
  const out: Camera[] = [];
  for (const l of sessionStore.get().logs.filter((x) => x.profileId === profile.id))
    for (const c of detectedCameras(l)) if (!out.some((o) => o.id === c.id)) out.push(c);
  return out;
}

/** Set one of a camera's fields (a new camera when id is null). The first change keeps the cameras found by name, as the profile's own. */
function setCamera(profile: RobotProfile, id: string | null, patch: Partial<Camera>): string {
  const cams = camerasOf(profile).map((c) => ({ ...c }));
  let name: string;
  if (id === null) {
    name = `Camera ${cams.length + 1}`;
    cams.push({ id: newId('cam'), name, color: CAMERA_COLORS[cams.length % CAMERA_COLORS.length], mount: null, ...patch });
  } else {
    const c = cams.find((x) => x.id === id)!;
    Object.assign(c, patch);
    name = c.name;
  }
  updateProfile(profile.id, { cameras: cams });
  return name;
}

function choicesFor(f: FieldDrag, profile: RobotProfile): Choice[] {
  const out: Choice[] = [];
  const short = shortKey(f.key, 2);
  const role = (r: Role, label: string, icon?: IconName): Choice => ({
    label,
    icon,
    description: ROLE_LABELS[r],
    apply: async () => {
      await setProfileRole(profile.id, r, f.key);
      toast(`${ROLE_LABELS[r]}: ${short}`);
    },
  });
  const cams = camerasOf(profile);
  const camera = (patch: Partial<Camera>, what: string): Choice[] => [
    ...cams.map((c) => ({
      label: `${c.name}: ${what}`,
      icon: 'camera' as IconName,
      apply: () => {
        setCamera(profile, c.id, patch);
        toast(`${c.name}: ${what} from ${short}`);
      },
    })),
    {
      label: `A new camera: ${what}`,
      icon: 'plus' as IconName,
      apply: () => {
        const name = setCamera(profile, null, patch);
        toast(`${name} added: ${what} from ${short}`);
      },
    },
  ];

  if (isBotpose(f)) out.push(...camera({ poseKey: f.key, tagIdsKey: f.key }, 'its Limelight botpose (where it thinks the robot is, and the tags it sees)'));
  if (isPose(f)) {
    out.push(role('robotPose', 'The robot’s position', 'robot'));
    out.push(...camera({ poseKey: f.key }, 'where it thinks the robot is'));
    out.push(role('targetPose', 'Where the path wants the robot to be'));
    out.push(role('visionPose', 'The vision estimate (all cameras together)'));
  }
  if (isPoseList(f)) {
    out.push(role('activePath', 'The path being followed'));
    out.push(...camera({ tagPosesKey: f.key }, 'the tags it sees (their positions)'));
    out.push(...camera({ poseKey: f.key }, 'where it thinks the robot is'));
  }
  if (f.kind === 'number[]' && !isBotpose(f)) out.push(...camera({ tagIdsKey: f.key }, 'the IDs of the tags it sees'));
  if (f.kind === 'struct[]' && f.structName === 'SwerveModuleState') {
    out.push(role('swerveMeasured', 'Swerve module states, measured'));
    out.push(role('swerveSetpoint', 'Swerve module states, setpoints'));
  }
  if (f.kind === 'struct' && f.structName === 'ChassisSpeeds') out.push(role('chassisSpeeds', 'Chassis speeds'));
  if (f.kind === 'number') {
    const unit = guessUnit(f.key);
    for (const l of profile.layers)
      out.push({
        label: `Turns “${l.name}”`,
        icon: 'robot',
        description: l.link ? `now turns with ${shortKey(l.link.key, 2)}` : `read as ${unit === 'rad' ? 'radians' : unit === 'deg' ? 'degrees' : 'rotations'}`,
        apply: () => {
          updateProfile(profile.id, (p) => ({
            layers: p.layers.map((x) =>
              x.id === l.id ? { ...x, link: { key: f.key, unit, offset: x.link?.offset ?? 0, invert: x.link?.invert ?? false } } : x,
            ),
          }));
          toast(`“${l.name}” now turns with ${short}.`);
        },
      });
    out.push({
      label: 'A new part that turns with it',
      icon: 'plus',
      description: 'A bar at the robot’s center; place and shape it in Robot, Edit the parts',
      apply: () => {
        updateProfile(profile.id, (p) => ({
          layers: [
            ...p.layers,
            {
              id: newId('layer'),
              name: shortKey(f.key, 1),
              kind: 'rect',
              x: 0,
              y: 0,
              length: Math.min(0.6, p.robot.length * 0.6),
              width: 0.08,
              rotation: 0,
              opacity: 1,
              color: '#f2c94c',
              link: { key: f.key, unit, offset: 0, invert: false },
              pivot: { x: 0, y: 0 },
              parent: null,
            },
          ],
        }));
        toast(`Added a part that turns with ${short}. Place and shape it in Robot, Edit the parts.`);
      },
    });
  }
  return out;
}

/** The menu at the drop point: what is this field? */
function DropMenu({
  x,
  y,
  field,
  profile,
  log,
  onClose,
}: {
  x: number;
  y: number;
  field: FieldDrag;
  profile: RobotProfile;
  log?: LogEntry;
  onClose: () => void;
}) {
  const choices = choicesFor(field, profile);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.drop-menu')) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  // keep it on screen
  const left = Math.min(x, window.innerWidth - 380);
  const top = Math.min(y, window.innerHeight - 40 - (choices.length + 2) * 34);
  return createPortal(
    <div className="menu menu-floating wide drop-menu" style={{ left: Math.max(8, left), top: Math.max(8, top) }} role="menu" data-testid="drop-menu">
      <MenuLabel>
        <span className="mono">{shortKey(field.key, 3)}</span> is…
      </MenuLabel>
      {choices.map((c, i) => (
        <MenuItem key={i} icon={c.icon} label={c.label} description={c.description} onClick={() => (onClose(), void c.apply())} testId="drop-choice" />
      ))}
      {!choices.length && (
        <div className="hint drop-none">
          Nothing on the field can show a {field.structName ?? field.kind}. Drop a position (Pose2d or Pose3d), a list of poses, tag IDs, swerve module states
          or an angle.
        </div>
      )}
      <MenuSeparator />
      <MenuItem label="Cancel" onClick={onClose} />
      {log && !log.fields.some((f) => f.key === field.key) && <div className="hint drop-none">This field is not in {log.name}, the log the field shows.</div>}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// On the field: what the field shows, and where it comes from

function OnTheField({ profile, log }: { profile: RobotProfile; log?: LogEntry }) {
  const cams = camerasOf(profile);
  const linked = profile.layers.filter((l) => l.link);
  const from = (r: Role): { key: string | undefined; how: string } => {
    const own = profile.roleOverrides[r];
    if (own) return { key: own, how: 'set here' };
    const found = log?.roles[r];
    return found ? { key: found, how: 'found by name' } : { key: undefined, how: '' };
  };
  return (
    <div className="on-field" data-testid="on-the-field">
      <div className="setting-help">
        Drag a field from the list onto the field and say what it is. Everything here is saved in the robot profile, so every log from this robot shows it.
      </div>
      <h3>Robot and paths</h3>
      {FIELD_ROLES.map((r) => {
        const { key, how } = from(r);
        return (
          <div className="setting-row plain" key={r} data-role={r}>
            <span>
              <span className="setting-label">{ROLE_LABELS[r]}</span>
              <span className={`setting-help ${key ? 'mono' : ''}`} title={key}>
                {key ? `${shortKey(key, 3)} (${how})` : 'none: drop one on the field'}
              </span>
            </span>
            {profile.roleOverrides[r] && (
              <button className="btn small" onClick={() => void setProfileRole(profile.id, r, undefined)} title="Go back to finding it by name">
                Clear
              </button>
            )}
          </div>
        );
      })}
      <h3>Cameras</h3>
      {!cams.length && <div className="setting-help">No cameras. Drop a camera's pose estimate, tag IDs or tag positions on the field.</div>}
      {cams.map((c) => (
        <div className="setting-row plain" key={c.id} data-camera={c.name}>
          <span>
            <span className="setting-label">
              <span className="dot" style={{ background: c.color }} /> {c.name}
              {!profile.cameras.length && <span className="setting-help"> (found by name)</span>}
            </span>
            <span className="setting-help mono">
              {[
                c.poseKey && `estimate ${shortKey(c.poseKey, 2)}`,
                c.tagIdsKey && `tag IDs ${shortKey(c.tagIdsKey, 2)}`,
                c.tagPosesKey && `tag positions ${shortKey(c.tagPosesKey, 2)}`,
              ]
                .filter(Boolean)
                .join(' · ') || 'no fields yet'}
            </span>
          </span>
        </div>
      ))}
      {cams.length > 0 && (
        <button className="link-btn" onClick={() => uiStore.set({ setupTab: 'cameras' })}>
          Rename cameras, set where they are mounted, or remove one
        </button>
      )}
      <h3>Turning parts</h3>
      {!linked.length && <div className="setting-help">No part turns with a logged angle. Drop an angle (a number field) on the field.</div>}
      {linked.map((l) => (
        <div className="setting-row plain" key={l.id}>
          <span>
            <span className="setting-label">{l.name}</span>
            <span className="setting-help mono">turns with {shortKey(l.link!.key, 3)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
