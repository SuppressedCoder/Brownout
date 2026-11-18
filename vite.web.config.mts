// Browser-only build of the renderer (no Electron). Open logs by drag-and-drop
// or the file picker. Used for quick smoke tests and as a fallback deployment.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@docs': resolve(import.meta.dirname, 'docs'),
    },
  },
  worker: { format: 'es' },
  build: { outDir: resolve(import.meta.dirname, 'out/web'), emptyOutDir: true },
  server: { port: 5180 },
});
