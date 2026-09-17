'use client';

// components/layout — the sticky top bar. Hosts the three header widgets
// (summary pills, connection indicator, persona switcher) and the desktop
// "New order" button; the mobile FAB for the same action lives in
// `components/dashboard.tsx`.

import { Button } from '@/components/ui/button';
import type { BootstrapDTO } from '@/lib/domain/types';
import type { ConnectionStatus } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import { ConnectionIndicator } from './connection-indicator';
import { PersonaSwitcher } from './persona-switcher';
import { StatusSummaryPills } from './status-summary-pills';

/**
 * Sticky 56px header (UI spec §4.1 / DESIGN.md "Header").
 *
 * The `PersonaSwitcher` here is what makes the two-tab QA recipe work: the
 * `sc_persona` cookie only seeds a tab's first render, after which each tab
 * holds its persona in React state (`lib/persona/persona-context.tsx`), so two
 * windows can be Dana K. and Omar S. at the same time and race for a claim.
 * The header is also why the detail sheet is non-modal — UI spec §7.8 needs
 * this switcher clickable with the sheet open.
 *
 * `data` is the live bootstrap (not the server-rendered snapshot) so the
 * pills and the switcher's vendor/installer lists track the cache.
 */
export function AppHeader({
  data,
  connectionStatus,
  onNewOrder,
}: {
  data: BootstrapDTO;
  /** From `useRealtime()` in the dashboard; the only place the SSE state is shown. */
  connectionStatus: ConnectionStatus;
  /** Opens `CreateOrderDialog`; the button only renders for ops, matching the API's `POST /api/orders` rule. */
  onNewOrder: () => void;
}) {
  const { persona } = usePersona();

  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-slate-200 bg-white px-3 sm:gap-6 sm:px-5">
      {/* The console name is the first thing to go below ~420px; the wordmark alone still identifies the app. */}
      <div className="flex flex-none items-baseline gap-2">
        <span className="text-base font-bold tracking-[-0.02em] text-slate-900">SignCraft</span>
        <span className="hidden text-[11px] whitespace-nowrap text-slate-400 sm:inline">Ops console</span>
      </div>

      <StatusSummaryPills orders={data.orders} />

      <div className="flex flex-none items-center gap-2 sm:gap-4">
        <ConnectionIndicator status={connectionStatus} />
        <div className="hidden h-6 w-px bg-slate-200 sm:block" />
        <PersonaSwitcher vendors={data.vendors} installers={data.installers} />
        {persona.kind === 'ops' && (
          <Button
            className="hidden bg-[#0D9488] hover:bg-[#0f766e] sm:inline-flex"
            onClick={onNewOrder}
          >
            New order
          </Button>
        )}
      </div>
    </header>
  );
}
