/**
 * Every tuning knob in one place (CLAUDE.md: change them here, not inline).
 * Pure values only, so both the browser bundle and the server read the same
 * numbers.
 */

/** Claim hold before lazy expiry (ADR-006); `claimTtlMs()` lets `CLAIM_TTL_MS` override it on the server. */
export const DEFAULT_CLAIM_TTL_MS = 180_000;
/** Multipart part size (10 MiB); `planParts` and `createAsset` both derive part counts from it. */
export const PART_SIZE = 10 * 1024 * 1024;
/** Part URLs presigned per `POST /api/assets/:id/parts`; also the upper bound `partsSchema` enforces. */
export const PRESIGN_BATCH = 20;
/** Concurrent part PUTs the `MultipartUploader` keeps in flight per upload. */
export const MAX_PARALLEL_PARTS = 4;
/** Minimum gap between progress writes to the server (ADR-016); see `shouldReportProgress`. */
export const PROGRESS_INTERVAL_MS = 2_000;
/** A progress write is also sent whenever the percentage moves by this much. */
export const PROGRESS_STEP_PCT = 5;
/** Attempts per part before the uploader gives up and aborts with reason `'error'` (asset → FAILED). */
export const MAX_PART_RETRIES = 3;
/** Lifetime of a presigned part URL; long enough to outlive a slow 2 GB upload. */
export const PRESIGN_EXPIRY_S = 3_600;
/** When `/api/events` sends `event: reconnect` and closes — under Vercel's 300 s `maxDuration`. */
export const SSE_MAX_AGE_MS = 280_000;
/** `: hb` comment interval on the SSE stream, so proxies do not close an idle connection. */
export const SSE_HEARTBEAT_MS = 15_000;
/** Consecutive `/api/events` failures before `useRealtime` reports `degraded` and polling starts. */
export const DEGRADED_AFTER_FAILURES = 3;
/** Our own SSE retry delay, for the failures EventSource refuses to retry itself. */
export const SSE_RETRY_MS = 3_000;
/** `refetchInterval` for `useBootstrap` while degraded — the only polling in the system (Invariant 4). */
export const DEGRADED_POLL_MS = 10_000;
/** Order statuses that accept file uploads; enforced by `checkUpload` on create and every presign. */
export const UPLOADABLE_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
/** Options in the "Simulate large file" dialog; the bytes are zero-filled and never held in memory at once. */
export const SIMULATED_SIZES = [
  { label: '100 MB', bytes: 100 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 ** 3 },
  { label: '2 GB', bytes: 2 * 1024 ** 3 },
] as const;
