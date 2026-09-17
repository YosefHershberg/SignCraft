import { withErrorHandling } from '@/lib/api/errors';
import { requireKind } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { parseId } from '@/lib/api/params';
import { noContent } from '@/lib/api/respond';
import { progressSchema } from '@/lib/domain/schemas';
import { reportProgress } from '@/lib/services/assets';

export const runtime = 'nodejs';

/**
 * POST /api/assets/:id/progress — pipeline 3, step 4: advisory progress
 * (ADR-016). Persona: ops. Body: `{bytesUploaded}`. 204. An unknown asset id
 * is a silent no-op (only a malformed id 404s); a terminal asset ignores it.
 * Errors: 400, 403, 404 (malformed id only).
 */
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = await parseId(params);
  requireKind(req, 'ops');
  const body = await parseBody(req, progressSchema);
  await reportProgress(id, body.bytesUploaded);
  return noContent();
});
