import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { createTestConfig } from '../support/config.js';
import {
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeAssignmentEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
  AttendanceDayEntity,
  AttendanceSessionEntity,
  AttendanceEventEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  AuthSessionEntity,
} from '../../src/database/entities/index.js';
import { AttendanceReportsService } from '../../src/modules/workforce/attendance/attendance-reports.service.js';
import { AttendanceReportsController } from '../../src/modules/workforce/attendance/attendance-reports.controller.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { HttpExceptionFilter } from '../../src/common/http/http-exception.filter.js';
import { scheduledShiftWindow } from '../../src/modules/workforce/attendance/attendance-calculation.js';
import type { AttendanceSummaryResponse, AttendanceWorkersResponse } from '@smartsite/contracts';

const database = createIsolatedTestDatabase();
const dataSource = database.dataSource;

test('attendance reports: real HTTP/auth, PostgreSQL totals, calendar data, search/filter pagination and scope revocation', async (t) => {
  t.after(() => database.dispose());
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T11:00:00Z') });
  await database.initialize();
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    contractorId = randomUUID(),
    otherContractor = randomUUID();
  const repId = randomUUID(),
    userId = randomUUID(),
    outsiderId = randomUUID(),
    adminId = randomUUID();
  const userIds = [repId, userId, outsiderId, adminId];
  const query = { fromDate: '2026-10-12', toDate: '2026-10-18' };
  const actor = (id: string) => ({ id, mustChangePassword: false, roleAssignments: [] });
  let app: NestExpressApplication | undefined;
  try {
    for (const id of [siteId, otherSite])
      await dataSource
        .getRepository(SiteEntity)
        .save({ id, code: id, name: 'Synthetic reports Site' });
    const password = 'SyntheticReport123!';
    const passwordHash = await hashPassword(password);
    for (const id of userIds)
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic report account',
        passwordHash,
        isActive: true,
        mustChangePassword: false,
      });
    for (const [id, role, site] of [
      [repId, UserRole.CONTRACTOR_REPRESENTATIVE, siteId],
      [userId, UserRole.WORKER, siteId],
      [outsiderId, UserRole.WORKER, otherSite],
      [adminId, UserRole.ADMIN, null],
    ] as const)
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, role, siteId: site });
    for (const id of [contractorId, otherContractor])
      await dataSource
        .getRepository(ContractorEntity)
        .save({ id, code: id, name: 'Synthetic report Contractor', isActive: true });
    for (const [contractor, site] of [
      [contractorId, siteId],
      [otherContractor, siteId],
      [otherContractor, otherSite],
    ])
      await dataSource.getRepository(ContractorSiteParticipationEntity).save({
        id: randomUUID(),
        contractorId: contractor!,
        siteId: site!,
        isActive: true,
        validFrom: new Date('2020-01-01T00:00:00Z'),
        validUntil: null,
      });
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), siteId, contractorId, userId: repId });
    const worker = await dataSource.getRepository(WorkerEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      userId,
      externalId: `A-${siteId}`,
      displayName: 'A Synthetic Worker',
      isActive: true,
    });
    const second = await dataSource.getRepository(WorkerEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      externalId: `B-${siteId}`,
      displayName: 'B Synthetic Worker',
      isActive: true,
    });
    const excluded = await dataSource.getRepository(WorkerEntity).save({
      id: randomUUID(),
      siteId,
      contractorId: otherContractor,
      externalId: `C-${siteId}`,
      displayName: 'C Other Contractor',
      isActive: true,
    });
    await dataSource.getRepository(WorkerEntity).save({
      id: randomUUID(),
      siteId: otherSite,
      contractorId: otherContractor,
      userId: outsiderId,
      externalId: `D-${siteId}`,
      displayName: 'D Other Site',
      isActive: true,
    });
    const shift = await dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId,
      name: 'Morning',
      startsAt: new Date('2026-09-01T01:00:00Z'),
      endsAt: new Date('2026-09-01T10:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const evening = await dataSource.getRepository(ShiftEntity).save({
      ...shift,
      id: randomUUID(),
      name: 'Evening',
      startsAt: new Date('2026-09-01T13:00:00Z'),
      endsAt: new Date('2026-09-01T15:00:00Z'),
    });
    const version = await dataSource.getRepository(ScheduleVersionEntity).save({
      id: randomUUID(),
      siteId,
      version: 1,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    });
    async function attendance(
      workerId: string,
      date: string,
      status: AttendanceDayEntity['status'],
      minutes: number,
      overtime = 0,
      template = shift,
    ) {
      const schedule = await dataSource.getRepository(WorkerScheduleEntity).save({
        id: randomUUID(),
        workerId,
        siteId,
        shiftId: template.id,
        scheduleVersionId: version.id,
        workDate: date,
        isActive: true,
      });
      const window = scheduledShiftWindow(template, date);
      const day = await dataSource.getRepository(AttendanceDayEntity).save({
        id: randomUUID(),
        siteId,
        workerId,
        scheduleId: schedule.id,
        workDate: date,
        timezone: template.timezone,
        shiftName: template.name,
        ...window,
        status,
        regularMinutes: minutes,
        overtimeMinutes: overtime,
        confirmedMinutes: status === 'CONFIRMED' ? minutes + overtime : null,
        provisionalMinutes: minutes + overtime,
        anomalies: [],
      });
      if (minutes > 0) {
        const event = await dataSource.getRepository(AttendanceEventEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          shiftAssignmentId: schedule.id,
          kind: 'CHECK_IN',
          method: 'MANUAL',
          occurredAt: window.startsAt,
          reasonCode: 'SYNTHETIC',
          recordedBy: repId,
        });
        await dataSource.getRepository(AttendanceSessionEntity).save({
          id: randomUUID(),
          siteId,
          workerId,
          dayId: day.id,
          shiftAssignmentId: schedule.id,
          checkInEventId: event.id,
          effectiveInAt: window.startsAt,
          effectiveOutAt: window.endsAt,
          status: 'CORRECTED',
          version: 1,
        });
      }
      return schedule;
    }
    await attendance(worker.id, '2026-10-12', 'CONFIRMED', 480, 30);
    await attendance(worker.id, '2026-10-13', 'ABSENT', 0);
    const leaveSchedule = await attendance(worker.id, '2026-10-14', 'CONFIRMED', 0);
    await dataSource.getRepository(AbsenceRequestEntity).save({
      id: randomUUID(),
      siteId,
      workerId: worker.id,
      workerScheduleId: leaveSchedule.id,
      shiftId: shift.id,
      expectedScheduleVersionId: version.id,
      requestedByUserId: userId,
      reason: 'Synthetic approved full leave',
      status: AbsenceRequestStatus.APPROVED,
    });
    await attendance(worker.id, '2026-10-10', 'CONFIRMED', 240, 15);
    await attendance(worker.id, '2026-10-09', 'CONFIRMED', 120, 0, evening);
    await attendance(second.id, '2026-10-14', 'ABSENT', 0);
    await attendance(excluded.id, '2026-10-14', 'ABSENT', 0);
    const service = new AttendanceReportsService(dataSource);
    const report = await service.summary(actor(repId), siteId, query);
    assert.equal(report.totalWorkers, 2);
    assert.equal(report.absentTodayCount, 1);
    assert.equal(report.totalMinutes, 510);
    assert.equal(report.overtimeMinutes, 30);
    assert.equal(report.overtimeWorkerCount, 1);
    assert.equal(report.requiredDays, 3);
    assert.equal(report.presentDays, 1);
    assert.equal(report.attendanceRate, 33.33);
    assert.equal(report.previousPeriod.totalMinutes, 375);
    assert.equal(report.workingMinutesChangePercent, 36);
    const page = await service.list(actor(repId), siteId, {
      ...query,
      limit: 1,
      offset: 1,
      includeDaily: true,
    });
    assert.equal(page.total, 2);
    assert.equal(page.items[0]?.workerId, second.id);
    assert.equal(page.items[0]?.daily?.length, 7);
    const detail = await service.list(actor(userId), siteId, { ...query, includeDaily: true });
    assert.equal(detail.total, 1);
    assert.equal(detail.items[0]?.attendanceRate, 50);
    assert.equal(detail.items[0]?.todayStatus, 'APPROVED_LEAVE');
    assert.equal(detail.items[0]?.daily?.find((d) => d.workDate === '2026-10-18')?.status, 'OFF');
    assert.equal(
      (await service.list(actor(repId), siteId, { ...query, search: second.externalId })).total,
      1,
    );
    assert.equal(
      (await service.summary(actor(repId), siteId, { ...query, todayStatus: 'ABSENT' }))
        .totalWorkers,
      1,
    );
    assert.equal(
      (await service.summary(actor(repId), siteId, { ...query, shiftId: shift.id })).previousPeriod
        .totalMinutes,
      255,
    );
    assert.equal((await service.summary(actor(adminId), siteId, query)).totalWorkers, 3);
    await assert.rejects(
      service.list(actor(repId), siteId, { ...query, workerId: excluded.id }),
      (e: unknown) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await assert.rejects(service.list(actor(repId), otherSite, query));
    await assert.rejects(service.list(actor(outsiderId), siteId, query));
    await dataSource.getRepository(WorkerEntity).update(worker.id, { isActive: false });
    await assert.rejects(service.summary(actor(userId), siteId, query));
    await dataSource.getRepository(WorkerEntity).update(worker.id, { isActive: true });
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId, siteId });
    await assert.rejects(service.list(actor(userId), siteId, query));
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId, siteId, role: UserRole.WORKER });
    await assert.rejects(
      service.summary(actor(repId), siteId, { ...query, timezone: 'Invalid/Timezone' }),
    );
    await assert.rejects(
      service.summary(actor(repId), siteId, { ...query, fromDate: '2020-01-01' }),
    );
    const auth = new AuthService(
      dataSource,
      new AuthTokenService(new JwtService(), createTestConfig()),
    );
    const login = await auth.login(repId, password);
    const module = await Test.createTestingModule({
      controllers: [AttendanceReportsController],
      providers: [
        AttendanceReportsService,
        UserAuthGuard,
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const suffix = new URLSearchParams(query).toString();
    const headers = { Authorization: `Bearer ${login.accessToken}` };
    assert.equal(
      (await fetch(`${url}/api/v1/sites/${siteId}/attendance-summary?${suffix}`)).status,
      401,
    );
    const response = await fetch(`${url}/api/v1/sites/${siteId}/attendance-summary?${suffix}`, {
      headers,
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as AttendanceSummaryResponse).totalMinutes, 510);
    const workerResponse = await fetch(
      `${url}/api/v1/sites/${siteId}/attendance-workers?${suffix}&workerId=${worker.id}&includeDaily=true&limit=1`,
      { headers },
    );
    assert.equal(workerResponse.status, 200);
    assert.equal(
      ((await workerResponse.json()) as AttendanceWorkersResponse).items[0]?.daily?.length,
      7,
    );
    for (const extra of [
      '&asOf=2026-10-20',
      '&limit=101',
      '&includeDaily=invalid',
      '&recipientUserId=forged',
    ])
      assert.equal(
        (
          await fetch(`${url}/api/v1/sites/${siteId}/attendance-workers?${suffix}${extra}`, {
            headers,
          })
        ).status,
        400,
      );
    assert.equal(
      (await fetch(`${url}/api/v1/sites/${otherSite}/attendance-summary?${suffix}`, { headers }))
        .status,
      403,
    );
    await dataSource
      .getRepository(ContractorSiteParticipationEntity)
      .update({ siteId, contractorId }, { isActive: false });
    assert.equal(
      (await fetch(`${url}/api/v1/sites/${siteId}/attendance-summary?${suffix}`, { headers }))
        .status,
      403,
    );
    await dataSource
      .getRepository(ContractorSiteParticipationEntity)
      .update({ siteId, contractorId }, { isActive: true });
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .delete({ siteId, userId: repId });
    assert.equal(
      (await fetch(`${url}/api/v1/sites/${siteId}/attendance-workers?${suffix}`, { headers }))
        .status,
      403,
    );
    await dataSource.getRepository(UserEntity).update(repId, { isActive: false });
    assert.equal(
      (await fetch(`${url}/api/v1/sites/${siteId}/attendance-summary?${suffix}`, { headers }))
        .status,
      401,
    );
  } finally {
    if (app) await app.close();
    await cleanupSiteAccess(dataSource, [siteId, otherSite]);
    for (const table of [
      'absence_request',
      'worker_schedule',
      'shift',
      'schedule_version',
      'contractor_representative_assignment',
      'worker',
      'contractor_site_participation',
    ])
      await dataSource.query(`DELETE FROM ${table} WHERE site_id=ANY($1)`, [[siteId, otherSite]]);
    await dataSource.getRepository(ContractorEntity).delete([contractorId, otherContractor]);
    await dataSource.getRepository(AuthSessionEntity).delete({ userId: In(userIds) });
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId: In(userIds) });
    await dataSource.getRepository(UserEntity).delete(userIds);
    await dataSource.getRepository(SiteEntity).delete([siteId, otherSite]);
  }
});
