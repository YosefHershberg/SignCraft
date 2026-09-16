import { MAX_PARALLEL_PARTS, MAX_PART_RETRIES, PRESIGN_BATCH } from '@/lib/domain/constants';
import { partRange, shouldReportProgress, type UploadPlan } from '@/lib/upload/plan';
import type { PartSource } from '@/lib/upload/part-source';

export interface UploaderApi {
  presign(assetId: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]>;
  progress(assetId: string, bytesUploaded: number): Promise<void>;
  complete(assetId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abort(assetId: string): Promise<void>;
}

export interface PutPart {
  (url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ etag: string }>;
}

export interface UploaderOptions {
  assetId: string;
  sizeBytes: number;
  plan: UploadPlan;
  source: PartSource;
  api: UploaderApi;
  put: PutPart;
  parallel?: number;
  batch?: number;
  maxRetries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: { bytesUploaded: number; pct: number; bytesPerSecond: number; etaMs: number }) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  onAborted?: () => void;
}

export type UploaderState = 'idle' | 'running' | 'done' | 'failed' | 'aborted';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MultipartUploader {
  private readonly parallel: number;
  private readonly batch: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly completedBytes = new Map<number, number>();
  private readonly inFlightBytes = new Map<number, number>();
  private readonly etags = new Map<number, string>();
  private readonly urls = new Map<number, string>();
  private readonly controllers = new Map<number, AbortController>();

  private lastReported = { at: 0, pct: 0 };
  private startedAt = 0;
  private aborting = false;
  private _state: UploaderState = 'idle';

  constructor(private readonly opts: UploaderOptions) {
    this.parallel = opts.parallel ?? MAX_PARALLEL_PARTS;
    this.batch = opts.batch ?? PRESIGN_BATCH;
    this.maxRetries = opts.maxRetries ?? MAX_PART_RETRIES;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get state(): UploaderState {
    return this._state;
  }

  abort(): void {
    if (this._state !== 'running') return;
    this.aborting = true;
    for (const controller of this.controllers.values()) controller.abort();
    this._state = 'aborted';
    void this.opts.api.abort(this.opts.assetId);
    this.opts.onAborted?.();
  }

  async start(): Promise<void> {
    this._state = 'running';
    this.startedAt = this.now();
    this.lastReported = { at: this.startedAt, pct: 0 };

    const partNumbers = Array.from({ length: this.opts.plan.partCount }, (_, i) => i + 1);

    try {
      for (let i = 0; i < partNumbers.length; i += this.batch) {
        if (this.aborting) return;
        const batchNumbers = partNumbers.slice(i, i + this.batch);
        const presigned = await this.opts.api.presign(this.opts.assetId, batchNumbers);
        for (const p of presigned) this.urls.set(p.partNumber, p.url);
        if (this.aborting) return;
        await this.runBatch(batchNumbers);
        if (this.aborting) return;
      }
    } catch (err) {
      if (this.aborting) return;
      this._state = 'failed';
      await this.opts.api.abort(this.opts.assetId).catch(() => {});
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (this.aborting) return;

    await this.opts.api.progress(this.opts.assetId, this.opts.sizeBytes);
    const parts = Array.from(this.etags.entries())
      .sort(([a], [b]) => a - b)
      .map(([partNumber, etag]) => ({ partNumber, etag }));
    await this.opts.api.complete(this.opts.assetId, parts);
    this._state = 'done';
    this.opts.onDone?.();
  }

  private async runBatch(partNumbers: number[]): Promise<void> {
    let cursor = 0;
    const next = () => cursor++;
    const workerCount = Math.min(this.parallel, partNumbers.length);
    const workers = Array.from({ length: workerCount }, () => this.worker(partNumbers, next));
    await Promise.all(workers);
  }

  private async worker(partNumbers: number[], next: () => number): Promise<void> {
    while (!this.aborting) {
      const idx = next();
      if (idx >= partNumbers.length) return;
      await this.uploadPart(partNumbers[idx]);
    }
  }

  private async uploadPart(partNumber: number): Promise<void> {
    const url = this.urls.get(partNumber);
    if (!url) throw new Error(`missing presigned url for part ${partNumber}`);
    const { size } = partRange(this.opts.plan, partNumber);
    const blob = this.opts.source(partNumber);

    let attempt = 0;
    for (;;) {
      if (this.aborting) return;
      const controller = new AbortController();
      this.controllers.set(partNumber, controller);
      try {
        const { etag } = await this.opts.put(
          url,
          blob,
          (loaded) => {
            this.inFlightBytes.set(partNumber, loaded);
            this.reportProgress();
          },
          controller.signal
        );
        this.controllers.delete(partNumber);
        this.inFlightBytes.delete(partNumber);
        this.completedBytes.set(partNumber, size);
        this.etags.set(partNumber, etag);
        this.reportProgress();
        return;
      } catch (err) {
        this.controllers.delete(partNumber);
        if (this.aborting) return;
        if (attempt >= this.maxRetries) throw err;
        attempt++;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }

  private totalUploaded(): number {
    let total = 0;
    for (const v of this.completedBytes.values()) total += v;
    for (const v of this.inFlightBytes.values()) total += v;
    return total;
  }

  private reportProgress(): void {
    const bytesUploaded = this.totalUploaded();
    const pct = this.opts.sizeBytes > 0 ? Math.min(100, (bytesUploaded / this.opts.sizeBytes) * 100) : 100;
    const now = this.now();
    const elapsedMs = now - this.startedAt;
    const bytesPerSecond = elapsedMs > 0 ? (bytesUploaded / elapsedMs) * 1000 : 0;
    const remaining = this.opts.sizeBytes - bytesUploaded;
    const etaMs = bytesPerSecond > 0 ? (remaining / bytesPerSecond) * 1000 : 0;

    this.opts.onProgress?.({ bytesUploaded, pct, bytesPerSecond, etaMs });

    if (shouldReportProgress(this.lastReported, now, pct)) {
      this.lastReported = { at: now, pct };
      void this.opts.api.progress(this.opts.assetId, bytesUploaded);
    }
  }
}

export const xhrPut: PutPart = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = (xhr.getResponseHeader('ETag') ?? '').replace(/"/g, '');
        resolve({ etag });
      } else {
        reject(new Error(`upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.onabort = () => reject(new Error('upload aborted'));
    signal.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
