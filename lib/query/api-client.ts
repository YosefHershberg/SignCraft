// Client-side query layer: the one fetch wrapper every `lib/query/hooks.ts`
// query and mutation goes through. Turns the server's `{ error }` envelope
// into a typed `ApiClientError` so callers can branch on `status`/`code`
// (e.g. `invalidateOn409`) instead of parsing responses themselves.
import type { Persona } from '@/lib/domain/types';
import { serialisePersona } from '@/lib/domain/personas';

/** Client-side mirror of the server's `{ error }` envelope (lib/api/errors.ts). */
export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** `api()`'s request options; `persona` is required so no call can forget the `x-persona` header the server needs to authorise it. */
interface ApiInit {
  method?: string;
  body?: unknown;
  persona: Persona;
}

/** The shape of a non-2xx JSON body, mirroring `lib/api/errors.ts`'s wire format. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/**
 * Thin fetch wrapper: JSON in, JSON out, x-persona always set (even on GET,
 * so the server could use it later). A 204 resolves to undefined. A
 * non-2xx response is parsed as `{ error }` and rejected as ApiClientError.
 */
export async function api<T>(path: string, init: ApiInit): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-persona': serialisePersona(init.persona),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!res.ok) {
    const error = (parsed as ErrorEnvelope | undefined)?.error;
    throw new ApiClientError(res.status, error?.code ?? 'UNKNOWN', error?.message ?? 'Request failed', error?.details);
  }

  return parsed as T;
}
