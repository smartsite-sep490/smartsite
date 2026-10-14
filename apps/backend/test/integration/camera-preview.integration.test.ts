import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraPreviewController } from '../../src/modules/cameras/camera-preview.controller.js';
import {
  CameraPreviewService,
  CAMERA_PREVIEW_FETCH,
} from '../../src/modules/cameras/camera-preview.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { HttpExceptionFilter } from '../../src/common/http/http-exception.filter.js';
import { requestIdMiddleware } from '../../src/common/http/request-id.js';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../src/database/entities/auth-session.entity.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { CameraStatus } from '../../src/database/entities/enums.js';

// Only the validated dedicated local test DB; each file owns a disposable schema.
const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

const temporaryPassword = 'PreviewTemp123!';
const permanentPassword = 'PreviewPermanent123!';
const serviceCanary = 'integration-fake-preview-server-only';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const sites = new SiteConfigurationService(db);
  const zones = new ZoneConfigurationService(db, sites);
  const cameras = new CameraConfigurationService(db, zones, sites);
  const suffix = randomUUID().slice(0, 8);
  const site = await sites.create({ code: `PREVIEW-${suffix}`, name: 'Preview Site' });
  const otherSite = await sites.create({ code: `OTHER-${suffix}`, name: 'Other Site' });
  const camera = await cameras.create(site.id, {
    code: `CAM-${suffix}`,
    name: 'Camera A',
    externalId: `preview-${suffix}`,
  });
  const foreignCamera = await cameras.create(otherSite.id, {
    code: `B-${suffix}`,
    name: 'Camera B',
    externalId: `other-${suffix}`,
  });
  const config = createTestConfig({
    SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify({
      [camera.externalId]: 'http://127.0.0.1:8001',
      [foreignCamera.externalId]: 'http://127.0.0.1:8001',
    }),
    SMARTSITE_AI_SERVICE_TOKEN: serviceCanary,
  });
  const auth = new AuthService(db, new AuthTokenService(new JwtService(), config));
  const users = new UsersService(db, sites);
  const user = await users.create({
    username: `preview-${suffix}`,
    displayName: 'Preview Officer',
    temporaryPassword,
    roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: site.id }],
  });
  const temporary = await auth.login(user.username, temporaryPassword, AuthClientType.WEB);
  await auth.changePassword(user.id, temporaryPassword, permanentPassword);
  const login = () => auth.login(user.username, permanentPassword, AuthClientType.WEB);
  const session = await login();
  let calls = 0;
  let onRead: (() => Promise<void>) | undefined;
  const finalCameraGates = new Set<() => void>();
  const module = await Test.createTestingModule({
    controllers: [CameraPreviewController],
    providers: [
      CameraPreviewService,
      UserAuthGuard,
      { provide: ConfigService, useValue: config },
      { provide: AuthService, useValue: auth },
      { provide: CameraConfigurationService, useValue: cameras },
      {
        provide: CAMERA_PREVIEW_FETCH,
        useValue: async (url: string) => {
          calls++;
          if (onRead) await onRead();
          const externalId = new URL(url).searchParams.get('cameraExternalId');
          return Response.json({
            sourceKind: 'LIVE',
            frame: {
              type: 'frame',
              previewVersion: 1,
              cameraExternalId: externalId,
              sessionId: '44444444-4444-4444-8444-444444444444',
              sequenceNumber: '1',
              capturedAt: new Date().toISOString(),
              width: 640,
              height: 480,
              imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
              detections: [],
              zoneDetections: [],
              zonePolygons: [],
            },
          });
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  t.after(async () => {
    for (const unblock of finalCameraGates) unblock();
    await app.close();
  });
  const origin = await app.getUrl();
  const read = (token = session.accessToken, targetSite = site.id, targetCamera = camera.id) =>
    fetch(`${origin}/api/v1/sites/${targetSite}/cameras/${targetCamera}/preview`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  function blockSource() {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    onRead = async () => {
      started();
      await released;
    };
    return {
      entered,
      release: () => {
        onRead = undefined;
        release();
      },
    };
  }
  function blockFinalCameraRead() {
    const get = cameras.get.bind(cameras);
    let reads = 0;
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    cameras.get = async (...args: Parameters<typeof get>) => {
      const row = await get(...args);
      if (++reads === 2) {
        started();
        await released;
      }
      return row;
    };
    const unblock = () => {
      cameras.get = get;
      release();
      finalCameraGates.delete(unblock);
    };
    finalCameraGates.add(unblock);
    return { entered, release: unblock };
  }
  return {
    site,
    otherSite,
    camera,
    foreignCamera,
    auth,
    users,
    user,
    cameras,
    session,
    temporary,
    login,
    read,
    blockSource,
    blockFinalCameraRead,
    calls: () => calls,
  };
}

test('real PostgreSQL sessions and camera scope allow only current Site/Camera, safe no-store response', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read('')).status, 401);
  assert.equal((await f.read(f.temporary.accessToken)).status, 401);
  assert.equal(
    (await f.read(f.session.accessToken, f.otherSite.id, f.foreignCamera.id)).status,
    403,
  );
  assert.equal((await f.read(f.session.accessToken, f.site.id, f.foreignCamera.id)).status, 404);
  assert.equal(f.calls(), 0);
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as {
    siteId: string;
    cameraId: string;
    cameraExternalId: string;
    frame: unknown;
  };
  assert.equal(payload.siteId, f.site.id);
  assert.equal(payload.cameraId, f.camera.id);
  assert.equal(payload.cameraExternalId, f.camera.externalId);
  assert.equal(JSON.stringify(payload).includes(serviceCanary), false);
  assert.equal(JSON.stringify(payload).includes(f.session.accessToken), false);
});

test('logout committed in PostgreSQL during upstream wait blocks that HTTP snapshot and later reads', async (t) => {
  const f = await fixture(t);
  const gate = f.blockSource();
  const pending = f.read();
  await gate.entered;
  const { sessionId } = await f.auth.authenticate(f.session.accessToken);
  try {
    await f.auth.logout(f.session.refreshToken, AuthClientType.WEB);
    const saved = await db.getRepository(AuthSessionEntity).findOneByOrFail({ id: sessionId });
    assert.ok(saved.revokedAt);
  } finally {
    gate.release();
  }
  const denied = await pending;
  assert.equal(denied.status, 401);
  assert.equal((await denied.text()).includes('imageDataUrl'), false);
  assert.equal((await f.read()).status, 401);
  assert.equal(f.calls(), 1);
});

for (const change of ['logout', 'role'] as const) {
  test(`${change} committed during final Camera read blocks that HTTP preview`, async (t) => {
    const f = await fixture(t);
    const gate = f.blockFinalCameraRead();
    const pending = f.read();
    await gate.entered;
    try {
      if (change === 'logout') {
        await f.auth.logout(f.session.refreshToken, AuthClientType.WEB);
      } else {
        await f.users.replaceRoleAssignments(f.user.id, {
          roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: f.otherSite.id }],
        });
      }
    } finally {
      gate.release();
    }
    const denied = await pending;
    assert.equal(denied.status, 401);
    assert.equal((await denied.text()).includes('imageDataUrl'), false);
    assert.equal(f.calls(), 1);
  });
}

test('role reassignment committed during fetch revokes old session; new session cannot view the old Site', async (t) => {
  const f = await fixture(t);
  const gate = f.blockSource();
  const pending = f.read();
  await gate.entered;
  try {
    await f.users.replaceRoleAssignments(f.user.id, {
      roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: f.otherSite.id }],
    });
  } finally {
    gate.release();
  }
  assert.equal((await pending).status, 401);
  const rotated = await f.login();
  assert.equal((await f.read(rotated.accessToken)).status, 403);
  assert.equal(f.calls(), 1);
  assert.equal((await f.read(rotated.accessToken, f.otherSite.id, f.foreignCamera.id)).status, 200);
});

test('camera deactivation committed during fetch prevents image release and inactive follow-up requests', async (t) => {
  const f = await fixture(t);
  const gate = f.blockSource();
  const pending = f.read();
  await gate.entered;
  try {
    await f.cameras.setStatus(f.site.id, f.camera.id, {
      status: CameraStatus.INACTIVE,
      expectedConfigurationVersion: f.camera.configurationVersion,
    });
  } finally {
    gate.release();
  }
  const denied = await pending;
  assert.equal(denied.status, 503);
  assert.equal((await denied.text()).includes('imageDataUrl'), false);
  assert.equal((await f.read()).status, 503);
  assert.equal(f.calls(), 1);
});

test('session expiry committed during fetch is rechecked against PostgreSQL before image release', async (t) => {
  const f = await fixture(t);
  const gate = f.blockSource();
  const pending = f.read();
  await gate.entered;
  try {
    const { sessionId } = await f.auth.authenticate(f.session.accessToken);
    await db
      .getRepository(AuthSessionEntity)
      .update({ id: sessionId }, { expiresAt: new Date(Date.now() - 1000) });
  } finally {
    gate.release();
  }
  assert.equal((await pending).status, 401);
  assert.equal((await f.read()).status, 401);
  assert.equal(f.calls(), 1);
});
