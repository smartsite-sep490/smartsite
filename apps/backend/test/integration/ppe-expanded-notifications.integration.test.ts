import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import {
  AlertStatus,
  AlertType,
  CameraEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  SafetyAlertEntity,
  SiteEntity,
  UserEntity,
  UserNotificationEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../../src/database/entities/index.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const kinds = [
  'PPE_HARD_HAT_MISSING',
  'PPE_SAFETY_VEST_MISSING',
  'PPE_GLOVES_MISSING',
  'PPE_BOOTS_MISSING',
  'PPE_GOGGLES_MISSING',
];

test('five-kind notification migration profile, upgrade history, scope, deduplication and rollback', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const migrations = db.options.migrations;
  assert(Array.isArray(migrations));
  // This upgrade/down test owns the historical PPE boundary, not later migrations.
  const profile = migrations.filter((migration) => {
    assert(typeof migration === 'function');
    const timestamp = Number(migration.name.slice(-13));
    assert(Number.isSafeInteger(timestamp) && timestamp > 0);
    return timestamp <= 1793145600000;
  });
  assert(
    profile.some(
      (migration) =>
        typeof migration === 'function' &&
        migration.name === 'ExpandedPpeNotificationKinds1793145600000',
    ),
  );
  db.setOptions({ migrations: profile });
  const schema = (db.options as { schema: string }).schema;
  t.diagnostic(`ownedPpeNotificationSchema=${schema}`);
  try {
    await owned.initialize();
    const [migrationCount] = await db.query('SELECT count(*)::int AS count FROM migrations');
    t.diagnostic(`ppeProfileMigrationCount=${migrationCount.count}`);
    const [latest] = await db.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1');
    assert.equal(latest.name, 'ExpandedPpeNotificationKinds1793145600000');
    await db.undoLastMigration();
    const siteId = randomUUID(),
      otherSite = randomUUID(),
      cameraId = randomUUID();
    await db.getRepository(SiteEntity).save([
      { id: siteId, code: siteId, name: 'Synthetic PPE site' },
      { id: otherSite, code: otherSite, name: 'Other synthetic PPE site' },
    ]);
    await db.getRepository(CameraEntity).save({
      id: cameraId,
      siteId,
      externalId: cameraId,
      code: cameraId,
      name: 'Synthetic camera',
    });
    async function account(
      role: UserRole,
      site: string | null = siteId,
      active = true,
      blocked = false,
    ): Promise<AuthenticatedUser> {
      const id = randomUUID();
      await db.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic recipient',
        passwordHash: 'synthetic-not-a-password',
        isActive: active,
        mustChangePassword: blocked,
      });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, role, siteId: site });
      return {
        id,
        username: id,
        displayName: 'Synthetic recipient',
        isActive: active,
        mustChangePassword: blocked,
        roleAssignments: [{ role, siteId: site }],
      };
    }
    const safety = await account(UserRole.SAFETY_OFFICER);
    const colleague = await account(UserRole.SAFETY_OFFICER);
    const foreign = await account(UserRole.SAFETY_OFFICER, otherSite);
    const inactive = await account(UserRole.SAFETY_OFFICER, siteId, false);
    const blocked = await account(UserRole.SAFETY_OFFICER, siteId, true, true);
    const manager = await account(UserRole.SITE_MANAGER);
    const admin = await account(UserRole.ADMIN, null);
    const service = new SchedulingNotificationService(db);
    async function deliver(candidateSubtype: string, failAfterInsert = false) {
      return db.transaction(async (tx: EntityManager) => {
        const alert = await tx.getRepository(SafetyAlertEntity).save({
          id: randomUUID(),
          siteId,
          zoneId: null,
          alertType: AlertType.PPE_VIOLATION,
          candidateSubtype,
          groupingKey: randomUUID(),
          status: AlertStatus.PENDING_REVIEW,
          firstDetectedAt: new Date(),
          lastDetectedAt: new Date(),
          detectionCount: 1,
        });
        const inserted = await service.recordPpeAlert(tx, alert, cameraId);
        if (failAfterInsert) throw new Error('SYNTHETIC_TRANSACTION_FAILURE');
        return { alert, inserted };
      });
    }
    for (const kind of kinds.slice(0, 2)) assert.equal((await deliver(kind)).inserted, 2);
    const oldRows = await db.query(
      'SELECT id,content,created_at FROM user_notification ORDER BY id',
    );
    await assert.rejects(
      deliver(kinds[2]!),
      (error: unknown) =>
        !!error &&
        typeof error === 'object' &&
        'driverError' in error &&
        (error.driverError as { code: string }).code === '23514',
    );
    assert.deepEqual(
      await db.query('SELECT id,content,created_at FROM user_notification ORDER BY id'),
      oldRows,
    );
    const applied = await db.runMigrations();
    assert.deepEqual(
      applied.map((migration) => migration.name),
      ['ExpandedPpeNotificationKinds1793145600000'],
    );
    assert.deepEqual(
      await db.query('SELECT id,content,created_at FROM user_notification ORDER BY id'),
      oldRows,
    );
    for (const kind of kinds.slice(2)) {
      const result = await deliver(kind);
      assert.equal(result.inserted, 2);
      assert.equal(
        await db.transaction((tx) => service.recordPpeAlert(tx, result.alert, cameraId)),
        0,
      );
    }
    assert.equal(await db.getRepository(UserNotificationEntity).count(), 10);
    const list = await service.list(safety, 'ALL', 0, 100);
    assert.equal(list.total, 5);
    assert.deepEqual(
      new Set(list.items.map((item) => item.safetyAlert?.candidateSubtype)),
      new Set(kinds),
    );
    for (const item of list.items) {
      assert.equal(item.target.tab, 'alerts');
      assert.equal(item.siteId, siteId);
      assert.equal(item.safetyAlert?.cameraId, cameraId);
    }
    for (const actor of [foreign, manager, admin])
      assert.equal((await service.list(actor)).total, 0);
    for (const actor of [inactive, blocked]) {
      assert.equal(
        await db.getRepository(UserNotificationEntity).countBy({ recipientUserId: actor.id }),
        0,
      );
    }
    const beforeFailure = await db.getRepository(SafetyAlertEntity).count();
    await assert.rejects(deliver(kinds[2]!, true), /SYNTHETIC_TRANSACTION_FAILURE/);
    assert.equal(await db.getRepository(SafetyAlertEntity).count(), beforeFailure);
    assert.equal(await db.getRepository(UserNotificationEntity).count(), 10);
    const notice = list.items[0]!;
    await service.read(safety, notice.id);
    assert.equal((await service.list(safety)).unreadCount, 4);
    assert.equal((await service.list(colleague)).unreadCount, 5);
    await db.getRepository(UserRoleAssignmentEntity).delete({ userId: safety.id, siteId });
    assert.equal((await service.list(safety)).total, 0);
    await assert.rejects(service.read(safety, notice.id));
    await assert.rejects(
      db.undoLastMigration(),
      /Expanded PPE notification history must be retained/,
    );
    assert.equal(await db.getRepository(UserNotificationEntity).count(), 10);
    // The nullable PPE shape must not break pre-existing Contractor-scoped scheduling notices.
    const contractor = randomUUID();
    await db
      .getRepository(ContractorEntity)
      .save({ id: contractor, code: contractor, name: 'Synthetic contractor', isActive: true });
    await db.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      contractorId: contractor,
      siteId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: null,
    });
    await db.getRepository(UserNotificationEntity).save({
      id: randomUUID(),
      recipientUserId: manager.id,
      recipientRole: 'SITE_MANAGER',
      siteId,
      contractorId: contractor,
      workerId: null,
      requestType: 'CHANGE',
      requestId: randomUUID(),
      event: 'CHANGE_REQUESTED',
      content: {
        siteName: 'Synthetic PPE site',
        title: 'Legacy schedule review',
        message: 'Synthetic existing notice',
      },
    });
    assert.equal((await service.list(manager)).total, 1);
    assert.equal((await service.list(colleague)).total, 5);
  } finally {
    await owned.dispose();
  }
});
