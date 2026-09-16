import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getMongoDb } from '@/lib/db/mongo';
import { createSseStream, type SseDeps, type WatchCursor } from '@/lib/realtime/sse';
import type { ChangeLike } from '@/lib/realtime/events';
import { resetDb, makeVendor, makeOrder } from '@/tests/helpers/db';

const decoder = new TextDecoder();

describe('SSE stream (integration, real Mongo change stream)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('emits a job.updated frame within 5s of a real InstallJob update', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });

    const db = await getMongoDb();
    const watch = (resume: string | null): WatchCursor =>
      db.watch(
        [
          {
            $match: {
              'ns.coll': { $in: ['Order', 'InstallJob', 'Asset'] },
              operationType: { $in: ['insert', 'update', 'replace'] },
            },
          },
        ],
        { fullDocument: 'updateLookup', ...(resume ? { resumeAfter: { _data: resume } } : {}) }
      ) as unknown as WatchCursor;

    const deps: SseDeps = { watch, now: () => new Date() };
    const controller = new AbortController();
    const stream = createSseStream(deps, null, controller.signal);
    const reader = stream.getReader();

    const connected = await reader.read();
    expect(decoder.decode(connected.value)).toBe(': connected\n\n');

    // Give the change stream a moment to actually open before writing.
    await new Promise((r) => setTimeout(r, 250));

    const installer = await prisma.installer.create({ data: { name: 'SSE Test Installer' } });
    await prisma.installJob.update({
      where: { id: job.id },
      data: {
        status: 'CLAIMED',
        claim: { installerId: installer.id, claimedAt: new Date(), expiresAt: new Date(Date.now() + 180_000) },
        version: { increment: 1 },
      },
    });

    const found = await Promise.race([
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return null;
          const text = decoder.decode(value);
          if (text.includes('event: job.updated')) return text;
        }
      })(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for job.updated')), 5_000)),
    ]);

    expect(found).toContain('event: job.updated');
    expect(found).toContain(job.id);

    controller.abort();
  });
});
