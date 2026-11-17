import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@core': resolve(import.meta.dirname, 'src/core') } },
  test: { include: ['src/core/**/*.test.ts', 'tests/**/*.test.ts'] },
});
