// Pure DTO normalisation. No Prisma import: this works on plain objects that
// come either from Prisma results (Date, bigint, string ids) or straight off
// a MongoDB change-stream fullDocument (ObjectId-like, Date, Long-like).
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

export function toJobDTO(raw: unknown, now: Date): JobDTO {
  const normalised = normalise<Record<string, unknown>>(raw);
  const withDefaults = {
    ...normalised,
    claim: normalised.claim ?? null,
    installerId: normalised.installerId ?? null,
  } as JobDTO;
  return toPublicJob(withDefaults, now);
}

export function toAssetDTO(raw: unknown): AssetDTO {
  return normalise<AssetDTO>(raw);
}

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
