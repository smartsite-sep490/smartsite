import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { CameraStatus } from '../src/database/entities/enums.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import type { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraBrowserUplinkService } from '../src/modules/cameras/camera-browser-uplink.service.js';
import { readBoundedJpegBody } from '../src/modules/cameras/camera-browser-uplink.controller.js';
import { CameraSourceService } from '../src/modules/cameras/camera-source.service.js';
import { CameraPreviewService } from '../src/modules/cameras/camera-preview.service.js';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

/** Build a structurally valid minimal JPEG with real SOI, SOF0(width, height), SOS, and EOI markers. */
function makeValidJpeg(width: number, height: number, fillByte = 0x22): Buffer {
  const sofPayload = Buffer.from([
    0x00,
    0x0b, // length = 11
    0x08, // 8-bit precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01, // 1 component
    0x01,
    0x11,
    0x00,
  ]);
  const sosPayload = Buffer.from([0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scanData = Buffer.alloc(16, fillByte);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xc0]), // SOF0
    sofPayload,
    Buffer.from([0xff, 0xda]), // SOS
    sosPayload,
    scanData,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

const SAMPLE_JPEG = makeValidJpeg(640, 480);

function buildUplinkFixture(options: {
  enabled?: boolean;
  role?: UserRole;
  assignedSiteId?: string | null;
  cameraStatus?: CameraStatus;
  cameraType?: 'ZONE' | 'GATE';
  nowMs?: () => number;
  dbRows?: unknown[];
  previewSources?: Record<string, string>;
  physicalWorkerBound?: boolean;
  advisoryLockAcquired?: boolean;
}) {
  const queries: string[] = [];
  let lockReleased = false;
  let runnerReleased = false;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    BROWSER_CAMERA_UPLINK_ENABLED: options.enabled ?? false,
    SMARTSITE_AI_PREVIEW_SOURCES: options.previewSources ?? {},
  } as unknown as BackendEnvironment);

  const auth = {
    authenticate: async () => ({
      sessionId: randomUUID(),
      clientType: 'WEB',
      user: {
        id: USER_ID,
        username: 'manager',
        displayName: 'Site Manager',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [
          {
            role: options.role ?? UserRole.SITE_MANAGER,
            siteId: options.assignedSiteId === undefined ? SITE_A : options.assignedSiteId,
          },
        ],
      },
    }),
  } as unknown as AuthService;

  const cameras = {
    get: async () => ({
      id: CAMERA_ID,
      siteId: SITE_A,
      externalId: 'cam-browser-01',
      type: options.cameraType ?? 'ZONE',
      status: options.cameraStatus ?? CameraStatus.ACTIVE,
      code: 'CAM-B1',
      name: 'Browser Cam 1',
      configurationVersion: 2,
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
    }),
  } as unknown as CameraConfigurationService;

  const runSql = async (sql: string) => {
    queries.push(sql);
    if (sql.includes('pg_try_advisory_lock_shared')) {
      return [{ acquired: options.advisoryLockAcquired ?? true }];
    }
    if (sql.includes('pg_advisory_unlock_shared')) {
      lockReleased = true;
      return [{ pg_advisory_unlock_shared: true }];
    }
    if (sql.includes('FROM camera WHERE id = $1 AND site_id = $2 FOR UPDATE')) {
      return [
        {
          id: CAMERA_ID,
          status: options.cameraStatus ?? CameraStatus.ACTIVE,
          type: options.cameraType ?? 'ZONE',
          external_id: 'cam-browser-01',
        },
      ];
    }
    if (sql.includes('FROM camera_worker_generation') && sql.includes('AS bound')) {
      return [{ bound: options.physicalWorkerBound ?? false }];
    }
    return options.dbRows ?? [];
  };

  const db = {
    query: runSql,
    createQueryRunner: () => ({
      connect: async () => {},
      startTransaction: async () => {},
      commitTransaction: async () => {},
      rollbackTransaction: async () => {},
      release: async () => {
        runnerReleased = true;
      },
      query: runSql,
    }),
  } as unknown as DataSource;

  const service = new CameraBrowserUplinkService(
    config,
    auth,
    cameras,
    db,
    options.nowMs ?? (() => Date.parse('2026-11-26T12:00:00.000Z')),
  );

  return {
    service,
    queries,
    lockState: () => ({ lockReleased, runnerReleased }),
  };
}

test('BROWSER_CAMERA_UPLINK_ENABLED defaults to false and parses explicit boolean strings', () => {
  assert.equal(validateEnvironment({ NODE_ENV: 'test' }).BROWSER_CAMERA_UPLINK_ENABLED, false);
  assert.equal(
    validateEnvironment({ NODE_ENV: 'test', BROWSER_CAMERA_UPLINK_ENABLED: 'false' })
      .BROWSER_CAMERA_UPLINK_ENABLED,
    false,
  );
  assert.equal(
    validateEnvironment({ NODE_ENV: 'test', BROWSER_CAMERA_UPLINK_ENABLED: 'true' })
      .BROWSER_CAMERA_UPLINK_ENABLED,
    true,
  );
  assert.throws(() =>
    validateEnvironment({ NODE_ENV: 'test', BROWSER_CAMERA_UPLINK_ENABLED: 'yes' }),
  );
});

test('flag OFF keeps status supported=false and fails closed with 501 UNSUPPORTED_CAPABILITY on mutations without touching DB', async () => {
  const { service, queries } = buildUplinkFixture({ enabled: false });
  const status = await service.status('tok', SITE_A, CAMERA_ID);
  assert.equal(status.supported, false);
  assert.equal(status.state, 'IDLE');
  assert.equal(queries.length, 0);

  const is501 = (err: unknown) =>
    err instanceof PublicHttpException &&
    err.getStatus() === 501 &&
    err.publicPayload.code === 'UNSUPPORTED_CAPABILITY';

  await assert.rejects(
    service.start('tok', SITE_A, CAMERA_ID, { clientSessionId: 'tab-1' }),
    is501,
  );
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      {
        contentType: 'image/jpeg',
        leaseId: LEASE_ID,
        sequence: '1',
        capturedAt: '2026-11-26T12:00:00.000Z',
        width: '640',
        height: '480',
      },
      SAMPLE_JPEG,
    ),
    is501,
  );
  await assert.rejects(service.stop('tok', SITE_A, CAMERA_ID, { leaseId: LEASE_ID }), is501);
  assert.equal(await service.readFreshFrame(SITE_A, CAMERA_ID), null);
  assert.equal(queries.length, 0);
});

test('global Admin, foreign-site Manager, and Safety Officer are denied write mutations (fail-closed scope)', async () => {
  for (const [role, assignedSiteId] of [
    [UserRole.ADMIN, null],
    [UserRole.SITE_MANAGER, SITE_B],
    [UserRole.SAFETY_OFFICER, SITE_A],
    [UserRole.SAFETY_OFFICER, SITE_B],
  ] as const) {
    const { service, queries } = buildUplinkFixture({ enabled: true, role, assignedSiteId });
    await assert.rejects(
      service.start('tok', SITE_A, CAMERA_ID, { clientSessionId: 'tab-1' }),
      (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 403,
    );
    assert.equal(queries.length, 0);
  }
});

test('uploadFrame validates real JPEG SOF dimensions against declared headers & bounds, plus MIME/size/freshness before DB write', async () => {
  const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  const { service, queries } = buildUplinkFixture({ enabled: true, nowMs: () => nowMs });

  const baseHeaders = {
    contentType: 'image/jpeg',
    leaseId: LEASE_ID,
    sequence: '1',
    capturedAt: '2026-11-26T12:00:00.000Z',
    width: '640',
    height: '480',
  };

  // Wrong Content-Type
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      { ...baseHeaders, contentType: 'image/png' },
      SAMPLE_JPEG,
    ),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 415 &&
      err.publicPayload.code === 'INVALID_MEDIA_TYPE',
  );

  // Non-JPEG magic bytes
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      baseHeaders,
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 415 &&
      err.publicPayload.code === 'INVALID_MEDIA_TYPE',
  );

  // Malformed / truncated JPEG (has FF D8 FF prefix but missing SOF and EOI)
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      baseHeaders,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    ),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 415 &&
      err.publicPayload.code === 'INVALID_MEDIA_TYPE',
  );

  // Dimension mismatch: actual JPEG SOF is 320x240 while headers declare 640x480
  await assert.rejects(
    service.uploadFrame('tok', SITE_A, CAMERA_ID, baseHeaders, makeValidJpeg(320, 240)),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 415 &&
      err.publicPayload.code === 'INVALID_MEDIA_TYPE',
  );

  // Actual JPEG SOF exceeds server 640x480 bound (declared 1280x720)
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      { ...baseHeaders, width: '1280', height: '720' },
      makeValidJpeg(1280, 720),
    ),
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 400,
  );

  // Oversized payload > 130_000 bytes
  const oversized = Buffer.alloc(130_001);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  oversized[2] = 0xff;
  await assert.rejects(
    service.uploadFrame('tok', SITE_A, CAMERA_ID, baseHeaders, oversized),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 413 &&
      err.publicPayload.code === 'FRAME_TOO_LARGE',
  );

  // Stale capturedAt >= 2000ms
  await assert.rejects(
    service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      { ...baseHeaders, capturedAt: '2026-11-26T11:59:58.000Z' },
      SAMPLE_JPEG,
    ),
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 400 &&
      err.publicPayload.code === 'FRAME_STALE',
  );

  assert.equal(queries.length, 0);
});

test('readFreshFrame rejects stored rows with malformed or dimension-mismatched JPEG markers before serving', async () => {
  const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  const { service } = buildUplinkFixture({
    enabled: true,
    nowMs: () => nowMs,
    dbRows: [
      {
        lease_id: LEASE_ID,
        sequence: 1,
        width: 640,
        height: 480,
        captured_at: new Date(nowMs - 100),
        jpeg_bytes: makeValidJpeg(320, 240), // mismatch vs stored 640x480
      },
    ],
  });
  assert.equal(await service.readFreshFrame(SITE_A, CAMERA_ID), null);
});

test('readBoundedJpegBody handles aborted and premature close streams promptly with full listener cleanup', async () => {
  function makeStreamRequest(headers: Record<string, string>) {
    const emitter = new EventEmitter() as EventEmitter & {
      headers: Record<string, string>;
      body: undefined;
      complete: boolean;
      destroyed: boolean;
      pause: () => void;
    };
    emitter.headers = headers;
    emitter.body = undefined;
    emitter.complete = false;
    emitter.destroyed = false;
    emitter.pause = () => {};
    return emitter;
  }

  // Case 1: client emits aborted mid-upload
  const reqAborted = makeStreamRequest({ 'content-type': 'image/jpeg' });
  const abortedPromise = readBoundedJpegBody(reqAborted as unknown as Request, 130_000);
  reqAborted.emit('data', Buffer.from([0xff, 0xd8]));
  reqAborted.emit('aborted');
  await assert.rejects(
    abortedPromise,
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 400,
  );
  for (const evt of ['data', 'end', 'error', 'aborted', 'close']) {
    assert.equal(reqAborted.listenerCount(evt), 0, `leaked listener on ${evt}`);
  }

  // Case 2: socket closes before request.complete === true
  const reqClosed = makeStreamRequest({ 'content-type': 'image/jpeg' });
  const closedPromise = readBoundedJpegBody(reqClosed as unknown as Request, 130_000);
  reqClosed.emit('data', Buffer.from([0xff, 0xd8]));
  reqClosed.emit('close');
  await assert.rejects(
    closedPromise,
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 400,
  );
  for (const evt of ['data', 'end', 'error', 'aborted', 'close']) {
    assert.equal(reqClosed.listenerCount(evt), 0, `leaked listener on ${evt}`);
  }

  // Case 3: oversize mid-stream pauses and cleans all listeners
  const reqLarge = makeStreamRequest({ 'content-type': 'image/jpeg' });
  const largePromise = readBoundedJpegBody(reqLarge as unknown as Request, 16);
  reqLarge.emit('data', Buffer.alloc(20, 0xff));
  await assert.rejects(
    largePromise,
    (err: unknown) =>
      err instanceof PublicHttpException &&
      err.getStatus() === 413 &&
      err.publicPayload.code === 'FRAME_TOO_LARGE',
  );
  for (const evt of ['data', 'end', 'error', 'aborted', 'close']) {
    assert.equal(reqLarge.listenerCount(evt), 0, `leaked listener on ${evt}`);
  }
});

test('CameraSourceService keeps physical host browserCameraSupported=false while browser-uplink status discovers availability independently with zero hosts', async () => {
  const hostCaps = {
    schemaVersion: '1.0.0',
    hostId: 'edge',
    label: 'Edge Host',
    sourceKinds: ['WEBCAM'],
    webcams: [{ id: 'usb0', label: 'USB 0' }],
    videos: [],
    browserCameraSupported: false,
    applySupported: false,
  };
  const auth = {
    authenticate: async () => ({
      user: {
        mustChangePassword: false,
        roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: SITE_A }],
      },
    }),
  } as unknown as AuthService;
  const cameras = {
    get: async () => ({ id: CAMERA_ID, siteId: SITE_A, externalId: 'cam-1', type: 'ZONE' }),
  } as unknown as CameraConfigurationService;
  const fetcher = (async () => Response.json(hostCaps)) as typeof fetch;

  // Physical host capabilities always reflect physical AI host truth (never conflated with browser preview)
  for (const enabled of [false, true]) {
    const config = new ConfigService<BackendEnvironment, true>({
      NODE_ENV: 'test',
      SMARTSITE_AI_SERVICE_TOKEN: 'server-only-token',
      SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
        { id: 'edge', label: 'Edge Host', siteIds: [SITE_A], origin: 'http://127.0.0.1:62035' },
      ]),
      BROWSER_CAMERA_UPLINK_ENABLED: enabled,
    } as unknown as BackendEnvironment);
    const service = new CameraSourceService(config, auth, cameras, fetcher);
    const result = await service.list('tok', SITE_A, CAMERA_ID);
    assert.equal(result.hosts[0]?.available, true);
    assert.equal(result.hosts[0]?.capabilities?.browserCameraSupported, false);
  }

  // Zero physical hosts: source-hosts returns [], while scoped browser-uplink/status reports supported=true for both Manager & Officer
  const zeroHostConfig = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    SMARTSITE_AI_SERVICE_TOKEN: 'server-only-token',
    SMARTSITE_AI_SOURCE_HOSTS: '[]',
    BROWSER_CAMERA_UPLINK_ENABLED: true,
  } as unknown as BackendEnvironment);
  const zeroHostSource = new CameraSourceService(zeroHostConfig, auth, cameras, fetcher);
  assert.deepEqual(await zeroHostSource.list('tok', SITE_A, CAMERA_ID), { hosts: [] });

  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER]) {
    const { service } = buildUplinkFixture({ enabled: true, role });
    const status = await service.status('tok', SITE_A, CAMERA_ID);
    assert.equal(status.supported, true);
    assert.equal(status.state, 'IDLE');
    assert.equal(status.siteId, SITE_A);
    assert.equal(status.cameraId, CAMERA_ID);
  }
});

test('browser uplink fails closed on static preview origin, physical worker binding, or concurrent source-apply lock', async () => {
  const is409Conflict = (err: unknown) =>
    err instanceof PublicHttpException &&
    err.getStatus() === 409 &&
    err.publicPayload.code === 'CONFLICT';

  // 1. Statically routed preview origin -> status supported=false, start & uploadFrame reject 409 with zero DB writes
  const staticFixture = buildUplinkFixture({
    enabled: true,
    previewSources: { 'cam-browser-01': 'http://127.0.0.1:8090' },
  });
  const staticStatus = await staticFixture.service.status('tok', SITE_A, CAMERA_ID);
  assert.equal(staticStatus.supported, false);
  assert.equal(staticStatus.state, 'IDLE');
  await assert.rejects(
    staticFixture.service.start('tok', SITE_A, CAMERA_ID, { clientSessionId: 'tab-static' }),
    is409Conflict,
  );
  await assert.rejects(
    staticFixture.service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      {
        contentType: 'image/jpeg',
        leaseId: LEASE_ID,
        sequence: '1',
        capturedAt: '2026-11-26T12:00:00.000Z',
        width: '640',
        height: '480',
      },
      SAMPLE_JPEG,
    ),
    is409Conflict,
  );
  assert.equal(staticFixture.queries.length, 0);

  // 2. Existing physical worker binding -> status supported=false, start & uploadFrame reject 409 and release shared lock
  const boundFixture = buildUplinkFixture({ enabled: true, physicalWorkerBound: true });
  const boundStatus = await boundFixture.service.status('tok', SITE_A, CAMERA_ID);
  assert.equal(boundStatus.supported, false);
  assert.equal(boundStatus.state, 'IDLE');
  await assert.rejects(
    boundFixture.service.start('tok', SITE_A, CAMERA_ID, { clientSessionId: 'tab-bound' }),
    is409Conflict,
  );
  assert.deepEqual(boundFixture.lockState(), { lockReleased: true, runnerReleased: true });
  await assert.rejects(
    boundFixture.service.uploadFrame(
      'tok',
      SITE_A,
      CAMERA_ID,
      {
        contentType: 'image/jpeg',
        leaseId: LEASE_ID,
        sequence: '1',
        capturedAt: '2026-11-26T12:00:00.000Z',
        width: '640',
        height: '480',
      },
      SAMPLE_JPEG,
    ),
    is409Conflict,
  );

  // 3. Concurrent physical source-apply holding exclusive lock -> start rejects 409 immediately
  const busyFixture = buildUplinkFixture({ enabled: true, advisoryLockAcquired: false });
  await assert.rejects(
    busyFixture.service.start('tok', SITE_A, CAMERA_ID, { clientSessionId: 'tab-busy' }),
    is409Conflict,
  );
  assert.deepEqual(busyFixture.lockState(), { lockReleased: false, runnerReleased: true });
});

test('CameraPreviewService returns 503 when browser uplink has no fresh frame (never fakes LIVE)', async () => {
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    SMARTSITE_AI_PREVIEW_SOURCES: {},
    SMARTSITE_AI_SERVICE_TOKEN: 'server-only-token',
    BROWSER_CAMERA_UPLINK_ENABLED: true,
  } as unknown as BackendEnvironment);
  const auth = {
    authenticate: async () => ({
      sessionId: randomUUID(),
      clientType: 'WEB',
      user: {
        id: USER_ID,
        username: 'officer',
        displayName: 'Officer',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: SITE_A }],
      },
    }),
  } as unknown as AuthService;
  const cameras = {
    get: async () => ({
      id: CAMERA_ID,
      siteId: SITE_A,
      externalId: 'cam-browser-01',
      type: 'ZONE',
      status: CameraStatus.ACTIVE,
      code: 'CAM-B1',
      name: 'Browser Cam 1',
      configurationVersion: 1,
      createdAt: new Date('2026-11-26T00:00:00.000Z'),
    }),
  } as unknown as CameraConfigurationService;
  const uplink = {
    isEnabled: () => true,
    readFreshFrame: async () => null,
  } as unknown as CameraBrowserUplinkService;

  const preview = new CameraPreviewService(config, auth, cameras, globalThis.fetch, uplink);
  await assert.rejects(
    preview.read('tok', SITE_A, CAMERA_ID),
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 503,
  );
  const stream = preview.video('tok', SITE_A, CAMERA_ID);
  await assert.rejects(
    stream.next(),
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 503,
  );
});
