import { prisma } from '@/lib/db/prisma';
import { ApiError, fromVerdict } from '@/lib/api/errors';
import { checkUpload } from '@/lib/domain/permissions';
import { PART_SIZE } from '@/lib/domain/constants';
import type { CreateAssetInput } from '@/lib/domain/schemas';
import type { AssetDTO, Persona } from '@/lib/domain/types';
import { storage, storageKeyFor } from '@/lib/storage/r2';
import { planParts } from '@/lib/upload/plan';
import { toAssetDTO } from './dto';

/**
 * Creates an Asset and the R2 multipart upload it will be uploaded through.
 * Only ops may attach files, and only while the order is in an uploadable
 * status (DRAFT|SUBMITTED, per `checkUpload`). The Asset is created PENDING
 * with a placeholder storageKey (the real key needs the generated asset id),
 * then updated to UPLOADING once the multipart upload exists.
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

/** Presigns URLs for the requested part numbers of an in-flight multipart upload. */
export async function presignParts(
  assetId: string,
  partNumbers: number[]
): Promise<{ partNumber: number; url: string }[]> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
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

/** Records client-reported upload progress. A no-op unless the asset is UPLOADING. */
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
 * Completes a multipart upload. If R2 reports STORAGE_ERROR the asset is
 * marked FAILED and the error is rethrown so the caller sees it; on success
 * the asset is marked UPLOADED and fully progressed.
 */
export async function completeAsset(
  assetId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<AssetDTO> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
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

/** Aborts a multipart upload. A no-op once the asset is already in a terminal state. */
export async function abortAsset(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (asset.status === 'UPLOADED' || asset.status === 'FAILED' || asset.status === 'ABORTED') return;

  try {
    await storage.abortMultipart(asset.storageKey, asset.uploadId ?? '');
  } catch {
    // best-effort: R2 cleanup failures never block the local abort transition
  }

  await prisma.asset.update({ where: { id: assetId }, data: { status: 'ABORTED', uploadId: null } });
}
