import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, fromVerdict } from '@/lib/api/errors';
import { checkTransition, type OrderCtx } from '@/lib/domain/permissions';
import { actorTypeOf, actorIdOf } from '@/lib/domain/personas';
import type { CreateOrderInput, TransitionInput } from '@/lib/domain/schemas';
import type { OrderDTO, Persona } from '@/lib/domain/types';
import { toOrderDTO } from './dto';
import { ensureJobForOrder } from './jobs';

export const ORDER_INCLUDE = {
  installJob: true,
  assets: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function orderNumberFor(seq: number): string {
  return `SC-${String(seq).padStart(4, '0')}`;
}

/** Creates a DRAFT order. Ops only; retries once on an orderNumber collision. */
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
 * `count !== 1` means either an illegal jump snuck in under a race or a
 * stale `expectedVersion` — both surface as `VERSION_CONFLICT`.
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

/** Reads a single order with its job and assets, applying lazy claim expiry. */
export async function getOrderDTO(id: string, now: Date = new Date()): Promise<OrderDTO> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) throw new ApiError(404, 'NOT_FOUND');
  return toOrderDTO(order, now);
}
