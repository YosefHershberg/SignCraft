/**
 * The error contract (architecture §12): the one `ApiError` class services
 * throw, the `{ error: { code, message, details } }` envelope every failed
 * response carries, and the `withErrorHandling` wrapper that keeps route
 * handlers free of try/catch. Also the bridge from a domain `Denial` to an
 * HTTP status (`fromVerdict`).
 */
import { z } from 'zod';
import type { Denial } from '@/lib/domain/permissions';
import type { OrderStatus } from '@/lib/domain/types';
import { json } from './respond';

/** Every `code` the API can emit; the client switches on these (e.g. 409s trigger a refetch, `INVALID_TRANSITION` renders the allowed list). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_TRANSITION'
  | 'GUARD_FAILED'
  | 'FORBIDDEN_FOR_PERSONA'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'CLAIM_TAKEN'
  | 'CLAIM_EXPIRED'
  | 'NOT_CLAIMANT'
  | 'STORAGE_ERROR'
  | 'INTERNAL';

const GUARD_FAILED_MESSAGES: Record<string, string> = {
  NO_UPLOADED_ASSET: 'Needs at least one uploaded file',
  NO_ASSIGNED_INSTALLER: 'Needs an assigned installer',
  ORDER_NOT_UPLOADABLE: 'Files can only be uploaded while the order is Draft or Submitted',
};

/**
 * Human copy per code, so a service only names the code and the client can
 * show `message` verbatim (toasts, `InlineError`). GUARD_FAILED and
 * INVALID_TRANSITION read `details` to be specific about what was missing.
 */
function defaultMessage(code: ErrorCode, details?: Record<string, unknown>): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Invalid request';
    case 'INVALID_TRANSITION':
      return `Cannot move ${details?.from} to ${details?.to}`;
    case 'GUARD_FAILED': {
      const reason = typeof details?.reason === 'string' ? details.reason : undefined;
      return (reason && GUARD_FAILED_MESSAGES[reason]) ?? 'Guard failed';
    }
    case 'FORBIDDEN_FOR_PERSONA':
      return 'This action is not available for your persona';
    case 'NOT_FOUND':
      return 'Not found';
    case 'VERSION_CONFLICT':
      return 'The order changed; refresh and try again';
    case 'CLAIM_TAKEN':
      return 'Another installer claimed this job a moment ago';
    case 'CLAIM_EXPIRED':
      return 'Your claim has expired';
    case 'NOT_CLAIMANT':
      return 'You are not the installer who claimed this job';
    case 'STORAGE_ERROR':
      return 'Storage request failed';
    case 'INTERNAL':
    default:
      return 'Internal server error';
  }
}

/**
 * The only error type services throw (CLAUDE.md conventions): HTTP status +
 * machine code + optional `details` for the client to act on (`allowed`,
 * `reason`, `status`, `op`). `message` defaults from the code, so callers
 * rarely pass one.
 */
export class ApiError extends Error {
  public status: number;
  public code: ErrorCode;
  public details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? defaultMessage(code, details));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Anything thrown → the wire envelope. `ApiError` keeps its status and code;
 * a `ZodError` from `parseBody` becomes 400 VALIDATION_ERROR with
 * `z.flattenError` (`{formErrors, fieldErrors}`) so forms can highlight
 * fields; everything else is logged and becomes an opaque 500 INTERNAL.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof z.ZodError) {
    return json(
      { error: { code: 'VALIDATION_ERROR', message: defaultMessage('VALIDATION_ERROR'), details: z.flattenError(err) } },
      400
    );
  }
  console.error(err);
  return json({ error: { code: 'INTERNAL', message: defaultMessage('INTERNAL') } }, 500);
}

/**
 * Wraps a route handler so it can `throw` from any depth (persona check, Zod,
 * service) and still answer with the envelope. Every `app/api/**` handler is
 * exported through this; it is what lets routes stay parse → persona →
 * service → respond with no error branches (Invariant 7).
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...a: T) => Promise<Response>
): (...a: T) => Promise<Response> {
  return async (...a: T) => {
    try {
      return await fn(...a);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * Domain `Denial` → HTTP. INVALID_TRANSITION and GUARD_FAILED are 400 (the
 * request is wrong for this order), FORBIDDEN_FOR_PERSONA is 403 (the caller
 * is wrong). `ctx` adds `from`/`to` so the 400 body reads
 * `{from, to, allowed}` — the list `InlineError` renders (UI spec §7.5).
 */
export function fromVerdict(v: Denial, ctx?: { from: OrderStatus; to: OrderStatus }): ApiError {
  switch (v.code) {
    case 'INVALID_TRANSITION':
      return new ApiError(400, 'INVALID_TRANSITION', { from: ctx?.from, to: ctx?.to, allowed: v.allowed });
    case 'GUARD_FAILED':
      return new ApiError(400, 'GUARD_FAILED', { reason: v.reason });
    case 'FORBIDDEN_FOR_PERSONA':
    default:
      return new ApiError(403, 'FORBIDDEN_FOR_PERSONA');
  }
}
