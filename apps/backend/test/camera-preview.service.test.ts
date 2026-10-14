import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { EXPERIMENTAL_OBJECT_CLASSES } from '@smartsite/contracts/camera-preview';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const frame = (camera = 'camera-a') => ({
  type: 'frame',
  previewVersion: 1,
  cameraExternalId: camera,
  sessionId: '33333333-3333-4333-8333-333333333333',
  sequenceNumber: '1',
  capturedAt: new Date().toISOString(),
  width: 640,
  height: 480,
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  detections: [],
  zoneDetections: [],
  zonePolygons: [],
});
async function fixture() {
  const { CameraPreviewService } = await import(
    new URL('../src/modules/cameras/camera-preview.service.js', import.meta.url).href
  );
  const state = {
    authCalls: 0,
    cameraReads: 0,
    upstreamCalls: 0,
    revoked: false,
    inactive: false,
    assignedSite: siteId,
    cameraSite: siteId,
    origin: 'http://127.0.0.1:8001',
  };
  let fetcher: (url: string, options: RequestInit) => Promise<Response> = async () =>
    Response.json({ sourceKind: 'LIVE', frame: frame() });
  let onAuthorize = () => {};
  let onCameraRead: (read: number) => Promise<void> = async () => {};
  const auth = {
    async authenticate() {
      state.authCalls++;
      onAuthorize();
      if (state.revoked) throw new UnauthorizedException();
      return {
        user: {
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: state.assignedSite }],
        },
      };
    },
  };
  const cameras = {
    async get() {
      await onCameraRead(++state.cameraReads);
      return {
        id: cameraId,
        siteId: state.cameraSite,
        externalId: 'camera-a',
        status: state.inactive ? 'INACTIVE' : 'ACTIVE',
      };
    },
  };
  const config = {
    get(key: string) {
      return key === 'SMARTSITE_AI_PREVIEW_SOURCES'
        ? { 'camera-a': state.origin }
        : 'fake-service-token';
    },
  };
  const service = new CameraPreviewService(
    config,
    auth,
    cameras,
    (url: string, options: RequestInit) => {
      state.upstreamCalls++;
      return fetcher(url, options);
    },
  );
  return {
    state,
    service,
    setFetch(value: typeof fetcher) {
      fetcher = value;
    },
    onAuthorize(value: () => void) {
      onAuthorize = value;
    },
    onCameraRead(value: typeof onCameraRead) {
      onCameraRead = value;
    },
  };
}
const status = (code: number) => (error: unknown) =>
  (error as { getStatus(): number }).getStatus() === code;

for (const change of ['logout', 'role'] as const) {
  test(`preview refuses ${change} during the final Camera read`, async () => {
    const f = await fixture();
    f.onCameraRead(async (read) => {
      if (read !== 2) return;
      if (change === 'logout') f.state.revoked = true;
      else f.state.assignedSite = cameraId;
    });
    await assert.rejects(
      f.service.read('user', siteId, cameraId),
      status(change === 'logout' ? 401 : 403),
    );
    assert.equal(f.state.upstreamCalls, 1);
    assert.equal(f.state.cameraReads, 2);
  });
}

test('preview still refuses Camera deactivation during post-fetch authorization', async () => {
  const f = await fixture();
  let checks = 0;
  f.onAuthorize(() => {
    if (++checks === 2) f.state.inactive = true;
  });
  await assert.rejects(f.service.read('user', siteId, cameraId), status(503));
});

const experimentalObjects = () => ({
  modelFamily: 'yolo11s',
  experimental: true,
  scope: 'OBJECT_DETECTION_ONLY',
  artifactId: 'experimental-unified8',
  artifactSha256: 'a'.repeat(64),
  detections: EXPERIMENTAL_OBJECT_CLASSES.map((className, classId) => ({
    classId,
    className,
    confidence: 0.8,
    boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.7, coordinateSpace: 'NORMALIZED_0_1' },
  })),
});

test('unified raw objects preserve exact source metadata separately from wearer observations', async () => {
  const { service, state, setFetch } = await fixture();
  const sourceFrame = { ...frame(), modelObjects: experimentalObjects() };
  setFetch(async () => Response.json({ sourceKind: 'REPLAY', frame: sourceFrame }));
  const result = await service.read('user', siteId, cameraId);
  assert.deepEqual(result.frame.modelObjects, sourceFrame.modelObjects);
  assert.deepEqual(result.frame.detections, []);
  assert.equal(state.authCalls, 3);
  assert.equal(result.sourceKind, 'REPLAY');
});

test('malformed raw taxonomy and secrets refuse frame; revocation still refuses valid objects', async () => {
  for (const kind of ['taxonomy', 'secret', 'revoked']) {
    const { service, state, setFetch } = await fixture();
    setFetch(async () => {
      const objects: Record<string, unknown> = experimentalObjects();
      if (kind === 'taxonomy')
        objects.detections = [{ ...experimentalObjects().detections[0], className: 'Mask' }];
      if (kind === 'secret') objects.serviceToken = 'fake-only-canary';
      if (kind === 'revoked') state.revoked = true;
      return Response.json({ sourceKind: 'LIVE', frame: { ...frame(), modelObjects: objects } });
    });
    await assert.rejects(
      service.read('user', siteId, cameraId),
      status(kind === 'revoked' ? 401 : 503),
    );
  }
});

test('operator replacing a source during fetch discards the previous producer frame', async () => {
  const { service, state, setFetch } = await fixture();
  setFetch(async () => {
    state.origin = 'http://127.0.0.1:8002';
    return Response.json({ sourceKind: 'LIVE', frame: frame() });
  });
  await assert.rejects(service.read('user', siteId, cameraId), status(503));
});

test('preview authorizes both before and after fetch; only server credentials reach configured origin', async () => {
  const { service, state, setFetch } = await fixture();
  setFetch(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8001/v1/realtime/preview/latest?cameraExternalId=camera-a');
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      'Bearer fake-service-token',
    );
    assert.equal(options.redirect, 'error');
    return Response.json({ sourceKind: 'LIVE', frame: frame() });
  });
  const result = await service.read('fake-user-token', siteId, cameraId);
  assert.equal(result.cameraId, cameraId);
  assert.equal(result.frame.cameraExternalId, 'camera-a');
  assert.equal(state.authCalls, 3);
  assert.equal(JSON.stringify(result).includes('fake-service-token'), false);
});
test('cross-site, wrong camera ownership, and inactive camera reject before contacting source', async () => {
  for (const kind of ['scope', 'ownership', 'inactive']) {
    const { service, state } = await fixture();
    if (kind === 'scope') state.assignedSite = cameraId;
    if (kind === 'ownership') state.cameraSite = cameraId;
    if (kind === 'inactive') state.inactive = true;
    await assert.rejects(
      service.read('user', siteId, cameraId),
      status(kind === 'scope' ? 403 : kind === 'ownership' ? 404 : 503),
    );
    assert.equal(state.upstreamCalls, 0);
  }
});
test('revoked session or disabled camera during fetch never releases the pending frame', async () => {
  for (const revoked of [true, false]) {
    const { service, state, setFetch } = await fixture();
    setFetch(async () => {
      if (revoked) state.revoked = true;
      else state.inactive = true;
      return Response.json({ sourceKind: 'LIVE', frame: frame() });
    });
    await assert.rejects(service.read('user', siteId, cameraId), status(revoked ? 401 : 503));
  }
});
test('wrong camera, oversized response, redirect and stale frame fail closed', async () => {
  const cases = [
    () => Response.json({ sourceKind: 'LIVE', frame: frame('camera-b') }),
    () => new Response('x'.repeat(2_000_001), { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://private.invalid/?token=fake-secret' },
      }),
    () =>
      Response.json({
        sourceKind: 'LIVE',
        frame: { ...frame(), capturedAt: '2020-01-01T00:00:00Z' },
      }),
  ];
  for (const response of cases) {
    const { service, setFetch } = await fixture();
    setFetch(async () => response());
    await assert.rejects(service.read('user', siteId, cameraId), status(503));
  }
});

test('role removal during the upstream read discards a valid frame', async () => {
  const { service, state, setFetch } = await fixture();
  setFetch(async () => {
    state.assignedSite = cameraId;
    return Response.json({ sourceKind: 'LIVE', frame: frame() });
  });
  await assert.rejects(service.read('user', siteId, cameraId), status(403));
  assert.equal(state.authCalls, 2);
});

test('a slow response body is cancelled within the upstream budget', async (t) => {
  // AbortSignal.timeout is unref'ed; the fixture has no real socket to keep Node alive.
  const fixtureDeadline = setTimeout(() => {}, 4000);
  t.after(() => clearTimeout(fixtureDeadline));
  const { service, setFetch } = await fixture();
  let cancelled = false;
  setFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const started = Date.now();
  await assert.rejects(service.read('user', siteId, cameraId), status(503));
  assert.ok(Date.now() - started < 4000);
  assert.equal(cancelled, true);
});

test('viewer abort cancels a pending body and does not release pixels', async () => {
  const { service, setFetch } = await fixture();
  const controller = new AbortController();
  let cancelled = false;
  setFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{'));
            setTimeout(() => controller.abort(), 20);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await assert.rejects(service.read('user', siteId, cameraId, controller.signal), status(503));
  assert.equal(cancelled, true);
});

test('rejecting response headers cancels unread upstream bodies', async () => {
  const invalidHeaders: HeadersInit[] = [
    { 'Content-Type': 'text/html' },
    { 'Content-Type': 'application/json', 'Content-Length': '2000001' },
  ];
  for (const headers of invalidHeaders) {
    const { service, setFetch } = await fixture();
    let cancelled = false;
    setFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers },
        ),
    );
    await assert.rejects(service.read('user', siteId, cameraId), status(503));
    assert.equal(cancelled, true);
  }
});

test('freshness is checked again after authorization completes', async (t) => {
  const base = Date.now();
  let clock = base;
  t.mock.method(Date, 'now', () => clock);
  const { service, state, onAuthorize, setFetch } = await fixture();
  onAuthorize(() => {
    if (state.authCalls === 2) clock = base + 6000;
  });
  setFetch(async () =>
    Response.json({
      sourceKind: 'LIVE',
      frame: { ...frame(), capturedAt: new Date(base).toISOString() },
    }),
  );
  await assert.rejects(service.read('user', siteId, cameraId), status(503));
});
