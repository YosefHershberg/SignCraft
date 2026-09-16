import { PART_SIZE, PROGRESS_INTERVAL_MS, PROGRESS_STEP_PCT } from '@/lib/domain/constants';

export interface UploadPlan {
  partSize: number;
  partCount: number;
  lastPartSize: number;
}

export function planParts(sizeBytes: number, partSize: number = PART_SIZE): UploadPlan {
  // A zero-byte file still needs one (empty) part to upload/complete.
  const partCount = Math.max(1, Math.ceil(sizeBytes / partSize));
  const lastPartSize = sizeBytes - (partCount - 1) * partSize;
  return { partSize, partCount, lastPartSize };
}

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

export function shouldReportProgress(prev: { at: number; pct: number }, now: number, pct: number): boolean {
  return now - prev.at >= PROGRESS_INTERVAL_MS || pct - prev.pct >= PROGRESS_STEP_PCT || pct === 100;
}
