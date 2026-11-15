import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import dataSource from '../support/test-data-source.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { approvedWorkerDocuments } from '../support/approved-worker-documents.js';
import {
  SiteEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  AbsenceRequestEntity,
  AttendanceDayEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
} from '../../src/database/entities/index.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling/scheduling-workflow.service.js';

test('late leave, both review routes, delegated entry and contractor boundaries share one workflow', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T12:00:00Z') });
  await dataSource.initialize();
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID();
  const userIds = Array.from({ length: 5 }, () => randomUUID());
  const [workerUser, repUser, otherRepUser, managerUser, outsiderUser] = userIds as [
    string,
    string,
    string,
    string,
    string,
  ];
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
  const otherRep = actor(otherRepUser, UserRole.CONTRACTOR_REPRESENTATIVE);
  const manager = actor(managerUser, UserRole.SITE_MANAGER),
    outsider = actor(outsiderUser, UserRole.CONTRACTOR_REPRESENTATIVE);
  const notifications = new SchedulingNotificationService(dataSource);
  const reconciliation = new AttendanceReconciliationService(dataSource, notifications);
  const days = new AttendanceDaysService(dataSource, reconciliation);
  const scheduling = new SchedulingWorkflowService(dataSource, notifications, reconciliation, days);
  try {
    await dataSource
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic leave site' });
    for (const a of [worker, rep, otherRep, manager, outsider]) {
      await dataSource.getRepository(UserEntity).save({
        id: a.id,
        username: a.id,
        displayName: a.id,
        passwordHash: 'synthetic-not-login',
        isActive: true,
        mustChangePassword: false,
      });
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: a.id, siteId, role: a.roleAssignments[0]!.role });
    }
    await dataSource
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      isActive: true,
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validUntil: null,
    });
    for (const userId of [repUser, otherRepUser])
      await dataSource
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .save({ id: randomUUID(), userId, siteId, contractorId });
    await dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      contractorId,
      userId: workerUser,
      externalId: workerId,
      displayName: 'Synthetic sick worker',
      isActive: true,
    });
    await approvedWorkerDocuments(dataSource, [workerId], repUser);
    const shift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: '08-17',
      startsAt: new Date('2026-11-01T01:00:00Z'),
      endsAt: new Date('2026-11-01T10:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const version = await dataSource.getRepository(ScheduleVersionEntity).save({
      id: randomUUID(),
      siteId,
      version: 1,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      effectiveUntil: null,
    });
    const schedule = async (workDate: string) =>
      dataSource.getRepository(WorkerScheduleEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        shiftId: shift.id,
        scheduleVersionId: version.id,
        workDate,
        isActive: true,
      });
    const ended = await schedule('2026-11-14');
    const request = await scheduling.createAbsence(worker, siteId, {
      workerScheduleId: ended.id,
      noticeType: 'EMERGENCY',
      reason: 'Sudden illness; could not notify earlier',
    });
    assert.equal(request.noticeType, 'EMERGENCY');
    assert.equal(request.shortNotice, true);
    const pendingDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ scheduleId: ended.id });
    assert.equal(pendingDay.status, 'NEEDS_REVIEW');
    assert.ok(pendingDay.anomalies.includes('PENDING_LEAVE'));
    assert.equal(pendingDay.confirmedMinutes, null);
    for (const denied of [worker, manager, outsider]) {
      await assert.rejects(scheduling.approveAbsence(denied, siteId, request.id));
      await assert.rejects(days.review(denied, siteId, request.id, 'LEAVE', { approve: true }));
    }
    await scheduling.approveAbsence(rep, siteId, request.id);
    await scheduling.approveAbsence(rep, siteId, request.id); // Retry is idempotent across routes.
    const approvedDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ id: pendingDay.id });
    assert.equal(approvedDay.confirmedMinutes, 0);
    assert.ok(!approvedDay.anomalies.includes('PENDING_LEAVE'));
    const next = await schedule('2026-11-15');
    const input = {
      requestId: randomUUID(),
      workerScheduleId: next.id,
      kind: 'LEAVE' as const,
      startsAt: '2026-11-15T01:00:00Z',
      endsAt: '2026-11-15T10:00:00Z',
      noticeType: 'EMERGENCY' as const,
      reason: 'Worker is in hospital; recorded on their behalf',
    };
    await assert.rejects(days.request(manager, siteId, input));
    await assert.rejects(days.request(outsider, siteId, input));
    await days.request(rep, siteId, input);
    await days.request(rep, siteId, input);
    const saved = await dataSource
      .getRepository(AbsenceRequestEntity)
      .findOneByOrFail({ id: input.requestId });
    assert.equal(saved.requestedByUserId, rep.id);
    assert.equal(saved.shortNotice, true);
    const listed = (await days.timeRequests(otherRep, siteId, { kind: 'LEAVE', status: 'PENDING' }))
      .items;
    assert.equal(listed.find((r) => r.id === input.requestId)?.submittedOnBehalf, true);
    assert.ok(listed.find((r) => r.id === input.requestId)?.createdAt);
    await assert.rejects(scheduling.approveAbsence(rep, siteId, input.requestId));
    await assert.rejects(days.request(rep, siteId, { ...input, kind: 'OVERTIME' }));
    await assert.rejects(
      scheduling.rejectAbsence(otherRep, siteId, input.requestId, { reason: ' ' }),
    );
    await scheduling.rejectAbsence(otherRep, siteId, input.requestId, {
      reason: 'Incorrect dates; please resubmit',
    });
    assert.equal(
      (
        await dataSource
          .getRepository(AbsenceRequestEntity)
          .findOneByOrFail({ id: input.requestId })
      ).status,
      'REJECTED',
    );
    const future = await schedule('2026-11-20');
    const planned = await scheduling.createAbsence(worker, siteId, {
      workerScheduleId: future.id,
      noticeType: 'PLANNED',
      reason: 'Planned family appointment',
    });
    assert.equal(planned.shortNotice, false);
    // A worker who leaves ill after three real hours keeps those hours after approval.
    const partial = await schedule('2026-11-13');
    const workerRecord = await dataSource
      .getRepository(WorkerEntity)
      .findOneByOrFail({ id: workerId });
    const startsAt = new Date('2026-11-13T01:00:00Z'),
      stopsAt = new Date('2026-11-13T04:00:00Z');
    const day = await dataSource.transaction((em) =>
      reconciliation.ensureDay(em, workerRecord, startsAt, partial, {
        ...shift,
        startsAt,
        endsAt: new Date('2026-11-13T10:00:00Z'),
      }),
    );
    const events = await dataSource.getRepository(AttendanceEventEntity).save([
      {
        id: randomUUID(),
        siteId,
        workerId,
        shiftAssignmentId: partial.id,
        kind: 'CHECK_IN' as const,
        method: 'MANUAL' as const,
        occurredAt: startsAt,
        reasonCode: 'SYNTHETIC_TEST',
      },
      {
        id: randomUUID(),
        siteId,
        workerId,
        shiftAssignmentId: partial.id,
        kind: 'CHECK_OUT' as const,
        method: 'MANUAL' as const,
        occurredAt: stopsAt,
        reasonCode: 'SYNTHETIC_TEST',
      },
    ]);
    await dataSource.getRepository(AttendanceSessionEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      dayId: day.id,
      shiftAssignmentId: partial.id,
      checkInEventId: events[0]!.id,
      checkOutEventId: events[1]!.id,
      effectiveInAt: startsAt,
      effectiveOutAt: stopsAt,
      status: 'MATCHED',
      version: 1,
    });
    const partialId = randomUUID();
    await days.request(worker, siteId, {
      requestId: partialId,
      workerScheduleId: partial.id,
      kind: 'LEAVE',
      noticeType: 'EMERGENCY',
      startsAt: stopsAt.toISOString(),
      endsAt: '2026-11-13T10:00:00Z',
      reason: 'Illness during the shift',
    });
    await days.review(rep, siteId, partialId, 'LEAVE', { approve: true });
    const worked = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ id: day.id });
    assert.equal(worked.confirmedMinutes, 180);
    assert.equal(worked.regularMinutes, 180);
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .delete({ siteId, userId: otherRep.id });
    await assert.rejects(scheduling.approveAbsence(otherRep, siteId, planned.id));
  } finally {
    await cleanupSiteAccess(dataSource, [siteId]);
    for (const table of [
      'absence_request',
      'worker_schedule',
      'shift',
      'schedule_version',
      'contractor_representative_assignment',
      'worker',
      'contractor_site_participation',
    ])
      await dataSource.query(`DELETE FROM ${table} WHERE site_id=$1`, [siteId]);
    await dataSource.getRepository(ContractorEntity).delete(contractorId);
    await dataSource.query('DELETE FROM user_role_assignment WHERE user_id=ANY($1)', [userIds]);
    await dataSource.getRepository(UserEntity).delete(userIds);
    await dataSource.getRepository(SiteEntity).delete(siteId);
    await dataSource.destroy();
  }
});
