import type { OrderAction, OrderStatus } from './types';

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['VENDOR_ACCEPTED', 'CANCELLED'],
  VENDOR_ACCEPTED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['READY_FOR_INSTALL'],
  READY_FOR_INSTALL: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(s: OrderStatus): boolean {
  return TRANSITIONS[s].length === 0;
}

export function canCancel(s: OrderStatus): boolean {
  return TRANSITIONS[s].includes('CANCELLED');
}

export const ACTION_TARGET: Record<OrderAction, OrderStatus> = {
  submit: 'SUBMITTED',
  accept: 'VENDOR_ACCEPTED',
  start_production: 'IN_PRODUCTION',
  mark_ready: 'READY_FOR_INSTALL',
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
};

export function actionForTransition(from: OrderStatus, to: OrderStatus): OrderAction | null {
  if (!canTransition(from, to)) return null;
  for (const [action, target] of Object.entries(ACTION_TARGET) as [OrderAction, OrderStatus][]) {
    if (target === to) return action;
  }
  return null;
}
