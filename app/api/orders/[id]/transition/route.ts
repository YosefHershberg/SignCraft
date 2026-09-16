import { withErrorHandling } from '@/lib/api/errors';
import { requirePersona } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { transitionSchema } from '@/lib/domain/schemas';
import { transitionOrder } from '@/lib/services/orders';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requirePersona(req);
  const body = await parseBody(req, transitionSchema);
  return json(await transitionOrder(id, body, persona));
});
