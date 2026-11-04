import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const client = new SmartSiteManagementClient('https://backend.example');
const fixture = () => ({
  siteId,
  cameraId,
  cameraExternalId: 'CAM-01',
  sourceKind: 'LIVE',
  frame: {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId: 'CAM-01',
    sessionId: otherId,
    sequenceNumber: '9007199254740993',
    capturedAt: '2026-11-03T03:00:00Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});
const respond = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('uses the scoped Backend route, header credentials and private bounded transport', async () => {
  const fetcher = vi.fn().mockResolvedValue(respond(fixture()));
  vi.stubGlobal('fetch', fetcher);
  const result = await client.getCameraPreview('private-token', siteId, cameraId);
  expect(result.frame.sequenceNumber).toBe('9007199254740993');
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`https://backend.example/api/v1/sites/${siteId}/cameras/${cameraId}/preview`);
  expect(url).not.toContain('private-token');
  expect(init).toMatchObject({
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer private-token' },
  });
});

it('rejects a valid response belonging to another Site or camera', async () => {
  for (const patch of [{ siteId: otherId }, { cameraId: otherId }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...fixture(), ...patch })));
    await expect(client.getCameraPreview('token', siteId, cameraId)).rejects.toMatchObject({
      code: 'invalid-response',
    });
  }
});

it('rejects malformed frames and credential injection', async () => {
  for (const frame of [
    { ...fixture().frame, sequenceNumber: Number('9007199254740993') },
    { ...fixture().frame, serviceToken: 'must-not-relay' },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...fixture(), frame })));
    await expect(client.getCameraPreview('token', siteId, cameraId)).rejects.toMatchObject({
      code: 'invalid-response',
    });
  }
});

it('rejects an oversized response before accepting media', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(respond({ ...fixture(), padding: 'x'.repeat(2_000_001) })),
  );
  await expect(client.getCameraPreview('token', siteId, cameraId)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});

it('preserves HTTP denials and Retry-After without an alternate endpoint', async () => {
  for (const status of [401, 403, 404, 429]) {
    const fetcher = vi.fn().mockResolvedValue(respond({}, status, { 'Retry-After': '5' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(client.getCameraPreview('token', siteId, cameraId)).rejects.toMatchObject({
      code: 'http',
      status,
      retryAfterSeconds: 5,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  }
});

it('cancels pending transport and bounds even an uncooperative fetch', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const pending = client.getCameraPreview('token', siteId, cameraId, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  vi.useFakeTimers();
  const timed = expect(client.getCameraPreview('token', siteId, cameraId)).rejects.toMatchObject({
    code: 'timeout',
  });
  await vi.advanceTimersByTimeAsync(3001);
  await timed;
});
