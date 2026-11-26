import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import type { BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { CameraStatus } from '../../src/database/entities/enums.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraBrowserUplinkService } from '../../src/modules/cameras/camera-browser-uplink.service.js';
import { CameraPreviewService } from '../../src/modules/cameras/camera-preview.service.js';
import { CameraConfigurationImageService } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { CameraConfigurationReferenceService } from '../../src/modules/cameras/camera-configuration-reference.service.js';
import { CameraSourceService } from '../../src/modules/cameras/camera-source.service.js';
import { bootstrapCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

/** Build a structurally valid minimal JPEG with real SOI, SOF0(width, height), SOS, and EOI markers. */
function makeJpeg(seed: number, width = 640, height = 480): Buffer {
  const sofPayload = Buffer.from([
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  const sosPayload = Buffer.from([0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scanData = Buffer.alloc(1024, seed & 0xff);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0]),
    sofPayload,
    Buffer.from([0xff, 0xda]),
    sosPayload,
    scanData,
    Buffer.from([0xff, 0xd9]),
  ]);
}

test('PostgreSQL 5433 browser camera uplink: UNLOGGED table, single-owner lease race, bounded frames, stop cleanup, expiry takeover, and fresh preview/config-image', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();

    // 1. Verify table is UNLOGGED in PostgreSQL catalog
    const [tableMeta] = await db.query(
      `SELECT relpersistence FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relname = 'camera_browser_uplink_frame'`,
    );
    assert.equal(tableMeta?.relpersistence, 'u', 'camera_browser_uplink_frame must be UNLOGGED');

    const siteA = randomUUID();
    const siteB = randomUUID();
    const cameraId = randomUUID();
    const inactiveCameraId = randomUUID();
    const gateId = randomUUID();
    const gateCameraId = randomUUID();
    const externalId = `cam-uplink-${cameraId.slice(0, 8)}`;

    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Site A')", [siteA]);
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Site B')", [siteB]);
    await db.query("INSERT INTO gate(id,site_id,code,name) VALUES($1,$2,$1::uuid::text,'Gate 1')", [
      gateId,
      siteA,
    ]);
    await db.query(
      'INSERT INTO camera(type,status,id,site_id,gate_id,external_id,code,name) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',
      ['ZONE', CameraStatus.ACTIVE, cameraId, siteA, null, externalId, 'Browser Uplink Cam'],
    );
    await db.query(
      'INSERT INTO camera(type,status,id,site_id,gate_id,external_id,code,name) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',
      [
        'ZONE',
        CameraStatus.INACTIVE,
        inactiveCameraId,
        siteA,
        null,
        `cam-off-${inactiveCameraId.slice(0, 8)}`,
        'Inactive Cam',
      ],
    );
    await db.query(
      'INSERT INTO camera(type,status,id,site_id,gate_id,external_id,code,name) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',
      [
        'GATE',
        CameraStatus.ACTIVE,
        gateCameraId,
        siteA,
        gateId,
        `cam-gate-${gateCameraId.slice(0, 8)}`,
        'Gate Cam',
      ],
    );

    const manager1 = randomUUID();
    const manager2 = randomUUID();
    const officer1 = randomUUID();
    const foreignManager = randomUUID();
    let nowMs = Date.parse('2026-11-26T12:00:00.000Z');
    const clock = () => nowMs;

    const tokenUsers = new Map<string, { id: string; role: UserRole; siteId: string | null }>([
      ['tok-mgr-1', { id: manager1, role: UserRole.SITE_MANAGER, siteId: siteA }],
      ['tok-mgr-2', { id: manager2, role: UserRole.SITE_MANAGER, siteId: siteA }],
      ['tok-officer-1', { id: officer1, role: UserRole.SAFETY_OFFICER, siteId: siteA }],
      ['tok-foreign', { id: foreignManager, role: UserRole.SITE_MANAGER, siteId: siteB }],
    ]);

    const auth = {
      authenticate: async (token: string) => {
        const entry = tokenUsers.get(token);
        if (!entry)
          throw new PublicHttpException(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
        return {
          sessionId: randomUUID(),
          clientType: 'WEB',
          user: {
            id: entry.id,
            username: token,
            displayName: token,
            isActive: true,
            mustChangePassword: false,
            roleAssignments: [{ role: entry.role, siteId: entry.siteId }],
          },
        };
      },
    } as unknown as AuthService;

    const config = new ConfigService<BackendEnvironment, true>({
      NODE_ENV: 'test',
      SMARTSITE_AI_PREVIEW_SOURCES: {},
      SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-test-service-token',
      BROWSER_CAMERA_UPLINK_ENABLED: true,
    } as unknown as BackendEnvironment);

    const sites = new SiteConfigurationService(db);
    const zones = new ZoneConfigurationService(db, sites);
    const cameraConfig = new CameraConfigurationService(db, zones, sites);
    const uplink = new CameraBrowserUplinkService(config, auth, cameraConfig, db, clock);
    const preview = new CameraPreviewService(config, auth, cameraConfig, globalThis.fetch, uplink);
    const configImage = new CameraConfigurationImageService(
      config,
      auth,
      cameraConfig,
      globalThis.fetch,
      clock,
      uplink,
    );

    // 2. Reject GATE, INACTIVE, and cross-site requests
    await assert.rejects(
      uplink.start('tok-mgr-1', siteA, gateCameraId, { clientSessionId: 'tab-gate' }),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 409,
    );
    await assert.rejects(
      uplink.start('tok-mgr-1', siteA, inactiveCameraId, { clientSessionId: 'tab-off' }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CAMERA_INACTIVE',
    );
    await assert.rejects(
      uplink.start('tok-foreign', siteA, cameraId, { clientSessionId: 'tab-foreign' }),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 403,
    );
    await assert.rejects(
      uplink.start('tok-mgr-1', siteB, cameraId, { clientSessionId: 'tab-wrong-site' }),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 403,
    );

    // 3. Concurrent single-owner lease race: exactly one wins, second gets 409 LEASE_HELD
    const race = await Promise.allSettled([
      uplink.start('tok-mgr-1', siteA, cameraId, {
        clientSessionId: 'tab-mgr-1',
        deviceLabel: 'Laptop Cam 1',
      }),
      uplink.start('tok-mgr-2', siteA, cameraId, {
        clientSessionId: 'tab-mgr-2',
        deviceLabel: 'Laptop Cam 2',
      }),
    ]);
    const fulfilled = race.filter((r) => r.status === 'fulfilled');
    const rejected = race.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const winnerStart = fulfilled[0]!.value;
    const loserReason = rejected[0]!.reason;
    assert.ok(loserReason instanceof PublicHttpException);
    assert.equal(loserReason.getStatus(), 409);
    assert.equal(loserReason.publicPayload.code, 'LEASE_HELD');

    const winnerToken = (await uplink.status('tok-mgr-1', siteA, cameraId)).ownedByCurrentUser
      ? 'tok-mgr-1'
      : 'tok-mgr-2';
    const otherToken = winnerToken === 'tok-mgr-1' ? 'tok-mgr-2' : 'tok-mgr-1';

    // Other manager / officer never see the winner's leaseId
    const officerStatus = await uplink.status('tok-officer-1', siteA, cameraId);
    assert.equal(officerStatus.state, 'ACTIVE');
    assert.equal(officerStatus.ownedByCurrentUser, false);
    assert.equal(officerStatus.activeLeaseId, null);

    // 4. Upload real JPEG frame #1 & reject non-owner / non-monotonic replay
    const jpeg1 = makeJpeg(0x11);
    const receipt1 = await uplink.uploadFrame(
      winnerToken,
      siteA,
      cameraId,
      {
        contentType: 'image/jpeg',
        leaseId: winnerStart.leaseId,
        sequence: '1',
        capturedAt: new Date(nowMs - 100).toISOString(),
        width: '640',
        height: '480',
      },
      jpeg1,
    );
    assert.equal(receipt1.sequence, 1);
    assert.equal(receipt1.byteLength, jpeg1.byteLength);

    // Non-owner cannot upload on winner's lease
    await assert.rejects(
      uplink.uploadFrame(
        otherToken,
        siteA,
        cameraId,
        {
          contentType: 'image/jpeg',
          leaseId: winnerStart.leaseId,
          sequence: '2',
          capturedAt: new Date(nowMs).toISOString(),
          width: '640',
          height: '480',
        },
        makeJpeg(0x22),
      ),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'LEASE_HELD',
    );

    // Replayed sequence <= 1 rejected
    await assert.rejects(
      uplink.uploadFrame(
        winnerToken,
        siteA,
        cameraId,
        {
          contentType: 'image/jpeg',
          leaseId: winnerStart.leaseId,
          sequence: '1',
          capturedAt: new Date(nowMs).toISOString(),
          width: '640',
          height: '480',
        },
        makeJpeg(0x23),
      ),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 409,
    );

    // 5. Fresh Preview & Configuration Image serve exact uploaded JPEG bytes for Safety Officer
    const previewSnap = await preview.read('tok-officer-1', siteA, cameraId);
    assert.equal(previewSnap.sourceKind, 'LIVE');
    assert.equal(previewSnap.frame.sessionId, winnerStart.leaseId);
    assert.equal(previewSnap.frame.sequenceNumber, '1');
    assert.deepEqual(previewSnap.frame.detections, []);
    assert.equal(
      previewSnap.frame.imageDataUrl,
      `data:image/jpeg;base64,${jpeg1.toString('base64')}`,
    );

    const abortVideo = new AbortController();
    const videoStream = preview.video('tok-officer-1', siteA, cameraId, abortVideo.signal);
    const firstMedia = await videoStream.next();
    assert.equal(firstMedia.done, false);
    assert.equal(firstMedia.value?.sessionId, winnerStart.leaseId);
    assert.equal(firstMedia.value?.sequenceNumber, '1');
    abortVideo.abort();
    await videoStream.return(undefined);

    const refImage = await configImage.read('tok-mgr-1', siteA, cameraId);
    assert.equal(refImage.sourceKind, 'LIVE');
    assert.equal(refImage.frame.imageSha256, createHash('sha256').update(jpeg1).digest('hex'));

    // 6. Advance clock by 2000ms -> frame becomes stale -> preview & config-image MUST fail 503 (never frozen LIVE!)
    nowMs += 2000;
    await assert.rejects(
      preview.read('tok-officer-1', siteA, cameraId),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 503,
    );
    await assert.rejects(
      configImage.read('tok-mgr-1', siteA, cameraId),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 503,
    );

    // Upload fresh frame #2 -> preview immediately resumes
    const jpeg2 = makeJpeg(0x33);
    const receipt2 = await uplink.uploadFrame(
      winnerToken,
      siteA,
      cameraId,
      {
        contentType: 'image/jpeg',
        leaseId: winnerStart.leaseId,
        sequence: '2',
        capturedAt: new Date(nowMs - 50).toISOString(),
        width: '640',
        height: '480',
      },
      jpeg2,
    );
    assert.equal(receipt2.sequence, 2);
    const snap2 = await preview.read('tok-officer-1', siteA, cameraId);
    assert.equal(snap2.frame.sequenceNumber, '2');

    // 7. Non-owner cannot stop winner's lease; owner stop immediately nulls jpeg_bytes and terminates preview
    await assert.rejects(
      uplink.stop(otherToken, siteA, cameraId, { leaseId: winnerStart.leaseId }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'LEASE_HELD',
    );
    const stopped = await uplink.stop(winnerToken, siteA, cameraId, {
      leaseId: winnerStart.leaseId,
      reason: 'USER_STOPPED',
    });
    assert.equal(stopped.state, 'STOPPED');

    const [rowAfterStop] = await db.query(
      'SELECT state, jpeg_bytes FROM camera_browser_uplink_frame WHERE camera_id = $1',
      [cameraId],
    );
    assert.equal(rowAfterStop.state, 'STOPPED');
    assert.equal(rowAfterStop.jpeg_bytes, null);

    await assert.rejects(
      preview.read('tok-officer-1', siteA, cameraId),
      (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 503,
    );

    // 8. After stop, other manager can acquire lease cleanly; after 15s expiry, another takeover works cleanly
    const start2 = await uplink.start(otherToken, siteA, cameraId, {
      clientSessionId: 'tab-takeover',
    });
    assert.notEqual(start2.leaseId, winnerStart.leaseId);
    nowMs += 15_001; // expire initial 15s lease
    const expiredStatus = await uplink.status('tok-officer-1', siteA, cameraId);
    assert.equal(expiredStatus.state, 'EXPIRED');

    const start3 = await uplink.start(winnerToken, siteA, cameraId, {
      clientSessionId: 'tab-after-expiry',
    });
    assert.notEqual(start3.leaseId, start2.leaseId);
  } finally {
    await owned.dispose();
  }
});

test('PostgreSQL 5433 real HTTP NestExpressApplication: CORS X-Uplink-* headers, binary image/jpeg upload, size/MIME limits, NDJSON video-stream, and stop cleanup', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  let app: NestExpressApplication | undefined;
  try {
    await owned.initialize();
    const siteId = randomUUID();
    const cameraId = randomUUID();
    const staticCameraId = randomUUID();
    const password = 'Synthetic_uplink_password_123!';
    const passwordHash = await hashPassword(password);
    const managerId = randomUUID();
    const officerId = randomUUID();

    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'HTTP Site')", [
      siteId,
    ]);
    await db.query(
      "INSERT INTO camera(type,status,id,site_id,external_id,code,name) VALUES('ZONE','ACTIVE',$1,$2,'cam-http-uplink','CAM-H1','HTTP Browser Cam'),('ZONE','ACTIVE',$3,$2,'cam-static-preview','CAM-S1','Static Preview Cam')",
      [cameraId, siteId, staticCameraId],
    );
    await db.query(
      'INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,$3),($2::uuid,$2::text,$2::text,$3)',
      [managerId, officerId, passwordHash],
    );
    await db.query(
      'INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4),($5,$6,$3,$7)',
      [
        randomUUID(),
        managerId,
        siteId,
        UserRole.SITE_MANAGER,
        randomUUID(),
        officerId,
        UserRole.SAFETY_OFFICER,
      ],
    );

    const config = createTestConfig({
      LOG_FORMAT: 'json',
      CORS_ORIGINS: 'http://localhost:5173',
      BROWSER_CAMERA_UPLINK_ENABLED: 'true',
      SMARTSITE_AI_SOURCE_HOSTS: '[]',
      SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify({
        'cam-static-preview': 'http://127.0.0.1:62099',
      }),
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(db)
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();

    app = module.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const authService = module.get(AuthService);
    const managerSession = await authService.login(managerId, password, AuthClientType.WEB);
    const officerSession = await authService.login(officerId, password, AuthClientType.WEB);
    const uplinkBase = `${origin}/api/v1/sites/${siteId}/cameras/${cameraId}/browser-uplink`;

    // 0. Zero physical hosts: source-hosts returns [], yet scoped browser-uplink/status discovers supported=true
    const sourceHostsRes = await fetch(
      `${origin}/api/v1/sites/${siteId}/cameras/${cameraId}/source-hosts`,
      { headers: { Authorization: `Bearer ${managerSession.accessToken}` } },
    );
    assert.equal(sourceHostsRes.status, 200);
    assert.deepEqual(await sourceHostsRes.json(), { hosts: [] });

    for (const token of [managerSession.accessToken, officerSession.accessToken]) {
      const statusRes = await fetch(`${uplinkBase}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await statusRes.json(), {
        schemaVersion: '1.0.0',
        supported: true,
        siteId,
        cameraId,
        state: 'IDLE',
        activeLeaseId: null,
        ownedByCurrentUser: false,
        lastSequence: null,
        lastFrameCapturedAt: null,
        leaseExpiresAt: null,
        width: null,
        height: null,
      });
    }

    // 0b. Statically routed preview camera fails closed on status & start with zero DB rows
    const staticBase = `${origin}/api/v1/sites/${siteId}/cameras/${staticCameraId}/browser-uplink`;
    const staticStatusRes = await fetch(`${staticBase}/status`, {
      headers: { Authorization: `Bearer ${managerSession.accessToken}` },
    });
    assert.equal(staticStatusRes.status, 200);
    assert.equal(((await staticStatusRes.json()) as { supported: boolean }).supported, false);

    const staticStartRes = await fetch(`${staticBase}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientSessionId: 'static-tab' }),
    });
    assert.equal(staticStartRes.status, 409);
    const staticRows = await db.query(
      'SELECT camera_id FROM camera_browser_uplink_frame WHERE camera_id = $1',
      [staticCameraId],
    );
    assert.equal(staticRows.length, 0);

    // 1. CORS preflight must permit X-Uplink-* headers
    const preflight = await fetch(`${uplinkBase}/frames`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'authorization,content-type,x-uplink-lease-id,x-uplink-sequence,x-uplink-captured-at,x-uplink-width,x-uplink-height',
      },
    });
    assert.equal(preflight.status, 204);
    const allowHeaders = (
      preflight.headers.get('access-control-allow-headers') ?? ''
    ).toLowerCase();
    assert.ok(allowHeaders.includes('x-uplink-lease-id'));
    assert.ok(allowHeaders.includes('x-uplink-sequence'));

    // 2. Officer cannot start (403); Manager starts lease (200)
    const deniedStart = await fetch(`${uplinkBase}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${officerSession.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientSessionId: 'officer-tab' }),
    });
    assert.equal(deniedStart.status, 403);

    const startedRes = await fetch(`${uplinkBase}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientSessionId: 'manager-http-tab', deviceLabel: 'Laptop HD' }),
    });
    assert.equal(startedRes.status, 200);
    const started = (await startedRes.json()) as { leaseId: string; maxFrameBytes: number };
    assert.equal(started.maxFrameBytes, 130_000);

    // 3. Reject wrong MIME (415) and oversized binary JPEG (413)
    const badMimeRes = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/png',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '1',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array(makeJpeg(0x01)),
    });
    assert.equal(badMimeRes.status, 415);

    const tooLarge = Buffer.alloc(130_001);
    tooLarge[0] = 0xff;
    tooLarge[1] = 0xd8;
    tooLarge[2] = 0xff;
    const largeRes = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/jpeg',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '1',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array(tooLarge),
    });
    assert.equal(largeRes.status, 413);

    // 3b. Reject malformed JPEG (valid SOI prefix, no SOF/EOI) and dimension-mismatched JPEG (SOF 320x240 != 640x480)
    const malformedRes = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/jpeg',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '1',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });
    assert.equal(malformedRes.status, 415);

    const mismatchRes = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/jpeg',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '1',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array(makeJpeg(0x05, 320, 240)),
    });
    assert.equal(mismatchRes.status, 415);

    // 3c. Aborted mid-body TCP upload must not crash server or persist partial frame
    const parsedUrl = new URL(`${uplinkBase}/frames`);
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(
        { host: parsedUrl.hostname, port: Number(parsedUrl.port) },
        () => {
          const reqHead = [
            `POST ${parsedUrl.pathname} HTTP/1.1`,
            `Host: ${parsedUrl.host}`,
            `Authorization: Bearer ${managerSession.accessToken}`,
            'Content-Type: image/jpeg',
            'Content-Length: 5000',
            `X-Uplink-Lease-Id: ${started.leaseId}`,
            'X-Uplink-Sequence: 1',
            `X-Uplink-Captured-At: ${new Date().toISOString()}`,
            'X-Uplink-Width: 640',
            'X-Uplink-Height: 480',
            'Connection: close',
            '',
            '',
          ].join('\r\n');
          socket.write(reqHead);
          socket.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 40);
        },
      );
      socket.on('error', reject);
    });
    const [rowAfterAbort] = await db.query(
      'SELECT sequence, jpeg_bytes FROM camera_browser_uplink_frame WHERE camera_id = $1',
      [cameraId],
    );
    assert.equal(Number(rowAfterAbort.sequence), 0);
    assert.equal(rowAfterAbort.jpeg_bytes, null);

    // 4. Upload real binary JPEG frame & consume real HTTP NDJSON video-stream + configuration-image
    const jpeg = makeJpeg(0x42);
    const frameRes = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/jpeg',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '1',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array(jpeg),
    });
    assert.equal(frameRes.status, 200);
    const receipt = (await frameRes.json()) as { sequence: number; byteLength: number };
    assert.equal(receipt.sequence, 1);
    assert.equal(receipt.byteLength, jpeg.byteLength);

    const streamAbort = new AbortController();
    const videoRes = await fetch(
      `${origin}/api/v1/sites/${siteId}/cameras/${cameraId}/video-stream`,
      {
        headers: { Authorization: `Bearer ${officerSession.accessToken}` },
        signal: streamAbort.signal,
      },
    );
    assert.equal(videoRes.status, 200);
    assert.equal(videoRes.headers.get('content-type'), 'application/x-ndjson');
    const reader = videoRes.body!.getReader();
    const firstChunk = await reader.read();
    streamAbort.abort();
    await reader.cancel().catch(() => {});
    const line = new TextDecoder().decode(firstChunk.value).split('\n')[0]!;
    const mediaFrame = JSON.parse(line) as {
      type: string;
      sessionId: string;
      sequenceNumber: string;
      imageDataUrl: string;
    };
    assert.equal(mediaFrame.type, 'media-frame');
    assert.equal(mediaFrame.sessionId, started.leaseId);
    assert.equal(mediaFrame.sequenceNumber, '1');
    assert.equal(mediaFrame.imageDataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);

    // 5. Stop via HTTP -> immediately clears pixels and makes preview return 503
    const stopRes = await fetch(`${uplinkBase}/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ leaseId: started.leaseId, reason: 'PAGE_HIDDEN' }),
    });
    assert.equal(stopRes.status, 200);

    const afterStopPreview = await fetch(
      `${origin}/api/v1/sites/${siteId}/cameras/${cameraId}/preview`,
      {
        headers: { Authorization: `Bearer ${officerSession.accessToken}` },
      },
    );
    assert.equal(afterStopPreview.status, 503);

    // 6. Uploading to a STOPPED lease is strictly rejected with 409 LEASE_EXPIRED
    const uploadAfterStop = await fetch(`${uplinkBase}/frames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerSession.accessToken}`,
        'Content-Type': 'image/jpeg',
        'X-Uplink-Lease-Id': started.leaseId,
        'X-Uplink-Sequence': '2',
        'X-Uplink-Captured-At': new Date().toISOString(),
        'X-Uplink-Width': '640',
        'X-Uplink-Height': '480',
      },
      body: new Uint8Array(makeJpeg(0x99)),
    });
    assert.equal(uploadAfterStop.status, 409);
    const stopUploadBody = (await uploadAfterStop.json()) as { code: string };
    assert.equal(stopUploadBody.code, 'LEASE_EXPIRED');
  } finally {
    if (app) await app.close();
    await owned.dispose();
  }
});

test('PostgreSQL 5433 source-ownership mutual exclusion: physical binding rejects browser uplink, active browser lease supplying reference blocks physical apply/resume, and concurrent lock serializes both', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID();
    const camPhysical = randomUUID();
    const camBrowser = randomUUID();
    const camRace = randomUUID();
    const managerId = randomUUID();

    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Ownership Site')", [
      siteId,
    ]);
    await db.query(
      'INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,$2)',
      [managerId, 'unused-hash'],
    );
    await db.query(
      `INSERT INTO camera(type,status,id,site_id,external_id,code,name) VALUES
       ('ZONE','ACTIVE',$1,$4,'cam-phys-own','CAM-P1','Physical Owned Cam'),
       ('ZONE','ACTIVE',$2,$4,'cam-brows-own','CAM-B1','Browser Owned Cam'),
       ('ZONE','ACTIVE',$3,$4,'cam-race-own','CAM-R1','Race Lock Cam')`,
      [camPhysical, camBrowser, camRace, siteId],
    );

    const auth = {
      authenticate: async () => ({
        sessionId: randomUUID(),
        clientType: 'WEB',
        user: {
          id: managerId,
          username: 'mgr',
          displayName: 'Manager',
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
        },
      }),
    } as unknown as AuthService;

    const sites = new SiteConfigurationService(db);
    const zones = new ZoneConfigurationService(db, sites);
    const cameraConfig = new CameraConfigurationService(db, zones, sites);
    const config = new ConfigService<BackendEnvironment, true>({
      NODE_ENV: 'test',
      BROWSER_CAMERA_UPLINK_ENABLED: true,
      SMARTSITE_AI_PREVIEW_SOURCES: {},
      SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-service-token',
      SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
      AI_CONFIGURATION_CAMERA_IDS: [camPhysical, camBrowser, camRace],
      SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
        { id: 'edge', label: 'Site Edge', siteIds: [siteId], origin: 'http://127.0.0.1:62035' },
      ]),
    } as unknown as BackendEnvironment);

    const uplink = new CameraBrowserUplinkService(config, auth, cameraConfig, db, Date.now);
    const configImage = new CameraConfigurationImageService(
      config,
      auth,
      cameraConfig,
      globalThis.fetch,
      Date.now,
      uplink,
    );
    const configRef = new CameraConfigurationReferenceService(db, configImage);

    // 1. Existing physical worker generation binding rejects browser status & start
    await bootstrapCameraWorkerGeneration(db, camPhysical, [camPhysical], 60_000);
    const physicalStatus = await uplink.status('tok', siteId, camPhysical);
    assert.equal(physicalStatus.supported, false);
    assert.equal(physicalStatus.state, 'IDLE');
    await assert.rejects(
      uplink.start('tok', siteId, camPhysical, { clientSessionId: 'tab-phys' }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );
    assert.equal(
      (
        await db.query('SELECT camera_id FROM camera_browser_uplink_frame WHERE camera_id = $1', [
          camPhysical,
        ])
      ).length,
      0,
    );

    // 2. Active browser lease supplying a configuration reference blocks physical apply, resume, and generation bootstrap
    const lease = await uplink.start('tok', siteId, camBrowser, {
      clientSessionId: 'tab-browser-ref',
    });
    await uplink.uploadFrame(
      'tok',
      siteId,
      camBrowser,
      {
        contentType: 'image/jpeg',
        leaseId: lease.leaseId,
        sequence: '1',
        capturedAt: new Date().toISOString(),
        width: '640',
        height: '480',
      },
      makeJpeg(0x55),
    );
    const refBundle = await configRef.read('tok', siteId, camBrowser);
    assert.equal(refBundle.reference.sessionId, lease.leaseId);

    let remoteCalls = 0;
    const blockedFetcher = (async () => {
      remoteCalls++;
      return Response.json({});
    }) as typeof fetch;
    const sourceService = new CameraSourceService(config, auth, cameraConfig, blockedFetcher, db);

    await assert.rejects(
      sourceService.apply('tok', siteId, camBrowser, 'edge', {
        commandId: randomUUID(),
        receiptId: randomUUID(),
        expectedRevision: 0,
      }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );
    await assert.rejects(
      sourceService.resume('tok', siteId, camBrowser, 'edge', {
        commandId: randomUUID(),
        expectedRevision: 1,
        expectedConfigurationVersion: 1,
      }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );
    await assert.rejects(
      bootstrapCameraWorkerGeneration(db, camBrowser, [camBrowser], 60_000),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );
    assert.equal(remoteCalls, 0, 'blocked physical apply/resume must not call remote AI host');

    // 3. Concurrent physical apply holding :source-apply exclusive lock blocks browser start immediately
    let prepareEntered!: () => void;
    const onPrepareEntered = new Promise<void>((resolve) => {
      prepareEntered = resolve;
    });
    let releasePrepare!: () => void;
    const waitPrepare = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const commandId = randomUUID();
    const receiptId = randomUUID();
    const raceFetcher = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/prepare')) {
        prepareEntered();
        await waitPrepare;
        return Response.json({
          schemaVersion: '1.1.0',
          state: 'PREPARED',
          commandId,
          sourceRevision: 0,
          sourceKind: 'LIVE',
          currentGenerationId: null,
        });
      }
      if (target.endsWith('/commit')) {
        const body = JSON.parse(String(init?.body)) as {
          generation: { workerGenerationId: string };
        };
        return Response.json({
          schemaVersion: '1.0.0',
          state: 'RUNNING',
          commandId,
          sourceRevision: 1,
          sourceKind: 'LIVE',
          currentGenerationId: body.generation.workerGenerationId,
        });
      }
      throw new Error(`Unexpected URL ${target}`);
    }) as typeof fetch;

    const raceSourceService = new CameraSourceService(config, auth, cameraConfig, raceFetcher, db);
    const applyPromise = raceSourceService.apply('tok', siteId, camRace, 'edge', {
      commandId,
      receiptId,
      expectedRevision: 0,
    });
    await onPrepareEntered;

    // While physical apply holds the advisory lock in /prepare, browser start MUST reject 409 CONFLICT
    await assert.rejects(
      uplink.start('tok', siteId, camRace, { clientSessionId: 'tab-concurrent-race' }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );

    releasePrepare();
    const applied = await applyPromise;
    assert.equal(applied.state, 'RUNNING');

    // After apply commits physical generation, browser status is unsupported and start remains 409 CONFLICT
    assert.equal((await uplink.status('tok', siteId, camRace)).supported, false);
    await assert.rejects(
      uplink.start('tok', siteId, camRace, { clientSessionId: 'tab-after-apply' }),
      (e: unknown) =>
        e instanceof PublicHttpException &&
        e.getStatus() === 409 &&
        e.publicPayload.code === 'CONFLICT',
    );
    assert.equal(
      (
        await db.query('SELECT camera_id FROM camera_browser_uplink_frame WHERE camera_id = $1', [
          camRace,
        ])
      ).length,
      0,
    );
  } finally {
    await owned.dispose();
  }
});
