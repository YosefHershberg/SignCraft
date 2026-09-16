import { describe, expect, it } from 'vitest';
import { getPersona, requirePersona, requireKind } from '@/lib/api/persona';
import { ApiError } from '@/lib/api/errors';

const VENDOR_ID = 'a'.repeat(24);
const INSTALLER_ID = 'b'.repeat(24);

function reqWith(opts: { header?: string; cookie?: string }) {
  const headers = new Headers();
  if (opts.header !== undefined) headers.set('x-persona', opts.header);
  if (opts.cookie !== undefined) headers.set('cookie', opts.cookie);
  return new Request('http://x', { headers });
}

describe('getPersona', () => {
  it('reads persona from the x-persona header', () => {
    expect(getPersona(reqWith({ header: 'ops' }))).toEqual({ kind: 'ops' });
  });

  it('falls back to the sc_persona cookie when there is no header', () => {
    const req = reqWith({ cookie: `sc_persona=installer%3A${INSTALLER_ID}` });
    expect(getPersona(req)).toEqual({ kind: 'installer', id: INSTALLER_ID });
  });

  it('prefers the header over the cookie when both are present', () => {
    const req = reqWith({ header: 'ops', cookie: `sc_persona=vendor%3A${VENDOR_ID}` });
    expect(getPersona(req)).toEqual({ kind: 'ops' });
  });

  it('reads the cookie among several cookies', () => {
    const req = reqWith({ cookie: `other=1; sc_persona=vendor%3A${VENDOR_ID}; another=2` });
    expect(getPersona(req)).toEqual({ kind: 'vendor', id: VENDOR_ID });
  });

  it('returns null when neither header nor cookie is present', () => {
    expect(getPersona(reqWith({}))).toBeNull();
  });

  it('returns null when the header value is invalid', () => {
    expect(getPersona(reqWith({ header: 'vendor:not-an-id' }))).toBeNull();
  });
});

describe('requirePersona', () => {
  it('returns the persona when present', () => {
    expect(requirePersona(reqWith({ header: 'ops' }))).toEqual({ kind: 'ops' });
  });

  it('throws ApiError(403, FORBIDDEN_FOR_PERSONA) when missing', () => {
    try {
      requirePersona(reqWith({}));
      throw new Error('expected requirePersona to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe('FORBIDDEN_FOR_PERSONA');
    }
  });

  it('throws ApiError(403, FORBIDDEN_FOR_PERSONA) when invalid', () => {
    expect(() => requirePersona(reqWith({ header: 'vendor:nope' }))).toThrow(ApiError);
  });
});

describe('requireKind', () => {
  it('returns the persona narrowed to the requested kind', () => {
    const req = reqWith({ header: `vendor:${VENDOR_ID}` });
    const persona = requireKind(req, 'vendor');
    expect(persona).toEqual({ kind: 'vendor', id: VENDOR_ID });
  });

  it('throws 403 when the persona is a different kind', () => {
    const req = reqWith({ header: `vendor:${VENDOR_ID}` });
    try {
      requireKind(req, 'ops');
      throw new Error('expected requireKind to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe('FORBIDDEN_FOR_PERSONA');
    }
  });

  it('throws 403 when there is no persona at all', () => {
    expect(() => requireKind(reqWith({}), 'ops')).toThrow(ApiError);
  });
});
