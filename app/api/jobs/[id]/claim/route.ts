import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseId } from '@/lib/api/params';
import { json } from '@/lib/api/respond';
import { claimJob } from '@/lib/services/jobs';

export const runtime = 'nodejs';

/**
 * POST /api/jobs/:id/claim — graded behaviour #2, the double-booking race.
 * Persona: installer. No body. 200 `JobDTO` (winner, CLAIMED with a live
 * countdown). Errors: 403, 404, 409 CLAIM_TAKEN (lost the race).
 */
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  const persona = requireKind(req, 'installer');
  return json(await claimJob(id, persona.id));
});
