'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/board/kanban-board';
import { Providers } from '@/components/providers';
import { AppHeader } from '@/components/layout/app-header';
import { useBootstrap } from '@/lib/query/hooks';
import { keys } from '@/lib/query/keys';
import { useNow } from '@/lib/hooks/use-now';
import { useRealtime } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import type { BootstrapDTO, OrderStatus, Persona } from '@/lib/domain/types';

/** How long a card keeps its highlight ring after moving column (UI spec §4.2). */
const HIGHLIGHT_MS = 600;

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
  const queryClient = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const board = data ?? initialData;
  const now = useNow(Date.parse(board.serverTime));
  const highlightId = useStatusHighlight(board);

  const vendorNames = Object.fromEntries(board.vendors.map((v) => [v.id, v.name]));

  /** A claim countdown hit zero: refetch so the server's lazy expiry reconciles. */
  const onClaimExpired = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.bootstrap });
  }, [queryClient]);

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <AppHeader data={board} connectionStatus={connectionStatus} onNewOrder={() => {}} />

      <KanbanBoard
        orders={board.orders}
        persona={persona}
        vendorNames={vendorNames}
        installers={board.installers}
        now={now}
        onOpenOrder={setSelectedOrderId}
        highlightId={highlightId}
        selectedOrderId={selectedOrderId}
        loading={!data}
        onClaimExpired={onClaimExpired}
      />

      {persona.kind === 'ops' && (
        <button
          type="button"
          aria-label="New order"
          className="fixed right-4 bottom-5 flex size-[52px] items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-[0_16px_40px_rgba(15,23,42,0.16)] md:hidden"
        >
          ＋
        </button>
      )}
    </div>
  );
}

/**
 * Diffs each order's status against the previous render and flags the one that
 * moved, so its card can carry the 600 ms highlight ring. The first pass only
 * seeds the map — nothing highlights on load.
 */
function useStatusHighlight(board: BootstrapDTO): string | null {
  const previous = useRef<Map<string, OrderStatus> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const seen = previous.current;
    const next = new Map(board.orders.map((order) => [order.id, order.status]));
    previous.current = next;
    if (!seen) return;

    const moved = board.orders.find((order) => seen.has(order.id) && seen.get(order.id) !== order.status);
    if (!moved) return;

    setHighlightId(moved.id);
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [board.orders]);

  return highlightId;
}
