'use client';

import { toPublicJob } from '@/lib/domain/claims';
import type { InstallerDTO, JobDTO, Persona } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { ClaimCountdown } from './claim-countdown';

const CHIP = 'inline-flex max-w-full items-center gap-1 self-start rounded-[6px] px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap';

/**
 * Install-job state on a card (UI spec §2, DESIGN.md "Colors"). The job is run
 * through `toPublicJob` first, so an expired claim reads as OPEN here exactly
 * as it does on the server.
 */
export function JobChip({
  job,
  persona,
  installers,
  now,
  onVerify,
  onExpire,
}: {
  job: JobDTO;
  persona: Persona;
  installers: InstallerDTO[];
  now: number;
  onVerify?: (job: JobDTO) => void;
  onExpire?: () => void;
}) {
  const pub = toPublicJob(job, new Date(now));
  const nameOf = (id: string | null) => (id ? installers.find((i) => i.id === id)?.name : undefined);

  if (pub.status === 'ASSIGNED') {
    const name = nameOf(pub.installerId);
    return <span className={cn(CHIP, 'bg-green-100 text-green-700')}>{name ? `Assigned · ${name}` : 'Assigned'}</span>;
  }

  if (pub.status === 'CLAIMED' && pub.claim) {
    const mine = persona.kind === 'installer' && pub.claim.installerId === persona.id;
    const countdown = <ClaimCountdown expiresAt={pub.claim.expiresAt} now={now} onExpire={onExpire} />;

    if (mine) {
      return (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVerify?.(pub);
          }}
          className={cn(CHIP, 'bg-amber-100 text-amber-700 hover:bg-amber-200')}
        >
          Your claim · {countdown} · <span className="underline underline-offset-2">Verify</span>
        </button>
      );
    }

    const name = nameOf(pub.claim.installerId);
    return (
      <span className={cn(CHIP, 'bg-amber-100 text-amber-700')}>
        {name ? `Claimed · ${name} · ` : 'Claimed · '}
        {countdown}
      </span>
    );
  }

  return <span className={cn(CHIP, 'border border-teal-600 bg-white text-teal-700')}>Open for installers</span>;
}
