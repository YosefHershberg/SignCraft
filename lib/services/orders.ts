/**
 * lib/services/orders.ts — pipeline 1 (order transitions). Owns every Prisma
 * read/write on `Order`: creation, `checkTransition` + the one conditional
 * `updateMany` that applies a transition, and the `ORDER_INCLUDE` shape used
 * everywhere an order is read with its relations. Route handlers only parse
 * and call in (Invariant 7).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, fromVerdict } from '@/lib/api/errors';
import { checkTransition, type OrderCtx } from '@/lib/domain/permissions';
import { actorTypeOf, actorIdOf } from '@/lib/domain/personas';
import type { CreateOrderInput, TransitionInput } from '@/lib/domain/schemas';
import type { OrderDTO, Persona } from '@/lib/domain/types';
import { toOrderDTO } from './dto';
import { ensureJobForOrder } from './jobs';

/** The relations every order read needs (job for `OrderCtx`/`JobDTO`, assets for `hasUploadedAsset`/`AssetDTO[]`); shared so every query shape matches. */
export const ORDER_INCLUDE = {
  installJob: true,
  assets: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

/** Mongo's duplicate-key error (Prisma code P2002) — the signal `createOrder` retries on, for a raced `orderNumber`. */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** `SC-0001`-style order number from a 1-based sequence; zero-padded to 4 digits (UI spec, order cards). */
function orderNumberFor(seq: number): string {
  return `SC-${String(seq).padStart(4, '0')}`;
}

/**
 * Creates a DRAFT order. Ops only; the `orderNumber` is derived from the
 * current order count, so a second create racing the same count would collide
 * on the unique index — caught via `isUniqueConstraintError` and retried once
 * with `seq + 1` rather than read-then-write under a lock.
 *
 * @throws {ApiError} 403 if `persona` is not ops.
 */
export async function createOrder(input: CreateOrderInput, persona: Persona): Promise<OrderDTO> {
  if (persona.kind !== 'ops') throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');

  const now = new Date();
  const count = await prisma.order.count();

  const data: Prisma.OrderUncheckedCreateInput = {
    orderNumber: orderNumberFor(count + 1),
    title: input.title,
    customerName: input.customerName,
    signType: input.signType,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    quantity: input.quantity,
    vendorId: input.vendorId,
    installAddress: input.installAddress,
    dueDate: new Date(input.dueDate),
    notes: input.notes ?? null,
    status: 'DRAFT',
    version: 0,
    history: [{ from: null, to: 'DRAFT', actorType: 'OPS', actorId: null, reason: null, at: now }],
  };

  let order;
  try {
    order = await prisma.order.create({ data });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    order = await prisma.order.create({ data: { ...data, orderNumber: orderNumberFor(count + 2) } });
  }

  return getOrderDTO(order.id, now);
}

/**
 * Validates and applies a state transition as one conditional `updateMany`.
 * Re-runs `checkTransition` — the same pure function the UI used to decide
 * whether to show the button — so the server never trusts the client
 * (Invariant 1). The `where` filters on both `status` and `version`, so
 * `count !== 1` means either an illegal jump snuck in under a race or a
 * stale `expectedVersion`; both surface as `VERSION_CONFLICT` and the dialog
 * offers "Refresh order" rather than guessing which. Reaching
 * READY_FOR_INSTALL opens the install job as a side effect.
 *
 * @throws {ApiError} 404 if the order does not exist, the mapped `Denial`
 * (400 INVALID_TRANSITION/GUARD_FAILED, 403 FORBIDDEN_FOR_PERSONA) if the
 * move is not allowed, 409 VERSION_CONFLICT on a lost race.
 */
export async function transitionOrder(
  id: string,
  body: TransitionInput,
  persona: Persona,
  now: Date = new Date()
): Promise<OrderDTO> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) throw new ApiError(404, 'NOT_FOUND');

  const ctx: OrderCtx = {
    status: order.status,
    vendorId: order.vendorId,
    hasUploadedAsset: order.assets.some((a) => a.status === 'UPLOADED'),
    installJob: order.installJob,
  };

  const verdict = checkTransition(persona, ctx, body.to, now);
  if (!verdict.ok) throw fromVerdict(verdict, { from: order.status, to: body.to });

  const expectedVersion = body.expectedVersion ?? order.version;

  const res = await prisma.order.updateMany({
    where: { id, status: order.status, version: expectedVersion },
    data: {
      status: body.to,
      version: { increment: 1 },
      history: {
        push: {
          from: order.status,
          to: body.to,
          actorType: actorTypeOf(persona),
          actorId: actorIdOf(persona),
          reason: body.reason ?? null,
          at: now,
        },
      },
    },
  });

  if (res.count !== 1) throw new ApiError(409, 'VERSION_CONFLICT');

  if (body.to === 'READY_FOR_INSTALL') {
    await ensureJobForOrder(id);
  }

  return getOrderDTO(id, now);
}

/**
 * Reads a single order with its job and assets, applying lazy claim expiry.
 * The read-your-write path after every mutation in this file, and what
 * `useOrder`'s cache-observer pattern effectively mirrors client-side.
 *
 * @throws {ApiError} 404 if the order does not exist.
 */
export async function getOrderDTO(id: string, now: Date = new Date()): Promise<OrderDTO> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) throw new ApiError(404, 'NOT_FOUND');
  return toOrderDTO(order, now);
}
