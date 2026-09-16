import { ORDER_STATUSES, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';

/** Statuses an installer can act on; everything else collapses to a rail (UI spec §4.2). */
const INSTALLER_COLUMNS: OrderStatus[] = ['READY_FOR_INSTALL', 'COMPLETED'];

/** Ops and installers see the whole board; a vendor sees only their own orders. */
export function visibleOrders(orders: OrderDTO[], persona: Persona): OrderDTO[] {
  if (persona.kind !== 'vendor') return orders.slice();
  return orders.filter((order) => order.vendorId === persona.id);
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

/** First non-empty status for the persona in board order, else DRAFT (UI spec §4.3). */
export function defaultMobileTab(orders: OrderDTO[], persona: Persona): OrderStatus {
  const counts = countsByStatus(visibleOrders(orders, persona));
  return ORDER_STATUSES.find((status) => counts[status] > 0) ?? 'DRAFT';
}
