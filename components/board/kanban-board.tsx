'use client';

// components/board — the board proper. Receives the full bootstrap order list
// and the shared clock from `components/dashboard.tsx`, applies the per-persona
// rules in `lib/board/visibility.ts`, and renders both the mobile and desktop
// trees; every card callback (open, ⋯ action, claim, verify, expiry) is passed
// through unchanged so the dashboard stays the single owner of overlay state.

import { useState } from 'react';
import { columnMode, countsByStatus, defaultMobileTab, mobileStatuses, visibleOrders } from '@/lib/board/visibility';
import { serialisePersona } from '@/lib/domain/personas';
import { ORDER_STATUSES, type InstallerDTO, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';
import { CollapsedRail } from './collapsed-rail';
import { EmptyColumn } from './empty-column';
import { OrderCard, type OrderCardProps } from './order-card';
import { MobileStatusTabs } from './mobile-status-tabs';
import { SkeletonCard } from './skeleton-card';
import { StatusColumn, type CardBinding } from './status-column';

export interface KanbanBoardProps {
  /** Every order from bootstrap, unfiltered; `visibleOrders` narrows it here, not upstream. */
  orders: OrderDTO[];
  persona: Persona;
  /** `vendorId → name` for the card's vendor line (bootstrap carries ids only). */
  vendorNames: Record<string, string>;
  /** Needed by `JobChip`/`ClaimButton` to name the current claimant. */
  installers: InstallerDTO[];
  /**
   * Epoch ms from the dashboard's one shared `useNow` clock
   * (`lib/hooks/use-now.ts`). Threading a single tick down means every
   * countdown, lazy-expiry check and claim-sensitive guard on the board reads
   * the same instant, so two cards can never disagree about whether a claim
   * is still live (Invariant 3).
   */
  now: number;
  /** Selects the order whose detail sheet opens; the dashboard stores only the id and reads the order live. */
  onOpenOrder: (orderId: string) => void;
  /**
   * Orders that just changed status; each keeps the ring for 600 ms. Produced
   * by `useStatusHighlight` in `components/dashboard.tsx` from a status diff
   * between renders, so a card that moved via SSE flashes in every tab.
   */
  highlightIds?: ReadonlySet<string>;
  /** The order whose detail sheet is open; its card gets the teal border. */
  selectedOrderId?: string | null;
  /** True until the client bootstrap query resolves; columns show skeletons instead of cards. */
  loading?: boolean;
  /** Pipeline 1 entry: a card's ⋯ menu item → the dashboard's pending action → `TransitionDialog`. */
  onAction?: OrderCardProps['onAction'];
  /** Pipeline 2: the winning claimant's `JobChip` → `VerificationDialog`. */
  onVerify?: OrderCardProps['onVerify'];
  /** Pipeline 2 entry: a card's Claim button → `ClaimDialog`. */
  onClaim?: OrderCardProps['onClaim'];
  /**
   * A claim on screen lapsed. The key is `<jobId>:<expiresAt>` so the
   * dashboard can dedupe: both the mobile and desktop trees below are mounted
   * and each `JobChip` fires once, so the same expiry arrives twice.
   */
  onClaimExpired?: OrderCardProps['onClaimExpired'];
}

/**
 * Installer column headings from design 1b. Only the two statuses that are
 * columns for an installer have an override; the rest are rails and the
 * default `STATUS_META` label is used everywhere else (`label` stays undefined).
 */
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
  highlightIds,
  selectedOrderId,
  loading,
  onAction,
  onVerify,
  onClaim,
  onClaimExpired,
}: KanbanBoardProps) {
  const [expandedCancelled, setExpandedCancelled] = useState(false);

  const visible = visibleOrders(orders, persona);
  const counts = countsByStatus(visible);
  const personaKey = serialisePersona(persona);
  const tabs = mobileStatuses(persona);

  // The tab is seeded once per persona rather than derived every render: a
  // realtime update that empties the current tab must not move the user.
  // Deriving `defaultMobileTab` on every render would do exactly that — the
  // first non-empty tab changes whenever an SSE frame moves the last card out
  // of the one being viewed. State is keyed by `personaKey` so a persona switch
  // (which changes the visible statuses and counts) re-seeds, while any other
  // re-render keeps the user's choice. The re-seed happens synchronously via
  // set-state-during-render, so the new persona never paints a tab it does not
  // have.
  const [tabState, setTabState] = useState(() => ({ personaKey, status: defaultMobileTab(orders, persona) }));
  const seeded =
    tabState.personaKey === personaKey ? tabState : { personaKey, status: defaultMobileTab(orders, persona) };
  if (seeded !== tabState) setTabState(seeded);
  const tab = seeded.status;

  const card: CardBinding = { persona, installers, now, onAction, onVerify, onClaim, onClaimExpired };
  const emptyLabel = persona.kind === 'vendor' ? 'No orders for you here' : undefined;
  /** The persona-visible orders in one status, in bootstrap order (newest first). */
  const ordersIn = (status: OrderStatus) => visible.filter((order) => order.status === status);
  /**
   * An installer has only two columns, so each gets the full width and lays
   * cards out as a grid — the "marketplace" view of design 1b — instead of the
   * 280px stack every other persona sees.
   */
  const gridLayout = persona.kind === 'installer';

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* Mobile: pill tabs + a single list */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <MobileStatusTabs
          statuses={tabs}
          counts={counts}
          value={tab}
          onChange={(status) => setTabState({ personaKey, status })}
        >
          <div className="flex flex-col gap-3 p-3.5">
            {loading && [0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            {!loading &&
              ordersIn(tab).map((order) => (
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
              highlightIds={highlightIds}
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
