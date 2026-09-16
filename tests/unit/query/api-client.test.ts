import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '@/lib/query/api-client';

describe('api()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends content-type and x-persona headers for an ops persona', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/bootstrap', { persona: { kind: 'ops' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bootstrap');
    expect(init.method).toBe('GET');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-persona']).toBe('ops');
  });

  it('serialises a vendor persona into x-persona and sends the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/orders', {
      method: 'POST',
      body: { title: 'Sign' },
      persona: { kind: 'vendor', id: '507f1f77bcf86cd799439011' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['x-persona']).toBe('vendor:507f1f77bcf86cd799439011');
    expect(init.body).toBe(JSON.stringify({ title: 'Sign' }));
  });

  it('returns undefined on a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api('/api/assets/x/abort', { method: 'POST', persona: { kind: 'ops' } });

    expect(result).toBeUndefined();
  });

  it('parses an error body into an ApiClientError with status, code, message and details', async () => {
    const errorBody = {
      error: {
        code: 'INVALID_TRANSITION',
        message: 'Cannot move DRAFT to CANCELLED',
        details: { allowed: ['SUBMITTED'] },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = api('/api/orders/1/transition', { method: 'POST', persona: { kind: 'ops' } });

    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_TRANSITION',
      message: 'Cannot move DRAFT to CANCELLED',
      details: { allowed: ['SUBMITTED'] },
    });
  });

  it('falls back to a generic code when the error body is malformed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = api('/api/bootstrap', { persona: { kind: 'ops' } });

    await expect(promise).rejects.toMatchObject({ status: 500, code: 'UNKNOWN' });
  });
});
