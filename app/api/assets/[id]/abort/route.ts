import { ApiError, withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseId } from '@/lib/api/params';
import { noContent } from '@/lib/api/respond';
import { abortSchema, type AbortInput } from '@/lib/domain/schemas';
import { abortAsset } from '@/lib/services/assets';

export const runtime = 'nodejs';

/**
 * The body is optional here (unlike every other handler, so `parseBody` does
 * not fit): a bare `POST` — what `navigator.sendBeacon` or curl would send —
 * means the default, a user abort.
 */
async function parseAbortBody(req: Request): Promise<AbortInput> {
  const raw = (await req.text()).trim();
  if (!raw) return abortSchema.parse({});
  try {
    return abortSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SyntaxError) throw new ApiError(400, 'VALIDATION_ERROR');
    throw err;
  }
}

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  requireKind(req, 'ops');
  const { reason } = await parseAbortBody(req);
  await abortAsset(id, reason);
  return noContent();
});
