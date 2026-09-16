import type { ActorType, InstallerDTO, Persona, VendorDTO } from './types';

const OBJECT_ID_RE = /^[0-9a-f]{24}$/;

export function parsePersona(raw: string | null | undefined): Persona | null {
  if (!raw) return null;
  if (raw === 'ops') return { kind: 'ops' };
  const [kind, id] = raw.split(':', 2);
  if (id === undefined || !OBJECT_ID_RE.test(id)) return null;
  if (kind === 'vendor') return { kind: 'vendor', id };
  if (kind === 'installer') return { kind: 'installer', id };
  return null;
}

export function serialisePersona(p: Persona): string {
  if (p.kind === 'ops') return 'ops';
  return `${p.kind}:${p.id}`;
}

export function actorTypeOf(p: Persona): ActorType {
  if (p.kind === 'ops') return 'OPS';
  if (p.kind === 'vendor') return 'VENDOR';
  return 'INSTALLER';
}

export function actorIdOf(p: Persona): string | null {
  return p.kind === 'ops' ? null : p.id;
}

export function personaLabel(
  p: Persona,
  vendors: VendorDTO[],
  installers: InstallerDTO[]
): { name: string; role: 'Ops' | 'Vendor' | 'Installer' } {
  if (p.kind === 'ops') return { name: 'Ops', role: 'Ops' };
  if (p.kind === 'vendor') {
    const vendor = vendors.find((v) => v.id === p.id);
    return { name: vendor?.name ?? 'Unknown vendor', role: 'Vendor' };
  }
  const installer = installers.find((i) => i.id === p.id);
  return { name: installer?.name ?? 'Unknown installer', role: 'Installer' };
}
