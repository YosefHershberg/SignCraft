'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from '@/lib/query/keys';
import { usePersona } from '@/lib/persona/persona-context';
import { DEGRADED_AFTER_FAILURES } from '@/lib/domain/constants';
import type { BootstrapDTO, SseEvent } from '@/lib/domain/types';
import { applyEvent, shouldToastNewJob } from './apply-event';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'degraded';

interface ConnectionState {
  status: ConnectionStatus;
  failures: number;
}

/**
 * Pure state machine for the SSE connection (architecture spec §10.2):
 * open -> live, failures reset; error -> one more failure, degraded once
 * DEGRADED_AFTER_FAILURES is reached; reconnect (server-initiated) keeps the
 * failure count but shows reconnecting while the new stream comes up.
 */
export function reduceConnection(state: ConnectionState, action: 'open' | 'error' | 'reconnect'): ConnectionState {
  if (action === 'open') return { status: 'live', failures: 0 };
  if (action === 'reconnect') return { status: 'reconnecting', failures: state.failures };
  const failures = state.failures + 1;
  return { status: failures >= DEGRADED_AFTER_FAILURES ? 'degraded' : 'reconnecting', failures };
}

// Module-level store so other hooks (useBootstrap) can read the live
// connection status without prop-drilling or a second provider/context.
let currentStatus: ConnectionStatus = 'connecting';
const listeners = new Set<() => void>();

function publish(next: ConnectionStatus): void {
  if (currentStatus === next) return;
  currentStatus = next;
  listeners.forEach((listener) => listener());
}

export function getConnectionStatus(): ConnectionStatus {
  return currentStatus;
}

export function subscribeConnectionStatus(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const EVENT_NAMES = [
  'order.created',
  'order.updated',
  'job.created',
  'job.updated',
  'asset.created',
  'asset.updated',
] as const;

/**
 * One EventSource per mounted dashboard (architecture spec §10.2). Applies
 * every event to the bootstrap cache in place, follows `reconnect` frames by
 * closing and reopening with `?after=<lastEventId>`, invalidates on
 * `resync`, and toasts installers when a new job opens.
 */
export function useRealtime(): ConnectionStatus {
  const qc = useQueryClient();
  const { persona } = usePersona();
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus());
  const stateRef = useRef<ConnectionState>({ status: getConnectionStatus(), failures: 0 });
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function setState(next: ConnectionState) {
      const wasDegraded = stateRef.current.status === 'degraded';
      stateRef.current = next;
      setStatus(next.status);
      publish(next.status);
      if (wasDegraded && next.status === 'live') {
        void qc.invalidateQueries({ queryKey: keys.bootstrap });
      }
    }

    function handleEvent(name: SseEvent['type']) {
      return (event: Event) => {
        const messageEvent = event as MessageEvent<string>;
        if (messageEvent.lastEventId) lastIdRef.current = messageEvent.lastEventId;

        let doc: unknown;
        try {
          doc = JSON.parse(messageEvent.data)?.doc;
        } catch {
          return;
        }
        const ev = { type: name, doc } as SseEvent;

        qc.setQueryData<BootstrapDTO>(keys.bootstrap, (old) => {
          if (!old) return old;
          if (shouldToastNewJob(old, ev, persona)) toast('A new job is open for installers');
          return applyEvent(old, ev);
        });
      };
    }

    function connect() {
      if (closed) return;
      const url = lastIdRef.current ? `/api/events?after=${lastIdRef.current}` : '/api/events';
      es = new EventSource(url);

      es.onopen = () => setState(reduceConnection(stateRef.current, 'open'));
      es.onerror = () => setState(reduceConnection(stateRef.current, 'error'));

      for (const name of EVENT_NAMES) {
        es.addEventListener(name, handleEvent(name));
      }

      es.addEventListener('reconnect', (event) => {
        const messageEvent = event as MessageEvent<string>;
        if (messageEvent.lastEventId) lastIdRef.current = messageEvent.lastEventId;
        setState(reduceConnection(stateRef.current, 'reconnect'));
        es?.close();
        connect();
      });

      es.addEventListener('resync', () => {
        void qc.invalidateQueries({ queryKey: keys.bootstrap });
      });
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [qc, persona]);

  return status;
}
