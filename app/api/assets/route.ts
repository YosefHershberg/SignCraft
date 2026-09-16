import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { json } from '@/lib/api/respond';
import { createAssetSchema } from '@/lib/domain/schemas';
import { createAsset } from '@/lib/services/assets';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request) => {
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, createAssetSchema);
  return json(await createAsset(body, persona), 201);
});
