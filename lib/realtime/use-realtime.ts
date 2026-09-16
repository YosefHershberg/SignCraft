'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from '@/lib/query/keys';
import { usePersona } from '@/lib/persona/persona-context';
import { DEGRADED_AFTER_FAILURES, SSE_RETRY_MS } from '@/lib/domain/constants';
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

/** `EventSource.CLOSED`, spelled out so this stays testable without a DOM. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * Whether *we* have to schedule the next attempt after an `error` event.
 *
 * EventSource only retries by itself after a transport-level failure, and it
 * leaves `readyState` at CONNECTING while it does. An HTTP error status or a
 * non-`text/event-stream` body is fatal by spec: it closes the stream for good
 * and fires no further errors. That is precisely what `/api/events` produces
 * when the change stream dies (it 500s), and without our own retry the app
 * would sit on "Reconnecting…" forever — the failure count would never reach
 * DEGRADED_AFTER_FAILURES, so the degraded 10 s poll would never take over and
 * the board would go quiet with a hopeful amber dot (UI spec §7.7).
 */
export function shouldRetryManually(readyState: number): boolean {
  return readyState === EVENT_SOURCE_CLOSED;
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

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
      es.onerror = () => {
        setState(reduceConnection(stateRef.current, 'error'));
        // See `shouldRetryManually`: a fatal error means no further attempts
        // and no further error events, so the retry loop has to be ours.
        if (!closed && shouldRetryManually(es?.readyState ?? EVENT_SOURCE_CLOSED)) {
          es?.close();
          retryTimer = setTimeout(connect, SSE_RETRY_MS);
        }
      };

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
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [qc, persona]);

  return status;
}
