import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IsNull } from 'typeorm';
import source from '../support/test-data-source.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { ScheduleAssignmentService } from '../../src/modules/workforce/scheduling/schedule-assignment.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ScheduleChangeNotifications1791849600002 } from '../../src/database/migrations/1791849600002-ScheduleChangeNotifications.js';
import { ScheduleAssignmentBatches1791849600001 } from '../../src/database/migrations/1791849600001-ScheduleAssignmentBatches.js';
import {
  SiteEntity,
  ContractorEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorShiftAssignmentEntity,
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  ScheduleAssignmentBatchEntity,
  AccessAuditEntity,
  AttendanceDayEntity,
  UserNotificationEntity,
} from '../../src/database/entities/index.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/scheduling/schedule-configuration.service.js';

test('team assignments: scope, finite recurrence, stale preview, concurrent retry, exceptions, protected attendance and rollback', async (t) => {
  await source.initialize();
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    repId = randomUUID(),
    teamId = randomUUID(),
    workerIds = [randomUUID(), randomUUID()],
    workerUserIds = [randomUUID(), randomUUID()],
    shiftId = randomUUID(),
    otherShift = randomUUID(),
    versionId = randomUUID();
  const rep: AuthenticatedUser = {
    id: repId,
    username: repId,
    displayName: 'Synthetic rep',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  const notifications = new SchedulingNotificationService(source);
  const service = new ScheduleAssignmentService(source, notifications);
  try {
    await source
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic bulk site' });
    await source
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await source.getRepository(UserEntity).save({
      id: repId,
      username: repId,
      displayName: 'Synthetic rep',
      passwordHash: 'synthetic-test-only',
      isActive: true,
      mustChangePassword: false,
    });
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, siteId, role: UserRole.SITE_MANAGER });
    await source.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: null,
    });
    await source
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), siteId, contractorId, userId: repId });
    await source.getRepository(UserEntity).save(
      workerUserIds.map((id) => ({
        id,
        username: id,
        displayName: 'Synthetic worker',
        passwordHash: 'synthetic-test-only',
        isActive: true,
        mustChangePassword: false,
      })),
    );
    await source.getRepository(UserRoleAssignmentEntity).save(
      workerUserIds.map((userId) => ({
        id: randomUUID(),
        userId,
        siteId,
        role: UserRole.WORKER,
      })),
    );
    await source.getRepository(WorkerEntity).save(
      workerIds.map((id, i) => ({
        id,
        userId: workerUserIds[i],
        siteId,
        contractorId,
        externalId: id,
        displayName: `Synthetic member ${i + 1}`,
        isActive: true,
      })),
    );
    await source.getRepository(ContractorTeamEntity).save({
      id: teamId,
      siteId,
      contractorId,
      name: 'Synthetic team',
      normalizedName: 'synthetic team',
      description: '',
      isActive: true,
      version: 1,
      createdBy: repId,
    });
    await source.getRepository(ContractorTeamMembershipEntity).save(
      workerIds.map((workerId) => ({
        id: randomUUID(),
        siteId,
        contractorId,
        teamId,
        workerId,
        joinedAt: new Date(),
        leftAt: null,
        assignedBy: repId,
        reason: '',
      })),
    );
    await source.getRepository(ShiftEntity).save([
      {
        id: shiftId,
        siteId,
        name: 'Morning',
        startsAt: new Date('2030-10-07T08:00:00Z'),
        endsAt: new Date('2030-10-07T17:00:00Z'),
        breakStartsAt: new Date('2030-10-07T12:00:00Z'),
        breakEndsAt: new Date('2030-10-07T13:00:00Z'),
        timezone: 'UTC',
      },
      {
        id: otherShift,
        siteId,
        name: 'Evening',
        startsAt: new Date('2030-10-07T18:00:00Z'),
        endsAt: new Date('2030-10-07T22:00:00Z'),
        timezone: 'UTC',
      },
    ]);
    await source.getRepository(ContractorShiftAssignmentEntity).save(
      [shiftId, otherShift].map((shiftId) => ({
        id: randomUUID(),
        siteId,
        contractorId,
        shiftId,
      })),
    );
    await source.getRepository(ScheduleVersionEntity).save({
      id: versionId,
      siteId,
      version: 1,
      effectiveFrom: new Date('2030-01-01'),
      effectiveUntil: null,
    });
    const input = {
      contractorId,
      scheduleVersionId: versionId,
      shiftId,
      target: 'TEAM' as const,
      teamId,
      mode: 'REPEAT' as const,
      fromDate: '2030-10-07',
      toDate: '2030-11-01',
      weekdays: [1, 2, 3, 4, 5],
    };
    const preview = await service.preview(rep, siteId, input);
    assert.equal(preview.assignmentCount, 40);
    assert.equal(preview.conflicts.length, 0);
    await assert.rejects(service.preview({ ...rep, id: randomUUID() }, siteId, input));
    await assert.rejects(service.preview(rep, randomUUID(), input));
    await assert.rejects(service.preview(rep, siteId, { ...input, contractorId: randomUUID() }));
    await assert.rejects(service.preview(rep, siteId, { ...input, teamId: randomUUID() }));
    const membership = await source
      .getRepository(ContractorTeamMembershipEntity)
      .findOneByOrFail({ workerId: workerIds[0]!, leftAt: IsNull() });
    await source
      .getRepository(ContractorTeamMembershipEntity)
      .update(membership.id, { leftAt: new Date() });
    await assert.rejects(
      service.create(rep, siteId, {
        ...input,
        requestId: randomUUID(),
        expectedFingerprint: preview.fingerprint,
      }),
      /preview changed/i,
    );
    assert.equal(await source.getRepository(WorkerScheduleEntity).countBy({ siteId }), 0);
    await source
      .getRepository(ContractorTeamMembershipEntity)
      .update(membership.id, { leftAt: null });
    const command = { ...input, requestId: randomUUID(), expectedFingerprint: preview.fingerprint };
    const concurrent = await Promise.all([
      service.create(rep, siteId, command),
      service.create(rep, siteId, command),
    ]);
    const batch = concurrent[0]!;
    assert.equal(concurrent[1]!.id, batch.id);
    assert.equal(await source.getRepository(WorkerScheduleEntity).countBy({ siteId }), 40);
    const reader = new ScheduleConfigurationService(source);
    assert.equal((await reader.listWorkerSchedules(rep, siteId, { contractorId })).total, 40);
    assert.equal(
      (await reader.listWorkerSchedules(rep, siteId, { contractorId: randomUUID() })).total,
      0,
    );
    await assert.rejects(
      reader.listWorkerSchedules({ ...rep, roleAssignments: [] }, siteId, { contractorId }),
      /Forbidden/,
    );
    await assert.rejects(
      reader.listWorkerSchedules(rep, randomUUID(), { contractorId }),
      /Forbidden/,
    );
    const conflict = await service.preview(rep, siteId, input);
    assert.equal(conflict.conflicts.length, 40);
    await assert.rejects(
      service.create(rep, siteId, {
        ...input,
        requestId: randomUUID(),
        expectedFingerprint: conflict.fingerprint,
      }),
      /conflict/i,
    );
    assert.equal(await source.getRepository(WorkerScheduleEntity).countBy({ siteId }), 40);
    const change = {
      requestId: randomUUID(),
      expectedVersion: 1,
      action: 'CHANGE_SHIFT' as const,
      scope: 'DAY' as const,
      workDate: '2030-10-07',
      workerId: workerIds[0]!,
      shiftId: otherShift,
      reason: 'Individual exception',
    };
    // Notification failure must roll back schedules, batch version and audit together.
    const delivery = t.mock.method(notifications, 'recordScheduleChange', async () => {
      throw new Error('Synthetic delivery failure');
    });
    await assert.rejects(service.change(rep, siteId, batch.id, change), /delivery failure/);
    delivery.mock.restore();
    assert.equal(
      (await source.getRepository(ScheduleAssignmentBatchEntity).findOneByOrFail({ id: batch.id }))
        .version,
      1,
    );
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, shiftId: otherShift }),
      0,
    );
    assert.equal(
      await source.getRepository(AccessAuditEntity).countBy({ id: change.requestId }),
      0,
    );
    const changed = await service.change(rep, siteId, batch.id, change);
    assert.equal(changed.version, 2);
    assert.deepEqual(await service.change(rep, siteId, batch.id, change), changed);
    const workerActor: AuthenticatedUser = {
      ...rep,
      id: workerUserIds[0]!,
      roleAssignments: [{ siteId, role: UserRole.WORKER }],
    };
    const inbox = await notifications.list(workerActor);
    assert.equal(inbox.unreadCount, 1);
    assert.equal(inbox.items[0]!.event, 'SCHEDULE_CHANGED');
    assert.equal(inbox.items[0]!.fromShiftName, 'Morning');
    assert.equal(inbox.items[0]!.toShiftName, 'Evening');
    assert.match(inbox.items[0]!.message, /Individual exception/);
    assert.deepEqual(inbox.items[0]!.target, { siteId, workDate: '2030-10-07', tab: 'schedule' });
    assert.equal((await notifications.list({ ...workerActor, id: workerUserIds[1]! })).total, 0);
    assert.equal((await notifications.list(rep)).total, 0);
    await assert.rejects(
      source.query(
        `INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content)
      SELECT $1,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,$2,event,content - 'workDate' FROM user_notification WHERE id=$3`,
        [randomUUID(), randomUUID(), inbox.items[0]!.id],
      ),
      /chk_notification_schedule_target/,
    );
    await source.getRepository(WorkerEntity).update(workerIds[0]!, { contractorId: null });
    assert.equal((await notifications.list(workerActor)).total, 0);
    await assert.rejects(notifications.read(workerActor, inbox.items[0]!.id));
    await source.getRepository(WorkerEntity).update(workerIds[0]!, { contractorId });
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: workerActor.id, siteId });
    assert.equal((await notifications.list(workerActor)).total, 0);
    await assert.rejects(notifications.read(workerActor, inbox.items[0]!.id));
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: workerActor.id, siteId, role: UserRole.WORKER });
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, shiftId: otherShift }),
      1,
    );
    await assert.rejects(
      service.change(rep, siteId, batch.id, { ...change, requestId: randomUUID() }),
      /changed/i,
    );
    const protectedRow = await source
      .getRepository(WorkerScheduleEntity)
      .findOneByOrFail({ siteId, workerId: workerIds[1]!, workDate: '2030-10-08' });
    await source.getRepository(AttendanceDayEntity).save({
      id: randomUUID(),
      siteId,
      workerId: workerIds[1]!,
      workDate: '2030-10-08',
      timezone: 'UTC',
      scheduleId: protectedRow.id,
      shiftName: 'Morning',
      startsAt: new Date('2030-10-08T08:00:00Z'),
      endsAt: new Date('2030-10-08T17:00:00Z'),
      status: 'IN_PROGRESS',
      regularMinutes: 0,
      overtimeMinutes: 0,
      provisionalMinutes: 0,
      anomalies: [],
      version: 1,
    });
    const cancel = {
      requestId: randomUUID(),
      expectedVersion: 2,
      action: 'CANCEL' as const,
      scope: 'FROM_DATE' as const,
      workDate: '2030-10-08',
      reason: 'Cancel remaining days',
    };
    await assert.rejects(service.change(rep, siteId, batch.id, cancel), /attendance/i);
    assert.equal(await source.getRepository(UserNotificationEntity).countBy({ siteId }), 1);
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, isActive: true }),
      40,
    );
    // A mixed batch must let the representative change future rows in one command,
    // while preserving started days and attendance snapshots.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-10-08T07:30:00Z') });
    const remaining = {
      ...change,
      requestId: randomUUID(),
      expectedVersion: 2,
      scope: 'UNSTARTED' as const,
      // Date is deliberately after the batch: this mode selects by actual start time.
      workDate: '2031-01-01',
      workerId: undefined,
    };
    await assert.rejects(service.change({ ...rep, id: randomUUID() }, siteId, batch.id, remaining));
    await assert.rejects(service.change(rep, randomUUID(), batch.id, remaining));
    const edited = await service.change(rep, siteId, batch.id, remaining);
    assert.equal(edited.changedCount, 37);
    assert.equal(edited.skippedCount, 3);
    assert.deepEqual(await service.change(rep, siteId, batch.id, remaining), edited);
    const bulkNotices = await source
      .getRepository(UserNotificationEntity)
      .findBy({ requestId: remaining.requestId });
    assert.equal(bulkNotices.length, 2);
    const protectedWorkerNotice = bulkNotices.find((notice) => notice.workerId === workerIds[1])!;
    assert.equal(protectedWorkerNotice.content.workDate, '2030-10-09');
    assert.doesNotMatch(protectedWorkerNotice.content.message, /2030-10-08/);
    assert.equal(
      (await source.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: protectedRow.id }))
        .shiftId,
      shiftId,
    );
    assert.equal(
      (
        await source
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ scheduleId: protectedRow.id })
      ).shiftName,
      'Morning',
    );
    const todayEdited = await source.getRepository(WorkerScheduleEntity).findOneByOrFail({
      siteId,
      workerId: workerIds[0]!,
      workDate: '2030-10-08',
    });
    assert.equal(todayEdited.shiftId, otherShift);
    t.mock.timers.setTime(new Date('2030-10-08T09:00:00Z').getTime());
    await assert.rejects(
      service.change(rep, siteId, batch.id, {
        ...remaining,
        requestId: randomUUID(),
        expectedVersion: 3,
        shiftId,
      }),
      /Started shifts/,
    );
    assert.equal(
      (await source.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: todayEdited.id }))
        .shiftId,
      otherShift,
    );
    t.mock.timers.setTime(new Date('2030-10-08T07:30:00Z').getTime());
    const cancelUnstarted = {
      ...remaining,
      requestId: randomUUID(),
      expectedVersion: 3,
      action: 'CANCEL' as const,
      workerId: workerIds[0]!,
    };
    const cancelled = await service.change(rep, siteId, batch.id, cancelUnstarted);
    assert.equal(cancelled.changedCount, 19);
    assert.equal(cancelled.skippedCount, 1);
    assert.deepEqual(await service.change(rep, siteId, batch.id, cancelUnstarted), cancelled);
    const cancelNotices = await source
      .getRepository(UserNotificationEntity)
      .findBy({ requestId: cancelUnstarted.requestId });
    assert.equal(cancelNotices.length, 1);
    assert.equal(cancelNotices[0]!.workerId, workerIds[0]);
    assert.equal(cancelNotices[0]!.event, 'SCHEDULE_CANCELLED');
    assert.match(cancelNotices[0]!.content.message, /19 schedule\(s\)/);
    const migrationRunner = source.createQueryRunner();
    await migrationRunner.connect();
    await migrationRunner.startTransaction();
    try {
      await assert.rejects(
        new ScheduleChangeNotifications1791849600002().down(migrationRunner),
        /history/,
      );
    } finally {
      await migrationRunner.rollbackTransaction();
      await migrationRunner.release();
    }
    assert.equal(
      (await source.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: protectedRow.id }))
        .isActive,
      true,
    );
    t.mock.timers.setTime(new Date('2030-12-01T00:00:00Z').getTime());
    await assert.rejects(
      service.change(rep, siteId, batch.id, {
        ...remaining,
        requestId: randomUUID(),
        expectedVersion: 4,
        action: 'CANCEL',
      }),
      /No unstarted schedules/,
    );
    assert.equal(
      (await source.getRepository(ScheduleAssignmentBatchEntity).findOneByOrFail({ id: batch.id }))
        .version,
      4,
    );
    t.mock.timers.reset();
    cancel.expectedVersion = 4;
    await source.getRepository(AttendanceDayEntity).delete({ siteId });
    await service.change(rep, siteId, batch.id, cancel);
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, isActive: true }),
      2,
    );
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await assert.rejects(new ScheduleAssignmentBatches1791849600001().down(runner), /history/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    assert.equal((await service.list(rep, siteId, contractorId)).total, 1);
    const newWorkerId = randomUUID();
    await source.getRepository(WorkerEntity).save({
      id: newWorkerId,
      siteId,
      contractorId,
      externalId: newWorkerId,
      displayName: 'New synthetic member',
      isActive: true,
    });
    await source.getRepository(ContractorTeamMembershipEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      teamId,
      workerId: newWorkerId,
      joinedAt: new Date(),
      assignedBy: repId,
      reason: '',
    });
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, workerId: newWorkerId }),
      0,
    );
    const additional = {
      ...input,
      selectedWorkerIds: [newWorkerId],
      fromDate: '2030-11-04',
      toDate: '2030-11-08',
    };
    const additionalPreview = await service.preview(rep, siteId, additional);
    assert.equal(additionalPreview.assignmentCount, 5);
    await service.create(rep, siteId, {
      ...additional,
      requestId: randomUUID(),
      expectedFingerprint: additionalPreview.fingerprint,
    });
    assert.equal(
      await source.getRepository(WorkerScheduleEntity).countBy({ siteId, workerId: newWorkerId }),
      5,
    );
    const single = {
      contractorId,
      scheduleVersionId: versionId,
      shiftId,
      target: 'WORKER' as const,
      workerId: workerIds[0]!,
      mode: 'DAY' as const,
      fromDate: '2030-12-01',
      toDate: '2030-12-01',
      weekdays: [1],
    };
    const singlePreview = await service.preview(rep, siteId, single);
    const competing = await Promise.allSettled(
      [1, 2].map(() =>
        service.create(rep, siteId, {
          ...single,
          requestId: randomUUID(),
          expectedFingerprint: singlePreview.fingerprint,
        }),
      ),
    );
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      await source
        .getRepository(WorkerScheduleEntity)
        .countBy({ siteId, workerId: single.workerId, workDate: single.fromDate }),
      1,
    );
    await assert.rejects(service.create(rep, siteId, { ...command, weekdays: [1] }), /different/i);
    const singleBatch = competing.find((result) => result.status === 'fulfilled');
    assert.ok(singleBatch && singleBatch.status === 'fulfilled');
    const noop = {
      ...change,
      requestId: randomUUID(),
      expectedVersion: 1,
      workDate: single.fromDate,
      shiftId,
    };
    await service.change(rep, siteId, singleBatch.value.id, noop);
    assert.equal(
      await source.getRepository(UserNotificationEntity).countBy({ requestId: noop.requestId }),
      0,
    );
    // A disabled linked account must not receive a notice even though its schedule can be corrected.
    await source.getRepository(UserEntity).update(workerActor.id, { isActive: false });
    const disabledChange = {
      ...noop,
      requestId: randomUUID(),
      expectedVersion: 2,
      shiftId: otherShift,
    };
    await service.change(rep, siteId, singleBatch.value.id, disabledChange);
    assert.equal(
      await source
        .getRepository(UserNotificationEntity)
        .countBy({ requestId: disabledChange.requestId }),
      0,
    );
    assert.equal((await notifications.list(workerActor)).total, 0);
    await source.getRepository(UserEntity).update(workerActor.id, { isActive: true });
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: repId });
    await assert.rejects(service.list(rep, siteId, contractorId));
  } finally {
    t.mock.timers.reset();
    await cleanupSiteAccess(source, [siteId]);
    await source.getRepository(ScheduleAssignmentBatchEntity).delete({ siteId });
    await source.getRepository(WorkerScheduleEntity).delete({ siteId });
    await source.getRepository(ContractorTeamMembershipEntity).delete({ siteId });
    await source.getRepository(ContractorTeamEntity).delete({ siteId });
    await source.getRepository(ContractorShiftAssignmentEntity).delete({ siteId });
    await source.getRepository(ShiftEntity).delete({ siteId });
    await source.getRepository(ScheduleVersionEntity).delete({ siteId });
    await source.getRepository(WorkerEntity).delete({ siteId });
    await source.getRepository(ContractorRepresentativeAssignmentEntity).delete({ siteId });
    await source.getRepository(ContractorSiteParticipationEntity).delete({ siteId });
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: repId });
    await source.getRepository(AccessAuditEntity).delete({ siteId });
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: workerUserIds[0]! });
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: workerUserIds[1]! });
    await source.getRepository(UserEntity).delete(repId);
    await source.getRepository(UserEntity).delete(workerUserIds);
    await source.getRepository(ContractorEntity).delete(contractorId);
    await source.getRepository(SiteEntity).delete(siteId);
    await source.destroy();
  }
});
