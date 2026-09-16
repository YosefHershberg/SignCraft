'use client';

import { ClaimDialog } from '@/components/jobs/claim-dialog';
import { VerificationDialog } from '@/components/jobs/verification-dialog';
import { CreateOrderDialog } from '@/components/orders/create-order-dialog';
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet';
import { TransitionDialog } from '@/components/orders/transition-dialog';
import type { BootstrapDTO, JobDTO, OrderAction, OrderDTO, Persona } from '@/lib/domain/types';

export interface DashboardOverlayState {
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;
  pendingAction: { orderId: string; action: OrderAction } | null;
  setPendingAction: (pending: { orderId: string; action: OrderAction } | null) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  claimOrderId: string | null;
  setClaimOrderId: (id: string | null) => void;
  verifyOrderId: string | null;
  setVerifyOrderId: (id: string | null) => void;
}

/**
 * Every overlay the board can raise: the detail sheet plus the four dialogs.
 *
 * Split out of `dashboard.tsx` purely to keep that file readable — the state
 * still lives there, because the board itself and these overlays both read it.
 * Each dialog is keyed by order id rather than by a captured DTO, so an SSE
 * frame arriving while one is open re-renders it against live data.
 */
export function DashboardDialogs({
  board,
  persona,
  now,
  onAction,
  onClaim,
  onVerify,
  onCreated,
  state,
}: {
  board: BootstrapDTO;
  persona: Persona;
  /** Epoch ms from the board clock, so every overlay agrees with the cards. */
  now: number;
  onAction: (order: OrderDTO, action: OrderAction) => void;
  onClaim: (job: JobDTO) => void;
  onVerify: (job: JobDTO) => void;
  onCreated: (order: OrderDTO) => void;
  state: DashboardOverlayState;
}) {
  const {
    selectedOrderId,
    setSelectedOrderId,
    pendingAction,
    setPendingAction,
    createOpen,
    setCreateOpen,
    claimOrderId,
    setClaimOrderId,
    verifyOrderId,
    setVerifyOrderId,
  } = state;

  const pendingOrder = pendingAction ? board.orders.find((o) => o.id === pendingAction.orderId) : undefined;
  const claimJob = board.orders.find((o) => o.id === claimOrderId)?.installJob ?? null;
  const verifyJob = board.orders.find((o) => o.id === verifyOrderId)?.installJob ?? null;

  return (
    <>
      <OrderDetailSheet
        orderId={selectedOrderId}
        open={selectedOrderId !== null}
        onOpenChange={(open) => !open && setSelectedOrderId(null)}
        onAction={onAction}
        vendors={board.vendors}
        installers={board.installers}
        persona={persona}
        now={now}
        onClaim={onClaim}
        onVerify={onVerify}
      />

      {claimJob && (
        <ClaimDialog
          open
          onOpenChange={(open) => !open && setClaimOrderId(null)}
          job={claimJob}
          persona={persona}
          installers={board.installers}
          now={now}
          claimTtlMs={board.claimTtlMs}
          // The claim dialog closes itself first; this only hands the won claim
          // straight to the verification countdown (UI spec §7.1 step 7).
          onClaimed={(job) => {
            setClaimOrderId(null);
            setVerifyOrderId(job.orderId);
          }}
        />
      )}

      {verifyJob && (
        <VerificationDialog
          open
          onOpenChange={(open) => !open && setVerifyOrderId(null)}
          job={verifyJob}
          persona={persona}
          now={now}
        />
      )}

      {pendingAction && pendingOrder && (
        <TransitionDialog
          open
          onOpenChange={(open) => !open && setPendingAction(null)}
          order={pendingOrder}
          action={pendingAction.action}
          persona={persona}
          now={now}
        />
      )}

      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vendors={board.vendors}
        onCreated={onCreated}
      />
    </>
  );
}
