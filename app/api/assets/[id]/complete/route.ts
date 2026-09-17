import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { completeSchema } from '@/lib/domain/schemas';
import { completeAsset } from '@/lib/services/assets';

export const runtime = 'nodejs';

/**
 * POST /api/assets/:id/complete — pipeline 3, step 5: finishes the R2
 * multipart upload. Persona: ops. Body: `{parts: [{partNumber, etag}]}`
 * (1-10000 items). 200 `AssetDTO` (UPLOADED). Errors: 400, 403, 404, 409
 * VERSION_CONFLICT, 502 STORAGE_ERROR (asset left FAILED).
 */
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, completeSchema);
  return json(await completeAsset(id, body.parts, persona));
});
