// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { JobChip } from '@/components/jobs/job-chip';
import type { InstallerDTO, JobDTO, Persona } from '@/lib/domain/types';

const ME = 'c'.repeat(24);
const OTHER = 'd'.repeat(24);
const EXPIRES_AT = '2026-09-16T12:03:00.000Z';
const EXPIRES = Date.parse(EXPIRES_AT);

const installers: InstallerDTO[] = [
  { id: ME, name: 'Dana K.' },
  { id: OTHER, name: 'Omar B.' },
];

const me: Persona = { kind: 'installer', id: ME };
const ops: Persona = { kind: 'ops' };

function claimed(installerId: string): JobDTO {
  return {
    id: 'e'.repeat(24),
    orderId: 'f'.repeat(24),
    status: 'CLAIMED',
    claim: { installerId, claimedAt: '2026-09-16T12:00:00.000Z', expiresAt: EXPIRES_AT },
    installerId: null,
    version: 2,
    createdAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T12:00:00.000Z',
  };
}

afterEach(cleanup);

describe('JobChip claim expiry', () => {
  it('shows the other installer’s countdown and does not fire onExpire while the claim is live', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <JobChip job={claimed(OTHER)} persona={ops} installers={installers} now={EXPIRES - 1000} onExpire={onExpire} />
    );

    expect(container.textContent).toBe('Claimed · Omar B. · 0:01');
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('shows my own claim as "Your claim" and does not fire onExpire while it is live', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <JobChip job={claimed(ME)} persona={me} installers={installers} now={EXPIRES - 1000} onExpire={onExpire} />
    );

    expect(container.textContent).toBe('Your claim · 0:01 · Verify');
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('never shows 0:00 while the claim is still live', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <JobChip job={claimed(OTHER)} persona={ops} installers={installers} now={EXPIRES - 400} onExpire={onExpire} />
    );

    expect(container.textContent).toBe('Claimed · Omar B. · 0:01');
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('reads as OPEN and fires onExpire exactly once at the expiry boundary', () => {
    const onExpire = vi.fn();
    const job = claimed(OTHER);
    const { container, rerender } = render(
      <JobChip job={job} persona={ops} installers={installers} now={EXPIRES} onExpire={onExpire} />
    );

    expect(container.textContent).toBe('Open for installers');
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender(<JobChip job={job} persona={ops} installers={installers} now={EXPIRES + 5000} onExpire={onExpire} />);

    expect(container.textContent).toBe('Open for installers');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not fire onExpire for a job that was never claimed', () => {
    const onExpire = vi.fn();
    const job: JobDTO = { ...claimed(OTHER), status: 'OPEN', claim: null };
    const { container } = render(
      <JobChip job={job} persona={ops} installers={installers} now={EXPIRES + 5000} onExpire={onExpire} />
    );

    expect(container.textContent).toBe('Open for installers');
    expect(onExpire).not.toHaveBeenCalled();
  });
});
