/**
 * Zod schemas for every request body, shared by the route handlers
 * (`lib/api/validate.ts#parseBody`) and the client forms, so the browser
 * validates against exactly what the server will accept. A parse failure in a
 * handler becomes 400 VALIDATION_ERROR with `z.flattenError` details
 * (`lib/api/errors.ts`). Upper bounds are DoS guards on a public, unauthenticated
 * API, not product limits.
 */
import { z } from 'zod';
import { PRESIGN_BATCH } from './constants';
import { ORDER_STATUSES, SIGN_TYPES } from './types';

/** A 24-hex Mongo ObjectId; also what `parseId` uses to 404 a malformed `:id`. */
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);

/**
 * `POST /api/orders` body and the Create Order form (UI spec §4.5). The form
 * validates field-by-field against `createOrderSchema.shape`, which is why
 * strings are trimmed here rather than in the component.
 */
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

/**
 * `POST /api/orders/:id/transition`. `to` is a status, not an action, so the
 * API is the state machine itself. `expectedVersion` is the dialog's snapshot
 * of `OrderDTO.version` (optional: omitting it means "whatever it is now").
 * `reason` is stored on the history row — the cancel dialog asks for one.
 */
export const transitionSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  expectedVersion: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

/** `POST /api/jobs/:id/verify` (ADR-010): pass → ASSIGNED, fail → back to OPEN. */
export const verifySchema = z.object({
  outcome: z.enum(['pass', 'fail']),
});
export type VerifyInput = z.infer<typeof verifySchema>;

/**
 * `POST /api/assets` — step 1 of the upload pipeline. `sizeBytes` is what
 * `planParts` splits into 10 MiB parts; the 50 GB cap keeps the part count
 * within S3's 10 000-part limit with room to spare. `simulated` marks a
 * zero-filled "Simulate large file" upload so Retry can recreate it.
 */
export const createAssetSchema = z.object({
  orderId: objectIdSchema,
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(50 * 1024 ** 3),
  simulated: z.boolean().default(false),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

/**
 * `POST /api/assets/:id/parts`. The uploader asks for one batch at a time
 * (`PRESIGN_BATCH` = 20), so that is also the most a single request may
 * presign; part numbers are 1-based and S3-bounded at 10 000.
 */
export const partsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(PRESIGN_BATCH),
});
export type PartsInput = z.infer<typeof partsSchema>;

/** `POST /api/assets/:id/progress` (ADR-016); the service clamps it to `sizeBytes`. */
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

/**
 * `POST /api/assets/:id/complete`: the `{partNumber, etag}` pairs R2 returned
 * for each part (the ETag header, which is why the bucket CORS rule must
 * expose it). `completeAsset` sorts them before calling R2.
 */
// Bounded so a hostile body cannot make the server build an unbounded part
// list: S3/R2 allow at most 10 000 parts, and an ETag is a short quoted hash.
export const completeSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(128) }))
    .min(1)
    .max(10_000),
});
export type CompleteInput = z.infer<typeof completeSchema>;
