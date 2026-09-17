'use client';

/** lib/hooks/use-now.ts — the one shared clock every countdown UI reads from. */
import { useEffect, useState } from 'react';

/**
 * One shared clock for every countdown on the board: a single 1 s interval
 * whose value is threaded down as a `now` prop instead of each chip owning a
 * timer.
 *
 * `initialNow` should be the server's clock (`BootstrapDTO.serverTime`) so the
 * server render and the first client render agree; the interval swaps in the
 * real `Date.now()` right after hydration.
 */
export function useNow(initialNow?: number, intervalMs = 1000): number {
  const [now, setNow] = useState(() => initialNow ?? Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
