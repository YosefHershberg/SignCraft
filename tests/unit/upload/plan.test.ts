import { describe, expect, it } from 'vitest';
import { planParts, partRange, shouldReportProgress } from '@/lib/upload/plan';
import { PART_SIZE } from '@/lib/domain/constants';

describe('planParts', () => {
  it('splits a 1 GiB file into 103 parts with a 4 MiB last part', () => {
    const plan = planParts(1024 ** 3);
    expect(plan.partSize).toBe(PART_SIZE);
    expect(plan.partCount).toBe(103);
    // 1_073_741_824 - 102 * 10_485_760 = 4_194_304 (4 MiB)
    expect(plan.lastPartSize).toBe(4_194_304);
  });

  it('produces a single part when the file is exactly one part size', () => {
    const plan = planParts(10 * 1024 * 1024);
    expect(plan.partCount).toBe(1);
    expect(plan.lastPartSize).toBe(10 * 1024 * 1024);
  });

  it('clamps a zero-byte file to one empty part', () => {
    const plan = planParts(0);
    expect(plan.partCount).toBe(1);
    expect(plan.lastPartSize).toBe(0);
  });
});

describe('partRange', () => {
  it('returns the byte range for the final (short) part', () => {
    const plan = planParts(1024 ** 3);
    const range = partRange(plan, 103);
    expect(range.start).toBe(102 * PART_SIZE);
    expect(range.size).toBe(4_194_304);
    expect(range.end).toBe(range.start + range.size);
    expect(range.end).toBe(1024 ** 3);
  });

  it('returns a full-size range for a non-final part', () => {
    const plan = planParts(1024 ** 3);
    const range = partRange(plan, 1);
    expect(range.start).toBe(0);
    expect(range.size).toBe(PART_SIZE);
    expect(range.end).toBe(PART_SIZE);
  });
});

describe('shouldReportProgress', () => {
  it('is true once at least the progress interval has elapsed', () => {
    expect(shouldReportProgress({ at: 0, pct: 10 }, 2_000, 10)).toBe(true);
  });

  it('is true once pct has advanced by at least the progress step', () => {
    expect(shouldReportProgress({ at: 0, pct: 10 }, 500, 15)).toBe(true);
  });

  it('is true at 100% regardless of elapsed time or pct delta', () => {
    expect(shouldReportProgress({ at: 0, pct: 99 }, 100, 100)).toBe(true);
  });

  it('is false when neither the interval nor the step threshold is met', () => {
    expect(shouldReportProgress({ at: 0, pct: 10 }, 500, 12)).toBe(false);
  });
});
