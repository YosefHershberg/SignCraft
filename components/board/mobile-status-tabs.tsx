'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { countsByStatus, visibleOrders } from '@/lib/board/visibility';
import { STATUS_META } from '@/lib/domain/status-meta';
import { ORDER_STATUSES, type OrderDTO, type OrderStatus, type Persona } from '@/lib/domain/types';

/** Scrollable pill tabs above the single-column mobile list (UI spec §4.3). */
export function MobileStatusTabs({
  orders,
  persona,
  value,
  onChange,
  children,
}: {
  orders: OrderDTO[];
  persona: Persona;
  value: OrderStatus;
  onChange: (status: OrderStatus) => void;
  children: ReactNode;
}) {
  const counts = countsByStatus(visibleOrders(orders, persona));

  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as OrderStatus)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList className="h-auto w-full flex-none justify-start gap-2 overflow-x-auto rounded-none border-b border-slate-200 bg-white px-3.5 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ORDER_STATUSES.map((status) => (
          <TabsTrigger
            key={status}
            value={status}
            className="h-auto flex-none rounded-full bg-slate-100 px-[11px] py-[5px] text-[11px] leading-4 font-semibold text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            {STATUS_META[status].short} {counts[status]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value={value} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </TabsContent>
    </Tabs>
  );
}
