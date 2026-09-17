/**
 * tests/helpers/db.ts — fixtures for `tests/integration/*`: wiping the DB
 * between tests and building the minimal rows each test needs. Only usable
 * against a `*_test` database (`assertTestDatabase`, `tests/helpers/db-name.ts`),
 * since `resetDb` is destructive.
 */
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { assertTestDatabase } from './db-name';

export { assertTestDatabase };

/** Deletes every row in every collection this app owns. Called before each integration test; refuses on anything but a `*_test` database. */
export async function resetDb() {
  assertTestDatabase();
  await prisma.asset.deleteMany();
  await prisma.installJob.deleteMany();
  await prisma.order.deleteMany();
  await prisma.installer.deleteMany();
  await prisma.vendor.deleteMany();
}

/** A minimal Vendor row for a test to reference by id. */
export async function makeVendor(name = 'Vendor A') {
  return prisma.vendor.create({ data: { name } });
}

/** A minimal Installer row for a test to reference by id. */
export async function makeInstaller(name = 'Installer A') {
  return prisma.installer.create({ data: { name } });
}

/** A minimal DRAFT order with a valid creation history row; `over` overrides any field (e.g. `status`) for the test's scenario. */
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
