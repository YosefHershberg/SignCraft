import { parsePersona } from '@/lib/domain/personas';
import type { Persona } from '@/lib/domain/types';
import { ApiError } from './errors';

function cookiePersona(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split('; ')) {
    const [name, ...rest] = part.split('=');
    if (name === 'sc_persona') return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function getPersona(req: Request): Persona | null {
  const header = req.headers.get('x-persona');
  const raw = header ?? cookiePersona(req);
  return parsePersona(raw);
}

export function requirePersona(req: Request): Persona {
  const persona = getPersona(req);
  if (!persona) throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');
  return persona;
}

export function requireKind<K extends Persona['kind']>(req: Request, kind: K): Extract<Persona, { kind: K }> {
  const persona = requirePersona(req);
  if (persona.kind !== kind) throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');
  return persona as Extract<Persona, { kind: K }>;
}
