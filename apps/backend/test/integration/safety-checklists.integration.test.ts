import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { SafetyWorkContextService } from '../../src/modules/workforce/management/safety-work-context.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { SafetyOverviewService } from '../../src/modules/safety/safety-overview.service.js';
import { SafetyAlertQueryService } from '../../src/modules/safety/alerts/safety-alert-query.service.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { SafetyChecklistService } from '../../src/modules/safety/safety-checklist.service.js';
import { SafetyWorkflowService } from '../../src/modules/safety/safety-workflow.service.js';
import { SafetyUploadService } from '../../src/modules/safety/safety-upload.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { SafetyChecklists1792195200000 } from '../../src/database/migrations/1792195200000-SafetyChecklists.js';
import {
  SafetyAlertEntity,
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  AlertStatus,
  AlertType,
  EventProcessingStatus,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  SiteEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeGrantEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  WorkerEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  ContractorZonePermissionEntity,
  TeamZonePermissionEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
  SafetyWorkflowAuditEntity,
} from '../../src/database/entities/index.js';
const failure = (code: string) => (e: unknown) =>
  e instanceof PublicHttpException && e.publicPayload.code === code;
const isolated = createIsolatedTestDatabase({ canonical: true });
const source = isolated.dataSource;
const id = {
  site: randomUUID(),
  other: randomUUID(),
  contractor: randomUUID(),
  otherContractor: randomUUID(),
  team: randomUUID(),
  oldTeam: randomUUID(),
  zone: randomUUID(),
  foreignZone: randomUUID(),
  worker: randomUUID(),
  safety: randomUUID(),
  reviewer: randomUUID(),
  rep: randomUUID(),
  outsider: randomUUID(),
  foreignSafety: randomUUID(),
  manager: randomUUID(),
  admin: randomUUID(),
  none: randomUUID(),
};
let root: string,
  checklists: SafetyChecklistService,
  notifications: SchedulingNotificationService,
  overview: SafetyWorkContextService,
  workflow: SafetyWorkflowService,
  users: UsersService;
const date = '2026-10-12',
  startsAt = '2026-10-13T01:00:00Z',
  endsAt = '2026-10-13T03:00:00Z';
const pdf = Buffer.from('%PDF-1.4\nSynthetic checklist document\n%%EOF\n');
const file = { buffer: pdf, size: pdf.length, mimetype: 'application/pdf' };
before(async () => {
  await isolated.initialize();
  root = await mkdtemp(join(tmpdir(), 'smartsite-checklist-test-'));
  const sites = new SiteConfigurationService(source),
    workforce = new WorkforceConfigurationService(source),
    zones = new ZoneConfigurationService(source, sites);
  users = new UsersService(source, sites);
  notifications = new SchedulingNotificationService(source);
  const upload = new SafetyUploadService(
    new StorageService(
      new ConfigService(validateEnvironment({ NODE_ENV: 'test', STORAGE_LOCAL_ROOT: root })),
    ),
  );
  workflow = new SafetyWorkflowService(source, users, zones, upload, workforce, notifications);
  checklists = new SafetyChecklistService(
    source,
    users,
    workforce,
    upload,
    notifications,
    workflow,
  );
  overview = new SafetyWorkContextService(source);
  await source.getRepository(SiteEntity).save([
    { id: id.site, code: id.site, name: 'Checklist synthetic A' },
    { id: id.other, code: id.other, name: 'Checklist synthetic B' },
  ]);
  for (const [name, role, siteId] of [
    ['safety', UserRole.SAFETY_OFFICER, id.site],
    ['reviewer', UserRole.SAFETY_OFFICER, id.site],
    ['rep', UserRole.CONTRACTOR_REPRESENTATIVE, id.site],
    ['outsider', UserRole.CONTRACTOR_REPRESENTATIVE, id.site],
    ['foreignSafety', UserRole.SAFETY_OFFICER, id.other],
    ['manager', UserRole.SITE_MANAGER, id.site],
    ['admin', UserRole.ADMIN, null],
    ['none', null, id.site],
  ] as const) {
    await source.getRepository(UserEntity).save({
      id: id[name],
      username: id[name],
      displayName: name,
      passwordHash: 'unused-synthetic',
      isActive: true,
      mustChangePassword: false,
    });
    if (role)
      await source
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id[name], siteId, role });
  }
  await source.getRepository(ContractorEntity).save([
    { id: id.contractor, code: id.contractor, name: 'Synthetic contractor', isActive: true },
    { id: id.otherContractor, code: id.otherContractor, name: 'Other contractor', isActive: true },
  ]);
  const participations = await source.getRepository(ContractorSiteParticipationEntity).save([
    {
      id: randomUUID(),
      contractorId: id.contractor,
      siteId: id.site,
      validFrom: new Date('2026-01-01'),
      validUntil: null,
      isActive: true,
    },
    {
      id: randomUUID(),
      contractorId: id.otherContractor,
      siteId: id.site,
      validFrom: new Date('2026-01-01'),
      validUntil: null,
      isActive: true,
    },
  ]);
  await source.getRepository(ContractorRepresentativeGrantEntity).save([
    { id: randomUUID(), contractorId: id.contractor, userId: id.rep },
    { id: randomUUID(), contractorId: id.otherContractor, userId: id.outsider },
  ]);
  await source.getRepository(ContractorRepresentativeAssignmentEntity).save([
    { id: randomUUID(), siteId: id.site, contractorId: id.contractor, userId: id.rep },
    { id: randomUUID(), siteId: id.site, contractorId: id.otherContractor, userId: id.outsider },
  ]);
  await source.getRepository(ContractorTeamEntity).save(
    [id.oldTeam, id.team].map((team, index) => ({
      id: team,
      siteId: id.site,
      contractorId: id.contractor,
      name: 'Synthetic team ' + index,
      normalizedName: 'synthetic team ' + index,
      description: 'Synthetic work',
      isActive: true,
      version: 1,
      createdBy: id.safety,
      createdAt: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-01'),
    })),
  );
  await source.getRepository(WorkerEntity).save({
    id: id.worker,
    siteId: id.site,
    contractorId: id.contractor,
    externalId: id.worker,
    displayName: 'Synthetic Worker',
    isActive: true,
    createdAt: new Date('2026-10-01'),
  });
  await source.getRepository(ContractorTeamMembershipEntity).save([
    {
      id: randomUUID(),
      teamId: id.oldTeam,
      siteId: id.site,
      contractorId: id.contractor,
      workerId: id.worker,
      joinedAt: new Date('2026-10-01'),
      leftAt: new Date('2026-10-13'),
      assignedBy: id.rep,
      endedBy: id.rep,
      reason: 'Original team',
      endReason: 'Transfer',
    },
    {
      id: randomUUID(),
      teamId: id.team,
      siteId: id.site,
      contractorId: id.contractor,
      workerId: id.worker,
      joinedAt: new Date('2026-10-13'),
      leftAt: null,
      assignedBy: id.rep,
      endedBy: null,
      reason: 'New team',
      endReason: null,
    },
  ]);
  await source.getRepository(ZoneEntity).save([
    {
      id: id.zone,
      siteId: id.site,
      code: id.zone,
      name: 'Synthetic Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
      authorizationVersion: 1,
      policyLockedAt: null,
    },
    {
      id: id.foreignZone,
      siteId: id.other,
      code: id.foreignZone,
      name: 'Foreign Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
      authorizationVersion: 1,
      policyLockedAt: null,
    },
  ]);
  const grant = await source.getRepository(ContractorZonePermissionEntity).save({
    id: randomUUID(),
    siteContractorId: participations[0]!.id,
    zoneId: id.zone,
    validFrom: new Date('2026-01-01'),
    validUntil: new Date('2027-01-01'),
    grantedBy: id.manager,
    revokedAt: null,
  });
  await source.getRepository(TeamZonePermissionEntity).save(
    [id.oldTeam, id.team].map((team) => ({
      id: randomUUID(),
      teamId: team,
      contractorZonePermissionId: grant.id,
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-01-01'),
      grantedBy: id.rep,
      revokedAt: null,
    })),
  );
  const shift = await source.getRepository(ShiftEntity).save({
    id: randomUUID(),
    siteId: id.site,
    name: 'Day shift',
    timezone: 'Asia/Ho_Chi_Minh',
    startsAt: new Date('2026-01-01T01:00:00Z'),
    endsAt: new Date('2026-01-01T10:00:00Z'),
    archivedAt: null,
    breakStartsAt: null,
    breakEndsAt: null,
  });
  const version = await source.getRepository(ScheduleVersionEntity).save({
    id: randomUUID(),
    siteId: id.site,
    version: 1,
    effectiveFrom: new Date('2026-01-01'),
    effectiveUntil: null,
    createdAt: new Date('2026-10-01'),
  });
  await source.getRepository(WorkerScheduleEntity).save({
    id: randomUUID(),
    siteId: id.site,
    workerId: id.worker,
    shiftId: shift.id,
    scheduleVersionId: version.id,
    workDate: date,
    isActive: true,
  });
});
after(async () => {
  await isolated.dispose();
  if (root) {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
});
const actor = (userId: string) => source.transaction((m) => users.safetyActor(m, userId));
const create = () => ({
  commandId: randomUUID(),
  teamId: id.team,
  zoneId: id.zone,
  assignedTo: id.rep,
  description: 'Synthetic electrical inspection',
  startsAt,
  endsAt,
  items: [{ text: 'Inspection document available', evidenceRequired: true }],
});
test('Safety overview resolves a past scheduled team, persists role checks and keeps date/Zone validation', async () => {
  const a = await actor(id.safety);
  const value = await overview.overview(a, id.site, { date, timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(value.teams.items.find((t) => t.id === id.oldTeam)!.scheduledWorkerCount, 1);
  assert.equal(value.teams.items.find((t) => t.id === id.team)!.scheduledWorkerCount, 0);
  const detail = await overview.team(a, id.site, id.oldTeam, {
    date,
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.equal(detail.workers.items[0]!.id, id.worker);
  assert.equal(detail.zones[0]!.id, id.zone);
  await assert.rejects(
    overview.overview(await actor(id.foreignSafety), id.site, {
      date,
      timezone: 'Asia/Ho_Chi_Minh',
    }),
    failure('FORBIDDEN'),
  );
  await assert.rejects(
    overview.overview(a, id.site, { date: '2026-02-30', timezone: 'Asia/Ho_Chi_Minh' }),
    failure('VALIDATION_FAILED'),
  );
  await source.getRepository(UserEntity).update(id.safety, { isActive: false });
  await assert.rejects(
    overview.overview(a, id.site, { date, timezone: 'Asia/Ho_Chi_Minh' }),
    failure('FORBIDDEN'),
  );
  await source.getRepository(UserEntity).update(id.safety, { isActive: true });
});

test('alert work-context enforces Site access and excludes inactive or out-of-interval grants over HTTP', async () => {
  const at = new Date('2026-10-13T02:00:00Z');
  const alertId = randomUUID();
  await source.getRepository(SafetyAlertEntity).save({
    id: alertId,
    siteId: id.site,
    zoneId: id.zone,
    candidateWorkerId: id.worker,
    alertType: AlertType.PPE_VIOLATION,
    candidateSubtype: 'MISSING_HARD_HAT',
    groupingKey: alertId,
    status: AlertStatus.PENDING_REVIEW,
    firstDetectedAt: at,
    lastDetectedAt: at,
  });
  const permission = await source.getRepository(TeamZonePermissionEntity).findOneByOrFail({
    teamId: id.team,
  });
  const contractorPermission = await source
    .getRepository(ContractorZonePermissionEntity)
    .findOneByOrFail({ id: permission.contractorZonePermissionId });
  const participation = await source
    .getRepository(ContractorSiteParticipationEntity)
    .findOneByOrFail({ id: contractorPermission.siteContractorId });
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({ NODE_ENV: 'test', LOG_FORMAT: 'json' }),
  );
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(source)
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(AuthService)
    .useValue({
      authenticate: async (token: string) => ({
        user: await actor(
          token === 'synthetic.foreign.token'
            ? id.foreignSafety
            : token === 'synthetic.representative.token'
              ? id.rep
              : token === 'synthetic.noScope.token'
                ? id.none
                : id.safety,
        ),
        sessionId: randomUUID(),
        clientType: 'MOBILE',
      }),
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const path = `${baseUrl}/api/v1/sites/${id.site}/safety-alerts/${alertId}/work-context`;
  const read = (url = path, token = 'synthetic.safety.token') =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await fetch(path)).status, 401);
    for (const token of [
      'synthetic.foreign.token',
      'synthetic.representative.token',
      'synthetic.noScope.token',
    ])
      assert.equal((await read(path, token)).status, 403);
    assert.equal((await read(path.replace(id.site, id.other))).status, 403);
    assert.equal((await read(path.replace(alertId, randomUUID()))).status, 404);
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const context = await response.json();
    assert.equal(context.capturedAt, '2026-10-13T02:00:00.000Z');
    assert.equal(context.identity, 'UNKNOWN', 'a candidate Worker is not verified identity');
    assert.deepEqual(context.workers, []);
    assert.equal(context.zoneName, 'Synthetic Zone');
    assert.equal(context.cameraName, null);
    assert.deepEqual(
      new Set(context.relatedTeams.map((t: { id: string }) => t.id)),
      new Set([id.team, id.oldTeam]),
    );

    await source.getRepository(TeamZonePermissionEntity).update(permission.id, { validUntil: at });
    const expired = await (await read()).json();
    assert.deepEqual(
      expired.relatedTeams.map((t: { id: string }) => t.id),
      [id.oldTeam],
    );
    await source.getRepository(TeamZonePermissionEntity).save(permission);

    await source.getRepository(ContractorZonePermissionEntity).update(contractorPermission.id, {
      revokedAt: new Date('2026-10-13T03:00:00Z'),
    });
    const historical = await (await read()).json();
    assert.deepEqual(
      new Set(historical.relatedTeams.map((t: { id: string }) => t.id)),
      new Set([id.team, id.oldTeam]),
      'later revocation does not erase context that was valid at capture time',
    );
    await source.getRepository(ContractorZonePermissionEntity).update(contractorPermission.id, {
      revokedAt: at,
    });
    assert.deepEqual((await (await read()).json()).relatedTeams, []);
    await source.getRepository(ContractorZonePermissionEntity).save(contractorPermission);

    await source.getRepository(ContractorSiteParticipationEntity).update(participation.id, {
      validUntil: at,
    });
    assert.deepEqual((await (await read()).json()).relatedTeams, []);
    await source.getRepository(ContractorSiteParticipationEntity).save(participation);

    await source.getRepository(ContractorSiteParticipationEntity).update(participation.id, {
      isActive: false,
    });
    assert.deepEqual((await (await read()).json()).relatedTeams, []);
  } finally {
    await source.getRepository(TeamZonePermissionEntity).save(permission);
    await source.getRepository(ContractorZonePermissionEntity).save(contractorPermission);
    await source.getRepository(ContractorSiteParticipationEntity).save(participation);
    await source.getRepository(SafetyAlertEntity).delete(alertId);
    await app.close();
    if (!source.isInitialized) await source.initialize();
  }
});

test('weekly context normalizes Monday and paginates teams without losing scheduled work windows', async () => {
  const read = Reflect.get(overview, 'week');
  assert.equal(typeof read, 'function', 'weekly query is exported');
  const value = (await Reflect.apply(read, overview, [
    await actor(id.safety),
    id.site,
    { date, timezone: 'Asia/Ho_Chi_Minh', teamId: id.oldTeam, limit: 1 },
  ])) as import('@smartsite/contracts').SafetyWeekResponse;
  assert.equal(value.weekStart, '2026-10-12');
  assert.equal(value.weekEnd, '2026-10-18');
  assert.equal(value.teams.total, 1);
  assert.equal(value.teams.items[0]!.days.length, 7);
  const day = value.teams.items[0]!.days.find((d: { date: string }) => d.date === date);
  assert.equal(day!.scheduledWorkerCount, 1);
  assert.equal(day!.workWindows.length, 1);
  await assert.rejects(
    Reflect.apply(read, overview, [
      await actor(id.foreignSafety),
      id.site,
      { date, timezone: 'Asia/Ho_Chi_Minh' },
    ]),
    failure('FORBIDDEN'),
  );
  const pastPage = (await Reflect.apply(read, overview, [
    await actor(id.manager),
    id.site,
    { date, timezone: 'Asia/Ho_Chi_Minh', teamId: id.oldTeam, offset: 20 },
  ])) as import('@smartsite/contracts').SafetyWeekResponse;
  assert.equal(pastPage.teams.total, 1);
  assert.equal(pastPage.teams.items.length, 0);
  const daily = await overview.overview(await actor(id.safety), id.site, {
    date,
    timezone: 'Asia/Ho_Chi_Minh',
    teamId: id.oldTeam,
  });
  assert.equal(daily.teams.items[0]!.workWindows!.length, 1);
  const night = await source.getRepository(ShiftEntity).save({
    id: randomUUID(),
    siteId: id.site,
    name: 'Overnight',
    timezone: 'Asia/Ho_Chi_Minh',
    startsAt: new Date('2026-01-01T15:00:00Z'),
    endsAt: new Date('2026-01-01T23:00:00Z'),
    archivedAt: null,
    breakStartsAt: null,
    breakEndsAt: null,
  });
  const version = await source
    .getRepository(ScheduleVersionEntity)
    .findOneByOrFail({ siteId: id.site, version: 1 });
  const schedule = await source.getRepository(WorkerScheduleEntity).save({
    id: randomUUID(),
    siteId: id.site,
    workerId: id.worker,
    shiftId: night.id,
    scheduleVersionId: version.id,
    workDate: '2026-10-15',
    isActive: true,
  });
  try {
    const overnight = await overview.week(await actor(id.safety), id.site, {
      date,
      timezone: 'Asia/Ho_Chi_Minh',
      teamId: id.team,
    });
    const window = overnight.teams.items[0]!.days.find((d) => d.date === '2026-10-15')!
      .workWindows[0]!;
    assert.equal(new Date(window.startsAt).toISOString(), '2026-10-15T15:00:00.000Z');
    assert.equal(new Date(window.endsAt).toISOString(), '2026-10-15T23:00:00.000Z');
    assert.equal(
      overnight.teams.items[0]!.days.find((d) => d.date === '2026-10-16')!.scheduledWorkerCount,
      0,
      'overnight retains its source work date',
    );
  } finally {
    await source.getRepository(WorkerScheduleEntity).delete(schedule.id);
    await source.getRepository(ShiftEntity).delete(night.id);
  }
});

test('checklist report/return/resubmit/record preserves evidence and deduplicates commands and notifications', async () => {
  const input = create(),
    created = await checklists.create(id.site, id.safety, input),
    assignmentId = created.resource.id;
  assert.equal((await checklists.create(id.site, id.safety, input)).replayed, true);
  const repActor = await actor(id.rep),
    inbox = await notifications.list(repActor, undefined, 0, 100);
  assert.equal(
    inbox.items.filter((n) => 'checklistId' in n.target && n.target.checklistId === assignmentId)
      .length,
    1,
  );
  const notification = inbox.items.find(
    (n) => 'checklistId' in n.target && n.target.checklistId === assignmentId,
  )!;
  assert.equal(notification.target.tab, 'checklists');
  await notifications.read(repActor, notification.id);
  await notifications.delete(repActor, notification.id);
  assert.equal((await checklists.get(id.site, assignmentId, id.safety)).id, assignmentId);
  await assert.rejects(checklists.get(id.site, assignmentId, id.outsider), failure('FORBIDDEN'));
  await assert.rejects(checklists.get(id.other, assignmentId, id.rep), failure('NOT_FOUND'));
  await assert.rejects(checklists.create(id.site, id.admin, create()), failure('FORBIDDEN'));
  await assert.rejects(checklists.create(id.site, id.none, create()), failure('FORBIDDEN'));
  await source.getRepository(UserEntity).update(id.rep, { isActive: false });
  await assert.rejects(
    checklists.mutate(id.site, assignmentId, id.rep, 'start', {
      commandId: randomUUID(),
      expectedVersion: 1,
    }),
    failure('FORBIDDEN'),
  );
  await source.getRepository(UserEntity).update(id.rep, { isActive: true });
  const started = await checklists.mutate(id.site, assignmentId, id.rep, 'start', {
    commandId: randomUUID(),
    expectedVersion: 1,
  });
  const submit = {
    commandId: randomUUID(),
    expectedVersion: started.resource.version,
    results: [
      {
        itemId: created.resource.items[0]!.id,
        answer: 'FAIL',
        note: 'Inspection document requires follow-up',
        fileIndexes: [0],
      },
    ],
  };
  const submitted = await checklists.mutate(id.site, assignmentId, id.rep, 'submit', submit, [
    file,
  ]);
  assert.equal(
    (await checklists.mutate(id.site, assignmentId, id.rep, 'submit', submit, [file])).replayed,
    true,
  );
  await assert.rejects(
    checklists.mutate(
      id.site,
      assignmentId,
      id.rep,
      'submit',
      { ...submit, results: [{ ...submit.results[0]!, note: 'Changed input' }] },
      [file],
    ),
    failure('CONFLICT'),
  );
  const evidence = submitted.resource.submissions[0]!.results[0]!.evidence[0]!;
  assert.equal(evidence.mediaType, 'application/pdf');
  assert.deepEqual(
    (await checklists.evidence(id.site, assignmentId, evidence.id, id.rep)).bytes,
    pdf,
  );
  await assert.rejects(
    checklists.evidence(id.site, assignmentId, evidence.id, id.outsider),
    failure('FORBIDDEN'),
  );
  await assert.rejects(
    checklists.mutate(id.site, assignmentId, id.safety, 'cancel', {
      commandId: randomUUID(),
      expectedVersion: submitted.resource.version,
      reason: 'Cannot cancel pending',
    }),
    failure('CONFLICT'),
  );
  await source
    .getRepository(UserRoleAssignmentEntity)
    .save({ id: randomUUID(), userId: id.rep, siteId: id.site, role: UserRole.SAFETY_OFFICER });
  const pending = submitted.resource.submissions[0]!;
  await assert.rejects(
    checklists.mutate(id.site, assignmentId, id.rep, 'review', {
      commandId: randomUUID(),
      expectedVersion: submitted.resource.version,
      submissionId: pending.id,
      decision: 'ACCEPTED',
      reason: 'Self-review',
    }),
    failure('FORBIDDEN'),
  );
  const returned = await checklists.mutate(id.site, assignmentId, id.reviewer, 'review', {
    commandId: randomUUID(),
    expectedVersion: submitted.resource.version,
    submissionId: pending.id,
    decision: 'RETURNED',
    reason: 'Provide an updated document',
  });
  const second = await checklists.mutate(id.site, assignmentId, id.rep, 'submit', {
    commandId: randomUUID(),
    expectedVersion: returned.resource.version,
    results: [
      {
        itemId: created.resource.items[0]!.id,
        answer: 'FAIL',
        note: 'Contractor reported the remaining issue',
        fileIndexes: [],
      },
    ],
  });
  const recorded = await checklists.mutate(id.site, assignmentId, id.safety, 'review', {
    commandId: randomUUID(),
    expectedVersion: second.resource.version,
    submissionId: second.resource.submissions[1]!.id,
    decision: 'ACCEPTED',
    reason: 'Finding confirmed; follow-up required',
  });
  assert.equal(recorded.resource.status, 'ACCEPTED');
  assert.equal(recorded.resource.submissions.length, 2);
  assert.equal(recorded.resource.submissions[0]!.status, 'RETURNED');
  assert.equal(recorded.resource.submissions[1]!.results[0]!.answer, 'FAIL');
  const resultId = recorded.resource.submissions[1]!.results[0]!.id;
  const incidentInput = {
    commandId: randomUUID(),
    sourceChecklistResultId: resultId,
    title: 'Synthetic finding',
    description: 'Confirmed checklist finding',
    severity: 'MEDIUM',
    occurredAt: startsAt,
    zoneId: id.zone,
    alertIds: [],
  };
  const incident = await workflow.createIncident(id.site, id.safety, incidentInput);
  assert.equal(incident.resource.contractorId, null);
  assert.equal(incident.resource.sourceChecklistResultId, resultId);
  await assert.rejects(
    workflow.incidentCommand(id.site, incident.resource.id, id.safety, 'responsibility', {
      commandId: randomUUID(),
      expectedVersion: 1,
      contractorId: id.otherContractor,
      workerIds: [],
      reason: 'Wrong source contractor',
    }),
    failure('CONFLICT'),
  );

  await assert.rejects(
    workflow.createIncident(id.site, id.safety, { ...incidentInput, commandId: randomUUID() }),
    failure('CONFLICT'),
  );
  await assert.rejects(
    workflow.incidentCommand(id.site, incident.resource.id, id.safety, 'close', {
      commandId: randomUUID(),
      expectedVersion: 1,
      reason: 'No handling action yet',
    }),
    failure('CONFLICT'),
  );
  const safetyView = await checklists.get(id.site, assignmentId, id.safety);
  assert.equal(safetyView.firstSubmittedAt, safetyView.submissions[0]!.submittedAt);
  assert.equal(safetyView.submissions[1]!.results[0]!.linkedIncident!.status, 'OPEN');
  assert.equal(safetyView.submissions[1]!.results[0]!.answer, 'FAIL');
  const rolesForCheck = source.getRepository(UserRoleAssignmentEntity),
    extraRole = await rolesForCheck.findOneByOrFail({
      userId: id.rep,
      siteId: id.site,
      role: UserRole.SAFETY_OFFICER,
    });
  await rolesForCheck.delete(extraRole.id);
  try {
    const privateView = await checklists.get(id.site, assignmentId, id.rep);
    assert.equal(privateView.submissions[1]!.results[0]!.linkedIncident, null);
  } finally {
    await rolesForCheck.save(extraRole);
  }
  const managerView = await checklists.get(id.site, assignmentId, id.manager);
  assert.equal(managerView.submissions[0]!.submittedByName, 'rep');
  const runner = source.createQueryRunner();
  try {
    await assert.rejects(new SafetyChecklists1792195200000().down(runner), /Preserve\/export/);
  } finally {
    await runner.release();
  }
  const objects = (await readdir(root, { recursive: true, withFileTypes: true })).filter((f) =>
    f.isFile(),
  );
  assert.equal(objects.length, 1);
});
test('concurrent checklist submissions commit one pending report; stale versions, illegal scope and mutable history are blocked', async () => {
  const created = await checklists.create(id.site, id.safety, create()),
    idValue = created.resource.id;
  const started = await checklists.mutate(id.site, idValue, id.rep, 'start', {
    commandId: randomUUID(),
    expectedVersion: 1,
  });
  const submit = () => ({
    commandId: randomUUID(),
    expectedVersion: started.resource.version,
    results: [
      {
        itemId: created.resource.items[0]!.id,
        answer: 'FAIL',
        note: 'Missing document',
        fileIndexes: [0],
      },
    ],
  });
  const beforeFiles = (await readdir(root, { recursive: true, withFileTypes: true })).filter((f) =>
    f.isFile(),
  ).length;
  const attempts = await Promise.allSettled([
    checklists.mutate(id.site, idValue, id.rep, 'submit', submit(), [file]),
    checklists.mutate(id.site, idValue, id.rep, 'submit', submit(), [file]),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS count FROM safety_checklist_submission WHERE assignment_id=$1 AND status='PENDING'",
        [idValue],
      )
    )[0].count,
    1,
  );
  assert.equal(
    (await readdir(root, { recursive: true, withFileTypes: true })).filter((f) => f.isFile())
      .length,
    beforeFiles + 1,
  );
  await assert.rejects(
    source.query("UPDATE safety_checklist_item SET text='Changed' WHERE assignment_id=$1", [
      idValue,
    ]),
  );
  const latest = await checklists.get(id.site, idValue, id.safety);
  await assert.rejects(
    source.query('DELETE FROM safety_checklist_item_result WHERE submission_id=$1', [
      latest.submissions[0]!.id,
    ]),
  );
  await assert.rejects(
    checklists.create(id.site, id.safety, { ...create(), zoneId: id.foreignZone }),
    failure('CONFLICT'),
  );
  await assert.rejects(
    checklists.create(id.site, id.safety, { ...create(), actorId: id.rep }),
    failure('VALIDATION_FAILED'),
  );
  const audits = await source
    .getRepository(SafetyWorkflowAuditEntity)
    .findBy({ resourceType: 'CHECKLIST', resourceId: idValue });
  assert.equal(audits.filter((a) => a.action === 'submit').length, 1);
});

test('blank checklist description fails with stable validation error', async () => {
  await assert.rejects(
    checklists.create(id.site, id.safety, { ...create(), description: '   ' }),
    failure('VALIDATION_FAILED'),
  );
});

test('revoking a Site contractor assignment removes checklist access and assignee lookup despite a legacy grant', async () => {
  const roles = source.getRepository(UserRoleAssignmentEntity);
  const extra = await roles.findBy({
    userId: id.rep,
    siteId: id.site,
    role: UserRole.SAFETY_OFFICER,
  });
  if (extra.length) await roles.delete(extra.map((r) => r.id));
  const assignment = await checklists.create(id.site, id.safety, create());
  const repo = source.getRepository(ContractorRepresentativeAssignmentEntity);
  const scope = await repo.findOneByOrFail({
    siteId: id.site,
    contractorId: id.contractor,
    userId: id.rep,
  });
  await repo.delete(scope.id);
  try {
    await assert.rejects(
      checklists.get(id.site, assignment.resource.id, id.rep),
      failure('FORBIDDEN'),
    );
    const inbox = await notifications.list(await actor(id.rep));
    assert.ok(
      !inbox.items.some(
        (n) => 'checklistId' in n.target && n.target.checklistId === assignment.resource.id,
      ),
    );
    const list = await workflow.assignees(
      id.site,
      id.safety,
      UserRole.CONTRACTOR_REPRESENTATIVE,
      0,
      20,
      id.contractor,
    );
    assert.ok(!list.items.some((u) => u.id === id.rep));
  } finally {
    await repo.save(scope);
    await roles.save(extra);
  }
});

test('unassigned Worker pagination is independent of the team page', async () => {
  const workerIds = Array.from({ length: 21 }, () => randomUUID());
  try {
    await source.getRepository(WorkerEntity).save(
      workerIds.map((workerId) => ({
        id: workerId,
        siteId: id.site,
        contractorId: id.contractor,
        externalId: workerId,
        displayName: 'Unassigned ' + workerId,
        isActive: true,
        createdAt: new Date('2026-10-01'),
      })),
    );
    const input = {
      date,
      timezone: 'Asia/Ho_Chi_Minh',
      offset: 0,
      limit: 20,
      unassignedOffset: 20,
      unassignedLimit: 20,
    };
    const result = await overview.overview(await actor(id.safety), id.site, input);
    assert.equal(result.teams.items.length, 2);
    assert.equal(result.unassignedWorkers.total, 21);
    assert.equal(result.unassignedWorkers.items.length, 1);
  } finally {
    await source.getRepository(WorkerEntity).delete(workerIds);
  }
});

test('Manager lookup and Overview summaries match drill-down for two contractors sharing a Zone', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T01:00:00Z') });
  const teamId = randomUUID();
  await source.getRepository(ContractorTeamEntity).save({
    id: teamId,
    siteId: id.site,
    contractorId: id.otherContractor,
    name: 'Other contractor team',
    normalizedName: teamId,
    description: 'Synthetic',
    createdBy: id.outsider,
    createdAt: new Date('2026-10-01'),
  });
  const participation = await source
    .getRepository(ContractorSiteParticipationEntity)
    .findOneByOrFail({ siteId: id.site, contractorId: id.otherContractor });
  const permission = await source.getRepository(ContractorZonePermissionEntity).save({
    id: randomUUID(),
    siteContractorId: participation.id,
    zoneId: id.zone,
    validFrom: new Date('2026-01-01'),
    validUntil: new Date('2027-01-01'),
    grantedBy: id.manager,
    revokedAt: null,
  });
  await source.getRepository(TeamZonePermissionEntity).save({
    id: randomUUID(),
    teamId,
    contractorZonePermissionId: permission.id,
    validFrom: new Date('2026-01-01'),
    validUntil: new Date('2027-01-01'),
    grantedBy: id.outsider,
    revokedAt: null,
  });
  const sites = new SiteConfigurationService(source),
    zones = new ZoneConfigurationService(source, sites),
    cameras = new CameraConfigurationService(source, zones, sites);
  const camera = await source.getRepository(CameraEntity).save({
    id: randomUUID(),
    siteId: id.site,
    externalId: id.site + '-overview',
    code: randomUUID(),
    name: 'Synthetic camera',
    status: CameraStatus.ACTIVE,
    configurationVersion: 1,
  });
  await source.getRepository(CameraObservationRegionEntity).save({
    id: randomUUID(),
    cameraId: camera.id,
    zoneId: id.zone,
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    coordinateSpace: 'NORMALIZED_0_1',
    version: 1,
    isActive: true,
  });
  const service = new SafetyOverviewService(overview, cameras, source, workflow);
  const related = await service.zoneTeams(await actor(id.manager), id.site, id.zone, {
    date: '2026-10-13',
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.ok(related.items.some((t: { id: string }) => t.id === teamId));
  assert.ok(related.items.some((t: { id: string }) => t.id === id.team));
  await assert.rejects(
    service.zoneTeams(await actor(id.foreignSafety), id.site, id.zone, {
      date,
      timezone: 'Asia/Ho_Chi_Minh',
    }),
    failure('FORBIDDEN'),
  );
  const lookup = await service.contractors(await actor(id.manager), id.site, {
    date: '2026-10-13',
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.ok(lookup.items.some((c) => c.id === id.otherContractor));
  await assert.rejects(
    service.contractors(await actor(id.outsider), id.site, { date, timezone: 'Asia/Ho_Chi_Minh' }),
    failure('FORBIDDEN'),
  );
  for (let i = 0; i < 5; i++) {
    let a = (
      await checklists.create(id.site, id.safety, {
        ...create(),
        commandId: randomUUID(),
        teamId,
        assignedTo: id.outsider,
        items: [{ text: 'Synthetic equipment check', evidenceRequired: false }],
      })
    ).resource;
    if (i > 0)
      a = (
        await checklists.mutate(id.site, a.id, id.outsider, 'start', {
          commandId: randomUUID(),
          expectedVersion: a.version,
        })
      ).resource;
    if (i > 0)
      a = (
        await checklists.mutate(id.site, a.id, id.outsider, 'submit', {
          commandId: randomUUID(),
          expectedVersion: a.version,
          results: [
            {
              itemId: a.items[0]!.id,
              answer: i === 4 ? 'FAIL' : 'PASS',
              note: i === 4 ? 'Synthetic missing equipment' : '',
              fileIndexes: [],
            },
          ],
        })
      ).resource;
    if (i >= 2)
      await checklists.mutate(id.site, a.id, id.safety, 'review', {
        commandId: randomUUID(),
        expectedVersion: a.version,
        submissionId: a.submissions[0]!.id,
        decision: i === 2 ? 'RETURNED' : 'ACCEPTED',
        reason: 'Synthetic review',
      });
  }
  const alertId = randomUUID(),
    at = new Date('2026-10-13T02:00:00Z');
  await source.getRepository(SafetyAlertEntity).save({
    id: alertId,
    siteId: id.site,
    zoneId: id.zone,
    alertType: AlertType.PPE_VIOLATION,
    candidateSubtype: 'MISSING_HARD_HAT',
    groupingKey: alertId,
    status: AlertStatus.PENDING_REVIEW,
    firstDetectedAt: at,
    lastDetectedAt: at,
  });
  for (let i = 0; i < 2; i++) {
    const eventId = randomUUID();
    await source.getRepository(AiObservationEventEntity).save({
      eventId,
      payloadHash: 'a'.repeat(64),
      cameraExternalId: id.site + '-overview',
      streamSessionId: randomUUID(),
      capturedAt: at,
      rawPayload: { synthetic: true },
      processingStatus: EventProcessingStatus.PROCESSED,
    });
    await source.getRepository(AlertDetectionMappingEntity).save({ alertId, eventId });
  }
  const q = { date: '2026-10-13', timezone: 'Asia/Ho_Chi_Minh' };
  const safetyCamera = (await service.team(await actor(id.safety), id.site, id.team, q))
    .cameras[0]!;
  assert.equal(safetyCamera.latestEvidence!.alertId, alertId);
  assert.equal(safetyCamera.latestEvidence!.capturedAt, at.toISOString());
  assert.equal(
    safetyCamera.latestEvidence!.evidenceIndex,
    null,
    'missing evidence must not use a sample image',
  );
  assert.equal(
    (await service.team(await actor(id.safety), id.site, id.team, { ...q, date: '2026-10-14' }))
      .cameras[0]!.latestEvidence,
    null,
    'camera preview cannot leak another day',
  );
  assert.equal(
    (await service.team(await actor(id.manager), id.site, id.team, q)).cameras[0]!.latestEvidence,
    undefined,
    'Manager gets camera metadata only',
  );
  const result = await service.overview(await actor(id.safety), id.site, q);
  const other = result.teams.items.find((t) => t.id === teamId)!;
  assert.equal(other.attentionAlertCount, 1);
  assert.equal(result.teams.items.find((t) => t.id === id.team)!.attentionAlertCount, 1);
  assert.deepEqual(other.checklistSummary, {
    total: 5,
    noChecklistAssigned: false,
    notSubmitted: 1,
    needsUpdate: 1,
    awaitingReview: 1,
    recordedWithFindings: 1,
    recordedWithoutFailures: 1,
    pastPlannedStart: 3,
    pastStartWithoutReport: 1,
    lateFirstReports: 4,
    reviewPendingPastStart: 1,
    findingsWithoutIncident: 1,
    openIncidentFindings: 0,
    closedIncidentFindings: 0,
  });
  const oldDay = await service.overview(await actor(id.safety), id.site, {
    date,
    timezone: q.timezone,
  });
  assert.equal(
    oldDay.teams.items.find((t) => t.id === id.oldTeam)!.checklistSummary!.noChecklistAssigned,
    true,
  );
  const reader = new SafetyAlertQueryService(
    source,
    new SafetyAlertEvidenceService(
      source,
      new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
    ),
  );
  const alerts = await reader.list(id.site, 0, 20, {
    contextTeamId: teamId,
    attentionOnly: true,
    capturedFrom: '2026-10-12T17:00:00Z',
    capturedUntil: '2026-10-13T17:00:00Z',
  });
  assert.equal(alerts.total, other.attentionAlertCount);
  const reports = await checklists.list(id.site, id.safety, {
    teamId,
    fromDate: q.date,
    toDate: q.date,
    timezone: q.timezone,
  });
  assert.equal(reports.total, other.checklistSummary!.total);
  const cancelled = (
    await checklists.create(id.site, id.safety, {
      ...create(),
      commandId: randomUUID(),
      teamId,
      assignedTo: id.outsider,
    })
  ).resource;
  await checklists.mutate(id.site, cancelled.id, id.safety, 'cancel', {
    commandId: randomUUID(),
    expectedVersion: cancelled.version,
    reason: 'Synthetic cancellation',
  });
  assert.equal(
    (
      await checklists.list(id.site, id.safety, {
        teamId,
        fromDate: q.date,
        toDate: q.date,
        timezone: q.timezone,
      })
    ).total,
    other.checklistSummary!.total,
  );
  assert.equal(
    (
      await checklists.list(id.site, id.safety, {
        teamId,
        fromDate: q.date,
        toDate: q.date,
        timezone: q.timezone,
        status: 'CANCELLED',
      })
    ).total,
    1,
  );

  await source.getRepository(SafetyAlertEntity).update(alertId, { status: AlertStatus.DISMISSED });
  assert.equal(
    (await service.overview(await actor(id.safety), id.site, q)).teams.items.find(
      (t) => t.id === teamId,
    )!.attentionAlertCount,
    0,
  );
});
