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
  AttendanceCorrectionEntity,
  OvertimeRequestEntity,
  ShiftChangeRequestEntity,
  ShiftSwapRequestEntity,
  ShiftRequestStatus,
} from '../../src/database/entities/index.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling/scheduling-workflow.service.js';

test('leave deadlines, both review routes, delegated entry and contractor boundaries share one workflow', async (t) => {
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
    await assert.rejects(
      scheduling.createAbsence(worker, siteId, {
        workerScheduleId: ended.id,
        noticeType: 'EMERGENCY',
        reason: 'Cannot report a finished shift',
      }),
      /shift that has ended/,
    );
    for (const kind of ['LEAVE', 'OVERTIME'] as const)
      await assert.rejects(
        days.request(worker, siteId, {
          requestId: randomUUID(),
          workerScheduleId: ended.id,
          kind,
          startsAt: kind === 'LEAVE' ? '2026-11-14T01:00:00Z' : '2026-11-14T13:00:00Z',
          endsAt: kind === 'LEAVE' ? '2026-11-14T10:00:00Z' : '2026-11-14T14:00:00Z',
          reason: 'A finished assigned shift cannot be selected',
        }),
        /shift that has ended/,
      );
    await assert.rejects(
      scheduling.createAbsence(worker, siteId, {
        workerScheduleId: (await schedule('2026-11-15')).id,
        noticeType: 'PLANNED',
        reason: 'Not enough advance notice',
      }),
      /at least 24 hours/,
    );
    t.mock.timers.setTime(Date.parse('2026-11-14T08:00:00Z'));
    const request = await scheduling.createAbsence(worker, siteId, {
      workerScheduleId: ended.id,
      noticeType: 'EMERGENCY',
      reason: 'Sudden illness; could not notify earlier',
    });
    assert.equal(request.noticeType, 'EMERGENCY');
    assert.equal(request.shortNotice, true);
    t.mock.timers.setTime(Date.parse('2026-11-14T12:00:00Z'));
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
    const next = await dataSource
      .getRepository(WorkerScheduleEntity)
      .findOneByOrFail({ siteId, workerId, workDate: '2026-11-15' });
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
    await assert.rejects(days.request(rep, siteId, input), /shifts taking place today/);
    t.mock.timers.setTime(Date.parse('2026-11-15T00:00:00Z'));
    await days.request(rep, siteId, input);
    t.mock.timers.setTime(Date.parse('2026-11-16T00:00:00Z'));
    await days.request(rep, siteId, input);
    t.mock.timers.setTime(Date.parse('2026-11-15T00:00:00Z'));
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
    const again = {
      workerScheduleId: future.id,
      noticeType: 'PLANNED' as const,
      reason: 'Second self submitted leave',
    };
    const againTime = {
      ...again,
      requestId: randomUUID(),
      kind: 'LEAVE' as const,
      startsAt: '2026-11-20T01:00:00Z',
      endsAt: '2026-11-20T10:00:00Z',
    };
    await assert.rejects(scheduling.createAbsence(worker, siteId, again), /once every 24 hours/);
    await assert.rejects(days.request(worker, siteId, againTime), /once every 24 hours/);
    const history = await days.myRequests(worker, siteId, { kind: 'LEAVE' });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.id, request.id);
    assert.equal(history.items[0]!.status, 'APPROVED');
    assert.equal(history.items[0]!.workDate, '2026-11-14');
    assert.ok(history.leaveAvailableAt);
    assert.ok(!history.items.some((row) => row.id === input.requestId));
    for (const denied of [rep, manager, outsider])
      await assert.rejects(days.myRequests(denied, siteId, {}));
    await assert.rejects(days.myRequests(worker, randomUUID(), {}));
    await assert.rejects(days.myRequests(worker, siteId, { workerId: randomUUID() } as never));
    // Existing review scenarios represent separate submissions, more than 24 hours apart.
    await dataSource.query(
      "UPDATE absence_request SET created_at=clock_timestamp()-interval '25 hours' WHERE site_id=$1 AND requested_by_user_id=$2",
      [siteId, worker.id],
    );
    const planned = await scheduling.createAbsence(worker, siteId, {
      workerScheduleId: future.id,
      noticeType: 'PLANNED',
      reason: 'Planned family appointment',
    });
    assert.equal(planned.shortNotice, false);
    await assert.rejects(scheduling.createAbsence(worker, siteId, again), /once every 24 hours/);
    await days.review(rep, siteId, planned.id, 'LEAVE', {
      approve: false,
      reviewNote: 'Please check dates',
    });
    await assert.rejects(days.request(worker, siteId, againTime), /once every 24 hours/);
    await dataSource.query(
      "UPDATE absence_request SET created_at=clock_timestamp()-interval '25 hours' WHERE site_id=$1 AND requested_by_user_id=$2",
      [siteId, worker.id],
    );
    // A worker who leaves ill after three real hours keeps those hours after approval.
    const partial = await schedule('2026-11-13');
    t.mock.timers.setTime(Date.parse('2026-11-13T04:00:00Z'));
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
    // The same idempotent command is allowed during cooldown; a new ID is rejected.
    await days.request(worker, siteId, {
      requestId: partialId,
      workerScheduleId: partial.id,
      kind: 'LEAVE',
      noticeType: 'EMERGENCY',
      startsAt: stopsAt.toISOString(),
      endsAt: '2026-11-13T10:00:00Z',
      reason: 'Illness during the shift',
    });
    await assert.rejects(
      days.request(worker, siteId, {
        requestId: randomUUID(),
        workerScheduleId: partial.id,
        kind: 'LEAVE',
        noticeType: 'EMERGENCY',
        startsAt: stopsAt.toISOString(),
        endsAt: '2026-11-13T10:00:00Z',
        reason: 'Another request',
      }),
      /once every 24 hours/,
    );
    t.mock.timers.setTime(Date.parse('2026-11-13T12:00:00Z'));
    await days.review(rep, siteId, partialId, 'LEAVE', { approve: true });
    const worked = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ id: day.id });
    assert.equal(worked.confirmedMinutes, 180);
    assert.equal(worked.regularMinutes, 180);
    await dataSource.query(
      "UPDATE absence_request SET created_at=clock_timestamp()-interval '24 hours' WHERE site_id=$1 AND requested_by_user_id=$2",
      [siteId, worker.id],
    );
    const raceA = await schedule('2026-11-21'),
      raceB = await schedule('2026-11-22');
    const race = await Promise.allSettled([
      scheduling.createAbsence(worker, siteId, { ...again, workerScheduleId: raceA.id }),
      days.request(worker, siteId, {
        ...againTime,
        requestId: randomUUID(),
        workerScheduleId: raceB.id,
        startsAt: '2026-11-22T01:00:00Z',
        endsAt: '2026-11-22T10:00:00Z',
      }),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
    const page = await days.myRequests(worker, siteId, { limit: 1, offset: 1 });
    assert.equal(page.total, 4);
    assert.equal(page.items.length, 1);
    const exact = await days.timeRequests(rep, siteId, { kind: 'LEAVE', requestId: planned.id });
    assert.equal(exact.items.length, 1);
    assert.equal(exact.items[0]!.id, planned.id);
    assert.equal(exact.items[0]!.status, 'REJECTED');
    const notices = await notifications.list(rep, 'ALL', 0, 100);
    const notice = notices.items.find(
      (n) =>
        n.event === 'TIME_REQUESTED' &&
        'requestId' in n.target &&
        n.target.requestId === request.id,
    );
    assert.ok(notice);
    assert.equal('requestType' in notice.target && notice.target.requestType, 'TIME');
    const peerId = randomUUID();
    await dataSource
      .getRepository(WorkerEntity)
      .save({ ...workerRecord, id: peerId, userId: outsider.id, externalId: peerId });
    const peerSchedule = await dataSource
      .getRepository(WorkerScheduleEntity)
      .save({ ...raceA, id: randomUUID(), workerId: peerId });
    const session = await dataSource
      .getRepository(AttendanceSessionEntity)
      .findOneByOrFail({ dayId: day.id });
    await dataSource.getRepository(AttendanceCorrectionEntity).save({
      id: randomUUID(),
      attendanceSessionId: session.id,
      requestedBy: worker.id,
      expectedSessionVersion: session.version,
      proposedInAt: startsAt,
      proposedOutAt: stopsAt,
      reason: 'Correct my recorded interval',
      status: 'REJECTED',
      reviewNote: 'Original evidence retained',
    });
    await dataSource.getRepository(OvertimeRequestEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      scheduleId: raceA.id,
      expectedShiftId: shift.id,
      startsAt: new Date('2026-11-21T11:00:00Z'),
      endsAt: new Date('2026-11-21T12:00:00Z'),
      requestedBy: worker.id,
      reason: 'Additional assigned task',
      status: 'PENDING',
    });
    await dataSource.getRepository(ShiftChangeRequestEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      workerScheduleId: raceA.id,
      fromShiftId: shift.id,
      toShiftId: shift.id,
      expectedScheduleVersionId: version.id,
      status: ShiftRequestStatus.PENDING_MANAGER,
      requestedByUserId: worker.id,
      reason: 'Synthetic shift change history',
    });
    await dataSource.getRepository(ShiftSwapRequestEntity).save({
      id: randomUUID(),
      siteId,
      requesterWorkerId: workerId,
      requesterWorkerScheduleId: raceA.id,
      coworkerWorkerId: peerId,
      coworkerWorkerScheduleId: peerSchedule.id,
      requesterShiftId: shift.id,
      coworkerShiftId: shift.id,
      expectedScheduleVersionId: version.id,
      status: ShiftRequestStatus.APPLIED,
      requestedByUserId: worker.id,
      reason: 'Synthetic swap history',
    });
    const allKinds = await days.myRequests(worker, siteId, {});
    for (const row of allKinds.items) {
      assert.equal(typeof row.workDate, 'string');
      assert.match(row.workDate!, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.deepEqual([...new Set(allKinds.items.map((r) => r.kind))].sort(), [
      'CHANGE',
      'CORRECTION',
      'LEAVE',
      'OVERTIME',
      'SWAP',
    ]);
    const correctionHistory = await days.myRequests(worker, siteId, {
      kind: 'CORRECTION',
      status: 'REJECTED',
    });
    assert.equal(correctionHistory.total, 1);
    assert.equal(correctionHistory.items[0]!.reviewNote, 'Original evidence retained');
    assert.equal(correctionHistory.items[0]!.dayId, day.id);
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .delete({ siteId, userId: otherRep.id });
    await assert.rejects(scheduling.approveAbsence(otherRep, siteId, planned.id));
  } finally {
    await cleanupSiteAccess(dataSource, [siteId]);
    for (const table of [
      'shift_swap_request',
      'shift_change_request',
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
