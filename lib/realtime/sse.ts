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

function isResumeError(err: unknown): boolean {
  const e = err as { code?: number; message?: unknown } | null | undefined;
  if (!e) return false;
  if (e.code === 280 || e.code === 286) return true;
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

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (maxAgeTimer) clearTimeout(maxAgeTimer);
        if (cursor) await cursor.close().catch(() => {});
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

      const run = async (token: string | null): Promise<void> => {
        cursor = deps.watch(token);
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
          if (isResumeError(err)) {
            safeEnqueue('event: resync\ndata: {}\n\n');
            return run(null);
          }
          throw err;
        }
      };

      run(resumeToken).catch((err) => {
        if (closed) return;
        void cleanup();
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (maxAgeTimer) clearTimeout(maxAgeTimer);
      if (cursor) void cursor.close().catch(() => {});
    },
  });
}
