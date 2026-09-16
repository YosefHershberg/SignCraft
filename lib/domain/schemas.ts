import { z } from 'zod';
import { PRESIGN_BATCH } from './constants';
import { ORDER_STATUSES, SIGN_TYPES } from './types';

export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);

export const createOrderSchema = z.object({
  title: z.string().trim().min(1).max(120),
  customerName: z.string().trim().min(1).max(120),
  signType: z.enum(SIGN_TYPES),
  widthCm: z.number().int().min(1).max(10_000),
  heightCm: z.number().int().min(1).max(10_000),
  quantity: z.number().int().min(1).max(1_000),
  vendorId: objectIdSchema,
  installAddress: z.string().trim().min(1).max(300),
  dueDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date'),
  notes: z.string().trim().max(2_000).optional().nullable(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const transitionSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  expectedVersion: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const verifySchema = z.object({
  outcome: z.enum(['pass', 'fail']),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const createAssetSchema = z.object({
  orderId: objectIdSchema,
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(50 * 1024 ** 3),
  simulated: z.boolean().default(false),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const partsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(PRESIGN_BATCH),
});
export type PartsInput = z.infer<typeof partsSchema>;

export const progressSchema = z.object({
  bytesUploaded: z.number().int().min(0),
});
export type ProgressInput = z.infer<typeof progressSchema>;

/**
 * Why a multipart upload is being abandoned. Both reasons abort the R2 upload;
 * only the terminal status differs, so a part that failed every retry lands as
 * FAILED (offering Retry, UI spec §7.6) instead of looking like a user abort.
 * The body is optional on the wire — no body means a user abort.
 */
export const abortSchema = z.object({
  reason: z.enum(['user', 'error']).default('user'),
});
export type AbortInput = z.infer<typeof abortSchema>;
export type AbortReason = AbortInput['reason'];

export const completeSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1),
});
export type CompleteInput = z.infer<typeof completeSchema>;
