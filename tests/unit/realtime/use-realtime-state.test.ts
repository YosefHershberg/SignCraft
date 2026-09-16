import { describe, expect, it } from 'vitest';
import { reduceConnection } from '@/lib/realtime/use-realtime';

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
