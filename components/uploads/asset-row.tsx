'use client';

import { Check, X } from 'lucide-react';
import { UploadProgressBar } from '@/components/uploads/upload-progress-bar';
import { formatBytes, formatCountdown } from '@/lib/domain/format';
import type { AssetDTO, AssetStatus } from '@/lib/domain/types';
import type { LocalProgress } from '@/lib/upload/use-uploads';
import { cn } from '@/lib/utils';

const BADGE: Record<AssetStatus, { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Pending', bg: '#F1F5F9', fg: '#475569' },
  UPLOADING: { label: 'Uploading', bg: '#CCFBF1', fg: '#0F766E' },
  UPLOADED: { label: 'Uploaded', bg: '#DCFCE7', fg: '#15803D' },
  FAILED: { label: 'Failed', bg: '#FEE2E2', fg: '#991B1B' },
  ABORTED: { label: 'Aborted', bg: '#F1F5F9', fg: '#475569' },
};

/**
 * One asset in the sheet's Assets panel (DESIGN.md "Asset row", UI spec §4.10).
 *
 * `local` is the live progress of an upload this tab is driving. It wins over
 * the server's `progressPct` while the upload runs — but only while the server
 * still calls the asset in flight, so a terminal status arriving over SSE
 * (aborted from another tab, completed, failed) is never argued with.
 */
export function AssetRow({
  asset,
  local,
  canUpload,
  onAbort,
  onRetry,
}: {
  asset: AssetDTO;
  local?: LocalProgress;
  /** `checkUpload(persona, status).ok` — only then are abort and retry offered. */
  canUpload: boolean;
  onAbort: () => void;
  onRetry: () => void;
}) {
  const inFlight = asset.status === 'PENDING' || asset.status === 'UPLOADING';
  const live = inFlight ? local : undefined;

  const pct = live ? Math.floor(live.pct) : asset.progressPct;
  const bytesUploaded = live ? live.bytesUploaded : asset.bytesUploaded;
  const view = pct === asset.progressPct ? asset : { ...asset, progressPct: pct };

  const badge = BADGE[asset.status];
  const aborted = asset.status === 'ABORTED';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex-1 truncate text-[14px] leading-5 text-slate-900',
            aborted && 'text-slate-400 line-through'
          )}
          title={asset.fileName}
        >
          {asset.fileName}
        </span>

        {asset.simulated && (
          <span className="rounded-[6px] border border-slate-200 px-1.5 text-[11px] leading-4 whitespace-nowrap text-slate-400">
            simulated
          </span>
        )}

        <span
          className={cn(
            'font-mono text-[13px] leading-[18px] font-medium tabular-nums whitespace-nowrap',
            inFlight ? 'text-teal-700' : aborted ? 'text-slate-400' : 'text-slate-500'
          )}
        >
          {inFlight ? `${pct}%` : formatBytes(asset.sizeBytes)}
        </span>

        <span
          className="inline-flex items-center gap-1 rounded-[6px] px-[7px] py-px text-[11px] leading-4 font-semibold whitespace-nowrap"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {asset.status === 'UPLOADED' && <Check className="size-3" aria-hidden />}
          {badge.label}
        </span>

        {inFlight && canUpload && (
          <button
            type="button"
            onClick={onAbort}
            aria-label={`Abort upload of ${asset.fileName}`}
            className="text-slate-400 transition-colors hover:text-slate-600"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}

        {asset.status === 'FAILED' && canUpload && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] leading-4 font-semibold text-[#B91C1C] hover:underline"
          >
            Retry
          </button>
        )}
      </div>

      {inFlight && (
        <>
          <UploadProgressBar asset={view} compact />
          <span className="text-[11px] leading-4 text-slate-400">
            {bytesUploaded === 0
              ? 'Starting…'
              : `${formatBytes(bytesUploaded)} of ${formatBytes(asset.sizeBytes)}${
                  live && live.bytesPerSecond > 0
                    ? ` · ${formatBytes(live.bytesPerSecond)}/s · ${formatCountdown(live.etaMs)} left`
                    : ''
                }`}
          </span>
        </>
      )}
    </div>
  );
}
