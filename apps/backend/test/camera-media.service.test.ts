import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CameraPreviewService } from '../src/modules/cameras/camera-preview.service.js';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const raw = (sequence = '1') => ({
  type: 'media-frame',
  mediaVersion: 1,
  cameraExternalId: 'cam',
  sessionId: siteId,
  sequenceNumber: sequence,
  capturedAt: new Date().toISOString(),
  width: 640,
  height: 360,
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
});
function fixture(values: unknown[] = [raw(), raw('2')]) {
  const state = {
    revoked: false,
    inactive: false,
    assignedSite: siteId,
    calls: 0,
    cameraReads: 0,
    origin: 'http://127.0.0.1:8001',
    cancelled: false,
    upstreamSignal: null as AbortSignal | null,
  };
  let onCameraRead: (read: number) => Promise<void> = async () => {};
  let onAuthorize = () => {};
  const auth = {
    async authenticate() {
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
  const camera = {
    async get() {
      await onCameraRead(++state.cameraReads);
      return {
        id: cameraId,
        siteId,
        externalId: 'cam',
        status: state.inactive ? 'INACTIVE' : 'ACTIVE',
      };
    },
  };
  const config = {
    get(key: string) {
      return key === 'SMARTSITE_AI_PREVIEW_SOURCES' ? { cam: state.origin } : 'fake-token';
    },
  };
  const service = new CameraPreviewService(
    config as never,
    auth as never,
    camera as never,
    async (url, options) => {
      state.calls++;
      state.upstreamSignal = options?.signal ?? null;
      assert.equal(new URL(String(url)).pathname, '/v1/realtime/video-stream');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer fake-token');
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (sent) {
              controller.close();
              return;
            }
            sent = true;
            controller.enqueue(
              new TextEncoder().encode(values.map((v) => JSON.stringify(v)).join('\n') + '\n'),
            );
          },
          cancel() {
            state.cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    },
  );
  const video = () => {
    const method = (
      service as unknown as {
        video?: (token: string, site: string, camera: string) => AsyncGenerator;
      }
    ).video;
    assert.equal(typeof method, 'function', 'Authenticated independent media relay is missing');
    return method!.call(service, 'fake-user-token', siteId, cameraId);
  };
  return {
    state,
    video,
    service,
    onCameraRead(value: typeof onCameraRead) {
      onCameraRead = value;
    },
    onAuthorize(value: typeof onAuthorize) {
      onAuthorize = value;
    },
  };
}
const status = (code: number) => (error: unknown) =>
  (error as { getStatus(): number }).getStatus() === code;

for (const change of ['logout', 'role'] as const) {
  test(`buffered raw media refuses ${change} during final Camera read`, async (t) => {
    const f = fixture();
    const stream = f.video();
    t.after(() => stream.return(undefined));
    assert.equal((await stream.next()).value.sequenceNumber, '1');
    f.onCameraRead(async (read) => {
      if (read !== 3) return;
      if (change === 'logout') f.state.revoked = true;
      else f.state.assignedSite = cameraId;
    });
    await assert.rejects(stream.next(), status(change === 'logout' ? 401 : 403));
    assert.equal(f.state.calls, 1, 'the second frame was buffered in the same upstream response');
    assert.equal(f.state.upstreamSignal?.aborted, true);
  });
}
test('raw media still refuses Camera deactivation during frame authorization', async (t) => {
  const f = fixture();
  const stream = f.video();
  t.after(() => stream.return(undefined));
  let checks = 0;
  f.onAuthorize(() => {
    if (++checks === 2) f.state.inactive = true;
  });
  await assert.rejects(stream.next(), status(503));
});

test('media relay emits strictly scoped raw frames independently of AI preview', async () => {
  const f = fixture();
  const stream = f.video();
  assert.equal((await stream.next()).value.sequenceNumber, '1');
  assert.equal((await stream.next()).value.sequenceNumber, '2');
  assert.equal((await stream.next()).done, true);
  assert.equal(f.state.calls, 1);
});

test('Nest application shutdown aborts active media relays and refuses new viewers', async (t) => {
  const f = fixture();
  const app = await NestFactory.createApplicationContext(
    {
      module: class MediaShutdownFixture {},
      providers: [{ provide: CameraPreviewService, useValue: f.service }],
    },
    { logger: false },
  );
  const stream = f.video();
  t.after(async () => {
    await stream.return(undefined);
    await app.close();
  });
  assert.equal((await stream.next()).value.sequenceNumber, '1');
  assert.equal(f.state.upstreamSignal?.aborted, false);
  await app.close();
  assert.equal(
    f.state.upstreamSignal?.aborted,
    true,
    'Closing Nest must abort the producer request',
  );
  await assert.rejects(stream.next(), status(503));
  await assert.rejects(f.video().next(), status(503));
  assert.equal(f.state.calls, 1, 'Shutdown must reject new viewers before contacting the producer');
});
test('media relay denies cross-site before contacting a producer', async () => {
  const f = fixture();
  f.state.assignedSite = cameraId;
  await assert.rejects(f.video().next(), status(403));
  assert.equal(f.state.calls, 0);
});
test('logout revocation prevents the next raw frame', async () => {
  const f = fixture();
  const stream = f.video();
  await stream.next();
  f.state.revoked = true;
  await assert.rejects(stream.next(), status(401));
});
test('deactivation and source reassignment prevent the next raw frame', async () => {
  for (const change of ['inactive', 'origin']) {
    const f = fixture();
    const stream = f.video();
    await stream.next();
    if (change === 'inactive') f.state.inactive = true;
    else f.state.origin = 'http://127.0.0.1:9000';
    await assert.rejects(stream.next(), status(503));
  }
});
test('wrong camera, stale pixels and AI metadata fail closed', async () => {
  for (const invalid of [
    { ...raw(), cameraExternalId: 'other' },
    { ...raw(), capturedAt: '2020-01-01T00:00:00Z' },
    { ...raw(), detections: [] },
    { ...raw(), imageDataUrl: 'A'.repeat(300000) },
  ]) {
    const f = fixture([invalid]);
    await assert.rejects(f.video().next(), status(503));
  }
});
