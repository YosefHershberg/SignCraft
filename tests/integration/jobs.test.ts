import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { JobDTO } from '@/lib/domain/types';
import { resetDb, makeVendor, makeInstaller, makeOrder } from '@/tests/helpers/db';
import { claimJob, verifyJob, releaseExpired, ensureJobForOrder, getJob } from '@/lib/services/jobs';

describe('jobs service', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeReadyOrderWithOpenJob() {
    const vendor = await makeVendor(`Vendor ${Math.random().toString(36).slice(2)}`);
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    return { vendor, order, job };
  }

  it('exactly one of 50 concurrent claims wins', async () => {
    const { job } = await makeReadyOrderWithOpenJob();
    await prisma.installer.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ name: `Installer ${i}` })),
    });
    const installers = await prisma.installer.findMany();
    expect(installers).toHaveLength(50);

    const results = await Promise.allSettled(installers.map((i) => claimJob(job.id, i.id)));

    const won = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<JobDTO>[];
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(49);
    expect(lost.every((r) => r.reason instanceof ApiError && r.reason.code === 'CLAIM_TAKEN')).toBe(true);

    const db = await prisma.installJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(db.status).toBe('CLAIMED');
    expect(db.claim?.installerId).toBe(won[0]!.value.claim!.installerId);
  });

  it('an expired claim can be re-claimed by another installer', async () => {
    const { job } = await makeReadyOrderWithOpenJob();
    const first = await makeInstaller('First');
    const second = await makeInstaller('Second');

    const now = new Date();
    const claimed = await claimJob(job.id, first.id, now);
    expect(claimed.claim?.installerId).toBe(first.id);

    await prisma.installJob.update({
      where: { id: job.id },
      data: { claim: { installerId: first.id, claimedAt: now, expiresAt: new Date(now.getTime() - 1_000) } },
    });

    const reclaimed = await claimJob(job.id, second.id, new Date());
    expect(reclaimed.claim?.installerId).toBe(second.id);
    expect(reclaimed.status).toBe('CLAIMED');

    const db = await prisma.installJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(db.claim?.installerId).toBe(second.id);
  });

  it('getJob reports an expired claim as OPEN without writing', async () => {
    const { job } = await makeReadyOrderWithOpenJob();
    const installer = await makeInstaller();
    const now = new Date();
    await claimJob(job.id, installer.id, now);

    const past = new Date(now.getTime() - 1_000);
    await prisma.installJob.update({
      where: { id: job.id },
      data: { claim: { installerId: installer.id, claimedAt: now, expiresAt: past } },
    });

    const viewedAt = new Date();
    const dto = await getJob(job.id, viewedAt);
    expect(dto.status).toBe('OPEN');
    expect(dto.claim).toBeNull();

    // lazy: the read must not have written anything back to the DB
    const db = await prisma.installJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(db.status).toBe('CLAIMED');
    expect(db.claim?.expiresAt).toEqual(past);
  });

  it('verify fail reopens, verify pass assigns, later claim on ASSIGNED is 409', async () => {
    const { job } = await makeReadyOrderWithOpenJob();
    const installer = await makeInstaller();
    const other = await makeInstaller('Other');

    await claimJob(job.id, installer.id);
    const failed = await verifyJob(job.id, installer.id, 'fail');
    expect(failed.status).toBe('OPEN');
    expect(failed.claim).toBeNull();

    await claimJob(job.id, installer.id);
    const passed = await verifyJob(job.id, installer.id, 'pass');
    expect(passed.status).toBe('ASSIGNED');
    expect(passed.installerId).toBe(installer.id);
    expect(passed.claim).toBeNull();

    await expect(claimJob(job.id, other.id)).rejects.toMatchObject({ status: 409, code: 'CLAIM_TAKEN' });
  });

  it('verify by a non-claimant is NOT_CLAIMANT, verify after expiry is CLAIM_EXPIRED', async () => {
    const { job } = await makeReadyOrderWithOpenJob();
    const claimant = await makeInstaller();
    const stranger = await makeInstaller('Stranger');

    const now = new Date();
    await claimJob(job.id, claimant.id, now);

    await expect(verifyJob(job.id, stranger.id, 'pass', now)).rejects.toMatchObject({
      status: 409,
      code: 'NOT_CLAIMANT',
    });

    const past = new Date(now.getTime() - 1_000);
    await prisma.installJob.update({
      where: { id: job.id },
      data: { claim: { installerId: claimant.id, claimedAt: now, expiresAt: past } },
    });

    await expect(verifyJob(job.id, claimant.id, 'pass', new Date())).rejects.toMatchObject({
      status: 409,
      code: 'CLAIM_EXPIRED',
    });
  });

  it('releaseExpired flips only expired claims and bumps version', async () => {
    const { job: expiredJob } = await makeReadyOrderWithOpenJob();
    const { job: freshJob } = await makeReadyOrderWithOpenJob();
    const installerA = await makeInstaller('A');
    const installerB = await makeInstaller('B');

    const now = new Date();
    await claimJob(expiredJob.id, installerA.id, now);
    await claimJob(freshJob.id, installerB.id, now);

    await prisma.installJob.update({
      where: { id: expiredJob.id },
      data: { claim: { installerId: installerA.id, claimedAt: now, expiresAt: new Date(now.getTime() - 1_000) } },
    });

    const releasedCount = await releaseExpired(new Date());
    expect(releasedCount).toBe(1);

    const expiredDb = await prisma.installJob.findUniqueOrThrow({ where: { id: expiredJob.id } });
    expect(expiredDb.status).toBe('OPEN');
    expect(expiredDb.claim).toBeNull();
    expect(expiredDb.version).toBe(2); // 1 from claim, 1 from release

    const freshDb = await prisma.installJob.findUniqueOrThrow({ where: { id: freshJob.id } });
    expect(freshDb.status).toBe('CLAIMED');
    expect(freshDb.claim?.installerId).toBe(installerB.id);
  });

  it('ensureJobForOrder is idempotent', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });

    const first = await ensureJobForOrder(order.id);
    expect(first.orderId).toBe(order.id);
    expect(first.status).toBe('OPEN');

    const second = await ensureJobForOrder(order.id);
    expect(second.id).toBe(first.id);

    const count = await prisma.installJob.count({ where: { orderId: order.id } });
    expect(count).toBe(1);
  });
});
