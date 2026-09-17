'use client';

// Pipeline 3 (direct-to-cloud upload): the shared progress-bar visual used
// both on the board card (compact) and in the detail sheet's asset list.
import { Progress } from '@/components/ui/progress';
import type { AssetDTO, AssetStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** 4px bar on an #E2E8F0 track; the fill carries the asset state (DESIGN.md). */
const BAR: Record<AssetStatus, string> = {
  PENDING: '[&>[data-slot=progress-indicator]]:bg-teal-600',
  UPLOADING: '[&>[data-slot=progress-indicator]]:bg-teal-600',
  UPLOADED: '[&>[data-slot=progress-indicator]]:bg-green-600',
  FAILED: '[&>[data-slot=progress-indicator]]:bg-red-600',
  ABORTED: '[&>[data-slot=progress-indicator]]:bg-slate-400',
};

/** Percentage-label text colour, one per `AssetStatus`, matching `BAR`. */
const PCT: Record<AssetStatus, string> = {
  PENDING: 'text-teal-700',
  UPLOADING: 'text-teal-700',
  UPLOADED: 'text-green-700',
  FAILED: 'text-red-600',
  ABORTED: 'text-slate-400',
};

/**
 * Renders `asset.progressPct` as a labelled bar. Shared by `AssetRow` (which
 * passes a view with `progressPct` overridden to this tab's live percentage
 * while it is the one uploading) and the board card, so cards in other tabs —
 * which have no local uploader — still move as `progressPct` arrives over SSE.
 */
export function UploadProgressBar({ asset, compact }: { asset: AssetDTO; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {!compact && (
        <div className="flex justify-between gap-2">
          <span
            className={cn(
              'truncate text-[11px] leading-4 text-slate-600',
              asset.status === 'ABORTED' && 'line-through'
            )}
          >
            {asset.fileName}
          </span>
          <span className={cn('font-mono text-[11px] leading-4 font-medium tabular-nums', PCT[asset.status])}>
            {asset.progressPct}%
          </span>
        </div>
      )}
      <Progress
        value={asset.progressPct}
        aria-label={`${asset.fileName} upload`}
        className={cn('h-1 bg-slate-200', BAR[asset.status])}
      />
    </div>
  );
}
