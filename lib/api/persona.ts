/**
 * Where a request's persona comes from (ADR-008): the `x-persona` header that
 * `lib/query/api-client.ts` sends, with the `sc_persona` cookie as a fallback
 * for plain browser navigations. Nothing else in the server reads either;
 * services receive a parsed `Persona`.
 */
import { parsePersona } from '@/lib/domain/personas';
import type { Persona } from '@/lib/domain/types';
import { ApiError } from './errors';

/**
 * The raw `sc_persona` value from the Cookie header, or null. Hand-parsed
 * because route handlers get a plain `Request` (no `cookies()` helper) and
 * the cookie is URL-encoded by `writePersonaCookie`.
 */
function cookiePersona(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  // `;` with any (or no) following whitespace — not every client sends `'; '`.
  for (const part of cookie.split(/;\s*/)) {
    const [name, ...rest] = part.split('=');
    if (name === 'sc_persona') {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Header first, cookie second; null when neither parses (see `parsePersona`). */
export function getPersona(req: Request): Persona | null {
  const header = req.headers.get('x-persona');
  const raw = header ?? cookiePersona(req);
  return parsePersona(raw);
}

/** Any persona, or 403 FORBIDDEN_FOR_PERSONA. Used by the transition route, whose rules vary per edge. */
export function requirePersona(req: Request): Persona {
  const persona = getPersona(req);
  if (!persona) throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');
  return persona;
}

/**
 * A persona of exactly `kind` (ops for order/asset creation, installer for
 * claim/verify), narrowed so the handler can read `.id`; anything else is 403.
 */
export function requireKind<K extends Persona['kind']>(req: Request, kind: K): Extract<Persona, { kind: K }> {
  const persona = requirePersona(req);
  if (persona.kind !== kind) throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');
  return persona as Extract<Persona, { kind: K }>;
}
