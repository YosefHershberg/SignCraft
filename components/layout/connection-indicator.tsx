'use client';

// components/layout — the header dot that surfaces the SSE connection state
// from `lib/realtime/use-realtime.ts`. It is the user-visible half of
// Invariant 4: "Polling every 10 s" is shown precisely when, and only when,
// `useBootstrap` has switched on its degraded-mode `refetchInterval`.

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/lib/realtime/use-realtime';

/**
 * Copy per `ConnectionStatus` (architecture spec §10.2):
 * - `connecting`   — first EventSource not yet open (initial load).
 * - `live`         — stream open; cards move from change-stream frames.
 * - `reconnecting` — the stream dropped (or hit the 280 s `reconnect` event)
 *                    and the browser / `shouldRetryManually` is retrying.
 * - `degraded`     — three consecutive failures; realtime is off and
 *                    `useBootstrap` refetches every 10 s instead.
 */
const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  degraded: 'Polling every 10 s',
};

// Amber reuses the IN_PRODUCTION status colour; green matches COMPLETED/Live.
// `reconnecting` and `degraded` share amber; the pulse animation and the label
// tell them apart.
const DOT_COLOR: Record<ConnectionStatus, string> = {
  connecting: '#94A3B8',
  live: '#16A34A',
  reconnecting: '#D97706',
  degraded: '#D97706',
};

/**
 * Dot + label for the connection state (UI spec §4.1). Only `degraded` gets a
 * tooltip: it is the one state whose label ("Polling every 10 s") needs an
 * explanation of *why*, and wrapping the others in a focusable button would
 * add a tab stop to the header for no information. `reconnecting` pulses
 * instead, since it is transient by design.
 */
export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dotAndLabel = (
    <span className="flex items-center gap-[7px]">
      <span
        className={cn('size-1.5 rounded-full', status === 'reconnecting' && 'animate-pulse')}
        style={{ background: DOT_COLOR[status] }}
      />
      <span className="text-[11px] whitespace-nowrap text-slate-600">{LABEL[status]}</span>
    </span>
  );

  if (status !== 'degraded') return dotAndLabel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-default">
          {dotAndLabel}
        </button>
      </TooltipTrigger>
      <TooltipContent>Realtime stream unavailable; falling back to polling</TooltipContent>
    </Tooltip>
  );
}
