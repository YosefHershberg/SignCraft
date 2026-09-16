'use client';

import { Button } from '@/components/ui/button';
import type { BootstrapDTO } from '@/lib/domain/types';
import type { ConnectionStatus } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import { ConnectionIndicator } from './connection-indicator';
import { PersonaSwitcher } from './persona-switcher';
import { StatusSummaryPills } from './status-summary-pills';

/** Sticky 56px header (UI spec §4.1 / DESIGN.md "Header"). */
export function AppHeader({
  data,
  connectionStatus,
  onNewOrder,
}: {
  data: BootstrapDTO;
  connectionStatus: ConnectionStatus;
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
