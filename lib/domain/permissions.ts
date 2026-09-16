import { allowedTransitions, actionForTransition, canTransition } from './state-machine';
import { toPublicJob } from './claims';
import type { JobLike } from './claims';
import { UPLOADABLE_STATUSES } from './constants';
import type { ActionAvailability, OrderStatus, Persona } from './types';

export interface OrderCtx {
  status: OrderStatus;
  vendorId: string;
  hasUploadedAsset: boolean;
  installJob: JobLike | null;
}

export type Denial = {
  ok: false;
  code: 'FORBIDDEN_FOR_PERSONA' | 'INVALID_TRANSITION' | 'GUARD_FAILED';
  reason?: 'NO_UPLOADED_ASSET' | 'NO_ASSIGNED_INSTALLER' | 'ORDER_NOT_UPLOADABLE';
  allowed?: OrderStatus[];
};

export type Verdict = { ok: true } | Denial;

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

export function checkUpload(persona: Persona, status: OrderStatus): Verdict {
  if (persona.kind !== 'ops') return { ok: false, code: 'FORBIDDEN_FOR_PERSONA' };
  if (!UPLOADABLE_STATUSES.includes(status as (typeof UPLOADABLE_STATUSES)[number])) {
    return { ok: false, code: 'GUARD_FAILED', reason: 'ORDER_NOT_UPLOADABLE' };
  }
  return { ok: true };
}

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
