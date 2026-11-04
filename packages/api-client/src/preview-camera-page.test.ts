import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';
const siteId = '11111111-1111-4111-8111-111111111111';
const camera = {
  id: '22222222-2222-4222-8222-222222222222',
  siteId,
  externalId: 'camera',
  code: 'C1',
  name: 'Camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-04T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
it('uses the scoped read-only path and preserves raw page counts', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [camera], total: 21 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const page = await new SmartSiteManagementClient('https://backend.example').listPreviewCameras(
    'secret',
    siteId,
    { offset: 20, limit: 20 },
  );
  expect(page.total).toBe(21);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://backend.example/api/v1/sites/${siteId}/preview-cameras?offset=20&limit=20`,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer secret' },
  });
});
it('refuses cross-site, duplicate, invalid-revision and over-limit pages', async () => {
  for (const items of [
    [{ ...camera, siteId: 'other' }],
    [camera, camera],
    [{ ...camera, configurationVersion: 0 }],
  ]) {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items, total: 30 }), {
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    await expect(
      new SmartSiteManagementClient('https://backend.example').listPreviewCameras('t', siteId, {
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
it('rejects invalid paging before fetch and accepts a successful empty page', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response('{"items":[],"total":0}', { headers: { 'content-type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://backend.example');
  await expect(client.listPreviewCameras('t', siteId, { offset: -1 })).rejects.toBeInstanceOf(
    RangeError,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(await client.listPreviewCameras('t', siteId)).toEqual({ items: [], total: 0 });
});
