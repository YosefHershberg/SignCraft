/**
 * lib/services/assets.ts — pipeline 3 (direct-to-cloud upload), the server
 * side of every step except the presigned PUT itself: creating the Asset row
 * and the R2 multipart upload, presigning part URLs, recording progress, and
 * completing/aborting. Bytes never pass through here (Invariant 5) — only
 * metadata and calls into `lib/storage/r2.ts`.
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError, fromVerdict } from '@/lib/api/errors';
import { checkUpload } from '@/lib/domain/permissions';
import { PART_SIZE } from '@/lib/domain/constants';
import type { AbortReason, CreateAssetInput } from '@/lib/domain/schemas';
import type { AssetDTO, Persona } from '@/lib/domain/types';
import { storage, storageKeyFor } from '@/lib/storage/r2';
import { planParts } from '@/lib/upload/plan';
import { toAssetDTO } from './dto';

/**
 * Creates an Asset and the R2 multipart upload it will be uploaded through
 * (pipeline 3, step 1). Only ops may attach files, and only while the order
 * is in an uploadable status (DRAFT|SUBMITTED, per `checkUpload`). The Asset
 * is created PENDING with a placeholder storageKey (the real key needs the
 * generated asset id, hence create-then-update rather than one insert), then
 * updated to UPLOADING once the multipart upload exists. If R2 rejects the
 * multipart create, the row is kept as FAILED (not deleted) so the UI can
 * offer Retry instead of the asset silently vanishing.
 *
 * @throws {ApiError} 403 if `persona` is not ops, 404 if the order does not
 * exist, the mapped `Denial` (400 GUARD_FAILED ORDER_NOT_UPLOADABLE) if the
 * order cannot accept files, or the storage error from `createMultipart`
 * (502 STORAGE_ERROR).
 */
export async function createAsset(
  input: CreateAssetInput,
  persona: Persona
): Promise<{ asset: AssetDTO; uploadId: string; partSize: number; partCount: number }> {
  if (persona.kind !== 'ops') throw new ApiError(403, 'FORBIDDEN_FOR_PERSONA');

  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new ApiError(404, 'NOT_FOUND');

  const verdict = checkUpload(persona, order.status);
  if (!verdict.ok) throw fromVerdict(verdict);

  const created = await prisma.asset.create({
    data: {
      orderId: input.orderId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      storageKey: '',
      status: 'PENDING',
      simulated: input.simulated,
    },
  });

  const key = storageKeyFor(input.orderId, created.id, input.fileName);

  let uploadId: string;
  try {
    ({ uploadId } = await storage.createMultipart(key, input.contentType));
  } catch (err) {
    // Keep the row (rather than deleting it) so the UI can show "Failed / Retry".
    await prisma.asset.update({ where: { id: created.id }, data: { storageKey: key, status: 'FAILED' } });
    throw err;
  }

  const updated = await prisma.asset.update({
    where: { id: created.id },
    data: { storageKey: key, uploadId, status: 'UPLOADING' },
  });

  const { partCount } = planParts(input.sizeBytes);

  return { asset: toAssetDTO(updated), uploadId, partSize: PART_SIZE, partCount };
}

/**
 * Re-checks the *order* behind an in-flight upload against `checkUpload`, the
 * same gate the create path uses. An upload started while the order was DRAFT
 * outlives that status: the vendor can accept the order mid-upload, and without
 * this the remaining parts would keep being signed and completed against an
 * order that no longer accepts files. Throws the same 403/400 as `createAsset`.
 */
async function assertOrderStillUploadable(orderId: string, persona: Persona): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ApiError(404, 'NOT_FOUND');

  const verdict = checkUpload(persona, order.status);
  if (!verdict.ok) throw fromVerdict(verdict);
}

/**
 * Presigns URLs for the requested part numbers of an in-flight multipart
 * upload (pipeline 3, step 3). Called once per batch of up to
 * `PRESIGN_BATCH` part numbers; re-validates the order via
 * `assertOrderStillUploadable` on every call since a long upload can outlive
 * the order's uploadable window.
 *
 * @throws {ApiError} 404 if the asset (or its order) does not exist, the
 * mapped `Denial` if the order is no longer uploadable, 409 VERSION_CONFLICT
 * if the asset is not PENDING/UPLOADING or has no active `uploadId`.
 */
export async function presignParts(
  assetId: string,
  partNumbers: number[],
  persona: Persona
): Promise<{ partNumber: number; url: string }[]> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');

  await assertOrderStillUploadable(asset.orderId, persona);

  if ((asset.status !== 'PENDING' && asset.status !== 'UPLOADING') || !asset.uploadId) {
    throw new ApiError(409, 'VERSION_CONFLICT', { status: asset.status });
  }

  const uploadId = asset.uploadId;
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await storage.presignPart(asset.storageKey, uploadId, partNumber),
    }))
  );
}

/**
 * Records client-reported upload progress (ADR-016; pipeline 3, step 4). A
 * no-op unless the asset is UPLOADING — a late progress ping for a completed,
 * failed or aborted asset must not resurrect its numbers, and an unknown id
 * fails silently rather than 404ing (the route treats this call as
 * best-effort). `bytesUploaded` is clamped to `sizeBytes` in case the client
 * over-reports.
 */
export async function reportProgress(assetId: string, bytesUploaded: number): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== 'UPLOADING') return;

  const size = Number(asset.sizeBytes);
  const bytes = Math.min(bytesUploaded, size);
  const progressPct = Math.min(100, Math.floor((bytes * 100) / size));

  await prisma.asset.update({
    where: { id: assetId },
    data: { bytesUploaded: BigInt(bytes), progressPct },
  });
}

/**
 * Completes a multipart upload (pipeline 3, step 5). Parts are sorted by
 * number before the R2 call, since the client may report them out of order
 * (a slower worker in `MultipartUploader`'s pool can finish last). If R2
 * reports STORAGE_ERROR the asset is marked FAILED and the error is
 * rethrown so the caller sees it; on success the asset is marked UPLOADED
 * and fully progressed.
 *
 * @throws {ApiError} 404 if the asset (or its order) does not exist, the
 * mapped `Denial` if the order is no longer uploadable, 409 VERSION_CONFLICT
 * if the asset is not UPLOADING, or 502 STORAGE_ERROR (asset left FAILED).
 */
export async function completeAsset(
  assetId: string,
  parts: { partNumber: number; etag: string }[],
  persona: Persona
): Promise<AssetDTO> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');

  await assertOrderStillUploadable(asset.orderId, persona);

  if (asset.status !== 'UPLOADING' || !asset.uploadId) {
    throw new ApiError(409, 'VERSION_CONFLICT', { status: asset.status });
  }

  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  try {
    await storage.completeMultipart(asset.storageKey, asset.uploadId ?? '', sortedParts);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'STORAGE_ERROR') {
      await prisma.asset.update({ where: { id: assetId }, data: { status: 'FAILED' } });
    }
    throw err;
  }

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: { status: 'UPLOADED', bytesUploaded: asset.sizeBytes, progressPct: 100, uploadId: null },
  });

  return toAssetDTO(updated);
}

/**
 * Aborts a multipart upload. A no-op once the asset is already in a terminal state.
 *
 * `reason` decides only the terminal status: a client that exhausted its part
 * retries reports `'error'` and the asset lands FAILED, so the row offers Retry
 * (UI spec §7.6); a user pressing ✕ leaves it ABORTED. Either way the R2
 * multipart is abandoned, so no orphaned parts are left behind.
 *
 * @throws {ApiError} 404 if the asset does not exist.
 */
export async function abortAsset(assetId: string, reason: AbortReason = 'user'): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (asset.status === 'UPLOADED' || asset.status === 'FAILED' || asset.status === 'ABORTED') return;

  try {
    await storage.abortMultipart(asset.storageKey, asset.uploadId ?? '');
  } catch {
    // best-effort: R2 cleanup failures never block the local abort transition
  }

  await prisma.asset.update({
    where: { id: assetId },
    data: { status: reason === 'error' ? 'FAILED' : 'ABORTED', uploadId: null },
  });
}
