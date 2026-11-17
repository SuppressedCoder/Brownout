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
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, ClipboardItem, protocol } from 'electron';
import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const openAtStart: string[] = [];
let screenshotPath: string | null = null;
let presetAtStart: string | null = null;
let demoAtStart = false;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--open' && process.argv[i + 1]) openAtStart.push(resolve(process.argv[++i]));
  else if (process.argv[i] === '--screenshot' && process.argv[i + 1]) screenshotPath = resolve(process.argv[++i]);
  else if (process.argv[i] === '--preset' && process.argv[i + 1]) presetAtStart = process.argv[++i];
  else if (process.argv[i] === '--demo') demoAtStart = true;
  else if (process.argv[i].endsWith('.wpilog')) openAtStart.push(resolve(process.argv[i]));
}

if (process.env.BROWNOUT_USER_DATA) app.setPath('userData', process.env.BROWNOUT_USER_DATA);
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
let win: BrowserWindow | null = null;

async function loadFile(path: string) {
  const data = await readFile(path);
  if (!recent.includes(path)) recent.unshift(path);
  recent.splice(20);
  return { name: basename(path), path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
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
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else win.loadFile(join(__dirname, '../renderer/index.html'));

  win.webContents.on('did-finish-load', async () => {
    if (openAtStart.length) {
      const files = await Promise.all(openAtStart.map(loadFile));
      win?.webContents.send('open-files', files);
    }
    if (demoAtStart) send('demo');
  });
}

function send(command: string) {
  win?.webContents.send('command', command);
}

async function pickLogPaths(): Promise<string[]> {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Open WPILOG files',
    filters: [
      { name: 'WPILib data logs', extensions: ['wpilog'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
}

async function openLogDialog() {
  return Promise.all((await pickLogPaths()).map(loadFile));
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
        { label: 'Zoom to full log', click: action('zoomFull') },
        { label: 'Zoom to enabled', click: action('zoomEnabled') },
        { label: 'Zoom to auto', click: action('zoomAuto') },
        { label: 'Zoom to teleop', click: action('zoomTeleop') },
        { type: 'separator' },
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
      label: 'Help',
      submenu: [{ label: 'Shortcuts & tips', click: action('help') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-log-dialog', () => openLogDialog());
ipcMain.handle('read-file', (_e, path: string) => loadFile(path));
ipcMain.handle('get-recent', () => recent);
ipcMain.handle('pick-log-paths', () => pickLogPaths());
ipcMain.handle('startup-info', () => ({ cliFiles: openAtStart.length > 0 || demoAtStart }));
ipcMain.handle('open-demo-logs', async () => {
  // Demo logs ship in the renderer bundle (src/renderer/public/demo -> out/renderer/demo).
  const dir = join(__dirname, '../renderer/demo');
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.wpilog')).sort();
  return Promise.all(names.map((n) => loadFile(join(dir, n))));
});
ipcMain.handle('save-file', async (_e, defaultName: string, data: string | Uint8Array, filters?: { name: string; extensions: string[] }[]) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('open-json-dialog', async (_e, title: string) => {
  const r = await dialog.showOpenDialog(win!, { title, filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: basename(r.filePaths[0]), text: await readFile(r.filePaths[0], 'utf8') };
});
ipcMain.handle('pick-video', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Choose a match video',
    filters: [{ name: 'Video', extensions: Object.keys(VIDEO_MIME).map((e) => e.slice(1)) }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return registerVideo(r.filePaths[0]);
});
// Reopen a video remembered from an earlier session (video files only; null when it moved)
ipcMain.handle('open-video', async (_e, path: string) => (typeof path === 'string' ? registerVideo(path) : null));

// Match report: the page's HTML is printed to a PDF in a hidden window with scripting off
ipcMain.handle('export-report', async (_e, html: string, defaultName: string) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
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

ipcMain.handle('capture', async (_e, rect: { x: number; y: number; width: number; height: number }, mode: 'copy' | 'save', defaultName: string) => {
  if (!win) return null;
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
ipcMain.handle('import-field', async () => {
  const r = await dialog.showOpenDialog(win!, {
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
ipcMain.on('renderer-ready', async (_e, info: { logs: number; fields: number }) => {
  if (presetAtStart) send(`preset:${presetAtStart}`);
  if (!screenshotPath || !win) return;
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

app.whenReady().then(() => {
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

  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('open-file', (e, path) => {
  e.preventDefault();
  if (win) loadFile(path).then((f) => win?.webContents.send('open-files', [f]));
  else openAtStart.push(path);
});
