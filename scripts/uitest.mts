/**
 * UI test: drives the real Electron app with Playwright and checks the
 * behaviors that unit tests can't reach (menus, presets, dialogs, time
 * control, zoom, settings, keybinds, session restore, icons, compact view,
 * multi-select, robot profiles, power by subsystem, field pictures, swerve).
 *
 *   npm run uitest            (uses xvfb-run on Linux when there is no display)
 *
 * Screenshots land in smoke/ui-*.png.
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Re-run under xvfb when there is no display.
if (process.platform === 'linux' && !process.env.DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1500x920x24', 'npx', 'tsx', import.meta.filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: root,
  });
  process.exit(r.status ?? 1);
}

const outDir = resolve(root, 'smoke');
mkdirSync(outDir, { recursive: true });
const userData = resolve(outDir, 'ui-user-data');
rmSync(userData, { recursive: true, force: true });
const logs = ['FRC_20260321_143012_NYROC_Q12.wpilog', 'FRC_20260321_171844_NYROC_Q18.wpilog'].map((f) => resolve(root, 'fixtures', 'demo', f));
if (!logs.every(existsSync)) execSync('npx tsx scripts/make-demo.mts', { cwd: root, stdio: 'inherit' });
if (!process.argv.includes('--no-build')) execSync('npx electron-vite build', { cwd: root, stdio: 'inherit' });

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const state = <T,>(page: Page, expr: string): Promise<T> => page.evaluate(`(() => { const s = window.__brownout; return ${expr}; })()`) as Promise<T>;

async function launch(args: string[]): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({ args: [root, '--no-sandbox', ...args], env: { ...process.env, BROWNOUT_USER_DATA: userData } as Record<string, string> });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.header');
  return { app, page, errors };
}

async function waitLogs(page: Page, n: number): Promise<void> {
  await page.waitForFunction((count) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (globalThis as any).__brownout?.sessionStore.get();
    return !!s && s.logs.length === count && s.loadingItems.length === 0;
  }, n);
  await page.waitForTimeout(700);
}

/** The range the timeline covers: the match, or the whole log when switched. */
const extent = (page: Page) => state<[number, number]>(page, 's.timeBounds()');
/** Every visible log, start to end (aligned). */
const wholeExtent = (page: Page) =>
  state<[number, number]>(
    page,
    `(() => { const l = s.sessionStore.get().logs; return [Math.min(...l.map(x => x.startTs + x.offset)), Math.max(...l.map(x => x.endTs + x.offset))]; })()`,
  );
const view = (page: Page) => state<[number, number]>(page, 's.timeStore.get().view');
const presetText = async (page: Page) => (await page.locator('[data-testid=preset-menu]').innerText()).trim();
/** Emoji, pictograph, arrow and geometric-shape characters in the visible text (there should be none: the app draws its own icons). */
const pictographs = (page: Page) =>
  page.evaluate(
    `(() => { const m = document.body.innerText.match(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2190}-\\u{21FF}\\u{25A0}-\\u{25FF}\\u{2300}-\\u{23FF}\\u{2630}]/gu); return m ? [...new Set(m)].join(' ') : ''; })()`,
  ) as Promise<string>;
/**
 * Whether the open menu is really on screen: big enough, inside the window, and the topmost thing at its own corners
 * (so nothing clips or covers it). Playwright's click would scroll a clipped menu into view and hide the bug.
 */
const menuState = (page: Page) =>
  page.evaluate(`(() => {
    const m = [...document.querySelectorAll('.menu')].pop();
    if (!m) return 'no menu';
    const r = m.getBoundingClientRect();
    if (r.height < 30 || r.width < 100) return 'tiny ' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return 'off screen';
    for (const [x, y] of [[r.left + 10, r.top + 10], [r.right - 10, r.bottom - 10], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]) {
      const e = document.elementFromPoint(x, y);
      if (!e || !m.contains(e)) return 'covered or clipped at ' + Math.round(x) + ',' + Math.round(y);
    }
    return 'ok';
  })()`) as Promise<string>;
const toastText = async (page: Page) => (await page.locator('.toast').allInnerTexts()).join(' | ');

async function dialogButton(page: Page, label: string): Promise<void> {
  await page.locator('.dialog .btn', { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

async function main() {
  // ------------------------------------------------------------------ session 1
  console.log('Session 1: two logs from the command line');
  let { app, page, errors } = await launch(logs.flatMap((l) => ['--open', l]));
  await waitLogs(page, 2);

  console.log('Header');
  check('logo removed', (await page.locator('.brand').count()) === 0 && !(await page.locator('.header').innerText()).includes('Brownout'));
  check(
    'sidebar toggle is the first header control, drawn as an icon',
    (await page.locator('.header > *').first().locator('svg.icon').count()) === 1 &&
      (await page.locator('.header > *').first().getAttribute('aria-label')) === 'Sidebar',
  );
  check('every header button has an icon or a text label', (await page.locator('.header svg.icon').count()) >= 8);
  check('no emoji or symbol characters in the main view', (await pictographs(page)) === '', await pictographs(page));
  check('no Demo button in the header', (await page.locator('.header button', { hasText: /^Demo$/ }).count()) === 0);
  await page.locator('.header > button').first().click();
  check('hamburger hides the sidebar', (await page.locator('.sidebar').count()) === 0);
  await page.locator('.header > button').first().click();
  check('hamburger shows it again', (await page.locator('.sidebar').count()) === 1);

  console.log('Field search by type, wider sidebar');
  {
    const input = page.locator('[data-testid=field-search-input]');
    await input.click();
    await input.type('pos');
    await page.waitForTimeout(150);
    const ghost = await page
      .locator('.search-ghost')
      .innerText()
      .catch(() => '');
    check('typing the start of a type shows the rest of it', ghost.replace(/\s+/g, ' ').includes('e2d'), ghost);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const chips = await page.locator('[data-testid=type-chip]').allInnerTexts();
    check(
      'Tab turns it into a type filter and keeps typing',
      chips.length === 1 &&
        chips[0].trim() === 'Pose2d' &&
        (await input.inputValue()) === '' &&
        (await input.evaluate((el) => el === (el as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement)),
      JSON.stringify(chips),
    );
    const badges = await page.locator('[data-testid=field-tree] .tree-row.field .kind-badge').allInnerTexts();
    check('only fields of that type are listed', badges.length > 0 && badges.every((b) => b.trim() === 'Pose2d'), badges.join(','));
    await input.type('odometry');
    await page.waitForTimeout(200);
    const keys = await page
      .locator('[data-testid=field-tree] .tree-row.field')
      .evaluateAll((els) => els.map((e) => (e as unknown as { dataset: { key: string } }).dataset.key));
    check('a word after it narrows by name', keys.length > 0 && keys.every((k) => /odometry/i.test(k)), keys.join(','));
    await input.fill('');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    check('Backspace on an empty search removes the type', (await page.locator('[data-testid=type-chip]').count()) === 0);
    await input.type('bool');
    await page.keyboard.press('Tab');
    await input.type('num');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const two = await page.locator('[data-testid=type-chip]').allInnerTexts();
    const kinds = new Set((await page.locator('[data-testid=field-tree] .tree-row.field .kind-badge').allInnerTexts()).map((b) => b.trim()));
    check(
      'two types list fields of either',
      two.map((x) => x.trim()).join() === 'boolean,number' && kinds.has('boolean') && kinds.has('number') && kinds.size === 2,
      `${two.join()} / ${[...kinds].join()}`,
    );
    await page.screenshot({ path: resolve(outDir, 'ui-field-filter.png') });
    await page.keyboard.press('Escape');
    check('Escape clears the search', (await page.locator('[data-testid=type-chip]').count()) === 0 && (await input.inputValue()) === '');
    // drag the sidebar's edge
    const sb0 = await page.locator('.sidebar').boundingBox();
    const rz = await page.locator('[data-testid=sidebar-resizer]').boundingBox();
    if (sb0 && rz) {
      await page.mouse.move(rz.x + rz.width / 2, rz.y + 200);
      await page.mouse.down();
      await page.mouse.move(rz.x + rz.width / 2 + 150, rz.y + 200, { steps: 6 });
      await page.mouse.up();
    }
    const sb1 = await page.locator('.sidebar').boundingBox();
    check('dragging its edge makes the sidebar wider', !!sb0 && !!sb1 && sb1.width > sb0.width + 120, JSON.stringify({ sb0, sb1 }));
    await page.locator('[data-testid=sidebar-resizer]').dblclick();
    await page.waitForTimeout(150);
    const sb2 = await page.locator('.sidebar').boundingBox();
    check('double-clicking it goes back to the default width', !!sb0 && !!sb2 && Math.abs(sb2.width - sb0.width) < 2);
  }
  await page.locator('[data-testid=file-menu]').click();
  check('the File menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  check('no emoji in the File menu', (await pictographs(page)) === '', await pictographs(page));
  check(
    'File menu lists Open and Export CSV',
    (await page.locator('.menu .menu-item', { hasText: 'Open logs' }).count()) === 1 &&
      (await page.locator('.menu .menu-item', { hasText: 'Export CSV' }).count()) === 1,
  );
  await page.keyboard.press('Escape');

  console.log('Presets');
  check('preset button names the active preset', (await presetText(page)) === 'Quick Look', await presetText(page));
  await page.locator('[data-testid=add-panel]').click();
  check('the Add panel menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  check(
    'Add panel is a menu with descriptions',
    (await page.locator('.menu .menu-item').count()) === 13 &&
      (await page.locator('.menu .menu-desc').count()) === 13 &&
      (await page.locator('.menu .menu-icon svg').count()) === 13,
  );
  await page.locator('.menu .menu-item', { hasText: 'Statistics' }).click();
  await page.waitForTimeout(500);
  check(
    'Add panel adds a panel',
    Object.values(await state<Record<string, { type: string }>>(page, 's.panelStore.get().panels')).filter((p) => p.type === 'stats').length === 1,
  );
  check('label shows (modified) after a change', (await presetText(page)) === 'Quick Look (modified)', await presetText(page));

  await page.locator('[data-testid=preset-menu]').click();
  check('the Preset menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  await page.locator('.menu .menu-item', { hasText: 'Power & Brownouts' }).click();
  await page.waitForSelector('.dialog');
  check('switching with unsaved changes asks first', (await page.locator('.dialog-title').innerText()).includes('Replace the current layout'));
  await dialogButton(page, 'Cancel');
  check('Cancel keeps the layout', (await presetText(page)) === 'Quick Look (modified)');
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Power & Brownouts' }).click();
  await dialogButton(page, 'Replace');
  await page.waitForTimeout(600);
  check('Replace applies the preset and shows its name', (await presetText(page)) === 'Power & Brownouts', await presetText(page));

  // save as user preset
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Save current layout as preset' }).click();
  await page.waitForSelector('.dialog-input');
  await page.locator('.dialog-input').fill('Quick Look');
  check('built-in names are refused', await page.locator('.dialog .btn.primary').isDisabled());
  await page.locator('.dialog-input').fill('Pit check');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('saved preset becomes active', (await presetText(page)) === 'Pit check' && (await state<number>(page, 's.presetStore.get().user.length')) === 1);
  // modify + update
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Table' }).click();
  await page.waitForTimeout(500);
  check('user preset shows (modified)', (await presetText(page)) === 'Pit check (modified)');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  check('Ctrl+S updates the active preset', (await presetText(page)) === 'Pit check');

  // export + import with a clash
  const exportPath = resolve(outDir, 'ui-presets.json');
  rmSync(exportPath, { force: true });
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, exportPath);
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Export presets' }).click();
  await page.waitForSelector('.dialog');
  check('export lets you pick presets', (await page.locator('.dialog-list .dialog-check').count()) === 1);
  await dialogButton(page, 'Export');
  await page.waitForTimeout(400);
  const exported = existsSync(exportPath) ? (JSON.parse(readFileSync(exportPath, 'utf8')) as { presets: { name: string }[] }) : null;
  check('export writes the chosen presets', exported?.presets.length === 1 && exported.presets[0].name === 'Pit check');
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Import presets' }).click();
  await page.waitForSelector('.dialog');
  check(
    'import asks what to do about a name clash',
    (await page.locator('.dialog-title').innerText()).includes('already exists') && (await page.locator('.dialog .btn').count()) === 3,
  );
  await dialogButton(page, 'Keep both');
  await page.waitForTimeout(300);
  const names = await state<string[]>(page, 's.presetStore.get().user.map(p => p.name)');
  check('Keep both imports under a new name', names.length === 2 && names.includes('Pit check (imported)'), names.join(', '));
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Import presets' }).click();
  await page.waitForSelector('.dialog');
  await dialogButton(page, 'Overwrite');
  await page.waitForTimeout(300);
  check('Overwrite keeps the count', (await state<number>(page, 's.presetStore.get().user.length')) === 2);
  await page.screenshot({ path: resolve(outDir, 'ui-presets.png') });
  await page.locator('[data-testid=preset-menu]').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(outDir, 'ui-preset-menu.png') });
  check('no emoji in the preset menu', (await pictographs(page)) === '', await pictographs(page));
  await page.keyboard.press('Escape');

  // back to Quick Look for the time tests
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Quick Look' }).click();
  await page.waitForTimeout(700);

  console.log('Timeline');
  await page.keyboard.press('m');
  const [e0, e1] = await extent(page);
  const [w0, w1] = await wholeExtent(page);
  {
    const v0 = await view(page);
    check(
      'the timeline covers the match, not the whole log',
      !(await state<boolean>(page, 's.sessionStore.get().wholeLog')) &&
        e0 > w0 + 1 &&
        e1 < w1 - 1 &&
        Math.abs(v0[0] - e0) < 1e-6 &&
        Math.abs(v0[1] - e1) < 1e-6,
      JSON.stringify({ e0, e1, w0, w1, v0 }),
    );
  }
  await page.locator('[data-testid=goto-btn]').click();
  await page.locator('[data-testid=goto-input]').fill('0:30');
  await page.keyboard.press('Enter');
  check('go-to-time moves the cursor', Math.abs((await state<number>(page, 's.timeStore.get().cursor')) - 30) < 1e-6);
  await page.locator('[data-testid=goto-btn]').click();
  await page.locator('[data-testid=goto-input]').fill('banana');
  await page.keyboard.press('Enter');
  check(
    'a bad time is rejected, not applied',
    (await page.locator('[data-testid=goto-input].bad').count()) === 1 && Math.abs((await state<number>(page, 's.timeStore.get().cursor')) - 30) < 1e-6,
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=span-input]').click();
  await page.locator('[data-testid=span-input]').fill('10');
  await page.keyboard.press('Enter');
  let v = await view(page);
  check('typing a span sets the zoom', Math.abs(v[1] - v[0] - 10) < 1e-6 && v[0] <= 30 && v[1] >= 30, JSON.stringify(v));
  await page.locator('.zoom-box button[aria-label="Zoom out"]').click();
  v = await view(page);
  check('the zoom-out button zooms out', Math.abs(v[1] - v[0] - 15) < 1e-6);

  // overview: drag the window far past the start and past the end
  const tl = await page.locator('[data-testid=timeline-canvas]').boundingBox();
  if (!tl) throw new Error('no timeline');
  const ovY = tl.y + 9;
  const xOfT = (t: number) => tl.x + 110 + ((t - e0) / (e1 - e0)) * (tl.width - 118);
  v = await view(page);
  await page.mouse.move(xOfT((v[0] + v[1]) / 2), ovY);
  await page.mouse.down();
  await page.mouse.move(tl.x - 400, ovY, { steps: 8 });
  await page.mouse.up();
  v = await view(page);
  check('overview window cannot be dragged before the start', Math.abs(v[0] - e0) < 1e-6 && Math.abs(v[1] - v[0] - 15) < 1e-6, JSON.stringify(v));
  await page.screenshot({ path: resolve(outDir, 'ui-overview-clamped.png') });
  await page.mouse.move(xOfT((v[0] + v[1]) / 2), ovY);
  await page.mouse.down();
  await page.mouse.move(tl.x + tl.width + 500, ovY, { steps: 8 });
  await page.mouse.up();
  v = await view(page);
  check('...or past the end', Math.abs(v[1] - e1) < 1e-6 && Math.abs(v[1] - v[0] - 15) < 1e-6, JSON.stringify(v));
  // wheel far out
  await page.mouse.move(tl.x + 600, tl.y + 40);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
  v = await view(page);
  check('zooming all the way out stops at the end of the match', Math.abs(v[0] - e0) < 1e-6 && Math.abs(v[1] - e1) < 1e-6, JSON.stringify(v));
  // click sets the cursor; resize handle
  await page.mouse.click(xOfT(60), tl.y + 40);
  check('clicking the timeline sets the cursor', Math.abs((await state<number>(page, 's.timeStore.get().cursor')) - 60) < 1.5);

  console.log('Timeline: scrub, snap, grips, ruler');
  const laneY = tl.y + 40;
  await page.mouse.move(xOfT(20), laneY);
  await page.mouse.down();
  check('pressing in the lanes moves the cursor at once', Math.abs((await state<number>(page, 's.timeStore.get().cursor')) - 20) < 1.5);
  await page.mouse.move(xOfT(45), laneY, { steps: 6 });
  const midScrub = await state<number>(page, 's.timeStore.get().cursor');
  await page.screenshot({ path: resolve(outDir, 'ui-timeline-scrub.png') });
  await page.mouse.up();
  check('dragging in the lanes scrubs the cursor', Math.abs(midScrub - 45) < 1.5, String(midScrub));
  // the primary log's auto start is t = 0: a press 3 px away snaps onto it
  await page.mouse.click(xOfT(0) + 3, laneY);
  check('the cursor snaps to a mode change', Math.abs(await state<number>(page, 's.timeStore.get().cursor')) < 1e-9);
  await page.keyboard.down('Alt');
  await page.mouse.move(xOfT(0) + 3, tl.y + tl.height - 30);
  await page.keyboard.up('Alt');
  // ruler pan
  await page.keyboard.press('m');
  await page.locator('[data-testid=span-input]').click();
  await page.locator('[data-testid=span-input]').fill('30');
  await page.keyboard.press('Enter');
  const beforePan = await view(page);
  const rulerY = tl.y + tl.height - 6;
  const pxPerSec = (tl.width - 118) / (beforePan[1] - beforePan[0]);
  await page.mouse.move(tl.x + 400, rulerY);
  await page.mouse.down();
  await page.mouse.move(tl.x + 400 - 5 * pxPerSec, rulerY, { steps: 5 });
  await page.mouse.up();
  const afterPan = await view(page);
  check(
    'dragging the time ruler pans by the drag',
    Math.abs(afterPan[0] - beforePan[0] - 5) < 0.2 && Math.abs(afterPan[1] - afterPan[0] - 30) < 1e-6,
    JSON.stringify({ beforePan, afterPan }),
  );
  // grips on the overview window
  const ovMid = tl.y + 12;
  const beforeGrip = await view(page);
  await page.mouse.move(xOfT(beforeGrip[1]) + 4, ovMid);
  check(
    'the pointer turns into a resize arrow over a grip',
    (await page.locator('[data-testid=timeline-canvas] canvas').evaluate((c) => (c as unknown as { style: { cursor: string } }).style.cursor)) === 'ew-resize',
  );
  await page.mouse.down();
  await page.mouse.move(xOfT(beforeGrip[1] + 20) + 4, ovMid, { steps: 6 });
  await page.screenshot({ path: resolve(outDir, 'ui-timeline-grip-drag.png') });
  await page.mouse.up();
  const afterGrip = await view(page);
  check(
    'dragging the right grip moves only the end',
    Math.abs(afterGrip[0] - beforeGrip[0]) < 1e-6 && afterGrip[1] > beforeGrip[1] + 15,
    JSON.stringify({ beforeGrip, afterGrip }),
  );
  await page.mouse.move(xOfT((afterGrip[0] + afterGrip[1]) / 2), ovMid);
  check(
    '...and an open hand over the window',
    (await page.locator('[data-testid=timeline-canvas] canvas').evaluate((c) => (c as unknown as { style: { cursor: string } }).style.cursor)) === 'grab',
  );
  // the label switches between the match and the whole log
  await page.mouse.click(tl.x + 80, ovMid);
  const whole = await extent(page);
  check('clicking "Match" switches the timeline to the whole log', Math.abs(whole[0] - w0) < 1e-6 && Math.abs(whole[1] - w1) < 1e-6, JSON.stringify(whole));
  await page.screenshot({ path: resolve(outDir, 'ui-timeline-whole-log.png') });
  await page.mouse.click(tl.x + 80, ovMid);
  check('...and back to the match', !(await state<boolean>(page, 's.sessionStore.get().wholeLog')));
  await page.keyboard.press('m');
  await page.screenshot({ path: resolve(outDir, 'ui-timeline-match.png') });

  console.log('Maximize a panel');
  {
    const g0 = await page.locator('.graph-panel canvas').first().boundingBox();
    await page.locator('.graph-panel').first().hover();
    await page.locator('.panel-frame:has(.graph-panel) [data-testid=panel-maximize]').first().click();
    await page.waitForTimeout(400);
    const g1 = await page.locator('.graph-panel canvas').first().boundingBox();
    check(
      'the maximize button lets a panel fill the grid',
      !!g0 && !!g1 && g1.width > g0.width * 1.3 && g1.height > g0.height * 1.3,
      JSON.stringify({ g0, g1 }),
    );
    check('...with the timeline still there', (await page.locator('[data-testid=timeline-canvas]').count()) === 1);
    check('...and the preset is not marked as changed', !(await presetText(page)).includes('modified'), await presetText(page));
    await page.screenshot({ path: resolve(outDir, 'ui-maximized.png') });
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);
    const g2 = await page.locator('.graph-panel canvas').first().boundingBox();
    check('Ctrl+Enter puts it back', !!g0 && !!g2 && Math.abs(g2.width - g0.width) < 4, JSON.stringify({ g0, g2 }));
  }
  const rz = await page.locator('.timeline-resizer').boundingBox();
  if (rz) {
    await page.mouse.move(rz.x + 300, rz.y + 3);
    await page.mouse.down();
    await page.mouse.move(rz.x + 300, rz.y - 80, { steps: 4 });
    await page.mouse.up();
  }
  const h = await state<number | null>(page, 's.sessionStore.get().timelineHeight');
  check('dragging the top edge resizes the timeline', typeof h === 'number' && h > 150, String(h));
  await page.evaluate('window.__brownout.sessionStore.set({ timelineHeight: null })');

  console.log('Position and vision');
  {
    const vis = await state<{ kind: string; size: number; text: string }[]>(
      page,
      `s.sessionStore.get().logs[0].events.filter(e => e.kind === 'vision').map(e => ({ kind: e.finding.kind, size: e.finding.size, text: e.text }))`,
    );
    check(
      'the demo match with a bad camera reading gets a camera disagreement and a position jump',
      vis.some((v) => v.kind === 'disagree' && v.text.startsWith('Camera 0 was 1.')) && vis.some((v) => v.kind === 'jump' && Math.abs(v.size - 0.58) < 0.05),
      JSON.stringify(vis),
    );
    check('...each saying what was running', vis.length > 0 && vis.every((v) => v.text.includes(' during ')), JSON.stringify(vis.map((v) => v.text)));
    check('the match without one has none', (await state<number>(page, `s.sessionStore.get().logs[1].events.filter(e => e.kind === 'vision').length`)) === 0);
    check(
      'the console lists them with the other events',
      (await page.locator('.console-panel', { hasText: 'Robot position jumped' }).count()) > 0 || (await page.getByText('Robot position jumped').count()) > 0,
    );
  }

  console.log('Graphs do not move time; value axis zooms on its own');
  await page.keyboard.press('m');
  const graph = await page.locator('.graph-panel canvas').first().boundingBox();
  if (!graph) throw new Error('no graph');
  const before = await view(page);
  const cursorBefore = await state<number>(page, 's.timeStore.get().cursor');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -300);
  await page.mouse.down();
  await page.mouse.move(graph.x + graph.width / 2 + 150, graph.y + graph.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(graph.x + graph.width / 3, graph.y + graph.height / 2);
  const after = await view(page);
  check('wheel, drag and click on a graph leave the time range alone', before[0] === after[0] && before[1] === after[1]);
  check('...and the cursor', (await state<number>(page, 's.timeStore.get().cursor')) === cursorBefore);
  const gp = () =>
    state<{ yLeft?: [number, number] | null; yRight?: [number, number] | null }>(
      page,
      `Object.values(s.panelStore.get().panels).find(p => p.type === 'graph')`,
    );
  let g = await gp();
  check('wheel on the plot zooms the value axes', !!g.yLeft && !!g.yRight, JSON.stringify(g.yLeft));
  await page.mouse.dblclick(graph.x + graph.width / 2, graph.y + graph.height / 2);
  g = await gp();
  check('double-click returns to auto-fit', !g.yLeft && !g.yRight);
  await page.mouse.move(graph.x + 20, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -300);
  g = await gp();
  check('wheel on the left axis zooms only that axis', !!g.yLeft && !g.yRight);
  await page.screenshot({ path: resolve(outDir, 'ui-yzoom.png') });
  await page.mouse.dblclick(graph.x + graph.width / 2, graph.y + graph.height / 2);

  console.log('Playback ignores hover');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  check('hover previews while paused', (await state<number | null>(page, 's.timeStore.get().hover')) !== null);
  await page.mouse.click(xOfT(10), tl.y + 40);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.mouse.move(graph.x + graph.width / 3, graph.y + graph.height / 2, { steps: 4 });
  await page.mouse.move(xOfT(120), tl.y + 40, { steps: 4 });
  const playing = await state<{ hover: number | null; cursor: number; playing: boolean }>(
    page,
    '({ hover: s.timeStore.get().hover, cursor: s.timeStore.get().cursor, playing: s.timeStore.get().playing })',
  );
  check('hover is ignored during playback', playing.playing && playing.hover === null && playing.cursor > 10 && playing.cursor < 13, JSON.stringify(playing));
  await page.keyboard.press('Space');

  await page.locator('.graph-panel .menu-btn', { hasText: 'Y:' }).first().click();
  check('the graph’s Y axis menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  check(
    'an open menu does not light its button up as if it were switched on',
    (await page.locator('.menu-btn.open.active').count()) === 0 && (await page.locator('.menu-btn.open').count()) === 1,
  );
  await page.keyboard.press('Escape');
  check('Escape closes the menu', (await page.locator('.menu').count()) === 0);
  if ((await page.locator('[data-testid=graph-linked]').count()) > 0)
    check(
      '“Linked” is lit while the graph follows the timeline',
      (await page.locator('[data-testid=graph-linked]').first().getAttribute('class'))!.includes('active'),
    );

  console.log('Field zoom');
  check('Fit is greyed out while the whole field shows', await page.locator('[data-testid=field-fit]').first().isDisabled());
  const field = await page.locator('.field-panel canvas').first().boundingBox();
  if (field) {
    await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
    await page.mouse.wheel(0, -400);
    const fz = await state<number>(page, `Object.values(s.panelStore.get().panels).find(p => p.type === 'field').zoom`);
    check('wheel zooms the field', fz > 1, String(fz));
    check(
      'Fit becomes available once zoomed, without lighting up',
      (await page.locator('[data-testid=field-fit]').first().isEnabled()) &&
        !(await page.locator('[data-testid=field-fit]').first().getAttribute('class'))!.includes('active'),
    );
    await page.mouse.dblclick(field.x + field.width / 2, field.y + field.height / 2);
    check('double-click fits it again', (await state<number>(page, `Object.values(s.panelStore.get().panels).find(p => p.type === 'field').zoom`)) === 1);
  }
  check('zooming is view state, not a layout change', (await presetText(page)) === 'Quick Look', await presetText(page));

  console.log('Dialogs replace prompt()');
  if ((await page.locator('.graph-panel .ov-items .ov-item:not(.ov-out) .tool-btn', { hasText: 'Threshold' }).count()) === 0)
    await page.locator('.graph-panel .ov-more').first().click();
  await page.locator('.tool-btn:visible', { hasText: 'Threshold' }).first().click();
  await page.waitForSelector('.dialog-input');
  await page.locator('.dialog-input').fill('9.5');
  await page.keyboard.press('Enter');
  check(
    'threshold dialog adds a line',
    (await state<number[]>(page, `Object.values(s.panelStore.get().panels).find(p => p.type === 'graph').thresholds`)).includes(9.5),
  );
  check('choosing a control in the overflow menu closes the menu', (await page.locator('.ov-menu').count()) === 0);
  await page
    .locator('.panel-frame')
    .first()
    .click({ position: { x: 5, y: 160 } })
    .catch(() => undefined);
  await page.keyboard.press('b');
  await page.waitForSelector('.dialog-input');
  await page.locator('.dialog-input').fill('got hit here');
  await page.keyboard.press('Enter');
  check('bookmark dialog adds a bookmark', (await state<string[]>(page, 's.sessionStore.get().bookmarks.map(b => b.text)')).includes('got hit here'));

  console.log('Compact view');
  const toolbarHeights = () =>
    page.evaluate(`[...document.querySelectorAll('.toolbar, .transport, .header')].map(e => Math.round(e.getBoundingClientRect().height))`) as Promise<
      number[]
    >;
  check(
    'toolbars, header and timeline bar are one row each',
    (await toolbarHeights()).every((x) => x <= 40),
    (await toolbarHeights()).join(','),
  );
  check(
    'graph field chips sit on one line',
    ((await page.evaluate(`Math.round(document.querySelector('.graph-panel .series-chips').getBoundingClientRect().height)`)) as number) <= 28,
  );
  await page.evaluate(`window.__brownout.settingsStore.set({ compact: true })`);
  await page.waitForTimeout(300);
  check(
    'compact view collapses the chips to a count',
    (await page.locator('.graph-panel .series-chips').count()) === 0 &&
      /^\d+ fields?$/.test((await page.locator('[data-testid=graph-fields]').first().innerText()).trim()),
    await page
      .locator('[data-testid=graph-fields]')
      .first()
      .innerText()
      .catch(() => 'missing'),
  );
  check(
    '...and keeps only the most-used toolbar buttons',
    (await page.locator('.graph-panel').first().locator('.ov-items .tool-btn', { hasText: 'Modes' }).count()) === 0,
  );
  await page.locator('.graph-panel .ov-more').first().click();
  check('a panel’s overflow menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  check(
    'the rest are in the overflow menu',
    (await page.locator('.ov-menu .tool-btn', { hasText: 'Modes' }).count()) === 1 &&
      (await page.locator('.ov-menu .tool-btn', { hasText: 'Threshold' }).count()) === 1,
  );
  await page.screenshot({ path: resolve(outDir, 'ui-compact-menu.png') });
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=graph-fields]').first().click();
  check('the field list menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  check('the field count opens the list of fields', (await page.locator('.chip-list .chip-row').count()) >= 1);
  await page.keyboard.press('Escape');
  await page.evaluate(`window.__brownout.settingsStore.set({ compact: false })`);
  // narrow window
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800));
  await page.waitForTimeout(600);
  const narrowW = (await page.evaluate('window.innerWidth')) as number;
  if (narrowW <= 980) {
    check('a narrow window hides the sidebar', (await state<boolean>(page, 's.sessionStore.get().sidebarOpen')) === false);
    check('...and switches the header to compact', (await page.locator('.header.compact').count()) === 1);
    check(
      '...with everything still on one row',
      (await toolbarHeights()).every((x) => x <= 40),
      (await toolbarHeights()).join(','),
    );
    await page.locator('[data-testid=header-more]').click();
    check('the header overflow menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
    check(
      'the header overflow menu holds alignment and Potato mode',
      (await page.locator('.ov-menu .tool-select').count()) >= 1 && (await page.locator('.ov-menu .tool-btn', { hasText: 'Potato mode' }).count()) === 1,
    );
    await page.screenshot({ path: resolve(outDir, 'ui-narrow.png') });
    await page.keyboard.press('Escape');
  } else console.log(`  (window could not be resized here: ${narrowW}px, narrow-window checks skipped)`);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));
  await page.waitForTimeout(500);
  await page.evaluate(`window.__brownout.sessionStore.set({ sidebarOpen: true })`);
  await page.waitForTimeout(300);
  // legend strip
  const g2 = await page.locator('.graph-panel canvas').first().boundingBox();
  if (!g2) throw new Error('no graph');
  await page.mouse.click(g2.x + 120, g2.y + 9);
  check(
    'clicking the legend strip opens the full legend',
    (await state<boolean>(page, `!!Object.values(s.panelStore.get().panels).find(p => p.type === 'graph').legendOpen`)) === true,
  );
  await page.mouse.click(g2.x + 120, g2.y + 9);
  check(
    '...and closes it again',
    (await state<boolean>(page, `!!Object.values(s.panelStore.get().panels).find(p => p.type === 'graph').legendOpen`)) === false,
  );

  console.log('Multi-select, folder drag and favorites');
  const folder = (name: string) => page.locator('.tree-row.folder').filter({ has: page.locator(`.name:text-is("${name}")`) });
  const fieldRow = (key: string) => page.locator(`.tree-row.field[data-key="${key}"]`);
  await folder('Shooter').click();
  await fieldRow('/Shooter/StatorCurrentAmps').click();
  await fieldRow('/Shooter/SupplyCurrentAmps').click({ modifiers: ['Shift'] });
  check('Shift-click selects a range', (await state<number>(page, 's.sessionStore.get().selectedKeys.length')) === 2);
  await fieldRow('/Shooter/StatorCurrentAmps').click({ modifiers: ['Control'] });
  check('Ctrl-click removes one', (await state<string[]>(page, 's.sessionStore.get().selectedKeys')).join() === '/Shooter/SupplyCurrentAmps');
  await fieldRow('/Shooter/StatorCurrentAmps').click({ modifiers: ['Control'] });
  check(
    '...and adds it back',
    (await state<number>(page, 's.sessionStore.get().selectedKeys.length')) === 2 && (await page.locator('.selection-bar').innerText()).includes('2 selected'),
  );
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Line graph' }).click();
  await page.waitForTimeout(500);
  const lastOf = (type: string) =>
    state<string>(page, `Object.entries(s.panelStore.get().panels).filter(([, p]) => p.type === '${type}').map(([id]) => id).pop()`);
  const newGraph = await lastOf('graph');
  const seriesOf = (id: string) => state<string[]>(page, `s.panelStore.get().panels['${id}'].series.map(x => x.key)`);
  await fieldRow('/Shooter/SupplyCurrentAmps').dragTo(page.locator(`[data-panel="${newGraph}"]`));
  await page.waitForTimeout(300);
  check('dragging one selected field drops the whole selection', (await seriesOf(newGraph)).length === 2, (await seriesOf(newGraph)).join(','));
  check('...and says so', (await toastText(page)).includes('Added 2 fields'), await toastText(page));
  await folder('Elevator').dragTo(page.locator(`[data-panel="${newGraph}"]`));
  await page.waitForTimeout(300);
  check(
    'dragging a folder adds every field inside it',
    (await seriesOf(newGraph)).includes('/Elevator/SupplyCurrentAmps'),
    (await seriesOf(newGraph)).join(','),
  );
  // a drop the panel can only partly take
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Statistics' }).click();
  await page.waitForTimeout(500);
  const newStats = await lastOf('stats');
  await fieldRow('/Shooter/SupplyCurrentAmps').dragTo(page.locator(`[data-panel="${newStats}"]`));
  await page.waitForTimeout(300);
  check('a panel reports what it skipped', /Added 1 of 2 .*Skipped 1/.test(await toastText(page)), await toastText(page));
  await fieldRow('/Shooter/SupplyCurrentAmps').hover();
  await fieldRow('/Shooter/SupplyCurrentAmps').locator('.fav-btn').click();
  check(
    'the star adds a favorite to the robot profile',
    (await state<string[]>(page, 's.profileStore.get().profiles[0].favorites')).join() === '/Shooter/SupplyCurrentAmps',
  );
  check('favorites are listed at the top of the sidebar', (await page.locator('.fav-section .tree-row.field').count()) === 1);
  await page.screenshot({ path: resolve(outDir, 'ui-multiselect.png') });
  await page.locator('.selection-bar .link-btn', { hasText: 'Clear' }).click();

  console.log('Power by subsystem');
  const presetBeforeViews = await presetText(page);
  await page.locator('[data-testid=power-btn]').click();
  await page.waitForSelector('.power-panel');
  check('the Power button opens the Power view with the power report', (await page.locator('[data-testid=power-view] .power-panel').count()) === 1);
  check(
    '...the panel grid steps aside, and Add panel with it',
    !(await page.locator('.grid-wrap').isVisible()) && (await page.locator('[data-testid=add-panel]').count()) === 0,
  );
  check(
    '...and a battery graph sits above the report',
    (await page.locator('[data-view-panel="view:battery"] canvas').count()) === 1 &&
      (await state<number>(page, `s.panelStore.get().panels['view:battery'].series.length`)) > 0,
  );
  check('with no subsystems it explains what to do', (await page.locator('[data-testid=subsystems-empty]').count()) === 1);
  await page.locator('[data-testid=subsystems-empty] .btn').click();
  await page.waitForSelector('[data-testid=subsystem-editor]');
  await page.locator('[data-testid=suggest-subsystems]').click();
  const subs = () => state<{ name: string; channels: number[]; fields: string[] }[]>(page, 's.profileStore.get().profiles[0].subsystems');
  check(
    'suggestions group motor currents by folder',
    (await subs()).map((x) => x.name).join() === 'Elevator,Intake,Shooter',
    (await subs()).map((x) => x.name).join(),
  );
  check('...and prefer supply current over stator', (await subs()).find((x) => x.name === 'Shooter')?.fields.join() === '/Shooter/SupplyCurrentAmps');
  await page.locator('[data-testid=add-subsystem]').click();
  const driveCard = page.locator('.subsys-card[data-subsystem=Drive]');
  await driveCard.locator('[data-testid=subsys-channels]').click();
  check(
    'the channel picker shows each channel with its peak current',
    (await driveCard.locator('.channel').count()) === 24 && /A|idle/.test(await driveCard.locator('.channel').first().innerText()),
  );
  for (let c = 0; c < 8; c++) await driveCard.locator('.channel').nth(c).click();
  check('channels are assigned to the subsystem', (await subs()).find((x) => x.name === 'Drive')?.channels.length === 8);
  await page.screenshot({ path: resolve(outDir, 'ui-subsystems.png') });
  await page.locator('[data-testid=subsystems-done]').click();
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = (globalThis as any).__brownout.sessionStore.get().logs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return logs.every((l: any) => l.subsystems && l.subsystems.stats.length === 4 && l.subsystems.hasData);
  });
  await page.waitForTimeout(500);
  const rep = await state<
    {
      stats: { name: string; share: number; energyWh: number; peakCurrent: number }[];
      unassigned: { share: number } | null;
      brownouts: { atDip: { id: string; amps: number }[] }[];
    }[]
  >(page, 's.sessionStore.get().logs.map(l => l.subsystems)');
  const shareSum = rep[0].stats.reduce((a, x) => a + x.share, 0) + (rep[0].unassigned?.share ?? 0);
  check('shares of energy add up to 100%', Math.abs(shareSum - 1) < 1e-6, String(shareSum));
  check(
    'every subsystem has energy and a peak',
    rep[0].stats.every((x) => x.energyWh > 0 && x.peakCurrent > 0),
    JSON.stringify(rep[0].stats.map((x) => [x.name, x.energyWh.toFixed(2)])),
  );
  check('the table lists each subsystem and the unassigned rest', (await page.locator('[data-testid=subsystem-table] tbody tr').count()) === 5);
  const browned = rep.findIndex((r) => r.brownouts.length > 0);
  const elevatorId = (await state<{ id: string; name: string }[]>(page, 's.profileStore.get().profiles[0].subsystems')).find((x) => x.name === 'Elevator')!.id;
  check(
    'the brownout names the subsystem that was drawing',
    browned >= 0 && rep[browned].brownouts[0].atDip[0].id === elevatorId && rep[browned].brownouts[0].atDip[0].amps > 150,
    JSON.stringify(rep[browned]?.brownouts[0]?.atDip.slice(0, 2)),
  );
  check(
    '...and the report says so in words',
    (await page.locator('[data-testid=brownout-card]').first().innerText()).includes('Biggest draw: Elevator'),
    await page
      .locator('[data-testid=brownout-card]')
      .first()
      .innerText()
      .catch(() => 'no card'),
  );
  check(
    'current per subsystem becomes graphable fields',
    (await state<number>(page, `s.sessionStore.get().logs[0].fields.filter(f => f.key.startsWith('/Brownout/Subsystems/')).length`)) === 5,
  );
  check('the stacked chart is drawn', (await page.locator('[data-testid=subsystem-chart] canvas').count()) === 1);
  check('no emoji in the power report', (await pictographs(page)) === '', await pictographs(page));
  await page.screenshot({ path: resolve(outDir, 'ui-power.png') });
  await page.evaluate(`window.__brownout.timeStore.set({ selection: [0, 15] })`);
  await page.waitForSelector('.range-note');
  check('with a selection the numbers cover the selection', (await page.locator('.range-note').innerText()).includes('cover the selection'));
  await page.evaluate(`window.__brownout.timeStore.set({ selection: null })`);
  await page.locator('.battery-label').first().fill('B7');
  await page.locator('.battery-label').first().press('Enter');
  await page.waitForTimeout(600);
  const hist = await state<{ label: string; milliohm: number | null }[]>(page, 's.profileStore.get().batteryHistory');
  check('a battery label starts that battery’s history', hist.length === 1 && hist[0].label === 'B7' && (hist[0].milliohm ?? 0) > 5, JSON.stringify(hist));
  check(
    'battery health shows resistance and a rating',
    (await page.locator('.battery-table .rating').count()) === 2 && /mΩ/.test(await page.locator('.battery-table').innerText()),
  );
  await page.screenshot({ path: resolve(outDir, 'ui-view-power.png') });
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(300);
  check(
    'Ctrl+1 brings the panels back as they were',
    (await page.locator('.grid-wrap').isVisible()) && (await presetText(page)) === presetBeforeViews,
    await presetText(page),
  );

  console.log('Robot profile');
  const profilePath = resolve(outDir, 'ui-robot.json');
  rmSync(profilePath, { force: true });
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, profilePath);
  await page.locator('[data-testid=settings-btn]').click();
  await page.locator('.settings-tab', { hasText: 'Robot' }).click();
  await page.waitForSelector('[data-testid=robot-settings]');
  check('the Robot page shows the profile’s subsystems', (await page.locator('[data-testid=robot-settings] .subsys-card').count()) === 4);
  check('...and which profile each open log uses', (await page.locator('[data-testid=robot-settings] .setting-row select').count()) >= 2);
  await page.screenshot({ path: resolve(outDir, 'ui-settings-robot.png') });
  await page.locator('[data-testid=profile-export]').click();
  await page.waitForTimeout(400);
  const exportedProfile = existsSync(profilePath)
    ? (JSON.parse(readFileSync(profilePath, 'utf8')) as { brownoutRobotProfile: number; profile: { subsystems: unknown[]; favorites: string[] } })
    : null;
  check(
    'export writes the whole profile to one file',
    exportedProfile?.brownoutRobotProfile === 1 && exportedProfile.profile.subsystems.length === 4 && exportedProfile.profile.favorites.length === 1,
  );
  await page.locator('[data-testid=profile-import]').click();
  await page.waitForSelector('.dialog');
  check('importing a profile with the same name asks first', (await page.locator('.dialog-title').innerText()).includes('Replace'));
  await dialogButton(page, 'Cancel');
  await page.waitForTimeout(300);
  check(
    'Cancel keeps both',
    (await state<string[]>(page, 's.profileStore.get().profiles.map(p => p.name)')).join() === 'My robot,My robot (2)',
    (await state<string[]>(page, 's.profileStore.get().profiles.map(p => p.name)')).join(),
  );
  check(
    'open logs keep their profile',
    (await state<string[]>(page, 's.sessionStore.get().logs.map(l => l.profileId)')).every((id, _i, a) => id === a[0]),
  );
  await page.keyboard.press('Escape');

  console.log('Field picture and swerve');
  const fieldBox = await page.locator('.field-panel canvas').first().boundingBox();
  if (fieldBox) {
    const clip = { x: fieldBox.x, y: fieldBox.y, width: fieldBox.width, height: fieldBox.height };
    await page.mouse.move(5, 5);
    const withPic = await page.screenshot({ clip });
    await page.locator('[data-testid=field-display]').first().click();
    check('the field Display menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
    check(
      'the Display menu offers the field picture, on by default',
      (await page.locator('.menu .menu-item', { hasText: 'Field picture' }).first().locator('.menu-icon svg').count()) === 1,
    );
    check('...with a tag map choice for seasons that have two', (await page.locator('.menu .menu-item', { hasText: 'AndyMark field' }).count()) === 1);
    await page.locator('.menu .menu-item', { hasText: 'Field picture' }).first().click();
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const withoutPic = await page.screenshot({ clip });
    check(
      'the real field picture is drawn',
      !withPic.equals(withoutPic) && withPic.length > withoutPic.length * 1.3,
      `${withPic.length} vs ${withoutPic.length} bytes`,
    );
    await page.evaluate(
      `(() => { const s = window.__brownout; const [id] = Object.entries(s.panelStore.get().panels).find(([, p]) => p.type === 'field'); s.panelStore.set(st => ({ panels: { ...st.panels, [id]: { ...st.panels[id], showImage: true } } })); })()`,
    );
  }
  // a team's own field picture: a WPILib / PathWeaver field JSON next to its image
  const fieldJson = resolve(outDir, 'ui-test-field.json');
  await page.screenshot({ path: resolve(outDir, 'ui-test-field.png') });
  writeFileSync(
    fieldJson,
    JSON.stringify({
      game: 'Test Field',
      'field-image': 'ui-test-field.png',
      'field-corners': { 'top-left': [100, 50], 'bottom-right': [1400, 850] },
      'field-size': [54, 27],
      'field-unit': 'foot',
    }),
  );
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, fieldJson);
  await page.locator('[data-testid=field-display]').first().click();
  await page.locator('.menu .menu-item', { hasText: 'Load your own field picture' }).click();
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__brownout.sessionStore.get().customFields.length === 1;
  });
  const custom = await state<{ season: string; fields: { name: string; length: number; width: number }[] }>(
    page,
    '({ season: s.sessionStore.get().seasonId, fields: s.sessionStore.get().customFields })',
  );
  check(
    'a custom field picture loads and becomes the season',
    custom.season.startsWith('custom-') &&
      custom.fields[0].name === 'Test Field' &&
      Math.abs(custom.fields[0].length - 16.4592) < 1e-3 &&
      Math.abs(custom.fields[0].width - 8.2296) < 1e-3,
    JSON.stringify(custom),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'ui-custom-field.png') });
  await page.evaluate(`window.__brownout.sessionStore.set({ seasonId: '2026' })`);

  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Swerve drive' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 44 })`);
  await page.waitForTimeout(600);
  check(
    'the swerve panel finds the module states',
    (await page.locator('.swerve-panel canvas').count()) === 1 && (await page.locator('.swerve-panel .panel-placeholder').count()) === 0,
  );
  await page.screenshot({ path: resolve(outDir, 'ui-swerve.png') });

  console.log('Cameras and AprilTags');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__brownout.sessionStore.get().logs.every((l: any) => l.cameras !== undefined);
  });
  const cams = await state<{ name: string; seenFraction: number; meanError?: number; blind: unknown[] }[]>(page, 's.sessionStore.get().logs[0].cameras');
  check(
    'cameras are found from field names with no setup',
    cams.length === 2 && cams.every((c) => c.seenFraction > 0.05 && c.seenFraction < 1 && (c.meanError ?? 9) < 1),
    JSON.stringify(cams.map((c) => [c.name, c.seenFraction, c.meanError, c.blind.length])),
  );
  const visionKeys = await state<string[]>(page, `s.sessionStore.get().logs[0].fields.filter(f => f.key.startsWith('/Brownout/Vision/')).map(f => f.key)`);
  check(
    'each camera gets tags-seen, tag-count and estimate-error fields',
    visionKeys.filter((k) => k.endsWith('/TagsSeen')).length === 2 &&
      visionKeys.some((k) => k.endsWith('/TagCount')) &&
      visionKeys.some((k) => k.endsWith('/EstimateError')),
    visionKeys.join(', '),
  );
  await page.locator('.dv-default-tab', { hasText: '2D field' }).click();
  await page.waitForSelector('.field-panel canvas');
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 44 })`);
  const fieldBox2 = await page.locator('.field-panel canvas').first().boundingBox();
  if (fieldBox2) {
    const clip = { x: fieldBox2.x, y: fieldBox2.y, width: fieldBox2.width, height: fieldBox2.height };
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const withCams = await page.screenshot({ clip });
    await page.locator('[data-testid=field-display]').first().click();
    check(
      'the Display menu lists the camera view',
      (await page.locator('.menu .menu-item', { hasText: 'Cameras' }).first().locator('.menu-icon svg').count()) === 1,
    );
    await page.locator('.menu .menu-item', { hasText: 'Cameras' }).first().click();
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const withoutCams = await page.screenshot({ clip });
    check('camera lines, ghost estimates and the readout are drawn on the field', !withCams.equals(withoutCams));
    await page.locator('[data-testid=field-display]').first().click();
    await page.locator('.menu .menu-item', { hasText: 'Cameras' }).first().click();
    await page.locator('.menu .menu-item', { hasText: 'Tags-seen tracks' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const tracks = await state<string[]>(page, 's.sessionStore.get().timelineTracks');
    check('the tags-seen tracks go on the timeline, one per camera', tracks.filter((k) => k.endsWith('/TagsSeen')).length === 2, tracks.join(', '));
    await page.screenshot({ path: resolve(outDir, 'ui-cameras.png') });
    await page.locator('[data-testid=field-display]').first().click();
    await page.locator('.menu .menu-item', { hasText: 'Set up cameras' }).click();
    await page.waitForSelector('[data-testid=camera-editor]');
    check('the camera editor says what it found', (await page.locator('[data-testid=camera-editor] .callout').innerText()).includes('found 2 cameras'));
    await page.locator('[data-testid=detect-cameras]').click();
    await page.waitForTimeout(200);
    const profCams = await state<{ name: string; tagIdsKey?: string; poseKey?: string }[]>(page, 's.profileStore.get().profiles[0].cameras');
    check(
      'the detected cameras can be copied into the profile to edit',
      profCams.length === 2 && !!profCams[0].tagIdsKey && !!profCams[0].poseKey,
      JSON.stringify(profCams),
    );
    await page.locator('[data-testid=camera-editor] .subsys-card').first().locator('.subsys-name').fill('Front camera');
    // a camera with only tag IDs: the other fields are left empty
    await page.locator('[data-testid=camera-editor] .subsys-card').nth(1).locator('.cam-slot').first().locator('.chip-btn').click();
    await page.screenshot({ path: resolve(outDir, 'ui-camera-editor.png') });
    check('no emoji in the camera editor', (await pictographs(page)) === '', await pictographs(page));
    await page.locator('[data-testid=cameras-done]').click();
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (globalThis as any).__brownout.sessionStore.get().logs[0].cameras;
      return !!c && c[0]?.name === 'Front camera';
    });
    const cams2 = await state<{ name: string; meanError?: number; seenFraction: number }[]>(page, 's.sessionStore.get().logs[0].cameras');
    check('a camera with no pose field still reports its tags', cams2[1].meanError === undefined && cams2[1].seenFraction > 0.05, JSON.stringify(cams2));
    const tracks3 = await state<string[]>(page, 's.sessionStore.get().timelineTracks');
    check(
      'the timeline tracks follow the rename',
      tracks3.includes('/Brownout/Vision/Front camera/TagsSeen') && !tracks3.includes('/Brownout/Vision/Camera 0/TagsSeen'),
      tracks3.join(', '),
    );
    const tracks2 = await state<string[]>(page, `s.sessionStore.get().logs[0].fields.filter(f => f.key.endsWith('/TagsSeen')).map(f => f.key)`);
    check('renaming a camera renames its fields', tracks2.includes('/Brownout/Vision/Front camera/TagsSeen'), tracks2.join(', '));
  }

  console.log('Controller and commands');
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Controller' }).click();
  await page.waitForTimeout(600);
  check(
    'the controller panel finds joystick 0',
    (await page.locator('.controller-panel canvas').count()) === 1 && (await page.locator('.controller-panel .panel-placeholder').count()) === 0,
  );
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 61.3 })`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(outDir, 'ui-controller.png') });
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Commands' }).click();
  await page.waitForSelector('[data-testid=commands-chart]');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Number((globalThis as any).document.querySelector('[data-testid=commands-chart]')?.getAttribute('data-rows')) >= 5;
  });
  const cmdRows = Number(await page.locator('[data-testid=commands-chart]').getAttribute('data-rows'));
  check('the commands panel reads the scheduler: one row per command', cmdRows >= 5, String(cmdRows));
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(outDir, 'ui-commands.png') });
  const cmdBox = await page.locator('[data-testid=commands-chart] canvas').boundingBox();
  if (cmdBox) {
    // sweep the first rows until a run is under the mouse, then click it
    await page.evaluate(`window.__brownout.timeStore.set({ cursor: null })`);
    let jumped: number | null = null;
    for (let y = 50; y < Math.min(cmdBox.height, 260) && jumped === null; y += 6) {
      for (let x = 200; x < cmdBox.width - 20 && jumped === null; x += 25) {
        await page.mouse.move(cmdBox.x + x, cmdBox.y + y);
        const tip = await page.locator('[data-testid=commands-chart] canvas').getAttribute('title');
        if (tip && tip.includes('Click to jump')) {
          await page.mouse.click(cmdBox.x + x, cmdBox.y + y);
          jumped = await state<number | null>(page, 's.timeStore.get().cursor');
        }
      }
    }
    check('clicking a command run moves the cursor to its start', jumped !== null, String(jumped));
  }

  console.log('Robot appearance');
  await page.locator('[data-testid=settings-btn]').click();
  await page.locator('.settings-tab', { hasText: 'Robot' }).click();
  await page.locator('[data-testid=edit-robot]').click();
  await page.waitForSelector('[data-testid=robot-editor]');
  await page.locator('[data-testid=add-rect]').click();
  await page.locator('[data-testid=layer-x]').fill('0.3');
  await page.locator('[data-testid=layer-x]').press('Enter');
  const layers1 = await state<{ kind: string; x: number; link: unknown }[]>(page, 's.profileStore.get().profiles[0].layers');
  check(
    'a rectangle can be added and placed by typing',
    layers1.length === 1 && layers1[0].kind === 'rect' && layers1[0].x === 0.3 && layers1[0].link === null,
    JSON.stringify(layers1),
  );
  await page.locator('[data-testid=layer-link]').click();
  await page.locator('.modal-head input').last().fill('TurretPosition');
  await page.locator('.modal-row').first().click();
  await page.waitForTimeout(200);
  const linked = await state<{ link: { key: string; unit: string } | null; pivot: { x: number } }>(page, 's.profileStore.get().profiles[0].layers[0]');
  check(
    'a part can be linked to a logged angle, turning about its own center',
    linked.link?.key === '/Shooter/TurretPositionRad' && linked.link.unit === 'rad' && linked.pivot.x === 0.3,
    JSON.stringify(linked),
  );
  const prevBox = await page.locator('[data-testid=robot-preview]').boundingBox();
  if (prevBox) {
    const clip = { x: prevBox.x, y: prevBox.y, width: prevBox.width, height: prevBox.height };
    const before = await page.screenshot({ clip });
    await page.locator('[data-testid=robot-test-angle]').fill('60');
    await page.waitForTimeout(250);
    check('the test angle turns the linked part in the preview', !before.equals(await page.screenshot({ clip })));
    await page.locator('[data-testid=robot-test-angle]').fill('0');
    // the robot's front is up: the part at 0.3 m forward sits above the center; drag it right and down
    const scalePx = (Math.min(prevBox.width, prevBox.height - 24) / (0.9 * 1.25)) * 0.3;
    const sx = prevBox.x + prevBox.width / 2;
    const sy = prevBox.y + prevBox.height / 2 + 6 - scalePx;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 30, { steps: 4 });
    await page.mouse.up();
    const dragged = await state<{ x: number; y: number; pivot: { x: number; y: number } }>(page, 's.profileStore.get().profiles[0].layers[0]');
    check(
      'dragging in the preview moves the part (and its pivot with it)',
      dragged.x < 0.3 && dragged.y < 0 && dragged.pivot.x === dragged.x && dragged.pivot.y === dragged.y,
      JSON.stringify(dragged),
    );
  }
  const svgPath = resolve(outDir, 'ui-test-part.svg');
  writeFileSync(
    svgPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120" viewBox="0 0 80 120"><path d="M40 4 L76 116 L40 92 L4 116 Z" fill="#e15759" stroke="#fff" stroke-width="4"/></svg>',
  );
  await page.locator('[data-testid=robot-picture-file]').setInputFiles(svgPath);
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__brownout.profileStore.get().profiles[0].layers.length === 2;
  });
  await page.locator('[data-testid=robot-picture-file]').setInputFiles(resolve(outDir, 'ui-test-field.png'));
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__brownout.profileStore.get().profiles[0].layers.length === 3;
  });
  const pics = await state<{ kind: string; src: string; length: number; width: number }[]>(
    page,
    's.profileStore.get().profiles[0].layers.slice(1).map(l => ({ kind: l.kind, src: l.src.slice(0, 26), length: l.length, width: l.width, bytes: l.src.length }))',
  );
  check(
    'an SVG and a picture can be added; they are kept inside the profile, shaped like the file',
    pics[0].kind === 'image' &&
      pics[0].src.startsWith('data:image/svg+xml;base64,') &&
      Math.abs(pics[0].width / pics[0].length - 80 / 120) < 0.02 &&
      pics[1].src.startsWith('data:image/webp;base64,') &&
      pics[1].width <= 0.9 &&
      pics[1].length <= 0.9,
    JSON.stringify(pics),
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(outDir, 'ui-robot-editor.png') });
  check('no emoji in the robot editor', (await pictographs(page)) === '', await pictographs(page));
  // the big picture would cover everything on the field: remove it again
  await page.locator('[data-testid=robot-layers] .robot-layer').first().locator('.chip-btn').last().click();
  check('a part can be deleted', (await state<number>(page, 's.profileStore.get().profiles[0].layers.length')) === 2);
  {
    type L = {
      id: string;
      name: string;
      x: number;
      y: number;
      length: number;
      width: number;
      rotation: number;
      pivot: { x: number; y: number };
      parent?: string | null;
    };
    const parts = () => state<L[]>(page, 's.profileStore.get().profiles[0].layers');
    const [rect] = await parts();
    // where it turns: its back end
    await page.locator(`[data-testid=robot-layers] .robot-layer[data-layer="${rect.name}"]`).click();
    await page.locator('[data-testid=layer-anchor]').selectOption('back');
    const r1 = (await parts())[0];
    const ra = (r1.rotation * Math.PI) / 180;
    check(
      'a part can turn around its back end',
      Math.abs(r1.pivot.x - (r1.x - (r1.length / 2) * Math.cos(ra))) < 1e-6 && Math.abs(r1.pivot.y - (r1.y - (r1.length / 2) * Math.sin(ra))) < 1e-6,
      JSON.stringify(r1),
    );
    // drag the pivot marker: the pivot moves, the part stays
    const pb = await page.locator('[data-testid=robot-preview]').boundingBox();
    if (pb) {
      const ls = await parts();
      const span = Math.max(0.9, 0.9, ...ls.map((l) => 2 * Math.max(Math.abs(l.x) + l.length / 2, Math.abs(l.y) + l.width / 2))) * 1.25;
      const sc = Math.max(20, Math.min(pb.width, pb.height - 24) / Math.max(span, 0.5));
      const px = pb.x + pb.width / 2 - r1.pivot.y * sc;
      const py = pb.y + pb.height / 2 + 6 - r1.pivot.x * sc;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.move(px + 20, py, { steps: 4 });
      await page.mouse.up();
      const r2 = (await parts())[0];
      check(
        'dragging the pivot marker moves the pivot, not the part',
        r2.x === r1.x && r2.y === r1.y && r2.pivot.y < r1.pivot.y - 0.02 && Math.abs(r2.pivot.x - r1.pivot.x) < 0.01,
        JSON.stringify({ before: r1.pivot, after: r2.pivot }),
      );
      check('...and the turn point then reads as one you set', (await page.locator('[data-testid=layer-anchor]').inputValue()) === 'custom');
    }
    // attach the picture to the turning rectangle
    const pic = (await parts())[1];
    await page.locator(`[data-testid=robot-layers] .robot-layer[data-layer="${pic.name}"]`).click();
    await page.locator('[data-testid=layer-parent]').selectOption(rect.id);
    check('a part can be attached to another part', (await parts())[1].parent === rect.id);
    const rectOptions = await page.locator(`[data-testid=robot-layers] .robot-layer[data-layer="${rect.name}"]`).count();
    await page.locator(`[data-testid=robot-layers] .robot-layer[data-layer="${rect.name}"]`).click();
    const choices = await page.locator('[data-testid=layer-parent] option').allInnerTexts();
    check('...and a part cannot be attached to one that hangs from it', rectOptions === 1 && !choices.some((c) => c.startsWith(pic.name)), choices.join(' | '));
    const pclip = pb ? { x: pb.x, y: pb.y, width: pb.width, height: pb.height } : undefined;
    if (pclip) {
      await page.locator('[data-testid=robot-test-angle]').fill('90');
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(outDir, 'ui-robot-attached.png'), clip: pclip });
      await page.locator('[data-testid=robot-test-angle]').fill('0');
    }
  }
  await page.locator('[data-testid=robot-done]').click();
  // the robot's size is not capped
  {
    const len = page.locator('input[title="Length, front to back (m)"]');
    await len.fill('3.6');
    await len.blur();
    await page.waitForTimeout(150);
    check('a robot can be longer than 3 m', (await state<number>(page, 's.profileStore.get().profiles[0].robot.length')) === 3.6);
    await len.fill('0.9');
    await len.blur();
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  await page.locator('.dv-default-tab', { hasText: '2D field' }).click();
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 44 })`);
  await page.waitForTimeout(600);
  check('opening an editor from the Display menu closes the menu', (await page.locator('.menu').count()) === 0);
  {
    const fb = await page.locator('.field-panel canvas').first().boundingBox();
    const clip = { x: fb!.x, y: fb!.y, width: fb!.width, height: fb!.height };
    await page.mouse.move(5, 5);
    const withParts = await page.screenshot({ clip });
    await page.evaluate(
      `(() => { const s = window.__brownout; window.__layers = s.profileStore.get().profiles[0].layers; s.profileStore.set(st => ({ profiles: st.profiles.map((p, i) => i === 0 ? { ...p, layers: [] } : p) })); })()`,
    );
    await page.waitForTimeout(300);
    const noParts = await page.screenshot({ clip });
    await page.evaluate(
      `(() => { const s = window.__brownout; s.profileStore.set(st => ({ profiles: st.profiles.map((p, i) => i === 0 ? { ...p, layers: window.__layers } : p) })); })()`,
    );
    await page.waitForTimeout(300);
    check('the robot’s parts are drawn on the 2D field', !withParts.equals(noParts));
    // the Display menu hides all parts, one part, or the robot names
    const fieldSettings = () =>
      state<{ showParts?: boolean; hiddenParts?: string[]; showLabels?: boolean }>(
        page,
        `Object.entries(s.panelStore.get().panels).find(([id, p]) => p.type === 'field' && !id.startsWith('view:'))[1]`,
      );
    await page.locator('.field-panel [data-testid=field-display]').first().click();
    await page.locator('.menu [data-testid=field-show-parts]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.mouse.move(5, 5);
    const hiddenAll = await page.screenshot({ clip });
    check(
      'the Display menu can hide the robot’s parts',
      (await fieldSettings()).showParts === false && !hiddenAll.equals(withParts) && hiddenAll.equals(noParts),
    );
    await page.locator('.field-panel [data-testid=field-display]').first().click();
    await page.locator('.menu [data-testid=field-show-parts]').click();
    await page.locator('.menu [data-testid=field-part]').first().click();
    check('...or one part at a time', (await fieldSettings()).showParts !== false && (await fieldSettings()).hiddenParts?.length === 1);
    await page.locator('.menu [data-testid=field-part]').first().click();
    await page.locator('.menu .menu-item', { hasText: 'Robot names' }).click();
    check('...and the robot names', (await fieldSettings()).showLabels === false && (await fieldSettings()).hiddenParts?.length === 0);
    await page.locator('.menu .menu-item', { hasText: 'Robot names' }).click();
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: resolve(outDir, 'ui-robot-on-field.png') });

  console.log('Video');
  const videoPath = resolve(outDir, 'ui-test-video.mp4');
  if (!existsSync(videoPath))
    execSync(
      `ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=480x270:rate=30:duration=20 -c:v libx264 -pix_fmt yuv420p -g 15 -movflags +faststart "${videoPath}"`,
    );
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, videoPath);
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Video' }).click();
  await page.waitForSelector('.video-panel');
  check('a new video panel asks for a file', (await page.locator('.video-panel .panel-placeholder').innerText()).includes('Choose the match video'));
  await page.locator('[data-testid=video-pick]').click();
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (globalThis as any).document.querySelector('[data-testid=video]');
    return !!v && v.readyState >= 2 && v.duration > 19;
  });
  check(
    'the chosen video loads through the app’s own address',
    (await page.locator('[data-testid=video]').getAttribute('src'))!.startsWith('brownout-media://video/'),
  );

  console.log('Video sync view');
  check('choosing a video opens the sync view', (await page.locator('[data-testid=video-sync-view]').count()) === 1);
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (globalThis as any).document.querySelector('[data-testid=video-sync-video]');
    return !!v && v.readyState >= 2;
  });
  const svt = () => page.evaluate(`document.querySelector('[data-testid=video-sync-video]').currentTime`) as Promise<number>;
  check('the sync view offers the log’s auto start', (await page.locator('[data-testid=video-sync-marker-auto]').count()) === 1);
  await page.waitForSelector('[data-testid=video-sync-time][data-fps]');
  {
    const fps = await page.locator('[data-testid=video-sync-time]').getAttribute('data-fps');
    check('it measures the video’s frame rate', fps === '30', String(fps));
  }
  const cursorBeforeSync = await state<number | null>(page, 's.timeStore.get().cursor');
  await page.locator('[data-testid=video-sync-goto]').fill('3');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.locator('[data-testid=video-sync-pair]').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check('arrow keys step the video one frame at a time', Math.abs((await svt()) - (3 + 3 / 30)) < 0.02, String(await svt()));
  check('...and leave the shared cursor alone', (await state<number | null>(page, 's.timeStore.get().cursor')) === cursorBeforeSync);
  const vtl = await page.locator('[data-testid=video-sync-timeline] canvas').boundingBox();
  if (!vtl) throw new Error('no video timeline');
  const dur = (await page.evaluate(`document.querySelector('[data-testid=video-sync-video]').duration`)) as number;
  const vx = (t: number) => vtl.x + 8 + (t / dur) * (vtl.width - 16);
  const seeks0 = (await page.evaluate(`({ ...window.__brownout.seekStats })`)) as { requested: number; issued: number };
  await page.mouse.move(vx(4), vtl.y + 15);
  await page.mouse.down();
  await page.mouse.move(vx(10), vtl.y + 15, { steps: 60 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const seeks1 = (await page.evaluate(`({ ...window.__brownout.seekStats })`)) as { requested: number; issued: number };
  const drag = { requested: seeks1.requested - seeks0.requested, issued: seeks1.issued - seeks0.issued };
  check('dragging the video timeline lands on the frame under the pointer', Math.abs((await svt()) - 10) < 0.06, JSON.stringify({ ...drag, at: await svt() }));
  // a burst of seeks faster than the video can decode: one runs, the rest wait, and it ends on the last
  const burst = (await page.evaluate(
    `(() => { const s = window.__brownout; const v = document.querySelector('[data-testid=video-sync-video]'); const r0 = s.seekStats.requested, i0 = s.seekStats.issued; for (let i = 0; i <= 60; i++) s.chaseSeek(v, 4 + i * 0.1); return { requested: s.seekStats.requested - r0, issued: s.seekStats.issued - i0 }; })()`,
  )) as { requested: number; issued: number };
  await page.waitForTimeout(800);
  check(
    'a burst of seeks runs one at a time and ends on the last',
    burst.issued <= 2 && Math.abs((await svt()) - 10) < 0.01,
    JSON.stringify({ ...burst, at: await svt() }),
  );
  await page.locator('[data-testid=video-sync-goto]').fill('10.01');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.locator('[data-testid=video-sync-pair]').click();
  check('pairing says what was paired', /Paired: video 0:10\.0\d/.test(await page.locator('[data-testid=video-sync-status]').innerText()));
  await page.screenshot({ path: resolve(outDir, 'ui-video-sync.png') });
  // zoom the video timeline in to single frames, then pick one by clicking it
  await page.mouse.move(vx(10), vtl.y + 15);
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  const vview = ((await page.locator('[data-testid=video-sync-timeline]').getAttribute('data-view')) ?? '').split(',').map(Number);
  check('the wheel zooms the video timeline in to a few frames', vview.length === 2 && vview[1] - vview[0] <= 13 / 30 + 1e-6, vview.join(' to '));
  await page.screenshot({ path: resolve(outDir, 'ui-video-sync-frames.png') });
  {
    const t = vview[0] + (vview[1] - vview[0]) * 0.75;
    await page.mouse.click(vtl.x + 8 + 0.75 * (vtl.width - 16), vtl.y + 15);
    await page.waitForTimeout(300);
    check('clicking a frame shows that frame', Math.floor((await svt()) * 30 + 1e-6) === Math.floor(t * 30 + 1e-6), `${await svt()} for ${t}`);
  }
  // the log strip holds still while dragging, so the moment follows the pointer exactly
  {
    const ls = await page.locator('[data-testid=video-sync-strip] canvas').boundingBox();
    if (!ls) throw new Error('no log strip');
    const lview0 = (await page.locator('[data-testid=video-sync-strip]').getAttribute('data-view')) ?? '';
    const [lo, hi] = lview0.split(',').map(Number);
    await page.keyboard.down('Alt');
    await page.mouse.move(ls.x + 8 + 0.3 * (ls.width - 16), ls.y + 50);
    await page.mouse.down();
    await page.mouse.move(ls.x + 8 + 0.7 * (ls.width - 16), ls.y + 50, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const lview1 = (await page.locator('[data-testid=video-sync-strip]').getAttribute('data-view')) ?? '';
    check('dragging on the log strip leaves its view where it was', lview0 === lview1 && lview0 !== '', `${lview0} then ${lview1}`);
    // the pair button names the moment as "log <aligned time>"
    const label = await page.locator('[data-testid=video-sync-pair]').innerText();
    const shown = /log ([+-]?\d+:\d+(?:\.\d+)?)/.exec(label);
    const offset = await state<number>(page, 's.sessionStore.get().logs[0].offset');
    const want = lo + 0.7 * (hi - lo) + offset;
    const m = shown ? /^([+-]?)(\d+):(\d+(?:\.\d+)?)$/.exec(shown[1]) : null;
    const got = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : NaN;
    check('...and the moment is where the pointer let go', Math.abs(got - want) < ((hi - lo) / ls.width) * 3 + 0.01, `${label}: ${got} vs ${want}`);
  }
  check('no emoji in the sync view', (await pictographs(page)) === '', await pictographs(page));
  await page.locator('[data-testid=video-sync-cancel]').click();
  check(
    'Cancel closes the view without saving a sync',
    (await page.locator('[data-testid=video-sync-view]').count()) === 0 &&
      (await state<number | null>(page, `s.videoStore.get().byLog[s.sessionStore.get().logs[0].fileName].logMinusVideo`)) === null,
  );

  const vt = () => page.evaluate(`document.querySelector('[data-testid=video]').currentTime`) as Promise<number>;
  await page.locator('[data-testid=video-scrub]').fill('2');
  await page.waitForTimeout(400);
  check('the scrub bar moves the video while it is not synced', Math.abs((await vt()) - 2) < 0.05, String(await vt()));
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 44, playing: false })`);
  await page.locator('[data-testid=video-sync]').click();
  check('the Sync menu is fully visible', (await menuState(page)) === 'ok', await menuState(page));
  await page.locator('.menu .menu-item', { hasText: 'This frame is the cursor' }).click();
  await page.waitForSelector('[data-testid=video-synced]');
  const sync = await state<{ lmv: number; offset: number }>(
    page,
    `(() => { const l = s.sessionStore.get().logs[0]; return { lmv: s.videoStore.get().byLog[l.fileName].logMinusVideo, offset: l.offset }; })()`,
  );
  check('syncing stores the log-to-video offset', Math.abs(sync.lmv - (44 - sync.offset - 2)) < 0.05, JSON.stringify(sync));
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 47.5 })`);
  await page.waitForTimeout(500);
  check('moving the timeline cursor seeks the video', Math.abs((await vt()) - 5.5) < 0.06, String(await vt()));
  await page.locator('.video-panel [title*="one frame later"]').click();
  const nudged = await state<number>(page, `s.videoStore.get().byLog[s.sessionStore.get().logs[0].fileName].logMinusVideo`);
  check('the frame buttons fine-tune the sync by one frame', Math.abs(sync.lmv - nudged - 1 / 30) < 1e-6, String(sync.lmv - nudged));
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 300 })`);
  await page.waitForTimeout(300);
  check('past the end of the video it says so', (await page.locator('.video-note').innerText()).includes('The video ended'));
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 46 })`);
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1600);
  const vplay = (await page.evaluate(
    `(() => { const s = window.__brownout; const l = s.sessionStore.get().logs[0]; const v = document.querySelector('[data-testid=video]'); return { v: v.currentTime, want: s.timeStore.get().cursor - l.offset - s.videoStore.get().byLog[l.fileName].logMinusVideo, paused: v.paused }; })()`,
  )) as { v: number; want: number; paused: boolean };
  check('the video plays along with the timeline', !vplay.paused && vplay.v > 4.6 && Math.abs(vplay.v - vplay.want) < 0.35, JSON.stringify(vplay));
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check('...and pauses with it', (await page.evaluate(`document.querySelector('[data-testid=video]').paused`)) === true);
  await page.screenshot({ path: resolve(outDir, 'ui-video.png') });

  // reopen the sync view from the menu: it starts from the saved sync; re-pair auto start with 0:01 and apply
  await page.locator('[data-testid=video-sync]').click();
  await page.locator('.menu .menu-item', { hasText: 'Open the sync view' }).click();
  await page.waitForSelector('[data-testid=video-sync-view]');
  await page.waitForTimeout(500);
  check('the sync view starts from the saved sync', (await page.locator('[data-testid=video-sync-status]').innerText()).includes('Paired'));
  await page.locator('[data-testid=video-sync-marker-auto]').click();
  await page.locator('[data-testid=video-sync-goto]').fill('1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.locator('[data-testid=video-sync-pair]').click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const applied = await state<{ lmv: number; auto: number }>(
    page,
    `(() => { const l = s.sessionStore.get().logs[0]; return { lmv: s.videoStore.get().byLog[l.fileName].logMinusVideo, auto: l.robotState.autoStart }; })()`,
  );
  check(
    'Apply saves "this frame is auto start"',
    (await page.locator('[data-testid=video-sync-view]').count()) === 0 && Math.abs(applied.lmv - (applied.auto - 1)) < 0.02,
    JSON.stringify(applied),
  );

  console.log('Two-moment sync (a video whose clock runs slow)');
  {
    await page.locator('[data-testid=video-sync]').click();
    await page.locator('.menu .menu-item', { hasText: 'Open the sync view' }).click();
    await page.waitForSelector('[data-testid=video-sync-view]');
    await page.waitForTimeout(400);
    const rs = await state<{ auto: number; teleop: number; offset: number }>(
      page,
      `(() => { const l = s.sessionStore.get().logs[0]; return { auto: l.robotState.autoStart, teleop: l.robotState.teleopStart, offset: l.offset }; })()`,
    );
    // auto start stays paired with 0:01; teleop start shows up 2% early, as from a clock running 2% slow
    const teleopVideo = 1 + 0.98 * (rs.teleop - rs.auto);
    await page.locator('[data-testid=video-sync-marker-teleop]').click();
    await page.locator('[data-testid=video-sync-goto]').fill(teleopVideo.toFixed(3));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=video-sync-pair]').click();
    const twoStatus = await page.locator('[data-testid=video-sync-status]').innerText();
    check('pairing a second moment measures the video clock', twoStatus.includes('runs 2.0% slow'), twoStatus);
    await page.screenshot({ path: resolve(outDir, 'ui-video-sync-two.png') });
    await page.locator('[data-testid=video-sync-apply]').click();
    await page.waitForTimeout(200);
    const e = await state<{ lmv: number; rate: number }>(
      page,
      `(() => { const l = s.sessionStore.get().logs[0]; const e = s.videoStore.get().byLog[l.fileName]; return { lmv: e.logMinusVideo, rate: e.rate }; })()`,
    );
    check('Apply saves the speed correction', Math.abs(e.rate - 0.98) < 0.002 && Math.abs(e.lmv - (rs.auto - 1 / e.rate)) < 0.02, JSON.stringify(e));
    await page.evaluate(`window.__brownout.timeStore.set({ cursor: ${rs.teleop + rs.offset}, playing: false })`);
    await page.waitForTimeout(500);
    check('the panel shows the right frame late in the match', Math.abs((await vt()) - teleopVideo) < 0.06, `${await vt()} vs ${teleopVideo}`);
    await page.evaluate(`window.__brownout.timeStore.set({ cursor: ${rs.auto + rs.offset + 2} })`);
    await page.waitForTimeout(300);
    await page.evaluate(`document.activeElement && document.activeElement.blur()`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const pr = (await page.evaluate(`document.querySelector('[data-testid=video]').playbackRate`)) as number;
    await page.keyboard.press('Space');
    check('...and plays the video at the corrected speed', Math.abs(pr - 0.98) < 0.002, String(pr));
  }

  console.log('Video offering');
  const videoDir = resolve(outDir, 'ui-videos');
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(videoDir, { recursive: true });
  copyFileSync(videoPath, resolve(videoDir, '2026nyroc_qm18.mp4'));
  copyFileSync(videoPath, resolve(videoDir, 'Q180.mp4')); // a different match
  copyFileSync(videoPath, resolve(videoDir, 'Practice 18.mp4')); // a different kind of match
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, videoDir);
  await page.evaluate(`window.__brownout.uiStore.set({ settingsOpen: true, settingsTab: 'general' })`);
  await page.locator('[data-testid=video-folder-pick]').click();
  await page.waitForTimeout(300);
  check('the videos folder is set in Settings', (await page.locator('[data-testid=video-folder]').innerText()).includes('ui-videos'));
  await page.keyboard.press('Escape');
  await page.evaluate(
    `(() => { const s = window.__brownout; const ps = s.panelStore.get().panels; const id = Object.keys(ps).find(k => ps[k].type === 'video'); s.panelStore.set({ panels: { ...ps, [id]: { ...ps[id], logId: s.sessionStore.get().logs[1].id } } }); })()`,
  );
  await page.waitForSelector('[data-testid=video-suggestion]');
  const suggestions = await page.locator('[data-testid=video-suggestion]').allInnerTexts();
  check(
    'the empty video panel suggests the video named like the match, and only it',
    suggestions.length === 1 && suggestions[0] === 'Use 2026nyroc_qm18.mp4',
    suggestions.join(', '),
  );
  await page.screenshot({ path: resolve(outDir, 'ui-video-suggestion.png') });
  await page.locator('[data-testid=video-suggestion]').click();
  await page.waitForSelector('[data-testid=video-sync-view]');
  const used = await state<string | undefined>(page, `s.videoStore.get().byLog[s.sessionStore.get().logs[1].fileName]?.path`);
  check('using it attaches the video and opens the sync view', !!used && used.endsWith('2026nyroc_qm18.mp4'), String(used));
  await page.screenshot({ path: resolve(outDir, 'ui-video-offer.png') });
  await page.locator('[data-testid=video-sync-cancel]').click();
  // for session 2: a video for the third demo log, to be offered when the session reopens
  copyFileSync(videoPath, resolve(videoDir, 'NYROC Q23.mp4'));

  console.log('Match report');
  const reportPath = resolve(outDir, 'ui-report.pdf');
  rmSync(reportPath, { force: true });
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never;
  }, reportPath);
  await page.locator('[data-testid=file-menu]').click();
  await page.locator('[data-testid=match-report]').click();
  await page.waitForSelector('.dialog');
  check('with two logs open the report asks which one', (await page.locator('.dialog-message').innerText()).includes('Which one'));
  await page.locator('.dialog .btn').nth(1).click();
  await page
    .waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return [...(globalThis as any).document.querySelectorAll('.toast')].some((t: any) => t.textContent.includes('Match report saved'));
      },
      null,
      { timeout: 20000 },
    )
    .catch(() => undefined);
  const pdf = existsSync(reportPath) ? readFileSync(reportPath) : null;
  check(
    'the match report is written as a PDF',
    !!pdf && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 15000,
    pdf ? `${pdf.length} bytes` : await toastText(page),
  );

  console.log('Copy panel as image');
  await page.locator('.dv-default-tab', { hasText: 'Swerve drive' }).click();
  await page.locator('.swerve-panel').click({ position: { x: 60, y: 80 } });
  await page.keyboard.press('Control+Shift+C');
  await page.waitForTimeout(900);
  check('Ctrl+Shift+C reports the copy', (await toastText(page)).includes('as an image'), await toastText(page));
  const clipTypes = await app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((i) => i.types)).catch((e) => [`error: ${e}`]);
  check('the clipboard holds a PNG', clipTypes.includes('image/png'), clipTypes.join(','));

  console.log('Settings');
  await page.locator('[data-testid=settings-btn]').click();
  await page.waitForSelector('.modal.settings');
  check('no emoji in settings', (await pictographs(page)) === '', await pictographs(page));
  await page.screenshot({ path: resolve(outDir, 'ui-settings-general.png') });
  await page.locator('.settings-tab', { hasText: 'Appearance' }).click();
  await page.locator('.theme-card', { hasText: 'Light' }).click();
  await page.waitForTimeout(300);
  check('light theme applies', (await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)) === '#ffffff');
  await page.screenshot({ path: resolve(outDir, 'ui-settings-appearance.png') });
  await page.locator('.settings-tab', { hasText: 'Keybinds' }).click();
  await page.locator('.keycap[data-action=play]').click();
  await page.keyboard.press('p');
  check('rebinding stores the new key', (await state<string>(page, 's.settingsStore.get().keybinds.play')) === 'P');
  await page.locator('.keycap[data-action=zoomIn]').click();
  await page.keyboard.press('f');
  const kb = await state<Record<string, string>>(page, 's.settingsStore.get().keybinds');
  check(
    'a taken key moves to the new command and the old one is unbound',
    kb.zoomIn === 'F' && kb.zoomFull === '' && (await page.locator('.keybind-note').count()) === 1,
    JSON.stringify(kb),
  );
  await page.screenshot({ path: resolve(outDir, 'ui-settings-keybinds.png') });
  await page.locator('.settings-footer .btn').click();
  check('reset all restores defaults', Object.keys(await state<Record<string, string>>(page, 's.settingsStore.get().keybinds')).length === 0);
  await page.locator('.keycap[data-action=play]').click();
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  check('Esc closes settings', (await page.locator('.modal.settings').count()) === 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(outDir, 'ui-light.png') });
  await page.keyboard.press('p');
  check('the rebound key works', await state<boolean>(page, 's.timeStore.get().playing'));
  await page.keyboard.press('Space');
  check('the old key no longer does', await state<boolean>(page, 's.timeStore.get().playing'));
  await page.keyboard.press('p');
  await page.keyboard.press('?');
  check(
    '? opens the generated help',
    (await page.locator('.modal.help').count()) === 1 && (await page.locator('.modal.help').innerText()).includes('Play / pause'),
  );
  await page.screenshot({ path: resolve(outDir, 'ui-help.png') });
  check('no emoji in the help sheet', (await pictographs(page)) === '', await pictographs(page));
  await page.keyboard.press('Escape');

  console.log('Potato mode');
  await page.locator('[data-testid=potato-btn]').click();
  check('header toggle turns Potato mode on', await state<boolean>(page, 's.settingsStore.get().potato'));
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  check('no hover readouts in Potato mode', (await state<number | null>(page, 's.timeStore.get().hover')) === null);
  const ratio = await page.evaluate(`(() => { const c = document.querySelector('.canvas-host canvas'); return c.width / c.clientWidth; })()`);
  check('canvases drop to 1× resolution', Math.abs((ratio as number) - 1) < 0.02, String(ratio));
  await page.screenshot({ path: resolve(outDir, 'ui-potato.png') });
  await page.locator('[data-testid=potato-btn]').click();
  await page.evaluate(`window.__brownout.settingsStore.set({ theme: 'dark' })`);

  console.log('Demo lives in settings and asks first');
  await page.keyboard.press('Control+,');
  await page.waitForSelector('.modal.settings');
  await page.locator('.settings-tab', { hasText: 'Demo' }).click();
  await page.locator('[data-testid=load-demo]').click();
  await page.waitForSelector('.dialog');
  check('loading the demo with logs open asks "are you sure"', (await page.locator('.dialog-message').innerText()).toLowerCase().includes('are you sure'));
  await page.screenshot({ path: resolve(outDir, 'ui-demo-confirm.png') });
  await dialogButton(page, 'Cancel');
  check('Cancel leaves the session alone', (await state<number>(page, 's.sessionStore.get().logs.length')) === 2);
  await page.locator('[data-testid=load-demo]').click();
  await dialogButton(page, 'Load demo');
  await waitLogs(page, 3);
  check(
    'confirming loads the three demo logs',
    (await state<number>(page, 's.sessionStore.get().logs.length')) === 3 && (await page.locator('.modal.settings').count()) === 0,
  );
  await page.waitForTimeout(500);
  check('...with the Quick Look layout', (await presetText(page)) === 'Quick Look');
  const demoProfile = await state<{ id: string; name: string; subsystems: unknown[] }>(
    page,
    `s.profileStore.get().profiles.find(p => p.name === 'Demo robot')`,
  );
  check(
    'the demo comes with its own robot profile',
    !!demoProfile &&
      demoProfile.subsystems.length === 5 &&
      (await state<string[]>(page, 's.sessionStore.get().logs.map(l => l.profileId)')).every((id) => id === demoProfile.id),
  );
  await page.screenshot({ path: resolve(outDir, 'ui-final.png') });

  check(
    'no toolbar row was left scrolled',
    (await page.evaluate(`[...document.querySelectorAll('.ov-items')].every(e => e.scrollTop === 0 && e.scrollLeft === 0)`)) === true,
  );
  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();

  // ------------------------------------------------------------------ session 2
  console.log('Session 2: relaunch without arguments');
  ({ app, page, errors } = await launch([]));
  await waitLogs(page, 3);
  const restored = await state<string[]>(page, 's.sessionStore.get().logs.map(l => l.name)');
  check('last session logs reopen on launch', restored.length === 3, restored.join(', '));
  const offerToast = page.locator('.toast', { hasText: 'Found a video that looks like' });
  const offered = await offerToast
    .first()
    .waitFor({ timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  check(
    'a log that opens without a video is offered the one named like its match',
    offered && (await offerToast.count()) === 1 && (await offerToast.innerText()).includes('NYROC Q23.mp4'),
    offered ? await offerToast.first().innerText() : 'no offer',
  );
  if (offered) await offerToast.locator('button', { hasText: 'Not now' }).click();
  check('"Not now" is remembered', String(await page.evaluate(`localStorage.getItem('brownout.videoOffers.v1') || ''`)).includes('NYROC Q23.mp4'));
  check('settings persisted (rebound key)', (await state<string>(page, 's.settingsStore.get().keybinds.play')) === 'P');
  check('presets persisted', (await state<number>(page, 's.presetStore.get().user.length')) === 2);
  check('active preset remembered', (await presetText(page)) === 'Quick Look', await presetText(page));
  const profs = await state<{ name: string; subsystems: unknown[]; favorites: string[] }[]>(page, 's.profileStore.get().profiles');
  check(
    'robot profiles persisted',
    profs.length === 3 && profs[0].subsystems.length === 4 && profs[0].favorites.length === 1,
    profs.map((p) => `${p.name}:${p.subsystems.length}`).join(', '),
  );
  check(
    'reopened logs keep their robot profile',
    (await state<string[]>(page, 's.sessionStore.get().logs.map(l => s.profileStore.get().profiles.find(p => p.id === l.profileId).name)')).every(
      (n) => n === 'Demo robot',
    ),
  );
  await page.locator('[data-testid=power-btn]').click();
  await page.waitForSelector('[data-testid=brownout-card]');
  check(
    'the power report is ready without any setup',
    (await page.locator('[data-testid=brownout-card]').first().innerText()).includes('Biggest draw: Elevator'),
  );
  await page.locator('[data-testid=view-panels]').click();
  check('the custom field picture persisted', (await state<number>(page, 's.sessionStore.get().customFields.length')) === 1);
  await page.locator('[data-testid=add-panel]').click();
  await page.locator('.menu .menu-item', { hasText: 'Video' }).click();
  const restoredVideo = await page
    .waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (globalThis as any).document.querySelector('[data-testid=video]');
        return !!v && v.readyState >= 1;
      },
      null,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  check('a log’s video and its sync are remembered', restoredVideo && (await page.locator('[data-testid=video-synced]').count()) === 1);
  check(
    'the demo robot comes with parts, one linked to the turret angle',
    (await state<number>(page, `s.profileStore.get().profiles.find(p => p.name === 'Demo robot').layers.filter(l => l.link).length`)) === 1,
  );
  check('battery history persisted', (await state<number>(page, 's.profileStore.get().batteryHistory.length')) >= 1);
  await page.screenshot({ path: resolve(outDir, 'ui-power-demo.png') });
  await page.locator('[data-testid=preset-menu]').click();
  await page.locator('.menu .menu-item', { hasText: 'Match Replay' }).click();
  await page.waitForTimeout(300);
  if ((await page.locator('.dialog').count()) > 0) await dialogButton(page, 'Replace');
  await page.waitForSelector('[data-testid=commands-chart]');
  await page.evaluate(`window.__brownout.timeStore.set({ cursor: 44 })`);
  await page.waitForTimeout(1200);
  const replayTypes = Object.entries(await state<Record<string, { type: string }>>(page, 's.panelStore.get().panels'))
    .filter(([id]) => !id.startsWith('view:'))
    .map(([, p]) => p)
    .map((p) => p.type)
    .sort()
    .join();
  check('the Match Replay preset lays out video, field, controller and commands', replayTypes === 'commands,controller,field,video', replayTypes);
  check(
    '...with the tags-seen tracks on the timeline',
    (await state<string[]>(page, 's.sessionStore.get().timelineTracks')).filter((k) => k.endsWith('/TagsSeen')).length === 2,
  );
  await page.screenshot({ path: resolve(outDir, 'ui-replay.png') });

  console.log('Video review');
  await page.keyboard.press('Control+2');
  await page.waitForSelector('[data-testid=video-review]');
  await page.waitForTimeout(600);
  {
    const vb = await page.locator('[data-view-panel="view:video"]').boundingBox();
    const fb = await page.locator('[data-view-panel="view:field"]').boundingBox();
    check(
      'the video and the field sit side by side at the same height',
      !!vb && !!fb && Math.abs(vb.y - fb.y) < 2 && Math.abs(vb.height - fb.height) < 2 && fb.x > vb.x + vb.width - 2,
      JSON.stringify({ vb, fb }),
    );
    check(
      'the field shows the log whose video it is',
      (await state<string>(page, `s.panelStore.get().panels['view:field'].source`)) === (await state<string>(page, 's.sessionStore.get().logs[0].id')),
    );
    const items = await page.locator('[data-testid=video-review-item]').allInnerTexts();
    check(
      'the moments to check list the camera disagreement and the position jump',
      items.some((x) => x.includes('Camera 0 was')) && items.some((x) => x.includes('Robot position jumped')),
      items.join(' | '),
    );
    const jumpRow = page.locator('[data-testid=video-review-item]', { hasText: 'Robot position jumped' }).first();
    await jumpRow.click();
    const want = await state<number>(
      page,
      `(() => { const l = s.sessionStore.get().logs[0]; const e = l.events.find(e => e.kind === 'vision' && e.finding.kind === 'jump'); return e.t + l.offset; })()`,
    );
    check('clicking a moment goes there', Math.abs((await state<number>(page, 's.timeStore.get().cursor')) - want) < 1e-6);
    await page.screenshot({ path: resolve(outDir, 'ui-view-video.png') });
    check('no emoji in the Video review', (await pictographs(page)) === '', await pictographs(page));
  }
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(300);
  check('no renderer errors after restore', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  ✗ ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
