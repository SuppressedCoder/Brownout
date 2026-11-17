/**
 * Real-log check: opens a team's log in the real app, sets up subsystems from
 * the suggestions, applies every built-in preset and adds the panels the
 * presets leave out, then writes a screenshot of each and a summary of what
 * the app found. It checks nothing by itself: read the summary and look at the
 * pictures.
 *
 *   npm run reallog                          every .wpilog in fixtures/local (git-ignored)
 *   npm run reallog -- path/to/a.wpilog      one log
 *   npm run reallog -- --no-build ...        reuse out/
 *
 * Output: smoke/real-<preset>.png, smoke/real-<panel>.png, smoke/real-cameras.png,
 * smoke/real-report.pdf (match report of the first log), smoke/real-summary.json.
 */
import { _electron as electron, type Page } from 'playwright-core';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { LogData } from '../src/core/log.ts';
import { computeRobotState } from '../src/core/robotState.ts';
import { analyzeCameras, detectCameras } from '../src/core/vision.ts';

const root = resolve(import.meta.dirname, '..');

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1500x920x24', 'npx', 'tsx', import.meta.filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: root,
  });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const localDir = resolve(root, 'fixtures', 'local');
const logs = args.length
  ? args.map((a) => resolve(a))
  : existsSync(localDir)
    ? readdirSync(localDir)
        .filter((f) => f.endsWith('.wpilog'))
        .map((f) => resolve(localDir, f))
    : [];
if (!logs.length) {
  console.log('No logs. Put a .wpilog in fixtures/local/ or pass a path.');
  process.exit(1);
}
const outDir = resolve(root, 'smoke');
mkdirSync(outDir, { recursive: true });
const userData = resolve(outDir, 'real-user-data');
rmSync(userData, { recursive: true, force: true });
if (!process.argv.includes('--no-build')) execSync('npx electron-vite build', { cwd: root, stdio: 'inherit' });

const PRESETS: [string, string][] = [
  ['quick', 'Quick Look'],
  ['power', 'Power & Brownouts'],
  ['autos', 'Autonomous Review'],
  ['compare', 'Compare Matches'],
  ['code', 'Code Health'],
  ['replay', 'Match Replay'],
];
const EXTRA_PANELS = ['Swerve drive', 'Statistics', 'Log info'];

/** The first enabled moment some camera sees at least two tags (raw seconds), to show the camera view. */
function visionMoment(file: string): number | undefined {
  const log = new LogData(readFileSync(file));
  const ranges = computeRobotState(log).ranges;
  const { series } = analyzeCameras(log, detectCameras(log.fields), ranges, undefined);
  let best: number | undefined;
  for (const c of series) {
    const s = c.seen;
    if (!s) continue;
    for (let i = 0; i < s.t.length; i++) {
      const on = ranges.some((r) => r.mode !== 'disabled' && s.t[i] >= r.start && s.t[i] < r.end);
      if (on && s.counts[i] >= 2) {
        if (best === undefined || s.t[i] < best) best = s.t[i];
        break;
      }
    }
  }
  return best;
}

const state = <T,>(page: Page, expr: string): Promise<T> => page.evaluate(`(() => { const s = window.__brownout; return ${expr}; })()`) as Promise<T>;

async function main() {
  const app = await electron.launch({
    args: [root, '--no-sandbox', ...logs.flatMap((l) => ['--open', l])],
    env: { ...process.env, BROWNOUT_USER_DATA: userData } as Record<string, string>,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1500, height: 920 }).catch(() => undefined);
  const t0 = Date.now();
  await page.waitForFunction(
    (n) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (globalThis as any).__brownout?.sessionStore.get();
      return !!s && s.logs.length === n && s.loadingItems.length === 0;
    },
    logs.length,
    { timeout: 120_000 },
  );
  const openMs = Date.now() - t0;
  // the camera analysis runs after opening
  await page
    .waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__brownout.sessionStore.get().logs.every((l: any) => l.cameras !== undefined);
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(800);

  // Subsystems from the suggestions, the way a team would start
  await page.locator('[data-testid=power-btn]').click();
  await page.waitForSelector('.power-panel');
  if ((await page.locator('[data-testid=subsystems-empty]').count()) > 0) {
    await page.locator('[data-testid=subsystems-empty] .btn').click();
    await page.waitForSelector('[data-testid=subsystem-editor]');
    await page.locator('[data-testid=suggest-subsystems]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(outDir, 'real-subsystem-editor.png') });
    await page.locator('[data-testid=subsystems-done]').click();
    await page
      .waitForFunction(
        () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (globalThis as any).__brownout.sessionStore.get().logs.every((l: any) => l.subsystems !== undefined);
        },
        null,
        { timeout: 60_000 },
      )
      .catch(() => undefined);
  }

  // Put the cursor somewhere interesting: 30 s into teleop, else the middle of the log
  await page.evaluate(`(() => {
    const s = window.__brownout; const l = s.sessionStore.get().logs[0];
    const t = l.robotState.teleopStart !== undefined ? l.robotState.teleopStart + 30 : (l.startTs + l.endTs) / 2;
    s.timeStore.set({ cursor: t + l.offset });
  })()`);

  for (const [id, name] of PRESETS) {
    await page.locator('[data-testid=preset-menu]').click();
    await page.locator('.menu .menu-item', { hasText: name }).first().click();
    await page.waitForTimeout(300);
    if ((await page.locator('.dialog').count()) > 0) await page.locator('.dialog .btn', { hasText: 'Replace' }).first().click();
    await page.waitForTimeout(1500);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: resolve(outDir, `real-${id}.png`) });
    console.log(`  preset ${name}`);
  }
  for (const title of EXTRA_PANELS) {
    await page.locator('[data-testid=add-panel]').click();
    await page.locator('.menu .menu-item', { hasText: title }).first().click();
    await page.waitForTimeout(1200);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: resolve(outDir, `real-${title.toLowerCase().replace(/\W+/g, '-')}.png`) });
    console.log(`  panel ${title}`);
  }

  // The camera view at a moment a camera sees tags
  const seen = visionMoment(logs[0]);
  if (seen !== undefined) {
    await page.locator('[data-testid=preset-menu]').click();
    await page.locator('.menu .menu-item', { hasText: 'Quick Look' }).first().click();
    await page.waitForTimeout(300);
    if ((await page.locator('.dialog').count()) > 0) await page.locator('.dialog .btn', { hasText: 'Replace' }).first().click();
    await page.evaluate(
      `(() => { const s = window.__brownout; const l = s.sessionStore.get().logs[0]; s.timeStore.set({ cursor: ${seen + 0.05} + l.offset }); })()`,
    );
    await page.waitForTimeout(1500);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: resolve(outDir, 'real-cameras.png') });
    console.log(`  camera view at ${seen.toFixed(2)} s`);
  }

  // The match report for the first log, as a PDF
  const reportPath = resolve(outDir, 'real-report.pdf');
  rmSync(reportPath, { force: true });
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never;
  }, reportPath);
  await page.locator('[data-testid=file-menu]').click();
  await page.locator('[data-testid=match-report]').click();
  if (logs.length > 1) {
    await page.waitForSelector('.dialog');
    await page.locator('.dialog .btn').nth(1).click();
  }
  for (let i = 0; i < 100 && !existsSync(reportPath); i++) await page.waitForTimeout(200);
  console.log(existsSync(reportPath) ? `  report ${reportPath}` : '  report NOT written');

  const summary = await state<unknown>(
    page,
    `s.sessionStore.get().logs.map(l => ({
      name: l.name, startTs: l.startTs, endTs: l.endTs, records: l.recordCount, repairedTimestamps: l.repairedTimestamps, truncated: l.truncated,
      loggers: l.loggers, era: l.era, match: l.matchInfo, autoRoutine: l.autoRoutine, robotState: { ...l.robotState, ranges: l.robotState.ranges.map(r => r.mode + ' ' + r.start.toFixed(1) + '-' + r.end.toFixed(1)) },
      roles: l.roles,
      missingHealth: l.health.filter(h => !h.present).map(h => h.label),
      events: l.events.reduce((a, e) => (a[e.kind] = (a[e.kind] || 0) + 1, a), {}),
      power: { voltageKey: l.power.voltageKey, brownouts: l.power.brownoutCount, minVoltage: l.power.minVoltage, missing: l.power.missing },
      subsystems: l.subsystems && { totalSource: l.subsystems.totalSource, voltageAssumed: l.subsystems.voltageAssumed, stats: l.subsystems.stats.map(x => [x.name, +x.energyWh.toFixed(2), +(x.share * 100).toFixed(1), +x.avgCurrent.toFixed(1), +x.peakCurrent.toFixed(1)]), warnings: l.subsystems.warnings },
      cameras: (l.cameras || []).map(c => ({ name: c.name, seen: +(c.seenFraction * 100).toFixed(1), blind: c.blind.length, meanError: c.meanError, missing: c.missing })),
      profile: s.profileStore.get().profiles.find(p => p.id === l.profileId)?.name,
    }))`,
  );
  const out = { logs: logs.map((l) => basename(l)), openMs, rendererErrors: errors, summary };
  writeFileSync(resolve(outDir, 'real-summary.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await app.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
