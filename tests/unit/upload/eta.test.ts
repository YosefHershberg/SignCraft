import { describe, expect, it } from 'vitest';
import { estimate } from '@/lib/upload/plan';

const MB = 1024 * 1024;

describe('estimate', () => {
  it('derives throughput from bytes over elapsed wall time', () => {
    // 100 MB in 4 s → 25 MB/s.
    const { bytesPerSecond } = estimate(100 * MB, 1000 * MB, 1_000, 5_000);
    expect(bytesPerSecond).toBeCloseTo(25 * MB, 5);
  });

  it('projects the remaining bytes at the observed rate', () => {
    // 200 MB of 1000 MB in 10 s → 20 MB/s, 800 MB left → 40 s.
    const { etaMs } = estimate(200 * MB, 1000 * MB, 0, 10_000);
    expect(etaMs).toBeCloseTo(40_000, 5);
  });

  it('reports no rate and no ETA before any time has elapsed', () => {
    expect(estimate(0, 100 * MB, 1_000, 1_000)).toEqual({ bytesPerSecond: 0, etaMs: 0 });
  });

  it('reports no rate and no ETA while nothing has been uploaded', () => {
    expect(estimate(0, 100 * MB, 0, 3_000)).toEqual({ bytesPerSecond: 0, etaMs: 0 });
  });

  it('never reports a negative ETA once the total is reached or exceeded', () => {
    expect(estimate(100 * MB, 100 * MB, 0, 4_000).etaMs).toBe(0);
    expect(estimate(120 * MB, 100 * MB, 0, 4_000).etaMs).toBe(0);
  });

  it('treats a clock that went backwards as no elapsed time', () => {
    expect(estimate(10 * MB, 100 * MB, 5_000, 1_000)).toEqual({ bytesPerSecond: 0, etaMs: 0 });
  });

  it('reports a zero-byte upload as instantly finished', () => {
    expect(estimate(0, 0, 0, 1_000)).toEqual({ bytesPerSecond: 0, etaMs: 0 });
  });
});
