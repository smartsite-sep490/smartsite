import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, readRecordedCameraVideo } from './management';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('camera media timeout configuration', () => {
  it('never sends recorded-media credentials to an implicit localhost client', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('video', { headers: { 'content-type': 'video/mp4' } }));
    globalThis.fetch = fetcher;
    // @ts-expect-error JavaScript callers must also fail closed without a configured client.
    await expect(readRecordedCameraVideo('token', 'site', 'camera')).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
    for (const method of ['streamCameraVideo', 'readRecordedCameraVideo'] as const) {
      it(`${method} refuses invalid timeout ${timeoutMs} before fetching`, async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
        globalThis.fetch = fetcher;
        const client = new SmartSiteManagementClient('http://localhost:3000');
        const request =
          method === 'streamCameraVideo'
            ? client.streamCameraVideo('token', 'site', 'camera', () => {}, { timeoutMs })
            : client.readRecordedCameraVideo('token', 'site', 'camera', { timeoutMs });
        await expect(request).rejects.toBeInstanceOf(RangeError);
        expect(fetcher).not.toHaveBeenCalled();
      });
    }
  }

  for (const method of ['streamCameraVideo', 'readRecordedCameraVideo'] as const) {
    it(`${method} cancels a stalled body when the authenticated session ends`, async () => {
      vi.useFakeTimers();
      const session = new AbortController();
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            'content-type': method === 'streamCameraVideo' ? 'application/x-ndjson' : 'video/mp4',
          },
        }),
      );
      const client = new SmartSiteManagementClient('http://localhost:3000', {
        signal: session.signal,
        getAccessToken: (token) => token,
        refreshAccessToken: async (token) => token,
        onUnauthorized: () => {},
      });
      const onFrame = vi.fn();
      const pending =
        method === 'streamCameraVideo'
          ? client.streamCameraVideo('token', 'site', 'camera', onFrame, { timeoutMs: 20 })
          : client.readRecordedCameraVideo('token', 'site', 'camera', { timeoutMs: 1000 });
      let settled = false;
      const observed = pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(100);
      // Once headers arrive, a healthy stream outlives its connection deadline.
      expect(settled).toBe(false);
      session.abort();
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      await observed;
      expect(cancelled).toBe(true);
      expect(onFrame).not.toHaveBeenCalled();
    });
  }
});
