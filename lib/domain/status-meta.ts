/**
 * Presentation metadata keyed by enum: labels, the status hues from
 * `docs/design/DESIGN.md`, and the copy the transition dialog shows. Kept in
 * `lib/domain` so every surface (badge, column header, card stripe, pills,
 * dialogs) renders one status the same way.
 */
import type { OrderAction, OrderStatus, SignType } from './types';

/**
 * Per-status label and colours. `dot`/`bg`/`fg` are the literal hex values
 * for inline styles; `cssVar` is the matching token from `globals.css` for
 * Tailwind-driven surfaces.
 */
export const STATUS_META: Record<
  OrderStatus,
  { label: string; short: string; dot: string; bg: string; fg: string; cssVar: string }
> = {
  DRAFT: { label: 'Draft', short: 'Draft', dot: '#64748B', bg: '#F1F5F9', fg: '#475569', cssVar: 'var(--status-draft)' },
  SUBMITTED: {
    label: 'Submitted',
    short: 'Submitted',
    dot: '#2563EB',
    bg: '#DBEAFE',
    fg: '#1D4ED8',
    cssVar: 'var(--status-submitted)',
  },
  VENDOR_ACCEPTED: {
    label: 'Accepted',
    short: 'Accepted',
    dot: '#4F46E5',
    bg: '#E0E7FF',
    fg: '#4338CA',
    cssVar: 'var(--status-vendor-accepted)',
  },
  IN_PRODUCTION: {
    label: 'In production',
    short: 'In production',
    dot: '#D97706',
    bg: '#FEF3C7',
    fg: '#B45309',
    cssVar: 'var(--status-in-production)',
  },
  READY_FOR_INSTALL: {
    label: 'Ready for install',
    short: 'Ready for install',
    dot: '#0D9488',
    bg: '#CCFBF1',
    fg: '#0F766E',
    cssVar: 'var(--status-ready-for-install)',
  },
  COMPLETED: {
    label: 'Completed',
    short: 'Completed',
    dot: '#16A34A',
    bg: '#DCFCE7',
    fg: '#15803D',
    cssVar: 'var(--status-completed)',
  },
  CANCELLED: {
    label: 'Cancelled',
    short: 'Cancelled',
    dot: '#B91C1C',
    bg: '#FEE2E2',
    fg: '#991B1B',
    cssVar: 'var(--status-cancelled)',
  },
};

export const SIGN_TYPE_LABEL: Record<SignType, string> = {
  STOREFRONT: 'Storefront',
  WAYFINDING: 'Wayfinding',
  VEHICLE_WRAP: 'Vehicle wrap',
  BANNER: 'Banner',
  MONUMENT: 'Monument',
};

/** Button text per order action (action bar, card ⋯ menu, dialog confirm button). */
export const ACTION_LABEL: Record<OrderAction, string> = {
  submit: 'Submit',
  accept: 'Accept',
  start_production: 'Start production',
  mark_ready: 'Mark ready for install',
  complete: 'Complete',
  cancel: 'Cancel',
};

/** The one-line "what happens next" the transition confirm dialog shows under the title (UI spec §4.6). */
export const ACTION_CONSEQUENCE: Record<OrderAction, string> = {
  submit: 'The vendor will be notified',
  accept: 'Production can start',
  start_production: 'The order enters production; it can no longer be cancelled',
  mark_ready: 'The job will be posted to installers',
  complete: 'The order will be closed',
  cancel: 'The order will be cancelled',
};
