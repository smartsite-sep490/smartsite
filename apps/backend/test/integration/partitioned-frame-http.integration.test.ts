import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import {
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('actual AI HTTP boundary authenticates and gates parts before one persisted alert/notification', async (t) => {
  const isolated = createIsolatedTestDatabase(),
    db = isolated.dataSource;
  const cleanup: { app?: NestExpressApplication } = {};
  t.after(async () => {
    try {
      await cleanup.app?.close();
    } finally {
      await isolated.dispose();
    }
  });
  await isolated.initialize();
  const [{ schemaName }] = await db.query('SELECT current_schema() AS "schemaName"');
  assert.match(schemaName, /^isolated_test_[0-9a-f]{32}$/);
  console.info(`FRAME_TEST_SCHEMA:${schemaName}`);
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    userId = randomUUID();
  const regions = [randomUUID(), randomUUID()];
  await db
    .getRepository(SiteEntity)
    .save({ id: siteId, code: 'HTTP-FRAME', name: 'Synthetic HTTP Site' });
  await db.getRepository(CameraEntity).save({
    id: cameraId,
    siteId,
    externalId: 'HTTP-FRAME',
    code: 'HTTP-CAM',
    name: 'Synthetic camera',
  });
  await db.getRepository(ZoneEntity).save({
    id: zoneId,
    siteId,
    code: 'HTTP-ZONE',
    name: 'Synthetic Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT'],
  });
  for (const id of regions)
    await db.getRepository(CameraObservationRegionEntity).save({
      id,
      cameraId,
      zoneId,
      polygon: {
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
    });
  await db.getRepository(UserEntity).save({
    id: userId,
    username: 'http-frame-safety',
    displayName: 'Synthetic recipient',
    passwordHash: 'isolated-fixture-not-for-login',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .save({ id: randomUUID(), userId, siteId, role: UserRole.SAFETY_OFFICER });
  const token = 'synthetic-service-token-for-isolated-http-only';
  const config = createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: token });
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
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  cleanup.app = app;
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/api/v1/integrations/ai/events`;
  const session = randomUUID(),
    frameId = randomUUID(),
    capturedAt = new Date().toISOString();
  const parts = regions.map((regionId, partIndex) => ({
    eventId: randomUUID(),
    schemaVersion: '1.4.0',
    cameraExternalId: 'HTTP-FRAME',
    streamSessionId: session,
    capturedAt,
    frameDimensions: { width: 640, height: 480 },
    framePartition: { frameId, sequenceNumber: '18446744073709551615', partIndex, partCount: 2 },
    observations: [
      { type: 'PERSON', trackId: 7 },
      {
        type: 'PPE',
        trackId: 7,
        ppeItem: 'HARD_HAT',
        status: 'MISSING',
        regionId,
        geometryVersion: 1,
      },
    ],
    evidence: [],
  }));
  const post = (payload: unknown, authorization = `Bearer ${token}`) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(payload),
    });
  assert.equal((await post(parts[0], '')).status, 401);
  assert.equal((await post(parts[0], 'Bearer invalid-synthetic-token')).status, 401);
  const disabled = await post(parts[0]);
  assert.equal(disabled.status, 400);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_observation_event'))[0].n), 0);
  config.set('AI_PARTITIONED_FRAME_ENABLED', true);
  const replies = await Promise.all([post(parts[1]), post(parts[0])]);
  assert(replies.every((reply) => reply.status === 202));
  const bodies = (await Promise.all(replies.map((reply) => reply.json()))) as Array<{
    status: string;
    alertIds: string[];
  }>;
  assert(bodies.every((body) => body.status === 'PROCESSED'));
  assert.equal(bodies[0]!.alertIds.length, 1);
  assert.deepEqual(bodies[0]!.alertIds, bodies[1]!.alertIds);
  const duplicate = await post(parts[0]);
  assert.equal(duplicate.status, 202);
  assert.equal(((await duplicate.json()) as { status: string }).status, 'DUPLICATE_ACCEPTED');
  const conflict = await post({ ...parts[0], eventId: randomUUID() });
  assert.equal(conflict.status, 409);
  const alerts = await db.query('SELECT id,detection_count FROM safety_alert WHERE site_id=$1', [
    siteId,
  ]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].detection_count, 1);
  assert.equal(
    Number((await db.query('SELECT count(*) AS n FROM alert_detection_mapping'))[0].n),
    2,
  );
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_observation_event'))[0].n), 2);
  const notifications = await db.query('SELECT recipient_user_id,site_id FROM user_notification');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_user_id, userId);
  assert.equal(notifications[0].site_id, siteId);
});
