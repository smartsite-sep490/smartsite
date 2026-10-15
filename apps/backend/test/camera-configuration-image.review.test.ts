import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fixture,
  siteId,
  cameraId,
  otherId,
  status,
  buildSourcePayload,
  baseNowMs,
} from './support/camera-configuration-image-fixture.js';
import { fetchConfigurationImageJson } from '../src/modules/cameras/camera-configuration-image.transport.js';
import { CameraConfigurationImageService } from '../src/modules/cameras/camera-configuration-image.service.js';
import { createTestConfig } from './support/config.js';

test('revocation during the FIRST camera lookup outranks missing/unavailable source and performs no upstream read', async () => {
  for (const failure of ['scope', 'inactive', 'unmapped', 'none'] as const) {
    for (const authFailure of ['logout', 'role'] as const) {
      const f = await fixture();
      f.onCameraRead((read) => {
        if (read !== 1) return;
        if (authFailure === 'logout') f.state.revoked = true;
        else f.state.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId }];
        if (failure === 'scope') f.state.cameraSite = otherId;
        if (failure === 'inactive') f.state.inactive = true;
        if (failure === 'unmapped') f.state.unmappedSource = true;
      });
      await assert.rejects(
        f.service.read('token', siteId, cameraId),
        status(authFailure === 'logout' ? 401 : 403),
      );
      assert.equal(f.state.upstreamCalls, 0);
    }
  }
});

test('shutdown still prioritizes authentication and role refusal over availability', async () => {
  for (const authFailure of ['logout', 'role'] as const) {
    const f = await fixture();
    f.service.onModuleDestroy();
    if (authFailure === 'logout') f.state.revoked = true;
    else f.state.roleAssignments = [{ role: 'SITE_MANAGER', siteId }];
    await assert.rejects(
      f.service.read('token', siteId, cameraId),
      status(authFailure === 'logout' ? 401 : 403),
    );
    assert.equal(f.state.upstreamCalls, 0);
  }
});

test('aborting while camera revision changes never returns pixels or a misleading retryable conflict', async () => {
  const f = await fixture();
  const caller = new AbortController();
  f.onCameraRead((read) => {
    if (read === 2) {
      f.state.configurationVersion++;
      caller.abort();
    }
  });
  await assert.rejects(f.service.read('token', siteId, cameraId, caller.signal), status(503));
});

test('chunked oversized JSON cancels before reading the remaining payload', async () => {
  const f = await fixture();
  let pulls = 0;
  let cancelled = false;
  f.setFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(800_000));
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await assert.rejects(f.service.read('token', siteId, cameraId), status(503));
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
});

test('an already-aborted late response is canceled even if fetch ignores cancellation', async () => {
  const controller = new AbortController();
  let release!: (response: Response) => void;
  let cancelled = false;
  const fetcher = (() =>
    new Promise<Response>((resolve) => {
      release = resolve;
    })) as typeof fetch;
  const pending = fetchConfigurationImageJson(fetcher, 'http://127.0.0.1:1', {
    signal: controller.signal,
  });
  const rejected = assert.rejects(pending);
  controller.abort();
  await rejected;
  release(
    new Response(
      new ReadableStream(
        {
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('transport handles synchronous fetch failure during abort without an unhandled rejection', async () => {
  const controller = new AbortController();
  const fetcher = (() => {
    controller.abort();
    throw new Error('private-sentinel');
  }) as typeof fetch;
  await assert.rejects(
    fetchConfigurationImageJson(fetcher, 'http://127.0.0.1:1', { signal: controller.signal }),
  );
  await new Promise((resolve) => setImmediate(resolve));
});

test('four distinct camera reads may proceed; the fifth is refused and admission recovers', async () => {
  const ids = [1, 2, 3, 4, 5].map(
    (number) => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`,
  );
  const records = ids.map((id, i) => ({
    id,
    siteId,
    status: 'ACTIVE',
    externalId: `camera-${i}`,
    configurationVersion: 4,
  }));
  const config = createTestConfig({
    SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify(
      Object.fromEntries(records.map((c) => [c.externalId, 'http://127.0.0.1:8001'])),
    ),
  });
  const auth = {
    async authenticate() {
      return {
        user: {
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [{ role: 'ADMIN', siteId: null }],
        },
      };
    },
  };
  const cameras = {
    async get(_site: string, id: string) {
      return records.find((c) => c.id === id)!;
    },
  };
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fourEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const fetcher = (async (input: string | URL | Request) => {
    if (++reads === 4) entered();
    await gate;
    const externalId = new URL(String(input)).searchParams.get('cameraExternalId')!;
    return Response.json(buildSourcePayload({ frame: { cameraExternalId: externalId } }));
  }) as typeof fetch;
  const service = new CameraConfigurationImageService(
    config,
    auth as never,
    cameras as never,
    fetcher,
    () => baseNowMs,
  );
  const active = Promise.all(ids.slice(0, 4).map((id) => service.read('token', siteId, id)));
  await fourEntered;
  await assert.rejects(service.read('token', siteId, ids[4]!), status(429));
  assert.equal(reads, 4);
  release();
  assert.equal((await active).length, 4);
  await service.read('token', siteId, ids[4]!);
  assert.equal(reads, 5);
});
