import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import dataSource from '../support/test-data-source.js';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import { ContractorEntity } from '../../src/database/entities/contractor.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../src/database/entities/contractor-representative-assignment.entity.js';
import { WorkerEntity } from '../../src/database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../../src/database/entities/worker-schedule.entity.js';
import { ShiftEntity } from '../../src/database/entities/shift.entity.js';
import { ScheduleVersionEntity } from '../../src/database/entities/schedule-version.entity.js';
import { ShiftChangeRequestEntity } from '../../src/database/entities/shift-change-request.entity.js';
import { ShiftSwapRequestEntity } from '../../src/database/entities/shift-swap-request.entity.js';
import { AbsenceRequestEntity } from '../../src/database/entities/absence-request.entity.js';
import { AbsenceRequestStatus, ShiftRequestStatus } from '../../src/database/entities/enums.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('MF07 scheduling queries enforce role and scope boundaries', async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
  await dataSource.initialize();
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_FORMAT: 'json',
  });
  const config = new ConfigService<BackendEnvironment, true>(environment);
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
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const baseUrl = url.replace('127.0.0.1', 'localhost');

  // Set up data
  const siteA = randomUUID();
  const siteB = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await dataSource.getRepository(SiteEntity).save([
    { id: siteA, code: `TA_${suffix}`, name: 'Site A', isActive: true },
    { id: siteB, code: `TB_${suffix}`, name: 'Site B', isActive: true },
  ]);

  const contractorA = randomUUID();
  const contractorB = randomUUID();
  await dataSource.getRepository(ContractorEntity).save([
    { id: contractorA, siteId: siteA, code: `CA_${suffix}`, name: 'Contractor A', isActive: true },
    { id: contractorB, siteId: siteA, code: `CB_${suffix}`, name: 'Contractor B', isActive: true },
  ]);

  const pass = 'Password123!';
  const { UsersService } = await import('../../src/modules/users/users.service.js');
  const { AuthService } = await import('../../src/modules/auth/auth.service.js');
  const usersService = module.get(UsersService);
  const authService = module.get(AuthService);

  await usersService.create({
    username: `mgr_a_${suffix}`,
    displayName: 'Mgr A',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: siteA }],
    temporaryPassword: pass,
  });
  
  await usersService.create({
    username: `mgr_b_${suffix}`,
    displayName: 'Mgr B',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: siteB }],
    temporaryPassword: pass,
  });

  const repA = await usersService.create({
    username: `rep_a_${suffix}`,
    displayName: 'Rep A',
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA }],
    temporaryPassword: pass,
  });
  await dataSource.getRepository(ContractorRepresentativeAssignmentEntity).save({
    id: randomUUID(),
    siteId: siteA,
    contractorId: contractorA,
    userId: repA.id,
  });

  const workerAUser = await usersService.create({
    username: `worker_a_${suffix}`,
    displayName: 'Worker A',
    roleAssignments: [{ role: UserRole.WORKER, siteId: siteA }],
    temporaryPassword: pass,
  });

  const workerAEntityId = randomUUID();
  await dataSource.getRepository(WorkerEntity).save({
    id: workerAEntityId,
    siteId: siteA,
    contractorId: contractorA,
    userId: workerAUser.id,
    externalId: 'W_A',
    displayName: 'Worker A',
    isActive: true,
  });
  
  const workerBEntityId = randomUUID();
  await dataSource.getRepository(WorkerEntity).save({
    id: workerBEntityId,
    siteId: siteA,
    contractorId: contractorA,
    userId: null,
    externalId: 'W_B',
    displayName: 'Worker B',
    isActive: true,
  });

  const workerCEntityId = randomUUID();
  await dataSource.getRepository(WorkerEntity).save({
    id: workerCEntityId,
    siteId: siteA,
    contractorId: contractorB,
    userId: null,
    externalId: 'W_C',
    displayName: 'Worker C',
    isActive: true,
  });

  await usersService.create({
    username: `unaff_${suffix}`,
    displayName: 'Unaff',
    roleAssignments: [{ role: UserRole.WORKER, siteId: siteB }],
    temporaryPassword: pass,
  });

  const shiftId = randomUUID();
  const secondShiftId = randomUUID();
  await dataSource.getRepository(ShiftEntity).save({
    id: shiftId, siteId: siteA, name: 'S1', startsAt: '2026-01-01T08:00:00Z', endsAt: '2026-01-01T16:00:00Z', timezone: 'UTC'
  });
  await dataSource.getRepository(ShiftEntity).save({
    id: secondShiftId, siteId: siteA, name: 'S2', startsAt: '2026-01-01T16:00:00Z', endsAt: '2026-01-02T00:00:00Z', timezone: 'UTC'
  });
  const versionId = randomUUID();
  await dataSource.getRepository(ScheduleVersionEntity).save({
    id: versionId, siteId: siteA, version: 1000 + Math.floor(Math.random() * 1000), effectiveFrom: new Date()
  });

  const schedules = await dataSource
    .getRepository(WorkerScheduleEntity)
    .save([
      { id: randomUUID(), siteId: siteA, scheduleVersionId: versionId, workerId: workerAEntityId, shiftId, workDate: '2026-01-01', isActive: true },
      { id: randomUUID(), siteId: siteA, scheduleVersionId: versionId, workerId: workerBEntityId, shiftId: secondShiftId, workDate: '2026-01-01', isActive: true },
      { id: randomUUID(), siteId: siteA, scheduleVersionId: versionId, workerId: workerCEntityId, shiftId: secondShiftId, workDate: '2026-01-01', isActive: true },
    ]);
  const [workerASchedule, workerBSchedule, workerCSchedule] = schedules;
  if (!workerASchedule || !workerBSchedule || !workerCSchedule) throw new Error('MF07 schedule fixture was not created');

  await dataSource.getRepository(ShiftChangeRequestEntity).save({
    id: randomUUID(), siteId: siteA, workerId: workerAEntityId, workerScheduleId: workerASchedule.id,
    fromShiftId: shiftId, toShiftId: shiftId, expectedScheduleVersionId: versionId,
    status: ShiftRequestStatus.PENDING_MANAGER, requestedByUserId: workerAUser.id,
    reason: 'Need a later shift', reviewedByUserId: null, reviewedAt: null, appliedAt: null,
  });
  await dataSource.getRepository(ShiftSwapRequestEntity).save({
    id: randomUUID(), siteId: siteA, requesterWorkerId: workerAEntityId,
    requesterWorkerScheduleId: workerASchedule.id, coworkerWorkerId: workerBEntityId,
    coworkerWorkerScheduleId: workerBSchedule.id, requesterShiftId: shiftId, coworkerShiftId: secondShiftId,
    expectedScheduleVersionId: versionId, status: ShiftRequestStatus.PENDING_COWORKER,
    requestedByUserId: workerAUser.id, reason: 'Need to swap today', coworkerConfirmedAt: null,
    reviewedByUserId: null, reviewedAt: null, appliedAt: null,
  });
  await dataSource.getRepository(AbsenceRequestEntity).save({
    id: randomUUID(), siteId: siteA, workerId: workerAEntityId, workerScheduleId: workerASchedule.id,
    shiftId, expectedScheduleVersionId: versionId, replacementWorkerId: null,
    requestedByUserId: workerAUser.id, reason: 'Medical appointment',
    status: AbsenceRequestStatus.PENDING_MANAGER, isUnderstaffed: false,
    reviewedByUserId: null, reviewedAt: null,
  });

  const login = async (username: string) => {
    const res = await authService.login(username, pass, AuthClientType.WEB);
    await authService.changePassword(res.user.id, pass, pass + 'A');
    const res2 = await authService.login(username, pass + 'A', AuthClientType.WEB);
    return res2.accessToken;
  };

  const mgrTokenA = await login(`mgr_a_${suffix}`);
  const mgrTokenB = await login(`mgr_b_${suffix}`);
  const repTokenA = await login(`rep_a_${suffix}`);
  const workerTokenA = await login(`worker_a_${suffix}`);
  const unaffiliatedToken = await login(`unaff_${suffix}`);

  const fetchJson = async (path: string, token: string) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };

  const postJson = async (path: string, token: string, body: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };

  const deleteJson = async (path: string, token: string) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };

  const duplicateChangeRequest = await postJson(
    `/sites/${siteA}/shift-change-requests`,
    workerTokenA,
    {
      workerScheduleId: workerASchedule.id,
      toShiftId: secondShiftId,
      reason: 'Request already pending',
    },
  );
  assert.equal(duplicateChangeRequest.status, 409);

  const duplicateSwapRequest = await postJson(
    `/sites/${siteA}/shift-swap-requests`,
    workerTokenA,
    {
      requesterWorkerScheduleId: workerASchedule.id,
      coworkerWorkerScheduleId: workerBSchedule.id,
      reason: 'Swap already pending',
    },
  );
  assert.equal(duplicateSwapRequest.status, 409);

  // 1. allowed Site Manager access
  const res1 = await fetchJson(`/sites/${siteA}/worker-schedules`, mgrTokenA);
  assert.equal(res1.status, 200);
  assert.equal(res1.json.items.length, 3);

  // 2. denied cross-site access
  const res2 = await fetchJson(`/sites/${siteA}/worker-schedules`, mgrTokenB);
  assert.equal(res2.status, 403);

  // Site Manager can configure schedules only in the assigned Site.
  const managerShift = await postJson(`/sites/${siteA}/shifts`, mgrTokenA, {
    name: `Manager Shift ${suffix}`,
    startsAt: '2026-01-02T08:00:00.000Z',
    endsAt: '2026-01-02T16:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(managerShift.status, 201);
  const managerShiftId = (managerShift.json as { id: string }).id;

  const unusedShift = await postJson(`/sites/${siteA}/shifts`, mgrTokenA, {
    name: `Unused Shift ${suffix}`,
    startsAt: '2026-01-03T08:00:00.000Z',
    endsAt: '2026-01-03T16:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(unusedShift.status, 201);
  const unusedShiftId = (unusedShift.json as { id: string }).id;
  const deletedUnusedShift = await deleteJson(`/sites/${siteA}/shifts/${unusedShiftId}`, mgrTokenA);
  assert.equal(deletedUnusedShift.status, 204);

  const deniedCrossSiteDelete = await deleteJson(`/sites/${siteA}/shifts/${shiftId}`, mgrTokenB);
  assert.equal(deniedCrossSiteDelete.status, 403);

  const crossSiteShift = await postJson(`/sites/${siteA}/shifts`, mgrTokenB, {
    name: `Denied Shift ${suffix}`,
    startsAt: '2026-01-02T08:00:00.000Z',
    endsAt: '2026-01-02T16:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(crossSiteShift.status, 403);

  const workerShift = await postJson(`/sites/${siteA}/shifts`, workerTokenA, {
    name: `Worker Shift ${suffix}`,
    startsAt: '2026-01-02T08:00:00.000Z',
    endsAt: '2026-01-02T16:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(workerShift.status, 403);

  const managerVersion = await postJson(`/sites/${siteA}/schedule-versions`, mgrTokenA, {
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(managerVersion.status, 201);
  const managerVersionId = (managerVersion.json as { id: string }).id;

  const managerSchedule = await postJson(
    `/sites/${siteA}/schedule-versions/${managerVersionId}/worker-schedules`,
    mgrTokenA,
    {
      workerId: workerCEntityId,
      shiftId: managerShiftId,
      workDate: '2026-01-02',
      isActive: true,
    },
  );
  assert.equal(managerSchedule.status, 201);

  // A worker may receive a second, different shift on the same day. The
  // exact same shift remains unique across schedule versions at site scope.
  const secondShiftSameDay = await postJson(
    `/sites/${siteA}/schedule-versions/${managerVersionId}/worker-schedules`,
    mgrTokenA,
    {
      workerId: workerAEntityId,
      shiftId: secondShiftId,
      workDate: '2026-01-01',
      isActive: true,
    },
  );
  assert.equal(secondShiftSameDay.status, 201);

  const duplicateShiftSameDay = await postJson(
    `/sites/${siteA}/schedule-versions/${managerVersionId}/worker-schedules`,
    mgrTokenA,
    {
      workerId: workerAEntityId,
      shiftId,
      workDate: '2026-01-01',
      isActive: true,
    },
  );
  assert.equal(duplicateShiftSameDay.status, 409);

  const protectedShiftDelete = await deleteJson(`/sites/${siteA}/shifts/${managerShiftId}`, mgrTokenA);
  assert.equal(protectedShiftDelete.status, 409);

  const crossSiteVersion = await postJson(`/sites/${siteA}/schedule-versions`, mgrTokenB, {
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(crossSiteVersion.status, 403);

  // 3. Contractor Representative sees only their Contractor’s data
  const res3 = await fetchJson(`/sites/${siteA}/worker-schedules`, repTokenA);
  assert.equal(res3.status, 200);
  assert.equal(res3.json.items.length, 3);
  assert.deepEqual(
    res3.json.items.map((item: { workerId: string }) => item.workerId).sort(),
    [workerAEntityId, workerAEntityId, workerBEntityId].sort(),
  );

  // 4. Worker sees only own schedule
  const res4 = await fetchJson(`/sites/${siteA}/worker-schedules`, workerTokenA);
  assert.equal(res4.status, 200);
  assert.equal(res4.json.items.length, 2);
  assert.deepEqual(
    res4.json.items.map((item: { workerId: string }) => item.workerId),
    [workerAEntityId, workerAEntityId],
  );

  const eligibleShifts = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerASchedule.id}/eligible-shifts`,
    workerTokenA,
  );
  assert.equal(eligibleShifts.status, 200);
  assert.deepEqual(eligibleShifts.json.items.map((item: { id: string }) => item.id), [secondShiftId, managerShiftId]);
  assert.deepEqual(Object.keys(eligibleShifts.json.items[0]).sort(), [
    'endsAt',
    'id',
    'name',
    'startsAt',
    'timezone',
  ]);

  const swapCandidates = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerASchedule.id}/swap-candidates`,
    workerTokenA,
  );
  assert.equal(swapCandidates.status, 200);
  assert.equal(swapCandidates.json.total, 1);
  assert.equal(swapCandidates.json.items[0].candidateWorkerId, workerBEntityId);
  assert.equal(swapCandidates.json.items[0].candidateWorkerDisplayName, 'Worker B');
  assert.equal(swapCandidates.json.items[0].candidateWorkerScheduleId, workerBSchedule.id);
  assert.equal(swapCandidates.json.items[0].workDate, '2026-01-01');
  assert.equal(swapCandidates.json.items[0].currentShift.id, secondShiftId);
  assert.deepEqual(Object.keys(swapCandidates.json.items[0]).sort(), [
    'candidateWorkerDisplayName',
    'candidateWorkerId',
    'candidateWorkerScheduleId',
    'currentShift',
    'workDate',
  ]);
  assert.deepEqual(Object.keys(swapCandidates.json.items[0].currentShift).sort(), [
    'endsAt',
    'id',
    'name',
    'startsAt',
    'timezone',
  ]);

  // A Worker cannot use another Worker's schedule as the source schedule.
  const crossWorkerCandidateRead = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerBSchedule.id}/swap-candidates`,
    workerTokenA,
  );
  assert.equal(crossWorkerCandidateRead.status, 403);

  // A Site Manager in another Site cannot use this Site's schedule options.
  const crossSiteCandidateRead = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerASchedule.id}/eligible-shifts`,
    mgrTokenB,
  );
  assert.equal(crossSiteCandidateRead.status, 403);

  // Inactive source schedules are rejected, while no active candidate returns an empty list.
  await dataSource.getRepository(WorkerScheduleEntity).update(
    { id: workerBSchedule.id },
    { isActive: false },
  );
  const inactiveSourceRead = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerBSchedule.id}/swap-candidates`,
    mgrTokenA,
  );
  assert.equal(inactiveSourceRead.status, 409);
  const emptyCandidates = await fetchJson(
    `/sites/${siteA}/worker-schedules/${workerASchedule.id}/swap-candidates`,
    workerTokenA,
  );
  assert.equal(emptyCandidates.status, 200);
  assert.deepEqual(emptyCandidates.json, { items: [], total: 0 });

  // 5. Worker can only view their own Worker record; coworkers use the scoped coworkers endpoint below.
  const res5 = await fetchJson(`/sites/${siteA}/workers`, workerTokenA);
  assert.equal(res5.status, 200);
  assert.equal(res5.json.items.length, 1);
  assert.deepEqual(res5.json.items.map((item: { id: string }) => item.id), [workerAEntityId]);

  // Worker can see coworkers (own contractor)
  const res6 = await fetchJson(`/sites/${siteA}/workers/coworkers`, workerTokenA);
  assert.equal(res6.status, 200);
  assert.equal(res6.json.items.length, 2);
  assert.deepEqual(res6.json.items.map((item: { id: string }) => item.id).sort(), [workerAEntityId, workerBEntityId].sort());

  // 6. unaffiliated user receives FORBIDDEN
  const res7 = await fetchJson(`/sites/${siteA}/worker-schedules`, unaffiliatedToken);
  assert.equal(res7.status, 403);

  for (const path of ['shift-change-requests', 'shift-swap-requests', 'absence-requests']) {
    const managerRequests = await fetchJson(`/sites/${siteA}/${path}`, mgrTokenA);
    assert.equal(managerRequests.status, 200);
    assert.equal(managerRequests.json.items.length, 1);

    const workerRequests = await fetchJson(`/sites/${siteA}/${path}`, workerTokenA);
    assert.equal(workerRequests.status, 200);
    assert.equal(workerRequests.json.items.length, 1);

    const representativeRequests = await fetchJson(`/sites/${siteA}/${path}`, repTokenA);
    assert.equal(representativeRequests.status, 200);
    assert.equal(representativeRequests.json.items.length, 1);

    const deniedRequests = await fetchJson(`/sites/${siteA}/${path}`, unaffiliatedToken);
    assert.equal(deniedRequests.status, 403);
  }

  await app.close();
  if (dataSource.isInitialized) await dataSource.destroy();
});
