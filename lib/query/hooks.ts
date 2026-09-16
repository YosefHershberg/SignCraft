'use client';

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

export function setOrderInCache(qc: QueryClient, order: OrderDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) => {
    if (!old) return old;
    const exists = old.orders.some((o) => o.id === order.id);
    return applyEvent(old, { type: exists ? 'order.updated' : 'order.created', doc: order });
  });
}

export function setJobInCache(qc: QueryClient, job: JobDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) => (old ? applyEvent(old, { type: 'job.updated', doc: job }) : old));
}

export function setAssetInCache(qc: QueryClient, asset: AssetDTO): void {
  qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) =>
    old ? applyEvent(old, { type: 'asset.updated', doc: asset }) : old
  );
}

function invalidateOn409(qc: QueryClient, err: unknown): void {
  if (err instanceof ApiClientError && err.status === 409) {
    void qc.invalidateQueries({ queryKey: keys.bootstrap });
  }
}

// --- Queries ---

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

export function useCreateOrder() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api<OrderDTO>('/api/orders', { method: 'POST', body: input, persona }),
    onSuccess: (order) => setOrderInCache(qc, order),
    onError: (err) => invalidateOn409(qc, err),
  });
}

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

export function useClaim() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api<JobDTO>(`/api/jobs/${jobId}/claim`, { method: 'POST', persona }),
    onSuccess: (job) => setJobInCache(qc, job),
    onError: (err) => invalidateOn409(qc, err),
  });
}

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
