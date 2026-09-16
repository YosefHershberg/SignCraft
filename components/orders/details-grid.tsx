import { SIGN_TYPE_LABEL } from '@/lib/domain/status-meta';
import type { OrderDTO } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** "17 Sep 2026" — the sheet has room for the year the card does not. */
function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso)
  );
}

function Cell({
  label,
  value,
  mono,
  wide,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', wide && 'col-span-full')}>
      <span className="text-[11px] leading-4 font-semibold tracking-[0.04em] text-slate-400 uppercase">
        {label}
      </span>
      <span
        className={cn(
          'text-[14px] leading-5 wrap-break-word text-slate-900',
          mono && 'font-mono text-[13px] leading-[18px] font-medium',
          muted && 'text-slate-600'
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Two-column details grid, section 3 of the detail sheet (UI spec §4.4). */
export function DetailsGrid({ order, vendorName }: { order: OrderDTO; vendorName: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-slate-200 p-4">
      <Cell label="Sign type" value={SIGN_TYPE_LABEL[order.signType]} />
      <Cell label="Size" value={`${order.widthCm} × ${order.heightCm} cm`} mono />
      <Cell label="Quantity" value={String(order.quantity)} mono />
      <Cell label="Install address" value={order.installAddress} />
      <Cell label="Due date" value={formatFullDate(order.dueDate)} />
      <Cell label="Vendor" value={vendorName} />
      <Cell label="Notes" value={order.notes?.trim() || '—'} wide muted />
    </div>
  );
}
