'use client';

// components/orders — pipeline 1's confirm step. Everything between "the user
// picked an action" (card ⋯ menu, sheet action bar, JobPanel Complete) and
// `POST /api/orders/:id/transition` happens here: the version snapshot, the
// cancel reason, the client-side verdict and the 409 recovery path.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { orderCtx } from '@/lib/domain/order-actions';
import { checkTransition } from '@/lib/domain/permissions';
import { ACTION_CONSEQUENCE, ACTION_LABEL, STATUS_META } from '@/lib/domain/status-meta';
import { ACTION_TARGET } from '@/lib/domain/state-machine';
import type { OrderAction, OrderDTO, Persona } from '@/lib/domain/types';
import { ApiClientError } from '@/lib/query/api-client';
import { useTransition } from '@/lib/query/hooks';
import { keys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import { InlineError } from './inline-error';
import { StatusBadge } from './status-badge';
import { useRestoreFocus, visibleElement } from './use-restore-focus';

/**
 * Confirm dialog for one order transition (UI spec §7.1, §7.5; design 1d).
 *
 * Pipeline 1, step 2. The dashboard opens it with `{orderId, action}` and
 * passes the order read live from the cache; the dialog resolves the target
 * status via `ACTION_TARGET` and, on Confirm, calls `useTransition` →
 * `POST /api/orders/:id/transition` with `{to, expectedVersion, reason}`.
 *
 * Optimistic concurrency: `expectedVersion` is snapshotted into a ref when
 * the dialog opens (and re-armed only when `order.id` changes), *not* read
 * from the live order at confirm time. If another tab moved the order in the
 * meantime the server's single `updateMany({id, status, version})` matches
 * nothing and answers 409 VERSION_CONFLICT; `conflict` then disables Confirm
 * and `InlineError` shows "Refresh order", which invalidates bootstrap and
 * closes. Reading the version live would make the stale tab's request
 * silently succeed against a state the user never saw.
 *
 * Cancel requires a reason (`reasonMissing`): CANCELLED is terminal and only
 * reachable before production, and the reason is what lands in the history
 * entry — the audit trail is the only record of why an order died.
 *
 * `verdict` re-runs `checkTransition` — the exact pure function
 * `transitionOrder` calls on the server — with the same persona, `orderCtx`
 * and `now`. It is normally `ok` because the button that opened this dialog
 * came from the same table, but a persona switch with the dialog open (§7.8)
 * or a realtime status change can flip it, and then Confirm is disabled with
 * a note rather than letting the user fire a request that would 400/403
 * (Invariant 1 still holds either way; this is just a better error).
 *
 * `confirm` sends the mutation. Success closes the dialog — the cache is
 * patched by the hook's `onSuccess` via `setOrderInCache`, the same reducer
 * SSE uses, so the card moves before the change-stream echo arrives. Any
 * error is kept in state and rendered inline (never a toast); a 409 also sets
 * `conflict`.
 */
export function TransitionDialog({
  open,
  onOpenChange,
  order,
  action,
  persona,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read live from the cache by the dashboard; `order.version` may advance while open. */
  order: OrderDTO;
  /** The user's choice from a card menu or the action bar; mapped to a target status by `ACTION_TARGET`. */
  action: OrderAction;
  persona: Persona;
  /** Epoch ms from the board clock, so claim-sensitive guards agree with the card. */
  now: number;
}) {
  const queryClient = useQueryClient();
  const transition = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiClientError | null>(null);
  // A 409 means the version this dialog holds is stale, so retrying with it can
  // only fail again: "Refresh order" is the one forward path until the dialog
  // reopens or a fresh version of the order arrives.
  const [conflict, setConflict] = useState(false);

  const target = ACTION_TARGET[action];
  const destructive = action === 'cancel';

  // Version snapshot taken when the dialog opens, not read live: that is what
  // makes an outdated tab fail with 409 instead of silently succeeding (§7.5).
  const expectedVersion = useRef(order.version);

  useEffect(() => {
    if (!open) return;
    expectedVersion.current = order.version;
    setReason('');
    setError(null);
    setConflict(false);
    // Re-arming on `order.id` only — a realtime bump to `order.version` while
    // the dialog is open must leave the snapshot stale on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const restoreFocus = useRestoreFocus(
    open,
    // The opener is the sheet's action button or the card's ⋯ item; the latter
    // unmounts with its menu, so the card itself is the fallback.
    useCallback(() => visibleElement(`[data-order-id="${order.id}"]`), [order.id])
  );

  // Same pure check the server runs in `transitionOrder`; see the component doc.
  const verdict = checkTransition(persona, orderCtx(order), target, new Date(now));

  const reasonMissing = destructive && reason.trim().length === 0;
  const canConfirm = verdict.ok && !reasonMissing && !transition.isPending && !conflict;

  /** Sends the transition with the snapshotted version; see the component doc for the 409 path. */
  function confirm() {
    setError(null);
    transition.mutate(
      {
        orderId: order.id,
        to: target,
        expectedVersion: expectedVersion.current,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          const apiError = err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err));
          setError(apiError);
          setConflict(apiError.status === 409);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={restoreFocus} className="gap-4 rounded-[12px] p-6 sm:max-w-[440px]">
        <DialogHeader className="gap-4">
          <DialogTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">
            {destructive ? `Cancel ${order.orderNumber}?` : 'Move order'}
          </DialogTitle>

          <div className="flex items-center gap-2.5">
            <StatusBadge status={order.status} />
            <span className="text-[13px] leading-[18px] text-slate-400">→</span>
            <StatusBadge status={target} />
          </div>

          <DialogDescription className="text-[14px] leading-5 text-slate-600">
            {destructive
              ? `Orders cannot be cancelled once production starts. This one is still in ${STATUS_META[order.status].label}, so cancelling is allowed.`
              : `${ACTION_CONSEQUENCE[action]}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="transition-reason"
            className="text-[11px] leading-4 font-semibold tracking-[0.04em] text-slate-600 uppercase"
          >
            Reason{' '}
            <span className={destructive ? 'text-[#DC2626]' : 'font-normal tracking-normal text-slate-400 normal-case'}>
              {destructive ? 'required' : 'optional'}
            </span>
          </label>
          <Textarea
            id="transition-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={destructive ? 'Why is this order being cancelled?' : 'Add a note for the history trail'}
            className="min-h-14 resize-none rounded-[8px] border-slate-300 text-[14px] leading-5"
          />
        </div>

        {!verdict.ok && (
          <span className="text-[11px] leading-4 text-slate-400">
            {ACTION_LABEL[action]} is not available for the current persona.
          </span>
        )}

        {error && (
          <InlineError
            error={error}
            onRefresh={() => {
              void queryClient.invalidateQueries({ queryKey: keys.bootstrap });
              onOpenChange(false);
            }}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-[8px] px-3.5 py-[9px] text-[13px] leading-[18px] font-semibold text-slate-600"
          >
            Back
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={confirm}
            className={cn(
              'h-auto rounded-[8px] px-[18px] py-[9px] text-[13px] leading-[18px] font-semibold text-white',
              destructive ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#0D9488] hover:bg-[#0F766E]'
            )}
          >
            {transition.isPending ? 'Working…' : destructive ? 'Cancel order' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
