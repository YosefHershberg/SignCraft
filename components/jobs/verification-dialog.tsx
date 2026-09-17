'use client';

// Pipeline 2 (claim race): the verification step after a winning claim —
// counts down the TTL and calls `useVerify()` (pass -> ASSIGNED, fail -> OPEN).
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/orders/inline-error';
import { useRestoreFocus, visibleElement } from '@/components/orders/use-restore-focus';
import { claimRemainingMs, toPublicJob } from '@/lib/domain/claims';
import { claimTotalMs } from '@/lib/domain/ring';
import type { JobDTO, Persona } from '@/lib/domain/types';
import { ApiClientError } from '@/lib/query/api-client';
import { useVerify } from '@/lib/query/hooks';
import { cn } from '@/lib/utils';
import { CountdownRing } from './countdown-ring';

const GHOST = 'h-auto rounded-[8px] border border-slate-200 bg-white px-3.5 py-[9px] text-[13px] leading-[18px] font-semibold hover:bg-slate-50';
const PRIMARY = 'h-auto rounded-[8px] bg-[#0D9488] px-[18px] py-[9px] text-[13px] leading-[18px] font-semibold text-white hover:bg-[#0F766E]';
/** The success state is a beat, not a screen: long enough to read, then gone. */
const SUCCESS_MS = 800;

/**
 * The concurrency demo's centrepiece (UI spec §4.9, design 1d).
 *
 * Expiry is derived, never stored: the view is "expired" whenever the claim
 * this dialog is showing no longer reads as *mine and live* through
 * `toPublicJob` — the same lazy rule the server applies — or when a Verify
 * comes back 409 CLAIM_EXPIRED. Closing early is deliberate: the claim keeps
 * ticking on the card and its chip reopens this dialog.
 */
export function VerificationDialog({
  open,
  onOpenChange,
  job,
  persona,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobDTO;
  persona: Persona;
  /** Epoch ms from the board clock, so the ring and the chip agree. */
  now: number;
}) {
  const verify = useVerify();
  const [assigned, setAssigned] = useState(false);
  const [expiredByServer, setExpiredByServer] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    if (!open) return;
    setAssigned(false);
    setExpiredByServer(false);
    setError(null);
  }, [open, job.id]);

  const restoreFocus = useRestoreFocus(
    open,
    useCallback(() => visibleElement(`[data-order-id="${job.orderId}"]`), [job.orderId])
  );

  const at = new Date(now);
  const pub = toPublicJob(job, at);
  const mine = pub.status === 'CLAIMED' && persona.kind === 'installer' && pub.claim?.installerId === persona.id;
  const remaining = claimRemainingMs(pub, at);
  // `view` is derived fresh every render, never stored: `success` once this
  // tab's own verify-pass response set `assigned`; `expired` if the server
  // said so (`CLAIM_EXPIRED`) or if the lazily-expired `pub` no longer shows
  // this installer holding a live claim; `counting` otherwise. Recomputing it
  // from `toPublicJob(job, now)` on every tick is what lets the dialog flip to
  // `expired` on its own the instant the countdown reaches zero, with no timer
  // of its own to fall out of sync with the server's rule.
  const view = assigned ? 'success' : expiredByServer || !mine || remaining <= 0 ? 'expired' : 'counting';

  // The close is scheduled from an effect but must not be re-armed by the
  // 1 s clock tick, so the callback is read through a ref rather than being an
  // effect dependency.
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  useEffect(() => {
    if (view !== 'success') return;
    const timer = setTimeout(() => close.current(false), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [view]);

  /** Submits the verify outcome. `pass` moves to the `success` view (job ASSIGNED); `fail` closes the dialog and toasts, since a deliberately failed job has nothing left to show here. A `CLAIM_EXPIRED` response is treated as the `expired` view rather than a generic error. */
  function submit(outcome: 'pass' | 'fail') {
    setError(null);
    verify.mutate(
      { jobId: job.id, outcome },
      {
        onSuccess: () => {
          if (outcome === 'pass') return setAssigned(true);
          onOpenChange(false);
          toast.error('Verification failed — job released');
        },
        onError: (err) => {
          const apiError = err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err));
          if (apiError.code === 'CLAIM_EXPIRED') setExpiredByServer(true);
          else setError(apiError);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={restoreFocus}
        className="items-center gap-4 rounded-[12px] p-6 sm:max-w-[440px]"
      >
        <DialogHeader className="w-full gap-1 self-start text-left">
          <DialogTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">
            {view === 'success' ? "You're assigned" : view === 'expired' ? 'Claim expired' : 'Verify this job'}
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-5 text-slate-600">
            {view === 'success'
              ? 'This install is yours — Complete it when the sign is up.'
              : view === 'expired'
                ? // The §4.9 sentence is "Claim expired — job returned to marketplace";
                  // its first half is already the title, so only the second half runs here.
                  'Job returned to marketplace.'
                : 'Verify identity and payment to lock in this job.'}
          </DialogDescription>
        </DialogHeader>

        {view === 'counting' && pub.claim && (
          <>
            <div className="my-1">
              <CountdownRing remainingMs={remaining} totalMs={claimTotalMs(pub.claim)} size={180} />
            </div>

            {remaining > 30_000 ? (
              <span className="max-w-[320px] text-center text-[11px] leading-4 text-pretty text-slate-500">
                You can close this dialog — the claim keeps counting down on the card and the chip reopens it.
              </span>
            ) : (
              <div className="w-full rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[11px] leading-4 text-[#991B1B]">
                At 0:00 the job returns to the marketplace and any installer can claim it.
              </div>
            )}
          </>
        )}

        {view === 'success' && (
          <div className="my-2 flex size-[120px] items-center justify-center rounded-full bg-[#DCFCE7] text-[44px] leading-none text-[#15803D]">
            ✓
          </div>
        )}

        {view === 'expired' && (
          <div className="w-full rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[11px] leading-4 text-[#991B1B]">
            Any installer can claim it again now. Nothing was recorded in the order history — claims are job events,
            not order transitions.
          </div>
        )}

        {error && <InlineError error={error} />}

        <div className="mt-1 flex w-full items-center gap-2">
          {view === 'counting' && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={verify.isPending}
                onClick={() => submit('fail')}
                className={cn(GHOST, 'text-[#DC2626] hover:bg-[#FEF2F2] hover:text-[#B91C1C]')}
              >
                Simulate failure
              </Button>
              <span className="flex-1" />
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className={cn(GHOST, 'text-slate-600')}
              >
                Close
              </Button>
              <Button type="button" disabled={verify.isPending} onClick={() => submit('pass')} className={PRIMARY}>
                {verify.isPending ? 'Verifying…' : 'Verify'}
              </Button>
            </>
          )}

          {view !== 'counting' && (
            <>
              <span className="flex-1" />
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className={cn(GHOST, 'text-slate-600')}
              >
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
