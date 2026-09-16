'use client';

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

const PCT: Record<AssetStatus, string> = {
  PENDING: 'text-teal-700',
  UPLOADING: 'text-teal-700',
  UPLOADED: 'text-green-700',
  FAILED: 'text-red-600',
  ABORTED: 'text-slate-400',
};

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
