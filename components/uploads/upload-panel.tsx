'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AssetRow } from '@/components/uploads/asset-row';
import { SimulateUploadDialog } from '@/components/uploads/simulate-upload-dialog';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/domain/format';
import { checkUpload } from '@/lib/domain/permissions';
import type { AssetDTO, OrderDTO, Persona } from '@/lib/domain/types';
import { useUploads } from '@/lib/upload/use-uploads';

/** Assets that still count towards the panel's "N files · size" summary. */
function counted(assets: AssetDTO[]): AssetDTO[] {
  return assets.filter((asset) => asset.status !== 'ABORTED' && asset.status !== 'FAILED');
}

/**
 * Section 5 of the detail sheet (UI spec §4.4, §4.10). Self-contained: it
 * reads live progress from `useUploads()` and takes only the order and the
 * persona, so the sheet can drop it in without owning any upload state.
 */
export function UploadPanel({ order, persona }: { order: OrderDTO; persona: Persona }) {
  const { start, abort, retry, local } = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const canUpload = checkUpload(persona, order.status).ok;
  const newestFirst = [...order.assets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summary = counted(order.assets);
  const totalBytes = summary.reduce((sum, asset) => sum + asset.sizeBytes, 0);

  /**
   * Every upload is awaited here purely to surface its failure: the row itself
   * is driven by the cache (mutation responses plus SSE), so nothing else is
   * waiting on this promise.
   */
  async function run(action: () => Promise<unknown>): Promise<unknown> {
    try {
      return await action();
    } catch (err) {
      toast.error(`Upload failed — ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset first, so picking the same file twice in a row still fires change.
    event.target.value = '';
    if (file) void run(() => start({ orderId: order.id, file }));
  }

  async function onRetry(asset: AssetDTO) {
    // No File left to re-send (a reload dropped it): ask for it again rather
    // than leaving Retry inert.
    if ((await run(() => retry(asset))) === false) fileInput.current?.click();
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-200 p-4">
      <div className="flex items-center">
        <span className="flex-1 text-[11px] leading-4 font-semibold tracking-[0.04em] whitespace-nowrap text-slate-600 uppercase">
          Assets
        </span>
        {summary.length > 0 && (
          <span className="text-[11px] leading-4 text-slate-400">
            {summary.length} {summary.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
          </span>
        )}
      </div>

      {newestFirst.length === 0 && (
        <span className="text-[13px] leading-[18px] text-slate-400">No files attached yet</span>
      )}

      {newestFirst.map((asset) => (
        <AssetRow
          key={asset.id}
          asset={asset}
          local={local[asset.id]}
          onAbort={() => abort(asset.id)}
          onRetry={() => void onRetry(asset)}
        />
      ))}

      {canUpload && (
        <div className="flex items-center gap-2 pt-0.5">
          <input ref={fileInput} type="file" className="sr-only" onChange={onPick} aria-label="Upload file" />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            className="h-auto rounded-[8px] px-3.5 py-[9px] text-[13px] leading-[18px] font-semibold text-slate-600"
          >
            Upload file
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSimulateOpen(true)}
            className="h-auto rounded-[8px] px-3.5 py-[9px] text-[13px] leading-[18px] font-semibold text-slate-600"
          >
            Simulate large file
          </Button>
        </div>
      )}

      <SimulateUploadDialog
        open={simulateOpen}
        onOpenChange={setSimulateOpen}
        onStart={(bytes) => {
          setSimulateOpen(false);
          void run(() => start({ orderId: order.id, simulatedBytes: bytes }));
        }}
      />
    </div>
  );
}
