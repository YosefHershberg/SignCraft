import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { json } from '@/lib/api/respond';
import { createAssetSchema } from '@/lib/domain/schemas';
import { createAsset } from '@/lib/services/assets';

export const runtime = 'nodejs';

/**
 * POST /api/assets — pipeline 3, step 1: creates the Asset row and the R2
 * multipart upload. Persona: ops. Body: `createAssetSchema` `{orderId,
 * fileName, contentType, sizeBytes, simulated?}`. 201 `{asset, uploadId,
 * partSize, partCount}`. Errors: 400 VALIDATION_ERROR / GUARD_FAILED, 403,
 * 404, 502 STORAGE_ERROR.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, createAssetSchema);
  return json(await createAsset(body, persona), 201);
});
