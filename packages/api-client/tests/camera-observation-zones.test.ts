import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
const site = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';
const zone = '33333333-3333-4333-8333-333333333333';
const result = () => ({
  siteId: site,
  cameraId: camera,
  configurationVersion: 7,
  items: [{ id: zone, code: 'Z-1', name: 'Configured Zone' }],
  total: 1,
  unresolvedRegionCount: 0,
});
afterEach(() => vi.unstubAllGlobals());
it('reads bounded current observation metadata via authenticated cancellable Backend path', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(result()));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect(typeof client.getCameraObservationZones).toBe('function');
  expect(
    await client.getCameraObservationZones('synthetic', site, camera, { offset: 20, limit: 20 }),
  ).toEqual(result());
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.example.test/api/v1/sites/${site}/cameras/${camera}/observation-zones?offset=20&limit=20`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer synthetic' },
  });
});
it('rejects wrong scope, duplicate Zones, unexpected geometry and invalid metadata', async () => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect(typeof client.getCameraObservationZones).toBe('function');
  for (const extra of [
    { siteId: camera },
    { cameraId: site },
    { configurationVersion: 0 },
    { polygon: [] },
    { items: [result().items[0], result().items[0]], total: 2 },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...result(), ...extra })));
    await expect(client.getCameraObservationZones('synthetic', site, camera)).rejects.toMatchObject(
      { code: 'invalid-response' },
    );
  }
});
