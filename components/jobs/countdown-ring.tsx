'use client';

import { formatCountdown } from '@/lib/domain/format';
import { ringColour, ringOffset } from '@/lib/domain/ring';

const STROKE = 8;
/** Gap between the stroke and the box edge, so `stroke-linecap: round` is not clipped. */
const INSET = 6;

/**
 * The verification dialog's countdown ring (design 1d): a track plus an arc
 * that drains clockwise and shifts teal → amber → red as the claim runs out.
 *
 * All the maths lives in `lib/domain/ring.ts` (pure, unit-tested); this is the
 * SVG shell. Like `ClaimCountdown` the remainder is rounded *up* to the next
 * second, so a live claim never reads "0:00" — that string belongs to the
 * terminal state alone.
 */
export function CountdownRing({
  remainingMs,
  totalMs,
  size = 120,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
}) {
  const radius = size / 2 - STROKE - INSET;
  const circumference = 2 * Math.PI * radius;
  const colour = ringColour(remainingMs);
  const urgent = remainingMs <= 30_000;
  const label = formatCountdown(Math.ceil(remainingMs / 1000) * 1000);
  const digits = Math.round((size * 2) / 9);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E2E8F0" strokeWidth={STROKE} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={ringOffset(remainingMs, totalMs, circumference)}
          // The clock ticks once a second; the linear tween across that second
          // is what makes the ring look like it is draining rather than jumping.
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span
          role="timer"
          aria-label={`${label} remaining`}
          className="font-mono font-medium whitespace-nowrap tabular-nums"
          style={{ fontSize: digits, lineHeight: `${digits + 4}px`, color: urgent ? '#DC2626' : '#0F172A' }}
        >
          {label}
        </span>
        <span
          className="text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase"
          style={{ color: urgent ? '#DC2626' : '#94A3B8' }}
        >
          {urgent ? 'releasing soon' : 'remaining'}
        </span>
      </div>
    </div>
  );
}
