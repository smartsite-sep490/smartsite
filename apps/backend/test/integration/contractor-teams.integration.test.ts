import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import dataSource from '../support/test-data-source.js';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService, type AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling/scheduling-workflow.service.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/scheduling/schedule-configuration.service.js';
import { AttendanceReconciliationService } from '../../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import {
  SiteEntity,
  ContractorEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  WorkerEntity,
  ContractorTeamMembershipEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  ContractorShiftAssignmentEntity,
  WorkerScheduleEntity,
  ShiftRequestStatus,
  AccessAuditEntity,
  AccessAttemptEntity,
  GateEventEntity,
  AttendanceEventEntity,
  AttendanceDayEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  ContractorZonePermissionEntity,
} from '../../src/database/entities/index.js';

test('contractor teams: scoped dashboard, HTTP contracts, membership history, concurrency and swap lifecycle', async (t) => {
  await dataSource.initialize();
  let app: NestExpressApplication | undefined;
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    contractorId = randomUUID(),
    foreignContractor = randomUUID();
  const repId = randomUUID(),
    aUser = randomUUID(),
    bUser = randomUUID(),
    foreignUser = randomUUID();
  const aId = randomUUID(),
    bId = randomUUID(),
    cId = randomUUID(),
    foreignWorker = randomUUID();
  const ids = [repId, aUser, bUser, foreignUser];
  const actor = (id: string, role: UserRole): AuthenticatedUser => ({
    id,
    username: id,
    displayName: id,
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ siteId, role }],
  });
  const rep = actor(repId, UserRole.CONTRACTOR_REPRESENTATIVE),
    a = actor(aUser, UserRole.WORKER),
    b = actor(bUser, UserRole.WORKER);
  const service = new ContractorTeamsService(dataSource),
    workflow = new SchedulingWorkflowService(dataSource),
    configuration = new ScheduleConfigurationService(dataSource);
  try {
    await dataSource.getRepository(SiteEntity).save([
      { id: siteId, code: siteId, name: 'Synthetic team site' },
      { id: otherSite, code: otherSite, name: 'Second synthetic site' },
    ]);
    await dataSource.getRepository(ContractorEntity).save([
      { id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true },
      {
        id: foreignContractor,
        code: foreignContractor,
        name: 'Foreign contractor',
        isActive: true,
      },
    ]);
    const passwordHash = await hashPassword('Synthetic123!');
    await dataSource.getRepository(UserEntity).save(
      ids.map((id) => ({
        id,
        username: id,
        displayName: id,
        passwordHash,
        isActive: true,
        mustChangePassword: false,
      })),
    );
    await dataSource.getRepository(UserRoleAssignmentEntity).save([
      ...ids.map((id) => ({
        id: randomUUID(),
        userId: id,
        siteId,
        role: id === repId ? UserRole.CONTRACTOR_REPRESENTATIVE : UserRole.WORKER,
      })),
      {
        id: randomUUID(),
        userId: repId,
        siteId: otherSite,
        role: UserRole.CONTRACTOR_REPRESENTATIVE,
      },
    ]);
    await dataSource.getRepository(ContractorSiteParticipationEntity).save(
      [
        [siteId, contractorId],
        [otherSite, contractorId],
        [siteId, foreignContractor],
      ].map(([siteId, contractorId]) => ({
        id: randomUUID(),
        siteId: siteId!,
        contractorId: contractorId!,
        isActive: true,
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      })),
    );
    await dataSource.getRepository(ContractorRepresentativeAssignmentEntity).save(
      [siteId, otherSite].map((siteId) => ({
        id: randomUUID(),
        siteId,
        contractorId,
        userId: repId,
      })),
    );
    await dataSource.getRepository(WorkerEntity).save(
      [
        { id: aId, userId: aUser },
        { id: bId, userId: bUser },
        { id: cId, userId: null },
      ].map((w) => ({
        ...w,
        siteId,
        contractorId,
        externalId: w.id,
        displayName: w.id,
        isActive: true,
      })),
    );
    await dataSource.getRepository(WorkerEntity).save({
      id: foreignWorker,
      userId: foreignUser,
      siteId,
      contractorId: foreignContractor,
      externalId: foreignWorker,
      displayName: 'Foreign Worker',
      isActive: true,
    });
    const firstInput = { requestId: randomUUID(), name: 'Đội sơn', description: 'Paint team' };
    const paint = await service.create(rep, siteId, contractorId, firstInput),
      floor = await service.create(rep, siteId, contractorId, {
        requestId: randomUUID(),
        name: 'Đội sàn',
      });
    const assign = (workerId: string, teamId: string | null, expectedMembershipId: string | null) =>
      service.assign(rep, siteId, contractorId, workerId, {
        requestId: randomUUID(),
        teamId,
        expectedMembershipId,
        reason: 'Synthetic team assignment',
      });
    await t.test(
      'dashboard totals are scoped and never count schedules or membership history',
      async () => {
        assert.equal((await service.scopes(rep)).items.length, 2);
        let totals = await service.dashboard(rep, siteId, contractorId);
        assert.equal(totals.workerCount, 3);
        assert.equal(totals.teamCount, 2);
        assert.equal(totals.unassignedWorkerCount, 3);
        assert.equal((await service.dashboard(rep, otherSite, contractorId)).workerCount, 0);
        await assert.rejects(service.dashboard(a, siteId, contractorId));
        await assert.rejects(service.dashboard(rep, siteId, foreignContractor));
        await assert.rejects(assign(foreignWorker, paint.id, null));
        await assert.rejects(
          service.create(a, siteId, contractorId, { requestId: randomUUID(), name: 'Denied' }),
        );
        assert.equal((await service.create(rep, siteId, contractorId, firstInput)).id, paint.id);
        await assert.rejects(
          service.create(rep, siteId, contractorId, { requestId: randomUUID(), name: 'ĐỘI SƠN' }),
        );
        const initialAssignment = {
          requestId: randomUUID(),
          teamId: paint.id,
          expectedMembershipId: null,
        };
        const assigned = await service.assign(rep, siteId, contractorId, aId, initialAssignment);
        assert.equal(
          (await service.assign(rep, siteId, contractorId, aId, initialAssignment)).membershipId,
          assigned.membershipId,
        );
        const saved = await dataSource
          .getRepository(ContractorTeamMembershipEntity)
          .findOneByOrFail({ id: assigned.membershipId! });
        assert.equal(saved.reason, '');
        assert.equal(saved.assignedBy, repId);
        await assert.rejects(
          service.assign(rep, siteId, contractorId, aId, {
            requestId: randomUUID(),
            teamId: floor.id,
            expectedMembershipId: assigned.membershipId,
          }),
        );
        await assert.rejects(
          service.assign(rep, siteId, contractorId, aId, {
            requestId: randomUUID(),
            teamId: null,
            expectedMembershipId: assigned.membershipId,
          }),
        );
        await assign(bId, paint.id, null);
        totals = await service.dashboard(rep, siteId, contractorId);
        assert.equal(totals.unassignedWorkerCount, 1);
        assert.equal((await service.myTeam(a, siteId)).teamName, 'Đội sơn');
      },
    );
    await t.test(
      'membership transfer is optimistic, preserves history and concurrent updates admit one winner',
      async () => {
        const old = (
          await service.workers(rep, siteId, contractorId, { teamId: paint.id })
        ).items.find((w) => w.workerId === aId)!;
        const result = await assign(aId, floor.id, old.membershipId);
        await assert.rejects(assign(aId, paint.id, old.membershipId));
        assert.equal(
          (
            await dataSource
              .getRepository(ContractorTeamMembershipEntity)
              .findOneByOrFail({ id: old.membershipId! })
          ).leftAt !== null,
          true,
        );
        await assign(aId, paint.id, result.membershipId);
        const race = await Promise.allSettled([
          assign(cId, paint.id, null),
          assign(cId, floor.id, null),
        ]);
        assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          await dataSource.getRepository(ContractorTeamMembershipEntity).countBy({ workerId: cId }),
          1,
        );
        const c = (await service.workers(rep, siteId, contractorId, {})).items.find(
          (w) => w.workerId === cId,
        )!;
        await assign(cId, null, c.membershipId);
        const now = await service.workers(rep, siteId, contractorId, { unassigned: true });
        assert.equal(now.total, 1);
        assert.equal(now.items[0]!.workerId, cId);
        await assert.rejects(
          service.archive(rep, siteId, contractorId, paint.id, {
            expectedVersion: 1,
            reason: 'Cannot archive active members',
          }),
        );
        const archived = await service.archive(rep, siteId, contractorId, floor.id, {
          expectedVersion: 1,
          reason: 'Empty team retired',
        });
        assert.equal(archived.isActive, false);
        assert.equal((await service.dashboard(rep, siteId, contractorId)).teamCount, 1);
        await assert.rejects(assign(cId, floor.id, null));
        await assert.rejects(
          dataSource.getRepository(ContractorTeamMembershipEntity).save({
            id: randomUUID(),
            siteId,
            contractorId,
            teamId: paint.id,
            workerId: foreignWorker,
            joinedAt: new Date(),
            assignedBy: repId,
            reason: 'Cross contractor database rejection',
          }),
        );
        await assert.rejects(
          dataSource.getRepository(ContractorTeamMembershipEntity).save({
            id: randomUUID(),
            siteId,
            contractorId,
            teamId: paint.id,
            workerId: aId,
            joinedAt: new Date(),
            assignedBy: repId,
            reason: 'Duplicate active database rejection',
          }),
          /uq_team_worker_active/,
        );
      },
    );
    const versionId = randomUUID(),
      morning = randomUUID(),
      afternoon = randomUUID(),
      overlap = randomUUID();
    await dataSource
      .getRepository(ScheduleVersionEntity)
      .save({ id: versionId, siteId, version: 1, effectiveFrom: new Date('2020-01-01') });
    await dataSource.getRepository(ShiftEntity).save(
      [
        { id: morning, start: 8, end: 12 },
        { id: afternoon, start: 12, end: 16 },
        { id: overlap, start: 10, end: 14 },
      ].map((s) => ({
        id: s.id,
        siteId,
        name: s.id,
        startsAt: new Date(`2030-01-01T${String(s.start).padStart(2, '0')}:00Z`),
        endsAt: new Date(`2030-01-01T${String(s.end).padStart(2, '0')}:00Z`),
        timezone: 'UTC',
      })),
    );
    await dataSource.getRepository(ContractorShiftAssignmentEntity).save(
      [morning, afternoon, overlap].map((shiftId) => ({
        id: randomUUID(),
        siteId,
        contractorId,
        shiftId,
      })),
    );
    let index = 1;
    const schedules = async () =>
      dataSource
        .getRepository(WorkerScheduleEntity)
        .save(
          [aId, bId].map((workerId, i) => ({
            id: randomUUID(),
            siteId,
            workerId,
            shiftId: i === 0 ? morning : afternoon,
            scheduleVersionId: versionId,
            workDate: `2030-01-${String(index).padStart(2, '0')}`,
            isActive: true,
          })),
        )
        .then((r) => {
          index++;
          return r;
        });
    const swap = async () => {
      const [sa, sb] = await schedules();
      return {
        sa: sa!,
        sb: sb!,
        request: await workflow.createShiftSwap(a, siteId, {
          requesterWorkerScheduleId: sa!.id,
          coworkerWorkerScheduleId: sb!.id,
          reason: 'Synthetic opposite shift swap',
        }),
      };
    };
    await t.test(
      'same-team opposite shifts apply atomically; overlap and missing team are rejected',
      async (sub) => {
        const { sa, sb, request } = await swap();
        const reconciliation = new AttendanceReconciliationService(
          dataSource,
          new SchedulingNotificationService(dataSource),
        );
        await dataSource.transaction(async (manager) => {
          const occurredAt = new Date(`${sa.workDate}T08:30:00Z`);
          const attempt = await manager.getRepository(AccessAttemptEntity).save({
            id: randomUUID(),
            siteId,
            gateId: 'synthetic-gate',
            operatorId: repId,
            direction: 'IN',
            method: 'FACE',
            workerId: aId,
            identityStatus: 'MATCHED',
            authorizationStatus: 'ALLOWED',
            scheduleStatus: 'SCHEDULED',
            reasonCode: 'SYNTHETIC_VERIFIED',
            status: 'USED',
            createdAt: occurredAt,
            expiresAt: new Date(+occurredAt + 60000),
            usedAt: occurredAt,
          });
          const event = await manager.getRepository(GateEventEntity).save({
            id: randomUUID(),
            accessAttemptId: attempt.id,
            siteId,
            workerId: aId,
            direction: 'IN',
            occurredAt,
            gateName: 'synthetic-gate',
            idempotencyKey: randomUUID(),
            recordedBy: repId,
          });
          const worker = await manager.getRepository(WorkerEntity).findOneByOrFail({ id: aId });
          await reconciliation.recordPassage(manager, event, attempt, worker);
        });
        const attendanceDay = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ siteId, workerId: aId, workDate: sa.workDate });
        const raw = await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId });
        assert.equal((await configuration.listSwapCandidates(a, siteId, sa.id)).total, 1);
        await workflow.confirmShiftSwap(b, siteId, request.id);
        assert.equal(
          (await workflow.approveShiftSwap(rep, siteId, request.id)).status,
          ShiftRequestStatus.APPLIED,
        );
        assert.equal(
          (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: sa.id }))
            .shiftId,
          afternoon,
        );
        assert.equal(
          (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: sb.id }))
            .shiftId,
          morning,
        );
        await dataSource.transaction((manager) =>
          reconciliation.refresh(manager, attendanceDay.id, new Date(`${sa.workDate}T18:00:00Z`)),
        );
        const changed = await dataSource
          .getRepository(AttendanceDayEntity)
          .findOneByOrFail({ id: attendanceDay.id });
        assert.equal(+changed.startsAt!, +attendanceDay.startsAt!);
        assert.equal(+changed.endsAt!, +attendanceDay.endsAt!);
        assert.ok(changed.anomalies.includes('SCHEDULE_CHANGED'));
        assert.equal(changed.confirmedMinutes, null);
        assert.deepEqual(
          await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId }),
          raw,
        );
        sub.mock.timers.enable({ apis: ['Date'], now: new Date(`${sa.workDate}T13:00:00Z`) });
        assert.equal((await configuration.listSwapCandidates(a, siteId, sa.id)).total, 0);
        sub.mock.timers.reset();
        const [x, y] = await schedules();
        await dataSource.getRepository(WorkerScheduleEntity).update(y!.id, { shiftId: overlap });
        assert.equal((await configuration.listSwapCandidates(a, siteId, x!.id)).total, 0);
        await assert.rejects(
          workflow.createShiftSwap(a, siteId, {
            requesterWorkerScheduleId: x!.id,
            coworkerWorkerScheduleId: y!.id,
            reason: 'Overlapping shift rejected',
          }),
        );
      },
    );
    await t.test(
      'membership changes between submission, acceptance and approval conflict instead of applying',
      async () => {
        const target = await service.create(rep, siteId, contractorId, {
          requestId: randomUUID(),
          name: 'Other active team',
        });
        const first = await swap();
        let member = (await service.myTeam(b, siteId)).membershipId;
        let moved = await assign(bId, target.id, member);
        assert.equal(
          (await workflow.confirmShiftSwap(b, siteId, first.request.id)).status,
          ShiftRequestStatus.CONFLICTED,
        );
        assert.equal(
          (
            await dataSource
              .getRepository(WorkerScheduleEntity)
              .findOneByOrFail({ id: first.sa.id })
          ).shiftId,
          morning,
        );
        await assign(bId, paint.id, moved.membershipId);
        const second = await swap();
        await workflow.confirmShiftSwap(b, siteId, second.request.id);
        member = (await service.myTeam(b, siteId)).membershipId;
        moved = await assign(bId, null, member);
        assert.equal(
          (await workflow.approveShiftSwap(rep, siteId, second.request.id)).status,
          ShiftRequestStatus.CONFLICTED,
        );
        assert.equal((await configuration.listSwapCandidates(a, siteId, second.sa.id)).total, 0);
        await assign(bId, paint.id, moved.membershipId);
      },
    );
    await t.test(
      'inactive membership retirement and concurrent transfer versus approval keep team and schedule invariants',
      async () => {
        const inactiveTeam = await service.create(rep, siteId, contractorId, {
          requestId: randomUUID(),
          name: 'Inactive members test',
        });
        await assign(cId, inactiveTeam.id, null);
        await dataSource.getRepository(WorkerEntity).update(cId, { isActive: false });
        assert.equal(
          (await service.detail(rep, siteId, contractorId, inactiveTeam.id)).memberCount,
          0,
        );
        await service.archive(rep, siteId, contractorId, inactiveTeam.id, {
          expectedVersion: 1,
          reason: 'Inactive worker assignment retired',
        });
        await dataSource.getRepository(WorkerEntity).update(cId, { isActive: true });
        assert.equal(
          (await service.workers(rep, siteId, contractorId, { unassigned: true })).items[0]!
            .workerId,
          cId,
        );
        const target = await service.create(rep, siteId, contractorId, {
          requestId: randomUUID(),
          name: 'Race target team',
        });
        const pending = await swap();
        await workflow.confirmShiftSwap(b, siteId, pending.request.id);
        const membershipId = (await service.myTeam(b, siteId)).membershipId;
        const [outcome, moved] = await Promise.all([
          workflow.approveShiftSwap(rep, siteId, pending.request.id),
          assign(bId, target.id, membershipId),
        ]);
        assert.ok(
          [ShiftRequestStatus.APPLIED, ShiftRequestStatus.CONFLICTED].includes(outcome.status),
        );
        const sa = await dataSource
          .getRepository(WorkerScheduleEntity)
          .findOneByOrFail({ id: pending.sa.id });
        const sb = await dataSource
          .getRepository(WorkerScheduleEntity)
          .findOneByOrFail({ id: pending.sb.id });
        assert.deepEqual(
          [sa.shiftId, sb.shiftId],
          outcome.status === ShiftRequestStatus.APPLIED
            ? [afternoon, morning]
            : [morning, afternoon],
        );
        await assign(bId, paint.id, moved.membershipId);
      },
    );
    await t.test(
      'HTTP payloads consumed by dashboard/UI use real sessions and enforce validation and scope',
      async () => {
        const config = new ConfigService<BackendEnvironment, true>(
          validateEnvironment({
            NODE_ENV: 'test',
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            LOG_FORMAT: 'json',
          }),
        );
        const module = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(ConfigService)
          .useValue(config)
          .overrideProvider(PARAMS_PROVIDER_TOKEN)
          .useValue(createLoggerParams(config, { write: () => undefined }))
          .overrideProvider(getDataSourceToken())
          .useValue(dataSource)
          .overrideProvider(DataSource)
          .useValue(dataSource)
          .compile();
        app = module.createNestApplication<NestExpressApplication>({
          logger: false,
          bodyParser: false,
        });
        await configureApplication(app);
        await app.listen(0, '127.0.0.1');
        const token = (await module.get(AuthService).login(repId, 'Synthetic123!')).accessToken;
        const root = await app.getUrl();
        const prefix = `${root}/api/v1/sites/${siteId}/contractors/${contractorId}`;
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const scopes = await fetch(`${root}/api/v1/contractor-dashboard/scopes`, { headers });
        assert.equal(scopes.status, 200);
        assert.equal((await scopes.json()).items.length, 2);
        const dashboard = await fetch(`${prefix}/dashboard`, { headers });
        assert.equal(dashboard.status, 200);
        assert.equal((await dashboard.json()).workerCount, 3);
        const workers = await fetch(`${prefix}/team-workers?unassigned=true&limit=1`, { headers });
        assert.equal(workers.status, 200);
        assert.equal((await workers.json()).items[0].workerId, cId);
        assert.equal((await fetch(`${prefix}/teams?limit=101`, { headers })).status, 400);
        assert.equal((await fetch(`${prefix}/teams?unknown=true`, { headers })).status, 400);
        const input = {
          requestId: randomUUID(),
          name: 'HTTP team',
          description: 'Created through UI contract',
        };
        const created = await fetch(`${prefix}/teams`, {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
        });
        assert.equal(created.status, 201);
        const team = await created.json();
        assert.equal(team.memberCount, 0);
        assert.equal(team.version, 1);
        const zoneId = randomUUID();
        await dataSource.getRepository(ZoneEntity).save({
          id: zoneId,
          siteId,
          code: zoneId,
          name: 'HTTP team Zone',
          type: ZoneType.STANDARD,
          restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
          requiredPpe: [],
        });
        const participation = await dataSource
          .getRepository(ContractorSiteParticipationEntity)
          .findOneByOrFail({ siteId, contractorId });
        const parent = await dataSource.getRepository(ContractorZonePermissionEntity).save({
          id: randomUUID(),
          siteContractorId: participation.id,
          zoneId,
          validFrom: new Date('2020-01-01'),
          validUntil: new Date('2035-01-01'),
          grantedBy: repId,
          revokedAt: null,
        });
        const zonePath = `${prefix}/teams/${team.id}/zones`;
        assert.equal((await fetch(zonePath)).status, 401);
        const options = await fetch(zonePath, { headers });
        assert.equal(options.status, 200);
        assert.equal((await options.json()).availableZones[0].permissionId, parent.id);
        const date = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
        const zoneInput = {
          requestId: randomUUID(),
          contractorZonePermissionId: parent.id,
          startDate: date,
          endDate: date,
          timezone: 'UTC',
        };
        assert.equal(
          (
            await fetch(zonePath, {
              method: 'POST',
              headers,
              body: JSON.stringify({ ...zoneInput, zoneId }),
            })
          ).status,
          400,
        );
        const granted = await fetch(zonePath, {
          method: 'POST',
          headers,
          body: JSON.stringify(zoneInput),
        });
        assert.equal(granted.status, 201);
        const permission = await granted.json();
        assert.equal(
          (await fetch(`${prefix}/teams/${randomUUID()}/zones`, { headers })).status,
          404,
        );
        const list = await fetch(zonePath, { headers });
        assert.equal((await list.json()).permissions.length, 1);
        const edited = await fetch(`${zonePath}/${permission.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ ...zoneInput, requestId: randomUUID() }),
        });
        assert.equal(edited.status, 200);
        const replacement = await edited.json();
        const updatedTeam = await (await fetch(`${prefix}/teams/${team.id}`, { headers })).json();
        assert.equal(updatedTeam.zoneAssignments[0].id, replacement.id);
        assert.equal(
          (await fetch(`${zonePath}/${replacement.id}/revoke`, { method: 'POST', headers })).status,
          201,
        );
        const changed = await fetch(`${prefix}/teams/${team.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ expectedVersion: 1, name: 'Renamed HTTP team', description: '' }),
        });
        assert.equal(changed.status, 200);
        const assigned = await fetch(`${prefix}/team-workers/${cId}/team`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedMembershipId: null,
            teamId: team.id,
            reason: 'UI assignment request',
          }),
        });
        assert.equal(assigned.status, 200);
        assert.equal((await assigned.json()).teamName, 'Renamed HTTP team');
        assert.equal(
          (
            await fetch(`${prefix}/team-workers/${cId}/team`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({
                requestId: randomUUID(),
                teamId: team.id,
                reason: 'Missing concurrency binding',
              }),
            })
          ).status,
          400,
        );
        const workerToken = (await module.get(AuthService).login(aUser, 'Synthetic123!'))
          .accessToken;
        assert.equal(
          (
            await fetch(`${prefix}/dashboard`, {
              headers: { Authorization: `Bearer ${workerToken}` },
            })
          ).status,
          403,
        );
        const own = await fetch(`${root}/api/v1/sites/${siteId}/my-team`, {
          headers: { Authorization: `Bearer ${workerToken}` },
        });
        assert.equal(own.status, 200);
        assert.equal((await own.json()).teamId, paint.id);
        await dataSource
          .getRepository(ContractorRepresentativeAssignmentEntity)
          .delete({ userId: repId, siteId });
        assert.equal((await fetch(`${prefix}/dashboard`, { headers })).status, 403);
        assert.equal(
          (
            await fetch(`${prefix}/teams`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ requestId: randomUUID(), name: 'Revoked grant' }),
            })
          ).status,
          403,
        );
        assert.ok(
          (await dataSource
            .getRepository(AccessAuditEntity)
            .countBy({ siteId, action: 'CONTRACTOR_TEAM_MEMBERSHIP_CHANGED' })) > 0,
        );
      },
    );
  } finally {
    if (app) await app.close();
    if (!dataSource.isInitialized) await dataSource.initialize();
    await cleanupSiteAccess(dataSource, [siteId, otherSite]);
    await dataSource.getRepository(ZoneEntity).delete({ siteId });
    await dataSource.query('DELETE FROM shift_swap_request WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM contractor_team_membership WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM contractor_team WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM worker_schedule WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM contractor_shift_assignment WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM shift WHERE site_id=ANY($1)', [[siteId, otherSite]]);
    await dataSource.query('DELETE FROM schedule_version WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM worker WHERE site_id=ANY($1)', [[siteId, otherSite]]);
    await dataSource.query(
      'DELETE FROM contractor_representative_assignment WHERE site_id=ANY($1)',
      [[siteId, otherSite]],
    );
    await dataSource.query('DELETE FROM contractor_site_participation WHERE site_id=ANY($1)', [
      [siteId, otherSite],
    ]);
    await dataSource.query('DELETE FROM contractor WHERE id=ANY($1)', [
      [contractorId, foreignContractor],
    ]);
    await dataSource.query('DELETE FROM auth_session WHERE user_id=ANY($1)', [ids]);
    await dataSource.query('DELETE FROM user_role_assignment WHERE user_id=ANY($1)', [ids]);
    await dataSource.query('DELETE FROM app_user WHERE id=ANY($1)', [ids]);
    await dataSource.query('DELETE FROM site WHERE id=ANY($1)', [[siteId, otherSite]]);
    await dataSource.destroy();
  }
});
