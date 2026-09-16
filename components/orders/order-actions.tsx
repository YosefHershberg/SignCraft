'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { orderActionsFor } from '@/lib/domain/permissions';
import { ACTION_LABEL } from '@/lib/domain/status-meta';
import type { ActionAvailability, OrderAction, OrderDTO, Persona } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/**
 * `complete` belongs to the installer's JobPanel (it is guarded by the claim,
 * not by the order), so the order action bar never offers it to an installer.
 */
function visibleActions(order: OrderDTO, persona: Persona, now: Date): ActionAvailability[] {
  const ctx = {
    status: order.status,
    vendorId: order.vendorId,
    hasUploadedAsset: order.assets.some((a) => a.status === 'UPLOADED'),
    installJob: order.installJob,
  };
  return orderActionsFor(persona, ctx, now).filter(
    (a) => !(persona.kind === 'installer' && a.action === 'complete')
  );
}

function ActionButton({
  availability,
  onAction,
}: {
  availability: ActionAvailability;
  onAction: (action: OrderAction) => void;
}) {
  const { action, enabled, reason } = availability;
  const destructive = action === 'cancel';

  const button = (
    <Button
      type="button"
      disabled={!enabled}
      onClick={() => onAction(action)}
      className={cn(
        'h-auto rounded-[8px] px-3.5 py-[7px] text-[13px] leading-[18px] font-semibold',
        destructive
          ? 'border border-slate-200 bg-white text-[#DC2626] hover:bg-[#FEF2F2]'
          : 'bg-[#0D9488] text-white hover:bg-[#0F766E]'
      )}
    >
      {ACTION_LABEL[action]}
    </Button>
  );

  if (enabled || !reason) return button;

  // A disabled button swallows pointer events, so the tooltip hangs off a
  // focusable wrapper instead (keyboard users get it too).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-[8px] focus-visible:outline-none">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/** Section 2 of the detail sheet: the persona's actions for this order (UI spec §4.4, §6). */
export function OrderActions({
  order,
  persona,
  now,
  onAction,
}: {
  order: OrderDTO;
  persona: Persona;
  /** Epoch ms; passed in so claim-sensitive guards agree with the board clock. */
  now: number;
  onAction: (order: OrderDTO, action: OrderAction) => void;
}) {
  const actions = visibleActions(order, persona, new Date(now));
  const hint = actions.find((a) => !a.enabled)?.reason;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
      {actions.length === 0 && (
        <span className="text-[11px] leading-4 text-slate-400">No actions for this persona right now</span>
      )}

      {actions.map((availability) => (
        <ActionButton
          key={availability.action}
          availability={availability}
          onAction={(action) => onAction(order, action)}
        />
      ))}

      {hint && (
        <>
          <span className="flex-1" />
          <span className="text-[11px] leading-4 text-slate-400">{hint}</span>
        </>
      )}
    </div>
  );
}
