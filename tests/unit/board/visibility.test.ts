import { describe, expect, it } from 'vitest';
import { columnMode, countsByStatus, defaultMobileTab, visibleOrders } from '@/lib/board/visibility';
import { ORDER_STATUSES, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';

const VENDOR_A = 'a'.repeat(24);
const VENDOR_B = 'b'.repeat(24);
const INSTALLER_A = 'c'.repeat(24);

const ops: Persona = { kind: 'ops' };
const vendorA: Persona = { kind: 'vendor', id: VENDOR_A };
const installer: Persona = { kind: 'installer', id: INSTALLER_A };

function order(id: string, status: OrderStatus, vendorId = VENDOR_A): OrderDTO {
  return {
    id,
    orderNumber: `SC-${id}`,
    title: 'Fascia sign',
    customerName: 'Riverside Bakery',
    signType: 'STOREFRONT',
    widthCm: 240,
    heightCm: 90,
    quantity: 3,
    installAddress: '44 Pine St',
    dueDate: '2026-09-24T00:00:00.000Z',
    notes: null,
    vendorId,
    status,
    version: 1,
    history: [],
    createdAt: '2026-09-16T12:00:00.000Z',
    updatedAt: '2026-09-16T12:00:00.000Z',
    installJob: null,
    assets: [],
  };
}

describe('visibleOrders', () => {
  const orders = [order('1', 'DRAFT', VENDOR_A), order('2', 'SUBMITTED', VENDOR_B), order('3', 'COMPLETED', VENDOR_A)];

  it('gives ops every order', () => {
    expect(visibleOrders(orders, ops).map((o) => o.id)).toEqual(['1', '2', '3']);
  });

  it('gives a vendor only their own orders', () => {
    expect(visibleOrders(orders, vendorA).map((o) => o.id)).toEqual(['1', '3']);
  });

  it('gives an installer every order', () => {
    expect(visibleOrders(orders, installer).map((o) => o.id)).toEqual(['1', '2', '3']);
  });

  it('does not mutate the input', () => {
    const copy = [...orders];
    visibleOrders(orders, vendorA);
    expect(orders).toEqual(copy);
  });
});

describe('columnMode', () => {
  it('collapses CANCELLED to a rail unless expanded', () => {
    expect(columnMode('CANCELLED', ops, false)).toBe('rail');
    expect(columnMode('CANCELLED', ops, true)).toBe('column');
  });

  it('keeps every other status a column for ops', () => {
    for (const status of ORDER_STATUSES.filter((s) => s !== 'CANCELLED')) {
      expect(columnMode(status, ops, false)).toBe('column');
    }
  });

  it('keeps every other status a column for a vendor', () => {
    for (const status of ORDER_STATUSES.filter((s) => s !== 'CANCELLED')) {
      expect(columnMode(status, vendorA, false)).toBe('column');
    }
  });

  it('gives an installer columns only for READY_FOR_INSTALL and COMPLETED', () => {
    expect(columnMode('READY_FOR_INSTALL', installer, false)).toBe('column');
    expect(columnMode('COMPLETED', installer, false)).toBe('column');
    for (const status of ['DRAFT', 'SUBMITTED', 'VENDOR_ACCEPTED', 'IN_PRODUCTION'] as OrderStatus[]) {
      expect(columnMode(status, installer, false)).toBe('rail');
    }
  });

  it('still lets an installer expand the cancelled rail', () => {
    expect(columnMode('CANCELLED', installer, false)).toBe('rail');
    expect(columnMode('CANCELLED', installer, true)).toBe('column');
  });
});

describe('countsByStatus', () => {
  it('counts every status and zero-fills the rest', () => {
    const counts = countsByStatus([order('1', 'DRAFT'), order('2', 'DRAFT'), order('3', 'READY_FOR_INSTALL')]);
    expect(counts.DRAFT).toBe(2);
    expect(counts.READY_FOR_INSTALL).toBe(1);
    expect(counts.SUBMITTED).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('returns all zeroes for an empty board', () => {
    const counts = countsByStatus([]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe('defaultMobileTab', () => {
  it('returns the first non-empty status in ORDER_STATUSES order', () => {
    expect(defaultMobileTab([order('1', 'COMPLETED'), order('2', 'SUBMITTED')], ops)).toBe('SUBMITTED');
  });

  it('falls back to DRAFT when nothing is visible', () => {
    expect(defaultMobileTab([], ops)).toBe('DRAFT');
    expect(defaultMobileTab([order('1', 'SUBMITTED', VENDOR_B)], vendorA)).toBe('DRAFT');
  });

  it('only considers orders the persona can see', () => {
    const orders = [order('1', 'DRAFT', VENDOR_B), order('2', 'IN_PRODUCTION', VENDOR_A)];
    expect(defaultMobileTab(orders, ops)).toBe('DRAFT');
    expect(defaultMobileTab(orders, vendorA)).toBe('IN_PRODUCTION');
  });
});
