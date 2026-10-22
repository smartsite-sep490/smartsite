import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ZoneAlertNotifications1793318400000 } from '../../src/database/migrations/1793318400000-ZoneAlertNotifications.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import {
  AlertStatus,
  AlertType,
  CameraEntity,
  SafetyAlertEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Zone notifications preserve PPE history, enforce recipient/context checks and refuse destructive rollback', async (t) => {
  const owned = createIsolatedTestDatabase({ preAuthorityCutover72: true });
  const db = owned.dataSource;
  try {
    await owned.initialize();
    t.diagnostic(`ownedZoneNotificationSchema=${(db.options as { schema: string }).schema}`);
    const siteId = randomUUID(),
      otherSite = randomUUID(),
      cameraId = randomUUID(),
      zoneId = randomUUID();
    await db.getRepository(SiteEntity).save([
      { id: siteId, code: siteId, name: 'Synthetic site' },
      { id: otherSite, code: otherSite, name: 'Other synthetic site' },
    ]);
    await db
      .getRepository(CameraEntity)
      .save({
        id: cameraId,
        siteId,
        externalId: cameraId,
        code: cameraId,
        name: 'Synthetic camera',
      });
    await db
      .getRepository(ZoneEntity)
      .save({
        id: zoneId,
        siteId,
        code: zoneId,
        name: 'Synthetic restricted Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
        requiredPpe: [],
      });
    async function account(role: UserRole, site: string | null): Promise<AuthenticatedUser> {
      const id = randomUUID();
      await db
        .getRepository(UserEntity)
        .save({
          id,
          username: id,
          displayName: 'Synthetic actor',
          passwordHash: 'synthetic-not-a-password',
          isActive: true,
          mustChangePassword: false,
        });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, role, siteId: site });
      return {
        id,
        username: id,
        displayName: 'Synthetic actor',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role, siteId: site }],
      };
    }
    const safety = await account(UserRole.SAFETY_OFFICER, siteId);
    const foreign = await account(UserRole.SAFETY_OFFICER, otherSite);
    const manager = await account(UserRole.SITE_MANAGER, siteId);
    const service = new SchedulingNotificationService(db);
    async function alert(type: AlertType, subtype: string) {
      return db
        .getRepository(SafetyAlertEntity)
        .save({
          id: randomUUID(),
          siteId,
          zoneId,
          alertType: type,
          candidateSubtype: subtype,
          groupingKey: randomUUID(),
          status: AlertStatus.PENDING_REVIEW,
          firstDetectedAt: new Date(),
          lastDetectedAt: new Date(),
          detectionCount: 1,
        });
    }
    const ppe = await alert(AlertType.PPE_VIOLATION, 'PPE_GOGGLES_MISSING');
    await db.transaction((tx) => service.recordPpeAlert(tx, ppe, cameraId));
    const original = await db.query(
      'SELECT id,content,created_at FROM user_notification ORDER BY id',
    );
    const zone = await alert(AlertType.RESTRICTED_ZONE_INTRUSION, 'ZONE_ENTRY_PROHIBITED');
    await assert.rejects(
      db.transaction((tx) => service.recordZoneAlert(tx, zone, cameraId)),
      (e: unknown) =>
        !!e &&
        typeof e === 'object' &&
        'driverError' in e &&
        (e.driverError as { code: string }).code === '23514',
    );
    const migration = new ZoneAlertNotifications1793318400000();
    async function migrate(direction: 'up' | 'down') {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await migration[direction](runner);
        await runner.commitTransaction();
      } catch (e) {
        await runner.rollbackTransaction();
        throw e;
      } finally {
        await runner.release();
      }
    }
    await migrate('up');
    await migrate('down');
    await migrate('up');
    assert.deepEqual(
      await db.query('SELECT id,content,created_at FROM user_notification ORDER BY id'),
      original,
    );
    assert.equal(await db.transaction((tx) => service.recordZoneAlert(tx, zone, cameraId)), 1);
    assert.equal(await db.transaction((tx) => service.recordZoneAlert(tx, zone, cameraId)), 0);
    const inbox = await service.list(safety, 'ALL', 0, 100);
    assert.equal(inbox.total, 2);
    const notice = inbox.items.find((item) => item.event === 'ZONE_ALERT_CREATED');
    assert(notice);
    assert.equal(notice.safetyAlert?.candidateSubtype, 'ZONE_ENTRY_PROHIBITED');
    assert.deepEqual(notice.target, { siteId, alertId: zone.id, tab: 'alerts' });
    assert.equal((await service.list(foreign)).total, 0);
    assert.equal((await service.list(manager)).total, 0);
    for (const change of [
      "recipient_role='SITE_MANAGER'",
      "request_type='CHANGE'",
      "content=jsonb_set(content,'{safetyAlert,candidateSubtype}','\"PPE_GOGGLES_MISSING\"'::jsonb)",
    ]) {
      await assert.rejects(
        db.transaction((tx) =>
          tx.query(`UPDATE user_notification SET ${change} WHERE id=$1`, [notice.id]),
        ),
        (e: unknown) =>
          !!e &&
          typeof e === 'object' &&
          'driverError' in e &&
          (e.driverError as { code: string }).code === '23514',
      );
    }
    await assert.rejects(migrate('down'), /history must be retained/);
    await db.getRepository(UserRoleAssignmentEntity).delete({ userId: safety.id });
    assert.equal((await service.list(safety)).total, 0);
  } finally {
    await owned.dispose();
  }
});
