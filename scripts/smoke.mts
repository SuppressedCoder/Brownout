/**
 * Smoke test: build, launch Electron with the demo logs, wait for the UI to
 * report ready, save a screenshot to smoke/screenshot.png, and fail on
 * renderer errors or a timeout. Uses xvfb-run when no display is available.
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'smoke'), { recursive: true });
const shot = resolve(root, 'smoke', 'screenshot.png');
const logs = ['FRC_20260321_143012_NYROC_Q12.wpilog', 'FRC_20260321_171844_NYROC_Q18.wpilog'].map((f) => resolve(root, 'fixtures', 'demo', f));
if (!logs.every(existsSync)) execSync('npx tsx scripts/make-demo.mts', { cwd: root, stdio: 'inherit' });
if (!process.argv.includes('--no-build')) execSync('npx electron-vite build', { cwd: root, stdio: 'inherit' });
const userData = resolve(root, 'smoke', 'user-data');
rmSync(userData, { recursive: true, force: true });

const electron = resolve(root, 'node_modules', '.bin', 'electron');
const args = [root, '--no-sandbox', ...logs.flatMap((l) => ['--open', l]), '--screenshot', shot];
const useXvfb = !process.env.DISPLAY && process.platform === 'linux';
const cmd = useXvfb ? 'xvfb-run' : electron;
const cmdArgs = useXvfb ? ['-a', '-s', '-screen 0 1500x920x24', electron, ...args] : args;
console.log(`[smoke] ${cmd} ${cmdArgs.join(' ')}`);
const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', BROWNOUT_USER_DATA: userData } });
let output = '';
child.stdout.on('data', (d) => {
  output += d;
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  output += d;
  process.stderr.write(d);
});
const timer = setTimeout(() => {
  console.error('[smoke] timeout');
  child.kill('SIGKILL');
  process.exit(1);
}, 60000);
child.on('exit', (code) => {
  clearTimeout(timer);
  const rendererErrors = output
    .split('\n')
    .filter((l) => /Uncaught|TypeError|ReferenceError|Error: /.test(l) && !/DevTools|GPU|dbus|sandbox|libva|MESA|Fontconfig/i.test(l));
  if (!existsSync(shot)) {
    console.error('[smoke] no screenshot produced');
    process.exit(1);
  }
  if (rendererErrors.length) {
    console.error('[smoke] renderer errors:\n' + rendererErrors.join('\n'));
    process.exit(1);
  }
  console.log(`[smoke] ok (exit ${code}) → ${shot}`);
  process.exit(0);
});
