import { describe, expect, it } from 'vitest';
import { claimTotalMs, ringColour, ringOffset } from '@/lib/domain/ring';

const TEAL = '#0D9488';
const AMBER = '#D97706';
const RED = '#DC2626';

describe('ringColour', () => {
  it('is teal above one minute', () => {
    expect(ringColour(180_000)).toBe(TEAL);
    expect(ringColour(60_001)).toBe(TEAL);
  });

  it('turns amber at one minute and below', () => {
    expect(ringColour(60_000)).toBe(AMBER);
    expect(ringColour(45_000)).toBe(AMBER);
    expect(ringColour(30_001)).toBe(AMBER);
  });

  it('turns red at thirty seconds and below', () => {
    expect(ringColour(30_000)).toBe(RED);
    expect(ringColour(1)).toBe(RED);
    expect(ringColour(0)).toBe(RED);
  });

  it('stays red past zero', () => {
    expect(ringColour(-5_000)).toBe(RED);
  });
});

describe('ringOffset', () => {
  const C = 478;

  it('is zero when the claim is untouched (full ring)', () => {
    expect(ringOffset(180_000, 180_000, C)).toBe(0);
  });

  it('is the full circumference at zero remaining (empty ring)', () => {
    expect(ringOffset(0, 180_000, C)).toBe(C);
  });

  it('drains proportionally', () => {
    expect(ringOffset(90_000, 180_000, 400)).toBe(200);
    expect(ringOffset(45_000, 180_000, 400)).toBe(300);
  });

  it('matches the design at 2:41 of 3:00', () => {
    // Design 1d draws a 425/478 arc for 2:41 remaining of a 3:00 claim.
    expect(Math.round(C - ringOffset(161_000, 180_000, C))).toBe(428);
  });

  it('clamps a remainder larger than the total', () => {
    expect(ringOffset(200_000, 180_000, C)).toBe(0);
  });

  it('clamps a negative remainder', () => {
    expect(ringOffset(-1_000, 180_000, C)).toBe(C);
  });

  it('treats a non-positive total as drained rather than dividing by zero', () => {
    expect(ringOffset(10_000, 0, C)).toBe(C);
  });
});

describe('claimTotalMs', () => {
  it('reads the TTL off the claim, not the server default', () => {
    expect(
      claimTotalMs({ claimedAt: '2026-09-16T12:00:00.000Z', expiresAt: '2026-09-16T12:03:00.000Z' })
    ).toBe(180_000);
    // A CLAIM_TTL_MS override must not desynchronise the ring.
    expect(
      claimTotalMs({ claimedAt: '2026-09-16T12:00:00.000Z', expiresAt: '2026-09-16T12:00:20.000Z' })
    ).toBe(20_000);
  });

  it('never goes negative', () => {
    expect(
      claimTotalMs({ claimedAt: '2026-09-16T12:03:00.000Z', expiresAt: '2026-09-16T12:00:00.000Z' })
    ).toBe(0);
  });
});
