import type { z } from 'zod';
import { ApiError } from './errors';

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR');
  }
  return schema.parse(raw);
}
