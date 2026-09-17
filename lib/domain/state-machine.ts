/**
 * The order state machine (graded behaviour #1): the transition table and the
 * action ↔ status mapping. Pure and shared, so the UI can only offer moves the
 * server will accept — and the server re-checks every request through the
 * same table via `permissions.ts#checkTransition` (Invariant 1).
 */
import type { OrderAction, OrderStatus } from './types';

/**
 * Legal next statuses per current status (architecture §6). CANCELLED is only
 * reachable before production starts; COMPLETED and CANCELLED are terminal.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['VENDOR_ACCEPTED', 'CANCELLED'],
  VENDOR_ACCEPTED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['READY_FOR_INSTALL'],
  READY_FOR_INSTALL: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** The list a 400 INVALID_TRANSITION response carries in `details.allowed` (UI spec §7.5). */
export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from];
}

/** First check inside `checkTransition`; false → INVALID_TRANSITION before any persona rule runs. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True for COMPLETED/CANCELLED — no outgoing edges, so no further order action is ever offered. */
export function isTerminal(s: OrderStatus): boolean {
  return TRANSITIONS[s].length === 0;
}

/** Whether Cancel is a legal edge from `s` — false once production has started (architecture §6). */
export function canCancel(s: OrderStatus): boolean {
  return TRANSITIONS[s].includes('CANCELLED');
}

/**
 * Button name → target status. The dialog sends the status, not the action,
 * so the API stays a plain state machine; the UI uses this to build the
 * request and `actionForTransition` to go the other way.
 */
export const ACTION_TARGET: Record<OrderAction, OrderStatus> = {
  submit: 'SUBMITTED',
  accept: 'VENDOR_ACCEPTED',
  start_production: 'IN_PRODUCTION',
  mark_ready: 'READY_FOR_INSTALL',
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
};

/**
 * Inverse of `ACTION_TARGET` for a legal edge: the button that moves `from`
 * to `to`, or null when the edge is not in `TRANSITIONS`. Used by
 * `orderActionsFor` to turn each allowed status into a labelled button.
 */
export function actionForTransition(from: OrderStatus, to: OrderStatus): OrderAction | null {
  if (!canTransition(from, to)) return null;
  for (const [action, target] of Object.entries(ACTION_TARGET) as [OrderAction, OrderStatus][]) {
    if (target === to) return action;
  }
  return null;
}
