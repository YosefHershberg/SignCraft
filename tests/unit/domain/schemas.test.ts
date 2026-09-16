import { describe, expect, it } from 'vitest';
import {
  createOrderSchema,
  transitionSchema,
  verifySchema,
  createAssetSchema,
  partsSchema,
  progressSchema,
  completeSchema,
} from '@/lib/domain/schemas';

const VENDOR_ID = 'a'.repeat(24);

describe('createOrderSchema', () => {
  const validPayload = {
    title: 'Storefront sign',
    customerName: 'Acme Co',
    signType: 'STOREFRONT' as const,
    widthCm: 100,
    heightCm: 50,
    quantity: 1,
    vendorId: VENDOR_ID,
    installAddress: '123 Main St',
    dueDate: '2026-10-01',
    notes: null,
  };

  it('accepts a valid payload', () => {
    expect(createOrderSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects widthCm 0', () => {
    const result = createOrderSchema.safeParse({ ...validPayload, widthCm: 0 });
    expect(result.success).toBe(false);
  });
});

describe('transitionSchema', () => {
  it('rejects an unknown status', () => {
    expect(transitionSchema.safeParse({ to: 'FOO' }).success).toBe(false);
  });

  it('accepts a valid status', () => {
    expect(transitionSchema.safeParse({ to: 'SUBMITTED' }).success).toBe(true);
  });
});

describe('verifySchema', () => {
  it('accepts pass/fail', () => {
    expect(verifySchema.safeParse({ outcome: 'pass' }).success).toBe(true);
    expect(verifySchema.safeParse({ outcome: 'fail' }).success).toBe(true);
  });

  it('rejects other values', () => {
    expect(verifySchema.safeParse({ outcome: 'maybe' }).success).toBe(false);
  });
});

describe('createAssetSchema', () => {
  it('accepts a valid payload and defaults simulated to false', () => {
    const result = createAssetSchema.safeParse({
      orderId: VENDOR_ID,
      fileName: 'file.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.simulated).toBe(false);
  });

  it('rejects sizeBytes 0', () => {
    const result = createAssetSchema.safeParse({
      orderId: VENDOR_ID,
      fileName: 'file.pdf',
      contentType: 'application/pdf',
      sizeBytes: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('partsSchema', () => {
  it('rejects 21 part numbers', () => {
    const partNumbers = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(partsSchema.safeParse({ partNumbers }).success).toBe(false);
  });

  it('accepts 20 part numbers', () => {
    const partNumbers = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(partsSchema.safeParse({ partNumbers }).success).toBe(true);
  });
});

describe('progressSchema', () => {
  it('accepts a non-negative integer', () => {
    expect(progressSchema.safeParse({ bytesUploaded: 0 }).success).toBe(true);
  });

  it('rejects a negative value', () => {
    expect(progressSchema.safeParse({ bytesUploaded: -1 }).success).toBe(false);
  });
});

describe('completeSchema', () => {
  it('accepts a non-empty parts array', () => {
    expect(completeSchema.safeParse({ parts: [{ partNumber: 1, etag: 'abc' }] }).success).toBe(true);
  });

  it('rejects an empty parts array', () => {
    expect(completeSchema.safeParse({ parts: [] }).success).toBe(false);
  });
});
