/**
 * Renderer-side client for the log worker, with a series cache. Panels call
 * `peekSeries` synchronously while drawing and get notified (via subscribe)
 * when a requested series arrives.
 */
import type { PoseFinding } from '@core/analyzers/poseDeviations';
import type { Series, FieldInfo } from '@core/log';
import type { SubsystemDef, SubsystemReport } from '@core/analyzers/subsystems';
import type { CameraDef, CameraSummary } from '@core/vision';
import type { Role } from '@core/roles';
import type { WorkerRequest, WorkerResponse, LogSummary, LoadStage } from './protocol';

type Listener = () => void;

class WorkerClient {
  private worker: Worker;
  private cache = new Map<string, Series | null>();
  private pending = new Map<string, Promise<Series | null>>();
  private resolvers = new Map<string, (s: Series | null) => void>();
  private openResolvers = new Map<string, { resolve: (s: LogSummary) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private subResolvers = new Map<number, (r: { report: SubsystemReport | null; fields?: FieldInfo[] }) => void>();
  private subSeq = 1;
  private camResolvers = new Map<number, (r: { summaries: CameraSummary[] | null; fields?: FieldInfo[]; findings?: PoseFinding[] }) => void>();
  /** Called with load progress for a log being opened. */
  onProgress: ((id: string, stage: LoadStage, fraction: number) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./logWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handle(ev.data);
    this.worker.onerror = (e) => console.error('log worker error', e);
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case 'opened':
      case 'reanalyzed': {
        const r = this.openResolvers.get(msg.summary.id);
        this.openResolvers.delete(msg.summary.id);
        r?.resolve(msg.summary);
        break;
      }
      case 'subsystems': {
        const r = this.subResolvers.get(msg.seq);
        this.subResolvers.delete(msg.seq);
        r?.({ report: msg.report, fields: msg.fields });
        if (msg.fields) this.notify();
        break;
      }
      case 'cameras': {
        const r = this.camResolvers.get(msg.seq);
        this.camResolvers.delete(msg.seq);
        r?.({ summaries: msg.summaries, fields: msg.fields, findings: msg.findings });
        if (msg.fields) this.notify();
        break;
      }
      case 'progress':
        this.onProgress?.(msg.id, msg.stage, msg.fraction);
        break;
      case 'series': {
        const k = `${msg.id}\u0000${msg.key}`;
        this.cache.set(k, msg.series);
        this.pending.delete(k);
        this.resolvers.get(k)?.(msg.series);
        this.resolvers.delete(k);
        this.notify();
        break;
      }
      case 'error': {
        if (msg.id) {
          const r = this.openResolvers.get(msg.id);
          this.openResolvers.delete(msg.id);
          r?.reject(new Error(msg.message));
        }
        console.error('worker:', msg.message);
      }
    }
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  open(id: string, name: string, buffer: ArrayBuffer, path?: string, roleOverrides?: Partial<Record<Role, string>>): Promise<LogSummary> {
    return new Promise((resolve, reject) => {
      this.openResolvers.set(id, { resolve, reject });
      const req: WorkerRequest = { type: 'open', id, name, path, buffer, roleOverrides };
      this.worker.postMessage(req, [buffer]);
    });
  }

  reanalyze(id: string, roleOverrides: Partial<Record<Role, string>>, brownoutThreshold: number): Promise<LogSummary> {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}\u0000/Brownout/`)) this.cache.delete(k);
    return new Promise((resolve, reject) => {
      this.openResolvers.set(id, { resolve, reject });
      const req: WorkerRequest = { type: 'reanalyze', id, roleOverrides, brownoutThreshold };
      this.worker.postMessage(req);
    });
  }

  /**
   * Power by subsystem for one log. A whole-log request (`updateDerived`) also
   * rebuilds the /Brownout/Subsystems/... current fields and returns the new field list.
   */
  subsystems(
    id: string,
    defs: SubsystemDef[],
    range: [number, number] | undefined,
    updateDerived: boolean,
  ): Promise<{ report: SubsystemReport | null; fields?: FieldInfo[] }> {
    if (updateDerived) for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}\u0000/Brownout/Subsystems/`)) this.cache.delete(k);
    return new Promise((resolve) => {
      const seq = this.subSeq++;
      this.subResolvers.set(seq, resolve);
      const req: WorkerRequest = { type: 'subsystems', id, seq, defs, range, updateDerived };
      this.worker.postMessage(req);
    });
  }

  /** Rebuild the /Brownout/Vision/... fields for a log's cameras; returns how well each camera saw the field. */
  cameras(id: string, cameras: CameraDef[]): Promise<{ summaries: CameraSummary[] | null; fields?: FieldInfo[]; findings?: PoseFinding[] }> {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}\u0000/Brownout/Vision/`)) this.cache.delete(k);
    return new Promise((resolve) => {
      const seq = this.subSeq++;
      this.camResolvers.set(seq, resolve);
      const req: WorkerRequest = { type: 'cameras', id, seq, cameras };
      this.worker.postMessage(req);
    });
  }

  close(id: string) {
    const req: WorkerRequest = { type: 'close', id };
    this.worker.postMessage(req);
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}\u0000`)) this.cache.delete(k);
  }

  /** Cached series, or undefined if not yet loaded (and requests it). null = field doesn't exist. */
  peekSeries(logId: string, key: string): Series | null | undefined {
    const k = `${logId}\u0000${key}`;
    if (this.cache.has(k)) return this.cache.get(k);
    void this.getSeries(logId, key);
    return undefined;
  }

  getSeries(logId: string, key: string): Promise<Series | null> {
    const k = `${logId}\u0000${key}`;
    if (this.cache.has(k)) return Promise.resolve(this.cache.get(k) ?? null);
    const p = this.pending.get(k);
    if (p) return p;
    const np = new Promise<Series | null>((resolve) => {
      this.resolvers.set(k, resolve);
      const req: WorkerRequest = { type: 'series', id: logId, key };
      this.worker.postMessage(req);
    });
    this.pending.set(k, np);
    return np;
  }
}

export const client = new WorkerClient();
