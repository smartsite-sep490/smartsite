import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/management';
import type { RequestOptions } from '../src/errors';

afterEach(() => vi.unstubAllGlobals());

const methods = ['listCameras', 'getCamera', 'listZones', 'listRegions'] as const;
function request(method: (typeof methods)[number], options: RequestOptions) {
  const client = new SmartSiteManagementClient('https://api.example.test');
  switch (method) {
    case 'listCameras':
      return client.listCameras('token', 'site', { offset: 20, limit: 20 }, options);
    case 'getCamera':
      return client.getCamera('token', 'site', 'camera', options);
    case 'listZones':
      return client.listZones('token', 'site', { offset: 20, limit: 20 }, options);
    case 'listRegions':
      return client.listRegions('token', 'site', 'camera', { offset: 20, limit: 20 }, options);
  }
}

it.each(methods)('%s refuses an already cancelled scope before fetch', async (method) => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [], total: 0 }));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(request(method, { signal: controller.signal })).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(methods)('%s cancels an in-flight metadata read after scope change', async (method) => {
  let transmittedSignal: AbortSignal | null | undefined;
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    transmittedSignal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const pending = request(method, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(transmittedSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
