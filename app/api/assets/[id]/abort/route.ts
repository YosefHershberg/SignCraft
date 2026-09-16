import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseId } from '@/lib/api/params';
import { noContent } from '@/lib/api/respond';
import { abortAsset } from '@/lib/services/assets';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  requireKind(req, 'ops');
  await abortAsset(id);
  return noContent();
});
