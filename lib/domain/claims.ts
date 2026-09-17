/**
 * Lazy claim expiry (ADR-006, architecture §9.3, Invariant 3). Nothing wakes
 * up at T+3 min on Vercel, so "the claim has lapsed" is a pure function of
 * (job, now) evaluated wherever a job is read, on the server and the client.
 */
import { DEFAULT_CLAIM_TTL_MS } from './constants';
import type { JobStatus } from './types';

/**
 * The minimum a job must expose for the expiry rules. Structural so the same
 * functions accept a Prisma row (Date fields), a change-stream document and a
 * `JobDTO` (ISO strings).
 */
export interface JobLike {
  status: JobStatus;
  claim: { installerId: string; expiresAt: string | Date; claimedAt: string | Date } | null;
  installerId: string | null;
}

/** True when the job is CLAIMED and its hold has lapsed at `now` (inclusive edge). */
export function isClaimExpired(job: JobLike, now: Date): boolean {
  if (job.status !== 'CLAIMED' || !job.claim) return false;
  return new Date(job.claim.expiresAt).getTime() <= now.getTime();
}

/**
 * The job as the outside world must see it: an expired claim reads as
 * `{ status: 'OPEN', claim: null }`, everything else passes through untouched.
 * The client runs it too: `JobChip` compares the raw job's status with this
 * view to catch the expiry edge and fire `onExpire` exactly once.
 *
 * Every job that leaves the server goes through this, via
 * `lib/services/dto.ts#toJobDTO` — REST responses, bootstrap and SSE frames
 * alike. The DB row may still say CLAIMED until a write (`claimJob`'s filter
 * treats it as free) or the `releaseExpired` sweep flips it, but no reader
 * ever sees that.
 */
export function toPublicJob<T extends JobLike>(job: T, now: Date): T {
  if (!isClaimExpired(job, now)) return job;
  return { ...job, status: 'OPEN', claim: null };
}

/** Milliseconds left on a live claim (0 when not CLAIMED or already lapsed); drives the countdown. */
export function claimRemainingMs(job: JobLike, now: Date): number {
  if (job.status !== 'CLAIMED' || !job.claim) return 0;
  return Math.max(0, new Date(job.claim.expiresAt).getTime() - now.getTime());
}

/**
 * The claim TTL the server applies: `CLAIM_TTL_MS` when it is a positive
 * number, else the 3-minute default. Takes the env as a parameter so it stays
 * pure and testable; `claimJob` passes `process.env`, and `getBootstrap`
 * ships the result to the client as `BootstrapDTO.claimTtlMs` for copy.
 */
export function claimTtlMs(env: { CLAIM_TTL_MS?: string } = {}): number {
  const parsed = Number(env.CLAIM_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAIM_TTL_MS;
}
