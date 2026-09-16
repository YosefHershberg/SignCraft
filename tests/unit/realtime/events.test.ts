import { describe, expect, it } from 'vitest';
import { changeToEvent, formatSse, type ChangeLike } from '@/lib/realtime/events';

const now = new Date('2026-09-16T12:00:00.000Z');

function fakeObjectId(hex: string) {
  return { toHexString: () => hex };
}

describe('changeToEvent', () => {
  it('maps an insert on Order to order.created with the resume token as id', () => {
    const change: ChangeLike = {
      operationType: 'insert',
      ns: { coll: 'Order' },
      _id: { _data: 'resume-token-1' },
      fullDocument: {
        _id: fakeObjectId('order1'),
        orderNumber: 'ORD-1',
        title: 'Storefront sign',
        customerName: 'Acme',
        signType: 'STOREFRONT',
        widthCm: 100,
        heightCm: 50,
        quantity: 1,
        installAddress: '1 Main St',
        dueDate: new Date('2026-10-01T00:00:00.000Z'),
        vendorId: fakeObjectId('vendor1'),
        status: 'DRAFT',
        version: 1,
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
    };

    const result = changeToEvent(change, now);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('resume-token-1');
    expect(result?.event.type).toBe('order.created');
    expect(result?.event.doc.id).toBe('order1');
  });

  it('maps an update on InstallJob to job.updated with lazy expiry applied', () => {
    const change: ChangeLike = {
      operationType: 'update',
      ns: { coll: 'InstallJob' },
      _id: { _data: 'resume-token-2' },
      fullDocument: {
        _id: fakeObjectId('job1'),
        orderId: fakeObjectId('order1'),
        status: 'CLAIMED',
        installerId: null,
        claim: {
          installerId: fakeObjectId('installer1'),
          claimedAt: new Date(now.getTime() - 200_000),
          expiresAt: new Date(now.getTime() - 1),
        },
        version: 2,
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
    };

    const result = changeToEvent(change, now);

    expect(result?.event.type).toBe('job.updated');
    if (result?.event.type === 'job.updated') {
      expect(result.event.doc.status).toBe('OPEN');
      expect(result.event.doc.claim).toBeNull();
    }
  });

  it('maps a replace on Asset to asset.updated', () => {
    const change: ChangeLike = {
      operationType: 'replace',
      ns: { coll: 'Asset' },
      _id: { _data: 'resume-token-3' },
      fullDocument: {
        _id: fakeObjectId('asset1'),
        orderId: fakeObjectId('order1'),
        fileName: 'sign.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048n,
        storageKey: 'orders/order1/sign.pdf',
        status: 'UPLOADED',
        bytesUploaded: 2048n,
        progressPct: 100,
        simulated: false,
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
    };

    const result = changeToEvent(change, now);

    expect(result?.event.type).toBe('asset.updated');
    if (result?.event.type === 'asset.updated') {
      expect(result.event.doc.sizeBytes).toBe(2048);
    }
  });

  it('returns null for a delete operation', () => {
    const change: ChangeLike = {
      operationType: 'delete',
      ns: { coll: 'Order' },
      _id: { _data: 'resume-token-4' },
    };

    expect(changeToEvent(change, now)).toBeNull();
  });

  it('returns null when fullDocument is missing for an update', () => {
    const change: ChangeLike = {
      operationType: 'update',
      ns: { coll: 'Order' },
      _id: { _data: 'resume-token-5' },
    };

    expect(changeToEvent(change, now)).toBeNull();
  });

  it('returns null for an unknown collection', () => {
    const change: ChangeLike = {
      operationType: 'insert',
      ns: { coll: 'Vendor' },
      _id: { _data: 'resume-token-6' },
      fullDocument: { _id: fakeObjectId('vendor1'), name: 'Acme' },
    };

    expect(changeToEvent(change, now)).toBeNull();
  });
});

describe('formatSse', () => {
  it('formats an id/event/data frame exactly', () => {
    const output = formatSse({ id: 'abc123', event: 'order.created', data: { id: 'order1', doc: { foo: 'bar' } } });

    expect(output).toBe('id: abc123\nevent: order.created\ndata: {"id":"order1","doc":{"foo":"bar"}}\n\n');
  });

  it('omits the id line when no id is given', () => {
    const output = formatSse({ event: 'reconnect', data: null });

    expect(output).toBe('event: reconnect\ndata: null\n\n');
  });
});
