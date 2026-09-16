import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSseStream, type SseDeps, type WatchCursor } from '@/lib/realtime/sse';
import type { ChangeLike } from '@/lib/realtime/events';

const decoder = new TextDecoder();

function fakeObjectId(hex: string) {
  return { toHexString: () => hex };
}

function orderInsert(id: string, resumeToken: string): ChangeLike {
  return {
    operationType: 'insert',
    ns: { coll: 'Order' },
    _id: { _data: resumeToken },
    fullDocument: {
      _id: fakeObjectId(id),
      orderNumber: 'ORD-1',
      title: 'Sign',
      customerName: 'Acme',
      signType: 'BANNER',
      widthCm: 10,
      heightCm: 10,
      quantity: 1,
      installAddress: 'x',
      dueDate: new Date(),
      vendorId: fakeObjectId('vendor1'),
      status: 'DRAFT',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/** An async-iterable that yields the given changes, then hangs forever (idle change stream). */
function makeHangingCursor(changes: ChangeLike[]) {
  let index = 0;
  const state = { closeCount: 0 };
  const cursor: WatchCursor = {
    close: async () => {
      state.closeCount++;
    },
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<ChangeLike>> => {
          if (index < changes.length) {
            return { done: false, value: changes[index++]! };
          }
          return new Promise<IteratorResult<ChangeLike>>(() => {});
        },
      };
    },
  };
  return { cursor, state };
}

/** A cursor whose first `next()` call rejects with `error`; never actually iterates further. */
function makeThrowingCursor(error: unknown) {
  const state = { closeCount: 0 };
  const cursor: WatchCursor = {
    close: async () => {
      state.closeCount++;
    },
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<ChangeLike>> => {
          throw error;
        },
      };
    },
  };
  return { cursor, state };
}

describe('createSseStream', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits connected, two change frames, a heartbeat, then reconnect at maxAge', async () => {
    vi.useFakeTimers();
    const { cursor } = makeHangingCursor([orderInsert('order1', 'token1'), orderInsert('order2', 'token2')]);
    const deps: SseDeps = {
      watch: () => cursor,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      heartbeatMs: 15_000,
      maxAgeMs: 50_000,
    };
    const controller = new AbortController();
    const stream = createSseStream(deps, null, controller.signal);
    const reader = stream.getReader();

    const connected = await reader.read();
    expect(decoder.decode(connected.value)).toBe(': connected\n\n');

    const frame1 = await reader.read();
    const text1 = decoder.decode(frame1.value);
    expect(text1).toContain('id: token1');
    expect(text1).toContain('event: order.created');

    const frame2 = await reader.read();
    const text2 = decoder.decode(frame2.value);
    expect(text2).toContain('id: token2');

    // Advance straight to maxAge (50s): heartbeats land at 15s/30s/45s, reconnect at 50s.
    // All of it queues up in the stream buffer; drain and classify sequentially.
    await vi.advanceTimersByTimeAsync(50_000);

    const seen: string[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen.push(decoder.decode(chunk.value));
    }

    expect(seen.filter((s) => s === ': hb\n\n')).toHaveLength(3);
    expect(seen.filter((s) => s === 'event: reconnect\ndata: {}\n\n')).toHaveLength(1);
    expect(seen.at(-1)).toBe('event: reconnect\ndata: {}\n\n');
  });

  it('closes the cursor when the abort signal fires', async () => {
    vi.useFakeTimers();
    const { cursor, state } = makeHangingCursor([]);
    const deps: SseDeps = { watch: () => cursor, now: () => new Date(), heartbeatMs: 15_000, maxAgeMs: 280_000 };
    const controller = new AbortController();
    const stream = createSseStream(deps, null, controller.signal);
    const reader = stream.getReader();

    await reader.read(); // : connected

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.closeCount).toBe(1);
  });

  it('resyncs once on a code-286 error: closes the stale cursor, emits resync, then resumes from a fresh watch(null)', async () => {
    const err286 = Object.assign(new Error('oplog window exceeded'), { code: 286 });
    const { cursor: badCursor, state: badState } = makeThrowingCursor(err286);
    const { cursor: goodCursor } = makeHangingCursor([orderInsert('order3', 'token3')]);

    const watchCalls: (string | null)[] = [];
    const watch = (token: string | null) => {
      watchCalls.push(token);
      return watchCalls.length === 1 ? badCursor : goodCursor;
    };
    const deps: SseDeps = { watch, now: () => new Date(), heartbeatMs: 15_000, maxAgeMs: 280_000 };
    const controller = new AbortController();
    const stream = createSseStream(deps, 'token0', controller.signal);
    const reader = stream.getReader();

    await reader.read(); // : connected

    const resync = await reader.read();
    expect(decoder.decode(resync.value)).toBe('event: resync\ndata: {}\n\n');

    const frame = await reader.read();
    expect(decoder.decode(frame.value)).toContain('id: token3');

    expect(watchCalls).toEqual(['token0', null]);
    // The stale cursor from the failed watch(token0) is closed before restarting with watch(null).
    expect(badState.closeCount).toBe(1);
  });

  it('gives up after 3 consecutive resync errors and errors the stream (no infinite resync loop)', async () => {
    const madeCursors: { cursor: WatchCursor; state: { closeCount: number } }[] = [];
    const watch = () => {
      const err = Object.assign(new Error('oplog window exceeded'), { code: 286 });
      const made = makeThrowingCursor(err);
      madeCursors.push(made);
      return made.cursor;
    };
    const deps: SseDeps = { watch, now: () => new Date(), heartbeatMs: 15_000, maxAgeMs: 280_000 };
    const controller = new AbortController();
    const stream = createSseStream(deps, null, controller.signal);
    const reader = stream.getReader();

    await reader.read(); // : connected

    for (let i = 0; i < 3; i++) {
      const resync = await reader.read();
      expect(decoder.decode(resync.value)).toBe('event: resync\ndata: {}\n\n');
    }

    await expect(reader.read()).rejects.toThrow('oplog window exceeded');
    // 1 initial watch + 3 resyncs = 4 cursors, all closed (3 explicitly before restart, 1 by fatal cleanup).
    expect(madeCursors).toHaveLength(4);
    expect(madeCursors.every((m) => m.state.closeCount === 1)).toBe(true);
  });

  it('does not open a fresh cursor when the stream is aborted while the stale one is closing', async () => {
    let releaseClose = () => {};
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const state = { closeCount: 0 };
    const badCursor: WatchCursor = {
      close: async () => {
        state.closeCount++;
        await closeGate;
      },
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<ChangeLike>> => {
            throw Object.assign(new Error('oplog window exceeded'), { code: 286 });
          },
        };
      },
    };

    const watchCalls: (string | null)[] = [];
    const watch = (token: string | null) => {
      watchCalls.push(token);
      return badCursor;
    };
    const deps: SseDeps = { watch, now: () => new Date(), heartbeatMs: 15_000, maxAgeMs: 280_000 };
    const controller = new AbortController();
    const stream = createSseStream(deps, 'token0', controller.signal);
    const reader = stream.getReader();

    await reader.read(); // : connected

    // The resume error has fired and the stale cursor is mid-close: abort now.
    await vi.waitFor(() => expect(state.closeCount).toBe(1));
    controller.abort();
    releaseClose();

    const next = await reader.read();
    expect(next.done).toBe(true); // no `event: resync` frame after the abort

    // Let the aborted `run` finish unwinding before asserting it did not restart.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watchCalls).toEqual(['token0']); // no second watch to leak
  });

  it('propagates a non-resume watch error and closes the cursor without resyncing', async () => {
    const boom = new Error('boom');
    const { cursor, state } = makeThrowingCursor(boom);
    const deps: SseDeps = { watch: () => cursor, now: () => new Date(), heartbeatMs: 15_000, maxAgeMs: 280_000 };
    const controller = new AbortController();
    const stream = createSseStream(deps, null, controller.signal);
    const reader = stream.getReader();

    await reader.read(); // : connected

    await expect(reader.read()).rejects.toThrow('boom');
    expect(state.closeCount).toBe(1);
  });
});
