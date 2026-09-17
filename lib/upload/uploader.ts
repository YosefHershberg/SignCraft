// Pipeline 3 (direct-to-cloud upload), step 3: drives the actual transfer.
// Bytes go straight from the browser to R2 over presigned URLs (Invariant 5);
// this class only ever talks to the app for presign/progress/complete/abort.
import { MAX_PARALLEL_PARTS, MAX_PART_RETRIES, PRESIGN_BATCH } from '@/lib/domain/constants';
import { estimate, partRange, shouldReportProgress, type UploadPlan } from '@/lib/upload/plan';
import type { PartSource } from '@/lib/upload/part-source';

/**
 * The four server calls an upload makes, over the lifetime of one asset.
 * Injected into `MultipartUploader` so unit tests supply a fake instead of a
 * real fetch; the real implementation is `uploadWireApi()` in
 * `lib/query/hooks.ts`, pinned to the persona that started the upload.
 */
export interface UploaderApi {
  presign(assetId: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]>;
  progress(assetId: string, bytesUploaded: number): Promise<void>;
  complete(assetId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abort(assetId: string): Promise<void>;
}

/**
 * The transport that actually PUTs one part's bytes. Injected so tests can
 * fake it; `xhrPut` below is the real one used in the browser.
 */
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
  /** Concurrent part uploads; defaults to `MAX_PARALLEL_PARTS`. */
  parallel?: number;
  /** Part numbers presigned per `api.presign` call; defaults to `PRESIGN_BATCH`. */
  batch?: number;
  /** Retries per part before the whole upload fails; defaults to `MAX_PART_RETRIES`. */
  maxRetries?: number;
  /** Clock, injected for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
  /** Backoff delay, injected so tests don't actually wait; defaults to a real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: { bytesUploaded: number; pct: number; bytesPerSecond: number; etaMs: number }) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  onAborted?: () => void;
}

/** The uploader's own lifecycle, independent of the asset's server-side status (which lags behind by however long `reportProgress`'s throttle allows). */
export type UploaderState = 'idle' | 'running' | 'done' | 'failed' | 'aborted';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives one asset's multipart upload end to end (architecture spec §9,
 * pipeline 3 steps 3-6). Algorithm: part numbers are consumed in batches of
 * `batch` (`PRESIGN_BATCH`) — each batch is presigned in one `api.presign`
 * call, then handed to `runBatch`, which starts `parallel` (`MAX_PARALLEL_PARTS`)
 * `worker`s pulling from a shared cursor so no part is claimed twice. Each
 * worker calls `uploadPart`, which PUTs via the injected `put` (retrying with
 * backoff) and records the resulting ETag. Progress from every in-flight and
 * completed part fans out through `reportProgress` to both the UI callback
 * (every call) and the server (throttled by `shouldReportProgress`). Once
 * every part has an ETag, `start()` reports 100% and calls `api.complete`.
 */
export class MultipartUploader {
  private readonly parallel: number;
  private readonly batch: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Bytes of each part that has finished PUTting, keyed by part number. */
  private readonly completedBytes = new Map<number, number>();
  /** Bytes reported by the browser's upload-progress event for parts still in flight, keyed by part number; cleared once the part completes. */
  private readonly inFlightBytes = new Map<number, number>();
  /** The R2 ETag returned for each completed part, in the shape `api.complete` needs (sorted by part number at send time). */
  private readonly etags = new Map<number, string>();
  /** Presigned PUT URL for each part, filled in by the last `api.presign` call and consumed by `uploadPart`. */
  private readonly urls = new Map<number, string>();
  /** The in-flight `AbortController` for each part currently PUTting, so `abort()` can cancel every open request at once. */
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

  /**
   * Tears the in-flight parts down and tells the server. The parts stop
   * synchronously; the returned promise is the *server* call, so a caller that
   * awaits it learns whether the abort was actually recorded. Ignoring it is
   * safe — the rejection is handled either way — but then the tab has only
   * promised itself the upload is over.
   */
  abort(): Promise<void> {
    if (this._state !== 'running') return Promise.resolve();
    this.aborting = true;
    for (const controller of this.controllers.values()) controller.abort();
    this._state = 'aborted';
    const told = this.opts.api.abort(this.opts.assetId);
    // Attached here so an un-awaited abort() can never surface as an unhandled
    // rejection; `told` itself still carries the failure to whoever awaits it.
    told.catch(() => {});
    this.opts.onAborted?.();
    return told;
  }

  async start(): Promise<void> {
    this._state = 'running';
    this.startedAt = this.now();
    this.lastReported = { at: this.startedAt, pct: 0 };

    const partNumbers = Array.from({ length: this.opts.plan.partCount }, (_, i) => i + 1);
    let completed = false;

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

      if (this.aborting) return;

      // Completion (final progress report + complete) is part of the same
      // failure domain as the upload itself: a rejection here must still
      // land in the failed/onError/api.abort path below, not escape as an
      // unhandled rejection with `state` stuck at 'running'. `abort()` can
      // still land while either of these is in flight, so re-check after
      // each await rather than assuming nothing changed underneath us.
      await this.opts.api.progress(this.opts.assetId, this.opts.sizeBytes);
      if (this.aborting) return;
      const parts = Array.from(this.etags.entries())
        .sort(([a], [b]) => a - b)
        .map(([partNumber, etag]) => ({ partNumber, etag }));
      await this.opts.api.complete(this.opts.assetId, parts);
      if (this.aborting) return;
      completed = true;
    } catch (err) {
      if (this.aborting) return;
      this._state = 'failed';
      await this.opts.api.abort(this.opts.assetId).catch(() => {});
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Deliberately outside the try/catch above: a throwing `onDone` must not
    // be mistaken for an upload failure (it would otherwise flip a finished
    // upload to 'failed' and call `api.abort` on work that already
    // succeeded). `state` is set to 'done' before `onDone` runs, so that is
    // true regardless of whether `onDone` throws; the throw itself is left
    // to propagate out of `start()` rather than being swallowed.
    if (completed) {
      this._state = 'done';
      this.opts.onDone?.();
    }
  }

  /** Runs `parallel` `worker`s over one presigned batch of part numbers and waits for all of them to drain the shared cursor. */
  private async runBatch(partNumbers: number[]): Promise<void> {
    let cursor = 0;
    const next = () => cursor++;
    const workerCount = Math.min(this.parallel, partNumbers.length);
    const workers = Array.from({ length: workerCount }, () => this.worker(partNumbers, next));
    await Promise.all(workers);
  }

  /** One of `parallel` concurrent loops: claims the next part index from the shared cursor and uploads it until the batch is drained or an abort lands. */
  private async worker(partNumbers: number[], next: () => number): Promise<void> {
    while (!this.aborting) {
      const idx = next();
      if (idx >= partNumbers.length) return;
      await this.uploadPart(partNumbers[idx]);
    }
  }

  /** PUTs one part via `put`, retrying up to `maxRetries` times with `500 * 2^attempt` ms backoff before letting the error propagate and fail the whole upload. */
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
        if (this.aborting) return;
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

  /** Sum of `completedBytes` and `inFlightBytes` — the whole-upload byte count driving both the local percentage and what gets reported to the server. */
  private totalUploaded(): number {
    let total = 0;
    for (const v of this.completedBytes.values()) total += v;
    for (const v of this.inFlightBytes.values()) total += v;
    return total;
  }

  /**
   * Fans progress out to both consumers: `onProgress` runs on every call (the
   * UI throttles further on its own — see `UI_INTERVAL_MS` in
   * `use-uploads.tsx`), while the server write behind `api.progress` is
   * itself throttled by `shouldReportProgress` so a fast upload doesn't turn
   * into a write per chunk.
   */
  private reportProgress(): void {
    const bytesUploaded = this.totalUploaded();
    const pct = this.opts.sizeBytes > 0 ? Math.min(100, (bytesUploaded / this.opts.sizeBytes) * 100) : 100;
    const now = this.now();
    const { bytesPerSecond, etaMs } = estimate(bytesUploaded, this.opts.sizeBytes, this.startedAt, now);

    this.opts.onProgress?.({ bytesUploaded, pct, bytesPerSecond, etaMs });

    if (shouldReportProgress(this.lastReported, now, pct)) {
      this.lastReported = { at: now, pct };
      void this.opts.api.progress(this.opts.assetId, bytesUploaded);
    }
  }
}

/**
 * The real `PutPart`: `XMLHttpRequest` rather than `fetch`, chosen solely
 * because only XHR exposes byte-level `upload.onprogress` events, which is
 * what feeds the estimator in `plan.ts` and the per-row progress bars.
 * Reading the `ETag` response header requires the R2 bucket's CORS rule to
 * include `ExposeHeaders: ["ETag"]` (see the README) — without it this
 * resolves with an empty etag and `completeMultipart` on the server rejects
 * the upload.
 */
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
