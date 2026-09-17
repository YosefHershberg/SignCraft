/**
 * Persona × state-machine × guards → a Verdict (architecture §7, UI spec §6).
 * This is the single authority for "may this persona do this to this order":
 * the UI builds its buttons from it (`orderActionsFor`, `jobActionsFor`) and
 * `lib/services/orders.ts#transitionOrder` re-runs `checkTransition` on every
 * request, so a hand-crafted request gets the same 400/403 the UI would have
 * prevented (Invariant 1). Pure: it sees a small `OrderCtx`, never a DB row.
 */
import { allowedTransitions, actionForTransition, canTransition } from './state-machine';
import { toPublicJob } from './claims';
import type { JobLike } from './claims';
import { UPLOADABLE_STATUSES } from './constants';
import type { ActionAvailability, OrderStatus, Persona } from './types';

/**
 * The slice of an order the rules need. Built identically by
 * `order-actions.ts#orderCtx` (from an `OrderDTO`, client) and by
 * `transitionOrder` (from the Prisma row, server), which is what keeps the two
 * sides in agreement.
 */
export interface OrderCtx {
  status: OrderStatus;
  vendorId: string;
  /** ADR-012: SUBMITTED requires at least one UPLOADED asset. */
  hasUploadedAsset: boolean;
  /** Raw job; `checkTransition` applies lazy expiry itself before reading its status. */
  installJob: JobLike | null;
}

/**
 * Why a transition is refused. `lib/api/errors.ts#fromVerdict` maps it to the
 * wire error: INVALID_TRANSITION → 400 with `allowed` (the state machine says
 * no), GUARD_FAILED → 400 with `reason` (legal edge, precondition unmet),
 * FORBIDDEN_FOR_PERSONA → 403 (legal edge, wrong caller).
 */
export type Denial = {
  ok: false;
  code: 'FORBIDDEN_FOR_PERSONA' | 'INVALID_TRANSITION' | 'GUARD_FAILED';
  reason?: 'NO_UPLOADED_ASSET' | 'NO_ASSIGNED_INSTALLER' | 'ORDER_NOT_UPLOADABLE';
  allowed?: OrderStatus[];
};

export type Verdict = { ok: true } | Denial;

/**
 * May `persona` move `order` to `to` right now?
 *
 * Checks run in a fixed order so the error a caller sees is the most useful
 * one: the state machine first (illegal edge → INVALID_TRANSITION with the
 * allowed list, regardless of persona), then who may take this edge, then
 * the guards. Rules: ops submits (needs an UPLOADED asset, ADR-012) and may
 * cancel; the owning vendor accepts / starts production / marks ready and may
 * cancel; only the installer the job is ASSIGNED to completes. `now` matters
 * because the job is passed through `toPublicJob` first — an expired claim
 * must not count as an assigned installer.
 */
export function checkTransition(persona: Persona, order: OrderCtx, to: OrderStatus, now: Date): Verdict {
  if (!canTransition(order.status, to)) {
    return { ok: false, code: 'INVALID_TRANSITION', allowed: allowedTransitions(order.status) };
  }
  const job = order.installJob ? toPublicJob(order.installJob, now) : null;
  const isOwner = persona.kind === 'vendor' && persona.id === order.vendorId;
  const forbidden = (): Denial => ({ ok: false, code: 'FORBIDDEN_FOR_PERSONA' });

  switch (to) {
    case 'SUBMITTED':
      if (persona.kind !== 'ops') return forbidden();
      if (!order.hasUploadedAsset) return { ok: false, code: 'GUARD_FAILED', reason: 'NO_UPLOADED_ASSET' };
      return { ok: true };
    case 'VENDOR_ACCEPTED':
    case 'IN_PRODUCTION':
    case 'READY_FOR_INSTALL':
      return isOwner ? { ok: true } : forbidden();
    case 'COMPLETED':
      if (persona.kind !== 'installer') return forbidden();
      if (!job || job.status !== 'ASSIGNED') return { ok: false, code: 'GUARD_FAILED', reason: 'NO_ASSIGNED_INSTALLER' };
      return job.installerId === persona.id ? { ok: true } : forbidden();
    case 'CANCELLED':
      return persona.kind === 'ops' || isOwner ? { ok: true } : forbidden();
    default:
      return forbidden();
  }
}

/**
 * The order buttons to render for this persona, derived from the same
 * `checkTransition` the server enforces. For each legal edge: an OK verdict
 * is an enabled button; GUARD_FAILED becomes a *disabled* button carrying the
 * human reason as its tooltip (the user can see what is missing, UI spec §6);
 * FORBIDDEN_FOR_PERSONA drops the button entirely — a vendor never sees
 * Submit, an installer never sees Accept. Surfaces should go through
 * `order-actions.ts#visibleOrderActions`, which also removes the installer's
 * `complete` (it lives in the job panel).
 */
export function orderActionsFor(persona: Persona, order: OrderCtx, now: Date): ActionAvailability[] {
  const results: ActionAvailability[] = [];
  for (const to of allowedTransitions(order.status)) {
    const action = actionForTransition(order.status, to);
    if (!action) continue;
    const verdict = checkTransition(persona, order, to, now);
    if (verdict.ok) {
      results.push({ action, enabled: true, reason: null });
    } else if (verdict.code === 'GUARD_FAILED') {
      const reason =
        verdict.reason === 'NO_UPLOADED_ASSET' ? 'Needs at least one uploaded file' : 'Needs an assigned installer';
      results.push({ action, enabled: false, reason });
    }
  }
  return results;
}

/**
 * May files be attached to an order in `status`? Ops only, and only while the
 * order is DRAFT or SUBMITTED (`UPLOADABLE_STATUSES`). `createAsset` runs it
 * once, and `assertOrderStillUploadable` re-runs it on every presign and on
 * complete, because the vendor can accept the order while parts are still in
 * flight (pipeline 3, step 3).
 */
export function checkUpload(persona: Persona, status: OrderStatus): Verdict {
  if (persona.kind !== 'ops') return { ok: false, code: 'FORBIDDEN_FOR_PERSONA' };
  if (!UPLOADABLE_STATUSES.includes(status as (typeof UPLOADABLE_STATUSES)[number])) {
    return { ok: false, code: 'GUARD_FAILED', reason: 'ORDER_NOT_UPLOADABLE' };
  }
  return { ok: true };
}

/**
 * What the install-job panel offers an installer, after lazy expiry. `canClaim`
 * is true for an OPEN (or lapsed-CLAIMED) job; `canVerify` only for the current
 * claimant; `canComplete` only for the ASSIGNED installer. `claimDisabledReason`
 * is the label under a greyed Claim button ("Claimed by another installer" is
 * what the losing tab in the race demo sees, UI spec §7.2). Note `canComplete`
 * ignores the *order's* status — use `order-actions.ts#canCompleteOrder`,
 * which does not.
 */
export function jobActionsFor(
  persona: Persona,
  job: JobLike | null,
  now: Date
): { canClaim: boolean; canVerify: boolean; canComplete: boolean; claimDisabledReason: string | null } {
  if (persona.kind !== 'installer' || !job) {
    return { canClaim: false, canVerify: false, canComplete: false, claimDisabledReason: null };
  }
  const pub = toPublicJob(job, now);
  const canClaim = pub.status === 'OPEN';
  const canVerify = pub.status === 'CLAIMED' && pub.claim?.installerId === persona.id;
  const canComplete = pub.status === 'ASSIGNED' && pub.installerId === persona.id;

  let claimDisabledReason: string | null = null;
  if (pub.status === 'CLAIMED' && pub.claim?.installerId !== persona.id) {
    claimDisabledReason = 'Claimed by another installer';
  } else if (pub.status === 'ASSIGNED') {
    claimDisabledReason = 'Assigned';
  }

  return { canClaim, canVerify, canComplete, claimDisabledReason };
}
