import { orderActionsFor, type OrderCtx } from './permissions';
import type { ActionAvailability, OrderDTO, Persona } from './types';

/**
 * The permission context for one order, derived from its DTO. Every surface
 * that asks "what can this persona do here?" builds it the same way, so the
 * `hasUploadedAsset` rule lives here rather than in each component.
 */
export function orderCtx(order: OrderDTO): OrderCtx {
  return {
    status: order.status,
    vendorId: order.vendorId,
    hasUploadedAsset: order.assets.some((asset) => asset.status === 'UPLOADED'),
    installJob: order.installJob,
  };
}

/**
 * The order actions a UI surface offers for this persona: `orderActionsFor`
 * minus `complete` for installers — that one belongs to the install job panel
 * (it is guarded by the claim, not by the order), so the order action bar and
 * the card overflow menu never offer it.
 */
export function visibleOrderActions(persona: Persona, order: OrderDTO, now: Date): ActionAvailability[] {
  return orderActionsFor(persona, orderCtx(order), now).filter(
    (availability) => !(persona.kind === 'installer' && availability.action === 'complete')
  );
}
