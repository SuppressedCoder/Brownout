/** The typed bridge the renderer sees as `window.brownout` (undefined in the browser build). */
export interface OpenedFile {
  name: string;
  path: string;
  data: ArrayBuffer;
}

export interface BrownoutApi {
  platform: string;
  version: string;
  /** Show the open dialog; returns the chosen files' bytes. */
  openLogDialog(): Promise<OpenedFile[]>;
  readFile(path: string): Promise<OpenedFile>;
  /** Save text or bytes through a save dialog. Returns the path or null if cancelled. */
  saveFile(defaultName: string, data: string | Uint8Array, filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  /** Open a JSON file (layout / preset / field JSON) through a dialog. */
  openJsonDialog(title: string): Promise<{ name: string; text: string } | null>;
  /** Files handed to the app by the menu, CLI (`--open`), or OS file association. */
  onOpenFiles(cb: (files: OpenedFile[]) => void): () => void;
  /** Commands from the native menu / command line: 'action:<id>', 'preset:<id>', 'add-panel:<type>', 'demo'. */
  onCommand(cb: (command: string) => void): () => void;
  /** Smoke test: tells main the UI finished loading its first logs. */
  notifyReady(info: { logs: number; fields: number }): void;
  getRecent(): Promise<string[]>;
  /** The bundled demo logs (read from the app package). */
  openDemoLogs(): Promise<OpenedFile[]>;
  /** Show the open dialog and return the chosen paths only; read each with readFile (lets the UI show progress). */
  pickLogPaths(): Promise<string[]>;
  /** Filesystem path of a dropped File, or '' when it has none. */
  pathForFile(file: File): string;
  /** Whether logs were passed on the command line (then the last session is not reopened). */
  getStartupInfo(): Promise<{ cliFiles: boolean }>;
  /** Screenshot a rectangle of the window (CSS pixels). 'copy' puts it on the clipboard; 'save' asks where to write a PNG. Returns 'clipboard', the saved path, or null if cancelled. */
  capture(rect: { x: number; y: number; width: number; height: number }, mode: 'copy' | 'save', defaultName: string): Promise<string | null>;
  /** Pick a WPILib / PathWeaver field JSON; it and its image are copied into the app's data folder. Null if cancelled. */
  importField(): Promise<CustomFieldFile | null>;
  /** Custom fields imported earlier. */
  listFields(): Promise<CustomFieldFile[]>;
  removeField(id: string): Promise<void>;
  /** Pick a video file. Returns an address the page can play, the file's name and its path (to remember it). Null if cancelled. */
  pickVideo(): Promise<VideoFile | null>;
  /** Reopen a remembered video by path. Null when the file is gone or is not a video. */
  openVideo(path: string): Promise<VideoFile | null>;
  /** Video files that could be this log's match video: next to the log (if this run opened it) and in the videos folder. Names and paths only. */
  listVideosNear(logPath: string | undefined): Promise<{ name: string; path: string }[]>;
  /** The folder the user keeps match videos in, if set. */
  getVideoFolder(): Promise<string | null>;
  /** Choose the videos folder through a dialog. Null if cancelled. */
  pickVideoFolder(): Promise<string | null>;
  clearVideoFolder(): Promise<void>;
  /** Print report HTML to a PDF through a save dialog. Returns the saved path, or null if cancelled. */
  exportReport(html: string, defaultName: string): Promise<string | null>;
}

export interface CustomFieldFile {
  id: string;
  json: string;
  image: ArrayBuffer;
  mime: string;
}

declare global {
  interface Window {
    brownout?: BrownoutApi;
  }
}

export interface VideoFile {
  path: string;
  name: string;
  url: string;
}
