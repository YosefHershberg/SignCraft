'use client';

// components/board — one status column of the desktop/tablet board. Given the
// already-filtered orders for its status by `KanbanBoard`, it renders the
// heading, count and a card per order, spreading the shared `CardBinding`
// into every `OrderCard`.

import { STATUS_META } from '@/lib/domain/status-meta';
import type { OrderDTO, OrderStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { EmptyColumn } from './empty-column';
import { OrderCard, type OrderCardProps } from './order-card';
import { SkeletonCard } from './skeleton-card';

/** Everything a column needs to hand each card, minus the order itself. */
export type CardBinding = Pick<
  OrderCardProps,
  'persona' | 'installers' | 'now' | 'onAction' | 'onVerify' | 'onClaim' | 'onClaimExpired'
>;

export interface StatusColumnProps {
  status: OrderStatus;
  /** Only the persona-visible orders already in this status; the column never filters. */
  orders: OrderDTO[];
  vendorNames: Record<string, string>;
  /** Per-card props that are identical across the whole board (see `CardBinding`). */
  card: CardBinding;
  onOpenOrder: (orderId: string) => void;
  /** See `KanbanBoardProps.highlightIds`. */
  highlightIds?: ReadonlySet<string>;
  selectedOrderId?: string | null;
  /** Overrides the status label, e.g. "Ready for install · marketplace". */
  label?: string;
  emptyLabel?: string;
  /** `grid` is the installer's wide marketplace column (design 1b). */
  layout?: 'stack' | 'grid';
  loading?: boolean;
}

/**
 * A single board column (UI spec §4.2). Two layouts share the same markup:
 *
 * - `stack` — the default 280px column (auto-width from xl) with cards in a
 *   vertical list; what ops and vendors see for all seven statuses.
 * - `grid` — the installer marketplace (design 1b). An installer has only two
 *   columns, so each takes the full width and lays cards out in up to three
 *   grid columns; the empty placeholder spans the grid so it is not squeezed
 *   into one cell.
 *
 * The card key includes `order.status` on purpose: when an SSE frame moves an
 * order between columns the card remounts and replays its entrance animation
 * in the new column rather than being reconciled in place.
 */
export function StatusColumn({
  status,
  orders,
  vendorNames,
  card,
  onOpenOrder,
  highlightIds,
  selectedOrderId,
  label,
  emptyLabel,
  layout = 'stack',
  loading,
}: StatusColumnProps) {
  const meta = STATUS_META[status];
  const grid = layout === 'grid';

  return (
    <section
      aria-label={meta.label}
      className={cn(
        'flex snap-start flex-col gap-2.5 rounded-[8px] bg-slate-100 p-2',
        grid ? 'min-w-0 flex-1 p-3' : 'w-[280px] flex-none xl:w-auto xl:min-w-0 xl:flex-1'
      )}
    >
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="size-1.5 flex-none rounded-full" style={{ background: meta.dot }} />
        <span className="flex-1 truncate text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase text-slate-600">
          {label ?? meta.label}
        </span>
        <span className="rounded-[6px] bg-slate-200 px-1.5 font-mono text-[11px] leading-4 font-medium text-slate-600 tabular-nums">
          {orders.length}
        </span>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          grid
            ? 'grid auto-rows-min grid-cols-1 content-start gap-3 lg:grid-cols-2 2xl:grid-cols-3'
            : 'flex flex-col gap-2.5'
        )}
      >
        {loading &&
          [0, 1, 2].map((i) => <SkeletonCard key={i} />)}

        {!loading &&
          orders.map((order) => (
            <OrderCard
              key={`${order.id}:${order.status}`}
              order={order}
              vendorName={vendorNames[order.vendorId] ?? 'Vendor unassigned'}
              onOpen={onOpenOrder}
              highlight={highlightIds?.has(order.id) ?? false}
              selected={selectedOrderId === order.id}
              {...card}
            />
          ))}

        {!loading && orders.length === 0 && (
          <div className={cn(grid && 'col-span-full')}>
            <EmptyColumn label={emptyLabel} />
          </div>
        )}
      </div>
    </section>
  );
}
