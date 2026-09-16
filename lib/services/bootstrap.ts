import { prisma } from '@/lib/db/prisma';
import { claimTtlMs } from '@/lib/domain/claims';
import type { BootstrapDTO } from '@/lib/domain/types';
import { normalise, toOrderDTO } from './dto';
import { ORDER_INCLUDE } from './orders';
import { releaseExpired } from './jobs';

/**
 * The initial full-state load for the dashboard: vendors and installers
 * (both alphabetical), all orders newest-first with their job and assets,
 * and the server's clock so the client can reason about claim countdowns.
 * Sweeps expired claims first so the swept state is reflected immediately;
 * correctness never depends on this (every reader applies lazy expiry too).
 */
export async function getBootstrap(now: Date = new Date()): Promise<BootstrapDTO> {
  await releaseExpired(now);

  const [vendors, installers, orders] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    prisma.installer.findMany({ orderBy: { name: 'asc' } }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, include: ORDER_INCLUDE }),
  ]);

  return {
    vendors: normalise(vendors),
    installers: normalise(installers),
    orders: orders.map((order) => toOrderDTO(order, now)),
    serverTime: now.toISOString(),
    claimTtlMs: claimTtlMs({ CLAIM_TTL_MS: process.env.CLAIM_TTL_MS }),
  };
}
