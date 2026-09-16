import { describe, expect, it, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { ApiError, errorResponse, withErrorHandling, fromVerdict } from '@/lib/api/errors';

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

describe('ApiError default messages', () => {
  it('builds a default message for INVALID_TRANSITION from details', () => {
    const err = new ApiError(400, 'INVALID_TRANSITION', { from: 'DRAFT', to: 'IN_PRODUCTION' });
    expect(err.message).toBe('Cannot move DRAFT to IN_PRODUCTION');
  });

  it('builds a default message for CLAIM_TAKEN', () => {
    const err = new ApiError(409, 'CLAIM_TAKEN');
    expect(err.message).toBe('Another installer claimed this job a moment ago');
  });

  it('builds a default message for CLAIM_EXPIRED', () => {
    const err = new ApiError(409, 'CLAIM_EXPIRED');
    expect(err.message).toBe('Your claim has expired');
  });

  it('builds a default message for VERSION_CONFLICT', () => {
    const err = new ApiError(409, 'VERSION_CONFLICT');
    expect(err.message).toBe('The order changed; refresh and try again');
  });

  it('builds a GUARD_FAILED message per reason', () => {
    expect(new ApiError(400, 'GUARD_FAILED', { reason: 'NO_UPLOADED_ASSET' }).message).toBe(
      'Needs at least one uploaded file'
    );
    expect(new ApiError(400, 'GUARD_FAILED', { reason: 'NO_ASSIGNED_INSTALLER' }).message).toBe(
      'Needs an assigned installer'
    );
    expect(new ApiError(400, 'GUARD_FAILED', { reason: 'ORDER_NOT_UPLOADABLE' }).message).toBe(
      'Files can only be uploaded while the order is Draft or Submitted'
    );
  });

  it('accepts an explicit message override', () => {
    const err = new ApiError(404, 'NOT_FOUND', undefined, 'Order not found');
    expect(err.message).toBe('Order not found');
  });
});

describe('errorResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps an ApiError to its status and wire body', async () => {
    const res = errorResponse(new ApiError(409, 'CLAIM_TAKEN'));
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body).toEqual({
      error: {
        code: 'CLAIM_TAKEN',
        message: 'Another installer claimed this job a moment ago',
        details: undefined,
      },
    });
  });

  it('maps a ZodError to 400 VALIDATION_ERROR with flattened details', async () => {
    const schema = z.object({ title: z.string().min(1) });
    const result = schema.safeParse({ title: '' });
    expect(result.success).toBe(false);
    const res = errorResponse(result.error);
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fieldErrors).toHaveProperty('title');
  });

  it('maps an unknown error to 500 INTERNAL and logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.error.code).toBe('INTERNAL');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('withErrorHandling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through a successful response', async () => {
    const handler = withErrorHandling(async (_req: Request) => new Response('ok', { status: 200 }));
    const res = await handler(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('converts a thrown ApiError into an error response', async () => {
    const handler = withErrorHandling(async (_req: Request) => {
      throw new ApiError(404, 'NOT_FOUND');
    });
    const res = await handler(new Request('http://x'));
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('converts a thrown unknown error into a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withErrorHandling(async (_req: Request) => {
      throw new Error('nope');
    });
    const res = await handler(new Request('http://x'));
    expect(res.status).toBe(500);
  });
});

describe('fromVerdict', () => {
  it('maps INVALID_TRANSITION with from/to/allowed', () => {
    const err = fromVerdict(
      { ok: false, code: 'INVALID_TRANSITION', allowed: ['SUBMITTED', 'CANCELLED'] },
      { from: 'DRAFT', to: 'IN_PRODUCTION' }
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.details).toEqual({ from: 'DRAFT', to: 'IN_PRODUCTION', allowed: ['SUBMITTED', 'CANCELLED'] });
  });

  it('maps GUARD_FAILED with reason', () => {
    const err = fromVerdict({ ok: false, code: 'GUARD_FAILED', reason: 'NO_UPLOADED_ASSET' });
    expect(err.status).toBe(400);
    expect(err.code).toBe('GUARD_FAILED');
    expect(err.details).toEqual({ reason: 'NO_UPLOADED_ASSET' });
  });

  it('maps FORBIDDEN_FOR_PERSONA to 403', () => {
    const err = fromVerdict({ ok: false, code: 'FORBIDDEN_FOR_PERSONA' });
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN_FOR_PERSONA');
  });
});
