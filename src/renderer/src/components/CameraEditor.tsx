/**
 * Cameras for a robot profile. A camera is a name, a color and up to three
 * logged fields, each optional: where the camera thinks the robot is, which
 * tag IDs it sees, and where it thinks those tags are. Whatever is left
 * empty is simply not drawn. With no cameras listed, Brownout uses the ones
 * it finds from field names in each log.
 */
import { useEffect, useMemo } from 'react';
import { NumberInput } from './NumberInput';
import { profileStore, updateProfile, newId, CAMERA_COLORS, type Camera } from '../state/profiles';
import { sessionStore } from '../state/session';
import { uiStore, toast } from '../state/ui';
import { useStore } from '../state/store';
import { detectedCameras } from '../lib/vision';
import type { FieldLike, FieldSpec } from '../lib/fields';
import { FieldSlot } from './FieldSlot';
import { Icon } from './Icon';

export type CameraSlot = 'poseKey' | 'tagIdsKey' | 'tagPosesKey';
const POSES = ['Pose2d', 'Pose3d'];
/** A camera's three fields, each optional: what each takes. */
export const CAMERA_SLOTS: { slot: CameraSlot; label: string; spec: FieldSpec }[] = [
  {
    slot: 'poseKey',
    label: 'Estimate',
    spec: {
      types: [...POSES, ...POSES.map((p) => `${p}[]`)],
      also: { label: 'botpose', test: (f) => f.kind === 'number[]' && /botpose/i.test(f.key) },
    },
  },
  { slot: 'tagIdsKey', label: 'Tag IDs', spec: { types: ['number[]'] } },
  { slot: 'tagPosesKey', label: 'Tag positions', spec: { types: ['Pose3d[]', 'Pose2d[]'] } },
];

/** Any field a camera can use, and where a new camera puts it. */
export const ANY_CAMERA_FIELD: FieldSpec = {
  types: ['Pose2d', 'Pose3d', 'Pose2d[]', 'Pose3d[]', 'number[]'],
  label: 'any camera field',
};
export function cameraPatchFor(f: FieldLike): Partial<Camera> {
  if (f.kind === 'number[]') return /botpose/i.test(f.key) ? { poseKey: f.key, tagIdsKey: f.key } : { tagIdsKey: f.key };
  if (f.kind === 'struct[]') return { tagPosesKey: f.key };
  return { poseKey: f.key };
}

export function CameraEditor({ profileId }: { profileId: string }) {
  // select the list, then find: the selector must not close over a prop
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const logs = useStore(sessionStore, (s) => s.logs);
  const mine = useMemo(() => logs.filter((l) => l.profileId === profileId), [logs, profileId]);
  if (!profile) return null;
  const found = mine.flatMap((l) => detectedCameras(l)).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  const setCams = (fn: (c: Camera[]) => Camera[]) => updateProfile(profileId, (p) => ({ cameras: fn(p.cameras) }));
  const patch = (id: string, c: Partial<Camera>) => setCams((cams) => cams.map((x) => (x.id === id ? { ...x, ...c } : x)));
  const add = () =>
    setCams((cams) => [
      ...cams,
      { id: newId('cam'), name: `Camera ${cams.length + 1}`, color: CAMERA_COLORS[cams.length % CAMERA_COLORS.length], mount: null },
    ]);
  const adopt = () => {
    if (!found.length) {
      toast(
        mine.length ? 'No camera fields were recognized in the open logs. Add a camera and pick its fields by hand.' : 'Open a log from this robot first.',
        'info',
        undefined,
        7000,
      );
      return;
    }
    setCams((cams) => [
      ...cams,
      ...found.filter((f) => !cams.some((c) => c.tagIdsKey === f.tagIdsKey && c.poseKey === f.poseKey)).map((f) => ({ ...f, id: newId('cam') })),
    ]);
  };

  return (
    <div className="subsys-editor" data-testid="camera-editor">
      {profile.cameras.length === 0 && (
        <div className="callout">
          {found.length > 0 ? (
            <div>
              Brownout found {found.length} camera{found.length === 1 ? '' : 's'} from the field names in the open logs ({found.map((c) => c.name).join(', ')})
              and is already drawing {found.length === 1 ? 'it' : 'them'}. List cameras here only to rename them, change which fields they use, or say where
              they are mounted.
            </div>
          ) : (
            <div>
              No cameras are listed, and none were recognized from field names. Add a camera and fill in whichever of its fields your robot logs. Anything left
              empty is simply not drawn.
            </div>
          )}
        </div>
      )}
      {profile.cameras.map((c) => (
        <div className="subsys-card" key={c.id} data-camera={c.name}>
          <div className="subsys-head">
            <input type="color" value={c.color} title="Color" onChange={(e) => patch(c.id, { color: e.target.value })} />
            <input className="tool-input subsys-name" value={c.name} placeholder="Camera name" onChange={(e) => patch(c.id, { name: e.target.value })} />
            <span className="toolbar-spacer" />
            <button className="chip-btn" title="Delete this camera" onClick={() => setCams((cams) => cams.filter((x) => x.id !== c.id))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
          <div className="cam-slots">
            {CAMERA_SLOTS.map((s) => (
              <FieldSlot
                key={s.slot}
                label={s.label}
                spec={s.spec}
                value={c[s.slot]}
                logs={mine}
                onPick={(key) => patch(c.id, { [s.slot]: key })}
                onClear={() => patch(c.id, { [s.slot]: undefined })}
                testId={`cam-${s.slot}`}
              />
            ))}
          </div>
          <div
            className="cam-slot"
            title="Where the camera sits on the robot, measured from its center. Lines to tags start there. Leave empty to draw them from the robot center."
          >
            <span className="cam-slot-label">Mounted at</span>
            <span className="size-inputs" key={`${c.id}|${c.mount ? 1 : 0}`}>
              <NumberInput memory={`${profileId}:${c.id}:mount.x`} value={c.mount?.x ?? null} placeholder="forward" onCommit={(v) => mount(c, 'x', v, patch)} />{' '}
              ,
              <NumberInput memory={`${profileId}:${c.id}:mount.y`} value={c.mount?.y ?? null} placeholder="left" onCommit={(v) => mount(c, 'y', v, patch)} /> m
            </span>
            {c.mount && (
              <button className="chip-btn" title="Draw from the robot center" onClick={() => patch(c.id, { mount: null })}>
                <Icon name="close" size={10} />
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="subsys-footer">
        <button className="btn primary" onClick={add} data-testid="add-camera">
          <Icon name="plus" size={12} /> Add camera
        </button>
        <button className="btn" onClick={adopt} title="Copy the cameras found from field names into this list, to edit them" data-testid="detect-cameras">
          Copy the detected cameras here
        </button>
      </div>
    </div>
  );
}

function mount(c: Camera, axis: 'x' | 'y', v: number | null, patch: (id: string, c: Partial<Camera>) => void) {
  if (v === null) return;
  patch(c.id, { mount: { x: c.mount?.x ?? 0, y: c.mount?.y ?? 0, [axis]: Math.max(-2, Math.min(2, v)) } });
}

/** The editor as a dialog (opened from the 2D field's Display menu). */
export function CameraEditorModal() {
  const profileId = useStore(uiStore, (s) => s.camerasFor);
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const close = () => uiStore.set({ camerasFor: null });
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
      <div className="modal subsys-modal" role="dialog" aria-label="Cameras" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Cameras</strong>
          <span className="modal-sub">Robot profile: {profile.name}</span>
          <span className="toolbar-spacer" />
          <button className="btn primary" onClick={close} data-testid="cameras-done">
            Done
          </button>
        </div>
        <div className="subsys-modal-body scroll">
          <CameraEditor profileId={profileId} />
        </div>
      </div>
    </div>
  );
}
