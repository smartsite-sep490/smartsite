import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import dataSource from '../support/test-data-source.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import {
  AccessAttemptEntity,
  GateEventEntity,
  SiteEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  WorkerEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
  AttendanceDayEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  UserNotificationEntity,
  AccessAuditEntity,
  OvertimeRequestEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
} from '../../src/database/entities/index.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceService } from '../../src/modules/workforce/attendance/attendance.service.js';
import { workDateAt } from '../../src/modules/workforce/attendance/attendance-calculation.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/scheduling/schedule-configuration.service.js';

test('MF03: interval totals, missing checkout, notifications, approvals, scope and database concurrency', async (t) => {
  // Keep generated day shifts away from midnight in both UTC and the site timezone.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 8, 2) });
  await dataSource.initialize();
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID(),
    userId = randomUUID(),
    repId = randomUUID(),
    managerId = randomUUID(),
    securityId = randomUUID(),
    outsiderId = randomUUID();
  const ids = [userId, repId, managerId, securityId, outsiderId];
  const notifications = new SchedulingNotificationService(dataSource),
    reconciliation = new AttendanceReconciliationService(dataSource, notifications),
    days = new AttendanceDaysService(dataSource, reconciliation),
    attendance = new AttendanceService(dataSource, reconciliation);
  const actor = (id: string, role: UserRole) => ({
    id,
    username: id,
    displayName: id,
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role, siteId }],
  });
  const workerActor = actor(userId, UserRole.WORKER),
    repActor = actor(repId, UserRole.CONTRACTOR_REPRESENTATIVE),
    managerActor = actor(managerId, UserRole.SITE_MANAGER);
  const date = '2026-10-01',
    at = (time: string | Date) =>
      time instanceof Date ? time : new Date(`${date}T${time}:00+07:00`);
  try {
    await dataSource
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic MF03 site' });
    for (const id of ids)
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: id,
        passwordHash: 'synthetic-not-login',
        isActive: true,
        mustChangePassword: false,
      });
    for (const [id, role] of [
      [userId, UserRole.WORKER],
      [repId, UserRole.CONTRACTOR_REPRESENTATIVE],
      [managerId, UserRole.SITE_MANAGER],
      [securityId, UserRole.SECURITY_OFFICER],
      [outsiderId, UserRole.WORKER],
    ] as const)
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, siteId, role });
    await dataSource.getRepository(ContractorEntity).save({
      id: contractorId,
      code: contractorId,
      name: 'Synthetic MF03 contractor',
      isActive: true,
    });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      contractorId,
      siteId,
      isActive: true,
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validUntil: null,
    });
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, contractorId, siteId });
    const worker = await dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      userId,
      siteId,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic Worker',
      isActive: true,
    });
    const shift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: '08-17',
      startsAt: new Date('2026-09-01T01:00:00Z'),
      endsAt: new Date('2026-09-01T10:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const version = await dataSource.getRepository(ScheduleVersionEntity).save({
      id: randomUUID(),
      siteId,
      version: 1,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      effectiveUntil: null,
    });
    const schedule = await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: shift.id,
      scheduleVersionId: version.id,
      workDate: date,
      isActive: true,
    });
    // A scheduled worker without any passage must still get an attendance day.
    await reconciliation.runDue(at('16:59'));
    assert.equal(await dataSource.getRepository(AttendanceDayEntity).countBy({ siteId }), 0);
    await Promise.all([
      reconciliation.runDue(at('17:00')),
      new AttendanceReconciliationService(dataSource, notifications).runDue(at('17:00')),
    ]);
    const absentDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: date });
    assert.equal(absentDay.status, 'ABSENT');
    assert.equal(absentDay.regularMinutes, 0);
    assert.equal(absentDay.confirmedMinutes, null);
    await reconciliation.runDue(at('18:00'));
    const absenceNotifications = await dataSource
      .getRepository(UserNotificationEntity)
      .findBy({ siteId, event: 'ABSENT' });
    assert.deepEqual(
      absenceNotifications.map((n) => n.recipientUserId).sort(),
      [userId, repId].sort(),
    );
    assert.equal(
      (await days.list(workerActor, siteId, { status: 'ABSENT' })).items[0]?.status,
      'ABSENT',
    );
    assert.equal(
      (await days.list(repActor, siteId, { status: 'ABSENT' })).items[0]?.id,
      absentDay.id,
    );
    assert.equal((await days.list(actor(outsiderId, UserRole.WORKER), siteId, {})).items.length, 0);
    await assert.rejects(() =>
      days.detail(actor(outsiderId, UserRole.WORKER), siteId, absentDay.id),
    );
    const approvedLeave = await dataSource.getRepository(AbsenceRequestEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      workerScheduleId: schedule.id,
      shiftId: shift.id,
      expectedScheduleVersionId: version.id,
      requestedByUserId: userId,
      status: AbsenceRequestStatus.APPROVED,
      reason: 'Synthetic approved full shift leave',
    });
    await dataSource.getRepository(UserNotificationEntity).delete({ siteId, event: 'ABSENT' });
    await reconciliation.runDue(at('18:00'));
    assert.equal(
      (await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({ id: absentDay.id }))
        .status,
      'CONFIRMED',
    );
    assert.equal(
      await dataSource.getRepository(UserNotificationEntity).countBy({ siteId, event: 'ABSENT' }),
      0,
    );
    await dataSource.getRepository(AbsenceRequestEntity).delete(approvedLeave.id);
    await dataSource.getRepository(UserNotificationEntity).delete({ siteId, event: 'ABSENT' });
    await dataSource.query('DELETE FROM timesheet WHERE attendance_day_id=$1', [absentDay.id]);
    await dataSource.getRepository(AttendanceDayEntity).delete(absentDay.id);
    await dataSource.getRepository(WorkerScheduleEntity).update(schedule.id, { isActive: false });
    await reconciliation.runDue(at('18:00'));
    assert.equal(await dataSource.getRepository(AttendanceDayEntity).countBy({ siteId }), 0);
    const absentNightShift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Synthetic overnight shift',
      startsAt: new Date('2026-09-01T15:00:00Z'),
      endsAt: new Date('2026-09-01T23:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const nightSchedule = await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: absentNightShift.id,
      scheduleVersionId: version.id,
      workDate: '2026-10-02',
      isActive: true,
    });
    await reconciliation.runDue(new Date('2026-10-03T05:59:00+07:00'));
    assert.equal(await dataSource.getRepository(AttendanceDayEntity).countBy({ siteId }), 0);
    await reconciliation.runDue(new Date('2026-10-03T06:00:00+07:00'));
    const absentNightDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId });
    assert.equal(absentNightDay.workDate, '2026-10-02');
    assert.equal(absentNightDay.status, 'ABSENT');
    await dataSource.getRepository(UserNotificationEntity).delete({ siteId, event: 'ABSENT' });
    await dataSource.getRepository(AttendanceDayEntity).delete(absentNightDay.id);
    await dataSource.getRepository(WorkerScheduleEntity).delete(nightSchedule.id);
    await dataSource.getRepository(ShiftEntity).delete(absentNightShift.id);
    await dataSource.getRepository(WorkerScheduleEntity).update(schedule.id, { isActive: true });
    const passage = async (
      direction: 'IN' | 'OUT',
      time: string | Date,
      method: 'FACE' | 'QR' = 'FACE',
    ) =>
      dataSource.transaction(async (manager) => {
        const attempt = await manager.getRepository(AccessAttemptEntity).save({
          id: randomUUID(),
          siteId,
          gateId: 'gate-north-01',
          operatorId: securityId,
          direction,
          method,
          workerId,
          workerAssignmentId: null,
          visitId: null,
          credentialId: null,
          identityStatus: 'MATCHED',
          authorizationStatus: 'ALLOWED',
          scheduleStatus: 'SCHEDULED',
          reasonCode: 'SYNTHETIC_VERIFIED',
          status: 'USED',
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(),
          usedAt: at(time),
        });
        const event = await manager.getRepository(GateEventEntity).save({
          id: randomUUID(),
          accessAttemptId: attempt.id,
          siteId,
          workerId,
          visitId: null,
          direction,
          occurredAt: at(time),
          gateName: 'gate-north-01',
          idempotencyKey: randomUUID(),
          recordedBy: securityId,
        });
        await reconciliation.recordPassage(manager, event, attempt, worker);
        await reconciliation.recordPassage(manager, event, attempt, worker);
        return event;
      });
    await passage('IN', '07:45');
    await passage('OUT', '11:00', 'QR');
    await passage('IN', '13:00');
    let day = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId });
    await dataSource.transaction((manager) => reconciliation.refresh(manager, day.id, at('17:04')));
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ siteId, event: 'MISSING_CHECKOUT' }),
      0,
    );
    await Promise.all([1, 2].map(() => reconciliation.runDue(at('17:05'))));
    day = await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({ id: day.id });
    assert.equal(day.provisionalMinutes, 435);
    assert.equal(day.confirmedMinutes, null);
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ siteId, event: 'MISSING_CHECKOUT' }),
      2,
    );
    await reconciliation.runDue(at('17:10'));
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ siteId, event: 'MISSING_CHECKOUT' }),
      2,
    );
    const last = await passage('OUT', '17:20', 'QR');
    day = await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({ id: day.id });
    assert.equal(day.status, 'CONFIRMED');
    assert.equal(day.confirmedMinutes, 435);
    assert.equal(await dataSource.getRepository(AttendanceEventEntity).countBy({ siteId }), 4);
    assert.equal(await dataSource.getRepository(AttendanceSessionEntity).countBy({ siteId }), 2);
    const legacy = await attendance.record(
      actor(securityId, UserRole.SECURITY_OFFICER),
      siteId,
      last.id,
      { requestId: randomUUID(), kind: 'CHECK_OUT' },
    );
    assert.equal(legacy.status, 'MATCHED');
    assert.equal((await days.list(workerActor, siteId, {})).items.length, 1);
    assert.equal((await days.list(actor(outsiderId, UserRole.WORKER), siteId, {})).items.length, 0);
    assert.equal(
      (await notifications.list(repActor)).items.some((n) => n.event === 'MISSING_CHECKOUT'),
      true,
    );
    const request = {
      requestId: randomUUID(),
      workerScheduleId: schedule.id,
      kind: 'LEAVE' as const,
      startsAt: at('15:00').toISOString(),
      endsAt: at('17:00').toISOString(),
      reason: 'Synthetic partial leave',
    };
    await days.request(workerActor, siteId, request);
    await days.request(workerActor, siteId, request);
    const requestNotice = await dataSource.getRepository(UserNotificationEntity).findOneByOrFail({
      requestId: request.requestId,
      event: 'TIME_REQUESTED',
      recipientUserId: repActor.id,
    });
    assert.equal(
      await dataSource.getRepository(UserNotificationEntity).existsBy({
        requestId: request.requestId,
        event: 'TIME_REQUESTED',
        recipientUserId: workerActor.id,
      }),
      false,
    );
    // Legacy copies remain auditable but must not appear in a Worker's inbox/count.
    const legacyNotice = await dataSource.getRepository(UserNotificationEntity).save({
      ...requestNotice,
      id: randomUUID(),
      recipientUserId: workerActor.id,
      recipientRole: 'WORKER' as const,
      workerId,
    });
    assert.equal(
      (await notifications.list(workerActor)).items.some((n) => n.id === legacyNotice.id),
      false,
    );
    await assert.rejects(notifications.read(workerActor, legacyNotice.id));
    await assert.rejects(
      days.review(actor(outsiderId, UserRole.WORKER), siteId, request.requestId, 'LEAVE', {
        approve: true,
        reviewNote: 'Wrong scope',
      }),
    );
    await assert.rejects(
      days.review(repActor, siteId, request.requestId, 'LEAVE', { approve: true }),
    );
    await days.review(managerActor, siteId, request.requestId, 'LEAVE', {
      approve: true,
    });
    await days.review(managerActor, siteId, request.requestId, 'LEAVE', { approve: true });
    assert.equal(
      (await notifications.list(workerActor)).items.some((n) => n.event === 'TIME_APPROVED'),
      true,
    );
    day = await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({ id: day.id });
    assert.equal(day.confirmedMinutes, 315);
    const rawBefore = await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId });
    assert.equal(rawBefore.length, 4);
    await assert.rejects(
      dataSource.getRepository(WorkerScheduleEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        shiftId: shift.id,
        scheduleVersionId: version.id,
        workDate: date,
        isActive: true,
      }),
    );
    await assert.rejects(
      days.request(workerActor, siteId, {
        ...request,
        requestId: randomUUID(),
        kind: 'OVERTIME',
        startsAt: at('17:00').toISOString(),
        endsAt: at('18:00').toISOString(),
      }),
      /before/,
    );
    const future = new Date(Date.now() + 86400000),
      futureEnd = new Date(+future + 3600000);
    const futureShift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Future shift',
      startsAt: new Date(+future - 2 * 3600000),
      endsAt: future,
      timezone: 'UTC',
    });
    const futureSchedule = await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: futureShift.id,
      scheduleVersionId: version.id,
      workDate: workDateAt(futureShift.startsAt, 'UTC'),
      isActive: true,
    });
    const overtime = {
      ...request,
      workerScheduleId: futureSchedule.id,
      requestId: randomUUID(),
      kind: 'OVERTIME' as const,
      startsAt: future.toISOString(),
      endsAt: futureEnd.toISOString(),
    };
    await days.request(workerActor, siteId, overtime);
    const changedOvertime = {
      ...overtime,
      requestId: randomUUID(),
      startsAt: futureEnd.toISOString(),
      endsAt: new Date(+futureEnd + 3600000).toISOString(),
    };
    await days.request(workerActor, siteId, changedOvertime);
    await dataSource
      .getRepository(ShiftEntity)
      .update({ id: futureShift.id }, { endsAt: new Date(+futureEnd + 3600000) });
    await assert.rejects(
      days.review(managerActor, siteId, changedOvertime.requestId, 'OVERTIME', {
        approve: true,
        reviewNote: 'Must reject changed shift overlap',
      }),
      /outside/,
    );
    await dataSource.getRepository(ShiftEntity).update({ id: futureShift.id }, { endsAt: future });
    await days.review(managerActor, siteId, changedOvertime.requestId, 'OVERTIME', {
      approve: false,
      reviewNote: 'Cancel changed shift request',
    });
    assert.equal(
      (await notifications.list(workerActor)).items.some((n) => n.event === 'TIME_REJECTED'),
      true,
    );
    await days.review(managerActor, siteId, overtime.requestId, 'OVERTIME', {
      approve: true,
    });
    assert.deepEqual(
      await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId }),
      rawBefore,
    );
    assert.equal((await days.detail(workerActor, siteId, day.id)).sessions.length, 2);
    assert.equal((await days.timesheets(workerActor, siteId, {})).items[0]?.totalMinutes, 315);
    await assert.rejects(days.detail(actor(outsiderId, UserRole.WORKER), siteId, day.id));
    t.mock.timers.setTime(+futureEnd);
    await passage('IN', futureShift.startsAt);
    await passage('OUT', new Date(+future + 30 * 60000), 'QR');
    await reconciliation.runDue(futureEnd);
    const futureDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: futureSchedule.workDate });
    assert.equal(futureDay.regularMinutes, 120);
    assert.equal(futureDay.overtimeMinutes, 30);
    assert.equal(futureDay.status, 'NEEDS_REVIEW');
    await days.acknowledge(managerActor, siteId, futureDay.id, {
      expectedVersion: futureDay.version,
      reviewNote: 'Verified early overtime departure',
    });
    assert.equal((await days.detail(workerActor, siteId, futureDay.id)).day.confirmedMinutes, 150);
    assert.equal((await days.timesheets(workerActor, siteId, {})).items[0]?.totalMinutes, 465);
    const unassignedIn = new Date(+futureEnd + 86400000);
    await passage('IN', unassignedIn);
    const unassignedDay = await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({
      siteId,
      workerId,
      workDate: workDateAt(unassignedIn, 'Asia/Ho_Chi_Minh'),
    });
    assert.ok(unassignedDay.anomalies.includes('NO_SCHEDULE'));
    assert.equal(unassignedDay.confirmedMinutes, null);
    const recoveredShift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Recovered shift',
      startsAt: new Date(+unassignedIn + 3600000),
      endsAt: new Date(+unassignedIn + 3 * 3600000),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: recoveredShift.id,
      scheduleVersionId: version.id,
      workDate: unassignedDay.workDate,
      isActive: true,
    });
    await reconciliation.runDue(new Date(+unassignedIn + 2 * 3600000));
    await passage('OUT', recoveredShift.endsAt, 'QR');
    assert.equal(
      (await days.detail(workerActor, siteId, unassignedDay.id)).day.confirmedMinutes,
      120,
    );
    const nightDate = workDateAt(new Date(+futureEnd + 3 * 86400000), 'Asia/Ho_Chi_Minh');
    const nightStart = new Date(`${nightDate}T22:00:00+07:00`),
      nightEnd = new Date(+nightStart + 8 * 3600000);
    const nightShift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Night shift template',
      startsAt: new Date('2020-10-01T15:00:00Z'),
      endsAt: new Date('2020-10-01T23:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: nightShift.id,
      scheduleVersionId: version.id,
      workDate: nightDate,
      isActive: true,
    });
    await passage('IN', new Date(+nightStart + 10 * 60000));
    await passage('OUT', nightEnd, 'QR');
    const nightDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: nightDate });
    assert.equal(nightDay.confirmedMinutes, 470);
    assert.equal(workDateAt(nightEnd, 'Asia/Ho_Chi_Minh') === nightDate, false);
    const firstDate = workDateAt(new Date(+futureEnd + 5 * 86400000), 'Asia/Ho_Chi_Minh');
    const firstStart = new Date(`${firstDate}T08:00:00+07:00`),
      firstEnd = new Date(+firstStart + 9 * 3600000),
      secondStart = new Date(+firstStart + 86400000),
      secondEnd = new Date(+secondStart + 9 * 3600000);
    const reusableShift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Reusable day shift',
      startsAt: firstStart,
      endsAt: firstEnd,
      timezone: 'Asia/Ho_Chi_Minh',
    });
    for (const start of [firstStart, secondStart])
      await dataSource.getRepository(WorkerScheduleEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        shiftId: reusableShift.id,
        scheduleVersionId: version.id,
        workDate: workDateAt(start, 'Asia/Ho_Chi_Minh'),
        isActive: true,
      });
    await passage('IN', firstStart);
    await passage('IN', secondStart);
    await passage('OUT', secondEnd);
    await reconciliation.runDue(secondEnd);
    const forgotten = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: firstDate });
    const following = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: workDateAt(secondStart, 'Asia/Ho_Chi_Minh') });
    assert.equal(forgotten.confirmedMinutes, null);
    assert.ok(forgotten.anomalies.includes('MISSING_OUT'));
    assert.equal(following.confirmedMinutes, 540);
    const legacyEvents = await dataSource.getRepository(AttendanceEventEntity).save(
      Array.from({ length: 100 }, () => ({
        id: randomUUID(),
        siteId,
        workerId,
        workerAssignmentId: null,
        shiftAssignmentId: null,
        kind: 'CHECK_IN' as const,
        method: 'FACE' as const,
        gateEventId: null,
        occurredAt: secondEnd,
        recordedBy: securityId,
        reasonCode: 'NORMAL_CHECK_IN',
      })),
    );
    await dataSource.getRepository(AttendanceSessionEntity).save(
      legacyEvents.map((event) => ({
        id: randomUUID(),
        siteId,
        workerId,
        dayId: null,
        shiftAssignmentId: null,
        checkInEventId: event.id,
        checkOutEventId: null,
        effectiveInAt: secondEnd,
        effectiveOutAt: new Date(+secondEnd + 1000),
        status: 'MATCHED' as const,
        version: 1,
        appliedCorrectionId: null,
      })),
    );
    assert.equal((await attendance.overview(workerActor, siteId)).sessions.length, 100);
    assert.equal(
      (await attendance.overview(workerActor, siteId, { dayId: day.id })).sessions.length,
      2,
    );
    assert.equal(
      (await attendance.overview(actor(outsiderId, UserRole.WORKER), siteId, { dayId: day.id }))
        .sessions.length,
      0,
    );
    const totalBeforeCorrection = (await days.timesheets(workerActor, siteId, {})).items[0]!
      .totalMinutes;
    const firstSession = (await days.detail(workerActor, siteId, day.id)).sessions[0]!;
    const rawEvents = await dataSource
      .getRepository(AttendanceEventEntity)
      .find({ where: { siteId }, order: { id: 'ASC' } });
    const correction = await attendance.requestCorrection(workerActor, siteId, firstSession.id, {
      requestId: randomUUID(),
      expectedSessionVersion: firstSession.version,
      proposedInAt: at('08:30').toISOString(),
      proposedOutAt: at('11:00').toISOString(),
      reason: 'Correct verified late start',
    });
    assert.equal((await days.detail(workerActor, siteId, day.id)).day.confirmedMinutes, null);
    const reviews = await Promise.allSettled([
      attendance.reviewCorrection(managerActor, siteId, correction.id, {
        approve: true,
        reviewNote: 'Verified late start',
      }),
      attendance.reviewCorrection(managerActor, siteId, correction.id, {
        approve: true,
        reviewNote: 'Competing approval',
      }),
    ]);
    assert.equal(reviews.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await days.detail(workerActor, siteId, day.id)).day.confirmedMinutes, 285);
    assert.ok(
      (await attendance.overview(repActor, siteId, { dayId: day.id })).corrections.some(
        (item) => item.id === correction.id && item.status === 'APPROVED',
      ),
    );
    assert.equal(
      (await days.timesheets(workerActor, siteId, {})).items[0]!.totalMinutes,
      totalBeforeCorrection - 30,
    );
    assert.deepEqual(
      await dataSource
        .getRepository(AttendanceEventEntity)
        .find({ where: { siteId }, order: { id: 'ASC' } }),
      rawEvents,
    );
    const leaveStart = new Date(+secondStart + 86400000),
      leaveEnd = new Date(+leaveStart + 9 * 3600000);
    const leaveSchedule = await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: reusableShift.id,
      scheduleVersionId: version.id,
      workDate: workDateAt(leaveStart, 'Asia/Ho_Chi_Minh'),
      isActive: true,
    });
    const wholeLeaveId = randomUUID();
    await days.request(workerActor, siteId, {
      requestId: wholeLeaveId,
      workerScheduleId: leaveSchedule.id,
      kind: 'LEAVE',
      startsAt: leaveStart.toISOString(),
      endsAt: leaveEnd.toISOString(),
      reason: 'Approved whole shift leave',
    });
    await days.review(managerActor, siteId, wholeLeaveId, 'LEAVE', {
      approve: true,
      reviewNote: 'Approved whole shift',
    });
    await reconciliation.runDue(leaveEnd);
    const leaveDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ scheduleId: leaveSchedule.id });
    assert.equal(leaveDay.confirmedMinutes, 0);
    assert.ok(!leaveDay.anomalies.includes('EARLY_CHECKOUT'));
    assert.equal(
      (
        await dataSource
          .getRepository(WorkerScheduleEntity)
          .findOneByOrFail({ id: leaveSchedule.id })
      ).isActive,
      false,
    );
    const issueStart = new Date(+leaveStart + 86400000),
      issueEnd = new Date(+issueStart + 9 * 3600000);
    await dataSource.getRepository(WorkerScheduleEntity).save({
      id: randomUUID(),
      siteId,
      workerId,
      shiftId: reusableShift.id,
      scheduleVersionId: version.id,
      workDate: workDateAt(issueStart, 'Asia/Ho_Chi_Minh'),
      isActive: true,
    });
    await passage('IN', issueStart);
    await passage('IN', new Date(+issueStart + 3600000));
    await passage('OUT', new Date(+issueStart + 2 * 3600000));
    await passage('OUT', new Date(+issueStart + 3 * 3600000));
    await passage('IN', new Date(+issueStart + 3.5 * 3600000));
    t.mock.timers.setTime(+issueEnd + 5 * 60000);
    await reconciliation.runDue(new Date());
    const issueDay = await dataSource
      .getRepository(AttendanceDayEntity)
      .findOneByOrFail({ siteId, workerId, workDate: workDateAt(issueStart, 'Asia/Ho_Chi_Minh') });
    const issueDetail = await days.detail(managerActor, siteId, issueDay.id);
    const duplicate = issueDetail.sessions.find((session) => session.status === 'NEEDS_REVIEW')!;
    const missingEntry = issueDetail.sessions.find((session) => session.status === 'MISSING_IN')!;
    const openInterval = issueDetail.sessions.find((session) => session.status === 'MISSING_OUT')!;
    assert.equal(duplicate.canIgnoreDuplicate, true);
    assert.equal(duplicate.rawInAt, new Date(+issueStart + 3600000).toISOString());
    assert.equal(duplicate.rawOutAt, null);
    const ignoreInput = {
      expectedSessionVersion: duplicate.version,
      reason: 'Confirmed duplicate face scan',
    };
    await assert.rejects(days.ignoreDuplicate(workerActor, siteId, duplicate.id, ignoreInput));
    await assert.rejects(
      days.ignoreDuplicate(
        actor(securityId, UserRole.SECURITY_OFFICER),
        siteId,
        duplicate.id,
        ignoreInput,
      ),
    );
    await assert.rejects(
      days.ignoreDuplicate(managerActor, randomUUID(), duplicate.id, ignoreInput),
    );
    await assert.rejects(
      days.ignoreDuplicate(managerActor, siteId, duplicate.id, {
        ...ignoreInput,
        expectedSessionVersion: 999,
      }),
    );
    await assert.rejects(
      days.ignoreDuplicate(managerActor, siteId, missingEntry.id, {
        ...ignoreInput,
        expectedSessionVersion: missingEntry.version,
      }),
    );
    const issueRaw = await dataSource
      .getRepository(AttendanceEventEntity)
      .find({ where: { siteId }, order: { id: 'ASC' } });
    await Promise.all([
      days.ignoreDuplicate(managerActor, siteId, duplicate.id, ignoreInput),
      days.ignoreDuplicate(managerActor, siteId, duplicate.id, ignoreInput),
    ]);
    const ignored = (await days.detail(repActor, siteId, issueDay.id)).sessions.find(
      (session) => session.id === duplicate.id,
    )!;
    assert.equal(ignored.status, 'IGNORED');
    assert.equal(ignored.ignoredBy, managerId);
    assert.equal(ignored.ignoreReason, ignoreInput.reason);
    assert.equal(
      await dataSource
        .getRepository(AccessAuditEntity)
        .countBy({ action: 'ATTENDANCE_DUPLICATE_IGNORED', entityId: duplicate.id }),
      1,
    );
    assert.ok(
      !(await days.detail(workerActor, siteId, issueDay.id)).day.anomalies.includes('DUPLICATE_IN'),
    );
    await assert.rejects(
      attendance.requestCorrection(workerActor, siteId, ignored.id, {
        requestId: randomUUID(),
        expectedSessionVersion: ignored.version,
        proposedInAt: issueStart.toISOString(),
        proposedOutAt: issueEnd.toISOString(),
        reason: 'Cannot fabricate ignored hours',
      }),
      /ignored/,
    );
    const entryCorrection = await attendance.requestCorrection(
      workerActor,
      siteId,
      missingEntry.id,
      {
        requestId: randomUUID(),
        expectedSessionVersion: missingEntry.version,
        proposedInAt: new Date(+issueStart + 2.5 * 3600000).toISOString(),
        proposedOutAt: missingEntry.effectiveOutAt!,
        reason: 'Verified actual entry before the unmatched exit',
      },
    );
    await attendance.reviewCorrection(managerActor, siteId, entryCorrection.id, {
      approve: true,
      reviewNote: 'Entry confirmed by representative',
    });
    const beforeExit = (await days.detail(workerActor, siteId, issueDay.id)).day;
    assert.equal(beforeExit.confirmedMinutes, null);
    assert.deepEqual(beforeExit.anomalies, ['MISSING_OUT', 'EXIT_DURATION_EXCEEDED']);
    assert.deepEqual(
      await dataSource
        .getRepository(AttendanceEventEntity)
        .find({ where: { siteId }, order: { id: 'ASC' } }),
      issueRaw,
    );
    await passage('OUT', new Date(+issueEnd + 6 * 60000), 'QR');
    const completed = await days.detail(workerActor, siteId, issueDay.id);
    assert.equal(completed.day.confirmedMinutes, 510);
    assert.equal(completed.day.status, 'CONFIRMED');
    assert.equal(
      completed.sessions.find((session) => session.id === openInterval.id)!.status,
      'MATCHED',
    );
    assert.equal(
      completed.sessions.find((session) => session.id === ignored.id)!.status,
      'IGNORED',
    );
    await t.test(
      'changed schedule comparison preserves the original hours and clears after restoration',
      async () => {
        const issueSchedule = await dataSource
          .getRepository(WorkerScheduleEntity)
          .findOneByOrFail({ id: completed.day.scheduleId! });
        const template = await dataSource
          .getRepository(ShiftEntity)
          .findOneByOrFail({ id: issueSchedule.shiftId });
        const originalEnd = template.endsAt;
        const raw = await dataSource
          .getRepository(AttendanceEventEntity)
          .find({ where: { siteId }, order: { id: 'ASC' } });
        try {
          await dataSource
            .getRepository(ShiftEntity)
            .update(template.id, { endsAt: new Date(+originalEnd + 3600000) });
          await dataSource.transaction((manager) =>
            reconciliation.refresh(manager, issueDay.id, new Date(+issueEnd + 7200000)),
          );
          const detail = await days.detail(repActor, siteId, issueDay.id);
          assert.ok(detail.day.anomalies.includes('SCHEDULE_CHANGED'));
          assert.equal(detail.day.endsAt, completed.day.endsAt);
          assert.notEqual(detail.currentSchedule?.endsAt, detail.day.endsAt);
          assert.equal(detail.currentSchedule?.id, issueSchedule.id);
          assert.equal(detail.day.confirmedMinutes, null);
          await assert.rejects(
            days.acknowledge(managerActor, siteId, issueDay.id, {
              expectedVersion: detail.day.version,
              reviewNote: 'Cannot bypass changed schedule',
            }),
          );
          await assert.rejects(
            days.detail(actor(outsiderId, UserRole.WORKER), siteId, issueDay.id),
          );
          assert.deepEqual(
            await dataSource
              .getRepository(AttendanceEventEntity)
              .find({ where: { siteId }, order: { id: 'ASC' } }),
            raw,
          );
        } finally {
          await dataSource.getRepository(ShiftEntity).update(template.id, { endsAt: originalEnd });
          await dataSource.transaction((manager) =>
            reconciliation.refresh(manager, issueDay.id, new Date(+issueEnd + 7200000)),
          );
        }
        const restored = await days.detail(workerActor, siteId, issueDay.id);
        assert.ok(!restored.day.anomalies.includes('SCHEDULE_CHANGED'));
        assert.equal(restored.day.confirmedMinutes, completed.day.confirmedMinutes);
      },
    );
    await t.test(
      'archiving a template preserves attendance, raw events and assigned schedules',
      async () => {
        const schedule = await dataSource
          .getRepository(WorkerScheduleEntity)
          .findOneByOrFail({ id: completed.day.scheduleId! });
        const raw = await dataSource
          .getRepository(AttendanceEventEntity)
          .find({ where: { siteId }, order: { id: 'ASC' } });
        const before = await days.detail(workerActor, siteId, issueDay.id);
        await new ScheduleConfigurationService(dataSource).archiveShift(
          actor(repId, UserRole.SITE_MANAGER),
          siteId,
          schedule.shiftId,
        );
        await dataSource.transaction((manager) =>
          reconciliation.refresh(manager, issueDay.id, new Date(+issueEnd + 7200000)),
        );
        const after = await days.detail(workerActor, siteId, issueDay.id);
        assert.equal(after.day.confirmedMinutes, before.day.confirmedMinutes);
        assert.equal(after.day.startsAt, before.day.startsAt);
        assert.equal(after.day.endsAt, before.day.endsAt);
        assert.equal(after.day.status, before.day.status);
        assert.deepEqual(after.day.anomalies, before.day.anomalies);
        assert.deepEqual(
          await dataSource
            .getRepository(AttendanceEventEntity)
            .find({ where: { siteId }, order: { id: 'ASC' } }),
          raw,
        );
        assert.deepEqual(
          await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: schedule.id }),
          schedule,
        );
      },
    );
    await t.test(
      'request queues reach beyond 100 rows with stable ordering and scoped totals',
      async () => {
        for (const kind of ['OVERTIME', 'LEAVE'] as const) {
          const expected = Array.from({ length: 105 }, () => randomUUID()).sort();
          const createdAt = new Date('2040-01-01T00:00:00Z');
          const base = {
            siteId,
            workerId,
            reason: 'Synthetic pagination fixture',
            status: 'REJECTED' as const,
            startsAt: at('08:00'),
            endsAt: at('09:00'),
            createdAt,
            reviewNote: null,
          };
          if (kind === 'OVERTIME')
            await dataSource.getRepository(OvertimeRequestEntity).save(
              expected.map((id) => ({
                ...base,
                id,
                scheduleId: schedule.id,
                expectedShiftId: shift.id,
                requestedBy: userId,
              })),
            );
          else
            await dataSource.getRepository(AbsenceRequestEntity).save(
              expected.map((id) => ({
                ...base,
                id,
                status: AbsenceRequestStatus.REJECTED,
                workerScheduleId: schedule.id,
                shiftId: shift.id,
                expectedScheduleVersionId: version.id,
                requestedByUserId: userId,
              })),
            );
          const query = { kind, status: 'REJECTED' as const, limit: 100 };
          const first = await days.timeRequests(repActor, siteId, query);
          const second = await days.timeRequests(repActor, siteId, { ...query, offset: 100 });
          assert.deepEqual(
            first.items.map((r) => r.id),
            expected.slice(0, 100),
          );
          assert.deepEqual(
            second.items.slice(0, 5).map((r) => r.id),
            expected.slice(100),
          );
          assert.ok(first.total >= 105);
          assert.equal(second.total, first.total);
          assert.equal((await days.timeRequests(workerActor, siteId, query)).total, first.total);
          assert.deepEqual(
            await days.timeRequests(actor(outsiderId, UserRole.WORKER), siteId, query),
            { items: [], total: 0 },
          );
          assert.equal((await days.timeRequests(repActor, randomUUID(), query)).total, 0);
          assert.equal(
            (await days.timeRequests(repActor, siteId, { ...query, workerId: randomUUID() })).total,
            0,
          );
          assert.equal(
            (await days.timeRequests(repActor, siteId, { ...query, offset: first.total })).items
              .length,
            0,
          );
        }
      },
    );
    await t.test('configured lunch is snapshotted and deducted only during presence', async () => {
      const configuration = new ScheduleConfigurationService(dataSource);
      const lunchShift = await configuration.createShift(
        actor(securityId, UserRole.SITE_MANAGER),
        siteId,
        {
          name: 'Lunch shift',
          startsAt: '2026-10-01T08:00:00+07:00',
          endsAt: '2026-10-01T17:00:00+07:00',
          timezone: 'Asia/Ho_Chi_Minh',
          breakStartsAt: '2026-10-01T12:00:00+07:00',
          breakEndsAt: '2026-10-01T13:00:00+07:00',
        },
      );
      for (const [index, intervals, expected] of [
        [20, [['08:00', '17:00']], 480],
        [
          21,
          [
            ['08:00', '11:00'],
            ['11:30', '17:00'],
          ],
          465,
        ],
        [
          22,
          [
            ['08:00', '12:00'],
            ['13:00', '17:00'],
          ],
          480,
        ],
        [
          23,
          [
            ['08:00', '12:30'],
            ['13:00', '17:00'],
          ],
          480,
        ],
      ] as const) {
        const workDate = `2026-10-${index}`;
        await dataSource.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftId: lunchShift.id,
          scheduleVersionId: version.id,
          workDate,
          isActive: true,
        });
        for (const [entry, exit] of intervals) {
          await passage('IN', new Date(`${workDate}T${entry}:00+07:00`));
          if (index === 20) {
            const openDay = await dataSource
              .getRepository(AttendanceDayEntity)
              .findOneByOrFail({ siteId, workerId, workDate });
            await dataSource.transaction((manager) =>
              reconciliation.refresh(manager, openDay.id, new Date(`${workDate}T12:30:00+07:00`)),
            );
            const provisional = await dataSource
              .getRepository(AttendanceDayEntity)
              .findOneByOrFail({ id: openDay.id });
            assert.equal(provisional.provisionalMinutes, 240);
            assert.equal(provisional.confirmedMinutes, null);
          }
          await passage('OUT', new Date(`${workDate}T${exit}:00+07:00`), 'QR');
        }
        const result = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId, workDate });
        assert.equal(result.confirmedMinutes, expected);
        assert.equal(result.provisionalMinutes, expected);
        assert.equal(result.breakStartsAt?.toISOString(), `${workDate}T05:00:00.000Z`);
        assert.equal(result.breakEndsAt?.toISOString(), `${workDate}T06:00:00.000Z`);
        const timesheet = await dataSource.query(
          'SELECT total_minutes FROM timesheet WHERE attendance_day_id=$1',
          [result.id],
        );
        assert.equal(timesheet[0].total_minutes, expected);
      }
      await assert.rejects(
        dataSource.getRepository(ShiftEntity).update(lunchShift.id, { breakEndsAt: null }),
      );
      const original = await dataSource
        .getRepository(AttendanceDayEntity)
        .findOneByOrFail({ siteId, workerId, workDate: '2026-10-20' });
      await dataSource
        .getRepository(ShiftEntity)
        .update(lunchShift.id, { breakEndsAt: new Date('2026-10-01T13:30:00+07:00') });
      await dataSource.transaction((manager) =>
        reconciliation.refresh(manager, original.id, new Date('2026-10-20T18:00:00+07:00')),
      );
      const preserved = await dataSource
        .getRepository(AttendanceDayEntity)
        .findOneByOrFail({ id: original.id });
      assert.equal(preserved.regularMinutes, 480);
      assert.equal(preserved.breakEndsAt?.toISOString(), original.breakEndsAt?.toISOString());
      assert.ok(preserved.anomalies.includes('SCHEDULE_CHANGED'));
    });
    await t.test(
      'first OUT on an unassigned new day never closes yesterday missing checkout',
      async () => {
        const start = new Date('2026-11-15T08:00:00+07:00');
        const template = await dataSource.getRepository(ShiftEntity).save({
          id: randomUUID(),
          siteId,
          name: 'Missing checkout regression',
          startsAt: start,
          endsAt: new Date('2026-11-15T17:00:00+07:00'),
          timezone: 'Asia/Ho_Chi_Minh',
        });
        await dataSource.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftId: template.id,
          scheduleVersionId: version.id,
          workDate: '2026-11-15',
          isActive: true,
        });
        await passage('IN', start);
        const oldDay = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId, workDate: '2026-11-15' });
        const oldSession = await dataSource
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ dayId: oldDay.id });
        const originalEvents = await dataSource
          .getRepository(AttendanceEventEntity)
          .findBy({ siteId, shiftAssignmentId: oldDay.scheduleId! });
        await passage('OUT', new Date('2026-11-16T10:07:00+07:00'), 'QR');
        const unchanged = await dataSource
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ id: oldSession.id });
        assert.equal(unchanged.effectiveOutAt, null);
        assert.equal(unchanged.checkOutEventId, null);
        assert.equal(unchanged.version, oldSession.version);
        const newDay = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId, workDate: '2026-11-16' });
        assert.equal(newDay.scheduleId, null);
        assert.equal(newDay.provisionalMinutes, 0);
        const unmatched = await dataSource
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ dayId: newDay.id });
        assert.equal(unmatched.status, 'MISSING_IN');
        await reconciliation.runDue(new Date('2026-11-16T10:08:00+07:00'));
        assert.ok(
          (
            await dataSource.getRepository(AttendanceDayEntity).findOneByOrFail({ id: oldDay.id })
          ).anomalies.includes('MISSING_OUT'),
        );
        assert.deepEqual(
          await dataSource
            .getRepository(AttendanceEventEntity)
            .findBy({ siteId, shiftAssignmentId: oldDay.scheduleId! }),
          originalEvents,
        );
        const legacyAt = new Date('2026-11-17T08:00:00+07:00');
        const legacyEntry = await dataSource.getRepository(AttendanceEventEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          kind: 'CHECK_IN',
          method: 'MANUAL',
          occurredAt: legacyAt,
          recordedBy: securityId,
          reasonCode: 'NORMAL_CHECK_IN',
        });
        const legacyOpen = await dataSource.getRepository(AttendanceSessionEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          dayId: null,
          checkInEventId: legacyEntry.id,
          effectiveInAt: legacyAt,
          effectiveOutAt: null,
          status: 'MISSING_OUT',
          version: 1,
        });
        await passage('OUT', new Date('2026-11-18T10:00:00+07:00'));
        const preservedLegacy = await dataSource
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ id: legacyOpen.id });
        assert.equal(preservedLegacy.dayId, null);
        assert.equal(preservedLegacy.effectiveOutAt, null);
        assert.equal(preservedLegacy.checkOutEventId, null);
      },
    );
    await t.test(
      'exit policy counts ongoing exits and sends each violation once to both roles',
      async () => {
        const workDate = '2026-11-20';
        const time = (value: string) => new Date(`${workDate}T${value}:00+07:00`);
        const configuration = new ScheduleConfigurationService(dataSource);
        const exitShift = await configuration.createShift(
          actor(securityId, UserRole.SITE_MANAGER),
          siteId,
          {
            name: 'Exit policy regression',
            startsAt: time('08:00').toISOString(),
            endsAt: time('17:00').toISOString(),
            timezone: 'Asia/Ho_Chi_Minh',
            breakStartsAt: time('12:00').toISOString(),
            breakEndsAt: time('13:00').toISOString(),
            allowedExitMinutes: 15,
            maxExitCount: 2,
          },
        );
        assert.equal(exitShift.allowedExitMinutes, 15);
        assert.equal(exitShift.maxExitCount, 2);
        await dataSource.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftId: exitShift.id,
          scheduleVersionId: version.id,
          workDate,
          isActive: true,
        });
        await passage('IN', time('08:00'));
        await passage('OUT', time('10:00'));
        const exitDay = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId, workDate });
        const refresh = (value: string) =>
          dataSource.transaction((manager) =>
            reconciliation.refresh(manager, exitDay.id, time(value)),
          );
        await refresh('10:25');
        const notices = async (event: 'EXIT_DURATION_EXCEEDED' | 'MAX_EXITS_EXCEEDED') =>
          (await dataSource.getRepository(UserNotificationEntity).findBy({ siteId, event })).filter(
            (notice) => notice.content.dayId === exitDay.id,
          );
        const durationNotices = await notices('EXIT_DURATION_EXCEEDED');
        assert.deepEqual(
          durationNotices.map((n) => n.recipientUserId).sort(),
          [userId, repId].sort(),
        );
        assert.match(durationNotices[0]!.requestId, /^[0-9a-f-]{36}$/);
        assert.match(durationNotices[0]!.content.message, /Phần vượt quá đã bị trừ vào giờ làm\.$/);
        assert.doesNotMatch(
          durationNotices[0]!.content.message,
          /thời gian ngoài giờ nghỉ|lần kiểm tra này/,
        );
        await refresh('10:28');
        await passage('IN', time('10:30'));
        await passage('OUT', time('11:00'));
        await passage('IN', time('11:10'));
        assert.equal((await notices('EXIT_DURATION_EXCEEDED')).length, 2);
        await passage('OUT', time('14:00'));
        const outside = await refresh('14:05');
        assert.equal(outside.exitCount, 3);
        assert.equal(outside.deductedMinutes, 20);
        assert.deepEqual(
          (await notices('MAX_EXITS_EXCEEDED')).map((n) => n.recipientUserId).sort(),
          [userId, repId].sort(),
        );
        await refresh('14:20');
        await passage('IN', time('14:30'));
        await passage('OUT', time('17:30'));
        const final = await refresh('18:00');
        assert.equal(final.regularMinutes, 435);
        assert.equal(final.overtimeMinutes, 0);
        assert.equal(final.confirmedMinutes, 435);
        assert.equal((await notices('MAX_EXITS_EXCEEDED')).length, 2);
        assert.equal((await notices('EXIT_DURATION_EXCEEDED')).length, 2);

        // An informational exit violation must not prevent the existing
        // representative review of a final early departure.
        const nextDate = '2026-11-21';
        const nextAt = (value: string) => new Date(`${nextDate}T${value}:00+07:00`);
        await dataSource.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftId: exitShift.id,
          scheduleVersionId: version.id,
          workDate: nextDate,
          isActive: true,
        });
        await passage('IN', nextAt('08:00'));
        await passage('OUT', nextAt('10:00'));
        await passage('IN', nextAt('10:30'));
        await passage('OUT', nextAt('16:50'));
        t.mock.timers.setTime(+nextAt('18:00'));
        const earlySeed = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId, workDate: nextDate });
        const earlyDay = await dataSource.transaction((manager) =>
          reconciliation.refresh(manager, earlySeed.id),
        );
        assert.equal(earlyDay.confirmedMinutes, null);
        assert.deepEqual(earlyDay.anomalies, ['EARLY_CHECKOUT', 'EXIT_DURATION_EXCEEDED']);
        await days.acknowledge(managerActor, siteId, earlyDay.id, {
          expectedVersion: earlyDay.version,
          reviewNote: 'Verified final early departure',
        });
        assert.equal(
          (await days.detail(workerActor, siteId, earlyDay.id)).day.confirmedMinutes,
          455,
        );
      },
    );
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .delete({ siteId, userId: repId });
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId: managerId, siteId });
    await assert.rejects(days.ignoreDuplicate(managerActor, siteId, ignored.id, ignoreInput));
    assert.equal((await days.list(repActor, siteId, {})).items.length, 0);
    assert.equal((await days.timeRequests(repActor, siteId, { kind: 'OVERTIME' })).total, 0);
    assert.equal((await notifications.list(repActor)).items.length, 0);
  } finally {
    await cleanupSiteAccess(dataSource, [siteId]);
    await dataSource.query('DELETE FROM absence_request WHERE site_id=$1', [siteId]);
    await dataSource.query(
      'DELETE FROM attendance_schedule_conflict WHERE schedule_id IN (SELECT id FROM worker_schedule WHERE site_id=$1)',
      [siteId],
    );
    await dataSource.query('DELETE FROM worker_schedule WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM shift WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM schedule_version WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM contractor_representative_assignment WHERE site_id=$1', [
      siteId,
    ]);
    await dataSource.query('DELETE FROM worker WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM contractor_site_participation WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM contractor WHERE id=$1', [contractorId]);
    await dataSource.query('DELETE FROM user_role_assignment WHERE user_id=ANY($1)', [ids]);
    await dataSource.query('DELETE FROM app_user WHERE id=ANY($1)', [ids]);
    await dataSource.query('DELETE FROM site WHERE id=$1', [siteId]);
    await dataSource.destroy();
  }
});
