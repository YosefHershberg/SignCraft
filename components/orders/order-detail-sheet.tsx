'use client';

import { useCallback, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { InstallerDTO, OrderAction, OrderDTO, Persona, VendorDTO } from '@/lib/domain/types';
import { useOrder } from '@/lib/query/hooks';
import { DetailsGrid } from './details-grid';
import { HistoryTimeline } from './history-timeline';
import { OrderActions } from './order-actions';
import { StatusBadge } from './status-badge';
import { useRestoreFocus, visibleElement } from './use-restore-focus';

export interface OrderDetailSheetProps {
  /** `null` closes the sheet; the order itself is read live from the cache. */
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (order: OrderDTO, action: OrderAction) => void;
  vendors: VendorDTO[];
  installers: InstallerDTO[];
  persona: Persona;
  /** Epoch ms for claim-sensitive guards; defaults to the current clock. */
  now?: number;
}

/**
 * Right-docked order detail sheet (UI spec §4.4, design 1c). Sections: header,
 * actions, install job (Task 14), details grid, assets (Task 15), history.
 *
 * The order is looked up by id on every render rather than captured as a prop,
 * so realtime updates and persona switches both re-render in place (§7.8).
 */
export function OrderDetailSheet({
  orderId,
  open,
  onOpenChange,
  onAction,
  vendors,
  installers,
  persona,
  now = Date.now(),
}: OrderDetailSheetProps) {
  const order = useOrder(orderId);
  const missing = open && orderId !== null && order === null;

  // The order left the cache (deleted, or filtered out of a refetch): there is
  // nothing left to show, so close rather than render an empty shell.
  useEffect(() => {
    if (missing) onOpenChange(false);
  }, [missing, onOpenChange]);

  // Radix would hand focus back to a Trigger; this sheet is controlled and has
  // none, so closing it would drop focus on <body>. The card that opened it is
  // both the captured opener and the fallback (the board renders a mobile and a
  // desktop copy, `visibleElement` picks the on-screen one).
  const restoreFocus = useRestoreFocus(
    open,
    useCallback(() => (orderId ? visibleElement(`[data-order-id="${orderId}"]`) : null), [orderId])
  );

  if (!order) return null;

  const vendorName = vendors.find((v) => v.id === order.vendorId)?.name ?? 'Unknown vendor';

  return (
    // Non-modal on purpose: a modal sheet puts a pointer-blocking overlay over
    // the header, and UI spec §7.8 requires switching persona with the sheet
    // open. Radix drops its own overlay in this mode, so the scrim below is
    // ours — decorative only, clicks fall through to the board and dismiss.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      {open && <div aria-hidden className="pointer-events-none fixed inset-0 z-40 bg-slate-900/35 sm:top-14" />}
      <SheetContent
        side="right"
        onCloseAutoFocus={restoreFocus}
        onInteractOutside={(event) => {
          // The header and any portalled menu are "outside" the sheet but are
          // not a dismissal — that is exactly the persona switch in §7.8.
          const target = event.target as Element | null;
          if (target?.closest('header,[data-radix-popper-content-wrapper],[role="menu"]')) event.preventDefault();
        }}
        className="flex w-full flex-col gap-0 rounded-l-[12px] p-0 top-0 bottom-0 h-auto sm:top-14 sm:w-[90vw] sm:max-w-[90vw] xl:w-[480px] xl:max-w-[480px]"
      >
        <SheetHeader className="gap-2 border-b border-slate-200 p-4">
          <div className="flex items-center gap-2.5 pr-8">
            <span className="font-mono text-[13px] leading-[18px] font-semibold text-slate-600">
              {order.orderNumber}
            </span>
            <StatusBadge status={order.status} />
          </div>
          <SheetTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">{order.title}</SheetTitle>
          <SheetDescription className="text-[14px] leading-5 text-slate-600">{order.customerName}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <OrderActions order={order} persona={persona} now={now} onAction={onAction} />

          {/* JobPanel slot (Task 14) — install job state, claim countdown, installer actions. */}

          <DetailsGrid order={order} vendorName={vendorName} />

          {/* UploadPanel slot (Task 15) — asset rows, Upload file / Simulate large file. */}

          <HistoryTimeline order={order} vendors={vendors} installers={installers} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
