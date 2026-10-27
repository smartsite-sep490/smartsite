import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  ContractorZonePermissionEntity,
  EventProcessingStatus,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  WorkerZonePermissionEntity,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
  ZoneEntity,
  ZoneEntryDecisionEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { MainWorkerRosterService } from '../../src/modules/workforce/main-worker-roster.service.js';
import { MainWorkforceCreateService } from '../../src/modules/workforce/main-workforce-create.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { publicUser } from '../../src/modules/auth/auth.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
import { MainParticipationCommandService } from '../../src/modules/zones/main-participation-command.service.js';
import { MainZonePermissionCommandService } from '../../src/modules/zones/main-zone-permission-command.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true });
const dataSource = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  return fn(dataSource);
}

async function seedRoleActor(
  source: DataSource,
  options: {
    role: UserRole;
    siteId: string | null;
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<{ userId: string; context: MainConfigurationCommandContext }> {
  const userId = randomUUID();
  await source.getRepository(UserEntity).insert({
    id: userId,
    username: `u-${userId}`,
    displayName: `Actor ${options.role}`,
    passwordHash: 'synthetic-not-login',
    isActive: options.isActive ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  await source.getRepository(UserRoleAssignmentEntity).insert({
    id: randomUUID(),
    userId,
    role: options.role,
    siteId: options.siteId,
  });
  return {
    userId,
    context: {
      actorUserId: userId,
    },
  };
}

test('evaluates event-time Zone entry authorization from two-tier and Team permissions, independent DENY, and unknown identity', async () => {
  await withDataSource(async (source) => {
    const siteId = randomUUID();
    const zoneId = randomUUID();
    const cameraId = randomUUID();
    const regionId = randomUUID();
    const eventId = randomUUID();
    const capturedAt = new Date('2026-09-28T08:00:00.000Z');

    await source
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: `S-${siteId}`, name: 'Site' });
    const adminActor = await seedRoleActor(source, {
      role: UserRole.ADMIN,
      siteId: null,
    });
    const siteManagerActor = await seedRoleActor(source, {
      role: UserRole.SITE_MANAGER,
      siteId,
    });

    await source.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: `CAM-${cameraId}`,
      code: `C-${cameraId}`,
      name: 'Camera',
      status: CameraStatus.ACTIVE,
    });
    await source.getRepository(ZoneEntity).insert({
      id: zoneId,
      siteId,
      code: `Z-${zoneId}`,
      name: 'Restricted',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
      configurationLocked: false,
    });
    const workforce = new MainWorkerRosterService(source);
    const createdWorker = await workforce.create(
      siteId,
      {
        externalId: 'WORKER-001',
        displayName: 'Worker One',
      },
      adminActor.context,
    );
    assert.equal(createdWorker.siteId, siteId);
    const actualWorkerId = createdWorker.id;
    await source.getRepository(CameraObservationRegionEntity).insert({
      id: regionId,
      cameraId,
      zoneId,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    });
    await source.getRepository(AiObservationEventEntity).insert({
      eventId,
      payloadHash: 'a'.repeat(64),
      cameraExternalId: `CAM-${cameraId}`,
      resolvedCameraId: cameraId,
      streamSessionId: randomUUID(),
      capturedAt,
      receivedAt: capturedAt,
      rawPayload: {},
      processingStatus: EventProcessingStatus.SKIPPED_NO_CANDIDATE,
      processingNote: null,
    });

    const access = new ZoneAccessManagementService(source);
    await assert.rejects(
      access.createGrant(
        siteId,
        zoneId,
        {
          workerId: actualWorkerId,
          effect: ZoneAccessEffect.ALLOW,
          validFrom: '2026-09-28T07:00:00.000Z',
          validUntil: '2026-09-28T09:00:00.000Z',
        },
        siteManagerActor.context,
      ),
      /Contractor and Worker Zone permissions/,
    );

    // Existing legacy flat ALLOW rows do not establish canonical two-tier authority
    // and must default-deny when no active Contractor + Worker/Team Zone permission exists.
    await source.getRepository(ZoneAccessGrantEntity).insert({
      id: randomUUID(),
      siteId,
      zoneId,
      workerId: actualWorkerId,
      effect: ZoneAccessEffect.ALLOW,
      validFrom: new Date('2026-09-28T07:00:00.000Z'),
      validUntil: new Date('2026-09-28T09:00:00.000Z'),
      revokedAt: null,
    });

    const service = new ZoneEntryAuthorizationService();
    const defaultDenied = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 6,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(defaultDenied.status, 'DENIED');
    assert.equal(defaultDenied.reasonCode, 'NO_VALID_ALLOW');
    assert.equal(defaultDenied.workerId, actualWorkerId);
    assert.equal(defaultDenied.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');

    const actorId = siteManagerActor.userId;
    const contractorId = randomUUID();
    const participationId = randomUUID();
    const assignmentId = randomUUID();
    const permissionId = randomUUID();
    const workerPermissionId = randomUUID();
    const from = new Date('2026-09-28T07:00:00.000Z');
    const until = new Date('2026-09-28T09:00:00.000Z');

    await source
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await source.getRepository(WorkerEntity).update(actualWorkerId, { contractorId });
    await source.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      siteId,
      contractorId,
      validFrom: from,
      validUntil: until,
      isActive: true,
    });
    await source.getRepository(WorkerSiteZoneAssignmentEntity).save({
      id: assignmentId,
      siteId,
      workerId: actualWorkerId,
      siteContractorId: participationId,
      zoneIds: [zoneId],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: from,
      validUntil: until,
      requestedByUserId: actorId,
    });
    await source.getRepository(ContractorZonePermissionEntity).save({
      id: permissionId,
      siteContractorId: participationId,
      zoneId,
      validFrom: from,
      validUntil: until,
      grantedBy: actorId,
    });
    await source.getRepository(WorkerZonePermissionEntity).save({
      id: workerPermissionId,
      workerAssignmentId: assignmentId,
      contractorZonePermissionId: permissionId,
      validFrom: from,
      validUntil: until,
      grantedBy: actorId,
    });

    const allowed = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 7,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(allowed.status, 'ALLOWED');
    assert.equal(allowed.reasonCode, 'VALID_ALLOW');
    assert.equal(allowed.workerId, actualWorkerId);

    const expired = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 7,
        evaluatedAt: new Date('2026-09-28T10:00:00.000Z'),
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(expired.status, 'DENIED');
    assert.equal(expired.reasonCode, 'NO_VALID_ALLOW');

    await access.createGrant(
      siteId,
      zoneId,
      {
        workerId: actualWorkerId,
        effect: ZoneAccessEffect.DENY,
        validFrom: '2026-09-28T07:30:00.000Z',
        validUntil: null,
      },
      siteManagerActor.context,
    );
    const denied = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 8,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(denied.status, 'DENIED');
    assert.equal(denied.reasonCode, 'EXPLICIT_DENY');

    const unknown = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: undefined,
        trackId: 9,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(unknown.status, 'UNAVAILABLE');
    assert.equal(unknown.reasonCode, 'IDENTITY_UNAVAILABLE');

    await source.transaction(async (manager) => {
      await service.record(
        manager,
        {
          eventId,
          siteId,
          zoneId,
          candidateWorkerId: 'WORKER-001',
          trackId: 7,
          evaluatedAt: capturedAt,
        },
        allowed,
      );
      await service.record(
        manager,
        {
          eventId,
          siteId,
          zoneId,
          candidateWorkerId: 'WORKER-001',
          trackId: 7,
          evaluatedAt: capturedAt,
        },
        allowed,
      );
    });
    const recorded = await source.getRepository(ZoneEntryDecisionEntity).findBy({ eventId });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.status, 'ALLOWED');

    const denyGrant = (await access.listGrants(siteId, zoneId, 0, 20)).items.find(
      (grant) => grant.effect === ZoneAccessEffect.DENY,
    )!;
    await access.revokeGrant(siteId, zoneId, denyGrant.id, capturedAt, siteManagerActor.context);

    const ingestionEventId = randomUUID();
    let ingestionClock = capturedAt;
    const ingestion = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(
        createTestConfig({ ALERT_COOLDOWN_SECONDS: '60' }),
        new SchedulingNotificationService(source),
      ),
      createTestConfig(),
      () => ingestionClock,
      service,
    );
    const result = await ingestion.ingestEvent({
      eventId: ingestionEventId,
      schemaVersion: '1.0.0',
      cameraExternalId: `CAM-${cameraId}`,
      streamSessionId: randomUUID(),
      capturedAt: capturedAt.toISOString(),
      frameDimensions: { width: 1280, height: 720 },
      observations: [
        // A candidate summary must bind to one original PERSON in this event.
        // This evidence still does not verify a Worker or grant Zone access.
        {
          type: 'PERSON',
          trackId: 42,
          confidence: 0.95,
          boundingBox: {
            x1: 0.1,
            y1: 0.1,
            x2: 0.4,
            y2: 0.8,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          type: 'IDENTITY_CANDIDATE',
          trackId: 42,
          status: 'CANDIDATE',
          candidateWorkerId: 'WORKER-001',
          similarityScore: 0.98,
        },
        { type: 'ZONE_ENTRY', trackId: 42, regionId, geometryVersion: 1 },
      ],
      evidence: [],
    });
    assert.equal(result.status, EventProcessingStatus.PROCESSED);
    assert.equal(result.alertIds.length, 1);
    const unverifiedDecision = await source
      .getRepository(ZoneEntryDecisionEntity)
      .findOneByOrFail({ eventId: ingestionEventId, trackId: 42, zoneId });
    assert.equal(unverifiedDecision.status, 'UNAVAILABLE');
    assert.equal(unverifiedDecision.reasonCode, 'IDENTITY_UNAVAILABLE');
    assert.equal(unverifiedDecision.workerId, null);
    assert.equal(unverifiedDecision.candidateWorkerId, 'WORKER-001');
    const decisions = await access.listDecisions(siteId, { zoneId, offset: 0, limit: 20 });
    assert.equal(decisions.total, 2);
    assert.deepEqual(decisions.items.map((decision) => decision.status).sort(), [
      'ALLOWED',
      'UNAVAILABLE',
    ]);

    // Immutable v1 accepts zero and Track IDs beyond PostgreSQL INTEGER.
    for (const trackId of [0, 2147483648, Number.MAX_SAFE_INTEGER]) {
      const input = { eventId, siteId, zoneId, trackId, evaluatedAt: capturedAt };
      await source.transaction(async (manager) => {
        await service.record(manager, input, unknown);
        await service.record(manager, input, unknown);
      });
      const rows = await source.getRepository(ZoneEntryDecisionEntity).findBy({ eventId, trackId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.trackId, trackId);
      assert.equal(typeof rows[0]!.trackId, 'number');
    }
    const largeDecisions = await access.listDecisions(siteId, { zoneId, offset: 0, limit: 20 });
    assert.equal(largeDecisions.total, 5);
    for (const { trackId } of largeDecisions.items) {
      assert.equal(typeof JSON.parse(JSON.stringify({ trackId })).trackId, 'number');
    }

    // Identity review reads the original decision; it never uses a face candidate as authority.
    const exact = await access.listObservationDecisions(siteId, eventId, Number.MAX_SAFE_INTEGER);
    assert.equal(exact.total, 1);
    assert.equal(exact.items[0]?.status, 'UNAVAILABLE');
    assert.deepEqual(Object.keys(exact.items[0]!).sort(), [
      'evaluatedAt',
      'id',
      'reasonCode',
      'status',
      'zoneId',
    ]);
    assert.deepEqual(
      await access.listObservationDecisions(randomUUID(), eventId, Number.MAX_SAFE_INTEGER),
      { items: [], total: 0 },
    );
    assert.deepEqual(
      await access.listObservationDecisions(siteId, randomUUID(), Number.MAX_SAFE_INTEGER),
      { items: [], total: 0 },
    );
    assert.deepEqual(await access.listObservationDecisions(siteId, eventId, 999), {
      items: [],
      total: 0,
    });
    const otherZoneId = randomUUID();
    await source.getRepository(ZoneEntity).insert({
      id: otherZoneId,
      siteId,
      code: `Z-${otherZoneId}`,
      name: 'Overlapping zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      requiredPpe: [],
      configurationLocked: false,
    });
    await source.transaction(async (manager) => {
      const input = {
        eventId,
        siteId,
        zoneId: otherZoneId,
        trackId: Number.MAX_SAFE_INTEGER,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      };
      await service.record(manager, input, await service.decide(manager, input));
    });
    const overlapping = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
    );
    assert.equal(overlapping.total, 2);
    assert.deepEqual(
      new Set(overlapping.items.map((item) => item.status)),
      new Set(['DENIED', 'UNAVAILABLE']),
    );
    const first = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
      0,
      1,
    );
    const second = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
      1,
      1,
    );
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    assert.deepEqual([...first.items, ...second.items], overlapping.items);

    // Explicit UNKNOWN identity observation also yields UNAVAILABLE (IDENTITY_UNAVAILABLE), never DENIED.
    ingestionClock = new Date(capturedAt.getTime() + 120_000);
    const unknownEventId = randomUUID();
    const unknownResult = await ingestion.ingestEvent({
      eventId: unknownEventId,
      schemaVersion: '1.0.0',
      cameraExternalId: `CAM-${cameraId}`,
      streamSessionId: randomUUID(),
      capturedAt: ingestionClock.toISOString(),
      frameDimensions: { width: 1280, height: 720 },
      observations: [
        {
          type: 'PERSON',
          trackId: 43,
          confidence: 0.94,
          boundingBox: {
            x1: 0.15,
            y1: 0.15,
            x2: 0.45,
            y2: 0.85,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          type: 'IDENTITY_CANDIDATE',
          trackId: 43,
          status: 'UNKNOWN',
        },
        { type: 'ZONE_ENTRY', trackId: 43, regionId, geometryVersion: 1 },
      ],
      evidence: [],
    });
    assert.equal(unknownResult.status, EventProcessingStatus.PROCESSED);
    const explicitUnknownDecision = await source
      .getRepository(ZoneEntryDecisionEntity)
      .findOneByOrFail({ eventId: unknownEventId, trackId: 43, zoneId });
    assert.equal(explicitUnknownDecision.status, 'UNAVAILABLE');
    assert.equal(explicitUnknownDecision.reasonCode, 'IDENTITY_UNAVAILABLE');
    assert.equal(explicitUnknownDecision.workerId, null);
    assert.equal(explicitUnknownDecision.candidateWorkerId, null);
  });
});

test('enforces real command actor/scope/version bounds, Team fallback, and fail-closed savepoint isolation', async () => {
  const source = dataSource;
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const contractorId = randomUUID();
  const otherContractorId = randomUUID();
  const zoneId = randomUUID();
  const eventId = randomUUID();
  const cameraId = randomUUID();
  const now = Date.now();
  const fromDate = new Date(now - 60 * 60 * 1000);
  const evalAt = new Date(now + 30 * 60 * 1000);
  const untilDate = new Date(now + 4 * 60 * 60 * 1000);
  const beforeBounds = new Date(now - 2 * 60 * 60 * 1000);
  const afterBounds = new Date(now + 6 * 60 * 60 * 1000);
  await source.getRepository(SiteEntity).insert([
    { id: siteId, code: siteId, name: 'Primary Site' },
    { id: otherSiteId, code: otherSiteId, name: 'Other Site' },
  ]);
  await source.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Command Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    requiredPpe: [],
  });
  await source.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Fixture camera',
    status: CameraStatus.ACTIVE,
  });
  await source.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash: 'b'.repeat(64),
    cameraExternalId: cameraId,
    resolvedCameraId: cameraId,
    streamSessionId: randomUUID(),
    capturedAt: evalAt,
    receivedAt: evalAt,
    rawPayload: {},
    processingStatus: EventProcessingStatus.SKIPPED_NO_CANDIDATE,
    processingNote: null,
  });
  await source.getRepository(ContractorEntity).insert([
    { id: contractorId, code: contractorId, name: 'Primary Contractor', isActive: true },
    { id: otherContractorId, code: otherContractorId, name: 'Other Contractor', isActive: true },
  ]);
  const admin = await seedRoleActor(source, { role: UserRole.ADMIN, siteId: null });
  const manager = await seedRoleActor(source, { role: UserRole.SITE_MANAGER, siteId });
  const wrongManager = await seedRoleActor(source, {
    role: UserRole.SITE_MANAGER,
    siteId: otherSiteId,
  });
  const safety = await seedRoleActor(source, { role: UserRole.SAFETY_OFFICER, siteId });
  const rep = await seedRoleActor(source, { role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId });
  const ungrantedRep = await seedRoleActor(source, {
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
    siteId,
  });
  const inactiveAdmin = await seedRoleActor(source, {
    role: UserRole.ADMIN,
    siteId: null,
    isActive: false,
  });
  const passwordAdmin = await seedRoleActor(source, {
    role: UserRole.ADMIN,
    siteId: null,
    mustChangePassword: true,
  });
  await source
    .getRepository(ContractorRepresentativeGrantEntity)
    .insert({ id: randomUUID(), userId: rep.userId, contractorId });
  await source
    .getRepository(ContractorRepresentativeAssignmentEntity)
    .insert({ id: randomUUID(), userId: rep.userId, contractorId, siteId });

  const participations = new MainParticipationCommandService(source);
  const assignments = new MainAssignmentCommandService(source);
  const permissions = new MainZonePermissionCommandService(source);
  const workers = new MainWorkforceCreateService(source);
  const teams = new ContractorTeamsService(source);
  const entry = new ZoneEntryAuthorizationService();
  const access = new ZoneAccessManagementService(source);
  const status = (expected: number) => (error: unknown) =>
    error instanceof PublicHttpException && error.getStatus() === expected;
  const participationCommand = {
    commandId: randomUUID(),
    actorUserId: admin.userId,
    siteId,
    contractorId,
    validFrom: fromDate.toISOString(),
    validUntil: untilDate.toISOString(),
  };
  // These are internal, strict, idempotent commands. Public DTOs do not accept commandId.
  for (const actorUserId of [manager.userId, inactiveAdmin.userId, passwordAdmin.userId]) {
    await assert.rejects(
      participations.create({ ...participationCommand, commandId: randomUUID(), actorUserId }),
      status(403),
    );
  }
  const createdParticipation = await participations.create(participationCommand);
  const participation = createdParticipation.participation;
  assert.equal(createdParticipation.replayed, false);
  assert.equal(participation.siteId, siteId);
  assert.equal(participation.contractorId, contractorId);
  const replayedParticipation = await participations.create(participationCommand);
  assert.equal(replayedParticipation.replayed, true);
  assert.equal(replayedParticipation.participation.id, participation.id);
  await assert.rejects(
    participations.create({ ...participationCommand, contractorId: otherContractorId }),
    status(409),
  );
  assert.equal(
    await source.getRepository(ContractorSiteParticipationEntity).countBy({ contractorId, siteId }),
    1,
  );

  const workerInput = { siteId, externalId: randomUUID(), displayName: 'Command Worker' };
  await assert.rejects(
    workers.createWorker(contractorId, workerInput, ungrantedRep.context),
    status(403),
  );
  const worker = await workers.createWorker(contractorId, workerInput, rep.context);
  assert.equal(worker.contractorId, contractorId);
  assert.equal(worker.siteId, siteId);
  const request = {
    commandId: randomUUID(),
    actorUserId: rep.userId,
    siteId,
    workerId: worker.id,
    zoneIds: [zoneId],
    validFrom: fromDate.toISOString(),
    validUntil: untilDate.toISOString(),
  };
  await assert.rejects(
    assignments.request({ ...request, commandId: randomUUID(), actorUserId: ungrantedRep.userId }),
    status(403),
  );
  const requested = await assignments.request(request);
  assert.equal(requested.assignment.status, 'PENDING');
  assert.equal(requested.assignment.version, 1);
  assert.equal(requested.assignment.siteContractorId, participation.id);
  const review = {
    commandId: randomUUID(),
    actorUserId: safety.userId,
    siteId,
    assignmentId: requested.assignment.id,
  };
  await assert.rejects(
    assignments.safetyReview({ ...review, actorUserId: manager.userId }),
    status(403),
  );
  const reviewed = await assignments.safetyReview(review);
  assert.equal(reviewed.assignment.status, 'SAFETY_REVIEWED');
  assert.equal(reviewed.assignment.version, 2);
  const decision = {
    commandId: randomUUID(),
    actorUserId: manager.userId,
    siteId,
    assignmentId: requested.assignment.id,
    approve: true,
    expectedVersion: 2,
  };
  await assert.rejects(
    assignments.decision({ ...decision, commandId: randomUUID(), expectedVersion: 1 }),
    status(409),
  );
  const approved = await assignments.decision(decision);
  assert.equal(approved.assignment.status, 'APPROVED');
  assert.equal(approved.assignment.version, 3);

  const contractorCommand = {
    commandId: randomUUID(),
    requestId: randomUUID(),
    actorUserId: manager.userId,
    siteId,
    siteContractorId: participation.id,
    zoneId,
    validFrom: fromDate.toISOString(),
    validUntil: untilDate.toISOString(),
  };
  await assert.rejects(
    permissions.grantContractor({
      ...contractorCommand,
      commandId: randomUUID(),
      actorUserId: wrongManager.userId,
    }),
    status(403),
  );
  await assert.rejects(
    permissions.grantContractor({
      ...contractorCommand,
      commandId: randomUUID(),
      requestId: randomUUID(),
      validUntil: afterBounds.toISOString(),
    }),
    status(409),
  );
  const contractorPermission = await permissions.grantContractor(contractorCommand);
  assert.equal(contractorPermission.permission.zoneId, zoneId);
  const workerCommand = {
    commandId: randomUUID(),
    requestId: randomUUID(),
    actorUserId: rep.userId,
    siteId,
    workerAssignmentId: approved.assignment.id,
    contractorZonePermissionId: contractorPermission.permission.id,
    validFrom: fromDate.toISOString(),
    validUntil: untilDate.toISOString(),
  };
  await assert.rejects(
    permissions.grantWorker({
      ...workerCommand,
      commandId: randomUUID(),
      requestId: randomUUID(),
      actorUserId: ungrantedRep.userId,
    }),
    status(409),
  );
  await assert.rejects(
    permissions.grantWorker({
      ...workerCommand,
      commandId: randomUUID(),
      requestId: randomUUID(),
      validFrom: beforeBounds.toISOString(),
    }),
    status(409),
  );
  const workerPermission = await permissions.grantWorker(workerCommand);
  assert.equal(workerPermission.permission.workerAssignmentId, approved.assignment.id);
  const replay = await permissions.grantWorker(workerCommand);
  assert.equal(replay.replayed, true);
  assert.equal(replay.permission.id, workerPermission.permission.id);
  const commandIds = [
    participationCommand.commandId,
    contractorCommand.commandId,
    workerCommand.commandId,
  ];
  for (const relation of [
    'authorization_history_command',
    'authorization_history_commit_receipt',
  ]) {
    const [{ n }] = await source.query(
      `SELECT count(*)::int AS n FROM ${relation} WHERE command_id=ANY($1::uuid[])`,
      [commandIds],
    );
    assert.equal(n, 3, relation);
  }
  const facts: Array<{
    command_id: string;
    source_kind: string;
    source_id: string;
    bound: boolean;
  }> = await source.query(
    'SELECT f.command_id,f.source_kind,f.source_id,f.transaction_id=c.transaction_id AS bound FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) WHERE f.command_id=ANY($1::uuid[])',
    [commandIds],
  );
  assert.deepEqual(
    facts.map((f) => [f.command_id, f.source_kind, f.source_id].join(':')).sort(),
    [
      [participationCommand.commandId, 'PARTICIPATION', participation.id].join(':'),
      [
        contractorCommand.commandId,
        'CONTRACTOR_PERMISSION',
        contractorPermission.permission.id,
      ].join(':'),
      [contractorCommand.commandId, 'SITE', siteId].join(':'),
      [workerCommand.commandId, 'WORKER_PERMISSION', workerPermission.permission.id].join(':'),
      [workerCommand.commandId, 'SITE', siteId].join(':'),
    ].sort(),
  );
  assert.ok(facts.every((f) => f.bound));
  const decide = (trackId: number) =>
    source.transaction((m) =>
      entry.decide(m, {
        eventId,
        siteId,
        zoneId,
        verifiedWorkerId: worker.id,
        candidateWorkerId: worker.externalId ?? undefined,
        trackId,
        evaluatedAt: evalAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
  const allowed = await decide(101);
  assert.equal(allowed.status, 'ALLOWED');
  assert.equal(allowed.reasonCode, 'VALID_ALLOW');
  await assert.rejects(
    access.createGrant(
      siteId,
      zoneId,
      {
        workerId: worker.id,
        effect: ZoneAccessEffect.DENY,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      admin.context,
    ),
    status(403),
  );

  const repUser = publicUser(
    await source.getRepository(UserEntity).findOneByOrFail({ id: rep.userId }),
    await source.getRepository(UserRoleAssignmentEntity).findBy({ userId: rep.userId }),
  );
  const team = await teams.create(repUser, siteId, contractorId, {
    requestId: randomUUID(),
    name: 'Authorized Crew',
  });
  await teams.assign(repUser, siteId, contractorId, worker.id, {
    requestId: randomUUID(),
    teamId: team.id,
    expectedMembershipId: null,
  });
  const today = new Date(now).toISOString().slice(0, 10);
  const teamPermission = await teams.grantZone(repUser, siteId, contractorId, team.id, {
    requestId: randomUUID(),
    contractorZonePermissionId: contractorPermission.permission.id,
    startDate: today,
    endDate: today,
    timezone: 'UTC',
  });
  await permissions.revokeWorker({
    commandId: randomUUID(),
    actorUserId: rep.userId,
    siteId,
    permissionId: workerPermission.permission.id,
  });
  const teamAllowed = await decide(102);
  assert.equal(teamAllowed.status, 'ALLOWED');
  assert.equal(teamAllowed.reasonCode, 'VALID_ALLOW');
  await teams.revokeZone(repUser, siteId, contractorId, team.id, teamPermission.id);
  const denied = await decide(103);
  assert.equal(denied.status, 'DENIED');
  assert.equal(denied.reasonCode, 'NO_VALID_ALLOW');

  await source.transaction(async (manager) => {
    const [{ current_schema: schema }] = await manager.query(
      'SELECT current_schema() AS current_schema',
    );
    assert.match(schema, /^isolated_test_[a-f0-9]{32}$/);
    const input = {
      eventId,
      siteId,
      zoneId,
      verifiedWorkerId: worker.id,
      trackId: 11,
      evaluatedAt: evalAt,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    };
    await manager.query('SET LOCAL search_path TO pg_catalog');
    const unavailable = await entry.decide(manager, input);
    assert.equal(unavailable.status, 'UNAVAILABLE');
    assert.equal(unavailable.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
    assert.equal(unavailable.workerId, worker.id);
    assert.equal((await manager.query('SELECT 1 AS ok'))[0].ok, 1);
    await manager.query(`SET LOCAL search_path TO "${schema}"`);
    await entry.record(manager, input, unavailable);
    assert.equal((await manager.query('SELECT 1 AS ok'))[0].ok, 1);
  });
  const saved = await source
    .getRepository(ZoneEntryDecisionEntity)
    .findOneByOrFail({ eventId, zoneId, trackId: 11 });
  assert.equal(saved.status, 'UNAVAILABLE');
  assert.equal(saved.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
});
