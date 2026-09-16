import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { resetDb, makeVendor, makeInstaller, makeOrder } from '@/tests/helpers/db';

import { POST as createOrderRoute } from '@/app/api/orders/route';
import { POST as transitionRoute } from '@/app/api/orders/[id]/transition/route';
import { POST as claimRoute } from '@/app/api/jobs/[id]/claim/route';
import { POST as verifyRoute } from '@/app/api/jobs/[id]/verify/route';
import { POST as progressRoute } from '@/app/api/assets/[id]/progress/route';

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(
  path: string,
  opts: { persona?: string; body?: unknown; rawBody?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (opts.persona) headers['x-persona'] = opts.persona;
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    headers['content-type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  return new Request(`http://localhost${path}`, { method: 'POST', headers, body });
}

describe('route handlers (integration)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('POST /api/orders with ops persona returns 201 with an orderNumber', async () => {
    const vendor = await makeVendor();
    const res = await createOrderRoute(
      req('/api/orders', {
        persona: 'ops',
        body: {
          title: 'Storefront sign',
          customerName: 'Acme',
          signType: 'BANNER',
          widthCm: 100,
          heightCm: 50,
          quantity: 1,
          vendorId: vendor.id,
          installAddress: '1 Main St',
          dueDate: new Date().toISOString(),
        },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.orderNumber).toMatch(/^SC-\d{4}$/);
  });

  it('POST /api/orders without a persona returns 403 FORBIDDEN_FOR_PERSONA', async () => {
    const res = await createOrderRoute(req('/api/orders', { body: {} }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN_FOR_PERSONA');
  });

  it('malformed JSON body returns 400 VALIDATION_ERROR', async () => {
    const res = await createOrderRoute(req('/api/orders', { persona: 'ops', rawBody: '{not valid json' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('transition DRAFT -> IN_PRODUCTION returns 400 INVALID_TRANSITION with the allowed list', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id);

    const res = await transitionRoute(
      req(`/api/orders/${order.id}/transition`, { persona: 'ops', body: { to: 'IN_PRODUCTION' } }),
      ctx(order.id)
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TRANSITION');
    expect(body.error.details.allowed).toEqual(['SUBMITTED', 'CANCELLED']);
  });

  it('malformed [id] path param returns 404 NOT_FOUND, not a Prisma error', async () => {
    const res = await claimRoute(
      req('/api/jobs/not-an-object-id/claim', { persona: 'installer:aaaaaaaaaaaaaaaaaaaaaaaa' }),
      ctx('not-an-object-id')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('claiming a job with an ops persona returns 403 FORBIDDEN_FOR_PERSONA', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });

    const res = await claimRoute(req(`/api/jobs/${job.id}/claim`, { persona: 'ops' }), ctx(job.id));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN_FOR_PERSONA');
  });

  it('full flow: claim -> verify(pass) -> transition to COMPLETED via the exported handlers', async () => {
    const vendor = await makeVendor();
    const installer = await makeInstaller();
    const order = await makeOrder(vendor.id, { status: 'READY_FOR_INSTALL' });
    const job = await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    const persona = `installer:${installer.id}`;

    const claimRes = await claimRoute(req(`/api/jobs/${job.id}/claim`, { persona }), ctx(job.id));
    expect(claimRes.status).toBe(200);
    expect((await claimRes.json()).status).toBe('CLAIMED');

    const verifyRes = await verifyRoute(
      req(`/api/jobs/${job.id}/verify`, { persona, body: { outcome: 'pass' } }),
      ctx(job.id)
    );
    expect(verifyRes.status).toBe(200);
    const verified = await verifyRes.json();
    expect(verified.status).toBe('ASSIGNED');
    expect(verified.installerId).toBe(installer.id);

    const completeRes = await transitionRoute(
      req(`/api/orders/${order.id}/transition`, { persona, body: { to: 'COMPLETED' } }),
      ctx(order.id)
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).status).toBe('COMPLETED');
  });

  it('POST /api/assets/:id/progress returns 204', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor.id);
    const asset = await prisma.asset.create({
      data: {
        orderId: order.id,
        fileName: 'plan.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1000n,
        storageKey: 'orders/x/asset/plan.pdf',
        uploadId: 'upload-1',
        status: 'UPLOADING',
      },
    });

    const res = await progressRoute(
      req(`/api/assets/${asset.id}/progress`, { persona: 'ops', body: { bytesUploaded: 500 } }),
      ctx(asset.id)
    );

    expect(res.status).toBe(204);
    const updated = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(Number(updated.bytesUploaded)).toBe(500);
  });
});
