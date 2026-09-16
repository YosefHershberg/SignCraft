import type { InstallerDTO, OrderStatus, TransitionDTO, VendorDTO } from './types';

/**
 * Past-tense verb for landing on a status, so a transition reads as a sentence
 * rather than as an enum pair (UI spec §4.4: "Submitted by Ops · 12:04").
 */
export const HISTORY_VERB: Record<OrderStatus, string> = {
  DRAFT: 'Created',
  SUBMITTED: 'Submitted',
  VENDOR_ACCEPTED: 'Accepted',
  IN_PRODUCTION: 'Production started',
  READY_FOR_INSTALL: 'Marked ready for install',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/**
 * The order's own participants. A transition row may carry a null `actorId`
 * (the seed writes none), but an order has exactly one vendor and at most one
 * assigned installer, so those ids name the actor when the row does not.
 */
export interface HistoryActorFallback {
  vendorId?: string | null;
  installerId?: string | null;
}

/**
 * Display name for whoever performed a transition. Ops has no id (it is a
 * shared console persona); vendor and installer ids resolve against the
 * bootstrap rosters, with a stable fallback when the row is missing.
 */
export function historyActorName(
  transition: TransitionDTO,
  vendors: VendorDTO[],
  installers: InstallerDTO[],
  fallback?: HistoryActorFallback
): string {
  switch (transition.actorType) {
    case 'OPS':
      return 'Ops';
    case 'VENDOR': {
      const id = transition.actorId ?? fallback?.vendorId;
      return vendors.find((v) => v.id === id)?.name ?? 'Unknown vendor';
    }
    case 'INSTALLER': {
      const id = transition.actorId ?? fallback?.installerId;
      return installers.find((i) => i.id === id)?.name ?? 'Unknown installer';
    }
    case 'SYSTEM':
    default:
      return 'System';
  }
}

/** One history line, e.g. `Cancelled by Ops — Customer pulled out`. */
export function historyLine(
  transition: TransitionDTO,
  vendors: VendorDTO[],
  installers: InstallerDTO[],
  fallback?: HistoryActorFallback
): string {
  const head = `${HISTORY_VERB[transition.to]} by ${historyActorName(transition, vendors, installers, fallback)}`;
  const reason = transition.reason?.trim();
  return reason ? `${head} — ${reason}` : head;
}
