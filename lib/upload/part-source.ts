import { partRange, type UploadPlan } from '@/lib/upload/plan';

export type PartSource = (partNumber: number) => Blob;

/** Slices the real File at each part's byte range. */
export function fileSource(file: File, plan: UploadPlan): PartSource {
  return (partNumber: number) => {
    const { start, end } = partRange(plan, partNumber);
    return file.slice(start, end);
  };
}

/**
 * Simulated data for demoing large uploads without a real file. Allocates one
 * zero-filled buffer for the plan's part size and reuses it (via `subarray`,
 * a view rather than a copy) for every part instead of allocating per part.
 */
export function simulatedSource(plan: UploadPlan): PartSource {
  const buffer = new Uint8Array(plan.partSize);
  return (partNumber: number) => {
    const { size } = partRange(plan, partNumber);
    return new Blob([buffer.subarray(0, size)], { type: 'application/octet-stream' });
  };
}
