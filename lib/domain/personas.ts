/**
 * The persona string format (`ops` | `vendor:<id>` | `installer:<id>`) and
 * its parse/serialise pair (ADR-008). One representation is used everywhere:
 * the `x-persona` header (`lib/api/persona.ts`), the `sc_persona` cookie
 * (`lib/persona/cookie.ts`) and the history rows written by
 * `transitionOrder` (`actorTypeOf`/`actorIdOf`).
 */
import type { ActorType, InstallerDTO, Persona, VendorDTO } from './types';

const OBJECT_ID_RE = /^[0-9a-f]{24}$/;

/**
 * Parses a persona string; null for anything malformed, including a
 * vendor/installer id that is not a 24-hex ObjectId. The server treats null
 * as "no persona" (403 where one is required), so a garbage header can never
 * reach a service.
 */
export function parsePersona(raw: string | null | undefined): Persona | null {
  if (!raw) return null;
  if (raw === 'ops') return { kind: 'ops' };
  const [kind, id] = raw.split(':', 2);
  if (id === undefined || !OBJECT_ID_RE.test(id)) return null;
  if (kind === 'vendor') return { kind: 'vendor', id };
  if (kind === 'installer') return { kind: 'installer', id };
  return null;
}

/** Inverse of `parsePersona`; what the client sends back as the `x-persona` header and stores in the cookie. */
export function serialisePersona(p: Persona): string {
  if (p.kind === 'ops') return 'ops';
  return `${p.kind}:${p.id}`;
}

/** Persona → the `actorType` recorded on a history row. */
export function actorTypeOf(p: Persona): ActorType {
  if (p.kind === 'ops') return 'OPS';
  if (p.kind === 'vendor') return 'VENDOR';
  return 'INSTALLER';
}

/** Persona → the `actorId` recorded on a history row; null for ops, which has no id. */
export function actorIdOf(p: Persona): string | null {
  return p.kind === 'ops' ? null : p.id;
}

/**
 * The persona a cookie may safely restore into: `ops` unless the remembered
 * vendor or installer still exists.
 *
 * The cookie outlives the database it was written against — reseeding, or the
 * same browser visiting a local build and then the deployed one, leaves an id
 * that resolves to nothing. Without this the header read "Unknown vendor" over
 * a board filtered to a vendor with no orders, which looks like data loss
 * rather than a stale cookie.
 */
export function resolvePersona(
  p: Persona | null,
  vendors: VendorDTO[],
  installers: InstallerDTO[]
): Persona {
  if (!p || p.kind === 'ops') return { kind: 'ops' };
  const known = p.kind === 'vendor' ? vendors.some((v) => v.id === p.id) : installers.some((i) => i.id === p.id);
  return known ? p : { kind: 'ops' };
}

/** Header copy for the persona switcher: display name plus role, with a fallback when the id is unknown. */
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
