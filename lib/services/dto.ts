/**
 * lib/services: the only DB-facing code (Invariant 7). This file maps raw
 * Mongo/Prisma shapes to the wire DTOs in `lib/domain/types.ts`. No Prisma
 * import: `normalise` works on plain objects that come either from Prisma
 * results (Date, bigint, string ids) or straight off a MongoDB change-stream
 * `fullDocument` (ObjectId-like, Date, Long-like, `_id`) — the same mapper
 * has to serve both the REST path and `lib/realtime/events.ts#changeToEvent`
 * (architecture §10).
 */
import { toPublicJob } from '@/lib/domain/claims';
import type { AssetDTO, JobDTO, OrderDTO } from '@/lib/domain/types';

function isObjectIdLike(value: unknown): value is { toHexString: () => string } {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).toHexString === 'function';
}

function isLongLike(value: unknown): value is { toNumber: () => number } {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).toNumber === 'function';
}

/**
 * Recursively converts raw driver/Prisma values into plain JSON-safe values:
 * ObjectId-like -> hex string, Date -> ISO string, bigint -> number,
 * Long-like -> number, `_id` key -> `id`. Arrays and plain objects recurse.
 */
export function normalise<T = unknown>(value: unknown): T {
  if (value === null || value === undefined) return value as T;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (typeof value === 'bigint') return Number(value) as unknown as T;
  if (isObjectIdLike(value)) return value.toHexString() as unknown as T;
  if (isLongLike(value)) return value.toNumber() as unknown as T;
  if (Array.isArray(value)) return value.map((item) => normalise(item)) as unknown as T;

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const outKey = key === '_id' ? 'id' : key;
      result[outKey] = normalise(val);
    }
    return result as unknown as T;
  }

  return value as T;
}

/**
 * Raw job (Prisma row or change-stream doc) → `JobDTO`, with lazy expiry
 * applied via `toPublicJob`. This is Invariant 3's enforcement point: every
 * job the server hands out, whether from a REST response, `getBootstrap`, or
 * an SSE frame, goes through here, so an expired claim always reads as OPEN
 * regardless of what the DB row still says.
 */
export function toJobDTO(raw: unknown, now: Date): JobDTO {
  const normalised = normalise<Record<string, unknown>>(raw);
  const withDefaults = {
    ...normalised,
    claim: normalised.claim ?? null,
    installerId: normalised.installerId ?? null,
  } as JobDTO;
  return toPublicJob(withDefaults, now);
}

/** Raw asset (Prisma row or change-stream doc) → `AssetDTO`; just `normalise` under a name that matches its siblings. */
export function toAssetDTO(raw: unknown): AssetDTO {
  return normalise<AssetDTO>(raw);
}

/**
 * Raw order (with its `installJob`/`assets` relations, or without — a
 * change-stream order document carries neither) → `OrderDTO`. Nested job and
 * assets are re-mapped through `toJobDTO`/`toAssetDTO` so lazy expiry reaches
 * the embedded job too; missing relations default to `null`/`[]` rather than
 * leaking `undefined` onto the wire.
 */
export function toOrderDTO(raw: unknown, now: Date): OrderDTO {
  const normalised = normalise<Record<string, unknown>>(raw);
  const installJobRaw = normalised.installJob;
  const assetsRaw = normalised.assets;

  return {
    ...normalised,
    notes: normalised.notes ?? null,
    history: Array.isArray(normalised.history) ? normalised.history : [],
    installJob: installJobRaw ? toJobDTO(installJobRaw, now) : null,
    assets: Array.isArray(assetsRaw) ? assetsRaw.map((asset) => toAssetDTO(asset)) : [],
  } as OrderDTO;
}
