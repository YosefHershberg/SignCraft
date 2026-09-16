import { describe, expect, it } from 'vitest';
import { applyEvent, shouldToastNewJob } from '@/lib/realtime/apply-event';
import type { AssetDTO, BootstrapDTO, JobDTO, OrderDTO, SseEvent } from '@/lib/domain/types';

function order(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: 'order1',
    orderNumber: 'ORD-1',
    title: 'Storefront sign',
    customerName: 'Acme',
    signType: 'STOREFRONT',
    widthCm: 100,
    heightCm: 50,
    quantity: 1,
    installAddress: '1 Main St',
    dueDate: '2026-10-01T00:00:00.000Z',
    notes: null,
    vendorId: 'vendor1',
    status: 'DRAFT',
    version: 1,
    history: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    installJob: null,
    assets: [],
    ...overrides,
  };
}

function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: 'job1',
    orderId: 'order1',
    status: 'OPEN',
    claim: null,
    installerId: null,
    version: 1,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

function asset(overrides: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: 'asset1',
    orderId: 'order1',
    fileName: 'sign.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    storageKey: 'orders/order1/sign.pdf',
    status: 'UPLOADED',
    bytesUploaded: 2048,
    progressPct: 100,
    simulated: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function bootstrap(overrides: Partial<BootstrapDTO> = {}): BootstrapDTO {
  return {
    vendors: [],
    installers: [],
    orders: [],
    serverTime: '2026-09-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('applyEvent', () => {
  it('order.created: prepends a new order when its id is unknown', () => {
    const data = bootstrap({ orders: [order({ id: 'order1' })] });
    const newOrder = order({ id: 'order2', orderNumber: 'ORD-2' });
    const ev: SseEvent = { type: 'order.created', doc: newOrder };

    const result = applyEvent(data, ev);

    expect(result).not.toBe(data);
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0].id).toBe('order2');
    expect(result.orders[0].installJob).toBeNull();
    expect(result.orders[0].assets).toEqual([]);
  });

  it('order.updated: replaces fields but preserves the cached installJob and assets', () => {
    const cachedJob = job({ status: 'CLAIMED', version: 2 });
    const cachedAssets = [asset()];
    const data = bootstrap({ orders: [order({ installJob: cachedJob, assets: cachedAssets, version: 1 })] });
    const ev: SseEvent = { type: 'order.updated', doc: order({ status: 'SUBMITTED', version: 2, installJob: null, assets: [] }) };

    const result = applyEvent(data, ev);

    expect(result).not.toBe(data);
    expect(result.orders[0].status).toBe('SUBMITTED');
    expect(result.orders[0].version).toBe(2);
    expect(result.orders[0].installJob).toBe(cachedJob);
    expect(result.orders[0].assets).toBe(cachedAssets);
  });

  it('order.updated: ignores an event whose version is lower than the cached version', () => {
    const data = bootstrap({ orders: [order({ version: 5, status: 'SUBMITTED' })] });
    const ev: SseEvent = { type: 'order.updated', doc: order({ version: 3, status: 'DRAFT' }) };

    const result = applyEvent(data, ev);

    expect(result).toBe(data);
    expect(result.orders[0].status).toBe('SUBMITTED');
  });

  it('returns the same object reference when nothing changes', () => {
    const existingOrder = order({ version: 2, status: 'SUBMITTED' });
    const data = bootstrap({ orders: [existingOrder] });
    const ev: SseEvent = { type: 'order.updated', doc: order({ version: 2, status: 'SUBMITTED' }) };

    const result = applyEvent(data, ev);

    expect(result).toBe(data);
  });

  it('job.created: finds the order by orderId and sets installJob', () => {
    const data = bootstrap({ orders: [order({ id: 'order1', installJob: null })] });
    const newJob = job({ id: 'job1', orderId: 'order1', status: 'OPEN', version: 1 });
    const ev: SseEvent = { type: 'job.created', doc: newJob };

    const result = applyEvent(data, ev);

    expect(result).not.toBe(data);
    expect(result.orders[0].installJob).toEqual(newJob);
  });

  it('job.updated: applies the new job unless the cached job version is higher', () => {
    const data = bootstrap({ orders: [order({ installJob: job({ version: 5, status: 'ASSIGNED' }) })] });
    const staleJob = job({ version: 3, status: 'CLAIMED' });
    const ev: SseEvent = { type: 'job.updated', doc: staleJob };

    const result = applyEvent(data, ev);

    expect(result).toBe(data);
    expect(result.orders[0].installJob?.status).toBe('ASSIGNED');
  });

  it('job.updated: ignores the event when the order is unknown', () => {
    const data = bootstrap({ orders: [order({ id: 'order1' })] });
    const ev: SseEvent = { type: 'job.updated', doc: job({ orderId: 'does-not-exist' }) };

    const result = applyEvent(data, ev);

    expect(result).toBe(data);
  });

  it('asset.created: appends a new asset to the matching order', () => {
    const data = bootstrap({ orders: [order({ assets: [] })] });
    const newAsset = asset({ id: 'asset1' });
    const ev: SseEvent = { type: 'asset.created', doc: newAsset };

    const result = applyEvent(data, ev);

    expect(result).not.toBe(data);
    expect(result.orders[0].assets).toEqual([newAsset]);
  });

  it('asset.updated: replaces an existing asset by id', () => {
    const original = asset({ id: 'asset1', progressPct: 40, status: 'UPLOADING' });
    const data = bootstrap({ orders: [order({ assets: [original] })] });
    const updated = asset({ id: 'asset1', progressPct: 80, status: 'UPLOADING' });
    const ev: SseEvent = { type: 'asset.updated', doc: updated };

    const result = applyEvent(data, ev);

    expect(result).not.toBe(data);
    expect(result.orders[0].assets).toEqual([updated]);
  });

  it('asset.updated: ignores the event when the order is unknown', () => {
    const data = bootstrap({ orders: [order({ id: 'order1' })] });
    const ev: SseEvent = { type: 'asset.updated', doc: asset({ orderId: 'does-not-exist' }) };

    const result = applyEvent(data, ev);

    expect(result).toBe(data);
  });
});

describe('shouldToastNewJob', () => {
  const data = bootstrap();

  it('is true for an installer persona on job.created', () => {
    const ev: SseEvent = { type: 'job.created', doc: job() };
    expect(shouldToastNewJob(data, ev, { kind: 'installer', id: 'installer1' })).toBe(true);
  });

  it('is false for an ops persona on job.created', () => {
    const ev: SseEvent = { type: 'job.created', doc: job() };
    expect(shouldToastNewJob(data, ev, { kind: 'ops' })).toBe(false);
  });

  it('is false for a vendor persona on job.created', () => {
    const ev: SseEvent = { type: 'job.created', doc: job() };
    expect(shouldToastNewJob(data, ev, { kind: 'vendor', id: 'vendor1' })).toBe(false);
  });

  it('is false for an installer persona on job.updated', () => {
    const ev: SseEvent = { type: 'job.updated', doc: job() };
    expect(shouldToastNewJob(data, ev, { kind: 'installer', id: 'installer1' })).toBe(false);
  });
});
