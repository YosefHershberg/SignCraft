'use client';

// components/board — the 40px stand-in for a status that `columnMode`
// (`lib/board/visibility.ts`) says is not a column for this persona: every
// non-marketplace status for an installer, and CANCELLED for everyone until
// it is expanded. Rendered by `KanbanBoard` in place of a `StatusColumn`.

import { STATUS_META } from '@/lib/domain/status-meta';
import type { OrderStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** Shared frame for both variants so the button and the group are pixel-identical. */
const SHELL = 'flex w-10 flex-none snap-start flex-col items-center gap-2.5 rounded-[8px] bg-slate-100 py-2';

/**
 * 40px rail with a rotated label. Only the CANCELLED rail can be opened, so it
 * is the only one that renders a button; the installer's read-only rails are a
 * labelled group, not a disabled control nobody can use.
 */
export function CollapsedRail({
  status,
  count,
  onExpand,
}: {
  status: OrderStatus;
  /** Visible orders in this status (already persona-filtered by the board). */
  count: number;
  /** Only the CANCELLED rail gets one; the board flips `expandedCancelled` and re-renders it as a column. */
  onExpand?: () => void;
}) {
  const meta = STATUS_META[status];
  const label = `${meta.label} · ${count}`;

  const body = (
    <>
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
    </>
  );

  if (!onExpand) {
    return (
      <div role="group" aria-label={label} className={SHELL}>
        {body}
      </div>
    );
  }

  return (
    <button type="button" onClick={onExpand} aria-label={`${label} — expand`} className={cn(SHELL, 'cursor-pointer')}>
      {body}
    </button>
  );
}
