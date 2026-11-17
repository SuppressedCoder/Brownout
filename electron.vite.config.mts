import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
};

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: { alias },
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') } },
  },
});
