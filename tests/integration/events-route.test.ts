import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { resetDb, makeVendor, makeOrder } from '@/tests/helpers/db';
import { GET } from '@/app/api/events/route';

const decoder = new TextDecoder();

describe('GET /api/events (integration, via the exported route handler)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns the SSE headers, a connected comment, and a real job.updated frame', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });

    const controller = new AbortController();
    const req = new Request('http://localhost/api/events', { signal: controller.signal });

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('connection')).toBe('keep-alive');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const reader = res.body!.getReader();
    const connected = await reader.read();
    expect(decoder.decode(connected.value)).toBe(': connected\n\n');

    // Give the change stream a moment to actually open before writing.
    await new Promise((r) => setTimeout(r, 250));

    const installer = await prisma.installer.create({ data: { name: 'Events Route Test Installer' } });
    await prisma.installJob.update({
      where: { id: job.id },
      data: {
        status: 'CLAIMED',
        claim: { installerId: installer.id, claimedAt: new Date(), expiresAt: new Date(Date.now() + 180_000) },
        version: { increment: 1 },
      },
    });

    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const found = await Promise.race([
        (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return null;
            const text = decoder.decode(value);
            if (text.includes('event: job.updated')) return text;
          }
        })(),
        new Promise<string>((_, reject) => {
          raceTimer = setTimeout(() => reject(new Error('timeout waiting for job.updated')), 5_000);
        }),
      ]);

      expect(found).toContain('event: job.updated');
      expect(found).toContain(job.id);
    } finally {
      if (raceTimer) clearTimeout(raceTimer);
      controller.abort();
      await reader.cancel().catch(() => {});
      // Give the cursor's close() (real network round-trip to Mongo) a tick to complete.
      await new Promise((r) => setTimeout(r, 0));
    }
  });
});
