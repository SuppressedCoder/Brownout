/**
 * Settings, Robot: the robot profile. One page for everything that
 * describes the robot rather than the screen: which profile each open log
 * uses, robot size, power subsystems, swerve settings, field-name
 * corrections and favorites, with export / import as one file.
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
import { sessionStore, assignProfile, setProfileRole, activeProfileId } from '../state/session';
import { useStore } from '../state/store';
import { askText, confirmDialog, toast, uiStore } from '../state/ui';
import { saveText, pickJson } from '../lib/persist';
import { ROLE_LABELS, type Role } from '@core/roles';
import { SubsystemEditor } from './SubsystemEditor';
import { CameraEditor } from './CameraEditor';
import { FieldPicker } from './FieldPicker';
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

export function RobotSettings() {
  const state = useStore(profileStore, (s) => s);
  const logs = useStore(sessionStore, (s) => s.logs);
  const [viewId, setViewId] = useState<string>(() => activeProfileId());
  const [pickRole, setPickRole] = useState<Role | null>(null);
  const profile = state.profiles.find((p) => p.id === viewId) ?? state.profiles[0];
  const mine = logs.filter((l) => l.profileId === profile.id);
  const missing = mine.length ? profileKeys(profile).filter((k) => !mine.some((l) => l.fields.some((f) => f.key === k))) : [];
  const isMissing = (k: string) => missing.includes(k);

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
    setViewId(p.id);
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
        'Its subsystems, favorites and field-name corrections are deleted. Logs that used it switch to another profile.',
        'Delete',
        true,
      ))
    )
      return;
    const next = state.profiles.find((p) => p.id !== profile.id)!;
    for (const l of mine) await assignProfile(l.id, next.id);
    removeProfile(profile.id);
    setViewId(next.id);
  };
  const size = (key: 'length' | 'width', v: number | null) => {
    if (v !== null && v > 0.01) updateProfile(profile.id, { robot: { ...profile.robot, [key]: v } });
  };

  return (
    <div data-testid="robot-settings">
      <p className="setting-text">
        A preset says where the panels go. A robot profile describes the robot and applies whichever preset or log is open. It is saved on this computer; export
        it to share one setup with your team.
      </p>
      <div className="profile-bar">
        <select
          className="tool-select"
          value={profile.id}
          onChange={(e) => setViewId(e.target.value)}
          data-testid="profile-select"
          title="The robot profile shown below"
        >
          {state.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void create()} data-testid="profile-new">
          New
        </button>
        <button className="btn" onClick={() => void create(profile)}>
          Duplicate
        </button>
        <button className="btn" onClick={() => void rename()}>
          Rename
        </button>
        <button className="btn" onClick={() => void exportProfile(profile)} data-testid="profile-export">
          Export
        </button>
        <button className="btn" onClick={() => void importProfile().then((p) => p && setViewId(p.id))} data-testid="profile-import">
          Import
        </button>
        <button className="btn danger" disabled={state.profiles.length <= 1} onClick={() => void remove()}>
          Delete
        </button>
      </div>

      {missing.length > 0 && (
        <div className="keybind-note" data-testid="profile-missing">
          <Icon name="warning" size={12} /> {missing.length} field{missing.length === 1 ? '' : 's'} in this profile {missing.length === 1 ? 'is' : 'are'} not in
          the open logs (marked below). If the robot code renamed them, pick the new names.
        </div>
      )}

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

      <h3>Robot size</h3>
      <div className="setting-row plain">
        <span>
          <span className="setting-label">Length and width with bumpers</span>
          <span className="setting-help">Used to draw the robot on the 2D field and in the swerve view.</span>
        </span>
        <span className="size-inputs" key={profile.id}>
          <NumberInput value={profile.robot.length} onCommit={(v) => size('length', v)} min={0.011} title="Length, front to back (m)" testId="robot-length" /> ×
          <NumberInput value={profile.robot.width} onCommit={(v) => size('width', v)} min={0.011} title="Width, side to side (m)" testId="robot-width" /> m
        </span>
      </div>

      <div className="setting-row plain">
        <span>
          <span className="setting-label">Robot appearance</span>
          <span className="setting-help">
            {profile.layers.length === 0
              ? 'The robot is drawn as a plain box.'
              : `${profile.layers.length} part${profile.layers.length === 1 ? '' : 's'} drawn on the robot${profile.layers.some((l) => l.link) ? ', some turning with logged angles' : ''}.`}{' '}
            Add shapes, pictures or SVGs, and link parts to logged angles.
          </span>
        </span>
        <button className="btn" onClick={() => uiStore.set({ robotEditorFor: profile.id })} data-testid="edit-robot">
          <Icon name="robot" size={13} /> Edit the robot
        </button>
      </div>

      <h3>Power subsystems</h3>
      <SubsystemEditor profileId={profile.id} />

      <h3>Cameras</h3>
      <CameraEditor profileId={profile.id} />

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
            value={profile.swerve.maxSpeed ?? null}
            allowEmpty
            placeholder="auto"
            onCommit={(v) => updateProfile(profile.id, { swerve: { ...profile.swerve, maxSpeed: v !== null && v > 0 ? v : null } })}
          />{' '}
          m/s
        </span>
      </div>

      <h3>Field names</h3>
      <div className="setting-help">
        Brownout finds battery voltage, robot pose and the like by name. When it picks the wrong field, correct it here (or in Log info &amp; health) and every
        log from this robot follows.
      </div>
      {Object.entries(profile.roleOverrides).length === 0 && <div className="setting-help">No corrections. Everything is found automatically.</div>}
      {(Object.entries(profile.roleOverrides) as [Role, string][]).map(([role, key]) => (
        <div className="setting-row plain" key={role}>
          <span>
            <span className="setting-label">{ROLE_LABELS[role]}</span>
            <span className={`setting-help mono${isMissing(key) ? ' warn-text' : ''}`}>
              {isMissing(key) && <Icon name="warning" size={11} />} {key}
              {isMissing(key) ? ' (not in the open logs)' : ''}
            </span>
          </span>
          <button className="btn small" onClick={() => setPickRole(role)}>
            Pick again
          </button>
          <button className="btn small" onClick={() => void setProfileRole(profile.id, role, undefined)} title="Go back to finding this field automatically">
            Clear
          </button>
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
      {pickRole && (
        <FieldPicker
          title={`Field for: ${ROLE_LABELS[pickRole]}`}
          onClose={() => setPickRole(null)}
          onPick={(key) => void setProfileRole(profile.id, pickRole, key)}
        />
      )}
    </div>
  );
}
