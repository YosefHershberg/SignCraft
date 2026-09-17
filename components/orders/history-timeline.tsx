// components/orders — the audit trail at the foot of the detail sheet. Renders
// the `history` array that `transitionOrder` (`lib/services/orders.ts`) pushes
// onto the order in the same conditional update as the status change, so every
// row here corresponds to exactly one accepted transition (pipeline 1).

import { formatDue, formatTime } from '@/lib/domain/format';
import { historyLine } from '@/lib/domain/history';
import { STATUS_META } from '@/lib/domain/status-meta';
import type { InstallerDTO, OrderDTO, VendorDTO } from '@/lib/domain/types';

/**
 * Section 6 of the detail sheet: newest first, a 1px vertical rule with
 * status-coloured dots (DESIGN.md "Detail sheet", UI spec §4.4).
 *
 * The sentence for each row comes from `historyLine` (`lib/domain/history.ts`),
 * which turns the `(from, to, actor)` triple into prose and names the actor
 * from `vendors`/`installers`. Because history is embedded on the order and
 * the sheet reads the order live, a transition confirmed in another tab shows
 * up here on the same SSE frame that moved the card.
 */
export function HistoryTimeline({
  order,
  vendors,
  installers,
}: {
  order: OrderDTO;
  vendors: VendorDTO[];
  installers: InstallerDTO[];
}) {
  const newestFirst = [...order.history].reverse();
  // Seeded rows carry no actorId; the order's own participants name them.
  const fallback = { vendorId: order.vendorId, installerId: order.installJob?.installerId };

  return (
    <div className="flex flex-col p-4">
      <span className="mb-2.5 text-[11px] leading-4 font-semibold tracking-[0.04em] text-slate-600 uppercase">
        History
      </span>

      {newestFirst.length === 0 && <span className="text-[13px] leading-[18px] text-slate-400">No history yet</span>}

      {newestFirst.map((transition, index) => {
        const last = index === newestFirst.length - 1;
        return (
          <div key={`${transition.at}-${transition.to}`} className="flex gap-2.5">
            <div className="flex flex-col items-center gap-0.5">
              <span
                className="mt-1.5 size-[7px] flex-none rounded-full"
                style={{ background: STATUS_META[transition.to].dot }}
              />
              {!last && <span className="w-px flex-1 bg-slate-200" />}
            </div>

            <div className={last ? 'flex flex-col' : 'flex flex-col pb-3'}>
              <span className="text-[14px] leading-5 text-slate-900">
                {historyLine(transition, vendors, installers, fallback)}
              </span>
              <span className="font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-slate-400">
                {formatDue(transition.at)} · {formatTime(transition.at)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
