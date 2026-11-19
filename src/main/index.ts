/**
 * Electron main process: window, menu, dialogs, file access and IPC.
 * Keeps Electron's security defaults (context isolation on, sandbox on,
 * node integration off). The renderer only talks to main via the preload.
 *
 * CLI flags (used by `npm run smoke` and for opening logs from a shell):
 *   --open <file.wpilog> [--open <file2>]   open logs at startup
 *   --demo                                   open the bundled demo logs
 *   --preset <id>                            apply a workspace preset after opening (quick, power, autos, compare, code, replay)
 *   --screenshot <out.png>                   save a screenshot once the UI reports ready, then quit
 *
 * One app runs per data folder. Launching it again opens another window in
 * the running app (with any logs named on that command line); windows share
 * their logs and time through the 'sync' channel (renderer lib/windowSync.ts).
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, ClipboardItem, protocol } from 'electron';
import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
let screenshotPath: string | null = null;
let presetAtStart: string | null = null;
let demoAtStart = false;
/** The logs named on a command line: `--open <file>` or a bare `.wpilog` path, resolved against that launch's folder. */
function logsInArgs(argv: string[], cwd = process.cwd()): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--open' && argv[i + 1]) out.push(resolve(cwd, argv[++i]));
    else if (argv[i] === '--screenshot' || argv[i] === '--preset') i++;
    else if (argv[i].endsWith('.wpilog')) out.push(resolve(cwd, argv[i]));
  }
  return out;
}
const openAtStart = logsInArgs(process.argv);
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--screenshot' && process.argv[i + 1]) screenshotPath = resolve(process.argv[++i]);
  else if (process.argv[i] === '--preset' && process.argv[i + 1]) presetAtStart = process.argv[++i];
  else if (process.argv[i] === '--demo') demoAtStart = true;
}

if (process.env.BROWNOUT_USER_DATA) app.setPath('userData', process.env.BROWNOUT_USER_DATA);
// One app per data folder: two copies would fight over the saved settings and session (the second
// would start empty and save nothing). A second launch opens a window in this one instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv, cwd) => {
  if (app.isReady()) createWindow(logsInArgs(argv, cwd));
});
// Headless CI machines have no GPU; Chromium's GPU compositor can then fail to capture the page
// ("UnknownVizError"). Software rendering is slower but always works.
if (process.env.BROWNOUT_DISABLE_GPU) app.disableHardwareAcceleration();

// Match videos play through their own scheme so the page never gets general file access:
// the renderer only ever holds an opaque address for a file the user picked.
protocol.registerSchemesAsPrivileged([{ scheme: 'brownout-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
};
const media = new Map<string, string>();
async function registerVideo(path: string): Promise<{ path: string; name: string; url: string } | null> {
  const ext = extname(path).toLowerCase();
  if (!VIDEO_MIME[ext]) return null;
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return null;
  let token = [...media.entries()].find(([, p]) => p === path)?.[0];
  if (!token) media.set((token = randomUUID()), path);
  return { path, name: basename(path), url: `brownout-media://video/${token}${ext}` };
}

const recent: string[] = [];
/** Every log file this run has read for the page: the only folders whose videos may be listed for it. */
const readPaths = new Set<string>();
/** Every open window, in the order they opened. The first is the primary: only it saves the layout and the session. */
const windows: BrowserWindow[] = [];
/** The window a menu command or a file from the OS goes to. */
const activeWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? windows[0];
/** The window that sent an IPC request (dialogs open on top of it). */
const senderWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow => BrowserWindow.fromWebContents(e.sender) ?? windows[0];

async function loadFile(path: string) {
  const data = await readFile(path);
  readPaths.add(path);
  if (!recent.includes(path)) recent.unshift(path);
  recent.splice(20);
  return { name: basename(path), path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function createWindow(files: string[] = []) {
  const first = windows.length === 0;
  // a new window opens a little below and right of the one in front, so both show
  const prev = activeWindow()?.getBounds();
  const win = new BrowserWindow({
    width: prev?.width ?? 1500,
    height: prev?.height ?? 920,
    ...(prev ? { x: prev.x + 32, y: prev.y + 32 } : {}),
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#15171c',
    title: 'Brownout',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // playback runs in the window where Play was pressed and the other windows follow it, so it
      // must keep time while that window is minimized or hidden behind the others
      backgroundThrottling: false,
    },
  });
  const id = win.webContents.id;
  windows.push(win);
  win.once('ready-to-show', () => win.show());
  win.on('focus', buildMenu);
  win.on('page-title-updated', () => setTimeout(buildMenu));
  win.on('closed', () => {
    const wasPrimary = windows[0] === win;
    windows.splice(windows.indexOf(win), 1);
    if (wasPrimary) windows[0]?.webContents.send('window-primary');
    // playback ran in this window: stop it in the others, which only followed it
    const t = shared.time as { playing?: boolean } | undefined;
    if (timeFrom === id && t?.playing) {
      shared.time = { ...t, playing: false };
      for (const w of windows) w.webContents.send('sync', 'time', shared.time);
    }
    buildMenu();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else win.loadFile(join(__dirname, '../renderer/index.html'));

  win.webContents.on('did-finish-load', async () => {
    if (files.length) {
      const opened = await Promise.all(files.map(loadFile));
      win.webContents.send('open-files', opened);
    }
    if (first && demoAtStart) win.webContents.send('command', 'demo');
  });
  buildMenu();
}

function send(command: string) {
  activeWindow()?.webContents.send('command', command);
}

async function pickLogPaths(owner: BrowserWindow): Promise<string[]> {
  const r = await dialog.showOpenDialog(owner, {
    title: 'Open WPILOG files',
    filters: [
      { name: 'WPILib data logs', extensions: ['wpilog'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
}

async function openLogDialog(owner: BrowserWindow) {
  return Promise.all((await pickLogPaths(owner)).map(loadFile));
}

/**
 * The native menu. Keyboard shortcuts are NOT registered here: the renderer
 * owns them (Settings, Keybinds), so they can be changed and so single-key
 * shortcuts don't fire while typing in a text box.
 */
function buildMenu() {
  const action = (id: string) => () => send(`action:${id}`);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open logs…', click: action('open') },
        { label: 'Export CSV…', click: action('exportCsv') },
        { label: 'Copy panel as image', click: action('copyImage') },
        { label: 'Match report (PDF)…', click: action('matchReport') },
        { type: 'separator' },
        { label: 'Save layout as preset…', click: action('savePreset') },
        { label: 'Settings…', click: action('settings') },
        { type: 'separator' },
        { label: 'Close all logs', click: action('closeAll') },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom to the match', click: action('zoomMatch') },
        { label: 'Zoom to the whole log', click: action('zoomFull') },
        { label: 'Zoom to enabled', click: action('zoomEnabled') },
        { label: 'Zoom to auto', click: action('zoomAuto') },
        { label: 'Zoom to teleop', click: action('zoomTeleop') },
        { type: 'separator' },
        { label: 'Panels', click: action('viewPanels') },
        { label: 'Video review', click: action('viewVideo') },
        { label: 'Power', click: action('viewPower') },
        { type: 'separator' },
        { label: 'Maximize / restore the active panel', click: action('maximizePanel') },
        { label: 'Toggle sidebar', click: action('toggleSidebar') },
        { label: 'Cycle timeline height', click: action('cycleTimeline') },
        { label: 'Toggle Potato mode', click: action('potato') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Panels',
      submenu: [
        { label: 'Line graph', click: () => send('add-panel:graph') },
        { label: '2D field', click: () => send('add-panel:field') },
        { label: 'Table', click: () => send('add-panel:table') },
        { label: 'Console & events', click: () => send('add-panel:console') },
        { label: 'Statistics', click: () => send('add-panel:stats') },
        { label: 'Power report', click: () => send('add-panel:power') },
        { label: 'Path analysis', click: () => send('add-panel:paths') },
        { label: 'Compare matches', click: () => send('add-panel:compare') },
        { label: 'Swerve drive', click: () => send('add-panel:swerve') },
        { label: 'Controller', click: () => send('add-panel:controller') },
        { label: 'Commands', click: () => send('add-panel:commands') },
        { label: 'Video', click: () => send('add-panel:video') },
        { label: 'Log info & logging health', click: () => send('add-panel:info') },
      ],
    },
    {
      label: 'Robot',
      submenu: [
        { label: 'Power by subsystem', click: action('power') },
        { label: 'Robot profile…', click: action('robot') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'New window (same logs and time)', click: action('newWindow') },
        { type: 'separator' },
        ...windows.map((w, i): Electron.MenuItemConstructorOptions => ({
          label: `${i + 1}  ${w.getTitle()}`,
          type: 'checkbox',
          checked: w === BrowserWindow.getFocusedWindow(),
          click: () => {
            if (w.isMinimized()) w.restore();
            w.focus();
          },
        })),
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Shortcuts & tips', click: action('help') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-log-dialog', (e) => openLogDialog(senderWindow(e)));
ipcMain.handle('read-file', (_e, path: string) => loadFile(path));
ipcMain.handle('get-recent', () => recent);
ipcMain.handle('pick-log-paths', (e) => pickLogPaths(senderWindow(e)));
ipcMain.handle('startup-info', () => ({ cliFiles: openAtStart.length > 0 || demoAtStart }));
ipcMain.handle('open-demo-logs', async () => {
  // Demo logs ship in the renderer bundle (src/renderer/public/demo -> out/renderer/demo).
  const dir = join(__dirname, '../renderer/demo');
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.wpilog')).sort();
  return Promise.all(names.map((n) => loadFile(join(dir, n))));
});
ipcMain.handle('save-file', async (e, defaultName: string, data: string | Uint8Array, filters?: { name: string; extensions: string[] }[]) => {
  const r = await dialog.showSaveDialog(senderWindow(e), { defaultPath: defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('open-json-dialog', async (e, title: string) => {
  const r = await dialog.showOpenDialog(senderWindow(e), { title, filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: basename(r.filePaths[0]), text: await readFile(r.filePaths[0], 'utf8') };
});
ipcMain.handle('pick-video', async (e) => {
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: 'Choose a match video',
    filters: [{ name: 'Video', extensions: Object.keys(VIDEO_MIME).map((e) => e.slice(1)) }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return registerVideo(r.filePaths[0]);
});
// Reopen a video remembered from an earlier session (video files only; null when it moved)
ipcMain.handle('open-video', async (_e, path: string) => (typeof path === 'string' ? registerVideo(path) : null));

// Match videos the app may offer: video files next to a log the user opened, and in the one
// videos folder the user picked here. Only names and paths are listed; a file gets a playable
// address only when the user accepts it (open-video).
const videoFolderFile = () => join(app.getPath('userData'), 'video-folder.json');
async function getVideoFolder(): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(videoFolderFile(), 'utf8')) as { path?: unknown };
    return typeof j.path === 'string' ? j.path : null;
  } catch {
    return null;
  }
}
ipcMain.handle('get-video-folder', () => getVideoFolder());
ipcMain.handle('pick-video-folder', async (e) => {
  const r = await dialog.showOpenDialog(senderWindow(e), { title: 'Choose the folder where you keep match videos', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  await writeFile(videoFolderFile(), JSON.stringify({ path: r.filePaths[0] }));
  return r.filePaths[0];
});
ipcMain.handle('clear-video-folder', () => rm(videoFolderFile(), { force: true }));
ipcMain.handle('list-videos-near', async (_e, logPath: unknown) => {
  const dirs = new Set<string>();
  if (typeof logPath === 'string' && readPaths.has(logPath)) dirs.add(dirname(logPath));
  const folder = await getVideoFolder();
  if (folder) dirs.add(folder);
  const out: { name: string; path: string }[] = [];
  for (const d of dirs) {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile() || !VIDEO_MIME[extname(e.name).toLowerCase()]) continue;
      out.push({ name: e.name, path: join(d, e.name) });
      if (out.length >= 2000) return out;
    }
  }
  return out;
});

// Match report: the page's HTML is printed to a PDF in a hidden window with scripting off
ipcMain.handle('export-report', async (e, html: string, defaultName: string) => {
  const r = await dialog.showSaveDialog(senderWindow(e), { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
    const pdf = await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, preferCSSPageSize: true });
    await writeFile(r.filePath, pdf);
    return r.filePath;
  } finally {
    w.destroy();
  }
});

ipcMain.handle('capture', async (e, rect: { x: number; y: number; width: number; height: number }, mode: 'copy' | 'save', defaultName: string) => {
  const win = senderWindow(e);
  const img = await win.webContents.capturePage(rect);
  if (mode === 'copy') {
    const png = img.toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return 'clipboard';
  }
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, img.toPNG());
  return r.filePath;
});

// Custom field pictures: a WPILib / PathWeaver field JSON and the image it names, kept in userData/fields/<id>/.
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const fieldsDir = () => join(app.getPath('userData'), 'fields');
async function readCustomField(id: string) {
  const dir = join(fieldsDir(), id);
  const json = await readFile(join(dir, 'field.json'), 'utf8');
  const imageName = basename(String((JSON.parse(json) as Record<string, unknown>)['field-image'] ?? ''));
  const data = await readFile(join(dir, imageName));
  return {
    id,
    json,
    image: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    mime: IMAGE_MIME[extname(imageName).toLowerCase()] ?? 'image/png',
  };
}
ipcMain.handle('import-field', async (e) => {
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: 'Load a field picture (WPILib / PathWeaver field JSON)',
    filters: [{ name: 'Field JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const jsonPath = r.filePaths[0];
  const json = await readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const rel = parsed['field-image'];
  if (typeof rel !== 'string' || !rel) throw new Error('This JSON has no "field-image" entry.');
  const imagePath = resolve(dirname(jsonPath), rel);
  if (!IMAGE_MIME[extname(imagePath).toLowerCase()]) throw new Error('The field image must be a PNG, JPEG, WebP or GIF file.');
  const image = await readFile(imagePath);
  const id = `custom-${
    basename(jsonPath, '.json')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') || 'field'
  }`;
  const dir = join(fieldsDir(), id);
  await mkdir(dir, { recursive: true });
  // store the image next to the JSON under its bare file name
  await writeFile(join(dir, basename(imagePath)), image);
  await writeFile(join(dir, 'field.json'), JSON.stringify({ ...parsed, 'field-image': basename(imagePath) }, null, 1));
  return readCustomField(id);
});
ipcMain.handle('list-fields', async () => {
  const ids = await readdir(fieldsDir()).catch(() => [] as string[]);
  const out = [];
  for (const id of ids.sort()) {
    try {
      out.push(await readCustomField(id));
    } catch {
      /* skip a broken entry */
    }
  }
  return out;
});
ipcMain.handle('remove-field', async (_e, id: string) => {
  if (!/^custom-[a-z0-9-]+$/.test(id)) return;
  await rm(join(fieldsDir(), id), { recursive: true, force: true });
});
ipcMain.on('renderer-ready', async (e, info: { logs: number; fields: number }) => {
  const win = senderWindow(e);
  if (presetAtStart) win.webContents.send('command', `preset:${presetAtStart}`);
  presetAtStart = null;
  if (!screenshotPath) return;
  // Let canvases paint a couple of frames first.
  await new Promise((r) => setTimeout(r, 2000));
  // The compositor may not have a frame ready yet: try a few times, and never hang if it can't
  let png: Buffer | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 5 && !png; attempt++) {
    try {
      const img = await win.webContents.capturePage();
      if (!img.isEmpty()) png = img.toPNG();
      else lastError = 'empty image';
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (!png) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!png) {
    console.error(`[smoke] could not capture the window: ${lastError}. On a machine without a GPU, set BROWNOUT_DISABLE_GPU=1.`);
    app.exit(2);
    return;
  }
  await writeFile(screenshotPath, png);
  console.log(`[smoke] screenshot saved to ${screenshotPath} (${info.logs} logs, ${info.fields} fields)`);
  app.quit();
});

// Windows share their logs and time (renderer lib/windowSync.ts): each change goes to the other
// windows, and the latest of each kind is kept here for a window that opens later.
const shared: Record<string, unknown> = {};
/** The window that last sent the time: the one playing, while playback runs. */
let timeFrom = -1;
ipcMain.on('sync', (e, kind: unknown, data: unknown) => {
  if (kind !== 'session' && kind !== 'time') return;
  shared[kind] = data;
  if (kind === 'time') timeFrom = e.sender.id;
  for (const w of windows) if (w.webContents.id !== e.sender.id) w.webContents.send('sync', kind, data);
});
ipcMain.handle('window-info', (e) => ({ primary: windows[0]?.webContents.id === e.sender.id, shared }));
ipcMain.handle('new-window', () => {
  createWindow();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // Serve picked videos with byte ranges, which is what lets the player seek
  protocol.handle('brownout-media', async (req) => {
    const token = basename(new URL(req.url).pathname).replace(/\.[a-z0-9]+$/i, '');
    const path = media.get(token);
    const st = path ? await stat(path).catch(() => null) : null;
    if (!path || !st) return new Response('Not found', { status: 404 });
    const size = st.size;
    let start = 0;
    let end = size - 1;
    let status = 200;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      } else start = Math.max(0, size - Number(m[2]));
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      status = 206;
    }
    const headers: Record<string, string> = {
      'Content-Type': VIDEO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status, headers });
  });

  createWindow(openAtStart);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('open-file', (e, path) => {
  e.preventDefault();
  const win = activeWindow();
  if (win) loadFile(path).then((f) => win.webContents.send('open-files', [f]));
  else openAtStart.push(path);
});
