'use client';

import { useState } from 'react';
import { columnMode, countsByStatus, defaultMobileTab, visibleOrders } from '@/lib/board/visibility';
import { serialisePersona } from '@/lib/domain/personas';
import { ORDER_STATUSES, type InstallerDTO, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';
import { CollapsedRail } from './collapsed-rail';
import { EmptyColumn } from './empty-column';
import { OrderCard, type OrderCardProps } from './order-card';
import { MobileStatusTabs } from './mobile-status-tabs';
import { SkeletonCard } from './skeleton-card';
import { StatusColumn, type CardBinding } from './status-column';

export interface KanbanBoardProps {
  orders: OrderDTO[];
  persona: Persona;
  vendorNames: Record<string, string>;
  installers: InstallerDTO[];
  now: number;
  onOpenOrder: (orderId: string) => void;
  highlightId?: string | null;
  selectedOrderId?: string | null;
  loading?: boolean;
  onAction?: OrderCardProps['onAction'];
  onVerify?: OrderCardProps['onVerify'];
  onClaimExpired?: OrderCardProps['onClaimExpired'];
}

/** Installer column headings from design 1b. */
const INSTALLER_LABEL: Partial<Record<OrderStatus, string>> = {
  READY_FOR_INSTALL: 'Ready for install · marketplace',
  COMPLETED: 'Completed · your installs',
};

/**
 * The board at all three breakpoints (UI spec §3): pill tabs and one list below
 * md, snap-scrolled 280px columns from md, six columns plus the Cancelled rail
 * from xl. Both layouts are rendered and swapped with CSS so there is no
 * client-only media query to desynchronise hydration.
 */
export function KanbanBoard({
  orders,
  persona,
  vendorNames,
  installers,
  now,
  onOpenOrder,
  highlightId,
  selectedOrderId,
  loading,
  onAction,
  onVerify,
  onClaimExpired,
}: KanbanBoardProps) {
  const [expandedCancelled, setExpandedCancelled] = useState(false);
  const [tabState, setTabState] = useState<{ personaKey: string; status: OrderStatus } | null>(null);

  const visible = visibleOrders(orders, persona);
  const counts = countsByStatus(visible);
  const personaKey = serialisePersona(persona);
  const tab = tabState?.personaKey === personaKey ? tabState.status : defaultMobileTab(orders, persona);

  const card: CardBinding = { persona, installers, now, onAction, onVerify, onClaimExpired };
  const emptyLabel = persona.kind === 'vendor' ? 'No orders for you here' : undefined;
  const ordersIn = (status: OrderStatus) => visible.filter((order) => order.status === status);
  const gridLayout = persona.kind === 'installer';

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* Mobile: pill tabs + a single list */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <MobileStatusTabs orders={orders} persona={persona} value={tab} onChange={(status) => setTabState({ personaKey, status })}>
          <div className="flex flex-col gap-3 p-3.5">
            {loading && [0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            {!loading &&
              ordersIn(tab).map((order) => (
                <OrderCard
                  key={`${order.id}:${order.status}`}
                  order={order}
                  vendorName={vendorNames[order.vendorId] ?? 'Vendor unassigned'}
                  onOpen={onOpenOrder}
                  highlight={highlightId === order.id}
                  selected={selectedOrderId === order.id}
                  {...card}
                />
              ))}
            {!loading && counts[tab] === 0 && <EmptyColumn label={emptyLabel} />}
          </div>
        </MobileStatusTabs>
      </div>

      {/* Tablet and desktop: columns with rails */}
      <div className="hidden min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto p-4 md:flex xl:snap-none xl:overflow-x-hidden">
        {ORDER_STATUSES.map((status) =>
          columnMode(status, persona, expandedCancelled) === 'column' ? (
            <StatusColumn
              key={status}
              status={status}
              orders={ordersIn(status)}
              vendorNames={vendorNames}
              card={card}
              onOpenOrder={onOpenOrder}
              highlightId={highlightId}
              selectedOrderId={selectedOrderId}
              label={gridLayout ? INSTALLER_LABEL[status] : undefined}
              emptyLabel={emptyLabel}
              layout={gridLayout ? 'grid' : 'stack'}
              loading={loading}
            />
          ) : (
            <CollapsedRail
              key={status}
              status={status}
              count={counts[status]}
              onExpand={status === 'CANCELLED' ? () => setExpandedCancelled(true) : undefined}
            />
          )
        )}
      </div>
    </main>
  );
}
