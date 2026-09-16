import { ORDER_STATUSES, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';

/** Statuses an installer can act on; everything else collapses to a rail (UI spec §4.2). */
const INSTALLER_COLUMNS: OrderStatus[] = ['READY_FOR_INSTALL', 'COMPLETED'];

/**
 * Ops see the whole board; a vendor sees only their own orders; an installer
 * sees the whole marketplace except other installers' finished work — COMPLETED
 * is their own history ("Completed · your installs", design 1b).
 */
export function visibleOrders(orders: OrderDTO[], persona: Persona): OrderDTO[] {
  if (persona.kind === 'vendor') return orders.filter((order) => order.vendorId === persona.id);
  if (persona.kind === 'installer') {
    return orders.filter(
      (order) => order.status !== 'COMPLETED' || order.installJob?.installerId === persona.id
    );
  }
  return orders.slice();
}

/** Whether a status renders as a full column or as a 40px collapsed rail. */
export function columnMode(
  status: OrderStatus,
  persona: Persona,
  expandedCancelled: boolean
): 'column' | 'rail' {
  if (status === 'CANCELLED') return expandedCancelled ? 'column' : 'rail';
  if (persona.kind === 'installer' && !INSTALLER_COLUMNS.includes(status)) return 'rail';
  return 'column';
}

/** Zero-filled count per status, so rails and headers can render without a lookup miss. */
export function countsByStatus(orders: OrderDTO[]): Record<OrderStatus, number> {
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
  for (const order of orders) counts[order.status] += 1;
  return counts;
}

/**
 * Statuses that get a mobile tab. Ops and vendors get all seven (CANCELLED is a
 * desktop rail but keeps its own tab); an installer only gets the statuses that
 * are columns for them, so the tabs match the desktop board.
 */
export function mobileStatuses(persona: Persona): OrderStatus[] {
  if (persona.kind !== 'installer') return [...ORDER_STATUSES];
  return ORDER_STATUSES.filter((status) => columnMode(status, persona, false) === 'column');
}

/** First non-empty tab for the persona in board order, else the first tab (UI spec §4.3). */
export function defaultMobileTab(orders: OrderDTO[], persona: Persona): OrderStatus {
  const counts = countsByStatus(visibleOrders(orders, persona));
  const statuses = mobileStatuses(persona);
  return statuses.find((status) => counts[status] > 0) ?? statuses[0];
}
