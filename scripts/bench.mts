/**
 * Benchmark the reader: index + robot state + power analysis for every log
 * in fixtures/demo and fixtures/local (put large real logs there; git-ignored).
 * Reports MB/s and the time a 100 MB log would take against the 3 s budget.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LogData } from '../src/core/log.ts';
import { computeRobotState } from '../src/core/robotState.ts';
import { analyzePower } from '../src/core/analyzers/power.ts';

const root = resolve(import.meta.dirname, '..');
const dirs = ['fixtures/demo', 'fixtures/local'].map((d) => resolve(root, d)).filter(existsSync);
const files = dirs.flatMap((d) =>
  readdirSync(d)
    .filter((f) => f.endsWith('.wpilog'))
    .map((f) => resolve(d, f)),
);
if (!files.length) {
  console.log('No fixtures. Run `npm run make-demo` first.');
  process.exit(1);
}
let worst = 0;
for (const f of files) {
  const bytes = readFileSync(f);
  const t0 = performance.now();
  const log = new LogData(bytes);
  const t1 = performance.now();
  const rs = computeRobotState(log);
  analyzePower(log, rs.ranges);
  const t2 = performance.now();
  const mb = bytes.length / 1e6;
  const per100 = ((t2 - t0) / mb) * 100;
  worst = Math.max(worst, per100);
  console.log(
    `${f.split('/').pop()}  ${mb.toFixed(1)} MB  ${log.reader.index.recordCount.toLocaleString()} records  index ${(t1 - t0).toFixed(0)} ms  analyze ${(t2 - t1).toFixed(0)} ms  → ${(mb / ((t2 - t0) / 1000)).toFixed(0)} MB/s (${(per100 / 1000).toFixed(2)} s per 100 MB)`,
  );
}
const budget = 3000;
console.log(
  worst <= budget
    ? `OK: worst case ${(worst / 1000).toFixed(2)} s per 100 MB (budget ${budget / 1000} s)`
    : `OVER BUDGET: ${(worst / 1000).toFixed(2)} s per 100 MB`,
);
process.exit(worst <= budget ? 0 : 1);
