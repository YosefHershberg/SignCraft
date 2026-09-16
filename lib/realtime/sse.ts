// Turns a Mongo change-stream watch function into an SSE `ReadableStream`.
// No driver import here: `SseDeps.watch` returns an async-iterable + `close()`
// shape that the caller (app/api/events/route.ts) wires up to `db.watch(...)`.
import { changeToEvent, formatSse, type ChangeLike } from './events';
import { SSE_HEARTBEAT_MS, SSE_MAX_AGE_MS } from '@/lib/domain/constants';

export type WatchCursor = AsyncIterable<ChangeLike> & { close(): Promise<void> };

export interface SseDeps {
  watch: (resumeToken: string | null) => WatchCursor;
  now: () => Date;
  heartbeatMs?: number;
  maxAgeMs?: number;
}

const encoder = new TextEncoder();

/** After this many consecutive resumable errors, give up and error the stream instead of looping forever. */
const MAX_RESYNCS = 3;

/**
 * A resumable change-stream error: `ChangeStreamHistoryLost` (286) or an
 * invalid resume token (280). When the driver supplies a numeric error code
 * that code is authoritative; the message substring check is a fallback for
 * errors that carry no code at all (never consulted when a code is present,
 * so an unrelated numeric code can't accidentally match via the message).
 */
function isResumeError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (!e) return false;
  if (typeof e.code === 'number') return e.code === 280 || e.code === 286;
  return typeof e.message === 'string' && e.message.toLowerCase().includes('resume');
}

export function createSseStream(
  deps: SseDeps,
  resumeToken: string | null,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const maxAgeMs = deps.maxAgeMs ?? SSE_MAX_AGE_MS;

  let cursor: WatchCursor | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let maxAgeTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  /** Idempotent teardown: stop timers and best-effort close the live cursor. Shared by abort, maxAge, fatal error, and stream cancel. */
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (maxAgeTimer) clearTimeout(maxAgeTimer);
    if (cursor) await cursor.close().catch(() => {});
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller already closed/errored
        }
      };

      signal.addEventListener('abort', () => {
        void cleanup().then(safeClose);
      });

      safeEnqueue(': connected\n\n');

      heartbeatTimer = setInterval(() => safeEnqueue(': hb\n\n'), heartbeatMs);

      maxAgeTimer = setTimeout(() => {
        safeEnqueue('event: reconnect\ndata: {}\n\n');
        void cleanup().then(safeClose);
      }, maxAgeMs);

      const run = async (token: string | null, resyncCount = 0): Promise<void> => {
        cursor = deps.watch(token);
        // `cleanup` may have already run (abort/maxAge) while we were between
        // cursors; it closed the *old* one, so close this one here or it leaks.
        if (closed) {
          const fresh = cursor;
          cursor = null;
          await fresh.close().catch(() => {});
          return;
        }
        try {
          for await (const change of cursor) {
            if (closed) return;
            const frame = changeToEvent(change, deps.now());
            if (!frame) continue;
            safeEnqueue(
              formatSse({ id: frame.id, event: frame.event.type, data: { id: frame.event.doc.id, doc: frame.event.doc } })
            );
          }
        } catch (err) {
          if (closed) return;
          if (isResumeError(err) && resyncCount < MAX_RESYNCS) {
            const stale = cursor;
            cursor = null;
            if (stale) await stale.close().catch(() => {});
            if (closed) return; // aborted while the stale cursor was closing
            safeEnqueue('event: resync\ndata: {}\n\n');
            return run(null, resyncCount + 1);
          }
          throw err;
        }
      };

      run(resumeToken).catch((err) => {
        if (closed) return;
        void cleanup().then(() => {
          try {
            controller.error(err);
          } catch {
            // already closed
          }
        });
      });
    },
    cancel() {
      return cleanup();
    },
  });
}
