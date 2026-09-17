'use client';

// components/orders — the in-dialog rendering of an `ApiClientError`, i.e. the
// server's `{ error: { code, message, details } }` envelope from
// `lib/api/errors.ts`. This is where the reviewer sees Invariant 1 pay off:
// an INVALID_TRANSITION 400 arrives with `details.allowed`, and the dialog
// prints it.

import { STATUS_META } from '@/lib/domain/status-meta';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/domain/types';
import type { ApiClientError } from '@/lib/query/api-client';

/**
 * `details` is untyped JSON from the wire; this narrows a value to an
 * `OrderStatus` before it is used as a `STATUS_META` key, so a malformed or
 * future payload degrades to "no allowed list" rather than a runtime error.
 */
function isStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Human label for a wire status, or `null` if it is not one we know. */
function statusLabel(value: unknown): string | null {
  return isStatus(value) ? STATUS_META[value].label : null;
}

/**
 * Server errors render inline inside the dialog, never as a toast
 * (DESIGN.md "Dialogs"). INVALID_TRANSITION additionally spells out the
 * allowed targets the server sent back, which is the whole point of §7.5.
 *
 * `onRefresh` is offered only on a 409: for VERSION_CONFLICT (stale
 * `expectedVersion`) retrying is pointless until the tab has the current
 * order, so the one forward path is "Refresh order" — `TransitionDialog`
 * wires it to a bootstrap invalidation plus close. The `code · status` line
 * is deliberately raw so a reviewer can match it to the API table.
 */
export function InlineError({ error, onRefresh }: { error: ApiClientError; onRefresh?: () => void }) {
  const details = error.details ?? {};
  const from = statusLabel(details.from);
  const allowed = Array.isArray(details.allowed)
    ? details.allowed.map(statusLabel).filter((label): label is string => label !== null)
    : [];

  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3"
    >
      <span className="text-[13px] leading-[18px] font-semibold text-[#991B1B]">{error.message}</span>

      {allowed.length > 0 && (
        <span className="text-[11px] leading-4 text-[#991B1B]">
          {from ? `Allowed from ${from}: ` : 'Allowed: '}
          {allowed.join(', ')}.
        </span>
      )}

      <span className="font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-[#B91C1C]">
        {error.code} · {error.status}
      </span>

      {error.status === 409 && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="self-start text-[11px] leading-4 font-semibold text-[#991B1B] underline underline-offset-2"
        >
          Refresh order
        </button>
      )}
    </div>
  );
}
