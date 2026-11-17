/**
 * Power subsystems for a robot profile: name each subsystem and say which
 * motors belong to it. A motor is a current source: a PDH / PDP channel
 * number, or a logged current field. Used inside Settings (Robot) and as a
 * dialog from the Power panel.
 */
import { useEffect, useMemo, useState } from 'react';
import { profileStore, updateProfile, newId, type RobotProfile, type Subsystem } from '../state/profiles';
import { sessionStore, type LogEntry } from '../state/session';
import { uiStore, toast } from '../state/ui';
import { useStore } from '../state/store';
import { client } from '../worker/client';
import { suggestSubsystems } from '@core/analyzers/subsystems';
import { nextSubsystemColor } from '../lib/power';
import { shortKey, type MergedField } from '../lib/fields';
import { FieldPicker } from './FieldPicker';
import { Icon } from './Icon';

interface ChannelHint {
  count: number;
  avg: number[];
  peak: number[];
}
const hintCache = new Map<string, ChannelHint>();

/** Average and peak current per PDH channel in a log, to help tell the channels apart. */
function useChannelHints(log: LogEntry | undefined): ChannelHint | null {
  const [hint, setHint] = useState<ChannelHint | null>(log ? (hintCache.get(log.id) ?? null) : null);
  const key = log?.roles.pdhChannelCurrents;
  useEffect(() => {
    if (!log || !key) {
      setHint(null);
      return;
    }
    const cached = hintCache.get(log.id);
    if (cached) {
      setHint(cached);
      return;
    }
    let alive = true;
    void client.getSeries(log.id, key).then((s) => {
      if (!alive || !s || s.kind !== 'array' || !s.v.length) return;
      const count = (s.v[s.v.length - 1] as number[]).length;
      const sum = new Array<number>(count).fill(0);
      const peak = new Array<number>(count).fill(0);
      for (const row of s.v as number[][]) {
        for (let c = 0; c < count; c++) {
          const a = row[c];
          if (!Number.isFinite(a)) continue;
          sum[c] += a;
          if (a > peak[c]) peak[c] = a;
        }
      }
      const h = { count, avg: sum.map((x) => x / s.v.length), peak };
      hintCache.set(log.id, h);
      setHint(h);
    });
    return () => {
      alive = false;
    };
  }, [log, key]);
  return hint;
}

export function SubsystemEditor({ profileId }: { profileId: string }) {
  // select the list, then find: the selector must not close over a prop (useStore caches per store state)
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const logs = useStore(sessionStore, (s) => s.logs);
  const mine = useMemo(() => logs.filter((l) => l.profileId === profileId), [logs, profileId]);
  const hints = useChannelHints(mine.find((l) => l.roles.pdhChannelCurrents));
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [channelsFor, setChannelsFor] = useState<string | null>(null);
  if (!profile) return null;

  const setSubs = (fn: (subs: Subsystem[]) => Subsystem[]) => updateProfile(profileId, (p) => ({ subsystems: fn(p.subsystems) }));
  const patch = (id: string, p: Partial<Subsystem>) => setSubs((subs) => subs.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const inLogs = (key: string) => mine.length === 0 || mine.some((l) => l.fields.some((f) => f.key === key));
  const channelOwner = (c: number, except: string) => profile.subsystems.find((s) => s.id !== except && s.channels.includes(c));
  const fieldOwner = (k: string, except: string) => profile.subsystems.find((s) => s.id !== except && s.fields.includes(k));
  const channelCount = hints?.count ?? 24;

  const add = () => {
    const sub: Subsystem = { id: newId('sub'), name: nextName(profile), color: nextSubsystemColor(profile), channels: [], fields: [] };
    setSubs((subs) => [...subs, sub]);
  };
  const suggest = () => {
    const seen = new Map<string, LogEntry['fields'][number]>();
    for (const l of mine) for (const f of l.fields) if (!seen.has(f.key)) seen.set(f.key, f);
    const taken = new Set(profile.subsystems.flatMap((s) => s.fields));
    const found = suggestSubsystems([...seen.values()])
      .map((d) => ({ ...d, fields: d.fields.filter((k) => !taken.has(k)) }))
      .filter((d) => d.fields.length);
    if (!found.length) {
      toast(
        mine.length
          ? 'No unassigned motor current fields were found in the open logs. Assign PDH channels by hand instead.'
          : 'Open a log from this robot first.',
        'info',
        undefined,
        7000,
      );
      return;
    }
    updateProfile(profileId, (p) => {
      const subs = [...p.subsystems];
      for (const d of found) {
        const existing = subs.findIndex((s) => s.name.toLowerCase() === d.name.toLowerCase());
        if (existing >= 0) subs[existing] = { ...subs[existing], fields: [...subs[existing].fields, ...d.fields] };
        else subs.push({ id: newId('sub'), name: d.name, color: nextSubsystemColor({ ...p, subsystems: subs }), channels: [], fields: d.fields });
      }
      return { subsystems: subs };
    });
    toast(
      `Added ${found.reduce((a, d) => a + d.fields.length, 0)} current fields in ${found.length} subsystem${found.length === 1 ? '' : 's'}. Check the groups and rename them as you like.`,
    );
  };

  return (
    <div className="subsys-editor" data-testid="subsystem-editor">
      {profile.subsystems.length === 0 && (
        <div className="callout">
          A subsystem is a group of motors, for example “Drive” or “Shooter”. Assign each motor by its PDH / PDP channel number or by its logged current field.
          Brownout then reports which subsystem used the most power and which one was drawing when the robot browned out.
        </div>
      )}
      {profile.subsystems.map((s) => (
        <div className="subsys-card" key={s.id} data-subsystem={s.name}>
          <div className="subsys-head">
            <input type="color" value={s.color} title="Color" onChange={(e) => patch(s.id, { color: e.target.value })} />
            <input className="tool-input subsys-name" value={s.name} placeholder="Subsystem name" onChange={(e) => patch(s.id, { name: e.target.value })} />
            <span className="toolbar-spacer" />
            <button className="chip-btn" title="Delete this subsystem" onClick={() => setSubs((subs) => subs.filter((x) => x.id !== s.id))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
          <div className="subsys-sources">
            {s.channels.length === 0 && s.fields.length === 0 && <span className="hint">No motors yet.</span>}
            {[...s.channels]
              .sort((a, b) => a - b)
              .map((c) => (
                <span
                  className="chip"
                  key={`c${c}`}
                  title={
                    hints
                      ? `Channel ${c}: average ${hints.avg[c]?.toFixed(1)} A, peak ${hints.peak[c]?.toFixed(0)} A in the open log`
                      : `PDH / PDP channel ${c}`
                  }
                >
                  ch {c}
                  <button className="chip-btn" title="Remove" onClick={() => patch(s.id, { channels: s.channels.filter((x) => x !== c) })}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            {s.fields.map((k) => {
              const stator = /stator/i.test(k);
              const missing = !inLogs(k);
              return (
                <span
                  className={`chip${missing ? ' chip-missing' : ''}${stator ? ' chip-warn' : ''}`}
                  key={k}
                  title={`${k}${missing ? '\nNot in the open logs for this robot' : ''}${stator ? '\nThis looks like stator current, which is higher than what the battery supplies. Use supply current if it is logged.' : ''}`}
                >
                  {(stator || missing) && <Icon name="warning" size={11} />}
                  {shortKey(k, 3)}
                  <button className="chip-btn" title="Remove" onClick={() => patch(s.id, { fields: s.fields.filter((x) => x !== k) })}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              );
            })}
          </div>
          <div className="subsys-actions">
            <button className="btn small" onClick={() => setChannelsFor(channelsFor === s.id ? null : s.id)} data-testid="subsys-channels">
              PDH channels
            </button>
            <button className="btn small" onClick={() => setPickFor(s.id)}>
              <Icon name="plus" size={11} /> Current field
            </button>
          </div>
          {channelsFor === s.id && (
            <div className="channel-grid">
              {Array.from({ length: channelCount }, (_, c) => {
                const owner = channelOwner(c, s.id);
                const on = s.channels.includes(c);
                return (
                  <button
                    key={c}
                    className={`channel${on ? ' on' : ''}${owner ? ' taken' : ''}`}
                    title={
                      owner
                        ? `Channel ${c} belongs to ${owner.name}. Click to move it here.`
                        : hints
                          ? `Channel ${c}: average ${hints.avg[c].toFixed(1)} A, peak ${hints.peak[c].toFixed(0)} A`
                          : `Channel ${c}`
                    }
                    onClick={() =>
                      setSubs((subs) =>
                        subs.map((x) => {
                          if (x.id === s.id) return { ...x, channels: on ? x.channels.filter((y) => y !== c) : [...x.channels, c] };
                          // a channel belongs to one subsystem
                          return on ? x : { ...x, channels: x.channels.filter((y) => y !== c) };
                        }),
                      )
                    }
                  >
                    <b>{c}</b>
                    {hints && <span>{hints.peak[c] < 0.5 ? 'idle' : `${hints.peak[c].toFixed(0)} A`}</span>}
                  </button>
                );
              })}
              <div className="hint">
                {hints
                  ? 'Each button shows the channel’s peak current in the open log, to help tell the channels apart.'
                  : 'Open a log with PDH / PDP channel currents to see how much each channel drew.'}
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="subsys-footer">
        <button className="btn primary" onClick={add} data-testid="add-subsystem">
          <Icon name="plus" size={12} /> Add subsystem
        </button>
        <button
          className="btn"
          onClick={suggest}
          title="Group the logged motor currents by their top-level folder (Drive, Shooter, ...)"
          data-testid="suggest-subsystems"
        >
          Suggest from field names
        </button>
      </div>
      <div className="hint">
        Use each motor’s <b>supply</b> current. Stator current is higher than what the battery supplies and would overstate that motor’s share. Assign a motor
        once: by channel or by field, not both.
      </div>
      {pickFor && (
        <FieldPicker
          title="Add a motor current field"
          filter={(f: MergedField) => f.kind === 'number' && !f.key.startsWith('/Brownout/')}
          onClose={() => setPickFor(null)}
          onPick={(key) => {
            const owner = fieldOwner(key, pickFor);
            setSubs((subs) =>
              subs.map((x) => {
                if (x.id === pickFor) return x.fields.includes(key) ? x : { ...x, fields: [...x.fields, key] };
                return { ...x, fields: x.fields.filter((k) => k !== key) };
              }),
            );
            if (owner) toast(`Moved ${shortKey(key)} here from ${owner.name}.`);
          }}
        />
      )}
    </div>
  );
}

function nextName(p: RobotProfile): string {
  const names = ['Drive', 'Shooter', 'Intake', 'Elevator', 'Arm', 'Climber'];
  return names.find((n) => !p.subsystems.some((s) => s.name.toLowerCase() === n.toLowerCase())) ?? `Subsystem ${p.subsystems.length + 1}`;
}

/** The editor as a dialog (opened from the Power panel). */
export function SubsystemEditorModal() {
  const profileId = useStore(uiStore, (s) => s.subsystemsFor);
  const profile = useStore(profileStore, (s) => s.profiles).find((p) => p.id === profileId);
  const close = () => uiStore.set({ subsystemsFor: null });
  useEffect(() => {
    if (!profileId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiStore.get().dialogs.length === 0 && !(e.target as HTMLElement).closest('.modal-head input')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profileId]);
  if (!profileId || !profile) return null;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal subsys-modal" role="dialog" aria-label="Power subsystems" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Power subsystems</strong>
          <span className="modal-sub">Robot profile: {profile.name}</span>
          <span className="toolbar-spacer" />
          <button className="btn primary" onClick={close} data-testid="subsystems-done">
            Done
          </button>
        </div>
        <div className="subsys-modal-body scroll">
          <SubsystemEditor profileId={profileId} />
        </div>
      </div>
    </div>
  );
}
