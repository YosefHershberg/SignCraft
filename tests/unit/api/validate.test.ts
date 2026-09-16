import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from '@/lib/api/validate';
import { ApiError } from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/errors';

const schema = z.object({ title: z.string().min(1) });

function reqWithBody(body: string) {
  return new Request('http://x', { method: 'POST', body });
}

describe('parseBody', () => {
  it('parses a valid JSON body against the schema', async () => {
    const result = await parseBody(reqWithBody(JSON.stringify({ title: 'hello' })), schema);
    expect(result).toEqual({ title: 'hello' });
  });

  it('throws ApiError(400, VALIDATION_ERROR) for invalid JSON', async () => {
    try {
      await parseBody(reqWithBody('{bad'), schema);
      throw new Error('expected parseBody to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('propagates a ZodError for a schema failure, which errorResponse maps to 400', async () => {
    let caught: unknown;
    try {
      await parseBody(reqWithBody(JSON.stringify({ title: '' })), schema);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
    const res = errorResponse(caught);
    expect(res.status).toBe(400);
    const body = JSON.parse(await res.text());
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
