// Client-side, pure cache patcher: applies one SSE event to the bootstrap
// snapshot TanStack Query holds. No fetch, no React — just data in, data out.
import type { AssetDTO, BootstrapDTO, JobDTO, OrderDTO, Persona, SseEvent } from '@/lib/domain/types';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

function applyOrderEvent(
  data: BootstrapDTO,
  ev: { type: 'order.created' | 'order.updated'; doc: OrderDTO }
): BootstrapDTO {
  const { doc } = ev;
  const idx = data.orders.findIndex((o) => o.id === doc.id);

  if (idx === -1) {
    if (ev.type !== 'order.created') return data;
    return { ...data, orders: [doc, ...data.orders] };
  }

  const existing = data.orders[idx];
  if (doc.version < existing.version) return data;

  const merged: OrderDTO = { ...doc, installJob: existing.installJob, assets: existing.assets };
  if (deepEqual(existing, merged)) return data;

  const orders = data.orders.slice();
  orders[idx] = merged;
  return { ...data, orders };
}

function applyJobEvent(data: BootstrapDTO, ev: { type: 'job.created' | 'job.updated'; doc: JobDTO }): BootstrapDTO {
  const { doc } = ev;
  const idx = data.orders.findIndex((o) => o.id === doc.orderId);
  if (idx === -1) return data;

  const existing = data.orders[idx];
  if (existing.installJob && existing.installJob.version > doc.version) return data;
  if (existing.installJob && deepEqual(existing.installJob, doc)) return data;

  const orders = data.orders.slice();
  orders[idx] = { ...existing, installJob: doc };
  return { ...data, orders };
}

function applyAssetEvent(
  data: BootstrapDTO,
  ev: { type: 'asset.created' | 'asset.updated'; doc: AssetDTO }
): BootstrapDTO {
  const { doc } = ev;
  const orderIdx = data.orders.findIndex((o) => o.id === doc.orderId);
  if (orderIdx === -1) return data;

  const existingOrder = data.orders[orderIdx];
  const assetIdx = existingOrder.assets.findIndex((a) => a.id === doc.id);

  let assets: AssetDTO[];
  if (assetIdx === -1) {
    assets = [...existingOrder.assets, doc];
  } else {
    if (deepEqual(existingOrder.assets[assetIdx], doc)) return data;
    assets = existingOrder.assets.slice();
    assets[assetIdx] = doc;
  }

  const orders = data.orders.slice();
  orders[orderIdx] = { ...existingOrder, assets };
  return { ...data, orders };
}

export function applyEvent(data: BootstrapDTO, ev: SseEvent): BootstrapDTO {
  switch (ev.type) {
    case 'order.created':
    case 'order.updated':
      return applyOrderEvent(data, ev);
    case 'job.created':
    case 'job.updated':
      return applyJobEvent(data, ev);
    case 'asset.created':
    case 'asset.updated':
      return applyAssetEvent(data, ev);
    default:
      return data;
  }
}

export function shouldToastNewJob(ev: SseEvent, persona: Persona): boolean {
  return persona.kind === 'installer' && ev.type === 'job.created';
}
