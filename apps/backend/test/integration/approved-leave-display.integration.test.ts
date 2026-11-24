import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/scheduling/schedule-configuration.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling/scheduling-workflow.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import {
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
} from '../../src/database/entities/index.js';

test('approved leave is shown on calendars; covered pending requests disappear only from Worker lists', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-01-01T00:00:00Z') });
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      contractorId = randomUUID(),
      workerId = randomUUID();
    const workerUser = randomUUID(),
      repUser = randomUUID();
    await db
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic leave Site' });
    await db
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await db.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: null,
    });
    const actor = (id: string, role: UserRole) => ({
      id,
      username: id,
      displayName: id,
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId, role }],
    });
    const worker = actor(workerUser, UserRole.WORKER),
      rep = actor(repUser, UserRole.CONTRACTOR_REPRESENTATIVE);
    for (const a of [worker, rep]) {
      await db.getRepository(UserEntity).save({
        id: a.id,
        username: a.id,
        displayName: 'Synthetic user',
        passwordHash: 'synthetic-unused',
        isActive: true,
        mustChangePassword: false,
      });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: a.id, siteId, role: a.roleAssignments[0]!.role });
    }
    await db
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), userId: rep.id, siteId, contractorId });
    await db.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      contractorId,
      userId: worker.id,
      externalId: workerId,
      displayName: 'Synthetic Worker',
      isActive: true,
    });
    const shift = await db.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Synthetic morning',
      startsAt: new Date('2030-01-01T01:00Z'),
      endsAt: new Date('2030-01-01T05:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const version = await db.getRepository(ScheduleVersionEntity).save({
      id: randomUUID(),
      siteId,
      version: 1,
      effectiveFrom: new Date('2020-01-01'),
      effectiveUntil: null,
    });
    const schedule = await db.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: shift.id,
      scheduleVersionId: version.id,
      workDate: '2030-01-02',
      isActive: true,
    });
    const reconciliation = new AttendanceReconciliationService(
        db,
        new SchedulingNotificationService(db),
      ),
      days = new AttendanceDaysService(db, reconciliation);
    const calendars = new ScheduleConfigurationService(db),
      workflow = new SchedulingWorkflowService(db);
    const pending = await db.getRepository(AbsenceRequestEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      workerScheduleId: schedule.id,
      shiftId: shift.id,
      expectedScheduleVersionId: version.id,
      requestedByUserId: worker.id,
      reason: 'Synthetic legacy pending request',
      status: AbsenceRequestStatus.PENDING_MANAGER,
      startsAt: null,
      endsAt: null,
    });
    const approved = await db.getRepository(AbsenceRequestEntity).save({
      ...pending,
      id: randomUUID(),
      startsAt: new Date('2030-01-02T01:00Z'),
      endsAt: new Date('2030-01-02T05:00Z'),
      reason: 'Synthetic full shift leave',
    });

    assert.equal((await days.timeRequests(worker, siteId, { kind: 'LEAVE' })).total, 2);
    assert.equal(
      (await calendars.listWorkerSchedules(worker, siteId)).items[0]!.approvedFullShiftLeave,
      false,
    );
    await days.review(rep, siteId, approved.id, 'LEAVE', { approve: true });
    await t.test(
      'inactive full-leave schedule exposes approved leave and cannot be swapped through the API',
      async () => {
        const result = await calendars.listWorkerSchedules(worker, siteId);
        assert.equal(result.items[0]!.approvedFullShiftLeave, true);
        assert.equal(result.items[0]!.isActive, false);
        await assert.rejects(
          workflow.createShiftSwap(worker, siteId, {
            requesterWorkerScheduleId: schedule.id,
            coworkerWorkerScheduleId: randomUUID(),
            reason: 'Attempt forbidden swap',
          }),
        );
        await assert.rejects(calendars.listSwapCandidates(worker, siteId, schedule.id));
        await assert.rejects(calendars.listWorkerSchedules(worker, randomUUID()));
      },
    );
    await t.test(
      'Worker pages/counts/status filters hide the covered duplicate, while review and exact history retain it',
      async () => {
        const list = await days.timeRequests(worker, siteId, { kind: 'LEAVE', limit: 1 });
        assert.equal(list.total, 1);
        assert.equal(list.items[0]!.id, approved.id);
        assert.equal(list.items[0]!.status, 'APPROVED');
        assert.equal(
          (await days.timeRequests(worker, siteId, { kind: 'LEAVE', status: 'PENDING' })).total,
          0,
        );
        assert.equal((await days.myRequests(worker, siteId, { kind: 'LEAVE' })).total, 1);
        assert.equal(
          (await days.myRequests(worker, siteId, { requestId: pending.id })).items[0]!.status,
          'PENDING_MANAGER',
        );
        assert.equal(
          (await days.timeRequests(worker, siteId, { kind: 'LEAVE', requestId: pending.id })).total,
          1,
        );
        assert.equal((await days.timeRequests(rep, siteId, { kind: 'LEAVE' })).total, 2);
        assert.equal(
          (await db.getRepository(AbsenceRequestEntity).findOneByOrFail({ id: pending.id })).status,
          'PENDING_MANAGER',
        );
      },
    );
    await t.test(
      'partial approval does not label the entire shift as leave or hide a longer pending interval',
      async () => {
        await db
          .getRepository(AbsenceRequestEntity)
          .update(approved.id, { endsAt: new Date('2030-01-02T03:00Z') });
        await db.getRepository(WorkerScheduleEntity).update(schedule.id, { isActive: true });
        assert.equal(
          (await calendars.listWorkerSchedules(worker, siteId)).items[0]!.approvedFullShiftLeave,
          false,
        );
        assert.equal((await days.timeRequests(worker, siteId, { kind: 'LEAVE' })).total, 2);
        assert.equal((await days.myRequests(worker, siteId, { kind: 'LEAVE' })).total, 2);
        await db.getRepository(AbsenceRequestEntity).update(pending.id, {
          startsAt: new Date('2030-01-02T01:00Z'),
          endsAt: new Date('2030-01-02T02:00Z'),
        });
        assert.equal((await days.timeRequests(worker, siteId, { kind: 'LEAVE' })).total, 1);
      },
    );
  } finally {
    await owned.dispose();
  }
});
