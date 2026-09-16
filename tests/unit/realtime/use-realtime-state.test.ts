import { describe, expect, it } from 'vitest';
import { reduceConnection, shouldRetryManually } from '@/lib/realtime/use-realtime';

describe('reduceConnection', () => {
  it('open resets to live with zero failures', () => {
    expect(reduceConnection({ status: 'connecting', failures: 0 }, 'open')).toEqual({
      status: 'live',
      failures: 0,
    });
  });

  it('accumulates failures into reconnecting below the degraded threshold', () => {
    let state = reduceConnection({ status: 'live', failures: 0 }, 'error');
    expect(state).toEqual({ status: 'reconnecting', failures: 1 });
    state = reduceConnection(state, 'error');
    expect(state).toEqual({ status: 'reconnecting', failures: 2 });
  });

  it('open, error, error, error -> degraded; then open -> live', () => {
    let state = reduceConnection({ status: 'connecting', failures: 0 }, 'open');
    expect(state).toEqual({ status: 'live', failures: 0 });

    state = reduceConnection(state, 'error');
    state = reduceConnection(state, 'error');
    state = reduceConnection(state, 'error');
    expect(state).toEqual({ status: 'degraded', failures: 3 });

    state = reduceConnection(state, 'open');
    expect(state).toEqual({ status: 'live', failures: 0 });
  });

  it('reconnect keeps the failure count but shows reconnecting', () => {
    const state = { status: 'live' as const, failures: 0 };
    expect(reduceConnection(state, 'reconnect')).toEqual({ status: 'reconnecting', failures: 0 });
  });

  it('stays degraded on further errors once past the threshold', () => {
    const state = { status: 'degraded' as const, failures: 5 };
    expect(reduceConnection(state, 'error')).toEqual({ status: 'degraded', failures: 6 });
  });
});

describe('shouldRetryManually', () => {
  // The numbers are the EventSource readyState constants; spelled out so the
  // test says what it means without needing a DOM.
  const CONNECTING = 0;
  const OPEN = 1;
  const CLOSED = 2;

  it('is true only for a CLOSED stream — the fatal case EventSource will not retry', () => {
    expect(shouldRetryManually(CLOSED)).toBe(true);
  });

  it('is false while the browser is still retrying on its own', () => {
    expect(shouldRetryManually(CONNECTING)).toBe(false);
    expect(shouldRetryManually(OPEN)).toBe(false);
  });

  it('drives enough retries to reach degraded, which a fatal error alone never would', () => {
    // One fatal error without a manual retry leaves the app on 'reconnecting'
    // forever; retrying turns each attempt into another counted failure.
    let state = reduceConnection({ status: 'live', failures: 0 }, 'error');
    expect(state.status).toBe('reconnecting');
    while (shouldRetryManually(CLOSED) && state.status !== 'degraded') {
      state = reduceConnection(state, 'error');
    }
    expect(state).toEqual({ status: 'degraded', failures: 3 });
  });
});
