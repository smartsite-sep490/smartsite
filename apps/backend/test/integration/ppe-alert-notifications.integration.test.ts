import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource, In } from 'typeorm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserNotificationListResponse } from '@smartsite/contracts';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  AiObservationEventEntity,
  AuthSessionEntity,
  AlertDetectionMappingEntity,
  AlertStatus,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  SafetyAlertEntity,
  SiteEntity,
  UserEntity,
  UserNotificationEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { createTestConfig } from '../support/config.js';
import dataSource from '../support/test-data-source.js';

const fixtureSites: string[] = [],
  fixtureUsers: string[] = [];
after(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  try {
    if (!fixtureSites.length) return;
    await dataSource.getRepository(UserNotificationEntity).delete({ siteId: In(fixtureSites) });
    await dataSource.query(
      'DELETE FROM alert_detection_mapping WHERE alert_id IN (SELECT id FROM safety_alert WHERE site_id=ANY($1::uuid[]))',
      [fixtureSites],
    );
    await dataSource.getRepository(SafetyAlertEntity).delete({ siteId: In(fixtureSites) });
    await dataSource.query(
      'DELETE FROM ai_observation_event WHERE resolved_camera_id IN (SELECT id FROM camera WHERE site_id=ANY($1::uuid[]))',
      [fixtureSites],
    );
    await dataSource.query(
      'DELETE FROM camera_observation_region WHERE camera_id IN (SELECT id FROM camera WHERE site_id=ANY($1::uuid[]))',
      [fixtureSites],
    );
    await dataSource.getRepository(CameraEntity).delete({ siteId: In(fixtureSites) });
    await dataSource.getRepository(ZoneEntity).delete({ siteId: In(fixtureSites) });
    await dataSource.getRepository(AuthSessionEntity).delete({ userId: In(fixtureUsers) });
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId: In(fixtureUsers) });
    await dataSource.getRepository(UserEntity).delete(fixtureUsers);
    await dataSource.getRepository(SiteEntity).delete(fixtureSites);
  } finally {
    await dataSource.destroy();
  }
});

async function fixture() {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID(),
    otherSiteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    regionId = randomUUID(),
    streamSessionId = randomUUID();
  const cameraExternalId = `PPE-${randomUUID()}`;
  fixtureSites.push(siteId, otherSiteId);
  await dataSource.getRepository(SiteEntity).save([
    { id: siteId, code: siteId, name: 'Synthetic PPE site' },
    { id: otherSiteId, code: otherSiteId, name: 'Other synthetic site' },
  ]);
  await dataSource.getRepository(CameraEntity).save({
    id: cameraId,
    siteId,
    externalId: cameraExternalId,
    code: cameraExternalId,
    name: 'Camera Nguyễn An',
    status: CameraStatus.ACTIVE,
  });
  await dataSource.getRepository(ZoneEntity).save({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Zone Nguyễn An',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  });
  await dataSource.getRepository(CameraObservationRegionEntity).save({
    id: regionId,
    cameraId,
    zoneId,
    version: 1,
    isActive: true,
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: { type: 'Polygon', coordinates: [] },
  });
  async function account(
    role = UserRole.SAFETY_OFFICER,
    site: string | null = siteId,
    active = true,
    blocked = false,
  ) {
    const id = randomUUID();
    fixtureUsers.push(id);
    await dataSource.getRepository(UserEntity).save({
      id,
      username: id,
      displayName: 'Synthetic Safety',
      passwordHash: 'synthetic-not-a-password',
      isActive: active,
      mustChangePassword: blocked,
    });
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: id, siteId: site, role });
    return {
      id,
      username: id,
      displayName: 'Synthetic Safety',
      isActive: active,
      mustChangePassword: blocked,
      roleAssignments: [{ role, siteId: site }],
    };
  }
  const safety = await account(),
    colleague = await account();
  const foreign = await account(UserRole.SAFETY_OFFICER, otherSiteId);
  const disabled = await account(UserRole.SAFETY_OFFICER, siteId, false);
  const blocked = await account(UserRole.SAFETY_OFFICER, siteId, true, true);
  const manager = await account(UserRole.SITE_MANAGER);
  await account(UserRole.ADMIN, null);
  // Multiple assignments must not create duplicate notices for the same account.
  await dataSource.getRepository(UserRoleAssignmentEntity).save({
    id: randomUUID(),
    userId: safety.id,
    siteId: otherSiteId,
    role: UserRole.SAFETY_OFFICER,
  });
  const notifications = new SchedulingNotificationService(dataSource);
  const config = createTestConfig();
  const ingestion = new AiIngestionService(
    dataSource,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    new DurableGroupingService(config, new SchedulingNotificationService(dataSource)),
    config,
  );
  function event(overrides: Record<string, unknown> = {}) {
    return {
      eventId: randomUUID(),
      schemaVersion: '1.0.0',
      cameraExternalId,
      streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 640, height: 480 },
      observations: [
        { type: 'PERSON', trackId: 1 },
        { type: 'IDENTITY_CANDIDATE', trackId: 1, status: 'UNKNOWN' },
        {
          type: 'PPE',
          trackId: 1,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId,
          geometryVersion: 1,
        },
      ],
      evidence: [],
      ...overrides,
    };
  }
  return {
    siteId,
    otherSiteId,
    cameraId,
    zoneId,
    regionId,
    safety,
    colleague,
    foreign,
    disabled,
    blocked,
    manager,
    account,
    notifications,
    ingestion,
    event,
  };
}

test('PPE schema permits only the new nullable shape and rejects missing or malformed fields', async () => {
  const f = await fixture();
  const q = dataSource.createQueryRunner();
  await q.connect();
  await q.startTransaction();
  const metadata = {
    cameraId: f.cameraId,
    cameraName: 'Synthetic camera',
    zoneId: f.zoneId,
    zoneName: 'Synthetic zone',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
  };
  const content = {
    siteName: 'Synthetic site',
    title: 'PPE alert requires review',
    message: 'Review the PPE observation.',
    safetyAlert: metadata,
  };
  async function insert(
    type: string,
    event: string,
    role: string,
    value: unknown,
    contractor: string | null = null,
  ) {
    return q.query(
      `INSERT INTO user_notification
      (id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content)
      VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9::jsonb)`,
      [
        randomUUID(),
        f.safety.id,
        f.siteId,
        contractor,
        role,
        type,
        randomUUID(),
        event,
        JSON.stringify(value),
      ],
    );
  }
  try {
    await insert('SAFETY_ALERT', 'PPE_ALERT_CREATED', 'SAFETY_OFFICER', content);
    for (const [type, event, role, value] of [
      ['CHANGE', 'CHANGE_REQUESTED', 'SAFETY_OFFICER', content],
      ['SAFETY_ALERT', 'SAFETY_HANDOVER', 'SAFETY_OFFICER', content],
      ['SAFETY_ALERT', 'PPE_ALERT_CREATED', 'SITE_MANAGER', content],
      ['SAFETY_ALERT', 'PPE_ALERT_CREATED', 'SAFETY_OFFICER', {}],
      ['SAFETY_ALERT', 'PPE_ALERT_CREATED', 'SAFETY_OFFICER', { ...content, safetyAlert: {} }],
      [
        'SAFETY_ALERT',
        'PPE_ALERT_CREATED',
        'SAFETY_OFFICER',
        { ...content, safetyAlert: { ...metadata, cameraId: 42 } },
      ],
      [
        'SAFETY_ALERT',
        'PPE_ALERT_CREATED',
        'SAFETY_OFFICER',
        { ...content, safetyAlert: { ...metadata, candidateSubtype: 'ZONE_ENTRY_PROHIBITED' } },
      ],
      [
        'SAFETY_ALERT',
        'PPE_ALERT_CREATED',
        'SAFETY_OFFICER',
        { ...content, token: 'synthetic-forbidden-field' },
      ],
    ] as const) {
      await q.query('SAVEPOINT invalid_notice');
      await assert.rejects(
        insert(type, event, role, value),
        (e: unknown) => (e as { driverError?: { code: string } }).driverError?.code === '23514',
      );
      await q.query('ROLLBACK TO SAVEPOINT invalid_notice');
    }
    await insert('SAFETY_ALERT', 'PPE_ALERT_CREATED', 'SAFETY_OFFICER', {
      ...content,
      safetyAlert: { ...metadata, zoneId: null, zoneName: null },
    });
  } finally {
    await q.rollbackTransaction();
    await q.release();
  }
});

test('PPE migration restores the old schema without erasing old notification history and guards rollback', async () => {
  const f = await fixture();
  const migration = dataSource.migrations.find((m) =>
    (m.name ?? m.constructor.name).startsWith('PpeAlertNotifications'),
  );
  assert.ok(migration, 'PPE migration must be registered');
  const q = dataSource.createQueryRunner();
  await q.connect();
  await q.startTransaction();
  try {
    // Hide this test suite's prior PPE fixtures only inside the transaction; rollback restores them.
    await q.query("DELETE FROM user_notification WHERE request_type='SAFETY_ALERT'");
    await migration.down(q);
    const [old] = await q.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='user_notification' AND column_name='contractor_id'",
    );
    assert.equal(old.is_nullable, 'NO');
    const legacyId = randomUUID(),
      contractorId = randomUUID();
    await q.query('INSERT INTO contractor(id,code,name,is_active) VALUES($1,$2,$3,true)', [
      contractorId,
      contractorId,
      'Synthetic legacy contractor',
    ]);
    await q.query(
      `INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,recipient_role,request_type,request_id,event,content,read_at,deleted_at)
      VALUES($1,$2,$3,$4,'SAFETY_OFFICER','CHECKLIST',$5,'CHECKLIST_SUBMITTED',$6::jsonb,'2026-10-20T01:00:00Z','2026-10-20T02:00:00Z')`,
      [
        legacyId,
        f.safety.id,
        f.siteId,
        contractorId,
        randomUUID(),
        JSON.stringify({
          siteName: 'Legacy site',
          title: 'Legacy title',
          message: 'Keep authored content',
          checklistId: randomUUID(),
        }),
      ],
    );
    const legacyBefore = await q.query(
      'SELECT id,content,read_at,deleted_at,contractor_id FROM user_notification WHERE id=$1',
      [legacyId],
    );
    const [before] = await q.query('SELECT count(*)::int AS count FROM user_notification');
    await migration.up(q);
    const [after] = await q.query('SELECT count(*)::int AS count FROM user_notification');
    assert.equal(after.count, before.count);
    assert.deepEqual(
      await q.query(
        'SELECT id,content,read_at,deleted_at,contractor_id FROM user_notification WHERE id=$1',
        [legacyId],
      ),
      legacyBefore,
    );
    const ppeId = randomUUID();
    await q.query(
      `INSERT INTO user_notification(id,recipient_user_id,site_id,recipient_role,request_type,request_id,event,content)
      VALUES($1,$2,$3,'SAFETY_OFFICER','SAFETY_ALERT',$4,'PPE_ALERT_CREATED',$5::jsonb)`,
      [
        ppeId,
        f.safety.id,
        f.siteId,
        randomUUID(),
        JSON.stringify({
          siteName: 'Site',
          title: 'Review',
          message: 'Review',
          safetyAlert: {
            cameraId: f.cameraId,
            cameraName: 'Camera',
            zoneId: null,
            zoneName: null,
            candidateSubtype: 'PPE_HARD_HAT_MISSING',
          },
        }),
      ],
    );
    await assert.rejects(migration.down(q), /PPE notification history/);
    await q.query('UPDATE user_notification SET read_at=now(),deleted_at=now() WHERE id=$1', [
      ppeId,
    ]);
    await assert.rejects(migration.down(q), /PPE notification history/);
  } finally {
    await q.rollbackTransaction();
    await q.release();
  }
});

test('new persisted PPE alerts notify only current Safety recipients, even with unknown identity; retries and concurrent frames deduplicate', async () => {
  const f = await fixture();
  const event = f.event();
  const result = await f.ingestion.ingestEvent(event);
  const notices = await dataSource
    .getRepository(UserNotificationEntity)
    .findBy({ siteId: f.siteId });
  assert.equal(notices.length, 2);
  assert.deepEqual(
    notices.map((n) => n.recipientUserId).sort(),
    [f.safety.id, f.colleague.id].sort(),
  );
  for (const n of notices) {
    assert.equal(n.requestId, result.alertIds[0]);
    assert.equal(n.event, 'PPE_ALERT_CREATED');
    assert.equal(n.contractorId, null);
    assert.equal(n.workerId, null);
  }
  const list = await f.notifications.list(f.safety);
  assert.equal(list.unreadCount, 1);
  assert.deepEqual(list.items[0]!.target, {
    siteId: f.siteId,
    alertId: result.alertIds[0],
    tab: 'alerts',
  });
  assert.equal(JSON.stringify(list).includes('synthetic-not-a-password'), false);
  assert.equal((await f.ingestion.ingestEvent(event)).status, 'DUPLICATE_ACCEPTED');
  await Promise.all(Array.from({ length: 8 }, () => f.ingestion.ingestEvent(f.event())));
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    2,
  );
  const alert = await dataSource
    .getRepository(SafetyAlertEntity)
    .findOneByOrFail({ id: result.alertIds[0] });
  assert.equal(
    await dataSource.transaction((manager) =>
      f.notifications.recordPpeAlert(manager, alert, f.cameraId),
    ),
    0,
  );
  assert.equal(alert.detectionCount, 9);
  assert.equal(alert.candidateWorkerId, null);
  await dataSource
    .getRepository(SafetyAlertEntity)
    .update(alert.id, { status: AlertStatus.CLOSED });
  const next = await f.ingestion.ingestEvent(f.event());
  assert.notEqual(next.alertIds[0], alert.id);
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    4,
  );
});

test('PRESENT, non-required PPE, stale geometry, identity-only and Zone observations do not notify PPE', async () => {
  const f = await fixture();
  const ppe = {
    type: 'PPE',
    trackId: 1,
    ppeItem: 'HARD_HAT',
    status: 'MISSING',
    regionId: f.regionId,
    geometryVersion: 1,
  };
  for (const observations of [
    [{ ...ppe, status: 'PRESENT' }],
    [{ ...ppe, geometryVersion: 2 }],
    [{ type: 'IDENTITY_CANDIDATE', trackId: 1, status: 'UNKNOWN' }],
    [{ type: 'ZONE_ENTRY', trackId: 1, regionId: f.regionId, geometryVersion: 1 }],
  ])
    await f.ingestion.ingestEvent(f.event({ observations }));
  await dataSource.getRepository(ZoneEntity).update(f.zoneId, { requiredPpe: [] });
  await f.ingestion.ingestEvent(f.event({ observations: [ppe] }));
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    0,
  );
});

test('no eligible recipient preserves the alert, records a gap, and does not backfill when Safety joins', async (t) => {
  const f = await fixture();
  await dataSource
    .getRepository(UserEntity)
    .update([f.safety.id, f.colleague.id], { isActive: false });
  const warnings: unknown[] = [];
  t.mock.method(Logger.prototype, 'warn', (value: unknown) => warnings.push(value));
  const result = await f.ingestion.ingestEvent(f.event());
  assert.equal(result.alertIds.length, 1);
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    0,
  );
  assert.ok(
    warnings.some((w) => (w as { action?: string }).action === 'safety.ppe.notification.gap'),
  );
  await f.account();
  await f.ingestion.ingestEvent(f.event());
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    0,
  );
});

test('inbox failure rolls back raw event, alert and mapping, and a retry can succeed', async () => {
  const f = await fixture();
  const q = dataSource.createQueryRunner();
  const name = 'ppe_failure_' + f.siteId.replaceAll('-', '');
  await q.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.site_id='${f.siteId}'::uuid THEN RAISE EXCEPTION 'Synthetic PPE inbox failure'; END IF;
    RETURN NEW; END $$`);
  await q.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON user_notification FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );
  const event = f.event();
  try {
    await assert.rejects(f.ingestion.ingestEvent(event), /AI ingestion is temporarily unavailable/);
    assert.equal(
      await dataSource.getRepository(AiObservationEventEntity).countBy({ eventId: event.eventId }),
      0,
    );
    assert.equal(
      await dataSource.getRepository(SafetyAlertEntity).countBy({ siteId: f.siteId }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(AlertDetectionMappingEntity)
        .countBy({ eventId: event.eventId }),
      0,
    );
    assert.equal(
      await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
      0,
    );
  } finally {
    await q.query(`DROP TRIGGER ${name} ON user_notification`);
    await q.query(`DROP FUNCTION ${name}()`);
    await q.release();
  }
  await f.ingestion.ingestEvent(event);
  assert.equal(
    await dataSource.getRepository(UserNotificationEntity).countBy({ siteId: f.siteId }),
    2,
  );
});

test('read/delete is personal and never reviews alerts; current scope gates every inbox operation', async () => {
  const f = await fixture();
  const result = await f.ingestion.ingestEvent(f.event());
  const item = (await f.notifications.list(f.safety)).items[0];
  assert.ok(item, 'Safety must receive a PPE notification');
  await assert.rejects(f.notifications.read(f.foreign, item.id));
  await f.notifications.read(f.safety, item.id);
  assert.equal((await f.notifications.list(f.colleague)).unreadCount, 1);
  assert.equal(
    (await dataSource.getRepository(SafetyAlertEntity).findOneByOrFail({ id: result.alertIds[0] }))
      .status,
    AlertStatus.PENDING_REVIEW,
  );
  await dataSource
    .getRepository(UserRoleAssignmentEntity)
    .delete({ userId: f.safety.id, siteId: f.siteId });
  assert.deepEqual(await f.notifications.list(f.safety), { items: [], total: 0, unreadCount: 0 });
  await assert.rejects(f.notifications.read(f.safety, item.id));
  await assert.rejects(f.notifications.delete(f.safety, item.id));
  assert.equal((await f.notifications.readAll(f.safety)).updated, 0);
  assert.equal((await f.notifications.deleteRead(f.safety)).deleted, 0);
  await dataSource.getRepository(UserEntity).update(f.colleague.id, { isActive: false });
  assert.equal((await f.notifications.list(f.colleague)).total, 0);
});

test('HTTP ingestion to inbox, alert and evidence enforces current session/user/Site across all operations', async () => {
  const f = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'smartsite-ppe-http-'));
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    EVIDENCE_LOCAL_ROOT: root,
    HTTP_RATE_LIMIT_LIMIT: '1000',
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-ppe-service-token-for-tests-only',
  });
  const config = new ConfigService<ReturnType<typeof validateEnvironment>, true>(environment);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const password = 'SyntheticPpe123!';
    await dataSource.getRepository(UserEntity).update([f.safety.id, f.colleague.id, f.foreign.id], {
      passwordHash: await hashPassword(password),
    });
    const url = (await app.getUrl()) + '/api/v1';
    const request = (path: string, token: string, method = 'GET', body?: unknown) =>
      fetch(url + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function login(id: string) {
      const response = await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: id, password, clientType: 'MOBILE' }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as { accessToken: string; refreshToken: string };
    }
    const safety = await login(f.safety.id),
      colleague = await login(f.colleague.id),
      foreign = await login(f.foreign.id);
    const initial = f.event();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
    const event = {
      ...initial,
      evidence: [
        {
          kind: 'FRAME',
          uri: `local://evidence/${initial.streamSessionId}/1/${initial.eventId}.jpg`,
        },
      ],
    };
    await writeFile(join(root, `${event.streamSessionId}_1_${event.eventId}.jpg`), jpeg);
    const response = await request(
      '/integrations/ai/events',
      environment.SMARTSITE_AI_SERVICE_TOKEN,
      'POST',
      event,
    );
    assert.equal(response.status, 202);
    const result = (await response.json()) as { alertIds: string[] };
    const inbox = await request('/me/notifications?readStatus=UNREAD', safety.accessToken);
    assert.equal(inbox.status, 200);
    const list = (await inbox.json()) as UserNotificationListResponse;
    assert.equal(list.total, 1);
    assert.equal(list.unreadCount, 1);
    const item = list.items[0]!;
    assert.deepEqual(item.target, { siteId: f.siteId, alertId: result.alertIds[0], tab: 'alerts' });
    assert.equal(JSON.stringify(list).includes('local://'), false);
    const alertPath = `/sites/${f.siteId}/safety-alerts/${result.alertIds[0]}`;
    const evidencePath = alertPath + `/detections/${event.eventId}/evidence/0`;
    assert.equal((await request(alertPath, safety.accessToken)).status, 200);
    const evidence = await request(evidencePath, safety.accessToken);
    assert.equal(evidence.status, 200);
    assert.deepEqual(Buffer.from(await evidence.arrayBuffer()), jpeg);
    assert.equal((await request(alertPath, foreign.accessToken)).status, 403);
    assert.equal((await request(evidencePath, foreign.accessToken)).status, 403);
    assert.equal(
      (
        await request(
          `/sites/${f.otherSiteId}/safety-alerts/${result.alertIds[0]}`,
          foreign.accessToken,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(`/me/notifications/${item.id}/read`, colleague.accessToken, 'PATCH', {}))
        .status,
      404,
    );
    assert.equal(
      (await request(`/me/notifications/${item.id}/read`, safety.accessToken, 'PATCH', {})).status,
      200,
    );
    assert.equal((await f.notifications.list(f.colleague)).unreadCount, 1);
    await dataSource
      .getRepository(SafetyAlertEntity)
      .update(result.alertIds[0]!, { status: AlertStatus.DISMISSED });
    const history = await request(alertPath, safety.accessToken);
    assert.equal(((await history.json()) as { status: string }).status, 'DISMISSED');
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .delete({ userId: f.safety.id, siteId: f.siteId });
    const revoked = await request('/me/notifications', safety.accessToken);
    assert.deepEqual(await revoked.json(), { items: [], total: 0, unreadCount: 0 });
    for (const [path, method, body] of [
      [`/me/notifications/${item.id}/read`, 'PATCH', {}],
      [`/me/notifications/${item.id}`, 'DELETE', undefined],
    ] as const)
      assert.equal((await request(path, safety.accessToken, method, body)).status, 404);
    assert.equal(
      (
        (await (
          await request('/me/notifications/read-all', safety.accessToken, 'PATCH', {})
        ).json()) as { updated: number }
      ).updated,
      0,
    );
    assert.equal(
      (
        (await (await request('/me/notifications/read', safety.accessToken, 'DELETE')).json()) as {
          deleted: number;
        }
      ).deleted,
      0,
    );
    assert.equal((await request(alertPath, safety.accessToken)).status, 403);
    assert.equal((await request(evidencePath, safety.accessToken)).status, 403);
    await dataSource.getRepository(UserEntity).update(f.colleague.id, { isActive: false });
    assert.equal((await request('/me/notifications', colleague.accessToken)).status, 401);
    assert.equal((await request(evidencePath, colleague.accessToken)).status, 401);
    const logout = await request('/auth/logout', foreign.accessToken, 'POST', {
      refreshToken: foreign.refreshToken,
      clientType: 'MOBILE',
    });
    assert.equal(logout.status, 204);
    assert.equal((await request('/me/notifications', foreign.accessToken)).status, 401);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
