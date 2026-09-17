// Turns a Mongo change-stream watch function into an SSE `ReadableStream`.
// No driver import here: `SseDeps.watch` returns an async-iterable + `close()`
// shape that the caller (app/api/events/route.ts) wires up to `db.watch(...)`.
import { changeToEvent, formatSse, type ChangeLike } from './events';
import { SSE_HEARTBEAT_MS, SSE_MAX_AGE_MS } from '@/lib/domain/constants';

/** What `db.watch(...)` gives the route handler: an async-iterable of change docs plus an explicit close, so this module never has to know it's Mongo. */
export type WatchCursor = AsyncIterable<ChangeLike> & { close(): Promise<void> };

/**
 * Everything `createSseStream` needs from the outside world, injected so unit
 * tests can drive the state machine with a fake `watch`/`now` instead of a
 * real Atlas connection. `app/api/events/route.ts` supplies the real `watch`
 * (wrapping `db.watch(...)` from `lib/db/mongo.ts`) and `now` (`Date.now`).
 */
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

/**
 * Turns a change-stream watch into the `GET /api/events` response body
 * (architecture spec §10). Lifecycle, in order:
 *
 * - `: connected` immediately, so the client's `EventSource` fires `onopen`.
 * - `: hb` every `heartbeatMs` (default `SSE_HEARTBEAT_MS`) — a comment line,
 *   invisible to `EventSource` listeners, that exists purely so intermediary
 *   proxies don't time out an apparently-idle connection.
 * - `event: reconnect` at `maxAgeMs` (default `SSE_MAX_AGE_MS`, chosen to sit
 *   inside Vercel's 300 s function ceiling) followed by a clean `cleanup()` —
 *   the client closes this EventSource and reopens with `?after=<lastId>`
 *   rather than being cut off mid-stream by the platform.
 * - `event: resync` when the change stream throws a resumable error
 *   (`isResumeError`: token invalidated or history lost) — the cursor is
 *   recreated from scratch (`resumeToken: null`) up to `MAX_RESYNCS` times
 *   before the stream gives up and errors, so the client falls back to a
 *   plain bootstrap refetch instead of missing writes silently.
 * - `cleanup()` is idempotent and shared by abort, max-age, a fatal error and
 *   the stream's own `cancel()`, so every exit path stops the timers and
 *   closes the live cursor exactly once.
 */
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
