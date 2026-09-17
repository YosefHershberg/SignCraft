/** Request-body validation for route handlers. */
import type { z } from 'zod';
import { ApiError } from './errors';

/**
 * Reads and validates a JSON body against one of the `lib/domain/schemas.ts`
 * schemas. Malformed JSON is a 400 VALIDATION_ERROR here; a schema failure
 * throws the `ZodError` itself so `errorResponse` can attach the flattened
 * field errors. Every POST handler except abort (optional body) uses this.
 */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR');
  }
  return schema.parse(raw);
}
