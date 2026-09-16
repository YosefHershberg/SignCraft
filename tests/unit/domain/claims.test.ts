import { describe, expect, it } from 'vitest';
import { isClaimExpired, toPublicJob, claimRemainingMs, claimTtlMs, type JobLike } from '@/lib/domain/claims';
import { DEFAULT_CLAIM_TTL_MS } from '@/lib/domain/constants';

const now = new Date('2026-09-16T12:00:00.000Z');

function claimedJob(expiresAt: string, installerId = 'i'.repeat(24)): JobLike {
  return {
    status: 'CLAIMED',
    installerId: null,
    claim: { installerId, expiresAt, claimedAt: new Date(now.getTime() - 60_000).toISOString() },
  };
}

describe('isClaimExpired', () => {
  it('is true for a CLAIMED job whose expiresAt is 1ms in the past', () => {
    const job = claimedJob(new Date(now.getTime() - 1).toISOString());
    expect(isClaimExpired(job, now)).toBe(true);
  });

  it('is false for a CLAIMED job whose expiresAt is in the future', () => {
    const job = claimedJob(new Date(now.getTime() + 1).toISOString());
    expect(isClaimExpired(job, now)).toBe(false);
  });

  it('is false for an OPEN job', () => {
    const job: JobLike = { status: 'OPEN', installerId: null, claim: null };
    expect(isClaimExpired(job, now)).toBe(false);
  });

  it('is false for an ASSIGNED job', () => {
    const job: JobLike = { status: 'ASSIGNED', installerId: 'i'.repeat(24), claim: null };
    expect(isClaimExpired(job, now)).toBe(false);
  });
});

describe('toPublicJob', () => {
  it('returns OPEN with claim null for an expired claim, without mutating the original', () => {
    const job = claimedJob(new Date(now.getTime() - 1).toISOString());
    const original = { ...job };
    const pub = toPublicJob(job, now);
    expect(pub.status).toBe('OPEN');
    expect(pub.claim).toBeNull();
    expect(job).toEqual(original);
  });

  it('leaves a future claim unchanged', () => {
    const job = claimedJob(new Date(now.getTime() + 1).toISOString());
    const pub = toPublicJob(job, now);
    expect(pub).toEqual(job);
  });

  it('leaves an OPEN job unchanged', () => {
    const job: JobLike = { status: 'OPEN', installerId: null, claim: null };
    expect(toPublicJob(job, now)).toEqual(job);
  });

  it('leaves an ASSIGNED job unchanged', () => {
    const job: JobLike = { status: 'ASSIGNED', installerId: 'i'.repeat(24), claim: null };
    expect(toPublicJob(job, now)).toEqual(job);
  });
});

describe('claimRemainingMs', () => {
  it('clamps at 0 for an expired claim', () => {
    const job = claimedJob(new Date(now.getTime() - 1).toISOString());
    expect(claimRemainingMs(job, now)).toBe(0);
  });

  it('returns the remaining time for a future claim', () => {
    const job = claimedJob(new Date(now.getTime() + 5_000).toISOString());
    expect(claimRemainingMs(job, now)).toBe(5_000);
  });

  it('is 0 when not CLAIMED', () => {
    const job: JobLike = { status: 'OPEN', installerId: null, claim: null };
    expect(claimRemainingMs(job, now)).toBe(0);
  });
});

describe('claimTtlMs', () => {
  it('parses a valid CLAIM_TTL_MS from env', () => {
    expect(claimTtlMs({ CLAIM_TTL_MS: '5000' })).toBe(5000);
  });

  it('falls back to the default for an invalid value', () => {
    expect(claimTtlMs({ CLAIM_TTL_MS: 'not-a-number' })).toBe(DEFAULT_CLAIM_TTL_MS);
  });

  it('falls back to the default when unset', () => {
    expect(claimTtlMs({})).toBe(DEFAULT_CLAIM_TTL_MS);
    expect(claimTtlMs()).toBe(DEFAULT_CLAIM_TTL_MS);
  });
});
