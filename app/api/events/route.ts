import { withErrorHandling } from '@/lib/api/errors';
import { getMongoDb } from '@/lib/db/mongo';
import { releaseExpired } from '@/lib/services/jobs';
import { createSseStream, type WatchCursor } from '@/lib/realtime/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Vercel's ceiling for a Fluid-compute function (CLAUDE.md deployment
 * notes). `createSseStream` sends `event: reconnect` at `SSE_MAX_AGE_MS`
 * (280 s) and closes cleanly, safely inside this 300 s limit so the platform
 * never kills the connection mid-stream.
 */
export const maxDuration = 300;

/**
 * GET /api/events — the realtime fan-out every pipeline relies on
 * (architecture §10). Persona: none (read-only, filtered client-side).
 * Query `?after=<resumeToken>` or header `Last-Event-ID` resumes a dropped
 * connection from its last change-stream token. Sweeps expired claims first
 * so the swept state reaches every tab. 200 `text/event-stream` (named
 * events `order.*`/`job.*`/`asset.*` plus `reconnect`/`resync` controls);
 * never returns an error status once the stream has started (per SSE, a
 * fatal HTTP status here is what `shouldRetryManually` on the client works
 * around).
 */
export const GET = withErrorHandling(async (req: Request): Promise<Response> => {
  await releaseExpired();

  const url = new URL(req.url);
  const token = req.headers.get('last-event-id') ?? url.searchParams.get('after');
  const db = await getMongoDb();

  const watch = (resume: string | null): WatchCursor =>
    db.watch(
      [{ $match: { 'ns.coll': { $in: ['Order', 'InstallJob', 'Asset'] }, operationType: { $in: ['insert', 'update', 'replace'] } } }],
      { fullDocument: 'updateLookup', ...(resume ? { resumeAfter: { _data: resume } } : {}) }
    ) as unknown as WatchCursor;

  const stream = createSseStream({ watch, now: () => new Date() }, token, req.signal);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
