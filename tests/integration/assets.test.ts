import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { resetDb, makeVendor, makeOrder } from '@/tests/helpers/db';
import type { CreateAssetInput } from '@/lib/domain/schemas';
import type { Persona } from '@/lib/domain/types';

vi.mock('@/lib/storage/r2', () => ({
  storage: {
    createMultipart: vi.fn(async () => ({ uploadId: 'u1' })),
    presignPart: vi.fn(async (_k: string, _u: string, n: number) => `https://r2.example/part/${n}`),
    completeMultipart: vi.fn(async () => {}),
    abortMultipart: vi.fn(async () => {}),
  },
  storageKeyFor: (o: string, a: string, f: string) => `orders/${o}/${a}/${f}`,
}));

import { storage } from '@/lib/storage/r2';
import { createAsset, presignParts, reportProgress, completeAsset, abortAsset } from '@/lib/services/assets';

const OPS: Persona = { kind: 'ops' };
const ONE_GIB = 1024 ** 3;

describe('assets service', () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  async function makeDraftOrder(overrides: Parameters<typeof makeOrder>[1] = {}) {
    const vendor = await makeVendor(`Vendor ${Math.random().toString(36).slice(2)}`);
    const order = await makeOrder(vendor.id, overrides);
    return { vendor, order };
  }

  function assetInput(orderId: string, overrides: Partial<CreateAssetInput> = {}): CreateAssetInput {
    return {
      orderId,
      fileName: 'artwork.png',
      contentType: 'image/png',
      sizeBytes: ONE_GIB,
      simulated: true,
      ...overrides,
    };
  }

  async function createUploadingAsset(sizeBytes = ONE_GIB) {
    const { order } = await makeDraftOrder({ status: 'DRAFT' });
    const result = await createAsset(assetInput(order.id, { sizeBytes }), OPS);
    return { order, result };
  }

  it('creates an asset on a DRAFT order: PENDING -> UPLOADING with a real uploadId and correct part plan', async () => {
    const { order } = await makeDraftOrder({ status: 'DRAFT' });

    const result = await createAsset(assetInput(order.id, { sizeBytes: ONE_GIB }), OPS);

    expect(result.uploadId).toBe('u1');
    expect(result.partCount).toBe(103);
    expect(result.partSize).toBe(10 * 1024 * 1024);
    expect(result.asset.status).toBe('UPLOADING');
    expect(result.asset.orderId).toBe(order.id);
    expect(storage.createMultipart).toHaveBeenCalledTimes(1);

    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('UPLOADING');
    expect(db.uploadId).toBe('u1');
    expect(db.storageKey).toBe(`orders/${order.id}/${db.id}/artwork.png`);
  });

  it('rejects creation on an order that is not uploadable', async () => {
    const { order } = await makeDraftOrder({ status: 'IN_PRODUCTION' });

    await expect(createAsset(assetInput(order.id), OPS)).rejects.toMatchObject({
      status: 400,
      code: 'GUARD_FAILED',
      details: { reason: 'ORDER_NOT_UPLOADABLE' },
    });
    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('rejects creation by a non-ops persona', async () => {
    const { order, vendor } = await makeDraftOrder({ status: 'DRAFT' });
    const vendorPersona: Persona = { kind: 'vendor', id: vendor.id };

    await expect(createAsset(assetInput(order.id), vendorPersona)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('marks the asset FAILED and rethrows when createMultipart fails, keeping the row for retry', async () => {
    const { order } = await makeDraftOrder({ status: 'DRAFT' });
    vi.mocked(storage.createMultipart).mockRejectedValueOnce(new ApiError(502, 'STORAGE_ERROR'));

    await expect(createAsset(assetInput(order.id), OPS)).rejects.toMatchObject({
      status: 502,
      code: 'STORAGE_ERROR',
    });

    const db = await prisma.asset.findFirstOrThrow({ where: { orderId: order.id } });
    expect(db.status).toBe('FAILED');
    expect(db.uploadId).toBeNull();
  });

  it('presigns a URL per requested part number', async () => {
    const { result } = await createUploadingAsset();

    const presigned = await presignParts(result.asset.id, [1, 2, 3], OPS);

    expect(presigned).toHaveLength(3);
    expect(presigned).toEqual([
      { partNumber: 1, url: 'https://r2.example/part/1' },
      { partNumber: 2, url: 'https://r2.example/part/2' },
      { partNumber: 3, url: 'https://r2.example/part/3' },
    ]);
    expect(storage.presignPart).toHaveBeenCalledTimes(3);
  });

  it('presignParts 404s for a missing asset', async () => {
    await expect(presignParts('507f1f77bcf86cd799439011', [1], OPS)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('presignParts 409s once the asset is no longer PENDING/UPLOADING', async () => {
    const { result } = await createUploadingAsset();
    await prisma.asset.update({ where: { id: result.asset.id }, data: { status: 'UPLOADED' } });

    await expect(presignParts(result.asset.id, [1], OPS)).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      details: { status: 'UPLOADED' },
    });
  });

  it('reportProgress sets progressPct to 50 for half the bytes, and is a no-op once terminal', async () => {
    const size = 200;
    const { result } = await createUploadingAsset(size);

    await reportProgress(result.asset.id, size / 2);

    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.progressPct).toBe(50);
    expect(Number(db.bytesUploaded)).toBe(100);

    await prisma.asset.update({ where: { id: result.asset.id }, data: { status: 'UPLOADED' } });
    await reportProgress(result.asset.id, size);
    const db2 = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db2.progressPct).toBe(50); // untouched: reportProgress no-ops once not UPLOADING
  });

  it('completeAsset 409s on an asset that is not UPLOADING, without touching storage', async () => {
    const { result } = await createUploadingAsset();
    await prisma.asset.update({ where: { id: result.asset.id }, data: { status: 'UPLOADED' } });

    await expect(
      completeAsset(result.asset.id, [{ partNumber: 1, etag: 'e1' }], OPS)
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', details: { status: 'UPLOADED' } });

    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });

  it('completeAsset marks UPLOADED and calls completeMultipart with parts sorted by partNumber', async () => {
    const { order, result } = await createUploadingAsset();

    const dto = await completeAsset(
      result.asset.id,
      [
        { partNumber: 2, etag: 'e2' },
        { partNumber: 1, etag: 'e1' },
        { partNumber: 3, etag: 'e3' },
      ],
      OPS
    );

    expect(dto.status).toBe('UPLOADED');
    expect(dto.progressPct).toBe(100);
    expect(dto.bytesUploaded).toBe(ONE_GIB);
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      expect.stringContaining(`orders/${order.id}/`),
      'u1',
      [
        { partNumber: 1, etag: 'e1' },
        { partNumber: 2, etag: 'e2' },
        { partNumber: 3, etag: 'e3' },
      ]
    );

    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('UPLOADED');
    expect(db.uploadId).toBeNull();
  });

  it('completeAsset marks FAILED and rethrows when storage reports STORAGE_ERROR', async () => {
    const { result } = await createUploadingAsset();
    vi.mocked(storage.completeMultipart).mockRejectedValueOnce(new ApiError(502, 'STORAGE_ERROR'));

    await expect(
      completeAsset(result.asset.id, [{ partNumber: 1, etag: 'e1' }], OPS)
    ).rejects.toMatchObject({ status: 502, code: 'STORAGE_ERROR' });

    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('FAILED');
  });

  it('rejects presign and complete once the order has moved past SUBMITTED mid-upload', async () => {
    const { order, result } = await createUploadingAsset();
    // The vendor accepts while the parts are still in flight.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'VENDOR_ACCEPTED' } });

    await expect(presignParts(result.asset.id, [1], OPS)).rejects.toMatchObject({
      status: 400,
      code: 'GUARD_FAILED',
      details: { reason: 'ORDER_NOT_UPLOADABLE' },
    });

    await expect(completeAsset(result.asset.id, [{ partNumber: 1, etag: 'e1' }], OPS)).rejects.toMatchObject({
      status: 400,
      code: 'GUARD_FAILED',
      details: { reason: 'ORDER_NOT_UPLOADABLE' },
    });

    expect(storage.presignPart).not.toHaveBeenCalled();
    expect(storage.completeMultipart).not.toHaveBeenCalled();

    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('UPLOADING'); // refused, not failed: Abort is still the way out
  });

  it('abortAsset marks ABORTED and calls abortMultipart', async () => {
    const { result } = await createUploadingAsset();

    await abortAsset(result.asset.id);

    expect(storage.abortMultipart).toHaveBeenCalledWith(expect.stringContaining('orders/'), 'u1');
    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('ABORTED');
    expect(db.uploadId).toBeNull();
  });

  it("abortAsset with reason 'error' marks FAILED so the row can offer Retry", async () => {
    const { result } = await createUploadingAsset();

    await abortAsset(result.asset.id, 'error');

    // The R2 upload is still abandoned — only the terminal status differs.
    expect(storage.abortMultipart).toHaveBeenCalledWith(expect.stringContaining('orders/'), 'u1');
    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('FAILED');
    expect(db.uploadId).toBeNull();
  });

  it('abortAsset is a no-op once the asset is already terminal', async () => {
    const { result } = await createUploadingAsset();
    await prisma.asset.update({ where: { id: result.asset.id }, data: { status: 'UPLOADED' } });

    await abortAsset(result.asset.id);

    expect(storage.abortMultipart).not.toHaveBeenCalled();
    const db = await prisma.asset.findUniqueOrThrow({ where: { id: result.asset.id } });
    expect(db.status).toBe('UPLOADED');
  });
});
