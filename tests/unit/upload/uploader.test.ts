import { describe, expect, it, vi } from 'vitest';
import { planParts } from '@/lib/upload/plan';
import { MultipartUploader, type PutPart, type UploaderApi } from '@/lib/upload/uploader';

const noopSleep = async () => {};

function makeApi(overrides: Partial<UploaderApi> = {}): UploaderApi {
  return {
    presign: vi.fn(async (_assetId: string, partNumbers: number[]) =>
      partNumbers.map((partNumber) => ({ partNumber, url: `https://upload.example/${partNumber}` }))
    ),
    progress: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    ...overrides,
  };
}

function immediatePut(): PutPart {
  return vi.fn(async (url: string, body: Blob, onProgress: (loaded: number) => void) => {
    onProgress(body.size);
    return { etag: `etag-${url.split('/').pop()}` };
  });
}

describe('MultipartUploader', () => {
  it('(a) uploads every part, presigning once and completing in order', async () => {
    const plan = planParts(3, 1); // 3 parts of size 1
    const api = makeApi();
    const put = immediatePut();

    const uploader = new MultipartUploader({
      assetId: 'asset-1',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
    });

    await uploader.start();

    expect(api.presign).toHaveBeenCalledTimes(1);
    expect(api.presign).toHaveBeenCalledWith('asset-1', [1, 2, 3]);
    expect(api.complete).toHaveBeenCalledTimes(1);
    const [, parts] = (api.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1, 2, 3]);
    expect(parts.every((p: { etag: string }) => typeof p.etag === 'string' && p.etag.length > 0)).toBe(true);
    expect(uploader.state).toBe('done');
  });

  it('(b) presigns in batches as parts are needed', async () => {
    const plan = planParts(45, 1); // 45 parts of size 1
    const api = makeApi();
    const put = immediatePut();

    const uploader = new MultipartUploader({
      assetId: 'asset-2',
      sizeBytes: 45,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      batch: 20,
      sleep: noopSleep,
    });

    await uploader.start();

    expect(api.presign).toHaveBeenCalledTimes(3);
    const calls = (api.presign as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(calls[1][1]).toEqual(Array.from({ length: 20 }, (_, i) => i + 21));
    expect(calls[2][1]).toEqual([41, 42, 43, 44, 45]);
    expect(uploader.state).toBe('done');
  });

  it('(c) retries a failing part and still completes', async () => {
    const plan = planParts(1, 1); // single part
    const api = makeApi();
    let calls = 0;
    const put: PutPart = vi.fn(async (_url, body, onProgress) => {
      calls++;
      if (calls < 3) throw new Error('transient failure');
      onProgress(body.size);
      return { etag: 'etag-final' };
    });

    const uploader = new MultipartUploader({
      assetId: 'asset-3',
      sizeBytes: 1,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
    });

    await uploader.start();

    expect(put).toHaveBeenCalledTimes(3);
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(uploader.state).toBe('done');
  });

  it('(d) fails after exhausting retries', async () => {
    const plan = planParts(1, 1);
    const api = makeApi();
    const put: PutPart = vi.fn(async () => {
      throw new Error('permanent failure');
    });
    const onError = vi.fn();

    const uploader = new MultipartUploader({
      assetId: 'asset-4',
      sizeBytes: 1,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      maxRetries: 2,
      sleep: noopSleep,
      onError,
    });

    await uploader.start();

    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledWith('asset-4');
    expect(uploader.state).toBe('failed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('(e) abort() stops in-flight uploads without completing', async () => {
    const plan = planParts(3, 1);
    const api = makeApi();
    const onAborted = vi.fn();

    const put: PutPart = vi.fn((_url, _body, _onProgress, signal) => {
      return new Promise<{ etag: string }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const uploader = new MultipartUploader({
      assetId: 'asset-5',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
      onAborted,
    });

    const started = uploader.start();
    // let the parts get picked up and their PUTs begin
    await Promise.resolve();
    await Promise.resolve();

    uploader.abort();
    await started;

    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledWith('asset-5');
    expect(api.complete).not.toHaveBeenCalled();
    expect(uploader.state).toBe('aborted');
    expect(onAborted).toHaveBeenCalledTimes(1);
  });

  it('(f) reports final progress before completing', async () => {
    const plan = planParts(3, 1);
    const api = makeApi();
    const put = immediatePut();

    const uploader = new MultipartUploader({
      assetId: 'asset-6',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
    });

    await uploader.start();

    const progressCalls = (api.progress as ReturnType<typeof vi.fn>).mock.calls;
    const finalCallIndex = progressCalls.findIndex(([, bytes]) => bytes === 3);
    expect(finalCallIndex).toBeGreaterThanOrEqual(0);

    const progressOrder = (api.progress as ReturnType<typeof vi.fn>).mock.invocationCallOrder[finalCallIndex];
    const completeOrder = (api.complete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(progressOrder).toBeLessThan(completeOrder);
  });

  it('(g) fails cleanly if api.complete rejects after all parts uploaded', async () => {
    const plan = planParts(3, 1);
    const api = makeApi({ complete: vi.fn(async () => { throw new Error('complete failed'); }) });
    const put = immediatePut();
    const onError = vi.fn();

    const uploader = new MultipartUploader({
      assetId: 'asset-7',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
      onError,
    });

    await uploader.start();

    expect(uploader.state).toBe('failed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledWith('asset-7');
  });

  it('(h) a throwing onDone does not flip a completed upload to failed', async () => {
    const plan = planParts(3, 1);
    const api = makeApi();
    const put = immediatePut();
    const onError = vi.fn();
    const onDone = vi.fn(() => {
      throw new Error('onDone boom');
    });

    const uploader = new MultipartUploader({
      assetId: 'asset-8',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
      onError,
      onDone,
    });

    // `state` must already be 'done' before onDone runs, so its throw
    // (deliberately left to propagate, not swallowed) does not change that.
    await expect(uploader.start()).rejects.toThrow('onDone boom');

    expect(uploader.state).toBe('done');
    expect(onError).not.toHaveBeenCalled();
    expect(api.abort).not.toHaveBeenCalled();
  });

  it('(i) abort() during a pending api.complete() finishes as aborted, not done', async () => {
    const plan = planParts(3, 1);
    let resolveComplete: () => void = () => {};
    const completePending = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    const api = makeApi({ complete: vi.fn(() => completePending) });
    const put = immediatePut();
    const onDone = vi.fn();
    const onAborted = vi.fn();

    const uploader = new MultipartUploader({
      assetId: 'asset-9',
      sizeBytes: 3,
      plan,
      source: () => new Blob([new Uint8Array(1)]),
      api,
      put,
      sleep: noopSleep,
      onDone,
      onAborted,
    });

    const started = uploader.start();

    // Flush microtasks until api.complete has actually been called (and is
    // now pending on `completePending`), without depending on a fixed tick
    // count for the await chain above it.
    for (let i = 0; i < 50 && (api.complete as ReturnType<typeof vi.fn>).mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(api.complete).toHaveBeenCalledTimes(1);

    uploader.abort();
    resolveComplete();
    await started;

    expect(uploader.state).toBe('aborted');
    expect(onDone).not.toHaveBeenCalled();
    expect(onAborted).toHaveBeenCalledTimes(1);
  });
});
