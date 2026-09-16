import { objectIdSchema } from '@/lib/domain/schemas';
import { ApiError } from './errors';

/** Awaits a Next 15 dynamic `[id]` param and validates it's a Mongo ObjectId; malformed -> 404. */
export async function parseId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) throw new ApiError(404, 'NOT_FOUND');
  return id;
}
