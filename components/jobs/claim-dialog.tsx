'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/orders/inline-error';
import { useRestoreFocus, visibleElement } from '@/components/orders/use-restore-focus';
import { toPublicJob } from '@/lib/domain/claims';
import { formatDuration } from '@/lib/domain/format';
import { jobActionsFor } from '@/lib/domain/permissions';
import type { InstallerDTO, JobDTO, Persona } from '@/lib/domain/types';
import { ApiClientError } from '@/lib/query/api-client';
import { useClaim } from '@/lib/query/hooks';
import { cn } from '@/lib/utils';
import { JobChip } from './job-chip';

/**
 * Compact confirm before claiming (UI spec §4.8, design 1f "Claim 409").
 *
 * The 409 is the whole point: `useClaim` already invalidates the bootstrap on
 * a conflict, so the chip below the inline error re-renders as the winner's
 * counting claim while this dialog is still open. Claim stays disabled after
 * that — the job is no longer OPEN, and it only becomes claimable again when
 * the countdown lapses, at which point `jobActionsFor` re-enables it.
 */
export function ClaimDialog({
  open,
  onOpenChange,
  job,
  persona,
  installers,
  now,
  claimTtlMs,
  onClaimed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobDTO;
  persona: Persona;
  installers: InstallerDTO[];
  /** Epoch ms from the board clock. */
  now: number;
  /** The server's TTL (`BootstrapDTO.claimTtlMs`), so the copy follows an override. */
  claimTtlMs: number;
  onClaimed: (job: JobDTO) => void;
}) {
  const claim = useClaim();
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open, job.id]);

  const restoreFocus = useRestoreFocus(
    open,
    useCallback(() => visibleElement(`[data-order-id="${job.orderId}"]`), [job.orderId])
  );

  const pub = toPublicJob(job, new Date(now));
  const { canClaim } = jobActionsFor(persona, job, new Date(now));
  const taken = pub.status !== 'OPEN';

  function confirm() {
    setError(null);
    claim.mutate(
      { jobId: job.id },
      {
        onSuccess: (claimed) => {
          onOpenChange(false);
          onClaimed(claimed);
        },
        onError: (err) =>
          setError(err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err))),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={restoreFocus} className="gap-4 rounded-[12px] p-6 sm:max-w-[420px]">
        <DialogHeader className="gap-4">
          <DialogTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">
            Claim this job?
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-5 text-pretty text-slate-600">
            You&rsquo;ll have {formatDuration(claimTtlMs)} to verify your identity and payment details, otherwise it
            returns to the marketplace.
          </DialogDescription>
        </DialogHeader>

        {error && <InlineError error={error} />}

        {taken && (
          <div className="flex items-center gap-2.5 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2.5">
            <JobChip job={job} persona={persona} installers={installers} now={now} />
            <span className="text-[11px] leading-4 whitespace-nowrap text-slate-500">
              {pub.status === 'CLAIMED' ? 'Releases unless verified' : 'No longer open'}
            </span>
          </div>
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
            disabled={!canClaim || claim.isPending}
            onClick={confirm}
            className={cn(
              'h-auto rounded-[8px] px-[18px] py-[9px] text-[13px] leading-[18px] font-semibold',
              'bg-[#0D9488] text-white hover:bg-[#0F766E] disabled:bg-slate-300 disabled:text-slate-50'
            )}
          >
            {claim.isPending ? 'Claiming…' : 'Claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
