import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '@/lib/api/errors';
import { PRESIGN_EXPIRY_S } from '@/lib/domain/constants';
import { sanitiseFileName } from '@/lib/domain/format';

export interface Storage {
  createMultipart(key: string, contentType: string): Promise<{ uploadId: string }>;
  presignPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

let client: S3Client | undefined;

// Env is read lazily here (not at module load) so importing this module
// without R2 env vars set (e.g. from an unrelated unit test) never throws.
function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
    forcePathStyle: true,
  });
  return client;
}

function bucket(): string {
  return process.env.R2_BUCKET ?? '';
}

export const storage: Storage = {
  async createMultipart(key, contentType) {
    try {
      const res = await getClient().send(
        new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType })
      );
      if (!res.UploadId) throw new Error('R2 did not return an UploadId');
      return { uploadId: res.UploadId };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'STORAGE_ERROR', { op: 'createMultipart' });
    }
  },

  async presignPart(key, uploadId, partNumber) {
    try {
      const command = new UploadPartCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      return await getSignedUrl(getClient(), command, { expiresIn: PRESIGN_EXPIRY_S });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'STORAGE_ERROR', { op: 'presignPart' });
    }
  },

  async completeMultipart(key, uploadId, parts) {
    try {
      await getClient().send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket(),
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        })
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'STORAGE_ERROR', { op: 'completeMultipart' });
    }
  },

  async abortMultipart(key, uploadId) {
    try {
      await getClient().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'STORAGE_ERROR', { op: 'abortMultipart' });
    }
  },
};

export function storageKeyFor(orderId: string, assetId: string, fileName: string): string {
  return `orders/${orderId}/${assetId}/${sanitiseFileName(fileName)}`;
}
