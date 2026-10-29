import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  parseCameraConfigurationImageResponse,
} from '@smartsite/contracts/camera-configuration-image';
import {
  siteId,
  cameraId,
  otherId,
  baseNowMs,
  jpegSha256,
  buildSourcePayload,
  fixture,
  status,
} from './support/camera-configuration-image-fixture.js';

test('configuration image independently serves verified LIVE and REPLAY references with bounded expiry', async () => {
  for (const sourceKind of ['LIVE', 'REPLAY'] as const) {
    const f = await fixture();
    const capturedAt = new Date(f.state.now - 400).toISOString();
    f.setFetch(async (url, options) => {
      assert.equal(
        url,
        'http://127.0.0.1:8001/v1/realtime/configuration-image?cameraExternalId=camera-a',
      );
      assert.equal(
        (options.headers as Record<string, string>).Authorization,
        'Bearer fake-service-token',
      );
      assert.equal((options.headers as Record<string, string>).Accept, 'application/json');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(buildSourcePayload({ sourceKind, capturedAt }));
    });

    const result = await f.service.read('admin-user-token', siteId, cameraId);
    assert.deepEqual(parseCameraConfigurationImageResponse(result), result);
    assert.equal(result.siteId, siteId);
    assert.equal(result.cameraId, cameraId);
    assert.equal(result.configurationVersion, 4);
    assert.equal(result.purpose, 'REGION_CONFIGURATION');
    assert.equal(result.sourceKind, sourceKind);
    assert.equal(result.frame.cameraExternalId, 'camera-a');
    assert.equal(result.frame.imageSha256, jpegSha256);

    const expiresMs = Date.parse(result.referenceExpiresAt);
    const capturedMs = Date.parse(capturedAt);
    assert.ok(expiresMs > f.state.now);
    assert.ok(expiresMs <= capturedMs + CONFIGURATION_REFERENCE_LIFETIME_MS);
    assert.ok(expiresMs <= f.state.now + CONFIGURATION_REFERENCE_LIFETIME_MS);
    assert.ok(f.state.authCalls >= 2);
    assert.equal(f.state.cameraReads, 2);
    assert.equal(JSON.stringify(result).includes('fake-service-token'), false);
  }
});

test('out-of-scope roles, password-change-required, inactive user, wrong camera, inactive camera and unmapped source fail before fetch', async () => {
  const roleCases: Array<{
    mutate: (s: Awaited<ReturnType<typeof fixture>>['state']) => void;
    expected: number;
  }> = [
    { mutate: (s) => (s.revoked = true), expected: 401 },
    {
      mutate: (s) => (s.roleAssignments = [{ role: 'SITE_MANAGER', siteId: otherId }]),
      expected: 403,
    },
    {
      mutate: (s) => (s.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: otherId }]),
      expected: 403,
    },
    { mutate: (s) => (s.roleAssignments = [{ role: 'WORKER', siteId }]), expected: 403 },
    {
      mutate: (s) => (s.roleAssignments = [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId }]),
      expected: 403,
    },
    { mutate: (s) => (s.roleAssignments = [{ role: 'ADMIN', siteId }]), expected: 403 },
    { mutate: (s) => (s.mustChangePassword = true), expected: 403 },
    { mutate: (s) => (s.userActive = false), expected: 403 },
    { mutate: (s) => (s.cameraSite = otherId), expected: 404 },
    { mutate: (s) => (s.cameraEntityId = otherId), expected: 404 },
    { mutate: (s) => (s.inactive = true), expected: 503 },
    { mutate: (s) => (s.unmappedSource = true), expected: 503 },
  ];

  for (const tc of roleCases) {
    const f = await fixture();
    tc.mutate(f.state);
    await assert.rejects(f.service.read('token', siteId, cameraId), status(tc.expected));
    assert.equal(f.state.upstreamCalls, 0);
  }
});

test('Main scoped Manager and Safety can read a reference without changing configuration', async () => {
  for (const role of ['SITE_MANAGER', 'SAFETY_OFFICER']) {
    const f = await fixture();
    f.state.roleAssignments = [{ role, siteId }];
    const result = await f.service.read('synthetic-scoped-reader', siteId, cameraId);
    assert.equal(result.siteId, siteId);
    assert.equal(result.configurationVersion, 4);
    assert.equal(f.state.configurationVersion, 4);
    assert.ok(f.state.authCalls >= 2);
  }
});

test('held upstream read and final camera read refuse mid-flight logout (401) or role loss (403) without releasing pixels', async () => {
  for (const kind of ['logout', 'role'] as const) {
    const f = await fixture();
    let releaseFetch!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let enteredFetch!: () => void;
    const startedFetch = new Promise<void>((resolve) => {
      enteredFetch = resolve;
    });
    f.setFetch(async () => {
      enteredFetch();
      await held;
      return Response.json(buildSourcePayload());
    });

    const pending = f.service.read('token', siteId, cameraId);
    await startedFetch;
    if (kind === 'logout') f.state.revoked = true;
    else f.state.roleAssignments = [{ role: 'WORKER', siteId }];
    releaseFetch();

    await assert.rejects(pending, status(kind === 'logout' ? 401 : 403));
  }

  for (const kind of ['logout', 'role'] as const) {
    const f = await fixture();
    f.onCameraRead(async (read) => {
      if (read !== 2) return;
      if (kind === 'logout') f.state.revoked = true;
      else f.state.roleAssignments = [{ role: 'ADMIN', siteId }];
    });
    await assert.rejects(
      f.service.read('token', siteId, cameraId),
      status(kind === 'logout' ? 401 : 403),
    );
    assert.equal(f.state.upstreamCalls, 1);
    assert.equal(f.state.cameraReads, 2);
  }
});

test('revoked session (401) and role loss (403) take priority over upstream failure (503) and camera revision conflict (409)', async () => {
  for (const authFailure of ['revoked', 'forbidden'] as const) {
    for (const competingFailure of ['upstream503', 'revision409'] as const) {
      const f = await fixture();
      f.setFetch(async () => {
        if (authFailure === 'revoked') f.state.revoked = true;
        else f.state.roleAssignments = [{ role: 'SITE_MANAGER', siteId: otherId }];
        if (competingFailure === 'revision409') f.state.configurationVersion = 5;
        if (competingFailure === 'upstream503') {
          return new Response('private-sentinel', { status: 503 });
        }
        return Response.json(buildSourcePayload());
      });
      await assert.rejects(
        f.service.read('token', siteId, cameraId),
        status(authFailure === 'revoked' ? 401 : 403),
      );
    }
  }
});

test('concurrent camera revision change returns 409; mid-flight camera deactivation, externalId change or source remap returns 503', async () => {
  const fRevision = await fixture();
  fRevision.onCameraRead((read) => {
    if (read === 2) fRevision.state.configurationVersion = 5;
  });
  await assert.rejects(fRevision.service.read('token', siteId, cameraId), status(409));

  const midFlightMutations: Array<(s: Awaited<ReturnType<typeof fixture>>['state']) => void> = [
    (s) => (s.inactive = true),
    (s) => (s.cameraExternalId = 'camera-b'),
    (s) => (s.origin = 'http://127.0.0.1:8002'),
    (s) => (s.unmappedSource = true),
  ];
  for (const mutate of midFlightMutations) {
    const f = await fixture();
    f.setFetch(async () => {
      mutate(f.state);
      return Response.json(buildSourcePayload());
    });
    await assert.rejects(f.service.read('token', siteId, cameraId), status(503));
  }
});

test('rejects invalid headers, oversized/malformed JSON, contract/JPEG/SHA mismatches and stale clocks with safe 503', async () => {
  for (const headers of [
    { 'Content-Type': 'text/html' },
    { 'Content-Type': 'application/json', 'Content-Length': '1500001' },
  ] as HeadersInit[]) {
    const f = await fixture();
    let cancelled = false;
    f.setFetch(
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
    await assert.rejects(f.service.read('token', siteId, cameraId), status(503));
    assert.equal(cancelled, true);
  }

  const badResponses: Array<() => Response> = [
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1:9999/?secret=secret-canary' },
      }),
    () => new Response('x'.repeat(1_500_001), { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response('{bad-json-private-sentinel', {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => Response.json(buildSourcePayload({ extra: { purpose: 'AI_EVIDENCE' } })),
    () => Response.json(buildSourcePayload({ extra: { detections: [] } })),
    () => Response.json(buildSourcePayload({ extra: { sourceUrl: 'rtsp://private-sentinel' } })),
    () => Response.json(buildSourcePayload({ frame: { cameraExternalId: 'camera-b' } })),
    () => Response.json(buildSourcePayload({ frame: { width: 121 } })),
    () => Response.json(buildSourcePayload({ frame: { height: 63 } })),
    () => Response.json(buildSourcePayload({ frame: { height: 1281 } })),
    () =>
      Response.json(
        buildSourcePayload({
          frame: {
            imageDataUrl: `data:image/jpeg;base64,${Buffer.alloc(1_048_577).toString('base64')}`,
          },
        }),
      ),
    () => Response.json(buildSourcePayload({ frame: { imageSha256: 'a'.repeat(64) } })),
    () =>
      Response.json(buildSourcePayload({ capturedAt: new Date(baseNowMs - 2_500).toISOString() })),
    () =>
      Response.json(buildSourcePayload({ capturedAt: new Date(baseNowMs + 1_500).toISOString() })),
  ];

  for (const makeResponse of badResponses) {
    const f = await fixture();
    f.setFetch(async () => makeResponse());
    await assert.rejects(f.service.read('token', siteId, cameraId), status(503));
  }

  // Fresh on arrival, but clock advances past 2s freshness window during post-fetch re-auth
  const fLate = await fixture();
  fLate.onAuthorize(() => {
    if (fLate.state.upstreamCalls > 0) fLate.state.now = baseNowMs + 2_500;
  });
  await assert.rejects(fLate.service.read('token', siteId, cameraId), status(503));
});

test('caller abort, upstream 2s deadline and onModuleDestroy cancel stalled streams and bound concurrency (429)', async (t) => {
  const keepAlive = setTimeout(() => {}, 4000);
  t.after(() => clearTimeout(keepAlive));

  // 1. Caller abort cancels stalled body reader
  const fAbort = await fixture();
  const callerController = new AbortController();
  let abortCancelled = false;
  fAbort.setFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{'));
            setTimeout(() => callerController.abort(), 20);
          },
          cancel() {
            abortCancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await assert.rejects(
    fAbort.service.read('token', siteId, cameraId, callerController.signal),
    status(503),
  );
  assert.equal(abortCancelled, true);

  // 2. Default 2s upstream deadline cancels stalled body reader
  const fDeadline = await fixture();
  let deadlineCancelled = false;
  fDeadline.setFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{'));
          },
          cancel() {
            deadlineCancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const started = Date.now();
  await assert.rejects(fDeadline.service.read('token', siteId, cameraId), status(503));
  assert.ok(Date.now() - started < 4000);
  assert.equal(deadlineCancelled, true);

  // 3. Concurrent admission limit rejects excess in-flight reads with 429 and recovers after release
  const fAdmission = await fixture();
  let releaseAdmission!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  fAdmission.setFetch(async () => {
    await gate;
    return Response.json(buildSourcePayload());
  });
  const concurrent = Array.from({ length: 5 }, () =>
    fAdmission.service.read('token', siteId, cameraId),
  );
  const settled = Promise.allSettled(concurrent);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseAdmission();
  const outcomes = await settled;
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected' && status(429)(o.reason)).length, 4);
  await fAdmission.service.read('token', siteId, cameraId);

  // 4. onModuleDestroy aborts active reads and refuses subsequent reads with 503
  const fDestroy = await fixture();
  let destroyAborted = false;
  fDestroy.setFetch(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => {
            destroyAborted = true;
            reject(new Error('aborted by destroy'));
          },
          { once: true },
        );
      }),
  );
  const inFlight = fDestroy.service.read('token', siteId, cameraId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  fDestroy.service.onModuleDestroy();
  await assert.rejects(inFlight, status(503));
  assert.equal(destroyAborted, true);
  await assert.rejects(fDestroy.service.read('token', siteId, cameraId), status(503));
});
