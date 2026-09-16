import { describe, expect, it } from 'vitest';
import {
  parsePersona,
  serialisePersona,
  actorTypeOf,
  actorIdOf,
  personaLabel,
} from '@/lib/domain/personas';

const VENDOR_ID = 'a'.repeat(24);
const INSTALLER_ID = 'b'.repeat(24);

describe('parsePersona', () => {
  it('parses ops', () => {
    expect(parsePersona('ops')).toEqual({ kind: 'ops' });
  });

  it('parses a vendor with a valid 24-hex id', () => {
    expect(parsePersona(`vendor:${VENDOR_ID}`)).toEqual({ kind: 'vendor', id: VENDOR_ID });
  });

  it('parses an installer with a valid 24-hex id', () => {
    expect(parsePersona(`installer:${INSTALLER_ID}`)).toEqual({ kind: 'installer', id: INSTALLER_ID });
  });

  it('returns null for a vendor with an invalid id', () => {
    expect(parsePersona('vendor:nope')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePersona('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parsePersona(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parsePersona(undefined)).toBeNull();
  });

  it('returns null for an unknown kind', () => {
    expect(parsePersona('admin')).toBeNull();
  });
});

describe('serialisePersona round-trip', () => {
  it.each(['ops', `vendor:${VENDOR_ID}`, `installer:${INSTALLER_ID}`])('round-trips %s', (raw) => {
    const persona = parsePersona(raw);
    expect(persona).not.toBeNull();
    expect(serialisePersona(persona!)).toBe(raw);
  });
});

describe('actorTypeOf / actorIdOf', () => {
  it('maps ops', () => {
    const persona = { kind: 'ops' as const };
    expect(actorTypeOf(persona)).toBe('OPS');
    expect(actorIdOf(persona)).toBeNull();
  });

  it('maps vendor', () => {
    const persona = { kind: 'vendor' as const, id: VENDOR_ID };
    expect(actorTypeOf(persona)).toBe('VENDOR');
    expect(actorIdOf(persona)).toBe(VENDOR_ID);
  });

  it('maps installer', () => {
    const persona = { kind: 'installer' as const, id: INSTALLER_ID };
    expect(actorTypeOf(persona)).toBe('INSTALLER');
    expect(actorIdOf(persona)).toBe(INSTALLER_ID);
  });
});

describe('personaLabel', () => {
  const vendors = [{ id: VENDOR_ID, name: 'Acme Signs' }];
  const installers = [{ id: INSTALLER_ID, name: 'Jane Installer' }];

  it('labels ops', () => {
    expect(personaLabel({ kind: 'ops' }, vendors, installers)).toEqual({ name: 'Ops', role: 'Ops' });
  });

  it('labels a known vendor', () => {
    expect(personaLabel({ kind: 'vendor', id: VENDOR_ID }, vendors, installers)).toEqual({
      name: 'Acme Signs',
      role: 'Vendor',
    });
  });

  it('labels a known installer', () => {
    expect(personaLabel({ kind: 'installer', id: INSTALLER_ID }, vendors, installers)).toEqual({
      name: 'Jane Installer',
      role: 'Installer',
    });
  });

  it('falls back for an unknown vendor id', () => {
    expect(personaLabel({ kind: 'vendor', id: 'c'.repeat(24) }, vendors, installers)).toEqual({
      name: 'Unknown vendor',
      role: 'Vendor',
    });
  });

  it('falls back for an unknown installer id', () => {
    expect(personaLabel({ kind: 'installer', id: 'c'.repeat(24) }, vendors, installers)).toEqual({
      name: 'Unknown installer',
      role: 'Installer',
    });
  });
});
