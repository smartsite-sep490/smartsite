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
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...result(), total: 21 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect(typeof client.getCameraObservationZones).toBe('function');
  expect(
    await client.getCameraObservationZones('synthetic', site, camera, { offset: 20, limit: 20 }),
  ).toEqual({ ...result(), total: 21 });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.example.test/api/v1/sites/${site}/cameras/${camera}/observation-zones?offset=20&limit=20`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer synthetic' },
  });
});
it('refuses incomplete or oversized page responses instead of presenting false completeness', async () => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  for (const [paging, response] of [
    [
      { offset: 0, limit: 20 },
      { ...result(), items: [], total: 2 },
    ],
    [{ offset: 1, limit: 20 }, result()],
    [
      { offset: 0, limit: 1 },
      {
        ...result(),
        items: [result().items[0], { id: site, code: 'Z-2', name: 'Second' }],
        total: 2,
      },
    ],
  ] as const) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)));
    await expect(
      client.getCameraObservationZones('synthetic', site, camera, paging),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
it('rejects invalid page requests locally before sending credentials', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://api.example.test');
  for (const paging of [
    { offset: -1 },
    { offset: 0.5 },
    { limit: 0 },
    { limit: 101 },
    { limit: NaN },
  ]) {
    await expect(
      client.getCameraObservationZones('synthetic', site, camera, paging),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
  expect(fetcher).not.toHaveBeenCalled();
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
it('bounds stalled metadata reads by the default deadline and honors caller cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const client = new SmartSiteManagementClient('https://api.example.test');
    const pending = client.getCameraObservationZones('synthetic', site, camera);
    const deadline = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5001);
    await deadline;
    const controller = new AbortController();
    const cancelled = client.getCameraObservationZones(
      'synthetic',
      site,
      camera,
      {},
      { signal: controller.signal },
    );
    const outcome = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await outcome;
  } finally {
    vi.useRealTimers();
  }
});
