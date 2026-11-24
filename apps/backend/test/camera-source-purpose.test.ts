import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraSourceService } from '../src/modules/cameras/camera-source.service.js';

const site = '11111111-1111-4111-8111-111111111111';
const cameraId = '33333333-3333-4333-8333-333333333333';
const command = {
  commandId: '44444444-4444-4444-8444-444444444444',
  receiptId: '55555555-5555-4555-8555-555555555555',
  expectedRevision: 1,
};

function fixture(assignments = [{ role: UserRole.SITE_MANAGER, siteId: site }]) {
  let remoteCalls = 0;
  let databaseCalls = 0;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-service-token',
    SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
    AI_CONFIGURATION_CAMERA_IDS: [cameraId],
    SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
      { id: 'edge', label: 'Test host', siteIds: [site], origin: 'http://127.0.0.1:62035' },
    ]),
  });
  const auth = {
    authenticate: async () => ({
      user: { mustChangePassword: false, roleAssignments: assignments },
    }),
  } as unknown as AuthService;
  const cameras = {
    get: async () => ({ id: cameraId, siteId: site, externalId: 'gate-test', type: 'GATE' }),
  } as unknown as CameraConfigurationService;
  const fetcher = (async () => {
    remoteCalls++;
    return Response.json({
      schemaVersion: '1.0.0',
      hostId: 'edge',
      label: 'Test host',
      sourceKinds: ['WEBCAM'],
      webcams: [],
      videos: [],
      browserCameraSupported: false,
      applySupported: false,
    });
  }) as typeof fetch;
  const database = {
    createQueryRunner: () => {
      databaseCalls++;
      throw new Error('Gate source must not acquire a worker operation lock');
    },
  } as unknown as DataSource;
  return {
    service: new CameraSourceService(config, auth, cameras, fetcher, database),
    sideEffects: () => ({ remoteCalls, databaseCalls }),
  };
}

const status = (expected: number) => (error: unknown) =>
  typeof (error as { getStatus?: unknown })?.getStatus === 'function' &&
  (error as { getStatus(): number }).getStatus() === expected;

const operations = {
  list: (service: CameraSourceService) => service.list('user-token', site, cameraId),
  probe: (service: CameraSourceService) =>
    service.probe('user-token', site, cameraId, 'edge', { kind: 'WEBCAM', deviceId: 'usb-front' }),
  apply: (service: CameraSourceService) =>
    service.apply('user-token', site, cameraId, 'edge', command),
  resume: (service: CameraSourceService) =>
    service.resume('user-token', site, cameraId, 'edge', {
      commandId: command.commandId,
      expectedRevision: 1,
      expectedConfigurationVersion: 1,
    }),
};

for (const [name, execute] of Object.entries(operations)) {
  test(`${name} rejects Gate monitoring sources before remote I/O or worker locks`, async () => {
    const { service, sideEffects } = fixture();
    await assert.rejects(execute(service), status(409));
    assert.deepEqual(sideEffects(), { remoteCalls: 0, databaseCalls: 0 });
  });
}

test('Gate purpose rejection does not bypass Site authorization', async () => {
  for (const assignments of [
    [],
    [{ role: UserRole.ADMIN, siteId: site }],
    [{ role: UserRole.SITE_MANAGER, siteId: '22222222-2222-4222-8222-222222222222' }],
  ]) {
    const { service, sideEffects } = fixture(assignments);
    for (const execute of Object.values(operations)) {
      await assert.rejects(execute(service), status(403));
    }
    assert.deepEqual(sideEffects(), { remoteCalls: 0, databaseCalls: 0 });
  }
});
