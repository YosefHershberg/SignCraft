import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { json } from '@/lib/api/respond';
import { createOrderSchema } from '@/lib/domain/schemas';
import { createOrder } from '@/lib/services/orders';

export const runtime = 'nodejs';

export const POST = withErrorHandling(async (req: Request) => {
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, createOrderSchema);
  return json(await createOrder(body, persona), 201);
});
