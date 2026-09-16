import { describe, expect, it } from 'vitest';
import { canCompleteOrder, orderCtx, visibleOrderActions } from '@/lib/domain/order-actions';
import { orderActionsFor } from '@/lib/domain/permissions';
import type { AssetDTO, AssetStatus, JobDTO, OrderDTO, OrderStatus, Persona } from '@/lib/domain/types';

const now = new Date('2026-09-16T12:00:00.000Z');

const VENDOR_ID = 'a'.repeat(24);
const INSTALLER_ID = 'b'.repeat(24);
const OTHER_INSTALLER_ID = 'c'.repeat(24);

const ops: Persona = { kind: 'ops' };
const vendorOwner: Persona = { kind: 'vendor', id: VENDOR_ID };
const installer: Persona = { kind: 'installer', id: INSTALLER_ID };

function asset(status: AssetStatus): AssetDTO {
  return {
    id: `${status}-asset`,
    orderId: 'order-1',
    fileName: 'artwork.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: 'orders/order-1/artwork.pdf',
    status,
    bytesUploaded: 0,
    progressPct: 0,
    simulated: false,
    createdAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T11:00:00.000Z',
  };
}

function assignedJob(installerId: string): JobDTO {
  return {
    id: 'd'.repeat(24),
    orderId: 'order-1',
    status: 'ASSIGNED',
    claim: null,
    installerId,
    version: 3,
    createdAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T11:30:00.000Z',
  };
}

function order(status: OrderStatus, extra: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: 'order-1',
    orderNumber: 'SC-0001',
    title: 'Fascia sign',
    customerName: 'Riverside Bakery',
    signType: 'STOREFRONT',
    widthCm: 240,
    heightCm: 90,
    quantity: 3,
    installAddress: '44 Pine St',
    dueDate: '2026-09-24T00:00:00.000Z',
    notes: null,
    vendorId: VENDOR_ID,
    status,
    version: 1,
    history: [],
    createdAt: '2026-09-16T12:00:00.000Z',
    updatedAt: '2026-09-16T12:00:00.000Z',
    installJob: null,
    assets: [],
    ...extra,
  };
}

describe('orderCtx', () => {
  it('carries status, vendor and install job straight through', () => {
    const job = assignedJob(INSTALLER_ID);
    expect(orderCtx(order('READY_FOR_INSTALL', { installJob: job }))).toEqual({
      status: 'READY_FOR_INSTALL',
      vendorId: VENDOR_ID,
      hasUploadedAsset: false,
      installJob: job,
    });
  });

  it('sets hasUploadedAsset only when an asset has status UPLOADED', () => {
    expect(orderCtx(order('DRAFT', { assets: [] })).hasUploadedAsset).toBe(false);
    for (const status of ['PENDING', 'UPLOADING', 'FAILED', 'ABORTED'] as const) {
      expect(orderCtx(order('DRAFT', { assets: [asset(status)] })).hasUploadedAsset).toBe(false);
    }
    expect(orderCtx(order('DRAFT', { assets: [asset('UPLOADED')] })).hasUploadedAsset).toBe(true);
    expect(
      orderCtx(order('DRAFT', { assets: [asset('FAILED'), asset('UPLOADED')] })).hasUploadedAsset
    ).toBe(true);
  });
});

describe('visibleOrderActions', () => {
  it('matches orderActionsFor for ops', () => {
    const dto = order('DRAFT', { assets: [asset('UPLOADED')] });
    expect(visibleOrderActions(ops, dto, now)).toEqual(orderActionsFor(ops, orderCtx(dto), now));
    expect(visibleOrderActions(ops, dto, now)).toEqual([
      { action: 'submit', enabled: true, reason: null },
      { action: 'cancel', enabled: true, reason: null },
    ]);
  });

  it('keeps ops submit listed but disabled until an asset is uploaded', () => {
    const dto = order('DRAFT', { assets: [asset('UPLOADING')] });
    expect(visibleOrderActions(ops, dto, now)).toEqual([
      { action: 'submit', enabled: false, reason: 'Needs at least one uploaded file' },
      { action: 'cancel', enabled: true, reason: null },
    ]);
  });

  it('drops complete for the installer persona — it belongs to the job panel', () => {
    const dto = order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_ID) });

    expect(orderActionsFor(installer, orderCtx(dto), now)).toEqual([
      { action: 'complete', enabled: true, reason: null },
    ]);
    expect(visibleOrderActions(installer, dto, now)).toEqual([]);
  });

  it('drops complete for an installer who does not hold the job either', () => {
    const dto = order('READY_FOR_INSTALL', { installJob: assignedJob(OTHER_INSTALLER_ID) });
    expect(visibleOrderActions(installer, dto, now)).toEqual([]);
  });

  it('leaves non-installer personas untouched', () => {
    const dto = order('SUBMITTED');
    expect(visibleOrderActions(vendorOwner, dto, now)).toEqual([
      { action: 'accept', enabled: true, reason: null },
      { action: 'cancel', enabled: true, reason: null },
    ]);
  });
});

describe('canCompleteOrder', () => {
  it('is true for the assigned installer while the order is still ready for install', () => {
    const dto = order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_ID) });
    expect(canCompleteOrder(installer, dto, now)).toBe(true);
  });

  it('is false once the order is COMPLETED, even though the job is still ASSIGNED to them', () => {
    const dto = order('COMPLETED', { installJob: assignedJob(INSTALLER_ID) });
    expect(dto.installJob?.status).toBe('ASSIGNED');
    expect(canCompleteOrder(installer, dto, now)).toBe(false);
  });

  it('is false for an installer who does not hold the job, and for other personas', () => {
    const dto = order('READY_FOR_INSTALL', { installJob: assignedJob(OTHER_INSTALLER_ID) });
    expect(canCompleteOrder(installer, dto, now)).toBe(false);
    expect(canCompleteOrder(ops, order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_ID) }), now)).toBe(
      false
    );
    expect(
      canCompleteOrder(vendorOwner, order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_ID) }), now)
    ).toBe(false);
  });

  it('is false while the job is only claimed, not assigned', () => {
    const claimed: JobDTO = {
      ...assignedJob(INSTALLER_ID),
      status: 'CLAIMED',
      installerId: null,
      claim: {
        installerId: INSTALLER_ID,
        claimedAt: '2026-09-16T11:59:00.000Z',
        expiresAt: '2026-09-16T12:02:00.000Z',
      },
    };
    expect(canCompleteOrder(installer, order('READY_FOR_INSTALL', { installJob: claimed }), now)).toBe(false);
  });
});
