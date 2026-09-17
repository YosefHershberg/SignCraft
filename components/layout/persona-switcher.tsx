'use client';

// components/layout — the stand-in for login. Selecting an entry calls
// `setPersona` on `lib/persona/persona-context.tsx`, which updates this tab's
// React state (and the `sc_persona` cookie for the *next* first render); every
// subsequent request from this tab carries the new `x-persona` header.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { personaLabel } from '@/lib/domain/personas';
import type { InstallerDTO, VendorDTO } from '@/lib/domain/types';
import { usePersona } from '@/lib/persona/persona-context';

/** "Dana K." → "DK", "Ops" → "O"; first + last word, upper-cased, for the avatar circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Avatar + name/role trigger with a menu of Ops, every vendor and every
 * installer (UI spec §4.1). `vendors`/`installers` are the bootstrap lists, so
 * the same ids the server validates against are the only ones offered;
 * `personaLabel` resolves the current persona back to a display name. Nothing
 * here refetches: `useRealtime` keeps its EventSource across a switch, and the
 * board simply re-filters on the next render.
 */
export function PersonaSwitcher({ vendors, installers }: { vendors: VendorDTO[]; installers: InstallerDTO[] }) {
  const { persona, setPersona } = usePersona();
  const { name, role } = personaLabel(persona, vendors, installers);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-slate-200 py-1 pr-2 pl-1"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-[#CCFBF1] text-[10px] font-semibold text-[#0F766E]">
            {initials(name)}
          </span>
          <span className="flex flex-col items-start">
            <span className="text-[11px] leading-[13px] font-semibold text-slate-900">{name}</span>
            <span className="text-[10px] leading-[13px] text-slate-400">{role}</span>
          </span>
          <span className="text-[10px] text-slate-400">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Ops</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setPersona({ kind: 'ops' })}>Ops team</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Vendors</DropdownMenuLabel>
        {vendors.map((vendor) => (
          <DropdownMenuItem key={vendor.id} onSelect={() => setPersona({ kind: 'vendor', id: vendor.id })}>
            {vendor.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Installers</DropdownMenuLabel>
        {installers.map((installer) => (
          <DropdownMenuItem key={installer.id} onSelect={() => setPersona({ kind: 'installer', id: installer.id })}>
            {installer.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] text-slate-400">Personas stand in for login in this demo.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
