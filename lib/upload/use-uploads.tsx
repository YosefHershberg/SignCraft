'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SIMULATED_SIZES } from '@/lib/domain/constants';
import { formatBytes } from '@/lib/domain/format';
import type { AssetDTO } from '@/lib/domain/types';
import { estimate, planParts } from '@/lib/upload/plan';
import { fileSource, simulatedSource } from '@/lib/upload/part-source';
import { MultipartUploader, xhrPut, type UploaderApi } from '@/lib/upload/uploader';
import {
  useAbortAsset,
  useCompleteAsset,
  useCreateAsset,
  usePresignParts,
  useReportProgress,
} from '@/lib/query/hooks';

/** What the uploading tab knows and the server's coarse `progressPct` does not. */
export interface LocalProgress {
  bytesUploaded: number;
  pct: number;
  bytesPerSecond: number;
  etaMs: number;
  state: string;
}

export interface StartOptions {
  orderId: string;
  file?: File;
  simulatedBytes?: number;
}

interface UploadsValue {
  /** Resolves when the upload is fully done; rejects with the failure. */
  start(opts: StartOptions): Promise<void>;
  abort(assetId: string): void;
  /** Re-uploads the same bytes as a fresh asset (§7.6). False = source gone. */
  retry(asset: AssetDTO): Promise<boolean>;
  local: Record<string, LocalProgress>;
}

const UploadsContext = createContext<UploadsValue | null>(null);

/**
 * XHR progress events arrive far faster than anything worth re-rendering for
 * (four parallel parts, each firing per chunk), so the caption is refreshed on
 * a fixed cadence instead of per event. Coarser than the visible motion would
 * need, finer than the 2 s / 5 % the server is told about.
 */
const UI_INTERVAL_MS = 120;

function simulatedFileName(bytes: number): string {
  const known = SIMULATED_SIZES.find((size) => size.bytes === bytes);
  return `simulated-${(known?.label ?? formatBytes(bytes)).replace(/\s+/g, '').toLowerCase()}.bin`;
}

/**
 * Owns every in-flight `MultipartUploader`. It lives above the detail sheet on
 * purpose: uploaders are held in a ref keyed by assetId, so closing and
 * reopening the sheet (which unmounts the panel) never cancels an upload — the
 * rows just re-attach to the progress already being tracked here.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const create = useCreateAsset();
  const presign = usePresignParts();
  const progress = useReportProgress();
  const complete = useCompleteAsset();
  const abortAsset = useAbortAsset();

  const [local, setLocal] = useState<Record<string, LocalProgress>>({});
  const running = useRef(new Map<string, MultipartUploader>());
  /** Kept so Retry can re-upload the same File without a second file picker. */
  const sources = useRef(new Map<string, StartOptions>());
  const lastUiAt = useRef(new Map<string, number>());

  // Mutation objects are recreated every render; the callbacks below outlive
  // any single render, so they read the latest ones through a ref rather than
  // closing over a stale copy.
  const latest = useRef({ create, presign, progress, complete, abortAsset });
  useEffect(() => {
    latest.current = { create, presign, progress, complete, abortAsset };
  });

  const clearLocal = useCallback((assetId: string) => {
    lastUiAt.current.delete(assetId);
    setLocal((prev) => {
      if (!(assetId in prev)) return prev;
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
  }, []);

  const start = useCallback(
    async ({ orderId, file, simulatedBytes }: StartOptions) => {
      const sizeBytes = file ? file.size : (simulatedBytes ?? 0);
      const created = await latest.current.create.mutateAsync({
        orderId,
        fileName: file ? file.name : simulatedFileName(sizeBytes),
        contentType: file?.type || 'application/octet-stream',
        sizeBytes,
        simulated: !file,
      });

      const assetId = created.asset.id;
      sources.current.set(assetId, { orderId, file, simulatedBytes });

      const plan = planParts(sizeBytes, created.partSize);
      const startedAt = Date.now();
      setLocal((prev) => ({
        ...prev,
        [assetId]: { bytesUploaded: 0, pct: 0, bytesPerSecond: 0, etaMs: 0, state: 'running' },
      }));

      const api: UploaderApi = {
        presign: (id, partNumbers) =>
          latest.current.presign.mutateAsync({ assetId: id, partNumbers }).then((res) => res.urls),
        // Progress is advisory: the bytes are already in R2 either way, and a
        // report that loses a race with an abort must not fail the upload (or
        // surface as an unhandled rejection — the uploader fires these off
        // without awaiting them).
        progress: (id, bytesUploaded) =>
          latest.current.progress.mutateAsync({ assetId: id, bytesUploaded }).catch(() => undefined),
        complete: (id, parts) => latest.current.complete.mutateAsync({ assetId: id, parts }).then(() => undefined),
        abort: (id) => latest.current.abortAsset.mutateAsync({ assetId: id }).then(() => undefined),
      };

      // `MultipartUploader.start()` resolves on failure too (it routes the
      // error to `onError`), so the outcome is taken from the callbacks and
      // this promise is what `start()` actually awaits.
      let settle: (err?: Error) => void = () => {};
      const finished = new Promise<void>((resolve, reject) => {
        settle = (err) => (err ? reject(err) : resolve());
      });

      const uploader = new MultipartUploader({
        assetId,
        sizeBytes,
        plan,
        source: file ? fileSource(file, plan) : simulatedSource(plan),
        api,
        put: xhrPut,
        onProgress: ({ bytesUploaded, pct }) => {
          const now = Date.now();
          const previous = lastUiAt.current.get(assetId) ?? 0;
          if (now - previous < UI_INTERVAL_MS && pct < 100) return;
          lastUiAt.current.set(assetId, now);
          setLocal((prev) => ({
            ...prev,
            [assetId]: { bytesUploaded, pct, ...estimate(bytesUploaded, sizeBytes, startedAt, now), state: 'running' },
          }));
        },
        // The server's asset status (UPLOADED / ABORTED / FAILED, already in
        // the cache by now) is authoritative from here on, so the local row
        // drops out rather than competing with it.
        onDone: () => {
          clearLocal(assetId);
          settle();
        },
        onAborted: () => {
          clearLocal(assetId);
          settle();
        },
        onError: (err) => {
          clearLocal(assetId);
          settle(err);
        },
      });

      running.current.set(assetId, uploader);
      uploader.start().catch((err: unknown) => settle(err instanceof Error ? err : new Error(String(err))));

      try {
        await finished;
      } finally {
        running.current.delete(assetId);
      }
    },
    [clearLocal]
  );

  const abort = useCallback((assetId: string) => {
    const uploader = running.current.get(assetId);
    // No uploader here means another tab (or a previous page load) owns the
    // upload: the server transition is still this tab's to request.
    if (uploader) uploader.abort();
    else void latest.current.abortAsset.mutateAsync({ assetId }).catch(() => undefined);
  }, []);

  const retry = useCallback(
    async (asset: AssetDTO): Promise<boolean> => {
      const source = sources.current.get(asset.id);
      if (source?.file) {
        await start({ orderId: source.orderId, file: source.file });
        return true;
      }
      // A simulated asset carries everything needed to recreate it, so it
      // survives a reload; a real File does not.
      if (asset.simulated) {
        await start({ orderId: asset.orderId, simulatedBytes: asset.sizeBytes });
        return true;
      }
      return false;
    },
    [start]
  );

  const value = useMemo(() => ({ start, abort, retry, local }), [start, abort, retry, local]);

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsValue {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploads must be used within an UploadsProvider');
  return ctx;
}
