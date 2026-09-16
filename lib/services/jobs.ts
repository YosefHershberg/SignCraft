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
 * Verifies a claimed job's install outcome. `pass` assigns the installer;
 * `fail` reopens the job. Only the current claimant may verify, and only
 * before the claim expires.
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
