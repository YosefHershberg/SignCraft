'use client';

// Client-side query layer: TanStack Query hooks over the single bootstrap
// snapshot (`keys.bootstrap`). Queries read it, mutations write through it via
// `applyEvent` (the same reducer SSE frames use — see `lib/realtime/apply-event.ts`),
// so REST responses and realtime frames converge on identical cache state.
import { useSyncExternalStore } from 'react';
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { AssetDTO, BootstrapDTO, JobDTO, OrderDTO, Persona } from '@/lib/domain/types';
import type {
  AbortInput,
  AbortReason,
  CompleteInput,
  CreateAssetInput,
  CreateOrderInput,
  PartsInput,
  ProgressInput,
  TransitionInput,
  VerifyInput,
} from '@/lib/domain/schemas';
import { DEGRADED_POLL_MS } from '@/lib/domain/constants';
import { applyEvent } from '@/lib/realtime/apply-event';
import { getConnectionStatus, subscribeConnectionStatus } from '@/lib/realtime/use-realtime';
import { usePersona } from '@/lib/persona/persona-context';
import { ApiClientError, api } from './api-client';
import { keys } from './keys';

// --- Cache patchers: reuse applyEvent with a synthetic event so a mutation
// response updates the bootstrap cache exactly the way an SSE frame would. ---

/** Patches an order mutation's response into the cache via `applyEvent`, inferring created-vs-updated from whether the id is already there. */
export function setOrderInCache(qc: QueryClient, order: OrderDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) => {
    if (!old) return old;
    const exists = old.orders.some((o) => o.id === order.id);
    return applyEvent(old, { type: exists ? 'order.updated' : 'order.created', doc: order });
  });
}

/** Patches a claim/verify mutation's response into the cache via `applyEvent`. */
export function setJobInCache(qc: QueryClient, job: JobDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) => (old ? applyEvent(old, { type: 'job.updated', doc: job }) : old));
}

/** Patches an asset mutation's response into the cache via `applyEvent`. */
export function setAssetInCache(qc: QueryClient, asset: AssetDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) =>
    old ? applyEvent(old, { type: 'asset.updated', doc: asset }) : old
  );
}

/**
 * On a 409 (stale `version`, claim already taken/expired), the mutation's own
 * optimistic write can't be trusted — something else changed the doc between
 * this tab's read and its write. Refetching the bootstrap is how the client
 * behaviour in architecture spec §12 puts the true server state back in the
 * cache instead of leaving the tab showing a request that didn't land.
 */
function invalidateOn409(qc: QueryClient, err: unknown): void {
  if (err instanceof ApiClientError && err.status === 409) {
    void qc.invalidateQueries({ queryKey: keys.bootstrap });
  }
}

// --- Queries ---

/**
 * The one query behind the whole board (`GET /api/bootstrap`). `initialData`
 * is the server-rendered snapshot from `app/page.tsx`, so the first paint
 * needs no client fetch. `staleTime: Infinity` because SSE (`useRealtime`) is
 * what keeps this fresh — a normal staleness policy would fight the realtime
 * writes. `refetchInterval` only turns on at `DEGRADED_POLL_MS` while the
 * connection status (read from `lib/realtime/use-realtime.ts`'s module-level
 * store) is `degraded`; that is the sole polling path in the app (Invariant 4).
 */
export function useBootstrap(initialData: BootstrapDTO): UseQueryResult<BootstrapDTO> {
  const { persona } = usePersona();
  const status = useSyncExternalStore(subscribeConnectionStatus, getConnectionStatus, getConnectionStatus);

  return useQuery({
    queryKey: keys.bootstrap,
    queryFn: () => api<BootstrapDTO>('/api/bootstrap', { persona }),
    initialData,
    staleTime: Infinity,
    refetchInterval: status === 'degraded' ? DEGRADED_POLL_MS : false,
  });
}

/**
 * One order, read live out of the bootstrap cache, so an SSE frame re-renders
 * the detail sheet without threading `orders` through props. `skipToken` makes
 * this observer read-only — the dashboard still owns the fetching.
 */
export function useOrder(orderId: string | null): OrderDTO | null {
  const { data } = useQuery<BootstrapDTO, Error, OrderDTO | null>({
    queryKey: keys.bootstrap,
    queryFn: skipToken,
    select: (bootstrap) => bootstrap.orders.find((order) => order.id === orderId) ?? null,
  });
  return data ?? null;
}

// --- Mutations ---

/** `POST /api/orders` — ops persona only (enforced server-side; see `lib/domain/permissions.ts`). */
export function useCreateOrder() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api<OrderDTO>('/api/orders', { method: 'POST', body: input, persona }),
    onSuccess: (order) => setOrderInCache(qc, order),
    onError: (err) => invalidateOn409(qc, err),
  });
}

/** `POST /api/orders/:id/transition` — any persona, per-transition rules checked server-side (pipeline 1). Callers pass `expectedVersion` for optimistic-concurrency 409s. */
export function useTransition() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ orderId, ...body }: { orderId: string } & TransitionInput) =>
      api<OrderDTO>(`/api/orders/${orderId}/transition`, { method: 'POST', body, persona }),
    onSuccess: (order) => setOrderInCache(qc, order),
    onError: (err) => invalidateOn409(qc, err),
  });
}

/** `POST /api/jobs/:id/claim` — installer persona only. A 409 means another installer's conditional update won the race first (pipeline 2). */
export function useClaim() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api<JobDTO>(`/api/jobs/${jobId}/claim`, { method: 'POST', persona }),
    onSuccess: (job) => setJobInCache(qc, job),
    onError: (err) => invalidateOn409(qc, err),
  });
}

/** `POST /api/jobs/:id/verify` — installer persona, and only the claimant; a 409 is `CLAIM_EXPIRED` or `NOT_CLAIMANT`. */
export function useVerify() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string } & VerifyInput) =>
      api<JobDTO>(`/api/jobs/${jobId}/verify`, { method: 'POST', body, persona }),
    onSuccess: (job) => setJobInCache(qc, job),
    onError: (err) => invalidateOn409(qc, err),
  });
}

/**
 * Wire shape of `POST /api/assets` (`lib/services/assets.ts`) — the created
 * asset plus the multipart parameters the uploader needs. Not an AssetDTO.
 */
export interface CreateAssetResult {
  asset: AssetDTO;
  uploadId: string;
  partSize: number;
  partCount: number;
}

/** `POST /api/assets` — ops persona only. Pipeline 3 step 1: creates the `Asset` row and the R2 multipart upload, and returns the plan the uploader needs (`CreateAssetResult`). */
export function useCreateAsset() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: (input: CreateAssetInput) =>
      api<CreateAssetResult>('/api/assets', { method: 'POST', body: input, persona }),
    // Seeds the row into the cache at once, so the asset appears at 0% before
    // the first part is presigned rather than waiting for the SSE frame.
    onSuccess: ({ asset }) => setAssetInCache(qc, asset),
    onError: (err) => invalidateOn409(qc, err),
  });
}

// --- Upload pipeline wire calls (Task 15) ---

/** The shape `uploadWireApi()` returns — matches `UploaderApi` (`lib/upload/uploader.ts`) plus the `reason` an abort needs to distinguish user-cancelled from give-up-after-retries. */
export interface UploadWireApi {
  presign(assetId: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]>;
  progress(assetId: string, bytesUploaded: number): Promise<void>;
  complete(assetId: string, parts: CompleteInput['parts']): Promise<void>;
  abort(assetId: string, reason: AbortReason): Promise<void>;
}

/**
 * The four calls an in-flight upload makes, pinned to one persona.
 *
 * Deliberately not mutation hooks: a hook reads `usePersona()` per render, so
 * switching persona mid-upload (§7.8) would sign the *next* presign with the
 * new persona and be refused with a 403. The uploader captures this object
 * when it starts and keeps using it. Cache patching that the hooks' `onSuccess`
 * used to do happens here instead.
 */
export function uploadWireApi(persona: Persona, qc: QueryClient): UploadWireApi {
  return {
    presign: (assetId, partNumbers) =>
      api<{ urls: { partNumber: number; url: string }[] }>(`/api/assets/${assetId}/parts`, {
        method: 'POST',
        body: { partNumbers } satisfies PartsInput,
        persona,
      }).then((res) => res.urls),

    progress: (assetId, bytesUploaded) =>
      api<void>(`/api/assets/${assetId}/progress`, {
        method: 'POST',
        body: { bytesUploaded } satisfies ProgressInput,
        persona,
      }),

    complete: async (assetId, parts) => {
      setAssetInCache(qc, await api<AssetDTO>(`/api/assets/${assetId}/complete`, {
        method: 'POST',
        body: { parts } satisfies CompleteInput,
        persona,
      }));
    },

    // 204, no DTO: the server's terminal status (ABORTED or, for `'error'`,
    // FAILED) comes back through the refetch and the SSE frame.
    abort: async (assetId, reason) => {
      await api<void>(`/api/assets/${assetId}/abort`, {
        method: 'POST',
        body: { reason } satisfies AbortInput,
        persona,
      });
      await qc.invalidateQueries({ queryKey: keys.bootstrap });
    },
  };
}
