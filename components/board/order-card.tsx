'use client';

import { JobChip } from '@/components/jobs/job-chip';
import { UploadProgressBar } from '@/components/uploads/upload-progress-bar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDue } from '@/lib/domain/format';
import { visibleOrderActions } from '@/lib/domain/order-actions';
import { jobActionsFor } from '@/lib/domain/permissions';
import { ACTION_LABEL, SIGN_TYPE_LABEL, STATUS_META } from '@/lib/domain/status-meta';
import type { InstallerDTO, JobDTO, OrderAction, OrderDTO, Persona } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export interface OrderCardProps {
  order: OrderDTO;
  persona: Persona;
  vendorName: string;
  installers: InstallerDTO[];
  now: number;
  onOpen: (orderId: string) => void;
  highlight?: boolean;
  selected?: boolean;
  /** Task 13 wires the overflow menu; without it the ⋯ button is not rendered. */
  onAction?: (order: OrderDTO, action: OrderAction) => void;
  onVerify?: (job: JobDTO) => void;
  /** Fired once per lapsed claim, keyed `<jobId>:<expiresAt>` so the board can dedupe. */
  onClaimExpired?: (key: string) => void;
}

/** One order on the board (DESIGN.md "Order card", UI spec §4.2). */
export function OrderCard({
  order,
  persona,
  vendorName,
  installers,
  now,
  onOpen,
  highlight,
  selected,
  onAction,
  onVerify,
  onClaimExpired,
}: OrderCardProps) {
  const meta = STATUS_META[order.status];
  const at = new Date(now);
  const actions = visibleOrderActions(persona, order, at);
  const jobActions = jobActionsFor(persona, order.installJob, at);
  // Muted only when the persona can do *nothing* with the card — a card with a
  // disabled-but-listed action still reads as actionable (DESIGN.md "Order card").
  const inert = actions.length === 0 && !jobActions.canClaim && !jobActions.canVerify && !jobActions.canComplete;

  const uploading = order.assets.find((a) => a.status === 'UPLOADING');
  const showJob = order.installJob && (order.status === 'READY_FOR_INSTALL' || order.status === 'COMPLETED');
  const dateLine =
    order.status === 'COMPLETED' ? `Done ${formatDue(order.updatedAt)}` : `Due ${formatDue(order.dueDate)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${order.orderNumber} — ${order.title}`}
      // The detail sheet focuses this card again when it closes and the element
      // that opened it is gone (components/orders/use-restore-focus.ts).
      data-order-id={order.id}
      data-selected={selected ? 'true' : undefined}
      onClick={() => onOpen(order.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(order.id);
        }
      }}
      className={cn(
        'animate-in fade-in slide-in-from-left-2 flex shrink-0 cursor-pointer overflow-hidden rounded-[8px]',
        'border border-slate-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] duration-300',
        'focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:outline-none',
        // Selected = the card whose detail sheet is open (Task 13): teal border.
        'data-[selected=true]:border-[#0D9488]',
        inert && 'opacity-85',
        highlight && 'ring-2 ring-teal-500 ring-offset-1'
      )}
    >
      <div className="w-[3px] flex-none" style={{ background: meta.dot }} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
          <span className="font-mono text-[13px] leading-[18px] font-semibold text-slate-900">{order.orderNumber}</span>
          <span className="truncate text-[11px] leading-4 text-slate-500">
            {SIGN_TYPE_LABEL[order.signType]} · {order.quantity} {order.quantity === 1 ? 'pc' : 'pcs'}
          </span>
        </div>

        <div className="text-[13px] leading-[18px] font-semibold text-slate-900">
          {order.customerName} — {order.title}
        </div>

        <div className="flex flex-wrap justify-between gap-x-2.5 gap-y-0.5 text-[11px] leading-4 whitespace-nowrap text-slate-500">
          <span className="truncate">{vendorName}</span>
          <span>{dateLine}</span>
        </div>

        {uploading && (
          <div className="mt-0.5">
            <UploadProgressBar asset={uploading} />
          </div>
        )}

        {showJob && order.installJob && (
          <div className="mt-0.5 flex">
            <JobChip
              job={order.installJob}
              persona={persona}
              installers={installers}
              now={now}
              onVerify={onVerify}
              onExpire={onClaimExpired}
            />
          </div>
        )}

        <div className="mt-0.5 flex items-center justify-end gap-2">
          <span className="font-mono text-[10px] leading-[14px] font-medium text-slate-400">v{order.version}</span>
          {onAction && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Actions for ${order.orderNumber}`}
                onClick={(event) => event.stopPropagation()}
                className="text-[12px] leading-3 font-semibold text-slate-400 hover:text-slate-600 focus-visible:outline-none"
              >
                ⋯
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                {actions.length === 0 && (
                  <DropdownMenuItem disabled>No actions for this persona</DropdownMenuItem>
                )}
                {actions.map(({ action, enabled, reason }) => (
                  <DropdownMenuItem
                    key={action}
                    disabled={!enabled}
                    onSelect={() => onAction(order, action)}
                    variant={action === 'cancel' ? 'destructive' : 'default'}
                  >
                    {ACTION_LABEL[action]}
                    {reason && <span className="ml-auto pl-3 text-[10px] text-slate-400">{reason}</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
