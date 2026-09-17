import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { verifySchema } from '@/lib/domain/schemas';
import { verifyJob } from '@/lib/services/jobs';

export const runtime = 'nodejs';

/**
 * POST /api/jobs/:id/verify — settles a claim (ADR-010). Persona: installer,
 * and only the current claimant. Body: `{outcome: 'pass'|'fail'}`. 200
 * `JobDTO` (pass → ASSIGNED, fail → OPEN). Errors: 400, 403, 404, 409
 * CLAIM_EXPIRED / NOT_CLAIMANT.
 */
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'installer');
  const body = await parseBody(req, verifySchema);
  return json(await verifyJob(id, persona.id, body.outcome));
});
