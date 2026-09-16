'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { claimRemainingMs, toPublicJob } from '@/lib/domain/claims';
import { canCompleteOrder } from '@/lib/domain/order-actions';
import { jobActionsFor } from '@/lib/domain/permissions';
import { claimTotalMs, ringColour } from '@/lib/domain/ring';
import type { InstallerDTO, JobDTO, OrderDTO, Persona } from '@/lib/domain/types';
import { useVerify } from '@/lib/query/hooks';
import { cn } from '@/lib/utils';
import { ClaimButton, claimButtonVisible } from './claim-button';
import { ClaimCountdown } from './claim-countdown';

const PILL = 'rounded-[6px] px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap';
const ACTION = 'h-auto rounded-[8px] px-3.5 py-[7px] text-[13px] leading-[18px] font-semibold';

/**
 * Section 4 of the detail sheet (UI spec §4.4, design 1c): install-job state,
 * who holds it, the claim countdown and — per the controller's ruling — the
 * one place the installer's Claim / Verify / Complete buttons live.
 *
 * Rendered only for Ready for install and Completed, and only when the order
 * has a job. Expiry is lazy: the job is read through `toPublicJob`, so a lapsed
 * claim reads OPEN here exactly as it does on the server.
 */
export function JobPanel({
  order,
  persona,
  installers,
  now,
  onClaim,
  onVerify,
  onComplete,
}: {
  order: OrderDTO;
  persona: Persona;
  installers: InstallerDTO[];
  /** Epoch ms from the board clock, so the panel and the card agree. */
  now: number;
  onClaim: (job: JobDTO) => void;
  onVerify: (job: JobDTO) => void;
  onComplete: (order: OrderDTO) => void;
}) {
  // Declared before the early return below: hooks may not sit behind a branch.
  const verify = useVerify();

  const job = order.installJob;
  if (!job || (order.status !== 'READY_FOR_INSTALL' && order.status !== 'COMPLETED')) return null;

  const at = new Date(now);
  const pub = toPublicJob(job, at);
  const { canVerify } = jobActionsFor(persona, job, at);
  // Asked of the order, not the job: the job stays ASSIGNED once the order is
  // COMPLETED, so the job alone would keep offering a dead Complete button.
  const canComplete = canCompleteOrder(persona, order, at);
  const nameOf = (id: string | null | undefined) =>
    (id ? installers.find((i) => i.id === id)?.name : undefined) ?? 'Unknown installer';
  const mine = (id: string | null | undefined) => (persona.kind === 'installer' && id === persona.id ? ' (you)' : '');

  const remaining = claimRemainingMs(pub, at);
  const total = pub.claim ? claimTotalMs(pub.claim) : 0;
  const colour = ringColour(remaining);
  const showClaim = claimButtonVisible(persona, job, now);
  const hasActions = showClaim || canVerify || canComplete;

  return (
    <section
      aria-label="Install job"
      className="flex flex-col gap-2.5 border-b border-slate-200 bg-slate-50 p-4"
    >
      <span className="text-[11px] leading-4 font-semibold tracking-[0.04em] text-slate-600 uppercase">
        Install job
      </span>

      <div className="flex items-center gap-2.5">
        {pub.status === 'ASSIGNED' && (
          <>
            <span className={cn(PILL, 'bg-green-100 text-green-700')}>Assigned</span>
            <span className="truncate text-[14px] leading-5 text-slate-900">
              {nameOf(pub.installerId)}
              {mine(pub.installerId)}
            </span>
          </>
        )}

        {pub.status === 'CLAIMED' && pub.claim && (
          <>
            <span className={cn(PILL, 'bg-amber-100 text-amber-700')}>Claimed</span>
            <span className="truncate text-[14px] leading-5 text-slate-900">
              {nameOf(pub.claim.installerId)}
              {mine(pub.claim.installerId)}
            </span>
            <span className="flex-1" />
            <ClaimCountdown
              expiresAt={pub.claim.expiresAt}
              now={now}
              className="text-[13px] leading-[18px]"
              // Matches the ring: teal, then amber under a minute, red under 30 s.
              style={{ color: colour }}
            />
          </>
        )}

        {pub.status === 'OPEN' && (
          <>
            <span className={cn(PILL, 'border border-teal-600 bg-white text-teal-700')}>Open for installers</span>
            <span className="truncate text-[14px] leading-5 text-slate-500">Unclaimed</span>
          </>
        )}
      </div>

      {pub.status === 'CLAIMED' && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full transition-[width] duration-1000 ease-linear"
              style={{ width: `${total > 0 ? Math.min(100, (remaining / total) * 100) : 0}%`, background: colour }}
            />
          </div>
          <span className="text-[11px] leading-4 text-slate-500">
            Releases to the marketplace at 0:00 unless verified.
          </span>
        </>
      )}

      {pub.status === 'OPEN' && (
        <span className="text-[11px] leading-4 text-slate-500">
          Any installer can claim this job; the first conditional update wins.
        </span>
      )}

      {hasActions && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {showClaim && (
            <ClaimButton job={job} persona={persona} installers={installers} now={now} onClaim={onClaim} />
          )}
          {canVerify && (
            <Button
              type="button"
              onClick={() => onVerify(pub)}
              className={cn(ACTION, 'bg-[#0D9488] text-white hover:bg-[#0F766E]')}
            >
              Verify claim
            </Button>
          )}
          {/* §7.4 without opening the dialog first: same mutation, same toast. */}
          {canVerify && (
            <Button
              type="button"
              variant="outline"
              disabled={verify.isPending}
              onClick={() =>
                verify.mutate(
                  { jobId: job.id, outcome: 'fail' },
                  { onSuccess: () => toast.error('Verification failed — job released') }
                )
              }
              className={cn(
                ACTION,
                'border border-slate-200 bg-white text-[#DC2626] hover:bg-[#FEF2F2] hover:text-[#B91C1C]'
              )}
            >
              Simulate failure
            </Button>
          )}
          {canComplete && (
            <Button
              type="button"
              onClick={() => onComplete(order)}
              className={cn(ACTION, 'bg-[#0D9488] text-white hover:bg-[#0F766E]')}
            >
              Complete
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
