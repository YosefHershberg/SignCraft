import { DEFAULT_CLAIM_TTL_MS } from './constants';
import type { JobStatus } from './types';

export interface JobLike {
  status: JobStatus;
  claim: { installerId: string; expiresAt: string | Date; claimedAt: string | Date } | null;
  installerId: string | null;
}

export function isClaimExpired(job: JobLike, now: Date): boolean {
  if (job.status !== 'CLAIMED' || !job.claim) return false;
  return new Date(job.claim.expiresAt).getTime() <= now.getTime();
}

export function toPublicJob<T extends JobLike>(job: T, now: Date): T {
  if (!isClaimExpired(job, now)) return job;
  return { ...job, status: 'OPEN', claim: null };
}

export function claimRemainingMs(job: JobLike, now: Date): number {
  if (job.status !== 'CLAIMED' || !job.claim) return 0;
  return Math.max(0, new Date(job.claim.expiresAt).getTime() - now.getTime());
}

export function claimTtlMs(env: { CLAIM_TTL_MS?: string } = {}): number {
  const parsed = Number(env.CLAIM_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAIM_TTL_MS;
}
