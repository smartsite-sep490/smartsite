import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceService } from '../../src/modules/workforce/attendance/attendance.service.js';
import { approvedWorkerDocuments } from '../support/approved-worker-documents.js';
import { AttendanceMultipleShifts1795651200002 } from '../../src/database/migrations/1795651200002-AttendanceMultipleShifts.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { AttendanceZoneReview1795651200001 } from '../../src/database/migrations/1795651200001-AttendanceZoneReview.js';
import { ZONE_HOURS_REVIEW_ACTION } from '../../src/modules/workforce/attendance/attendance-zone-review.js';
import {
  AccessAttemptEntity,
  AccessAuditEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  AttendanceSessionEntity,
  AttendanceDayEntity,
  AttendanceEventEntity,
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  GateEntity,
  GateEventEntity,
  OvertimeRequestEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  SiteEntity,
  TeamAttendanceEntity,
  UserEntity,
  UserNotificationEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';

test('Zone hours review: scoped consent, complete Gate evidence, audit receipts and reporting', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      contractorId = randomUUID(),
      otherContractor = randomUUID(),
      repId = randomUUID(),
      otherRep = randomUUID(),
      workerUser = randomUUID(),
      leaderUser = randomUUID(),
      workerId = randomUUID(),
      leaderId = randomUUID();
    await db
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic absence review site' });
    for (const id of [contractorId, otherContractor])
      await db
        .getRepository(ContractorEntity)
        .save({ id, code: id, name: 'Synthetic contractor', isActive: true });
    for (const id of [repId, otherRep, workerUser, leaderUser])
      await db.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic user',
        passwordHash: 'synthetic-unused-hash',
        isActive: true,
        mustChangePassword: false,
      });
    for (const [id, role] of [
      [repId, UserRole.CONTRACTOR_REPRESENTATIVE],
      [otherRep, UserRole.CONTRACTOR_REPRESENTATIVE],
      [workerUser, UserRole.WORKER],
      [leaderUser, UserRole.WORKER],
    ] as const)
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, siteId, role });
    for (const [id, userId] of [
      [contractorId, repId],
      [otherContractor, otherRep],
    ]) {
      await db.getRepository(ContractorSiteParticipationEntity).save({
        id: randomUUID(),
        siteId,
        contractorId: id,
        validFrom: new Date('2020-01-01'),
        validUntil: new Date('2040-01-01'),
        isActive: true,
      });
      await db
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .save({ id: randomUUID(), siteId, contractorId: id, userId });
    }
    for (const [id, userId] of [
      [workerId, workerUser],
      [leaderId, leaderUser],
    ])
      await db.getRepository(WorkerEntity).save({
        id,
        userId,
        siteId,
        contractorId,
        externalId: id,
        displayName: id === workerId ? 'Synthetic absent Worker' : 'Synthetic leader',
        isActive: true,
      });
    const actor = (id: string, role: UserRole) => ({
      id,
      username: id,
      displayName: 'Synthetic user',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId, role }],
    });
    const rep = actor(repId, UserRole.CONTRACTOR_REPRESENTATIVE),
      peer = actor(workerUser, UserRole.WORKER);
    const teams = new ContractorTeamsService(db),
      notifications = new SchedulingNotificationService(db),
      reconciliation = new AttendanceReconciliationService(db, notifications),
      days = new AttendanceDaysService(db, reconciliation);
    const team = await teams.create(rep, siteId, contractorId, {
      requestId: randomUUID(),
      name: 'Synthetic crew',
    });
    const membership = await teams.assign(rep, siteId, contractorId, workerId, {
      requestId: randomUUID(),
      expectedMembershipId: null,
      teamId: team.id,
    });
    await teams.assign(rep, siteId, contractorId, leaderId, {
      requestId: randomUUID(),
      expectedMembershipId: null,
      teamId: team.id,
    });
    await db.query('UPDATE contractor_team_membership SET joined_at=$2 WHERE team_id=$1', [
      team.id,
      new Date('2020-01-01'),
    ]);
    const zone = await db.getRepository(ZoneEntity).save({
      id: randomUUID(),
      siteId,
      code: 'absence-review',
      name: 'Synthetic Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    const shift = await db.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Synthetic 09-10',
      startsAt: new Date('2020-01-01T09:00:00Z'),
      endsAt: new Date('2020-01-01T10:00:00Z'),
      timezone: 'UTC',
    });
    const version = await db.getRepository(ScheduleVersionEntity).save({
      id: randomUUID(),
      siteId,
      version: 1,
      effectiveFrom: new Date('2020-01-01'),
      effectiveUntil: null,
    });
    const gate = await db.getRepository(GateEntity).save({
      id: randomUUID(),
      siteId,
      code: 'ABSENCE',
      name: 'Synthetic Gate',
      status: 'ACTIVE',
    });
    let dateIndex = 0;
    async function makeCase(
      workDate = `2026-11-${String(++dateIndex).padStart(2, '0')}`,
      refresh = true,
    ) {
      const schedule = await db.getRepository(WorkerScheduleEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        shiftId: shift.id,
        scheduleVersionId: version.id,
        workDate,
        isActive: true,
      });
      const day = await db.getRepository(AttendanceDayEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        workDate,
        timezone: 'UTC',
        scheduleId: schedule.id,
        shiftName: shift.name,
        startsAt: new Date(`${workDate}T09:00:00Z`),
        endsAt: new Date(`${workDate}T10:00:00Z`),
        status: 'IN_PROGRESS',
        version: 1,
        anomalies: [],
        regularMinutes: 0,
        overtimeMinutes: 0,
        provisionalMinutes: 0,
        confirmedMinutes: null,
        zoneAttendanceRequirement: {
          version: 1,
          required: true,
          teamId: team.id,
          membershipId: membership.membershipId!,
          zoneId: zone.id,
        },
      });
      if (refresh) await db.transaction((m) => reconciliation.refresh(m, day.id));
      return { day, schedule };
    }
    async function commandFor(dayId: string) {
      const detail = await days.detail(rep, siteId, dayId);
      return {
        requestId: randomUUID(),
        expectedVersion: detail.day.version,
        evidenceHash: detail.zoneAttendanceReview?.evidenceHash ?? '0'.repeat(64),
        reason: 'Verified complete Gate intervals; leader did not record roll call',
      };
    }
    async function recordGate(
      day: AttendanceDayEntity,
      direction: 'IN' | 'OUT',
      occurredAt = new Date(`${day.workDate}T09:30:00Z`),
    ) {
      const attempt = await db.getRepository(AccessAttemptEntity).save({
        id: randomUUID(),
        siteId,
        gateId: gate.id,
        operatorId: repId,
        direction,
        method: 'QR',
        workerId,
        identityStatus: 'MATCHED',
        authorizationStatus: 'ALLOWED',
        scheduleStatus: 'SCHEDULED',
        reasonCode: 'SYNTHETIC',
        status: 'USED',
        expiresAt: new Date('2030-01-01'),
      });
      return db.getRepository(GateEventEntity).save({
        id: randomUUID(),
        accessAttemptId: attempt.id,
        siteId,
        workerId,
        direction,
        occurredAt,
        gateName: gate.name,
        idempotencyKey: randomUUID(),
        recordedBy: repId,
      });
    }

    async function pair(day: AttendanceDayEntity, starts = '09:00', ends: string | null = '10:00') {
      const entry = await recordGate(day, 'IN', new Date(day.workDate + 'T' + starts + ':00Z'));
      const eventIn = await db.getRepository(AttendanceEventEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        shiftAssignmentId: day.scheduleId,
        gateEventId: entry.id,
        kind: 'CHECK_IN',
        method: 'QR',
        occurredAt: entry.occurredAt,
        reasonCode: 'SYNTHETIC',
      });
      const endTime = ends ? new Date(day.workDate + 'T' + ends + ':00Z') : null;
      if (endTime && +endTime < +entry.occurredAt) endTime.setUTCDate(endTime.getUTCDate() + 1);
      const exit = endTime ? await recordGate(day, 'OUT', endTime) : null;
      const eventOut = exit
        ? await db.getRepository(AttendanceEventEntity).save({
            id: randomUUID(),
            siteId,
            workerId,
            shiftAssignmentId: day.scheduleId,
            gateEventId: exit.id,
            kind: 'CHECK_OUT',
            method: 'QR',
            occurredAt: exit.occurredAt,
            reasonCode: 'SYNTHETIC',
          })
        : null;
      return db.getRepository(AttendanceSessionEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        dayId: day.id,
        shiftAssignmentId: day.scheduleId,
        checkInEventId: eventIn.id,
        checkOutEventId: eventOut?.id ?? null,
        effectiveInAt: entry.occurredAt,
        effectiveOutAt: exit?.occurredAt ?? null,
        status: exit ? 'MATCHED' : 'MISSING_OUT',
        version: 1,
      });
    }
    async function ready(starts = '09:00', ends: string | null = '10:00') {
      const item = await makeCase();
      await pair(item.day, starts, ends);
      await db.transaction((manager) => reconciliation.refresh(manager, item.day.id));
      return item;
    }
    async function assertNoReview(dayId: string) {
      const detail = await days.detail(rep, siteId, dayId);
      assert.notEqual(detail.zoneAttendanceReview?.canConfirm, true);
      const notices = await db
        .getRepository(UserNotificationEntity)
        .findBy({ siteId, event: 'ZONE_REVIEW_REQUIRED' });
      assert.equal(notices.filter((notice) => notice.content.dayId === dayId).length, 0);
    }
    await t.test(
      'fresh schema matches metadata and rehearses an empty rollback without a new table',
      async () => {
        assert.deepEqual(
          (await db.driver.createSchemaBuilder().log()).upQueries.map((query) => query.query),
          [],
        );
        const runner = db.createQueryRunner();
        await runner.connect();
        try {
          await runner.startTransaction();
          const migration = new AttendanceZoneReview1795651200001();
          await migration.down(runner);
          await migration.up(runner);
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
        assert.deepEqual(
          (await db.driver.createSchemaBuilder().log()).upQueries.map((query) => query.query),
          [],
        );
      },
    );
    await t.test(
      'notifies the scoped representative once and confirms only calculated hours without creating roll call',
      async () => {
        const { day } = await ready();
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        const before = await days.detail(rep, siteId, day.id);
        assert.equal(before.day.status, 'NEEDS_REVIEW');
        assert.equal(before.day.provisionalMinutes, 60);
        assert.equal(before.zoneAttendanceReview?.canConfirm, true);
        assert.equal(before.zoneAttendanceReview?.teamAttendanceStatus, 'NOT_YET');
        const notices = await db
          .getRepository(UserNotificationEntity)
          .findBy({ siteId, event: 'ZONE_REVIEW_REQUIRED' });
        assert.equal(notices.length, 1);
        assert.equal(notices[0]!.recipientUserId, repId);
        const notice = (await notifications.list(rep, 'ALL', 0, 20)).items.find(
          (item) => item.id === notices[0]!.id,
        )!;
        assert.equal('dayId' in notice.target && notice.target.dayId, day.id);
        const input = await commandFor(day.id);
        await days.confirmZoneHours(rep, siteId, day.id, input);
        await days.confirmZoneHours(rep, siteId, day.id, input);
        const after = await days.detail(rep, siteId, day.id);
        assert.equal(after.day.status, 'CONFIRMED');
        assert.equal(after.day.confirmedMinutes, 60);
        assert.equal(after.zoneAttendanceReview?.status, 'CONFIRMED');
        assert.equal(after.zoneAttendanceReview?.decision?.reviewedBy, repId);
        assert.equal(after.zoneAttendanceReview?.decision?.reason, input.reason);
        assert.equal(
          await db.getRepository(TeamAttendanceEntity).countBy({ scheduleId: day.scheduleId! }),
          0,
        );
        assert.equal(
          await db
            .getRepository(AccessAuditEntity)
            .countBy({ action: ZONE_HOURS_REVIEW_ACTION, entityId: input.requestId }),
          1,
        );
        const report = await days.timesheets(rep, siteId, {
          fromDate: day.workDate,
          toDate: day.workDate,
        });
        assert.equal(report.items.find((item) => item.workerId === workerId)?.totalMinutes, 60);
        await assert.rejects(
          days.confirmZoneHours(rep, siteId, day.id, { ...input, reason: 'Changed retry reason' }),
        );
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 60);
      },
    );
    await t.test(
      'denies Worker, cross-Contractor, wrong Site, revoked scope and disabled accounts',
      async () => {
        const { day } = await ready();
        const input = await commandFor(day.id);
        await assert.rejects(days.confirmZoneHours(peer, siteId, day.id, input));
        await assert.rejects(
          days.confirmZoneHours(
            actor(otherRep, UserRole.CONTRACTOR_REPRESENTATIVE),
            siteId,
            day.id,
            input,
          ),
        );
        await assert.rejects(days.confirmZoneHours(rep, randomUUID(), day.id, input));
        const grant = await db
          .getRepository(ContractorRepresentativeAssignmentEntity)
          .findOneByOrFail({ userId: repId, siteId, contractorId });
        await db.getRepository(ContractorRepresentativeAssignmentEntity).delete(grant.id);
        await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, input));
        await db.getRepository(ContractorRepresentativeAssignmentEntity).save(grant);
        await db.getRepository(UserEntity).update(repId, { isActive: false });
        await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, input));
        await db.getRepository(UserEntity).update(repId, { isActive: true });
        const unavailable = new Proxy(db, {
          get(target, property) {
            if (property === 'transaction')
              return (operation: (manager: EntityManager) => Promise<unknown>) =>
                target.transaction((manager) =>
                  operation(
                    new Proxy(manager, {
                      get(original, key) {
                        if (key === 'getRepository')
                          return (entity: unknown) => {
                            if (entity === UserEntity)
                              throw new Error('Synthetic permission storage unavailable');
                            return original.getRepository(entity as typeof UserEntity);
                          };
                        const result = Reflect.get(original, key);
                        return typeof result === 'function' ? result.bind(original) : result;
                      },
                    }),
                  ),
                );
            const result = Reflect.get(target, property);
            return typeof result === 'function' ? result.bind(target) : result;
          },
        });
        await assert.rejects(
          new AttendanceDaysService(unavailable as DataSource, reconciliation).confirmZoneHours(
            rep,
            siteId,
            day.id,
            input,
          ),
        );
        assert.equal(
          (await db.getRepository(AttendanceDayEntity).findOneByOrFail({ id: day.id }))
            .zoneAttendanceReviewAuditId,
          null,
        );
      },
    );
    await t.test('blocks self-review even with a representative role', async () => {
      const { day } = await ready();
      const role = await db.getRepository(UserRoleAssignmentEntity).save({
        id: randomUUID(),
        userId: workerUser,
        siteId,
        role: UserRole.CONTRACTOR_REPRESENTATIVE,
      });
      const grant = await db
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .save({ id: randomUUID(), siteId, contractorId, userId: workerUser });
      try {
        await assert.rejects(
          days.confirmZoneHours(
            actor(workerUser, UserRole.CONTRACTOR_REPRESENTATIVE),
            siteId,
            day.id,
            await commandFor(day.id),
          ),
        );
      } finally {
        await db.getRepository(ContractorRepresentativeAssignmentEntity).delete(grant.id);
        await db.getRepository(UserRoleAssignmentEntity).delete(role.id);
      }
    });
    await t.test(
      'rejects malformed inputs, stale versions, and changed evidence even if totals do not change',
      async () => {
        const { day } = await ready();
        const input = await commandFor(day.id);
        await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, { ...input, reason: 'x' }));
        await assert.rejects(
          days.confirmZoneHours(
            rep,
            siteId,
            day.id,
            Object.assign({}, input, { confirmedMinutes: 999 }),
          ),
        );
        await assert.rejects(
          days.confirmZoneHours(rep, siteId, day.id, {
            ...input,
            expectedVersion: input.expectedVersion - 1,
          }),
        );
        // A newly discovered raw passage inside this shift must invalidate the snapshot.
        await recordGate(day, 'OUT', new Date(day.workDate + 'T09:55:00Z'));
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.version, input.expectedVersion);
        await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, input));
        assert.equal(
          (await db.getRepository(AttendanceDayEntity).findOneByOrFail({ id: day.id }))
            .zoneAttendanceReviewAuditId,
          null,
        );
      },
    );
    await t.test(
      'missing OUT, unprojected Gate and manual sessions cannot authorize confirmation',
      async () => {
        for (const kind of ['missing-out', 'raw-only', 'manual'] as const) {
          const { day } = await makeCase();
          if (kind === 'missing-out') await pair(day, '09:00', null);
          else if (kind === 'raw-only') {
            await recordGate(day, 'IN');
            await recordGate(day, 'OUT', new Date(day.workDate + 'T10:00:00Z'));
          } else {
            const session = await pair(day);
            await db
              .getRepository(AttendanceEventEntity)
              .update(session.checkInEventId!, { gateEventId: null, method: 'MANUAL' });
          }
          await db.transaction((manager) => reconciliation.refresh(manager, day.id));
          await assertNoReview(day.id);
          await assert.rejects(
            days.confirmZoneHours(rep, siteId, day.id, await commandFor(day.id)),
          );
        }
      },
    );
    await t.test('waits for shift/approved overtime end and blocks pending requests', async () => {
      const { day, schedule } = await makeCase('2026-11-23');
      await pair(day);
      const overtime = await db.getRepository(OvertimeRequestEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        scheduleId: schedule.id,
        expectedShiftId: shift.id,
        startsAt: new Date(day.workDate + 'T10:00:00Z'),
        endsAt: new Date('2026-11-23T13:00:00Z'),
        requestedBy: workerUser,
        reason: 'Synthetic pending overtime',
        status: 'PENDING',
      });
      await db.transaction((manager) => reconciliation.refresh(manager, day.id));
      await assertNoReview(day.id);
      await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, await commandFor(day.id)));
      await db.getRepository(OvertimeRequestEntity).update(overtime.id, { status: 'APPROVED' });
      await db.transaction((manager) => reconciliation.refresh(manager, day.id));
      await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, await commandFor(day.id)));
      const future = await makeCase('2026-11-25');
      await pair(future.day);
      await db.transaction((manager) => reconciliation.refresh(manager, future.day.id));
      await assertNoReview(future.day.id);
    });
    await t.test(
      'approved full-shift leave never enters the missing roll-call review',
      async () => {
        const { day, schedule } = await makeCase('2026-11-19');
        await pair(day);
        await db.getRepository(AbsenceRequestEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          workerScheduleId: schedule.id,
          shiftId: shift.id,
          expectedScheduleVersionId: version.id,
          requestedByUserId: workerUser,
          reason: 'Synthetic approved full-shift leave',
          status: AbsenceRequestStatus.APPROVED,
        });
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        const detail = await days.detail(rep, siteId, day.id);
        assert.equal(detail.day.confirmedMinutes, 0);
        assert.equal(detail.zoneAttendanceReview, undefined);
        await assertNoReview(day.id);
      },
    );
    await t.test(
      'existing leader Present uses normal confirmation; leader Absent cannot be overridden',
      async () => {
        for (const status of ['PRESENT', 'ABSENT'] as const) {
          const { day, schedule } = await ready();
          const input = await commandFor(day.id);
          await db.getRepository(TeamAttendanceEntity).save({
            scheduleId: schedule.id,
            teamId: team.id,
            membershipId: membership.membershipId!,
            zoneId: zone.id,
            status,
            version: 1,
            updatedBy: leaderUser,
            updatedAt: new Date(),
          });
          await db.transaction((manager) => reconciliation.refresh(manager, day.id));
          await assert.rejects(days.confirmZoneHours(rep, siteId, day.id, input));
          const detail = await days.detail(rep, siteId, day.id);
          assert.equal(detail.day.status, status === 'PRESENT' ? 'CONFIRMED' : 'NEEDS_REVIEW');
          assert.equal(
            await db
              .getRepository(AccessAuditEntity)
              .countBy({ action: ZONE_HOURS_REVIEW_ACTION, entityId: input.requestId }),
            0,
          );
        }
      },
    );
    await t.test(
      'concurrent approvals record one receipt; early checkout confirms only actual minutes',
      async () => {
        const { day } = await ready('09:00', '09:45');
        const input = await commandFor(day.id);
        const results = await Promise.allSettled([
          days.confirmZoneHours(rep, siteId, day.id, input),
          days.confirmZoneHours(rep, siteId, day.id, { ...input, requestId: randomUUID() }),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 45);
      },
    );
    await t.test(
      'unassigned IN/OUT outside a reviewed shift do not change its receipt; relevant unassigned evidence still blocks',
      async () => {
        const { day } = await ready();
        const input = await commandFor(day.id);
        await days.confirmZoneHours(rep, siteId, day.id, input);
        for (const direction of ['IN', 'OUT'] as const) {
          const gateEvent = await recordGate(day, direction, new Date(day.workDate + 'T11:30:00Z'));
          await db.getRepository(AttendanceEventEntity).save({
            id: randomUUID(),
            siteId,
            workerId,
            shiftAssignmentId: null,
            gateEventId: gateEvent.id,
            kind: direction === 'IN' ? 'CHECK_IN' : 'CHECK_OUT',
            method: 'QR',
            occurredAt: gateEvent.occurredAt,
            reasonCode: 'SYNTHETIC',
          });
          await db.transaction((m) => reconciliation.refresh(m, day.id));
          const current = await days.detail(rep, siteId, day.id);
          assert.equal(current.day.status, 'CONFIRMED');
          assert.equal(current.day.confirmedMinutes, 60);
          assert.equal(current.zoneAttendanceReview?.evidenceHash, input.evidenceHash);
          assert.equal(current.day.anomalies.includes('ZONE_ATTENDANCE_REVIEW_CONFLICT'), false);
        }
        // A conflict created by the old same-day collector can recover the original receipt.
        await db.getRepository(AttendanceDayEntity).update(day.id, {
          status: 'NEEDS_REVIEW',
          confirmedMinutes: null,
          anomalies: ['ZONE_ATTENDANCE_PENDING', 'ZONE_ATTENDANCE_REVIEW_CONFLICT'],
        });
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.status, 'CONFIRMED');
        await recordGate(day, 'IN', new Date(day.workDate + 'T09:30:00Z'));
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        assert.equal(
          (await days.detail(rep, siteId, day.id)).zoneAttendanceReview?.status,
          'CONFLICTED',
        );
      },
    );
    await t.test(
      'late evidence reopens review; a new approval preserves both audit receipts',
      async () => {
        const { day } = await ready('09:00', '09:30');
        const first = await commandFor(day.id);
        await days.confirmZoneHours(rep, siteId, day.id, first);
        await pair(day, '09:40', '10:00');
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        const changed = await days.detail(rep, siteId, day.id);
        assert.equal(changed.day.status, 'NEEDS_REVIEW');
        assert.equal(changed.day.confirmedMinutes, null);
        assert.equal(changed.zoneAttendanceReview?.status, 'CONFLICTED');
        assert.equal(changed.zoneAttendanceReview?.canConfirm, true);
        const second = await commandFor(day.id);
        await days.confirmZoneHours(rep, siteId, day.id, second);
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 60);
        await days.confirmZoneHours(rep, siteId, day.id, first);
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 60);
        assert.equal(
          await db
            .getRepository(AccessAuditEntity)
            .countBy({ action: ZONE_HOURS_REVIEW_ACTION, entityId: first.requestId }),
          1,
        );
        assert.equal(
          await db
            .getRepository(AccessAuditEntity)
            .countBy({ action: ZONE_HOURS_REVIEW_ACTION, entityId: second.requestId }),
          1,
        );
      },
    );
    await t.test(
      'overnight Gate OUT and approved overtime stay attached to the original work date',
      async () => {
        const { day, schedule } = await makeCase('2026-11-20', false);
        const night = await db.getRepository(ShiftEntity).save({
          id: randomUUID(),
          siteId,
          name: 'Synthetic overnight',
          startsAt: new Date('2020-01-01T23:00:00Z'),
          endsAt: new Date('2020-01-02T01:00:00Z'),
          timezone: 'UTC',
        });
        await db.getRepository(WorkerScheduleEntity).update(schedule.id, { shiftId: night.id });
        await db.getRepository(AttendanceDayEntity).update(day.id, {
          startsAt: new Date('2026-11-20T23:00:00Z'),
          endsAt: new Date('2026-11-21T01:00:00Z'),
        });
        await db.getRepository(OvertimeRequestEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          scheduleId: schedule.id,
          expectedShiftId: night.id,
          startsAt: new Date('2026-11-21T01:00:00Z'),
          endsAt: new Date('2026-11-21T02:00:00Z'),
          requestedBy: workerUser,
          reason: 'Synthetic approved overnight overtime',
          status: 'APPROVED',
        });
        await pair(day, '23:00', '02:00');
        await db.transaction((manager) => reconciliation.refresh(manager, day.id));
        const before = await days.detail(rep, siteId, day.id);
        assert.equal(before.zoneAttendanceReview?.canConfirm, true);
        assert.equal(before.zoneAttendanceReview?.gateOutCount, 1);
        assert.equal(before.day.regularMinutes, 120);
        assert.equal(before.day.overtimeMinutes, 60);
        await days.confirmZoneHours(rep, siteId, day.id, await commandFor(day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 180);
        const morning = await makeCase('2026-11-21');
        await pair(morning.day);
        await db.transaction((manager) => reconciliation.refresh(manager, morning.day.id));
        const morningDetail = await days.detail(rep, siteId, morning.day.id);
        assert.equal(
          morningDetail.zoneAttendanceReview?.canConfirm,
          true,
          'Previous-night OUT belongs to its own schedule',
        );
        assert.equal(morningDetail.zoneAttendanceReview?.gateOutCount, 1);
        await days.confirmZoneHours(rep, siteId, morning.day.id, await commandFor(morning.day.id));
        assert.equal((await days.detail(rep, siteId, morning.day.id)).day.confirmedMinutes, 60);
      },
    );
    await t.test(
      'database refuses a mismatched audit link and rollback preserves history',
      async () => {
        const { day } = await ready();
        const wrong = await db.getRepository(AccessAuditEntity).save({
          id: randomUUID(),
          actorAccountId: repId,
          siteId,
          action: 'SYNTHETIC_OTHER_ACTION',
          entityType: 'attendance_day',
          entityId: day.id,
          reason: 'Synthetic incorrect reference',
          changes: {},
          occurredAt: new Date(),
        });
        await assert.rejects(
          db
            .getRepository(AttendanceDayEntity)
            .update(day.id, { zoneAttendanceReviewAuditId: wrong.id }),
          (error: unknown) =>
            (error as { driverError?: { code?: string } }).driverError?.code === '23514',
        );
        const wrongScope = await db.getRepository(AccessAuditEntity).save({
          id: randomUUID(),
          actorAccountId: repId,
          siteId,
          action: ZONE_HOURS_REVIEW_ACTION,
          entityType: 'attendance_zone_review',
          entityId: randomUUID(),
          reason: 'Synthetic wrong Zone reference',
          changes: {
            dayId: day.id,
            evidenceHash: 'a'.repeat(64),
            teamId: team.id,
            membershipId: membership.membershipId,
            zoneId: randomUUID(),
          },
          occurredAt: new Date(),
        });
        await assert.rejects(
          db
            .getRepository(AttendanceDayEntity)
            .update(day.id, { zoneAttendanceReviewAuditId: wrongScope.id }),
          (error: unknown) =>
            (error as { driverError?: { code?: string } }).driverError?.code === '23514',
        );
        const runner = db.createQueryRunner();
        await runner.connect();
        try {
          await assert.rejects(
            new AttendanceZoneReview1795651200001().down(runner),
            /Preserve Zone attendance/,
          );
        } finally {
          await runner.release();
        }
      },
    );
    await t.test(
      'leader PRESENT plus approved missing checkout confirms hours without a new raw OUT',
      async () => {
        await approvedWorkerDocuments(db, [workerId], repId);
        const attendance = new AttendanceService(db, reconciliation);
        const { day, schedule } = await makeCase('2026-09-30');
        await pair(day, '09:00', null);
        await db.getRepository(TeamAttendanceEntity).save({
          scheduleId: schedule.id,
          teamId: team.id,
          membershipId: membership.membershipId!,
          zoneId: zone.id,
          status: 'PRESENT',
          version: 1,
          updatedBy: leaderUser,
          updatedAt: new Date(),
        });
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        const before = await days.detail(rep, siteId, day.id);
        assert.ok(before.day.anomalies.includes('MISSING_OUT'));
        const request = {
          requestId: randomUUID(),
          expectedSessionVersion: before.sessions[0]!.version,
          proposedInAt: '2026-09-30T09:00:00Z',
          proposedOutAt: '2026-09-30T09:50:00Z',
          reason: 'Forgot checkout after work',
        };
        await attendance.requestCorrection(peer, siteId, before.sessions[0]!.id, request);
        await attendance.reviewCorrection(rep, siteId, request.requestId, { approve: true });
        const after = await days.detail(rep, siteId, day.id);
        assert.equal(after.day.status, 'CONFIRMED');
        assert.equal(after.day.confirmedMinutes, 50);
        assert.equal(after.sessions[0]!.rawOutAt, null);
        assert.equal(after.day.anomalies.includes('ZONE_GATE_MISSING'), false);
      },
    );
    await t.test(
      'approved missing-attendance reports replace missing Gate evidence, preserve raw history and still require missing leader review',
      async () => {
        await approvedWorkerDocuments(db, [workerId], repId);
        const attendance = new AttendanceService(db, reconciliation);
        const { day, schedule } = await makeCase('2026-10-01');
        const input = {
          requestId: randomUUID(),
          expectedSessionVersion: 1,
          proposedInAt: '2026-10-01T09:00:00Z',
          proposedOutAt: '2026-10-01T10:00:00Z',
          reason: 'Worked on site but both gate scans were missed',
        };
        assert.ok(
          (await attendance.overview(peer, siteId)).missingSchedules?.some(
            (s) => s.scheduleId === schedule.id,
          ),
        );
        await assert.rejects(
          attendance.requestMissingAttendance(
            actor(leaderUser, UserRole.WORKER),
            siteId,
            schedule.id,
            input,
          ),
        );
        await attendance.requestMissingAttendance(peer, siteId, schedule.id, input);
        await attendance.requestMissingAttendance(peer, siteId, schedule.id, input);
        let detail = await days.detail(rep, siteId, day.id);
        assert.equal(detail.day.confirmedMinutes, null);
        assert.equal(detail.day.provisionalMinutes, 0);
        await assert.rejects(
          attendance.reviewCorrection(
            actor(otherRep, UserRole.CONTRACTOR_REPRESENTATIVE),
            siteId,
            input.requestId,
            { approve: true },
          ),
        );
        await attendance.reviewCorrection(rep, siteId, input.requestId, { approve: true });
        detail = await days.detail(rep, siteId, day.id);
        assert.equal(detail.day.anomalies.includes('ZONE_GATE_MISSING'), false);
        assert.equal(detail.zoneAttendanceReview?.canConfirm, true);
        assert.equal(detail.day.provisionalMinutes, 60);
        assert.equal(detail.sessions[0]?.rawInAt, null);
        assert.equal(detail.sessions[0]?.rawOutAt, null);
        await days.confirmZoneHours(rep, siteId, day.id, await commandFor(day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.confirmedMinutes, 60);
        assert.equal(
          await db.getRepository(AttendanceEventEntity).countBy({ shiftAssignmentId: schedule.id }),
          0,
        );
        const runner = db.createQueryRunner();
        await runner.connect();
        try {
          await assert.rejects(
            new AttendanceMultipleShifts1795651200002().down(runner),
            /history must be preserved/,
          );
        } finally {
          await runner.release();
        }
      },
    );
    await t.test(
      'a later shift IN never repairs an earlier missing OUT and overnight overlaps are blocked',
      async () => {
        const first = await makeCase('2026-10-04');
        const later = await db.getRepository(ShiftEntity).save({
          ...shift,
          id: randomUUID(),
          startsAt: new Date('2020-01-01T11:00:00Z'),
          endsAt: new Date('2020-01-01T12:00:00Z'),
        });
        const laterSchedule = await db
          .getRepository(WorkerScheduleEntity)
          .save({ ...first.schedule, id: randomUUID(), shiftId: later.id });
        for (const [direction, time] of [
          ['IN', '09:00'],
          ['IN', '11:00'],
          ['OUT', '12:00'],
        ] as const) {
          const gateEvent = await recordGate(
            first.day,
            direction,
            new Date(`2026-10-04T${time}:00Z`),
          );
          const attempt = await db
            .getRepository(AccessAttemptEntity)
            .findOneByOrFail({ id: gateEvent.accessAttemptId });
          const worker = await db.getRepository(WorkerEntity).findOneByOrFail({ id: workerId });
          await db.transaction((m) => reconciliation.recordPassage(m, gateEvent, attempt, worker));
        }
        const firstSession = await db
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ dayId: first.day.id });
        assert.equal(firstSession.checkOutEventId, null);
        const laterDay = await db
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ scheduleId: laterSchedule.id });
        const laterSession = await db
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ dayId: laterDay.id });
        assert.equal(laterSession.status, 'MATCHED');
        assert.equal(+laterSession.effectiveInAt!, +new Date('2026-10-04T11:00:00Z'));
        const night = await db.getRepository(ShiftEntity).save({
          ...shift,
          id: randomUUID(),
          startsAt: new Date('2020-01-01T22:00:00Z'),
          endsAt: new Date('2020-01-02T02:00:00Z'),
        });
        await db
          .getRepository(WorkerScheduleEntity)
          .save({ ...first.schedule, id: randomUUID(), shiftId: night.id });
        const overlap = await db.getRepository(ShiftEntity).save({
          ...shift,
          id: randomUUID(),
          startsAt: new Date('2020-01-01T01:00:00Z'),
          endsAt: new Date('2020-01-01T03:00:00Z'),
        });
        await assert.rejects(
          db.getRepository(WorkerScheduleEntity).save({
            ...first.schedule,
            id: randomUUID(),
            shiftId: overlap.id,
            workDate: '2026-10-05',
          }),
        );
      },
    );
    await t.test(
      'a reused missing-report ID cannot overwrite an existing raw attendance session',
      async () => {
        const attendance = new AttendanceService(db, reconciliation);
        const raw = await ready();
        const original = await db
          .getRepository(AttendanceSessionEntity)
          .findOneByOrFail({ dayId: raw.day.id });
        const target = await makeCase('2026-08-02');
        await assert.rejects(
          attendance.requestMissingAttendance(peer, siteId, target.schedule.id, {
            requestId: original.id,
            expectedSessionVersion: 1,
            proposedInAt: '2026-08-02T09:00:00Z',
            proposedOutAt: '2026-08-02T10:00:00Z',
            reason: 'Colliding request ID must not rewrite another session',
          }),
          /Request ID was already used/,
        );
        assert.deepEqual(
          await db.getRepository(AttendanceSessionEntity).findOneByOrFail({ id: original.id }),
          original,
        );
        assert.equal(
          await db.getRepository(AttendanceSessionEntity).countBy({ dayId: target.day.id }),
          0,
        );
      },
    );
    await t.test(
      'two non-overlapping shifts have separate reviews and totals; duplicate and overlapping schedules are rejected',
      async () => {
        const attendance = new AttendanceService(db, reconciliation);
        const first = await makeCase('2026-10-02');
        const secondShift = await db.getRepository(ShiftEntity).save({
          ...shift,
          id: randomUUID(),
          name: 'Second shift',
          startsAt: new Date('2020-01-01T11:00:00Z'),
          endsAt: new Date('2020-01-01T12:00:00Z'),
        });
        const second = await db
          .getRepository(WorkerScheduleEntity)
          .save({ ...first.schedule, id: randomUUID(), shiftId: secondShift.id });
        const secondDay = await db.transaction((m) =>
          reconciliation.ensureDay(
            m,
            Object.assign(new WorkerEntity(), { id: workerId, siteId }),
            new Date(),
            second,
            secondShift,
          ),
        );
        assert.notEqual(first.day.id, secondDay.id);
        assert.equal(
          (
            await db.transaction((m) =>
              reconciliation.ensureDay(
                m,
                Object.assign(new WorkerEntity(), { id: workerId, siteId }),
                new Date(),
                second,
                secondShift,
              ),
            )
          ).id,
          secondDay.id,
        );
        await db
          .getRepository(AttendanceDayEntity)
          .update(secondDay.id, { zoneAttendanceRequirement: first.day.zoneAttendanceRequirement });
        await assert.rejects(
          db.getRepository(WorkerScheduleEntity).save({ ...first.schedule, id: randomUUID() }),
        );
        await assert.rejects(
          db.getRepository(WorkerScheduleEntity).save({
            ...first.schedule,
            id: randomUUID(),
            shiftId: secondShift.id,
            workDate: first.schedule.workDate,
          }),
        );
        await db.getRepository(TeamAttendanceEntity).save({
          teamId: team.id,
          scheduleId: first.schedule.id,
          membershipId: membership.membershipId!,
          zoneId: zone.id,
          status: 'PRESENT',
          version: 1,
          updatedBy: leaderUser,
          updatedAt: new Date(),
        });
        const input = {
          requestId: randomUUID(),
          expectedSessionVersion: 1,
          proposedInAt: '2026-10-02T09:00:00Z',
          proposedOutAt: '2026-10-02T10:00:00Z',
          reason: 'First shift missing scans',
        };
        await attendance.requestMissingAttendance(peer, siteId, first.schedule.id, input);
        await attendance.reviewCorrection(rep, siteId, input.requestId, { approve: true });
        assert.equal((await days.detail(rep, siteId, first.day.id)).day.confirmedMinutes, 60);
        const report2 = {
          ...input,
          requestId: randomUUID(),
          proposedInAt: '2026-10-02T11:00:00Z',
          proposedOutAt: '2026-10-02T12:00:00Z',
        };
        await attendance.requestMissingAttendance(peer, siteId, second.id, report2);
        await attendance.reviewCorrection(rep, siteId, report2.requestId, {
          approve: false,
          reviewNote: 'Need additional evidence',
        });
        assert.equal((await days.detail(rep, siteId, secondDay.id)).day.confirmedMinutes, null);
        assert.equal((await days.detail(rep, siteId, first.day.id)).day.confirmedMinutes, 60);
      },
    );
  } finally {
    await owned.dispose();
  }
});
