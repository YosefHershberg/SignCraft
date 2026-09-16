import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { assertTestDatabase } from './db-name';

export { assertTestDatabase };

export async function resetDb() {
  // Deletes everything in the current database: refuse unless it is a *_test one.
  assertTestDatabase();
  await prisma.asset.deleteMany();
  await prisma.installJob.deleteMany();
  await prisma.order.deleteMany();
  await prisma.installer.deleteMany();
  await prisma.vendor.deleteMany();
}

export async function makeVendor(name = 'Vendor A') {
  return prisma.vendor.create({ data: { name } });
}

export async function makeInstaller(name = 'Installer A') {
  return prisma.installer.create({ data: { name } });
}

export async function makeOrder(vendorId: string, over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
  const n = Math.floor(Math.random() * 1e9);
  const data: Prisma.OrderUncheckedCreateInput = {
    orderNumber: `T-${n}`,
    title: 'Test',
    customerName: 'Cust',
    signType: 'BANNER',
    widthCm: 10,
    heightCm: 10,
    quantity: 1,
    installAddress: 'x',
    dueDate: new Date(),
    vendorId,
    status: 'DRAFT',
    version: 0,
    history: [{ from: null, to: 'DRAFT', actorType: 'OPS', actorId: null, reason: null, at: new Date() }],
    ...over,
  };
  return prisma.order.create({ data });
}
