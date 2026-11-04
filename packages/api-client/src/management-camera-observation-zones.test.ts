import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const zoneId = '33333333-3333-4333-8333-333333333333';
const client = new SmartSiteManagementClient('https://backend.example');
const context = () => ({
  siteId,
  cameraId,
  configurationVersion: 2,
  items: [{ id: zoneId, code: 'Z1', name: 'Work area' }],
  total: 21,
  unresolvedRegionCount: 0,
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('loads the exact scoped metadata page without exposing credentials in the URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(context()));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await client.getCameraObservationZones('private-token', siteId, cameraId, {
      offset: 20,
      limit: 20,
    }),
  ).toEqual(context());
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(
    `https://backend.example/api/v1/sites/${siteId}/cameras/${cameraId}/observation-zones?offset=20&limit=20`,
  );
  expect(init).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer private-token' },
  });
});

it('rejects invalid pagination before any transport', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const page of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 101 }]) {
    await expect(
      client.getCameraObservationZones('token', siteId, cameraId, page),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects wrong scope, incomplete pages, impossible totals and injected media fields', async () => {
  for (const patch of [
    { siteId: zoneId },
    { cameraId: zoneId },
    { total: 22 },
    { total: 65 },
    { imageDataUrl: 'forbidden' },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...context(), ...patch })));
    await expect(
      client.getCameraObservationZones('token', siteId, cameraId, { offset: 20 }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('accepts settled empty/unresolved context and rejects oversized metadata bodies', async () => {
  const empty = { ...context(), items: [], total: 0, unresolvedRegionCount: 2 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(empty)));
  expect(await client.getCameraObservationZones('token', siteId, cameraId)).toEqual(empty);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response({ ...empty, padding: 'x'.repeat(128_001) })),
  );
  await expect(client.getCameraObservationZones('token', siteId, cameraId)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
