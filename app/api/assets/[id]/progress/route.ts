import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { noContent } from '@/lib/api/respond';
import { progressSchema } from '@/lib/domain/schemas';
import { reportProgress } from '@/lib/services/assets';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  requireKind(req, 'ops');
  const body = await parseBody(req, progressSchema);
  await reportProgress(id, body.bytesUploaded);
  return noContent();
});
