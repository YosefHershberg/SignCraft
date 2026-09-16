import { describe, expect, it } from 'vitest';
import { normalise, toJobDTO, toAssetDTO, toOrderDTO } from '@/lib/services/dto';

const now = new Date('2026-09-16T12:00:00.000Z');

function fakeObjectId(hex: string) {
  return { toHexString: () => hex };
}

function fakeLong(n: number) {
  return { toNumber: () => n };
}

describe('normalise', () => {
  it('converts an ObjectId-like value to its hex string', () => {
    expect(normalise(fakeObjectId('abc'))).toBe('abc');
  });

  it('converts a Date to an ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(normalise(d)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('converts a bigint to a number', () => {
    expect(normalise(10485760n)).toBe(10485760);
  });

  it('converts a Long-like value to a number', () => {
    expect(normalise(fakeLong(42))).toBe(42);
  });

  it('renames the _id key to id', () => {
    expect(normalise({ _id: fakeObjectId('xyz'), name: 'Acme' })).toEqual({ id: 'xyz', name: 'Acme' });
  });

  it('recurses through nested arrays and objects', () => {
    const input = {
      _id: fakeObjectId('order1'),
      history: [
        { at: new Date('2026-01-02T00:00:00.000Z'), vendorId: fakeObjectId('v1') },
        { at: new Date('2026-01-03T00:00:00.000Z'), vendorId: fakeObjectId('v2') },
      ],
    };
    expect(normalise(input)).toEqual({
      id: 'order1',
      history: [
        { at: '2026-01-02T00:00:00.000Z', vendorId: 'v1' },
        { at: '2026-01-03T00:00:00.000Z', vendorId: 'v2' },
      ],
    });
  });

  it('passes through null and primitive values unchanged', () => {
    expect(normalise(null)).toBeNull();
    expect(normalise(undefined)).toBeUndefined();
    expect(normalise('plain')).toBe('plain');
    expect(normalise(5)).toBe(5);
    expect(normalise(true)).toBe(true);
  });
});

describe('toJobDTO', () => {
  const orderId = fakeObjectId('order1');
  const jobId = fakeObjectId('job1');

  it('applies lazy expiry: a CLAIMED job with an expired claim maps to OPEN with claim null', () => {
    const raw = {
      _id: jobId,
      orderId,
      status: 'CLAIMED',
      installerId: null,
      claim: {
        installerId: fakeObjectId('installer1'),
        claimedAt: new Date(now.getTime() - 200_000),
        expiresAt: new Date(now.getTime() - 1),
      },
      version: 2,
      createdAt: new Date('2026-09-16T00:00:00.000Z'),
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    };

    const dto = toJobDTO(raw, now);

    expect(dto.status).toBe('OPEN');
    expect(dto.claim).toBeNull();
    expect(dto.id).toBe('job1');
    expect(dto.orderId).toBe('order1');
  });

  it('defaults claim to null and installerId to null when absent', () => {
    const raw = {
      _id: jobId,
      orderId,
      status: 'OPEN',
      version: 1,
      createdAt: new Date('2026-09-16T00:00:00.000Z'),
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    };

    const dto = toJobDTO(raw, now);

    expect(dto.claim).toBeNull();
    expect(dto.installerId).toBeNull();
  });

  it('leaves a live CLAIMED job untouched', () => {
    const raw = {
      _id: jobId,
      orderId,
      status: 'CLAIMED',
      installerId: null,
      claim: {
        installerId: fakeObjectId('installer1'),
        claimedAt: new Date(now.getTime() - 1_000),
        expiresAt: new Date(now.getTime() + 100_000),
      },
      version: 1,
      createdAt: new Date('2026-09-16T00:00:00.000Z'),
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    };

    const dto = toJobDTO(raw, now);

    expect(dto.status).toBe('CLAIMED');
    expect(dto.claim).toEqual({
      installerId: 'installer1',
      claimedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 100_000).toISOString(),
    });
  });
});

describe('toAssetDTO', () => {
  it('converts a bigint sizeBytes to a number', () => {
    const raw = {
      _id: fakeObjectId('asset1'),
      orderId: fakeObjectId('order1'),
      fileName: 'sign.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10485760n,
      storageKey: 'orders/order1/sign.pdf',
      status: 'UPLOADED',
      bytesUploaded: 10485760n,
      progressPct: 100,
      simulated: false,
      createdAt: new Date('2026-09-16T00:00:00.000Z'),
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    };

    const dto = toAssetDTO(raw);

    expect(dto.id).toBe('asset1');
    expect(dto.orderId).toBe('order1');
    expect(dto.sizeBytes).toBe(10485760);
    expect(typeof dto.sizeBytes).toBe('number');
    expect(dto.bytesUploaded).toBe(10485760);
  });
});

describe('toOrderDTO', () => {
  it('maps a Prisma-shaped order with a CLAIMED-expired installJob so installJob.status is OPEN', () => {
    const raw = {
      _id: fakeObjectId('order1'),
      orderNumber: 'ORD-1',
      title: 'Storefront sign',
      customerName: 'Acme',
      signType: 'STOREFRONT',
      widthCm: 100,
      heightCm: 50,
      quantity: 1,
      installAddress: '1 Main St',
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
      vendorId: fakeObjectId('vendor1'),
      status: 'READY_FOR_INSTALL',
      version: 3,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      installJob: {
        _id: fakeObjectId('job1'),
        orderId: fakeObjectId('order1'),
        status: 'CLAIMED',
        installerId: null,
        claim: {
          installerId: fakeObjectId('installer1'),
          claimedAt: new Date(now.getTime() - 200_000),
          expiresAt: new Date(now.getTime() - 1),
        },
        version: 2,
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      assets: [
        {
          _id: fakeObjectId('asset1'),
          orderId: fakeObjectId('order1'),
          fileName: 'sign.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048n,
          storageKey: 'orders/order1/sign.pdf',
          status: 'UPLOADED',
          bytesUploaded: 2048n,
          progressPct: 100,
          simulated: false,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    };

    const dto = toOrderDTO(raw, now);

    expect(dto.id).toBe('order1');
    expect(dto.vendorId).toBe('vendor1');
    expect(dto.installJob).not.toBeNull();
    expect(dto.installJob?.status).toBe('OPEN');
    expect(dto.installJob?.claim).toBeNull();
    expect(dto.assets).toHaveLength(1);
    expect(dto.assets[0].sizeBytes).toBe(2048);
    expect(dto.notes).toBeNull();
    expect(dto.history).toEqual([]);
  });

  it('defaults installJob to null and assets to [] when absent', () => {
    const raw = {
      _id: fakeObjectId('order2'),
      orderNumber: 'ORD-2',
      title: 'Wayfinding sign',
      customerName: 'Acme',
      signType: 'WAYFINDING',
      widthCm: 30,
      heightCm: 30,
      quantity: 2,
      installAddress: '2 Main St',
      dueDate: new Date('2026-10-05T00:00:00.000Z'),
      vendorId: fakeObjectId('vendor1'),
      status: 'DRAFT',
      version: 1,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    };

    const dto = toOrderDTO(raw, now);

    expect(dto.installJob).toBeNull();
    expect(dto.assets).toEqual([]);
  });
});
