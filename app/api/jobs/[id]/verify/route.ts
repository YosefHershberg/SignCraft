import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { verifySchema } from '@/lib/domain/schemas';
import { verifyJob } from '@/lib/services/jobs';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'installer');
  const body = await parseBody(req, verifySchema);
  return json(await verifyJob(id, persona.id, body.outcome));
});
