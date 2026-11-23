import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { AttendanceDaysService } from '../../src/modules/workforce/attendance/attendance-days.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { AttendanceAbsenceReview1795651200000 } from '../../src/database/migrations/1795651200000-AttendanceAbsenceReview.js';
import {
  AccessAttemptEntity,
  AccessAuditEntity,
  AttendanceAbsenceReviewEntity,
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

test('Gate absence review: persisted scope, evidence checks, immutable roll call, retries and notifications', async (t) => {
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
      const record = await db.getRepository(TeamAttendanceEntity).save({
        scheduleId: schedule.id,
        teamId: team.id,
        membershipId: membership.membershipId!,
        zoneId: zone.id,
        status: 'PRESENT',
        version: 1,
        updatedBy: leaderUser,
        updatedAt: new Date(),
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
      return { day, record, schedule };
    }
    async function commandFor(dayId: string) {
      const detail = await days.detail(rep, siteId, dayId);
      return {
        requestId: randomUUID(),
        expectedVersion: detail.day.version,
        expectedTeamAttendanceVersion: detail.gateAbsenceReview?.teamAttendance?.version ?? 1,
        reason: 'Verified Worker did not attend the Site',
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
    await t.test(
      'queues zero hours, notifies only the scoped representative once, and links to the exact day',
      async () => {
        const { day } = await makeCase();
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        const detail = await days.detail(rep, siteId, day.id);
        assert.equal(detail.day.status, 'NEEDS_REVIEW');
        assert.equal(detail.day.provisionalMinutes, 0);
        assert.equal(detail.gateAbsenceReview?.canConfirm, true);
        const rows = await db
          .getRepository(UserNotificationEntity)
          .findBy({ siteId, event: 'ABSENCE_REVIEW_REQUIRED' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.recipientUserId, repId);
        assert.equal(rows[0]!.content.dayId, day.id);
        const listed = await notifications.list(rep, 'ALL', 0, 20);
        const notice = listed.items.find((item) => item.id === rows[0]!.id)!;
        assert.equal('dayId' in notice.target && notice.target.dayId, day.id);
        assert.equal(notice.target.tab, 'attendance');
        const command = await commandFor(day.id);
        await days.confirmAbsence(rep, siteId, day.id, command);
        await days.confirmAbsence(rep, siteId, day.id, command);
        const resolved = await days.detail(rep, siteId, day.id);
        assert.equal(resolved.day.status, 'ABSENT');
        assert.equal(resolved.day.regularMinutes, 0);
        assert.equal(resolved.day.overtimeMinutes, 0);
        assert.equal(resolved.gateAbsenceReview?.status, 'CONFIRMED_ABSENT');
        assert.equal(resolved.gateAbsenceReview?.canConfirm, false);
        assert.equal(
          (
            await db
              .getRepository(TeamAttendanceEntity)
              .findOneByOrFail({ scheduleId: day.scheduleId! })
          ).status,
          'PRESENT',
        );
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          1,
        );
        assert.equal(
          await db
            .getRepository(AccessAuditEntity)
            .countBy({ action: 'ATTENDANCE_ABSENCE_CONFIRMED', entityId: day.id }),
          1,
        );
        assert.equal(await db.getRepository(GateEventEntity).countBy({ siteId }), 0);
        await assert.rejects(
          days.confirmAbsence(rep, siteId, day.id, { ...command, reason: 'Changed retry reason' }),
        );
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        assert.equal((await days.detail(rep, siteId, day.id)).day.status, 'ABSENT');
      },
    );
    await t.test(
      'denies Worker, cross-Contractor, missing scope, revoked account and unavailable permissions',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        await assert.rejects(days.confirmAbsence(peer, siteId, day.id, input));
        await assert.rejects(
          days.confirmAbsence(
            actor(otherRep, UserRole.CONTRACTOR_REPRESENTATIVE),
            siteId,
            day.id,
            input,
          ),
        );
        await assert.rejects(days.confirmAbsence(rep, randomUUID(), day.id, input));
        const grant = await db
          .getRepository(ContractorRepresentativeAssignmentEntity)
          .findOneByOrFail({ userId: repId, siteId, contractorId });
        await db.getRepository(ContractorRepresentativeAssignmentEntity).delete(grant.id);
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        await db.getRepository(ContractorRepresentativeAssignmentEntity).save(grant);
        await db.getRepository(UserEntity).update(repId, { isActive: false });
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        await db.getRepository(UserEntity).update(repId, { isActive: true });
        const unavailable = {
          transaction: (fn: (m: EntityManager) => Promise<unknown>) =>
            db.transaction((m) =>
              fn(
                new Proxy(m, {
                  get(target, key) {
                    if (key === 'getRepository')
                      return (entity: unknown) => {
                        if (entity === UserEntity)
                          throw new Error('Permission storage unavailable');
                        return target.getRepository(entity as typeof UserEntity);
                      };
                    const value = Reflect.get(target, key);
                    return typeof value === 'function' ? value.bind(target) : value;
                  },
                }),
              ),
            ),
        } as unknown as DataSource;
        await assert.rejects(
          new AttendanceDaysService(unavailable, reconciliation).confirmAbsence(
            rep,
            siteId,
            day.id,
            input,
          ),
        );
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          0,
        );
      },
    );
    await t.test(
      'blocks self-review even when the Worker also has representative scope',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        const role = await db.getRepository(UserRoleAssignmentEntity).save({
          id: randomUUID(),
          userId: workerUser,
          siteId,
          role: UserRole.CONTRACTOR_REPRESENTATIVE,
        });
        const grant = await db
          .getRepository(ContractorRepresentativeAssignmentEntity)
          .save({ id: randomUUID(), userId: workerUser, siteId, contractorId });
        await assert.rejects(
          days.confirmAbsence(
            actor(workerUser, UserRole.CONTRACTOR_REPRESENTATIVE),
            siteId,
            day.id,
            input,
          ),
        );
        assert.equal(
          (await days.detail(actor(workerUser, UserRole.CONTRACTOR_REPRESENTATIVE), siteId, day.id))
            .gateAbsenceReview?.canConfirm,
          false,
        );
        await db.getRepository(ContractorRepresentativeAssignmentEntity).delete(grant.id);
        await db.getRepository(UserRoleAssignmentEntity).delete(role.id);
      },
    );
    await t.test(
      'rejects stale day/roll-call versions and reused request IDs without partial resolution',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        await assert.rejects(
          days.confirmAbsence(rep, siteId, day.id, {
            ...input,
            expectedVersion: input.expectedVersion + 1,
          }),
        );
        await db
          .getRepository(TeamAttendanceEntity)
          .update({ scheduleId: day.scheduleId! }, { version: 2 });
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        const fresh = await commandFor(day.id);
        const results = await Promise.allSettled([
          days.confirmAbsence(rep, siteId, day.id, fresh),
          days.confirmAbsence(rep, siteId, day.id, { ...fresh, requestId: randomUUID() }),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          1,
        );
      },
    );
    await t.test('does not notify or allow absence for an unprojected Gate IN or OUT', async () => {
      for (const direction of ['IN', 'OUT'] as const) {
        const { day } = await makeCase(undefined, false);
        const noticesBefore = await db
          .getRepository(UserNotificationEntity)
          .countBy({ siteId, event: 'ABSENCE_REVIEW_REQUIRED' });
        await recordGate(day, direction);
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, await commandFor(day.id)));
        assert.equal((await days.detail(rep, siteId, day.id)).gateAbsenceReview, undefined);
        assert.equal(
          await db
            .getRepository(UserNotificationEntity)
            .countBy({ siteId, event: 'ABSENCE_REVIEW_REQUIRED' }),
          noticesBefore,
        );
      }
    });
    await t.test(
      'rejects confirmation when a new Gate event arrives after the notice',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        await recordGate(day, 'IN');
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          0,
        );
      },
    );
    await t.test(
      'rechecks new Gate evidence after a notice and preserves conflicting evidence after a decision',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        await days.confirmAbsence(rep, siteId, day.id, input);
        await recordGate(day, 'OUT');
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        const changed = await days.detail(rep, siteId, day.id);
        assert.equal(changed.day.status, 'NEEDS_REVIEW');
        assert.ok(changed.day.anomalies.includes('ABSENCE_REVIEW_CONFLICT'));
        assert.equal(changed.gateAbsenceReview?.status, 'CONFLICTED');
        assert.equal(changed.gateAbsenceReview?.canConfirm, false);
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          1,
        );
      },
    );
    await t.test(
      'rejects missing Gate projection when attendance events exist, including OUT-only evidence',
      async () => {
        const { day } = await makeCase(),
          input = await commandFor(day.id);
        await db.getRepository(AttendanceEventEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftAssignmentId: day.scheduleId!,
          kind: 'CHECK_OUT',
          method: 'MANUAL',
          gateEventId: null,
          occurredAt: new Date(`${day.workDate}T09:30:00Z`),
          recordedBy: repId,
          reasonCode: 'SYNTHETIC',
        });
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        assert.equal(
          await db.getRepository(AttendanceAbsenceReviewEntity).countBy({ dayId: day.id }),
          0,
        );
      },
    );
    await t.test(
      'waits until the shift and approved overtime have ended; no absence notification during the shift',
      async () => {
        const { day } = await makeCase('2026-11-24'),
          input = await commandFor(day.id);
        assert.equal((await days.detail(rep, siteId, day.id)).gateAbsenceReview, undefined);
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, input));
        const current = await makeCase('2026-11-23');
        await db.getRepository(OvertimeRequestEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          scheduleId: current.schedule.id,
          expectedShiftId: shift.id,
          startsAt: new Date('2026-11-23T10:00:00Z'),
          endsAt: new Date('2026-11-23T13:00:00Z'),
          requestedBy: workerUser,
          reason: 'Synthetic approved overtime',
          status: 'APPROVED',
        });
        await assert.rejects(
          days.confirmAbsence(rep, siteId, current.day.id, await commandFor(current.day.id)),
        );
      },
    );
    await t.test(
      'counts raw overnight overtime Gate evidence even without an attendance projection',
      async () => {
        const { day, schedule } = await makeCase('2026-11-20', false);
        const night = await db.getRepository(ShiftEntity).save({
          id: randomUUID(),
          siteId,
          name: 'Synthetic overnight',
          startsAt: new Date('2020-01-01T23:00:00Z'),
          endsAt: new Date('2020-01-02T00:30:00Z'),
          timezone: 'UTC',
        });
        await db.getRepository(WorkerScheduleEntity).update(schedule.id, { shiftId: night.id });
        await db.getRepository(AttendanceDayEntity).update(day.id, {
          startsAt: new Date('2026-11-20T23:00:00Z'),
          endsAt: new Date('2026-11-21T00:30:00Z'),
        });
        await db.getRepository(OvertimeRequestEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          scheduleId: schedule.id,
          expectedShiftId: night.id,
          startsAt: new Date('2026-11-21T00:30:00Z'),
          endsAt: new Date('2026-11-21T02:00:00Z'),
          requestedBy: workerUser,
          reason: 'Synthetic overnight overtime',
          status: 'APPROVED',
        });
        await recordGate(day, 'OUT', new Date('2026-11-21T01:30:00Z'));
        await db.transaction((m) => reconciliation.refresh(m, day.id));
        await assert.rejects(days.confirmAbsence(rep, siteId, day.id, await commandFor(day.id)));
        const notices = await db
          .getRepository(UserNotificationEntity)
          .findBy({ siteId, event: 'ABSENCE_REVIEW_REQUIRED' });
        assert.equal(
          notices.some((notice) => notice.content.dayId === day.id),
          false,
        );
      },
    );
    await t.test(
      'review schema matches metadata and rejects inconsistent roll-call snapshots',
      async () => {
        assert.deepEqual(
          (await db.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query),
          [],
        );
        const [review] = await db.getRepository(AttendanceAbsenceReviewEntity).find({ take: 1 });
        assert.ok(review);
        await assert.rejects(
          db.getRepository(AttendanceAbsenceReviewEntity).insert({
            ...review,
            id: randomUUID(),
            zoneId: randomUUID(),
          }),
          (error: unknown) =>
            (error as { driverError?: { code?: string } }).driverError?.code === '23514',
        );
        await assert.rejects(
          db.getRepository(AttendanceAbsenceReviewEntity).insert({
            ...review,
            id: randomUUID(),
            teamAttendanceVersion: review.teamAttendanceVersion + 100,
          }),
          (error: unknown) =>
            (error as { driverError?: { code?: string } }).driverError?.code === '23514',
        );
      },
    );
    await t.test(
      'migration rollback refuses to erase populated review and notification history',
      async () => {
        const runner = db.createQueryRunner();
        await runner.connect();
        try {
          await assert.rejects(
            new AttendanceAbsenceReview1795651200000().down(runner),
            /Preserve absence review/,
          );
        } finally {
          await runner.release();
        }
      },
    );
  } finally {
    await owned.dispose();
  }
});
