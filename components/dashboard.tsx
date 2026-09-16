'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/board/kanban-board';
import { DashboardDialogs } from '@/components/dashboard-dialogs';
import { Providers } from '@/components/providers';
import { AppHeader } from '@/components/layout/app-header';
import { useBootstrap } from '@/lib/query/hooks';
import { keys } from '@/lib/query/keys';
import { useNow } from '@/lib/hooks/use-now';
import { useRealtime } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import type { BootstrapDTO, JobDTO, OrderAction, OrderDTO, OrderStatus, Persona } from '@/lib/domain/types';

/** How long a card keeps its highlight ring after moving column (UI spec §4.2). */
const HIGHLIGHT_MS = 600;

/** Stable identity so the decay effect below does not re-arm on every render. */
const NO_HIGHLIGHT: ReadonlySet<string> = new Set();

/** How long a lapsed claim stays in the "already refetched" set (see `onClaimExpired`). */
const DEDUPE_WINDOW_MS = 10 * 60_000;

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
  const [pendingAction, setPendingAction] = useState<{ orderId: string; action: OrderAction } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Both installer dialogs are keyed by order id, not by a captured JobDTO, so
  // an SSE frame (someone else's claim, a lapsed TTL) re-renders them live.
  const [claimOrderId, setClaimOrderId] = useState<string | null>(null);
  const [verifyOrderId, setVerifyOrderId] = useState<string | null>(null);

  const board = data ?? initialData;
  const now = useNow(Date.parse(board.serverTime));
  const { highlightIds, highlight } = useStatusHighlight(board);
  const expiredClaims = useRef(new Set<string>());

  const vendorNames = Object.fromEntries(board.vendors.map((v) => [v.id, v.name]));

  const onAction = useCallback(
    (order: OrderDTO, action: OrderAction) => setPendingAction({ orderId: order.id, action }),
    []
  );

  const onClaim = useCallback((job: JobDTO) => setClaimOrderId(job.orderId), []);
  const onVerify = useCallback((job: JobDTO) => setVerifyOrderId(job.orderId), []);

  /**
   * A claim lapsed: refetch so the server's lazy expiry reconciles. The mobile
   * and desktop trees are both mounted, so the same claim reports twice —
   * `key` is `<jobId>:<expiresAt>`, which makes the refetch once-per-claim.
   */
  const onClaimExpired = useCallback(
    (key: string) => {
      if (expiredClaims.current.has(key)) return;
      // Long-lived tab: drop keys whose expiry is well past, so the set stays
      // the size of the claims still on screen rather than the session's total.
      for (const seen of expiredClaims.current) {
        if (Date.parse(seen.slice(seen.indexOf(':') + 1)) < Date.now() - DEDUPE_WINDOW_MS) {
          expiredClaims.current.delete(seen);
        }
      }
      expiredClaims.current.add(key);
      void queryClient.invalidateQueries({ queryKey: keys.bootstrap });
    },
    [queryClient]
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <AppHeader data={board} connectionStatus={connectionStatus} onNewOrder={() => setCreateOpen(true)} />

      <KanbanBoard
        orders={board.orders}
        persona={persona}
        vendorNames={vendorNames}
        installers={board.installers}
        now={now}
        onOpenOrder={setSelectedOrderId}
        onAction={onAction}
        highlightIds={highlightIds}
        selectedOrderId={selectedOrderId}
        loading={!data}
        onVerify={onVerify}
        onClaim={onClaim}
        onClaimExpired={onClaimExpired}
      />

      {persona.kind === 'ops' && (
        <button
          type="button"
          aria-label="New order"
          onClick={() => setCreateOpen(true)}
          className="fixed right-4 bottom-5 flex size-[52px] items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-[0_16px_40px_rgba(15,23,42,0.16)] md:hidden"
        >
          ＋
        </button>
      )}

      <DashboardDialogs
        board={board}
        persona={persona}
        now={now}
        onAction={onAction}
        onClaim={onClaim}
        onVerify={onVerify}
        onCreated={(order) => highlight(order.id)}
        state={{
          selectedOrderId,
          setSelectedOrderId,
          pendingAction,
          setPendingAction,
          createOpen,
          setCreateOpen,
          claimOrderId,
          setClaimOrderId,
          verifyOrderId,
          setVerifyOrderId,
        }}
      />
    </div>
  );
}

/**
 * Diffs each order's status against the previous render and flags every order
 * that moved, so those cards can carry the 600 ms highlight ring. The first
 * pass only seeds the map — nothing highlights on load. `highlight` is the
 * manual entrance for a just-created order, which has no previous status to
 * diff against but still deserves the ring (UI spec §4.5).
 */
function useStatusHighlight(board: BootstrapDTO): {
  highlightIds: ReadonlySet<string>;
  highlight: (orderId: string) => void;
} {
  const previous = useRef<Map<string, OrderStatus> | null>(null);
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(NO_HIGHLIGHT);

  useEffect(() => {
    const seen = previous.current;
    const next = new Map(board.orders.map((order) => [order.id, order.status]));
    previous.current = next;
    if (!seen) return;

    const moved = board.orders.filter((order) => seen.has(order.id) && seen.get(order.id) !== order.status);
    if (moved.length === 0) return;

    setHighlightIds(new Set(moved.map((order) => order.id)));
  }, [board.orders]);

  // The decay is its own effect keyed on the set: when it lived in the diff
  // effect, any payload arriving inside the 600 ms window that moved nothing
  // ran the cleanup and returned without re-arming, stranding the ring.
  useEffect(() => {
    if (highlightIds.size === 0) return;
    const timer = setTimeout(() => setHighlightIds(NO_HIGHLIGHT), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightIds]);

  const highlight = useCallback((orderId: string) => setHighlightIds(new Set([orderId])), []);

  return { highlightIds, highlight };
}
