/**
 * The wire types shared by client and server: the DTOs every REST response
 * and SSE frame carries, plus the enums and unions the rest of `lib/domain`
 * is written against. Pure (Invariant 6) — no Prisma types leak past
 * `lib/services/dto.ts`, which maps DB rows and change-stream documents into
 * these shapes.
 */

/** Order statuses in board order; also the Zod enum for `transitionSchema.to`. */
export const ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'VENDOR_ACCEPTED',
  'IN_PRODUCTION',
  'READY_FOR_INSTALL',
  'COMPLETED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Install-job lifecycle: OPEN on the marketplace → CLAIMED (held under a TTL
 * by one installer) → ASSIGNED (claim verified). A CLAIMED job whose TTL has
 * lapsed is *presented* as OPEN by `toPublicJob` before anyone reads it.
 */
export type JobStatus = 'OPEN' | 'CLAIMED' | 'ASSIGNED';
/**
 * Upload lifecycle: PENDING (row exists, no R2 multipart yet) → UPLOADING →
 * UPLOADED, or the terminal FAILED (R2 error / retries exhausted, offers Retry)
 * and ABORTED (user pressed ✕).
 */
export type AssetStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'ABORTED';

export const SIGN_TYPES = ['STOREFRONT', 'WAYFINDING', 'VEHICLE_WRAP', 'BANNER', 'MONUMENT'] as const;
export type SignType = (typeof SIGN_TYPES)[number];

/** Who performed a transition; SYSTEM is used by the seed for the initial DRAFT row. */
export type ActorType = 'OPS' | 'VENDOR' | 'INSTALLER' | 'SYSTEM';

/**
 * The caller's identity for the demo (ADR-008): there is no auth, so this is
 * parsed from the `x-persona` header (or the `sc_persona` cookie) and drives
 * every permission check in `permissions.ts`. Ops is a shared console with no id.
 */
export type Persona = { kind: 'ops' } | { kind: 'vendor'; id: string } | { kind: 'installer'; id: string };

/**
 * One row of an order's embedded, append-only history (ADR-015). `from` is
 * null only for the creation row. `actorId` is null for ops/system and may be
 * null on seeded rows — `history.ts` falls back to the order's own participants.
 */
export interface TransitionDTO {
  from: OrderStatus | null;
  to: OrderStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  at: string;
}

export interface VendorDTO {
  id: string;
  name: string;
}

export interface InstallerDTO {
  id: string;
  name: string;
}

/**
 * The live hold on a CLAIMED job. `expiresAt - claimedAt` is the TTL the
 * server applied (`ring.ts#claimTotalMs` reads it from here rather than from
 * config so an env override never desyncs the countdown ring).
 */
export interface ClaimDTO {
  installerId: string;
  claimedAt: string;
  expiresAt: string;
}

/**
 * Public view of an `InstallJob` (its own collection, ADR-015, so the claim
 * race is a conditional write on one small document). Always passes through
 * `toPublicJob` on the way out of the server, so `status` already reflects
 * lazy expiry (Invariant 3).
 */
export interface JobDTO {
  id: string;
  orderId: string;
  status: JobStatus;
  /** Present only while CLAIMED (and unexpired); null when OPEN or ASSIGNED. */
  claim: ClaimDTO | null;
  /** Set only once ASSIGNED (verify passed); the claimant's id lives in `claim` until then. */
  installerId: string | null;
  /** Bumped by every claim/verify/release write, so `applyEvent` can drop stale SSE frames. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public view of an upload. `uploadId` (the R2 multipart id) is deliberately
 * absent: it is server-side state, cleared on complete/abort, and the client
 * only ever needs the presigned part URLs derived from it.
 */
export interface AssetDTO {
  id: string;
  orderId: string;
  fileName: string;
  contentType: string;
  /** BigInt in the DB; a number here via `normalise`. */
  sizeBytes: number;
  /** `orders/<orderId>/<assetId>/<sanitised name>` — see `storageKeyFor`. */
  storageKey: string;
  status: AssetStatus;
  bytesUploaded: number;
  /**
   * Coarse, server-recorded progress (updated every 2 s / +5 %, ADR-016) that
   * other dashboards render. The uploading tab shows its own finer local
   * estimate instead while the server still says the upload is in flight.
   */
  progressPct: number;
  /** True for "Simulate large file" uploads: zero-filled bytes, recreatable from `sizeBytes` on Retry. */
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The order as the board and detail sheet see it. Relations (`installJob`,
 * `assets`) are embedded for the REST/bootstrap path; change-stream order
 * documents do not carry them, so `applyEvent` preserves the cached ones.
 */
export interface OrderDTO {
  id: string;
  orderNumber: string;
  title: string;
  customerName: string;
  signType: SignType;
  widthCm: number;
  heightCm: number;
  quantity: number;
  installAddress: string;
  dueDate: string;
  notes: string | null;
  vendorId: string;
  status: OrderStatus;
  /**
   * Optimistic-concurrency token. The transition dialog snapshots it on open
   * and sends it as `expectedVersion`; `transitionOrder` filters on it, so a
   * stale tab gets 409 VERSION_CONFLICT instead of overwriting a newer state.
   */
  version: number;
  /** Append-only, embedded (ADR-015); rendered by `HistoryTimeline` via `historyLine`. */
  history: TransitionDTO[];
  createdAt: string;
  updatedAt: string;
  /** Null until the order reaches READY_FOR_INSTALL (`ensureJobForOrder`). */
  installJob: JobDTO | null;
  assets: AssetDTO[];
}

/** Everything the dashboard needs for its first render, from `GET /api/bootstrap`. */
export interface BootstrapDTO {
  vendors: VendorDTO[];
  installers: InstallerDTO[];
  /** Newest first, each with `installJob` and `assets`, lazy expiry applied. */
  orders: OrderDTO[];
  /** Seeds the shared `useNow()` clock so server and first client render agree on countdowns. */
  serverTime: string;
  /**
   * The server's claim TTL, so client copy ("you'll have N minutes…") matches
   * a `CLAIM_TTL_MS` override instead of hardcoding the 3-minute default.
   */
  claimTtlMs: number;
}

/** Button-level names for order transitions; `ACTION_TARGET` maps each to its target status. */
export type OrderAction = 'submit' | 'accept' | 'start_production' | 'mark_ready' | 'complete' | 'cancel';
export type JobAction = 'claim' | 'verify' | 'complete';

/**
 * One order button as `orderActionsFor` offers it: `enabled: false` with a
 * `reason` is a guard failure shown as a disabled button with a tooltip;
 * actions the persona may never take are simply absent from the list.
 */
export interface ActionAvailability {
  action: OrderAction;
  enabled: boolean;
  reason: string | null;
}

/**
 * A realtime frame after `changeToEvent`: the `doc` is the same public DTO the
 * REST API returns, so `applyEvent` patches the cache identically from either.
 */
export type SseEvent =
  | { type: 'order.created' | 'order.updated'; doc: OrderDTO }
  | { type: 'job.created' | 'job.updated'; doc: JobDTO }
  | { type: 'asset.created' | 'asset.updated'; doc: AssetDTO };
