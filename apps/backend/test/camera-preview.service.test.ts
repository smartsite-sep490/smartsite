import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { CameraStatus } from '../src/database/entities/enums.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { AuthService, AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import type { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraPreviewService } from '../src/modules/cameras/camera-preview.service.js';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

function buildFixture() {
  const state = {
    roleAssignments: [
      { role: UserRole.SITE_MANAGER, siteId: SITE_A },
    ] as AuthenticatedUser['roleAssignments'],
    isActive: true,
    mustChangePassword: false,
    revokedAfterFetch: false,
    authCalls: 0,
    fetchCalls: 0,
    cameraType: 'ZONE' as 'ZONE' | 'GATE',
    cameraStatus: CameraStatus.ACTIVE,
    cameraSiteId: SITE_A,
    frameZoneAnchor: undefined as unknown,
  };

  const config = {
    get(key: keyof BackendEnvironment) {
      if (key === 'SMARTSITE_AI_PREVIEW_SOURCES') return { 'camera-a': 'http://127.0.0.1:8002' };
      if (key === 'SMARTSITE_AI_SERVICE_TOKEN') return 'fake-service-token-for-unit-test';
      return undefined;
    },
  } as unknown as ConfigService<BackendEnvironment, true>;

  const auth = {
    async authenticate() {
      state.authCalls++;
      if (state.revokedAfterFetch && state.fetchCalls > 0) {
        throw new UnauthorizedException();
      }
      return {
        sessionId: SESSION_ID,
        clientType: 'WEB',
        user: {
          id: randomUUID(),
          username: 'actor',
          displayName: 'Actor',
          isActive: state.isActive,
          mustChangePassword: state.mustChangePassword,
          roleAssignments: state.roleAssignments,
        },
      };
    },
  } as unknown as AuthService;

  const cameras = {
    async get() {
      return {
        id: CAMERA_ID,
        siteId: state.cameraSiteId,
        externalId: 'camera-a',
        type: state.cameraType,
        status: state.cameraStatus,
        code: 'CAM-A',
        name: 'Camera A',
        configurationVersion: 1,
        createdAt: new Date('2026-11-20T00:00:00.000Z'),
      };
    },
    async list() {
      return {
        items: [
          {
            id: CAMERA_ID,
            siteId: SITE_A,
            externalId: 'camera-a',
            code: 'CAM-A',
            name: 'Camera A',
            status: CameraStatus.ACTIVE,
            configurationVersion: 1,
            createdAt: new Date('2026-11-20T00:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async observationZones() {
      return {
        siteId: SITE_A,
        cameraId: CAMERA_ID,
        configurationVersion: 1,
        items: [],
        total: 0,
        unresolvedRegionCount: 0,
      };
    },
  } as unknown as CameraConfigurationService;

  const fetcher: typeof fetch = async () => {
    state.fetchCalls++;
    return Response.json({
      sourceKind: 'LIVE',
      frame: {
        type: 'frame',
        previewVersion: 1,
        cameraExternalId: 'camera-a',
        sessionId: SESSION_ID,
        sequenceNumber: '1',
        capturedAt: new Date().toISOString(),
        width: 640,
        height: 480,
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        detections: [],
        zoneDetections: [],
        zonePolygons: [],
        ...(state.frameZoneAnchor !== undefined ? { zoneAnchor: state.frameZoneAnchor } : {}),
      },
    });
  };

  return { state, service: new CameraPreviewService(config, auth, cameras, fetcher) };
}

test('CameraPreviewService allows assigned same-site SITE_MANAGER and SAFETY_OFFICER across monitoring endpoints', async () => {
  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER] as const) {
    const f = buildFixture();
    f.state.roleAssignments = [{ role, siteId: SITE_A }];
    const preview = await f.service.read('token', SITE_A, CAMERA_ID);
    assert.equal(preview.cameraId, CAMERA_ID);
    assert.equal(preview.siteId, SITE_A);
    assert.equal(f.state.fetchCalls, 1);

    const listResult = await f.service.list('token', SITE_A, 0, 20);
    assert.equal(listResult.total, 1);

    const zones = await f.service.observationZones('token', SITE_A, CAMERA_ID, 0, 20);
    assert.equal(zones.cameraId, CAMERA_ID);
  }
});

test('CameraPreviewService denies cross-site, unassigned, global admin, non-monitoring roles, inactive users, and password-change-required before fetch', async () => {
  for (const mutate of [
    (s: ReturnType<typeof buildFixture>['state']) =>
      (s.roleAssignments = [{ role: UserRole.ADMIN, siteId: null }]),
    (s: ReturnType<typeof buildFixture>['state']) =>
      (s.roleAssignments = [{ role: UserRole.SITE_MANAGER, siteId: null }]),
    (s: ReturnType<typeof buildFixture>['state']) =>
      (s.roleAssignments = [{ role: UserRole.SITE_MANAGER, siteId: SITE_B }]),
    (s: ReturnType<typeof buildFixture>['state']) =>
      (s.roleAssignments = [{ role: UserRole.SAFETY_OFFICER, siteId: SITE_B }]),
    (s: ReturnType<typeof buildFixture>['state']) =>
      (s.roleAssignments = [{ role: UserRole.WORKER, siteId: SITE_A }]),
    (s: ReturnType<typeof buildFixture>['state']) => (s.isActive = false),
  ]) {
    const f = buildFixture();
    mutate(f.state);
    await assert.rejects(f.service.read('token', SITE_A, CAMERA_ID), (error: unknown) => {
      return error instanceof PublicHttpException && error.getStatus() === 403;
    });
    assert.equal(f.state.fetchCalls, 0);
  }

  const pwdBlocked = buildFixture();
  pwdBlocked.state.mustChangePassword = true;
  await assert.rejects(
    pwdBlocked.service.read('token', SITE_A, CAMERA_ID),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.getStatus() === 403 &&
      error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED',
  );
  assert.equal(pwdBlocked.state.fetchCalls, 0);
});

test('CameraPreviewService retains GATE camera 503 denial and post-fetch revocation 401 denial for SITE_MANAGER', async () => {
  const gate = buildFixture();
  gate.state.cameraType = 'GATE';
  await assert.rejects(
    gate.service.read('token', SITE_A, CAMERA_ID),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
  assert.equal(gate.state.fetchCalls, 0);

  const revoked = buildFixture();
  revoked.state.revokedAfterFetch = true;
  await assert.rejects(
    revoked.service.read('token', SITE_A, CAMERA_ID),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.equal(revoked.state.fetchCalls, 1);
});

test('CameraPreviewService preserves optional canonical zoneAnchor and fails closed on invalid anchor values', async () => {
  const legacy = buildFixture();
  const legacyPreview = await legacy.service.read('token', SITE_A, CAMERA_ID);
  assert.equal(legacyPreview.frame.zoneAnchor, undefined);

  const boxCenter = buildFixture();
  boxCenter.state.frameZoneAnchor = 'BOX_CENTER';
  const boxCenterPreview = await boxCenter.service.read('token', SITE_A, CAMERA_ID);
  assert.equal(boxCenterPreview.frame.zoneAnchor, 'BOX_CENTER');

  const bottomCenter = buildFixture();
  bottomCenter.state.frameZoneAnchor = 'BOTTOM_CENTER';
  const bottomCenterPreview = await bottomCenter.service.read('token', SITE_A, CAMERA_ID);
  assert.equal(bottomCenterPreview.frame.zoneAnchor, 'BOTTOM_CENTER');

  const invalid = buildFixture();
  invalid.state.frameZoneAnchor = 'TOP_CENTER';
  await assert.rejects(
    invalid.service.read('token', SITE_A, CAMERA_ID),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
});
