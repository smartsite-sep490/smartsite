import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './index';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

it('does not read Zone policies after the Site scope was already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ items: [], total: 0 }));
  const client = new SmartSiteManagementClient('http://localhost:3000');
  await expect(
    client.listZones('fixture-token', 'fixture-site', undefined, { signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('cancels an in-flight Zone policy read when its Site scope changes', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
    receivedSignal = init?.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      rejectPending = reject;
      receivedSignal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  });
  const client = new SmartSiteManagementClient('http://localhost:3000');
  const request = client.listZones('fixture-token', 'fixture-site', undefined, {
    signal: controller.signal,
  });
  const cancelled = expect(request).rejects.toMatchObject({ code: 'cancelled' });
  controller.abort();
  if (!receivedSignal) rejectPending?.(new Error('Zone request omitted cancellation signal'));
  await cancelled;
  expect(receivedSignal?.aborted).toBe(true);
});
