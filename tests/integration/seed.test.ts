import { describe, it, expect, beforeAll } from 'vitest';
import { seed } from '@/prisma/seed';
import { prisma } from '@/lib/db/prisma';
import { resetDb } from '@/tests/helpers/db';

describe('seed', () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('is idempotent and creates the documented fixture', async () => {
    await seed();
    await seed();
    expect(await prisma.vendor.count()).toBe(3);
    expect(await prisma.installer.count()).toBe(4);
    expect(await prisma.order.count()).toBe(8);
    const ready = await prisma.order.findFirst({
      where: { status: 'READY_FOR_INSTALL' },
      include: { installJob: true },
    });
    expect(ready?.installJob?.status).toBe('OPEN');
    const draft = await prisma.order.findUnique({
      where: { orderNumber: 'SC-0002' },
      include: { assets: true },
    });
    expect(draft?.assets.some((a) => a.status === 'UPLOADED')).toBe(true);
    const cancelled = await prisma.order.findMany({ where: { status: 'CANCELLED' } });
    expect(cancelled).toHaveLength(1);
    const lastEntry = cancelled[0]!.history[cancelled[0]!.history.length - 1];
    expect(lastEntry?.to).toBe('CANCELLED');
    expect(lastEntry?.reason).not.toBeNull();
  });
});
