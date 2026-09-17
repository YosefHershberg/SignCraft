import { withErrorHandling } from '@/lib/api/errors';
import { json } from '@/lib/api/respond';
import { getBootstrap } from '@/lib/services/bootstrap';

export const runtime = 'nodejs';
/** Never cached: the dashboard's first render must reflect the live board, not a stale build-time snapshot. */
export const dynamic = 'force-dynamic';

/**
 * GET /api/bootstrap — the dashboard's first-render snapshot. No persona
 * required (read filtering by persona is client-side, `lib/board/visibility.ts`).
 * 200 `BootstrapDTO` `{vendors, installers, orders, serverTime, claimTtlMs}`.
 */
export const GET = withErrorHandling(async () => json(await getBootstrap()));
