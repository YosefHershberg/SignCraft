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
import type { AssetDTO, BootstrapDTO, JobDTO, OrderDTO } from '@/lib/domain/types';
import type {
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

/** Wire shape of `POST /api/assets` (architecture spec §8) — not an AssetDTO. */
export interface CreateAssetResult {
  assetId: string;
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
    onError: (err) => invalidateOn409(qc, err),
  });
}

export function useAbortAsset() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ assetId }: { assetId: string }) =>
      api<void>(`/api/assets/${assetId}/abort`, { method: 'POST', persona }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.bootstrap }),
    onError: (err) => invalidateOn409(qc, err),
  });
}

// --- Thin wrappers for Task 15 (upload pipeline UI) ---

export function usePresignParts() {
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ assetId, ...body }: { assetId: string } & PartsInput) =>
      api<{ urls: { partNumber: number; url: string }[] }>(`/api/assets/${assetId}/parts`, {
        method: 'POST',
        body,
        persona,
      }),
  });
}

export function useReportProgress() {
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ assetId, ...body }: { assetId: string } & ProgressInput) =>
      api<void>(`/api/assets/${assetId}/progress`, { method: 'POST', body, persona }),
  });
}

export function useCompleteAsset() {
  const qc = useQueryClient();
  const { persona } = usePersona();
  return useMutation({
    mutationFn: ({ assetId, ...body }: { assetId: string } & CompleteInput) =>
      api<AssetDTO>(`/api/assets/${assetId}/complete`, { method: 'POST', body, persona }),
    onSuccess: (asset) => setAssetInCache(qc, asset),
  });
}
