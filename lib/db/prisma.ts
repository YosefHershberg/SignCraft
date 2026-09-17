/**
 * lib/db/prisma.ts — the single Prisma client every `lib/services/*` module
 * imports (the ORM half of the DB layer; `lib/db/mongo.ts` is the other half,
 * for change streams only).
 */
import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The shared client, cached on `globalThis` outside production. Next.js dev
 * HMR re-evaluates this module on every edit; without the cache each reload
 * would open a fresh pool of connections to Atlas until the limit is hit.
 */
export const prisma =
  g.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
