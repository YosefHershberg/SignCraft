'use client';

import { useState } from 'react';
import { Providers } from '@/components/providers';
import { AppHeader } from '@/components/layout/app-header';
import { useBootstrap } from '@/lib/query/hooks';
import { useRealtime } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import { STATUS_META } from '@/lib/domain/status-meta';
import type { BootstrapDTO, Persona } from '@/lib/domain/types';

/**
 * App shell entry point. `Providers` needs `initialPersona` (only available
 * here, from the server-rendered cookie) so it wraps the interactive board
 * rather than living in app/layout.tsx.
 */
export function Dashboard({ initialData, initialPersona }: { initialData: BootstrapDTO; initialPersona: Persona }) {
  return (
    <Providers initialPersona={initialPersona}>
      <DashboardBoard initialData={initialData} />
    </Providers>
  );
}

function DashboardBoard({ initialData }: { initialData: BootstrapDTO }) {
  const { data } = useBootstrap(initialData);
  const connectionStatus = useRealtime();
  const { persona } = usePersona();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const board = data ?? initialData;

  function onOpenOrder(id: string) {
    setSelectedOrderId(id);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <AppHeader data={board} connectionStatus={connectionStatus} onNewOrder={() => {}} />

      {/* Placeholder board; Task 12 replaces this with <KanbanBoard>. */}
      <main className="flex-1 overflow-auto p-4">
        <ul className="flex flex-col gap-2">
          {board.orders.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onOpenOrder(order.id)}
                className={`flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-left text-sm ${
                  selectedOrderId === order.id ? 'border-teal-500' : 'border-slate-200'
                }`}
              >
                <span className="font-mono">{order.orderNumber}</span>
                <span className="text-slate-500">{STATUS_META[order.status].label}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      {persona.kind === 'ops' && (
        <button
          type="button"
          aria-label="New order"
          className="fixed right-5 bottom-5 flex size-14 items-center justify-center rounded-full bg-[#0D9488] text-2xl text-white shadow-lg sm:hidden"
        >
          +
        </button>
      )}
    </div>
  );
}
