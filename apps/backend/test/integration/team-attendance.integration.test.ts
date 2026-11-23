import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { TeamAttendanceService } from '../../src/modules/workforce/teams/team-attendance.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { attendanceZoneIssue } from '../../src/modules/workforce/attendance/attendance-zone-policy.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import {
  AccessAuditEntity,
  AccessAttemptEntity,
  AttendanceDayEntity,
  AttendanceEventEntity,
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  ContractorTeamEntity,
  ContractorZonePermissionEntity,
  GateEventEntity,
  GateEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  SiteEntity,
  TeamAttendanceEntity,
  TeamZonePermissionEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { TeamAttendance1795219200000 } from '../../src/database/migrations/1795219200000-TeamAttendance.js';

test('zone roll call: scoped leadership, explicit statuses, correction audit, retries and gate reconciliation', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      contractorId = randomUUID(),
      repId = randomUUID(),
      leaderUser = randomUUID(),
      peerUser = randomUUID();
    const leaderId = randomUUID(),
      peerId = randomUUID(),
      outsiderId = randomUUID();
    const now = new Date(),
      workDate = now.toISOString().slice(0, 10),
      from = new Date('2020-01-01'),
      until = new Date('2040-01-01');
    await db
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic roll call site' });
    await db
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    for (const id of [repId, leaderUser, peerUser])
      await db.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: id,
        passwordHash: 'synthetic-unused-password-hash',
        isActive: true,
        mustChangePassword: false,
      });
    for (const id of [leaderUser, peerUser])
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, siteId, role: UserRole.WORKER });
    await db
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE });
    const participation = await db.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      validFrom: from,
      validUntil: until,
      isActive: true,
    });
    await db
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), siteId, contractorId, userId: repId });
    for (const [id, userId] of [
      [leaderId, leaderUser],
      [peerId, peerUser],
      [outsiderId, null],
    ] as const)
      await db.getRepository(WorkerEntity).save({
        id,
        userId,
        siteId,
        contractorId,
        externalId: id,
        displayName: id,
        isActive: true,
      });
    const actor = (id: string, role: UserRole): AuthenticatedUser => ({
      id,
      username: id,
      displayName: id,
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId, role }],
    });
    const rep = actor(repId, UserRole.CONTRACTOR_REPRESENTATIVE),
      leader = actor(leaderUser, UserRole.WORKER),
      peer = actor(peerUser, UserRole.WORKER);
    const teams = new ContractorTeamsService(db),
      attendance = new TeamAttendanceService(
        db,
        new AttendanceReconciliationService(db, new SchedulingNotificationService(db)),
      );
    let team = await teams.create(rep, siteId, contractorId, {
      requestId: randomUUID(),
      name: 'Synthetic crew',
    });
    const leaderMembership = await teams.assign(rep, siteId, contractorId, leaderId, {
      requestId: randomUUID(),
      expectedMembershipId: null,
      teamId: team.id,
    });
    const peerMembership = await teams.assign(rep, siteId, contractorId, peerId, {
      requestId: randomUUID(),
      expectedMembershipId: null,
      teamId: team.id,
    });
    const zone = await db.getRepository(ZoneEntity).save({
      id: randomUUID(),
      siteId,
      code: 'roll-call',
      name: 'Synthetic zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    const parent = await db.getRepository(ContractorZonePermissionEntity).save({
      id: randomUUID(),
      siteContractorId: participation.id,
      zoneId: zone.id,
      validFrom: from,
      validUntil: until,
      grantedBy: repId,
      revokedAt: null,
    });
    await db.getRepository(TeamZonePermissionEntity).save({
      id: randomUUID(),
      teamId: team.id,
      contractorZonePermissionId: parent.id,
      validFrom: from,
      validUntil: until,
      grantedBy: repId,
      revokedAt: null,
    });
    const shift = await db.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Synthetic full day',
      timezone: 'UTC',
      startsAt: new Date('2020-01-01T00:00:00Z'),
      endsAt: new Date('2020-01-02T00:00:00Z'),
    });
    const version = await db
      .getRepository(ScheduleVersionEntity)
      .save({ id: randomUUID(), siteId, version: 1, effectiveFrom: from, effectiveUntil: until });
    const schedules = [];
    for (const workerId of [leaderId, peerId, outsiderId])
      schedules.push(
        await db.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftId: shift.id,
          scheduleVersionId: version.id,
          workDate,
          isActive: true,
        }),
      );
    const self = schedules[0]!,
      member = schedules[1]!,
      outsider = schedules[2]!;
    const input = () => ({
      requestId: randomUUID(),
      teamId: team.id,
      zoneId: zone.id,
      entries: [
        {
          scheduleId: member.id,
          expectedMembershipId: peerMembership.membershipId!,
          expectedVersion: 0,
          status: 'PRESENT' as const,
        },
      ],
    });

    await t.test(
      'only a scoped representative appoints an active member; workers cannot appoint themselves',
      async () => {
        await assert.rejects(
          teams.setLeader(peer, siteId, contractorId, team.id, {
            expectedVersion: team.version,
            workerId: peerId,
          }),
        );
        await assert.rejects(
          teams.setLeader(rep, siteId, contractorId, team.id, {
            expectedVersion: team.version,
            workerId: outsiderId,
          }),
        );
        team = await teams.setLeader(rep, siteId, contractorId, team.id, {
          expectedVersion: team.version,
          workerId: leaderId,
        });
        assert.equal((await teams.myTeam(leader, siteId)).isLeader, true);
        assert.equal((await attendance.get(leader, siteId, self.id)).members.length, 2);
        const ordinary = await attendance.get(peer, siteId, member.id);
        assert.equal(ordinary.own.status, 'NOT_YET');
        assert.equal(ordinary.canManage, false);
        assert.deepEqual(ordinary.members, []);
        await assert.rejects(attendance.get(peer, siteId, self.id));
        await assert.rejects(attendance.get(leader, randomUUID(), self.id));
        await assert.rejects(attendance.submit(peer, siteId, member.id, input()));
        await assert.rejects(
          attendance.submit(leader, siteId, self.id, {
            ...input(),
            entries: [{ ...input().entries[0]!, scheduleId: outsider.id }],
          }),
        );
      },
    );
    await t.test(
      'explicit choices stay separate from gate evidence; retries do not create a second audit',
      async () => {
        const command = input();
        await attendance.submit(leader, siteId, self.id, command);
        await attendance.submit(leader, siteId, self.id, command);
        const result = await attendance.get(peer, siteId, member.id);
        assert.equal(result.own.status, 'PRESENT');
        assert.equal(result.own.gateCheck, 'NO_GATE_ENTRY');
        assert.equal(result.own.version, 1);
        assert.equal((await attendance.get(leader, siteId, self.id)).own.status, 'NOT_YET');
        assert.equal(
          await db
            .getRepository(AccessAuditEntity)
            .countBy({ siteId, action: 'TEAM_ATTENDANCE_SUBMITTED' }),
          1,
        );
        await assert.rejects(
          attendance.submit(leader, siteId, self.id, {
            ...command,
            reason: 'Different reused request',
          }),
        );
      },
    );
    await t.test(
      'corrections require a reason, preserve history and reject stale versions/memberships',
      async () => {
        const correction = {
          ...input(),
          entries: [{ ...input().entries[0]!, expectedVersion: 1, status: 'ABSENT' as const }],
        };
        await assert.rejects(attendance.submit(leader, siteId, self.id, correction));
        await assert.rejects(
          attendance.submit(leader, siteId, self.id, {
            ...correction,
            reason: 'Rechecked worker',
            entries: [{ ...correction.entries[0]!, expectedMembershipId: randomUUID() }],
          }),
        );
        await attendance.submit(leader, siteId, self.id, {
          ...correction,
          reason: 'Rechecked worker at assigned zone',
        });
        assert.equal((await attendance.get(peer, siteId, member.id)).own.status, 'ABSENT');
        const audit = await db
          .getRepository(AccessAuditEntity)
          .findOneByOrFail({ entityId: correction.requestId });
        assert.equal((audit.changes?.before as { status: string }[])[0]!.status, 'PRESENT');
        await assert.rejects(
          attendance.submit(leader, siteId, self.id, { ...input(), reason: 'Stale update' }),
        );
      },
    );
    await t.test(
      'gate-only and matched evidence are derived without changing the gate records',
      async () => {
        const fixtureGate = await db.getRepository(GateEntity).save({
          id: randomUUID(),
          siteId,
          code: 'ROLL-CALL',
          name: 'Synthetic gate',
          status: 'ACTIVE',
        });
        const attempt = await db.getRepository(AccessAttemptEntity).save({
          id: randomUUID(),
          siteId,
          gateId: fixtureGate.id,
          operatorId: repId,
          direction: 'IN',
          method: 'QR',
          workerId: peerId,
          identityStatus: 'MATCHED',
          authorizationStatus: 'ALLOWED',
          scheduleStatus: 'SCHEDULED',
          reasonCode: 'SYNTHETIC',
          status: 'USED',
          expiresAt: new Date(+now + 60000),
          createdAt: now,
        });
        const gate = await db.getRepository(GateEventEntity).save({
          id: randomUUID(),
          accessAttemptId: attempt.id,
          siteId,
          workerId: peerId,
          direction: 'IN',
          occurredAt: now,
          gateName: 'Synthetic gate',
          idempotencyKey: randomUUID(),
          recordedBy: repId,
        });
        await db.getRepository(AttendanceEventEntity).save({
          id: randomUUID(),
          siteId,
          workerId: peerId,
          shiftAssignmentId: member.id,
          kind: 'CHECK_IN',
          method: 'QR',
          gateEventId: gate.id,
          occurredAt: now,
          recordedBy: repId,
          reasonCode: 'SYNTHETIC',
        });
        assert.equal((await attendance.get(peer, siteId, member.id)).own.gateCheck, 'GATE_ONLY');
        await attendance.submit(leader, siteId, self.id, {
          ...input(),
          reason: 'Worker arrived after roll call',
          entries: [{ ...input().entries[0]!, expectedVersion: 2 }],
        });
        assert.equal((await attendance.get(peer, siteId, member.id)).own.gateCheck, 'MATCHED');
        assert.equal(await db.getRepository(GateEventEntity).countBy({ siteId }), 1);
      },
    );
    await t.test(
      'membership added after shift start resolves incomplete attendance without backdating',
      async () => {
        await db.query('UPDATE team_attendance_policy SET effective_from=$1', [from]);
        const joined = await db.query(
          'SELECT joined_at FROM contractor_team_membership WHERE id=$1',
          [peerMembership.membershipId],
        );
        const startsAt = new Date(`${workDate}T00:00:00Z`);
        assert.ok(+joined[0].joined_at > +startsAt);
        const incomplete = Object.assign(new AttendanceDayEntity(), {
          siteId,
          workerId: peerId,
          scheduleId: member.id,
          startsAt,
          status: 'NEEDS_REVIEW',
          zoneAttendanceRequirement: {
            version: 1,
            required: true,
            teamId: team.id,
            zoneId: zone.id,
            membershipId: null,
          },
        });
        assert.equal(await attendanceZoneIssue(db.manager, incomplete, new Date()), null);
        assert.equal(
          incomplete.zoneAttendanceRequirement?.membershipId,
          peerMembership.membershipId,
        );
        assert.equal(
          +(
            await db.query('SELECT joined_at FROM contractor_team_membership WHERE id=$1', [
              peerMembership.membershipId,
            ])
          )[0].joined_at,
          +joined[0].joined_at,
        );
      },
    );
    await t.test(
      'contractor aggregate stays scoped and policy checks real gate plus matching roll call',
      async () => {
        // This historical roster fixture remains independent of the live attendance policy.
        await db.query('UPDATE contractor_team_membership SET joined_at=$2 WHERE team_id=$1', [
          team.id,
          from,
        ]);
        const roster = await teams.attendance(rep, siteId, contractorId, team.id, {
          workDate,
          shiftId: shift.id,
          scheduleVersionId: version.id,
          offset: 0,
          limit: 8,
        });
        assert.equal(roster.total, 2);
        assert.equal(roster.matched, 1);
        assert.equal(roster.items.find((row) => row.workerId === peerId)?.gateCheck, 'MATCHED');
        await assert.rejects(
          teams.attendance(peer, siteId, contractorId, team.id, {
            workDate,
            shiftId: shift.id,
            scheduleVersionId: version.id,
          }),
        );
        await assert.rejects(
          teams.attendance(rep, siteId, randomUUID(), team.id, {
            workDate,
            shiftId: shift.id,
            scheduleVersionId: version.id,
          }),
        );
        await assert.rejects(
          teams.attendance(rep, randomUUID(), contractorId, team.id, {
            workDate,
            shiftId: shift.id,
            scheduleVersionId: version.id,
          }),
        );
        const day: AttendanceDayEntity = Object.assign(new AttendanceDayEntity(), {
          siteId,
          workerId: peerId,
          scheduleId: member.id,
          startsAt: new Date(`${workDate}T00:00:00Z`),
          status: 'NEEDS_REVIEW' as const,
          zoneAttendanceRequirement: null,
        });
        await db.query('UPDATE team_attendance_policy SET effective_from=$1', [from]);
        assert.equal(await attendanceZoneIssue(db.manager, day, new Date()), null);
        assert.equal(day.zoneAttendanceRequirement?.membershipId, peerMembership.membershipId);
        const incomplete = {
          ...day,
          zoneAttendanceRequirement: {
            version: 1 as const,
            required: true,
            teamId: team.id,
            zoneId: zone.id,
            membershipId: null,
          },
        };
        assert.equal(await attendanceZoneIssue(db.manager, incomplete, new Date()), null);
        assert.equal(
          incomplete.zoneAttendanceRequirement?.membershipId,
          peerMembership.membershipId,
        );
        assert.equal(day.zoneAttendanceRequirement?.teamId, team.id);
        assert.equal(day.zoneAttendanceRequirement?.zoneId, zone.id);
        await db.query("UPDATE team_attendance SET status='ABSENT' WHERE schedule_id=$1", [
          member.id,
        ]);
        assert.equal(
          await attendanceZoneIssue(db.manager, day, new Date()),
          'ZONE_ATTENDANCE_ABSENT',
        );
        await db.query("UPDATE team_attendance SET status='PRESENT' WHERE schedule_id=$1", [
          member.id,
        ]);
        const oldDay = Object.assign(new AttendanceDayEntity(), {
          ...day,
          status: 'CONFIRMED',
          zoneAttendanceRequirement: null,
        });
        assert.equal(await attendanceZoneIssue(db.manager, oldDay, new Date()), null);
        assert.equal(oldDay.zoneAttendanceRequirement, null);
      },
    );
    await t.test('finalized days, malformed batches and foreign zones fail closed', async () => {
      await db.getRepository(AttendanceDayEntity).save({
        id: randomUUID(),
        siteId,
        workerId: peerId,
        scheduleId: member.id,
        workDate,
        timezone: 'UTC',
        status: 'CONFIRMED',
        confirmedMinutes: 480,
      });
      await assert.rejects(
        attendance.submit(leader, siteId, self.id, {
          ...input(),
          reason: 'Attempt finalized update',
          entries: [{ ...input().entries[0]!, expectedVersion: 3 }],
        }),
      );
      await assert.rejects(
        attendance.submit(leader, siteId, self.id, { ...input(), zoneId: randomUUID() }),
      );
      const future = await db.getRepository(WorkerScheduleEntity).save({
        ...self,
        id: randomUUID(),
        workDate: new Date(+now + 86400000).toISOString().slice(0, 10),
      });
      assert.equal((await attendance.get(leader, siteId, future.id)).canSubmit, false);
      const existing = await db
        .getRepository(TeamAttendanceEntity)
        .findOneByOrFail({ scheduleId: member.id });
      await assert.rejects(
        db.getRepository(TeamAttendanceEntity).save({
          ...existing,
          scheduleId: outsider.id,
          membershipId: leaderMembership.membershipId!,
        }),
      );
      const q = db.createQueryRunner();
      await q.connect();
      try {
        await assert.rejects(new TeamAttendance1795219200000().down(q), /Preserve/);
      } finally {
        await q.release();
      }
    });
    await t.test(
      'transferring the leader removes authority and leaves historical attendance unchanged',
      async () => {
        await teams.assign(rep, siteId, contractorId, leaderId, {
          requestId: randomUUID(),
          expectedMembershipId: leaderMembership.membershipId,
          teamId: null,
          reason: 'Leader transferred away',
        });
        assert.equal(
          (await db.getRepository(ContractorTeamEntity).findOneByOrFail({ id: team.id }))
            .leaderWorkerId,
          null,
        );
        await assert.rejects(attendance.submit(leader, siteId, self.id, input()));
        assert.equal((await attendance.get(peer, siteId, member.id)).own.status, 'PRESENT');
      },
    );
  } finally {
    await owned.dispose();
  }
});
