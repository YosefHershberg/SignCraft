'use client';

// components/board — the below-md navigation for the board: one pill per
// status the persona can see (`mobileStatuses`), with the selected status's
// list rendered as children. `KanbanBoard` owns the selected tab so a
// realtime update cannot move the user off it.

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STATUS_META } from '@/lib/domain/status-meta';
import type { OrderStatus } from '@/lib/domain/types';

/**
 * Scrollable pill tabs above the single-column mobile list (UI spec §4.3).
 * `statuses` and `counts` come from the board so neither is recomputed here.
 */
export function MobileStatusTabs({
  statuses,
  counts,
  value,
  onChange,
  children,
}: {
  statuses: OrderStatus[];
  counts: Record<OrderStatus, number>;
  value: OrderStatus;
  onChange: (status: OrderStatus) => void;
  children: ReactNode;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as OrderStatus)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList className="h-auto w-full flex-none justify-start gap-2 overflow-x-auto rounded-none border-b border-slate-200 bg-white px-3.5 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {statuses.map((status) => (
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
