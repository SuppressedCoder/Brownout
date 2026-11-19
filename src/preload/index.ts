import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron';
import type { BrownoutApi, OpenedFile, CustomFieldFile, VideoFile } from './api';

const api: BrownoutApi = {
  platform: process.platform,
  version: process.env.npm_package_version ?? '',
  openLogDialog: () => ipcRenderer.invoke('open-log-dialog') as Promise<OpenedFile[]>,
  readFile: (path) => ipcRenderer.invoke('read-file', path) as Promise<OpenedFile>,
  saveFile: (defaultName, data, filters) => ipcRenderer.invoke('save-file', defaultName, data, filters) as Promise<string | null>,
  openJsonDialog: (title) => ipcRenderer.invoke('open-json-dialog', title) as Promise<{ name: string; text: string } | null>,
  onOpenFiles: (cb) => {
    const handler = (_e: unknown, files: OpenedFile[]) => cb(files);
    ipcRenderer.on('open-files', handler);
    return () => ipcRenderer.removeListener('open-files', handler);
  },
  onCommand: (cb) => {
    const handler = (_e: unknown, command: string) => cb(command);
    ipcRenderer.on('command', handler);
    return () => ipcRenderer.removeListener('command', handler);
  },
  notifyReady: (info) => ipcRenderer.send('renderer-ready', info),
  getRecent: () => ipcRenderer.invoke('get-recent') as Promise<string[]>,
  openDemoLogs: () => ipcRenderer.invoke('open-demo-logs') as Promise<OpenedFile[]>,
  pickLogPaths: () => ipcRenderer.invoke('pick-log-paths') as Promise<string[]>,
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  getStartupInfo: () => ipcRenderer.invoke('startup-info') as Promise<{ cliFiles: boolean }>,
  capture: (rect, mode, defaultName) => {
    // capturePage works in device-independent pixels of the window, which scale with the page zoom
    const z = webFrame.getZoomFactor();
    const r = { x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) };
    return ipcRenderer.invoke('capture', r, mode, defaultName) as Promise<string | null>;
  },
  importField: () => ipcRenderer.invoke('import-field') as Promise<CustomFieldFile | null>,
  listFields: () => ipcRenderer.invoke('list-fields') as Promise<CustomFieldFile[]>,
  removeField: (id) => ipcRenderer.invoke('remove-field', id) as Promise<void>,
  pickVideo: () => ipcRenderer.invoke('pick-video') as Promise<VideoFile | null>,
  openVideo: (path) => ipcRenderer.invoke('open-video', path) as Promise<VideoFile | null>,
  listVideosNear: (logPath) => ipcRenderer.invoke('list-videos-near', logPath) as Promise<{ name: string; path: string }[]>,
  getVideoFolder: () => ipcRenderer.invoke('get-video-folder') as Promise<string | null>,
  pickVideoFolder: () => ipcRenderer.invoke('pick-video-folder') as Promise<string | null>,
  clearVideoFolder: () => ipcRenderer.invoke('clear-video-folder') as Promise<void>,
  exportReport: (html, defaultName) => ipcRenderer.invoke('export-report', html, defaultName) as Promise<string | null>,
  windowInfo: () => ipcRenderer.invoke('window-info') as Promise<{ primary: boolean; shared: { session?: unknown; time?: unknown } }>,
  syncSend: (kind, data) => ipcRenderer.send('sync', kind, data),
  onSync: (cb) => {
    const handler = (_e: unknown, kind: 'session' | 'time', data: unknown) => cb(kind, data);
    ipcRenderer.on('sync', handler);
    return () => ipcRenderer.removeListener('sync', handler);
  },
  onPrimary: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('window-primary', handler);
    return () => ipcRenderer.removeListener('window-primary', handler);
  },
  newWindow: () => ipcRenderer.invoke('new-window') as Promise<void>,
};

contextBridge.exposeInMainWorld('brownout', api);
