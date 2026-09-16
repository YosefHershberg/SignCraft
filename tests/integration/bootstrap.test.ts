import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { resetDb, makeVendor, makeInstaller, makeOrder } from '@/tests/helpers/db';
import { claimJob } from '@/lib/services/jobs';
import { getBootstrap } from '@/lib/services/bootstrap';

describe('bootstrap service', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns vendors and installers sorted by name, orders sorted newest-first, and serverTime', async () => {
    const vendorB = await makeVendor('Bravo Vendor');
    const vendorA = await makeVendor('Alpha Vendor');
    await makeInstaller('Bravo Installer');
    await makeInstaller('Alpha Installer');
    const older = await makeOrder(vendorA.id);
    await new Promise((r) => setTimeout(r, 5));
    const newer = await makeOrder(vendorB.id);

    const now = new Date();
    const dto = await getBootstrap(now);

    expect(dto.serverTime).toBe(now.toISOString());
    expect(dto.vendors.map((v) => v.name)).toEqual(['Alpha Vendor', 'Bravo Vendor']);
    expect(dto.installers.map((i) => i.name)).toEqual(['Alpha Installer', 'Bravo Installer']);
    expect(dto.orders.map((o) => o.id)).toEqual([newer.id, older.id]);
  });

  it('includes installJob and assets on each order', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    await prisma.asset.create({
      data: {
        orderId: order.id,
        fileName: 'art.png',
        contentType: 'image/png',
        sizeBytes: BigInt(10),
        storageKey: 'k',
        status: 'UPLOADED',
      },
    });

    const dto = await getBootstrap();
    const found = dto.orders.find((o) => o.id === order.id);

    expect(found?.installJob?.status).toBe('OPEN');
    expect(found?.assets).toHaveLength(1);
  });

  it('reports an expired claim as OPEN and actually releases it in the DB', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    const installer = await makeInstaller();

    const claimedAt = new Date();
    await claimJob(job.id, installer.id, claimedAt);
    const past = new Date(claimedAt.getTime() - 1_000);
    await prisma.installJob.update({
      where: { id: job.id },
      data: { claim: { installerId: installer.id, claimedAt, expiresAt: past } },
    });

    const dto = await getBootstrap(new Date());
    const orderDto = dto.orders.find((o) => o.id === order.id);

    expect(orderDto?.installJob?.status).toBe('OPEN');
    expect(orderDto?.installJob?.claim).toBeNull();

    const db = await prisma.installJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(db.status).toBe('OPEN');
    expect(db.claim).toBeNull();
  });
});
