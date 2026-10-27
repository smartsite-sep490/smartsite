import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './index';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const reads = [
  ['cameras', (client: SmartSiteManagementClient, signal: AbortSignal) =>
    client.listCameras('fixture-token', 'site-a', undefined, { signal })],
  ['camera revision', (client: SmartSiteManagementClient, signal: AbortSignal) =>
    client.getCamera('fixture-token', 'site-a', 'camera-a', { signal })],
  ['linked regions', (client: SmartSiteManagementClient, signal: AbortSignal) =>
    client.listRegions('fixture-token', 'site-a', 'camera-a', undefined, { signal })],
] as const;

for (const [label, read] of reads) {
  it(`does not fetch ${label} after the region-editor scope was cancelled`, async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ items: [], total: 0 }));
    await expect(read(new SmartSiteManagementClient('http://localhost:3000'), controller.signal))
      .rejects.toMatchObject({ code: 'cancelled' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it(`cancels an in-flight ${label} read on a region-editor scope switch`, async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    let rejectPending: ((error: Error) => void) | undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        rejectPending = reject;
        receivedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const request = read(new SmartSiteManagementClient('http://localhost:3000'), controller.signal);
    const cancelled = expect(request).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    if (!receivedSignal) rejectPending?.(new Error('Region metadata read omitted cancellation'));
    await cancelled;
    expect(receivedSignal?.aborted).toBe(true);
  });
}
