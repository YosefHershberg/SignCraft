import { describe, expect, it } from 'vitest';
import type { OrderStatus, Persona } from '@/lib/domain/types';
import type { JobLike } from '@/lib/domain/claims';
import { checkTransition, orderActionsFor, checkUpload, jobActionsFor, type OrderCtx } from '@/lib/domain/permissions';

const now = new Date('2026-09-16T12:00:00.000Z');

const VENDOR_ID = 'a'.repeat(24);
const OTHER_VENDOR_ID = 'c'.repeat(24);
const INSTALLER_A = 'b'.repeat(24);
const INSTALLER_B = 'd'.repeat(24);

const ops: Persona = { kind: 'ops' };
const vendorOwner: Persona = { kind: 'vendor', id: VENDOR_ID };
const vendorOther: Persona = { kind: 'vendor', id: OTHER_VENDOR_ID };
const installerA: Persona = { kind: 'installer', id: INSTALLER_A };
const installerB: Persona = { kind: 'installer', id: INSTALLER_B };

function order(status: OrderStatus, extra: Partial<OrderCtx> = {}): OrderCtx {
  return {
    status,
    vendorId: VENDOR_ID,
    hasUploadedAsset: false,
    installJob: null,
    ...extra,
  };
}

function openJob(): JobLike {
  return { status: 'OPEN', installerId: null, claim: null };
}

function assignedJob(installerId: string): JobLike {
  return { status: 'ASSIGNED', installerId, claim: null };
}

function claimedJob(installerId: string, expiresAt: string): JobLike {
  return {
    status: 'CLAIMED',
    installerId: null,
    claim: { installerId, expiresAt, claimedAt: new Date(now.getTime() - 60_000).toISOString() },
  };
}

describe('checkTransition', () => {
  it('lets ops submit only when an asset was uploaded', () => {
    expect(checkTransition(ops, order('DRAFT', { hasUploadedAsset: true }), 'SUBMITTED', now)).toEqual({ ok: true });
  });

  it('blocks ops submit with GUARD_FAILED/NO_UPLOADED_ASSET when no asset uploaded', () => {
    expect(checkTransition(ops, order('DRAFT', { hasUploadedAsset: false }), 'SUBMITTED', now)).toEqual({
      ok: false,
      code: 'GUARD_FAILED',
      reason: 'NO_UPLOADED_ASSET',
    });
  });

  it('lets the owning vendor accept', () => {
    expect(checkTransition(vendorOwner, order('SUBMITTED'), 'VENDOR_ACCEPTED', now)).toEqual({ ok: true });
  });

  it('forbids a different vendor from accepting', () => {
    expect(checkTransition(vendorOther, order('SUBMITTED'), 'VENDOR_ACCEPTED', now)).toEqual({
      ok: false,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
  });

  it('forbids ops from accepting', () => {
    expect(checkTransition(ops, order('SUBMITTED'), 'VENDOR_ACCEPTED', now)).toEqual({
      ok: false,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
  });

  it('lets the assigned installer complete', () => {
    const ctx = order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_A) });
    expect(checkTransition(installerA, ctx, 'COMPLETED', now)).toEqual({ ok: true });
  });

  it('blocks complete with GUARD_FAILED/NO_ASSIGNED_INSTALLER when the job is still OPEN', () => {
    const ctx = order('READY_FOR_INSTALL', { installJob: openJob() });
    expect(checkTransition(installerA, ctx, 'COMPLETED', now)).toEqual({
      ok: false,
      code: 'GUARD_FAILED',
      reason: 'NO_ASSIGNED_INSTALLER',
    });
  });

  it('forbids complete when the job is assigned to a different installer', () => {
    const ctx = order('READY_FOR_INSTALL', { installJob: assignedJob(INSTALLER_B) });
    expect(checkTransition(installerA, ctx, 'COMPLETED', now)).toEqual({
      ok: false,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
  });

  it('rejects a skipped transition with INVALID_TRANSITION and the allowed list', () => {
    expect(checkTransition(ops, order('DRAFT'), 'IN_PRODUCTION', now)).toEqual({
      ok: false,
      code: 'INVALID_TRANSITION',
      allowed: ['SUBMITTED', 'CANCELLED'],
    });
  });

  it('rejects cancelling from IN_PRODUCTION as INVALID_TRANSITION', () => {
    const result = checkTransition(vendorOwner, order('IN_PRODUCTION'), 'CANCELLED', now);
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('INVALID_TRANSITION');
  });

  it('lets the owning vendor cancel a SUBMITTED order', () => {
    expect(checkTransition(vendorOwner, order('SUBMITTED'), 'CANCELLED', now)).toEqual({ ok: true });
  });

  it('forbids an installer from cancelling', () => {
    expect(checkTransition(installerA, order('SUBMITTED'), 'CANCELLED', now)).toEqual({
      ok: false,
      code: 'FORBIDDEN_FOR_PERSONA',
    });
  });
});

describe('orderActionsFor', () => {
  it('for ops on a DRAFT order with no uploaded asset: submit disabled, cancel enabled', () => {
    expect(orderActionsFor(ops, order('DRAFT', { hasUploadedAsset: false }), now)).toEqual([
      { action: 'submit', enabled: false, reason: 'Needs at least one uploaded file' },
      { action: 'cancel', enabled: true, reason: null },
    ]);
  });

  it('for the owning vendor on IN_PRODUCTION: only mark_ready', () => {
    expect(orderActionsFor(vendorOwner, order('IN_PRODUCTION'), now)).toEqual([
      { action: 'mark_ready', enabled: true, reason: null },
    ]);
  });
});

describe('checkUpload', () => {
  it('rejects ops uploading to a non-uploadable status with ORDER_NOT_UPLOADABLE', () => {
    expect(checkUpload(ops, 'IN_PRODUCTION')).toEqual({
      ok: false,
      code: 'GUARD_FAILED',
      reason: 'ORDER_NOT_UPLOADABLE',
    });
  });

  it('forbids a vendor from uploading even to DRAFT', () => {
    expect(checkUpload(vendorOwner, 'DRAFT')).toEqual({ ok: false, code: 'FORBIDDEN_FOR_PERSONA' });
  });

  it('allows ops to upload to DRAFT', () => {
    expect(checkUpload(ops, 'DRAFT')).toEqual({ ok: true });
  });
});

describe('jobActionsFor', () => {
  it('cannot claim a job CLAIMED by another installer (not yet expired)', () => {
    const job = claimedJob(INSTALLER_B, new Date(now.getTime() + 60_000).toISOString());
    const result = jobActionsFor(installerA, job, now);
    expect(result.canClaim).toBe(false);
    expect(result.claimDisabledReason).toBe('Claimed by another installer');
  });

  it('can claim once that claim has expired', () => {
    const job = claimedJob(INSTALLER_B, new Date(now.getTime() - 1).toISOString());
    const result = jobActionsFor(installerA, job, now);
    expect(result.canClaim).toBe(true);
  });

  it('can verify a job claimed by me', () => {
    const job = claimedJob(INSTALLER_A, new Date(now.getTime() + 60_000).toISOString());
    const result = jobActionsFor(installerA, job, now);
    expect(result.canVerify).toBe(true);
  });

  it('can complete a job assigned to me', () => {
    const job = assignedJob(INSTALLER_A);
    const result = jobActionsFor(installerA, job, now);
    expect(result.canComplete).toBe(true);
  });
});
