'use client';

// Pipeline 3 (direct-to-cloud upload): the size-picker that kicks off a
// simulated upload (no real File; `simulatedSource` in lib/upload/part-source.ts
// generates the bytes) through the same pipeline as a real one.
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SIMULATED_SIZES } from '@/lib/domain/constants';
import { formatBytes, formatCountdown } from '@/lib/domain/format';
import { cn } from '@/lib/utils';

/**
 * Nominal throughput behind the "≈ 36 s at 28 MB/s" hint on the selected size
 * (design screen 1f). A rough browser-to-R2 figure used only to set
 * expectations before the upload starts; once it is running the caption on the
 * asset row shows the rate actually measured.
 */
const NOMINAL_BYTES_PER_SECOND = 28 * 1024 * 1024;

/** 1 GB is the size the demo script uses, so it is the one pre-selected. */
const DEFAULT_BYTES = SIMULATED_SIZES[1].bytes;

/**
 * "Simulate large file" step of the upload flow (design screen 1f). Purely a
 * size picker — pressing Start hands `onStart(bytes)` back to `UploadPanel`,
 * which calls `useUploads().start({ simulatedBytes: bytes })` to run the same
 * `MultipartUploader` a real file would use.
 */
export function SimulateUploadDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (bytes: number) => void;
}) {
  const [bytes, setBytes] = useState<number>(DEFAULT_BYTES);

  useEffect(() => {
    if (open) setBytes(DEFAULT_BYTES);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-[12px] p-6 sm:max-w-[420px]">
        <DialogHeader className="gap-4">
          <DialogTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">
            Simulate large file
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-5 text-pretty text-slate-600">
            Generates a synthetic file in the browser and uploads it through the same presigned multipart pipeline. No
            real file needed.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={String(bytes)}
          onValueChange={(value) => setBytes(Number(value))}
          className="gap-2"
          aria-label="Simulated file size"
        >
          {SIMULATED_SIZES.map((size) => {
            const selected = size.bytes === bytes;
            return (
              <Label
                key={size.bytes}
                htmlFor={`simulate-${size.bytes}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-[14px] leading-5 font-normal text-slate-900',
                  selected ? 'border-[#0D9488] bg-[#F0FDFA]' : 'border-slate-200'
                )}
              >
                <RadioGroupItem
                  id={`simulate-${size.bytes}`}
                  value={String(size.bytes)}
                  className={cn('size-3.5', selected && 'border-[#0D9488] text-[#0D9488]')}
                />
                {size.label}
                {selected && (
                  <span className="ml-auto text-[11px] leading-4 text-[#0F766E]">
                    ≈ {formatCountdown((size.bytes / NOMINAL_BYTES_PER_SECOND) * 1000)} at{' '}
                    {formatBytes(NOMINAL_BYTES_PER_SECOND)}/s
                  </span>
                )}
              </Label>
            );
          })}
        </RadioGroup>

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
            onClick={() => onStart(bytes)}
            className="h-auto rounded-[8px] bg-[#0D9488] px-[18px] py-[9px] text-[13px] leading-[18px] font-semibold text-white hover:bg-[#0F766E]"
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
