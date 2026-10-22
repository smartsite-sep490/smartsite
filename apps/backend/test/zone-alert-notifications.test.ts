import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { AlertType } from '../src/database/entities/enums.js';
import type { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { SchedulingNotificationService } from '../src/modules/workforce/notifications/scheduling-notification.service.js';

test('zone entry notification keeps same-site Safety recipients, typed event, context and deduplication', async () => {
  const service = new SchedulingNotificationService({} as DataSource);
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const manager = {
    async query(sql: string, parameters: unknown[]) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT DISTINCT')) return [{ id: randomUUID() }];
      if (sql.startsWith('SELECT s.name'))
        return [
          { site_name: 'Synthetic site', camera_name: 'Tapo demo', zone_name: 'Restricted demo' },
        ];
      if (sql.startsWith('INSERT INTO user_notification')) return [{ id: randomUUID() }];
      assert.fail('Unexpected notification query');
    },
  } as unknown as EntityManager;
  const alert = {
    id: randomUUID(),
    siteId: randomUUID(),
    zoneId: randomUUID(),
    alertType: AlertType.RESTRICTED_ZONE_INTRUSION,
    candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
  } as SafetyAlertEntity;
  const record = service as SchedulingNotificationService & {
    recordZoneAlert(
      manager: EntityManager,
      alert: SafetyAlertEntity,
      cameraId: string,
    ): Promise<number>;
  };
  assert.equal(await record.recordZoneAlert(manager, alert, randomUUID()), 1);
  assert.deepEqual(calls[0]!.parameters, [alert.siteId]);
  assert.match(calls[0]!.sql, /r.role='SAFETY_OFFICER'/);
  assert.match(
    calls[2]!.sql,
    /ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING/,
  );
  assert(calls[2]!.parameters.includes('ZONE_ALERT_CREATED'));
  const content = JSON.parse(calls[2]!.parameters.at(-1) as string);
  assert.equal(content.safetyAlert.candidateSubtype, 'ZONE_ENTRY_PROHIBITED');
  assert.equal(content.safetyAlert.zoneId, alert.zoneId);
});
