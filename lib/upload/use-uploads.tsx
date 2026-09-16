'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SIMULATED_SIZES } from '@/lib/domain/constants';
import { formatBytes } from '@/lib/domain/format';
import type { AssetDTO } from '@/lib/domain/types';
import { usePersona } from '@/lib/persona/persona-context';
import { useCreateAsset, uploadWireApi } from '@/lib/query/hooks';
import { planParts } from '@/lib/upload/plan';
import { fileSource, simulatedSource } from '@/lib/upload/part-source';
import { MultipartUploader, xhrPut, type UploaderApi } from '@/lib/upload/uploader';

/** What the uploading tab knows and the server's coarse `progressPct` does not. */
export interface LocalProgress {
  bytesUploaded: number;
  pct: number;
  bytesPerSecond: number;
  etaMs: number;
}

export interface StartOptions {
  orderId: string;
  file?: File;
  simulatedBytes?: number;
}

interface UploadsValue {
  /** Resolves when the upload is fully done; rejects with the failure. */
  start(opts: StartOptions): Promise<void>;
  /** Resolves once the server has been told; rejects if that call failed. */
  abort(assetId: string): Promise<void>;
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
  const queryClient = useQueryClient();
  const create = useCreateAsset();
  const { persona } = usePersona();

  const [local, setLocal] = useState<Record<string, LocalProgress>>({});
  const running = useRef(new Map<string, MultipartUploader>());
  /** Kept so Retry can re-upload the same File without a second file picker. */
  const sources = useRef(new Map<string, StartOptions>());
  const lastUiAt = useRef(new Map<string, number>());
  /**
   * Assets the user pressed ✕ on. The uploader calls `api.abort` from two
   * places — the user's `abort()` and its own give-up path — and only the
   * reason tells the server whether this ends ABORTED or FAILED.
   */
  const userAborts = useRef(new Set<string>());

  // `create` is a fresh mutation object every render while the callbacks below
  // outlive any single render, so it is read through a ref rather than closed
  // over. `persona` is read the same way but used differently: `start()` takes
  // a copy of it and the whole upload keeps using that copy.
  const createRef = useRef(create);
  const personaRef = useRef(persona);
  useEffect(() => {
    createRef.current = create;
    personaRef.current = persona;
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
      // Pinned for the whole upload: switching persona mid-flight (§7.8) must
      // not make the next presign 403 as somebody who cannot upload.
      const wire = uploadWireApi(personaRef.current, queryClient);

      const created = await createRef.current.mutateAsync({
        orderId,
        fileName: file ? file.name : simulatedFileName(sizeBytes),
        contentType: file?.type || 'application/octet-stream',
        sizeBytes,
        simulated: !file,
      });

      const assetId = created.asset.id;
      sources.current.set(assetId, { orderId, file, simulatedBytes });

      const plan = planParts(sizeBytes, created.partSize);
      setLocal((prev) => ({ ...prev, [assetId]: { bytesUploaded: 0, pct: 0, bytesPerSecond: 0, etaMs: 0 } }));

      const api: UploaderApi = {
        presign: wire.presign,
        // Progress is advisory: the bytes are already in R2 either way, and a
        // report that loses a race with an abort must not fail the upload (or
        // surface as an unhandled rejection — the uploader fires these off
        // without awaiting them).
        progress: (id, bytesUploaded) => wire.progress(id, bytesUploaded).catch(() => undefined),
        complete: wire.complete,
        // Reached either from `abort()` below or from the uploader giving up
        // after its part retries; `Set.delete` both reads and clears the flag.
        abort: (id) => wire.abort(id, userAborts.current.delete(id) ? 'user' : 'error'),
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
        onProgress: (progress) => {
          const now = Date.now();
          const previous = lastUiAt.current.get(assetId) ?? 0;
          if (now - previous < UI_INTERVAL_MS && progress.pct < 100) return;
          lastUiAt.current.set(assetId, now);
          setLocal((prev) => ({ ...prev, [assetId]: progress }));
        },
        // The server's asset status (UPLOADED / ABORTED / FAILED, already in
        // the cache by now) is authoritative from here on, so the local row
        // drops out rather than competing with it. The retry source is kept
        // only for the failed case, which is the only one that offers Retry.
        onDone: () => {
          sources.current.delete(assetId);
          clearLocal(assetId);
          settle();
        },
        onAborted: () => {
          sources.current.delete(assetId);
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
        userAborts.current.delete(assetId);
      }
    },
    [clearLocal, queryClient]
  );

  const abort = useCallback(
    async (assetId: string) => {
      const uploader = running.current.get(assetId);
      if (uploader) {
        // Flag only what `abort()` will actually act on, so a click that lands
        // after the upload settled cannot leave the flag behind.
        if (uploader.state === 'running') userAborts.current.add(assetId);
        // Fire-and-forget by design: the uploader tears the parts down and
        // calls `api.abort` itself, which reads the flag just set.
        uploader.abort();
        return;
      }
      // No uploader here means another tab (or a previous page load) owns the
      // upload: the server transition is still this tab's to request.
      await uploadWireApi(personaRef.current, queryClient).abort(assetId, 'user');
    },
    [queryClient]
  );

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
