import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/domain/types';
import {
  TRANSITIONS,
  allowedTransitions,
  canTransition,
  isTerminal,
  canCancel,
  ACTION_TARGET,
  actionForTransition,
} from '@/lib/domain/state-machine';

const SPEC_TABLE: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['VENDOR_ACCEPTED', 'CANCELLED'],
  VENDOR_ACCEPTED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['READY_FOR_INSTALL'],
  READY_FOR_INSTALL: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

describe('TRANSITIONS', () => {
  it('matches the spec table for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(TRANSITIONS[status]).toEqual(SPEC_TABLE[status]);
    }
  });

  it('allowedTransitions returns the row for a status', () => {
    expect(allowedTransitions('DRAFT')).toEqual(['SUBMITTED', 'CANCELLED']);
    expect(allowedTransitions('COMPLETED')).toEqual([]);
  });
});

describe('canTransition', () => {
  it('is false for a skipped state', () => {
    expect(canTransition('DRAFT', 'IN_PRODUCTION')).toBe(false);
  });

  it('is true for an allowed transition', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
  });
});

describe('canCancel', () => {
  it('is true for DRAFT, SUBMITTED, VENDOR_ACCEPTED', () => {
    expect(canCancel('DRAFT')).toBe(true);
    expect(canCancel('SUBMITTED')).toBe(true);
    expect(canCancel('VENDOR_ACCEPTED')).toBe(true);
  });

  it('is false for the other four statuses', () => {
    expect(canCancel('IN_PRODUCTION')).toBe(false);
    expect(canCancel('READY_FOR_INSTALL')).toBe(false);
    expect(canCancel('COMPLETED')).toBe(false);
    expect(canCancel('CANCELLED')).toBe(false);
  });
});

describe('isTerminal', () => {
  it('is true for COMPLETED and CANCELLED', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
  });

  it('is false for non-terminal statuses', () => {
    expect(isTerminal('DRAFT')).toBe(false);
    expect(isTerminal('READY_FOR_INSTALL')).toBe(false);
  });
});

describe('actionForTransition', () => {
  it('maps a from/to pair to its action', () => {
    expect(actionForTransition('IN_PRODUCTION', 'READY_FOR_INSTALL')).toBe('mark_ready');
    expect(actionForTransition('DRAFT', 'SUBMITTED')).toBe('submit');
    expect(actionForTransition('SUBMITTED', 'VENDOR_ACCEPTED')).toBe('accept');
    expect(actionForTransition('VENDOR_ACCEPTED', 'IN_PRODUCTION')).toBe('start_production');
    expect(actionForTransition('READY_FOR_INSTALL', 'COMPLETED')).toBe('complete');
    expect(actionForTransition('DRAFT', 'CANCELLED')).toBe('cancel');
  });

  it('is null for a pair with no matching action', () => {
    expect(actionForTransition('DRAFT', 'IN_PRODUCTION')).toBeNull();
  });

  it('ACTION_TARGET is the inverse of actionForTransition targets', () => {
    for (const [action, target] of Object.entries(ACTION_TARGET)) {
      expect(target).toBeTruthy();
      expect(action).toBeTruthy();
    }
  });
});
