import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { ExpandedPpeNotificationKinds1793145600000 } from '../src/database/migrations/1793145600000-ExpandedPpeNotificationKinds.js';
import { AlertType } from '../src/database/entities/enums.js';
import type { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { SchedulingNotificationService } from '../src/modules/workforce/notifications/scheduling-notification.service.js';

const kinds = [
  'PPE_HARD_HAT_MISSING',
  'PPE_SAFETY_VEST_MISSING',
  'PPE_GLOVES_MISSING',
  'PPE_BOOTS_MISSING',
  'PPE_GOGGLES_MISSING',
];

test('PPE notifications retain all five explicit missing kinds, recipient scope and idempotency', async () => {
  const service = new SchedulingNotificationService({} as DataSource);
  for (const candidateSubtype of kinds) {
    const calls: { sql: string; parameters: unknown[] }[] = [];
    const manager = {
      async query(sql: string, parameters: unknown[]) {
        calls.push({ sql, parameters });
        if (sql.startsWith('SELECT DISTINCT')) return [{ id: randomUUID() }];
        if (sql.startsWith('SELECT s.name'))
          return [
            { site_name: 'Synthetic site', camera_name: 'Synthetic camera', zone_name: null },
          ];
        if (sql.startsWith('INSERT INTO user_notification')) return [{ id: randomUUID() }];
        assert.fail('Unexpected notification query');
      },
    } as unknown as EntityManager;
    const alert = {
      id: randomUUID(),
      siteId: randomUUID(),
      zoneId: null,
      alertType: AlertType.PPE_VIOLATION,
      candidateSubtype,
    } as SafetyAlertEntity;
    const camera = randomUUID();
    assert.equal(await service.recordPpeAlert(manager, alert, camera), 1);
    assert.equal(calls.length, 3);
    assert.match(calls[0]!.sql, /NOT u.must_change_password/);
    assert.match(calls[0]!.sql, /r.role='SAFETY_OFFICER'/);
    assert.deepEqual(calls[0]!.parameters, [alert.siteId]);
    assert.match(
      calls[2]!.sql,
      /ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING/,
    );
    assert.equal(calls[2]!.parameters[3], alert.id);
    const content = JSON.parse(calls[2]!.parameters.at(-1) as string);
    assert.equal(content.safetyAlert.candidateSubtype, candidateSubtype);
    assert.equal(content.safetyAlert.cameraId, camera);
  }
});

test('unsupported kinds and non-PPE alerts fail before persistence', async () => {
  const service = new SchedulingNotificationService({} as DataSource);
  let calls = 0;
  const manager = {
    async query() {
      calls++;
    },
  } as unknown as EntityManager;
  for (const [alertType, candidateSubtype] of [
    [AlertType.PPE_VIOLATION, 'PPE_MASK_MISSING'],
    [AlertType.PPE_VIOLATION, 'UNKNOWN'],
    [AlertType.RESTRICTED_ZONE_INTRUSION, 'PPE_GLOVES_MISSING'],
  ]) {
    await assert.rejects(
      service.recordPpeAlert(
        manager,
        { alertType, candidateSubtype } as SafetyAlertEntity,
        randomUUID(),
      ),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED',
    );
  }
  assert.equal(calls, 0);
});

test('expanded PPE migration refuses nontransactional execution before SQL', async () => {
  let calls = 0;
  const runner = {
    isTransactionActive: false,
    async query() {
      calls++;
    },
  } as unknown as QueryRunner;
  const migration = new ExpandedPpeNotificationKinds1793145600000();
  await assert.rejects(migration.up(runner), /requires a transaction/);
  await assert.rejects(migration.down(runner), /requires a transaction/);
  assert.equal(calls, 0);
});
