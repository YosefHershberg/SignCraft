import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { claimJob } from '@/lib/services/jobs';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'installer');
  return json(await claimJob(id, persona.id));
});
