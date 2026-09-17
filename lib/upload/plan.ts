// Pipeline 3 (direct-to-cloud upload), step 2: the pure arithmetic of
// splitting a file into presigned-multipart parts, plus the throttling that
// bounds how often progress is written to the server. No fetch, no DOM —
// consumed by both `part-source.ts` and `uploader.ts`.
import { PART_SIZE, PROGRESS_INTERVAL_MS, PROGRESS_STEP_PCT } from '@/lib/domain/constants';

/** How one upload is chopped up: `partSize` per part except the last, which is `lastPartSize`; `partCount` total. */
export interface UploadPlan {
  partSize: number;
  partCount: number;
  lastPartSize: number;
}

/** Derives an `UploadPlan` for a file of `sizeBytes`, matching the plan `createAsset` returns from `POST /api/assets` (`lib/services/assets.ts`) so client and server never disagree on part boundaries. */
export function planParts(sizeBytes: number, partSize: number = PART_SIZE): UploadPlan {
  // A zero-byte file still needs one (empty) part to upload/complete.
  const partCount = Math.max(1, Math.ceil(sizeBytes / partSize));
  const lastPartSize = sizeBytes - (partCount - 1) * partSize;
  return { partSize, partCount, lastPartSize };
}

/** The byte range (`[start, end)`) and size of one part under `plan`. Used both to slice/allocate the part body and to compute how many bytes a completed part contributed. */
export function partRange(plan: UploadPlan, partNumber: number): { start: number; end: number; size: number } {
  const start = (partNumber - 1) * plan.partSize;
  const size = partNumber === plan.partCount ? plan.lastPartSize : plan.partSize;
  return { start, end: start + size, size };
}

/**
 * Throughput and time-left for an in-flight upload, from wall time only: the
 * whole-upload average rather than an instantaneous rate, so the caption does
 * not jitter every time a part finishes. Pure, so the caption is testable
 * without an uploader, a clock or a network.
 *
 * Returns zeros whenever a rate cannot honestly be derived (no elapsed time,
 * nothing uploaded yet, or a clock that went backwards), which the UI renders
 * as "Starting…" rather than as "0 B/s · 0:00 left".
 */
export function estimate(
  bytesUploaded: number,
  total: number,
  startedAt: number,
  now: number
): { bytesPerSecond: number; etaMs: number } {
  const elapsedMs = now - startedAt;
  if (elapsedMs <= 0 || bytesUploaded <= 0) return { bytesPerSecond: 0, etaMs: 0 };

  const bytesPerSecond = (bytesUploaded / elapsedMs) * 1000;
  const remaining = Math.max(0, total - bytesUploaded);
  return { bytesPerSecond, etaMs: (remaining / bytesPerSecond) * 1000 };
}

/**
 * Whether `MultipartUploader.reportProgress` should send `POST
 * /api/assets/:id/progress` right now, given the last report it sent
 * (`prev`). Fires on whichever comes first: `PROGRESS_INTERVAL_MS` elapsed,
 * `PROGRESS_STEP_PCT` more progress, or completion (`pct === 100`, always
 * reported so the row never stalls just under 100%). This is the only
 * throttle between an upload and the database, and it is what keeps a single
 * upload to roughly 20-30 writes regardless of file size or part count.
 */
export function shouldReportProgress(prev: { at: number; pct: number }, now: number, pct: number): boolean {
  return now - prev.at >= PROGRESS_INTERVAL_MS || pct - prev.pct >= PROGRESS_STEP_PCT || pct === 100;
}
