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

export type JobStatus = 'OPEN' | 'CLAIMED' | 'ASSIGNED';
export type AssetStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'ABORTED';

export const SIGN_TYPES = ['STOREFRONT', 'WAYFINDING', 'VEHICLE_WRAP', 'BANNER', 'MONUMENT'] as const;
export type SignType = (typeof SIGN_TYPES)[number];

export type ActorType = 'OPS' | 'VENDOR' | 'INSTALLER' | 'SYSTEM';

export type Persona = { kind: 'ops' } | { kind: 'vendor'; id: string } | { kind: 'installer'; id: string };

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

export interface ClaimDTO {
  installerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface JobDTO {
  id: string;
  orderId: string;
  status: JobStatus;
  claim: ClaimDTO | null;
  installerId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDTO {
  id: string;
  orderId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  status: AssetStatus;
  bytesUploaded: number;
  progressPct: number;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  version: number;
  history: TransitionDTO[];
  createdAt: string;
  updatedAt: string;
  installJob: JobDTO | null;
  assets: AssetDTO[];
}

export interface BootstrapDTO {
  vendors: VendorDTO[];
  installers: InstallerDTO[];
  orders: OrderDTO[];
  serverTime: string;
  /**
   * The server's claim TTL, so client copy ("you'll have N minutes…") matches
   * a `CLAIM_TTL_MS` override instead of hardcoding the 3-minute default.
   */
  claimTtlMs: number;
}

export type OrderAction = 'submit' | 'accept' | 'start_production' | 'mark_ready' | 'complete' | 'cancel';
export type JobAction = 'claim' | 'verify' | 'complete';

export interface ActionAvailability {
  action: OrderAction;
  enabled: boolean;
  reason: string | null;
}

export type SseEvent =
  | { type: 'order.created' | 'order.updated'; doc: OrderDTO }
  | { type: 'job.created' | 'job.updated'; doc: JobDTO }
  | { type: 'asset.created' | 'asset.updated'; doc: AssetDTO };
