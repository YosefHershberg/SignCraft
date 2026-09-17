'use client';

// Pipeline 2 (claim race): the small mm:ss readout used wherever a claim's
// TTL needs to show inline (job chip, claim button tooltip, job panel).
import type { CSSProperties } from 'react';
import { formatCountdown } from '@/lib/domain/format';
import { cn } from '@/lib/utils';

/**
 * Monospace mm:ss for a claim TTL. Purely presentational: the tick comes from
 * the board's shared `useNow()` (one interval for the whole page), and the
 * expiry edge is detected by `JobChip` against the raw job — by the time the
 * remainder would reach zero the claim already reads as OPEN and this
 * component is unmounted.
 *
 * The remainder is rounded *up* to the next second so a live claim never shows
 * "0:00" (`formatCountdown` rounds to nearest, which would display 0:00 for the
 * last ~500 ms of a claim that is still CLAIMED on the server).
 */
export function ClaimCountdown({
  expiresAt,
  now,
  className,
  style,
}: {
  expiresAt: string;
  now: number;
  className?: string;
  style?: CSSProperties;
}) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);

  return (
    <span className={cn('font-mono font-semibold tabular-nums', className)} style={style}>
      {formatCountdown(Math.ceil(remaining / 1000) * 1000)}
    </span>
  );
}
