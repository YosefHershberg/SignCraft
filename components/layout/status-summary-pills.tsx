'use client';

// components/layout — per-status counts in the header, derived from the same
// `lib/board/visibility.ts` rules as the board so the two never disagree.

import { mobileStatuses, visibleOrders } from '@/lib/board/visibility';
import { STATUS_META } from '@/lib/domain/status-meta';
import { ORDER_STATUSES, type OrderDTO } from '@/lib/domain/types';
import { usePersona } from '@/lib/persona/persona-context';

/**
 * Desktop-only summary counts per status (UI spec §4.1). The counts mirror what
 * the persona can actually see on the board — a vendor counts only their own
 * orders — and an installer gets pills only for the two statuses that are
 * columns for them, so the header agrees with the board instead of advertising
 * work they cannot open. The wrapper stays flex-1 at every width so the
 * header's right-hand group keeps hugging the right edge even when the pills
 * themselves are hidden below xl.
 */
export function StatusSummaryPills({ orders }: { orders: OrderDTO[] }) {
  const { persona } = usePersona();
  const visible = visibleOrders(orders, persona);
  const statuses = persona.kind === 'installer' ? mobileStatuses(persona) : ORDER_STATUSES;

  const counts = statuses.map((status) => ({
    status,
    count: visible.filter((order) => order.status === status).length,
  }));

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center">
      <div className="hidden items-center gap-1.5 xl:flex">
        {counts.map(({ status, count }) => {
          const meta = STATUS_META[status];
          return (
            <div key={status} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-[3px]">
              <span className="size-1.5 rounded-full" style={{ background: meta.dot }} />
              <span className="text-[11px] whitespace-nowrap text-slate-600">
                {meta.short} {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
