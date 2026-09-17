'use client';

// Pipeline 2 (claim race): the installer's Claim affordance, shared by the
// board card and `JobPanel`. Opens `ClaimDialog` on click; never performs the
// claim itself.
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toPublicJob } from '@/lib/domain/claims';
import { jobActionsFor } from '@/lib/domain/permissions';
import type { InstallerDTO, JobDTO, Persona } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { ClaimCountdown } from './claim-countdown';

/**
 * Whether `ClaimButton` renders anything: claiming is the installer's next
 * move either because the job is open, or because it is held by *someone else*
 * and the disabled button explains when it comes back. Exported so callers can
 * decide whether an action row exists at all.
 */
export function claimButtonVisible(persona: Persona, job: JobDTO, now: number): boolean {
  if (persona.kind !== 'installer') return false;
  const at = new Date(now);
  const pub = toPublicJob(job, at);
  if (jobActionsFor(persona, job, at).canClaim) return true;
  return pub.status === 'CLAIMED' && pub.claim !== null && pub.claim.installerId !== persona.id;
}

/**
 * The installer's Claim affordance, shared by the board card (design 1b) and
 * the detail sheet's job panel (design 1c).
 *
 * Nothing is rendered unless claiming is the installer's next move: an
 * ASSIGNED job, a job this installer already holds (the chip's "Verify" covers
 * that) and every non-installer persona all render `null`. A job another
 * installer holds renders disabled with the live-countdown tooltip from
 * UI spec §7.2.
 */
export function ClaimButton({
  job,
  persona,
  installers,
  now,
  onClaim,
  compact,
}: {
  job: JobDTO;
  persona: Persona;
  installers: InstallerDTO[];
  now: number;
  onClaim: (job: JobDTO) => void;
  /** Card-sized (11px) rather than the sheet's 13px button. */
  compact?: boolean;
}) {
  const at = new Date(now);
  const pub = toPublicJob(job, at);
  const { canClaim } = jobActionsFor(persona, job, at);

  if (!claimButtonVisible(persona, job, now)) return null;

  const button = (
    <Button
      type="button"
      disabled={!canClaim}
      onClick={(event) => {
        // On a card the button sits inside the card's own click target.
        event.stopPropagation();
        onClaim(pub);
      }}
      className={cn(
        'h-auto rounded-[8px] font-semibold',
        'bg-[#0D9488] text-white hover:bg-[#0F766E] disabled:bg-slate-300 disabled:text-slate-50',
        compact ? 'px-2.5 py-1 text-[11px] leading-4' : 'px-3.5 py-[7px] text-[13px] leading-[18px]'
      )}
    >
      Claim
    </Button>
  );

  if (canClaim) return button;

  const name = installers.find((i) => i.id === pub.claim?.installerId)?.name ?? 'another installer';

  // A disabled button swallows pointer events, so the tooltip hangs off a
  // focusable wrapper instead (same pattern as OrderActions).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex rounded-[8px] focus-visible:outline-none"
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Claimed by {name}, releases in{' '}
        {pub.claim && <ClaimCountdown expiresAt={pub.claim.expiresAt} now={now} />} unless verified
      </TooltipContent>
    </Tooltip>
  );
}
