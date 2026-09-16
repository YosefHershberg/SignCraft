export const DEFAULT_CLAIM_TTL_MS = 180_000;
export const PART_SIZE = 10 * 1024 * 1024;
export const PRESIGN_BATCH = 20;
export const MAX_PARALLEL_PARTS = 4;
export const PROGRESS_INTERVAL_MS = 2_000;
export const PROGRESS_STEP_PCT = 5;
export const MAX_PART_RETRIES = 3;
export const PRESIGN_EXPIRY_S = 3_600;
export const SSE_MAX_AGE_MS = 280_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const DEGRADED_AFTER_FAILURES = 3;
/** Our own SSE retry delay, for the failures EventSource refuses to retry itself. */
export const SSE_RETRY_MS = 3_000;
export const DEGRADED_POLL_MS = 10_000;
export const UPLOADABLE_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export const SIMULATED_SIZES = [
  { label: '100 MB', bytes: 100 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 ** 3 },
  { label: '2 GB', bytes: 2 * 1024 ** 3 },
] as const;
