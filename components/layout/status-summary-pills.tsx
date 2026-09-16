import { ORDER_STATUSES, type OrderDTO } from '@/lib/domain/types';
import { STATUS_META } from '@/lib/domain/status-meta';

/** Desktop-only summary counts per status (UI spec §4.1). The wrapper stays
 * flex-1 at every width so the header's right-hand group keeps hugging the
 * right edge even when the pills themselves are hidden below xl. */
export function StatusSummaryPills({ orders }: { orders: OrderDTO[] }) {
  const counts = ORDER_STATUSES.map((status) => ({
    status,
    count: orders.filter((order) => order.status === status).length,
  }));

  return (
    <div className="flex flex-1 items-center justify-center">
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
