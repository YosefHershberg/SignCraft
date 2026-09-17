/**
 * Install-job service (graded behaviour #2): the claim race, verification,
 * the expiry sweep and job reads. Every write here is a single conditional
 * `updateMany` whose filter *is* the lock (ADR-005, architecture §9); every
 * read leaves through `toJobDTO` so lazy expiry is applied (Invariant 3).
 */
import { prisma } from '@/lib/db/prisma';
import { claimTtlMs } from '@/lib/domain/claims';
import type { JobDTO } from '@/lib/domain/types';
import { ApiError } from '@/lib/api/errors';
import { toJobDTO } from './dto';

/**
 * Claims an OPEN job (or a CLAIMED job whose claim has expired) for an installer.
 * This is ONE conditional updateMany whose filter is `OPEN OR (CLAIMED AND expired)`;
 * MongoDB serialises concurrent writers on the single document, so exactly one
 * concurrent caller ever sees `count === 1`. No read-then-write, no transaction.
 *
 * Invariant 2 — do not restructure. The `expired` arm of the filter is what
 * lets a new claimant take over a lapsed claim without any sweep having run.
 * `count !== 1` is ambiguous (taken vs. no such job), so one follow-up read
 * disambiguates; the read plays no part in the lock.
 *
 * @throws ApiError 409 CLAIM_TAKEN when another installer holds a live claim (or the job is ASSIGNED); 404 NOT_FOUND when the job does not exist.
 */
export async function claimJob(jobId: string, installerId: string, now: Date = new Date()): Promise<JobDTO> {
  const expiresAt = new Date(now.getTime() + claimTtlMs({ CLAIM_TTL_MS: process.env.CLAIM_TTL_MS }));

  const res = await prisma.installJob.updateMany({
    where: {
      id: jobId,
      OR: [{ status: 'OPEN' }, { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } }],
    },
    data: {
      status: 'CLAIMED',
      claim: { installerId, claimedAt: now, expiresAt },
      installerId: null,
      version: { increment: 1 },
    },
  });

  if (res.count !== 1) {
    const exists = await prisma.installJob.findUnique({ where: { id: jobId } });
    throw exists ? new ApiError(409, 'CLAIM_TAKEN') : new ApiError(404, 'NOT_FOUND');
  }

  return getJob(jobId, now);
}

/**
 * Verifies a claimed job's install outcome (ADR-010). `pass` assigns the
 * installer (order Complete then checks `canCompleteOrder` against this);
 * `fail` reopens the job for another installer. Same single-`updateMany`
 * shape as `claimJob`: the filter (`CLAIMED`, this installer, not yet
 * expired) is the only check, so a stale or hijacked verify cannot succeed.
 *
 * @throws {ApiError} 404 if the job does not exist, 409 CLAIM_EXPIRED if the
 * hold lapsed before this call landed, 409 NOT_CLAIMANT if `installerId`
 * does not hold the current claim.
 */
export async function verifyJob(
  jobId: string,
  installerId: string,
  outcome: 'pass' | 'fail',
  now: Date = new Date()
): Promise<JobDTO> {
  const data =
    outcome === 'pass'
      ? { status: 'ASSIGNED' as const, installerId, claim: { unset: true } as const, version: { increment: 1 } }
      : { status: 'OPEN' as const, claim: { unset: true } as const, version: { increment: 1 } };

  const res = await prisma.installJob.updateMany({
    where: {
      id: jobId,
      status: 'CLAIMED',
      claim: { is: { installerId, expiresAt: { gt: now } } },
    },
    data,
  });

  if (res.count !== 1) {
    const job = await prisma.installJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError(404, 'NOT_FOUND');
    const expired = job.status !== 'CLAIMED' || !job.claim || job.claim.expiresAt <= now;
    throw expired ? new ApiError(409, 'CLAIM_EXPIRED') : new ApiError(409, 'NOT_CLAIMANT');
  }

  return getJob(jobId, now);
}

/**
 * Sweeps all CLAIMED jobs whose claim has expired back to OPEN. Purely a
 * convenience for observers (SSE, bootstrap); correctness never depends on
 * this running, since every reader applies lazy expiry via `toJobDTO`.
 */
export async function releaseExpired(now: Date = new Date()): Promise<number> {
  const res = await prisma.installJob.updateMany({
    where: { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } },
    data: { status: 'OPEN', claim: { unset: true }, version: { increment: 1 } },
  });
  return res.count;
}

/** Idempotently ensures an OPEN InstallJob exists for the given order. */
export async function ensureJobForOrder(orderId: string): Promise<JobDTO> {
  const job = await prisma.installJob.upsert({
    where: { orderId },
    update: {},
    create: { orderId, status: 'OPEN' },
  });
  return toJobDTO(job, new Date());
}

/** Reads a job, applying lazy expiry so a stale CLAIMED reads as OPEN. */
export async function getJob(jobId: string, now: Date = new Date()): Promise<JobDTO> {
  const job = await prisma.installJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ApiError(404, 'NOT_FOUND');
  return toJobDTO(job, now);
}
