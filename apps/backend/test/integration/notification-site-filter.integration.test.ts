import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  SiteEntity,
  CameraEntity,
  CameraStatus,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  SafetyAlertEntity,
  AlertType,
  AlertStatus,
} from '../../src/database/entities/index.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('notification Site filter scopes rows, counts and bulk writes to current recipient grants', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const userId = randomUUID();
    await db.getRepository(UserEntity).insert({
      id: userId,
      username: userId,
      displayName: 'Synthetic Officer',
      passwordHash: 'synthetic-not-a-password',
      isActive: true,
      mustChangePassword: false,
    });
    const actor = { id: userId, isActive: true, mustChangePassword: false } as AuthenticatedUser;
    const service = new SchedulingNotificationService(db);
    const sites = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, siteId] of sites.entries()) {
      const cameraId = randomUUID();
      await db
        .getRepository(SiteEntity)
        .insert({ id: siteId, code: siteId, name: `Site ${index}` });
      await db.getRepository(CameraEntity).insert({
        id: cameraId,
        siteId,
        externalId: cameraId,
        code: cameraId,
        name: 'Synthetic camera',
        status: CameraStatus.ACTIVE,
      });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .insert({ id: randomUUID(), userId, siteId, role: UserRole.SAFETY_OFFICER });
      for (let n = 0; n <= index; n++) {
        const alert = db.getRepository(SafetyAlertEntity).create({
          id: randomUUID(),
          siteId,
          zoneId: null,
          alertType: AlertType.PPE_VIOLATION,
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          groupingKey: randomUUID(),
          status: AlertStatus.PENDING_REVIEW,
          firstDetectedAt: new Date(),
          lastDetectedAt: new Date(),
          detectionCount: 1,
        });
        await db.getRepository(SafetyAlertEntity).insert(alert);
        await db.transaction((manager) => service.recordPpeAlert(manager, alert, cameraId));
      }
    }
    // A once-authorized Site must disappear from both rows and the filter options.
    await db.getRepository(UserRoleAssignmentEntity).delete({ userId, siteId: sites[2] });
    const all = await service.list(actor);
    assert.equal(all.total, 3);
    assert.deepEqual(all.sites, [
      { id: sites[0], name: 'Site 0' },
      { id: sites[1], name: 'Site 1' },
    ]);
    const filtered = await service.list(actor, 'ALL', 1, 1, sites[1]);
    assert.equal(filtered.total, 2);
    assert.equal(filtered.unreadCount, 2);
    assert.equal(filtered.allSitesUnreadCount, 3);
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0]!.siteId, sites[1]);
    assert.deepEqual(filtered.sites, all.sites);
    assert.deepEqual(await service.readAll(actor, sites[0]), { updated: 1 });
    assert.equal((await service.list(actor, 'UNREAD', 0, 20, sites[0])).total, 0);
    assert.equal((await service.list(actor, 'UNREAD', 0, 20, sites[1])).unreadCount, 2);
    assert.deepEqual(await service.deleteRead(actor, sites[1]), { deleted: 0 });
    assert.deepEqual(await service.deleteRead(actor, sites[0]), { deleted: 1 });
    for (const foreign of [sites[2]!, randomUUID()]) {
      assert.equal((await service.list(actor, 'ALL', 0, 20, foreign)).total, 0);
      assert.deepEqual(await service.readAll(actor, foreign), { updated: 0 });
      assert.deepEqual(await service.deleteRead(actor, foreign), { deleted: 0 });
    }
    for (const bad of ['', 'not-a-site']) {
      await assert.rejects(service.list(actor, 'ALL', 0, 20, bad));
      await assert.rejects(service.readAll(actor, bad));
      await assert.rejects(service.deleteRead(actor, bad));
    }
    // Legacy no-filter commands still apply to all currently authorized notifications.
    assert.deepEqual(await service.readAll(actor), { updated: 2 });
    assert.deepEqual(await service.deleteRead(actor), { deleted: 2 });
  } finally {
    await owned.dispose();
  }
});
