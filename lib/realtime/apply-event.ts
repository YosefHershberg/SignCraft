// Client-side, pure cache patcher: applies one SSE event to the bootstrap
// snapshot TanStack Query holds. No fetch, no React — just data in, data out.
import type { AssetDTO, BootstrapDTO, JobDTO, OrderDTO, Persona, SseEvent } from '@/lib/domain/types';

/**
 * Structural equality used purely to short-circuit cache writes. An SSE frame
 * for a doc this tab just wrote itself (via a mutation's `onSuccess`) often
 * carries a value already identical to what is cached; without this check
 * `setQueryData` would still return a new object identity and re-render every
 * subscriber for a no-op update.
 */
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

/**
 * Merges one `order.created`/`order.updated` frame into the bootstrap cache.
 * Version-guarded — an older doc than the one already cached is dropped, so a
 * frame from a resync or a race with a mutation response can never roll a
 * card backwards. A change-stream `Order` document carries no relations, so
 * the incoming `doc` is patched over the cached `installJob`/`assets` rather
 * than replacing the whole order (those only ever move via `applyJobEvent`/
 * `applyAssetEvent`, which target them directly).
 */
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

/**
 * Merges one `job.created`/`job.updated` frame — a claim, a verify, or a
 * lazy-expiry flip — onto the order it belongs to. Version-guarded like
 * `applyOrderEvent`, so a stale frame can never overwrite a newer claim state
 * (pipeline 2, the claim race: exactly one `claimJob` write should ever win,
 * and the losing tab's SSE frame must not be allowed to look like it did).
 */
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

/**
 * Merges one `asset.created`/`asset.updated` frame — a new upload row or a
 * progress/status change — into its order's `assets` array. This is how
 * other tabs' `UploadProgressBar`/`AssetRow` move during pipeline 3 without
 * polling (Invariant 4): the uploading tab's `progress`/`complete` calls land
 * here via the change stream exactly like any other write.
 */
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

/**
 * The one cache reducer for the bootstrap snapshot. `use-realtime.ts` calls it
 * for every SSE frame, and `lib/query/hooks.ts`'s mutation `onSuccess`
 * handlers call it again with a synthetic event built from the REST response
 * — so a card ends up in the same state whether this tab made the change or
 * another tab's change arrived over the wire.
 */
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

/** Whether a fresh `InstallJob` should toast this tab (UI spec §7.1): only installers care, and only about a brand-new job. */
export function shouldToastNewJob(ev: SseEvent, persona: Persona): boolean {
  return persona.kind === 'installer' && ev.type === 'job.created';
}
