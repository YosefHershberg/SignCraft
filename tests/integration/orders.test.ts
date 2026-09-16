import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { resetDb, makeVendor, makeInstaller, makeOrder } from '@/tests/helpers/db';
import { claimJob, verifyJob } from '@/lib/services/jobs';
import { createOrder, transitionOrder, getOrderDTO } from '@/lib/services/orders';
import type { CreateOrderInput } from '@/lib/domain/schemas';
import type { Persona } from '@/lib/domain/types';

const OPS: Persona = { kind: 'ops' };

function orderInput(vendorId: string, overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    title: 'Storefront sign',
    customerName: 'Acme',
    signType: 'STOREFRONT',
    widthCm: 100,
    heightCm: 50,
    quantity: 1,
    vendorId,
    installAddress: '123 Main St',
    dueDate: new Date().toISOString(),
    notes: null,
    ...overrides,
  };
}

async function addUploadedAsset(orderId: string) {
  return prisma.asset.create({
    data: {
      orderId,
      fileName: 'art.png',
      contentType: 'image/png',
      sizeBytes: BigInt(1_000),
      storageKey: 'orders/x/a/art.png',
      status: 'UPLOADED',
      bytesUploaded: BigInt(1_000),
      progressPct: 100,
    },
  });
}

describe('orders service', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a DRAFT order as ops with a well-formed orderNumber and one history entry', async () => {
    const vendor = await makeVendor();

    const dto = await createOrder(orderInput(vendor.id), OPS);

    expect(dto.status).toBe('DRAFT');
    expect(dto.version).toBe(0);
    expect(dto.orderNumber).toMatch(/^SC-\d{4}$/);
    expect(dto.history).toHaveLength(1);
    expect(dto.history[0]).toMatchObject({ from: null, to: 'DRAFT', actorType: 'OPS', actorId: null });
  });

  it('retries once on an orderNumber collision', async () => {
    const vendor = await makeVendor();
    // one existing order out of sequence with what count()+1 would generate
    await makeOrder(vendor.id, { orderNumber: 'SC-0002' });

    const dto = await createOrder(orderInput(vendor.id), OPS);

    expect(dto.orderNumber).toBe('SC-0003');
  });

  it('rejects order creation by a non-ops persona', async () => {
    const vendor = await makeVendor();

    await expect(createOrder(orderInput(vendor.id), { kind: 'vendor', id: vendor.id })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
  });

  it('DRAFT -> SUBMITTED without an uploaded asset is a guard failure', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'DRAFT' });

    await expect(transitionOrder(order.id, { to: 'SUBMITTED' }, OPS)).rejects.toMatchObject({
      status: 400,
      code: 'GUARD_FAILED',
      details: { reason: 'NO_UPLOADED_ASSET' },
    });
  });

  it('DRAFT -> SUBMITTED with an uploaded asset succeeds and appends history', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'DRAFT' });
    await addUploadedAsset(order.id);

    const dto = await transitionOrder(order.id, { to: 'SUBMITTED' }, OPS);

    expect(dto.status).toBe('SUBMITTED');
    expect(dto.version).toBe(1);
    expect(dto.history).toHaveLength(2);
    expect(dto.history[1]).toMatchObject({ from: 'DRAFT', to: 'SUBMITTED', actorType: 'OPS', actorId: null });

    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('SUBMITTED');
    expect(db.version).toBe(1);
  });

  it('DRAFT -> IN_PRODUCTION is an invalid transition with the allowed list', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'DRAFT' });

    await expect(transitionOrder(order.id, { to: 'IN_PRODUCTION' }, OPS)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_TRANSITION',
      details: { from: 'DRAFT', to: 'IN_PRODUCTION', allowed: ['SUBMITTED', 'CANCELLED'] },
    });
  });

  it('a stale expectedVersion is a version conflict and leaves the order untouched', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'DRAFT' });
    await addUploadedAsset(order.id);

    await expect(
      transitionOrder(order.id, { to: 'SUBMITTED', expectedVersion: order.version + 1 }, OPS)
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('DRAFT');
    expect(db.version).toBe(0);
  });

  it('IN_PRODUCTION -> READY_FOR_INSTALL (by owner vendor) creates an OPEN job; repeating it is INVALID_TRANSITION and leaves the job untouched', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'IN_PRODUCTION' });
    const VENDOR: Persona = { kind: 'vendor', id: vendor.id };

    const dto = await transitionOrder(order.id, { to: 'READY_FOR_INSTALL' }, VENDOR);

    expect(dto.status).toBe('READY_FOR_INSTALL');
    expect(dto.installJob).not.toBeNull();
    expect(dto.installJob?.status).toBe('OPEN');

    const jobBefore = await prisma.installJob.findUniqueOrThrow({ where: { orderId: order.id } });

    await expect(transitionOrder(order.id, { to: 'READY_FOR_INSTALL' }, VENDOR)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_TRANSITION',
    });

    const jobAfter = await prisma.installJob.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(jobAfter.version).toBe(jobBefore.version);
    expect(jobAfter.status).toBe('OPEN');
  });

  it('READY_FOR_INSTALL -> COMPLETED works for the installer assigned via claim + verify(pass)', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    const installer = await makeInstaller();

    await claimJob(job.id, installer.id);
    await verifyJob(job.id, installer.id, 'pass');

    const dto = await transitionOrder(order.id, { to: 'COMPLETED' }, { kind: 'installer', id: installer.id });

    expect(dto.status).toBe('COMPLETED');
    expect(dto.installJob?.status).toBe('ASSIGNED');
    expect(dto.installJob?.installerId).toBe(installer.id);
  });

  it('COMPLETED by a different installer than the assignee is forbidden', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    const assigned = await makeInstaller('Assigned');
    const other = await makeInstaller('Other');

    await claimJob(job.id, assigned.id);
    await verifyJob(job.id, assigned.id, 'pass');

    await expect(
      transitionOrder(order.id, { to: 'COMPLETED' }, { kind: 'installer', id: other.id })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_FOR_PERSONA' });
  });

  it('cancelling from IN_PRODUCTION is not allowed', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'IN_PRODUCTION' });

    await expect(
      transitionOrder(order.id, { to: 'CANCELLED' }, { kind: 'vendor', id: vendor.id })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_TRANSITION' });
  });

  it('getOrderDTO 404s for a missing order', async () => {
    await expect(getOrderDTO('000000000000000000000000')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
