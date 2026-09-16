import { getMongoDb } from '@/lib/db/mongo';
import { releaseExpired } from '@/lib/services/jobs';
import { createSseStream, type WatchCursor } from '@/lib/realtime/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
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
}
