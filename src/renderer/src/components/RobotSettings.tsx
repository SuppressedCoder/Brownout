/**
 * The parts of Robot setup (components/RobotSetup.tsx) that edit the robot
 * profile: the profile bar (switch, new, duplicate, rename, export, import,
 * delete), the robot (size, appearance, swerve), field names, and which
 * profile each open log uses with the favorites. Cameras and power
 * subsystems have their own editors (CameraEditor, SubsystemEditor).
 */
import { useState } from 'react';
import { NumberInput } from './NumberInput';
import {
  profileStore,
  profileById,
  updateProfile,
  addProfile,
  removeProfile,
  blankProfile,
  normalizeProfile,
  uniqueProfileName,
  profileKeys,
  SWERVE_ORDERS,
  type RobotProfile,
  type SwerveOrder,
} from '../state/profiles';
import { sessionStore, assignProfile, setProfileRole, type LogEntry } from '../state/session';
import { useStore } from '../state/store';
import { askText, confirmDialog, toast, uiStore } from '../state/ui';
import { MenuButton, MenuItem, MenuSeparator } from './Menu';
import { saveText, pickJson } from '../lib/persist';
import { ROLE_LABELS, ROLE_GROUPS, roleTypes, type Role } from '@core/roles';
import { FieldSlot } from './FieldSlot';
import { Icon } from './Icon';
import { shortKey } from '../lib/fields';

export async function exportProfile(p: RobotProfile): Promise<void> {
  await saveText(`${p.name.replace(/[^\w.-]+/g, '_')}.brownout-robot.json`, JSON.stringify({ brownoutRobotProfile: 1, profile: p }, null, 1), [
    { name: 'Brownout robot profile', extensions: ['json'] },
  ]);
}

export async function importProfile(): Promise<RobotProfile | null> {
  const f = await pickJson('Import a robot profile');
  if (!f) return null;
  try {
    const j = JSON.parse(f.text) as { brownoutRobotProfile?: number; profile?: unknown };
    const p = j.brownoutRobotProfile === 1 ? normalizeProfile(j.profile) : null;
    if (!p) throw new Error('it is not a Brownout robot profile');
    const existing = profileStore.get().profiles.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (existing) {
      const ok = await confirmDialog(
        `Replace “${existing.name}”?`,
        `A robot profile named “${existing.name}” already exists. Replace it with the one from ${f.name}? Cancel keeps both.`,
        'Replace',
      );
      if (ok) {
        updateProfile(existing.id, { ...p, id: existing.id, name: existing.name });
        toast(`Replaced the robot profile “${existing.name}”.`);
        return profileById(existing.id);
      }
    }
    const added = addProfile(p);
    toast(`Imported the robot profile “${added.name}”.`);
    return added;
  } catch (e) {
    toast(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`, 'error');
    return null;
  }
}

/** Fields this profile names (overrides, favorites, cameras, part links) that the open logs using it do not have. */
export function missingKeys(profile: RobotProfile, logs: LogEntry[]): string[] {
  const mine = logs.filter((l) => l.profileId === profile.id);
  return mine.length ? profileKeys(profile).filter((k) => !mine.some((l) => l.fields.some((f) => f.key === k))) : [];
}

/** Which profile Robot setup shows, and everything done to profiles as a whole. */
export function ProfileBar({ profile, onProfile }: { profile: RobotProfile; onProfile: (id: string) => void }) {
  const state = useStore(profileStore, (s) => s);
  const logs = useStore(sessionStore, (s) => s.logs);
  const mine = logs.filter((l) => l.profileId === profile.id);
  const missing = missingKeys(profile, logs);

  const create = async (from?: RobotProfile) => {
    const name = await askText({
      title: from ? `Duplicate “${from.name}”` : 'New robot profile',
      label: 'Robot name',
      initial: from ? uniqueProfileName(`${from.name} copy`) : '',
      placeholder: 'e.g. 2026 competition robot',
      confirmLabel: 'Create',
      validate: (v) => (v.trim() ? null : 'Enter a name'),
    });
    if (name === null) return;
    const p = addProfile({ ...(from ?? blankProfile(name.trim())), name: name.trim() });
    onProfile(p.id);
  };
  const rename = async () => {
    const name = await askText({
      title: 'Rename robot profile',
      label: 'Robot name',
      initial: profile.name,
      confirmLabel: 'Rename',
      validate: (v) => (v.trim() ? null : 'Enter a name'),
    });
    if (name !== null) updateProfile(profile.id, { name: uniqueProfileName(name.trim(), profile.id) });
  };
  const remove = async () => {
    if (
      !(await confirmDialog(
        `Delete “${profile.name}”?`,
        'Its subsystems, cameras, parts, favorites and field-name corrections are deleted. Logs that used it switch to another profile.',
        'Delete',
        true,
      ))
    )
      return;
    const next = state.profiles.find((p) => p.id !== profile.id)!;
    for (const l of mine) await assignProfile(l.id, next.id);
    removeProfile(profile.id);
    onProfile(next.id);
  };

  return (
    <div className="setup-profile" data-testid="robot-settings">
      <div className="profile-bar">
        <select
          className="tool-select"
          value={profile.id}
          onChange={(e) => onProfile(e.target.value)}
          data-testid="profile-select"
          title="The robot profile shown here"
        >
          {state.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <MenuButton label={<span>Profile</span>} title="New, duplicate, rename, export, import or delete robot profiles" testId="profile-menu">
          {(close) => (
            <>
              <MenuItem icon="plus" label="New profile…" onClick={() => (close(), void create())} testId="profile-new" />
              <MenuItem label="Duplicate…" onClick={() => (close(), void create(profile))} />
              <MenuItem label="Rename…" onClick={() => (close(), void rename())} />
              <MenuSeparator />
              <MenuItem
                icon="download"
                label="Export…"
                description="The whole profile as one file, pictures included, to share with the team"
                onClick={() => (close(), void exportProfile(profile))}
                testId="profile-export"
              />
              <MenuItem
                icon="upload"
                label="Import…"
                onClick={() => (close(), void importProfile().then((p) => p && onProfile(p.id)))}
                testId="profile-import"
              />
              <MenuSeparator />
              <MenuItem icon="close" label="Delete…" danger disabled={state.profiles.length <= 1} onClick={() => (close(), void remove())} />
            </>
          )}
        </MenuButton>
      </div>
      <div className="setting-help">
        {mine.length ? `Used by ${mine.map((l) => l.name).join(', ')}.` : 'No open log uses this profile.'} Saved on this computer; export it to share it.
      </div>
      {missing.length > 0 && (
        <div className="keybind-note" data-testid="profile-missing">
          <Icon name="warning" size={12} /> {missing.length} field{missing.length === 1 ? '' : 's'} in this profile {missing.length === 1 ? 'is' : 'are'} not in
          the open logs. If the robot code renamed them, drop the new ones on the field or pick them again.
        </div>
      )}
    </div>
  );
}

/** The robot itself: size, the parts drawn on it, and its swerve drive. */
export function RobotSection({ profile }: { profile: RobotProfile }) {
  const size = (key: 'length' | 'width', v: number | null) => {
    if (v !== null && v > 0.01) updateProfile(profile.id, { robot: { ...profile.robot, [key]: v } });
  };
  return (
    <div>
      <h3>Size</h3>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">Length and width with bumpers</span>
          <span className="setting-help">Used to draw the robot on the 2D field and in the swerve view.</span>
        </span>
        <span className="size-inputs" key={profile.id}>
          <NumberInput
            memory={`${profile.id}:robot.length`}
            value={profile.robot.length}
            onCommit={(v) => size('length', v)}
            min={0.011}
            title="Length, front to back (m)"
            testId="robot-length"
          />{' '}
          ×
          <NumberInput
            memory={`${profile.id}:robot.width`}
            value={profile.robot.width}
            onCommit={(v) => size('width', v)}
            min={0.011}
            title="Width, side to side (m)"
            testId="robot-width"
          />{' '}
          m
        </span>
      </div>

      <h3>Appearance</h3>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">Parts drawn on the robot</span>
          <span className="setting-help">
            {profile.layers.length === 0
              ? 'The robot is drawn as a plain box.'
              : `${profile.layers.length} part${profile.layers.length === 1 ? '' : 's'}${profile.layers.some((l) => l.link) ? ', some turning with logged angles' : ''}.`}{' '}
            Shapes, pictures or SVGs. Drop an angle field on the field to make a part turn with it.
          </span>
        </span>
        <button className="btn" onClick={() => uiStore.set({ robotEditorFor: profile.id })} data-testid="edit-robot">
          <Icon name="robot" size={13} /> Edit the parts
        </button>
      </div>

      <h3>Swerve</h3>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">Module order</span>
          <span className="setting-help">The order of the modules in the logged swerve arrays.</span>
        </span>
        <select
          className="tool-select"
          value={profile.swerve.order}
          onChange={(e) => updateProfile(profile.id, { swerve: { ...profile.swerve, order: e.target.value as SwerveOrder } })}
        >
          {SWERVE_ORDERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">Full-scale speed</span>
          <span className="setting-help">The speed that draws a full-length arrow. Leave empty to use the fastest speed in each log.</span>
        </span>
        <span className="size-inputs">
          <NumberInput
            memory={`${profile.id}:swerve.maxSpeed`}
            value={profile.swerve.maxSpeed ?? null}
            allowEmpty
            placeholder="auto"
            onCommit={(v) => updateProfile(profile.id, { swerve: { ...profile.swerve, maxSpeed: v !== null && v > 0 ? v : null } })}
          />{' '}
          m/s
        </span>
      </div>
    </div>
  );
}

/** The field playing a role for this robot: what Brownout finds by name, or the one you picked (with a clear button). */
export function RoleSlot({ profile, role }: { profile: RobotProfile; role: Role }) {
  const logs = useStore(sessionStore, (s) => s.logs);
  const mine = logs.filter((l) => l.profileId === profile.id);
  const own = profile.roleOverrides[role];
  const found = mine.map((l) => l.roles[role]).find(Boolean);
  return (
    <FieldSlot
      label={ROLE_LABELS[role]}
      spec={{ types: roleTypes(role) }}
      value={own ?? found}
      logs={mine}
      onPick={(key) => void setProfileRole(profile.id, role, key)}
      onClear={own ? () => void setProfileRole(profile.id, role, undefined) : undefined}
      testId={`role-${role}`}
    />
  );
}

/** Every field Brownout looks for by name, in folding groups; drop or type the right one on a wrong guess. */
export function NamesSection({ profile }: { profile: RobotProfile }) {
  const [shut, setShut] = useState<Set<string>>(() => new Set(ROLE_GROUPS.slice(1).map((g) => g.title)));
  const toggle = (t: string) =>
    setShut((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  return (
    <div className="role-groups" data-testid="field-names">
      {ROLE_GROUPS.map((g) => {
        const open = !shut.has(g.title);
        return (
          <div className="role-group" key={g.title}>
            <button className="role-group-head" onClick={() => toggle(g.title)} aria-expanded={open} data-testid="role-group">
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} />
              <span>{g.title}</span>
              <span className="count">{g.roles.length}</span>
            </button>
            {open && (
              <div className="slot-stack">
                {g.roles.map((r) => (
                  <RoleSlot key={r} profile={profile} role={r} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Which profile each open log uses, and the favorite fields. */
export function LogsSection({ profile }: { profile: RobotProfile }) {
  const state = useStore(profileStore, (s) => s);
  const logs = useStore(sessionStore, (s) => s.logs);
  const missing = missingKeys(profile, logs);
  const isMissing = (k: string) => missing.includes(k);
  return (
    <div>
      <h3>Open logs</h3>
      {logs.length === 0 && <div className="setting-help">No logs open. New logs use the profile whose field names fit best, or the last one you used.</div>}
      {logs.map((l) => (
        <div className="setting-row plain" key={l.id}>
          <span>
            <span className="setting-label" style={{ color: l.color }}>
              {l.name}
            </span>
          </span>
          <select
            className="tool-select"
            value={l.profileId}
            onChange={(e) => void assignProfile(l.id, e.target.value)}
            title="Robot profile for this log (remembered for this file)"
          >
            {state.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ))}

      <h3>Favorite fields</h3>
      {profile.favorites.length === 0 ? (
        <div className="setting-help">None yet. Star a field in the sidebar to keep it at the top.</div>
      ) : (
        <div className="fav-chips">
          {profile.favorites.map((k) => (
            <span className={`chip${isMissing(k) ? ' chip-missing' : ''}`} key={k} title={`${k}${isMissing(k) ? '\nNot in the open logs' : ''}`}>
              {isMissing(k) && <Icon name="warning" size={11} />}
              {shortKey(k, 3)}
              <button
                className="chip-btn"
                title="Remove from favorites"
                onClick={() => updateProfile(profile.id, { favorites: profile.favorites.filter((x) => x !== k) })}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
