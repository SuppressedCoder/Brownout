/**
 * Built-in workspace presets. Each resolves roles ("battery voltage",
 * "robot pose") against the primary log rather than exact keys, so it works
 * across AdvantageKit, DataLogManager and team-specific naming.
 */
import { tagsSeenKeys } from './vision';
import { grid } from '../components/Grid';
import { sessionStore, type LogEntry } from '../state/session';
import { zoomTo } from '../state/time';
import type { GraphSettings, StatsSettings, CompareSettings } from '../state/panels';
import { DERIVED_PREFIX } from '../worker/protocol';
import { suggestSubsystems } from '@core/analyzers/subsystems';
import { ROLE_LABELS, type Role } from '@core/roles';

export interface Preset {
  id: string;
  name: string;
  description: string;
  apply(primary: LogEntry | undefined): void;
}

function roleKey(primary: LogEntry | undefined, role: keyof LogEntry['roles'], fallback?: string): string | undefined {
  return primary?.roles[role] ?? fallback;
}

/** Only the keys this log has: a graph with a field the log lacks looks broken. */
function present(primary: LogEntry | undefined, keys: (string | undefined)[]): string[] {
  const have = new Set(primary?.fields.map((f) => f.key) ?? []);
  return keys.filter((k): k is string => !!k && (!primary || have.has(k)));
}

/** "This log has no battery voltage or total current." plus how to log the first one. */
function lacking(primary: LogEntry | undefined, roles: Role[], what?: string): string {
  if (!primary) return 'Open a log first.';
  // "PDH Channel Currents" -> "PDH channel currents": lower-case the words, keep the acronyms
  const names = roles.map((r) => ROLE_LABELS[r].replace(/\b([A-Z])([a-z]+)/g, (_, a: string, b: string) => a.toLowerCase() + b));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  const how = primary.health.find((h) => roles.includes(h.role) && !h.present)?.howTo;
  return `This log has no ${what ?? list}.${how ? ` ${how}` : ''}`;
}

/** Each motor's logged current, as the subsystem suggestions find them (up to 8). */
function motorCurrents(primary: LogEntry | undefined): string[] {
  if (!primary) return [];
  return suggestSubsystems(primary.fields)
    .flatMap((d) => d.fields)
    .slice(0, 8);
}

/** Logged power in watts, one per mechanism where both a mechanism total and per-motor values exist (up to 8). */
function wattFields(primary: LogEntry | undefined): string[] {
  if (!primary) return [];
  const keys = primary.fields
    .filter(
      (f) => f.kind === 'number' && !f.generated && f.count > 1 && (/watts?\b|\(w\)$/i.test(f.key) || f.unit === 'W') && !f.key.startsWith(DERIVED_PREFIX),
    )
    .map((f) => f.key)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const kept: string[] = [];
  for (const k of keys) if (!kept.some((o) => k.startsWith(o.slice(0, o.lastIndexOf('/') + 1)))) kept.push(k);
  return kept.slice(0, 8);
}

/**
 * The battery graph of Quick Look and Power: voltage and total current when logged.
 * Without them, each motor's current, which many teams log even when they don't log the battery.
 */
export function batteryGraph(primary: LogEntry | undefined): { settings: Partial<GraphSettings>; title: string } {
  const v = present(primary, [roleKey(primary, 'batteryVoltage')]);
  const i = present(primary, [roleKey(primary, 'totalCurrent')]);
  if (v.length || i.length) {
    return {
      settings: { series: graphSeries(v, i), thresholds: v.length ? [sessionStore.get().brownoutThreshold] : [] },
      title: 'Battery & current',
    };
  }
  const motors = motorCurrents(primary);
  if (motors.length) {
    return {
      settings: { series: graphSeries(motors), note: undefined },
      title: 'Motor currents',
    };
  }
  return { settings: { series: [], note: lacking(primary, ['batteryVoltage', 'totalCurrent']) }, title: 'Battery & current' };
}

function graphSeries(keys: (string | undefined)[], rightKeys: (string | undefined)[] = []): GraphSettings['series'] {
  return [
    ...keys.filter((k): k is string => !!k).map((key) => ({ key, axis: 'left' as const })),
    ...rightKeys.filter((k): k is string => !!k).map((key) => ({ key, axis: 'right' as const })),
  ];
}

export const PRESETS: Preset[] = [
  {
    id: 'quick',
    name: 'Quick Look',
    description: 'Battery and current graph, 2D field, console, log info.',
    apply(primary) {
      grid.clear();
      sessionStore.set({ timelineTracks: [] });
      const battery = batteryGraph(primary);
      const g = grid.addPanel('graph', battery.settings, undefined, battery.title);
      const f = grid.addPanel('field', undefined, { direction: 'right', referencePanel: g });
      const c = grid.addPanel('console', undefined, { direction: 'below', referencePanel: g });
      grid.addPanel('info', undefined, { direction: 'below', referencePanel: f });
      grid.api?.getPanel(c)?.api.setActive();
      grid.api?.getPanel(g)?.api.setActive();
    },
  },
  {
    id: 'power',
    name: 'Power & Brownouts',
    description: 'Power report, voltage/current graph with the brownout threshold, electrical power, voltage statistics.',
    apply(primary) {
      grid.clear();
      const v = present(primary, [roleKey(primary, 'batteryVoltage')])[0];
      const p = grid.addPanel('power');
      const battery = batteryGraph(primary);
      const g = grid.addPanel('graph', battery.settings, { direction: 'right', referencePanel: p }, battery.title);
      const chan = primary?.roles.pdhChannelCurrents;
      const chanKeys = chan
        ? (primary?.fields.filter((f) => f.key.startsWith(`${chan}/`) && f.key !== `${chan}/length`).map((f) => f.key) ?? [])
            .sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()))
            .slice(0, 8)
        : [];
      // PDH channels, else battery power (V x I), else whatever the robot logs in watts
      const watts = present(primary, [`${DERIVED_PREFIX}Power/Watts`]);
      const logged = chanKeys.length || watts.length ? [] : wattFields(primary);
      grid.addPanel(
        'graph',
        {
          series: graphSeries(chanKeys.length ? chanKeys : watts.length ? watts : logged),
          note: chanKeys.length || watts.length || logged.length ? undefined : lacking(primary, ['pdhChannelCurrents']),
        } as Partial<GraphSettings>,
        { direction: 'below', referencePanel: g },
        chanKeys.length ? 'PDH channels' : watts.length ? 'Electrical power' : logged.length ? 'Logged power' : 'Electrical power',
      );
      grid.addPanel(
        'stats',
        { key: v ?? null, phase: 'enabled', note: v ? undefined : lacking(primary, ['batteryVoltage']) } as Partial<StatsSettings>,
        { direction: 'below', referencePanel: p },
        'Voltage statistics',
      );
      sessionStore.set({ timelineTracks: primary?.roles.brownout ? [primary.roles.brownout] : [] });
      grid.api?.getPanel(p)?.api.setActive();
    },
  },
  {
    id: 'autos',
    name: 'Autonomous Review',
    description: '2D field with the active path, target pose and ghosts per log; path error graph; per-path summary. Zoomed to auto.',
    apply(primary) {
      grid.clear();
      sessionStore.set({ normalizeAlliance: true });
      const f = grid.addPanel('field', { trailSeconds: 15 });
      const pathErr = present(primary, [`${DERIVED_PREFIX}Path/PositionError`]);
      const g = grid.addPanel(
        'graph',
        {
          series: graphSeries(pathErr, present(primary, [`${DERIVED_PREFIX}Path/HeadingError`])),
          note: pathErr.length
            ? undefined
            : lacking(primary, ['activePath', 'targetPose', 'robotPose'], 'active path with a target pose and robot pose to compare'),
        } as Partial<GraphSettings>,
        { direction: 'right', referencePanel: f },
        'Path error',
      );
      grid.addPanel('paths', undefined, { direction: 'below', referencePanel: g });
      const speed = present(primary, [`${DERIVED_PREFIX}Pose/Speed`]);
      grid.addPanel(
        'graph',
        { series: graphSeries(speed), note: speed.length ? undefined : lacking(primary, ['robotPose']) } as Partial<GraphSettings>,
        { direction: 'below', referencePanel: f },
        'Robot speed',
      );
      const ar = roleKey(primary, 'autoRoutine');
      sessionStore.set({ timelineTracks: ar ? [ar] : [] });
      grid.api?.getPanel(f)?.api.setActive();
      setTimeout(() => zoomTo('auto'), 50);
    },
  },
  {
    id: 'compare',
    name: 'Compare Matches',
    description: 'Metrics table across logs, overlaid battery graph, field with ghosts, voltage statistics per log.',
    apply(primary) {
      grid.clear();
      sessionStore.set({ timelineTracks: [] });
      // battery voltage when logged; else robot speed, which every log with a pose has
      const v = present(primary, [roleKey(primary, 'batteryVoltage')])[0];
      const speed = present(primary, [`${DERIVED_PREFIX}Pose/Speed`])[0];
      const main = v ?? speed;
      const c = grid.addPanel('compare', { keys: present(primary, [roleKey(primary, 'loopTime'), v ? undefined : speed]) } as Partial<CompareSettings>);
      const g = grid.addPanel(
        'graph',
        {
          series: graphSeries([main]),
          thresholds: v ? [sessionStore.get().brownoutThreshold] : [],
          note: main ? undefined : lacking(primary, ['batteryVoltage', 'robotPose']),
        } as Partial<GraphSettings>,
        { direction: 'below', referencePanel: c },
        v ? 'Battery (overlay)' : speed ? 'Robot speed (overlay)' : 'Battery (overlay)',
      );
      grid.addPanel('field', { trailSeconds: 1000 }, { direction: 'right', referencePanel: g });
      grid.addPanel(
        'stats',
        { key: main ?? null, phase: 'enabled', note: main ? undefined : lacking(primary, ['batteryVoltage']) } as Partial<StatsSettings>,
        { direction: 'right', referencePanel: c },
        v ? 'Voltage statistics' : speed ? 'Speed statistics' : 'Voltage statistics',
      );
      grid.api?.getPanel(c)?.api.setActive();
    },
  },
  {
    id: 'code',
    name: 'Code Health',
    description: 'Loop time with the 20 ms line, CAN utilization, console filtered to errors and warnings.',
    apply(primary) {
      grid.clear();
      sessionStore.set({ timelineTracks: [] });
      const loop = present(primary, [roleKey(primary, 'loopTime')]);
      const can = present(primary, [roleKey(primary, 'canUtilization')]);
      const loopNote = loop.length
        ? undefined
        : `${lacking(primary, ['loopTime'])} Loop overruns printed to the console are still listed in the console and on the timeline.`;
      const g = grid.addPanel(
        'graph',
        { series: graphSeries(loop), thresholds: loop.length ? [20] : [], note: loopNote } as Partial<GraphSettings>,
        undefined,
        'Loop time',
      );
      grid.addPanel(
        'graph',
        { series: graphSeries(can), note: can.length ? undefined : lacking(primary, ['canUtilization']) } as Partial<GraphSettings>,
        { direction: 'below', referencePanel: g },
        'CAN utilization',
      );
      const c = grid.addPanel('console', { infos: false }, { direction: 'right', referencePanel: g });
      grid.addPanel(
        'stats',
        { key: loop[0] ?? null, phase: 'enabled', note: loopNote } as Partial<StatsSettings>,
        { direction: 'below', referencePanel: c },
        'Loop time statistics',
      );
      grid.api?.getPanel(g)?.api.setActive();
    },
  },
  {
    id: 'replay',
    name: 'Match Replay',
    description: 'Match video next to the 2D field with camera views, the driver controller and the commands that ran.',
    apply() {
      grid.clear();
      const v = grid.addPanel('video');
      const f = grid.addPanel('field', { trailSeconds: 5 }, { direction: 'right', referencePanel: v });
      grid.addPanel('controller', undefined, { direction: 'below', referencePanel: v });
      grid.addPanel('commands', undefined, { direction: 'below', referencePanel: f });
      sessionStore.set({ timelineTracks: tagsSeenKeys() });
      grid.api?.getPanel(v)?.api.setActive();
    },
  },
];
