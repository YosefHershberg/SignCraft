import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { json } from '@/lib/api/respond';
import { createOrderSchema } from '@/lib/domain/schemas';
import { createOrder } from '@/lib/services/orders';

export const runtime = 'nodejs';

/**
 * POST /api/orders — creates a DRAFT order. Persona: ops only.
 * Body: `createOrderSchema` (title, customerName, signType, dimensions,
 * quantity, vendorId, installAddress, dueDate, notes?).
 * 201 `OrderDTO`. Errors: 400 VALIDATION_ERROR, 403 FORBIDDEN_FOR_PERSONA.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const persona = requireKind(req, 'ops');
  const body = await parseBody(req, createOrderSchema);
  return json(await createOrder(body, persona), 201);
});
