'use client';

import { STATUS_META } from '@/lib/domain/status-meta';
import type { OrderStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** 40px rail with a rotated label; clicking expands it when `onExpand` is given. */
export function CollapsedRail({
  status,
  count,
  onExpand,
}: {
  status: OrderStatus;
  count: number;
  onExpand?: () => void;
}) {
  const meta = STATUS_META[status];

  return (
    <button
      type="button"
      disabled={!onExpand}
      onClick={onExpand}
      aria-label={`${meta.label}: ${count}`}
      className={cn(
        'flex w-10 flex-none snap-start flex-col items-center gap-2.5 rounded-[8px] bg-slate-100 py-2',
        onExpand ? 'cursor-pointer' : 'cursor-default'
      )}
    >
      <span className="size-1.5 flex-none rounded-full" style={{ background: meta.dot }} />
      <span className="rounded-[6px] bg-slate-200 px-[5px] font-mono text-[11px] leading-4 font-medium text-slate-600 tabular-nums">
        {count}
      </span>
      <span
        className={cn(
          'text-[11px] leading-4 font-semibold tracking-[0.04em] whitespace-nowrap uppercase [writing-mode:vertical-rl]',
          onExpand ? 'text-slate-600' : 'text-slate-400'
        )}
      >
        {meta.label}
      </span>
    </button>
  );
}
