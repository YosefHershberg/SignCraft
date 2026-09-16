/**
 * Pure maths for the verification dialog's countdown ring (design 1d).
 *
 * Kept in `lib/domain` so it is unit-testable without a DOM: the SVG in
 * `components/jobs/countdown-ring.tsx` is a thin shell over these two.
 */

/** Ring stroke and countdown colour for the remaining claim time. */
export function ringColour(remainingMs: number): string {
  if (remainingMs <= 30_000) return '#DC2626';
  if (remainingMs <= 60_000) return '#D97706';
  return '#0D9488';
}

/**
 * `stroke-dashoffset` for a ring whose `stroke-dasharray` is the whole
 * circumference: 0 is a full ring, `circumference` is an empty one. A
 * non-positive total reads as fully drained rather than dividing by zero.
 */
export function ringOffset(remainingMs: number, totalMs: number, circumference: number): number {
  if (totalMs <= 0) return circumference;
  const fraction = Math.min(1, Math.max(0, remainingMs / totalMs));
  return circumference * (1 - fraction);
}

/**
 * The full TTL of a claim, read off the claim itself rather than from
 * `claimTtlMs()`: the client has no access to the server's `CLAIM_TTL_MS`, so
 * the two would disagree the moment the env var is overridden.
 */
export function claimTotalMs(claim: { claimedAt: string; expiresAt: string }): number {
  return Math.max(0, Date.parse(claim.expiresAt) - Date.parse(claim.claimedAt));
}
