'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/lib/realtime/use-realtime';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  degraded: 'Polling every 10 s',
};

// Amber reuses the IN_PRODUCTION status colour; green matches COMPLETED/Live.
const DOT_COLOR: Record<ConnectionStatus, string> = {
  connecting: '#94A3B8',
  live: '#16A34A',
  reconnecting: '#D97706',
  degraded: '#D97706',
};

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
