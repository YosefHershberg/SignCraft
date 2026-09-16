// Server-side mapping from a MongoDB change-stream event to a typed SSE frame.
// Pure with respect to I/O: takes a change document, returns data. No driver import.
import { toAssetDTO, toJobDTO, toOrderDTO } from '@/lib/services/dto';
import type { SseEvent } from '@/lib/domain/types';

export interface ChangeLike {
  operationType: string;
  ns: { coll: string };
  fullDocument?: unknown;
  _id: { _data: string };
}

const WRITE_OPS = new Set(['insert', 'update', 'replace']);

export function changeToEvent(change: ChangeLike, now: Date): { id: string; event: SseEvent } | null {
  if (!WRITE_OPS.has(change.operationType) || !change.fullDocument) return null;

  const id = change._id._data;
  const isCreate = change.operationType === 'insert';

  switch (change.ns.coll) {
    case 'Order':
      return {
        id,
        event: { type: isCreate ? 'order.created' : 'order.updated', doc: toOrderDTO(change.fullDocument, now) },
      };
    case 'InstallJob':
      return {
        id,
        event: { type: isCreate ? 'job.created' : 'job.updated', doc: toJobDTO(change.fullDocument, now) },
      };
    case 'Asset':
      return {
        id,
        event: { type: isCreate ? 'asset.created' : 'asset.updated', doc: toAssetDTO(change.fullDocument) },
      };
    default:
      return null;
  }
}

export function formatSse(frame: { id?: string; event: string; data: unknown }): string {
  const lines: string[] = [];
  if (frame.id !== undefined) lines.push(`id: ${frame.id}`);
  lines.push(`event: ${frame.event}`);
  lines.push(`data: ${JSON.stringify(frame.data)}`);
  return `${lines.join('\n')}\n\n`;
}
