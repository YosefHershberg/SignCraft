// components/orders — the one status pill. Colours come from `STATUS_META`
// (`lib/domain/status-meta.ts`), the same table that colours card stripes,
// column dots and the timeline, so a status looks identical everywhere.

import { STATUS_META } from '@/lib/domain/status-meta';
import type { OrderStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/**
 * The status pill shared by the sheet header, the transition dialog and any
 * other overlay that names a status (DESIGN.md "Badge": 6px radius, 11px
 * semibold, status fill + status text colour).
 */
export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'rounded-[6px] px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap',
        className
      )}
      style={{ background: meta.bg, color: meta.fg }}
    >
      {meta.label}
    </span>
  );
}
