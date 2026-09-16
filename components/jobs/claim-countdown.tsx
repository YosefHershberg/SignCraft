'use client';

import { useEffect, useRef } from 'react';
import { formatCountdown } from '@/lib/domain/format';
import { cn } from '@/lib/utils';

/**
 * Monospace mm:ss for a claim TTL. The tick comes from the board's shared
 * `useNow()` (one interval for the whole page); `onExpire` fires exactly once
 * per claim so the parent can invalidate the bootstrap query and let the
 * server's lazy expiry reconcile.
 */
export function ClaimCountdown({
  expiresAt,
  now,
  onExpire,
  className,
}: {
  expiresAt: string;
  now: number;
  onExpire?: () => void;
  className?: string;
}) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (remaining > 0 || firedFor.current === expiresAt) return;
    firedFor.current = expiresAt;
    onExpire?.();
  }, [remaining, expiresAt, onExpire]);

  return (
    <span className={cn('font-mono font-semibold tabular-nums', className)}>{formatCountdown(remaining)}</span>
  );
}
