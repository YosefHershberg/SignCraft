/** Route-param glue for the `[id]` handlers. */
import { objectIdSchema } from '@/lib/domain/schemas';
import { ApiError } from './errors';

/**
 * Awaits a Next 15 dynamic `[id]` param and validates it's a Mongo ObjectId; malformed -> 404.
 *
 * Next 15 hands `params` to a route handler as a Promise, hence the await.
 * The validation exists because Prisma throws on a non-ObjectId `where.id`,
 * which would surface as a 500 — a garbage id is a "no such thing", so 404.
 */
export async function parseId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) throw new ApiError(404, 'NOT_FOUND');
  return id;
}
