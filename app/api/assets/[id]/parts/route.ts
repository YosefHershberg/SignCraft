import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { partsSchema } from '@/lib/domain/schemas';
import { presignParts } from '@/lib/services/assets';

export const runtime = 'nodejs';

/**
 * POST /api/assets/:id/parts — pipeline 3, step 3: presigns one batch of
 * part URLs (re-checks the order is still uploadable). Persona: ops. Body:
 * `{partNumbers: number[]}` (1-20 items, each 1-10000). 200
 * `{urls: [{partNumber, url}]}`. Errors: 400 (incl. GUARD_FAILED), 403, 404,
 * 409 VERSION_CONFLICT `{status}` if the asset isn't PENDING/UPLOADING, 502.
 */
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, partsSchema);
  return json({ urls: await presignParts(id, body.partNumbers, persona) });
});
