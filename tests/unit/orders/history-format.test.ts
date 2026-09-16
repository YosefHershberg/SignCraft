import { describe, expect, it } from 'vitest';
import { historyLine } from '@/lib/domain/history';
import type { InstallerDTO, OrderStatus, TransitionDTO, VendorDTO } from '@/lib/domain/types';

const VENDOR_ID = 'a'.repeat(24);
const INSTALLER_ID = 'b'.repeat(24);

const vendors: VendorDTO[] = [{ id: VENDOR_ID, name: 'Acme Signs' }];
const installers: InstallerDTO[] = [{ id: INSTALLER_ID, name: 'Dana K.' }];

function t(partial: Partial<TransitionDTO> & { to: OrderStatus }): TransitionDTO {
  return {
    from: null,
    actorType: 'OPS',
    actorId: null,
    reason: null,
    at: '2026-09-16T12:04:00.000Z',
    ...partial,
  };
}

const line = (transition: TransitionDTO) => historyLine(transition, vendors, installers);

describe('historyLine', () => {
  it('names the ops actor for a submit', () => {
    expect(line(t({ from: 'DRAFT', to: 'SUBMITTED' }))).toBe('Submitted by Ops');
  });

  it('resolves a vendor actor id to the vendor name', () => {
    expect(
      line(t({ from: 'SUBMITTED', to: 'VENDOR_ACCEPTED', actorType: 'VENDOR', actorId: VENDOR_ID }))
    ).toBe('Accepted by Acme Signs');
  });

  it('resolves an installer actor id to the installer name', () => {
    expect(
      line(t({ from: 'READY_FOR_INSTALL', to: 'COMPLETED', actorType: 'INSTALLER', actorId: INSTALLER_ID }))
    ).toBe('Completed by Dana K.');
  });

  it('appends the reason after an em dash when one is given', () => {
    expect(line(t({ from: 'SUBMITTED', to: 'CANCELLED', reason: 'Customer pulled out' }))).toBe(
      'Cancelled by Ops — Customer pulled out'
    );
  });

  it('ignores a blank reason', () => {
    expect(line(t({ from: 'SUBMITTED', to: 'CANCELLED', reason: '   ' }))).toBe('Cancelled by Ops');
  });

  it('labels the creation entry', () => {
    expect(line(t({ from: null, to: 'DRAFT' }))).toBe('Created by Ops');
  });

  it('has a verb for every production milestone', () => {
    const vendor = { actorType: 'VENDOR' as const, actorId: VENDOR_ID };
    expect(line(t({ from: 'VENDOR_ACCEPTED', to: 'IN_PRODUCTION', ...vendor }))).toBe(
      'Production started by Acme Signs'
    );
    expect(line(t({ from: 'IN_PRODUCTION', to: 'READY_FOR_INSTALL', ...vendor }))).toBe(
      'Marked ready for install by Acme Signs'
    );
  });

  it('falls back when the actor id is not in the roster', () => {
    expect(line(t({ to: 'VENDOR_ACCEPTED', actorType: 'VENDOR', actorId: 'c'.repeat(24) }))).toBe(
      'Accepted by Unknown vendor'
    );
    expect(line(t({ to: 'COMPLETED', actorType: 'INSTALLER', actorId: 'c'.repeat(24) }))).toBe(
      'Completed by Unknown installer'
    );
  });

  it('names the system actor', () => {
    expect(line(t({ to: 'CANCELLED', actorType: 'SYSTEM', actorId: null }))).toBe('Cancelled by System');
  });

  // The seed records vendor/installer transitions without an actor id; on an
  // order there is only ever one vendor and one assigned installer, so the
  // order's own ids are a sound fallback rather than "Unknown vendor".
  it('falls back to the order participants when the actor id is missing', () => {
    const fallback = { vendorId: VENDOR_ID, installerId: INSTALLER_ID };
    expect(
      historyLine(t({ to: 'IN_PRODUCTION', actorType: 'VENDOR', actorId: null }), vendors, installers, fallback)
    ).toBe('Production started by Acme Signs');
    expect(
      historyLine(t({ to: 'COMPLETED', actorType: 'INSTALLER', actorId: null }), vendors, installers, fallback)
    ).toBe('Completed by Dana K.');
  });

  it('prefers the recorded actor id over the fallback', () => {
    expect(
      historyLine(t({ to: 'VENDOR_ACCEPTED', actorType: 'VENDOR', actorId: VENDOR_ID }), vendors, installers, {
        vendorId: 'e'.repeat(24),
      })
    ).toBe('Accepted by Acme Signs');
  });
});
