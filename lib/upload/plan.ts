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

export function shouldReportProgress(prev: { at: number; pct: number }, now: number, pct: number): boolean {
  return now - prev.at >= PROGRESS_INTERVAL_MS || pct - prev.pct >= PROGRESS_STEP_PCT || pct === 100;
}
