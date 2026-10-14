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
  TeamZonePermissionEntity,
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
import type { MainConfigurationActorContext } from '../../src/common/configuration/main-configuration-authority.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
import { MainParticipationCommandService } from '../../src/modules/zones/main-participation-command.service.js';
import { MainZonePermissionCommandService } from '../../src/modules/zones/main-zone-permission-command.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
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
): Promise<{ userId: string; context: MainConfigurationActorContext }> {
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
      actorRoles: [options.role],
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
    const workforce = new WorkforceConfigurationService(source);
    const createdWorker = await workforce.create(
      siteId,
      {
        externalId: 'WORKER-001',
        displayName: 'Worker One',
      },
      siteManagerActor.context,
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
        adminActor.context,
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
      contractorId: null,
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
      adminActor.context,
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
    await access.revokeGrant(siteId, zoneId, denyGrant.id, capturedAt, adminActor.context);

    const ingestionEventId = randomUUID();
    const ingestion = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(createTestConfig({ ALERT_COOLDOWN_SECONDS: '60' })),
      createTestConfig(),
      () => capturedAt,
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
    const unknownEventId = randomUUID();
    const unknownResult = await ingestion.ingestEvent({
      eventId: unknownEventId,
      schemaVersion: '1.0.0',
      cameraExternalId: `CAM-${cameraId}`,
      streamSessionId: randomUUID(),
      capturedAt: new Date(capturedAt.getTime() + 120_000).toISOString(),
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

test('enforces authority command actor/scope/version bounds, Team Zone permission fallback, and fail-closed savepoint isolation', async () => {
  await withDataSource(async (source) => {
    const siteId = randomUUID();
    const otherSiteId = randomUUID();
    const contractorId = randomUUID();
    const otherContractorId = randomUUID();
    const eventId = randomUUID();
    const cameraId = randomUUID();

    const now = Date.now();
    const fromDate = new Date(now - 60 * 60 * 1000);
    const evalAt = new Date(now + 30 * 60 * 1000);
    const untilDate = new Date(now + 4 * 60 * 60 * 1000);
    const outOfBoundsBefore = new Date(now - 2 * 60 * 60 * 1000);
    const outOfBoundsAfter = new Date(now + 6 * 60 * 60 * 1000);

    await source.getRepository(SiteEntity).insert([
      { id: siteId, code: `S-${siteId}`, name: 'Primary Site' },
      { id: otherSiteId, code: `S-${otherSiteId}`, name: 'Other Site' },
    ]);
    await source.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: `CAM-${cameraId}`,
      code: `C-${cameraId}`,
      name: 'Primary Camera',
      status: CameraStatus.ACTIVE,
    });
    await source.getRepository(AiObservationEventEntity).insert({
      eventId,
      payloadHash: 'b'.repeat(64),
      cameraExternalId: `CAM-${cameraId}`,
      resolvedCameraId: cameraId,
      streamSessionId: randomUUID(),
      capturedAt: evalAt,
      receivedAt: evalAt,
      rawPayload: {},
      processingStatus: EventProcessingStatus.SKIPPED_NO_CANDIDATE,
      processingNote: null,
    });

    await source.getRepository(ContractorEntity).insert([
      { id: contractorId, code: `CTR-${contractorId}`, name: 'Primary Contractor', isActive: true },
      {
        id: otherContractorId,
        code: `CTR-${otherContractorId}`,
        name: 'Other Contractor',
        isActive: true,
      },
    ]);

    const adminActor = await seedRoleActor(source, {
      role: UserRole.ADMIN,
      siteId: null,
    });
    const siteManagerActor = await seedRoleActor(source, {
      role: UserRole.SITE_MANAGER,
      siteId,
    });
    const wrongSiteManagerActor = await seedRoleActor(source, {
      role: UserRole.SITE_MANAGER,
      siteId: otherSiteId,
    });
    const safetyOfficerActor = await seedRoleActor(source, {
      role: UserRole.SAFETY_OFFICER,
      siteId,
    });
    const repActor = await seedRoleActor(source, {
      role: UserRole.CONTRACTOR_REPRESENTATIVE,
      siteId,
    });
    const ungrantedRepActor = await seedRoleActor(source, {
      role: UserRole.CONTRACTOR_REPRESENTATIVE,
      siteId,
    });
    const mustChangePasswordAdmin = await seedRoleActor(source, {
      role: UserRole.ADMIN,
      siteId: null,
      mustChangePassword: true,
    });

    await source.getRepository(ContractorRepresentativeGrantEntity).insert({
      id: randomUUID(),
      userId: repActor.userId,
      contractorId,
      siteId,
      grantedByUserId: adminActor.userId,
    });
    await source.getRepository(ContractorRepresentativeAssignmentEntity).insert({
      id: randomUUID(),
      userId: repActor.userId,
      contractorId,
      siteId,
    });

    const zoneConfig = new ZoneConfigurationService(source);
    const workforce = new WorkforceConfigurationService(source);
    const participationCommands = new MainParticipationCommandService(source);
    const assignmentCommands = new MainAssignmentCommandService(source);
    const permissionCommands = new MainZonePermissionCommandService(source);
    const teamsService = new ContractorTeamsService(source);
    const access = new ZoneAccessManagementService(source);
    const entryAuth = new ZoneEntryAuthorizationService();

    // 1. Actor / site-scope / credential-state refusals on configuration and authority commands
    await assert.rejects(
      zoneConfig.createZone(
        siteId,
        {
          code: 'Z-FORBIDDEN-PWD',
          name: 'Forbidden Password State Zone',
          type: ZoneType.RESTRICTED,
          restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
          requiredPpe: [],
        },
        mustChangePasswordAdmin.context,
      ),
      /Configuration actor is not active/,
    );
    await assert.rejects(
      zoneConfig.createZone(
        siteId,
        {
          code: 'Z-WRONG-SITE',
          name: 'Wrong Site Manager Zone',
          type: ZoneType.RESTRICTED,
          restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
          requiredPpe: [],
        },
        wrongSiteManagerActor.context,
      ),
      /Configuration actor cannot access target site/,
    );

    const createdZone = await zoneConfig.createZone(
      siteId,
      {
        code: `Z-${randomUUID().slice(0, 8)}`,
        name: 'Command Controlled Restricted Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
        requiredPpe: [],
      },
      siteManagerActor.context,
    );
    const zoneId = createdZone.id;

    await assert.rejects(
      workforce.create(
        siteId,
        {
          externalId: 'WORKER-FORBIDDEN',
          displayName: 'Forbidden Worker',
          contractorId,
        },
        wrongSiteManagerActor.context,
      ),
      /Configuration actor cannot access target site/,
    );
    const worker = await workforce.create(
      siteId,
      {
        externalId: 'WORKER-CMD-001',
        displayName: 'Command Worker One',
        contractorId,
      },
      siteManagerActor.context,
    );

    // 2. Participation command: non-admin refused; admin succeeds + idempotent replay + conflicting replay refused
    await assert.rejects(
      participationCommands.publicCreate(
        siteId,
        {
          commandId: randomUUID(),
          contractorId,
          validFrom: fromDate.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        siteManagerActor.context,
      ),
      /Main authority actor is not permitted/,
    );

    const participationCommandId = randomUUID();
    const participation = await participationCommands.publicCreate(
      siteId,
      {
        commandId: participationCommandId,
        contractorId,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      adminActor.context,
    );
    assert.equal(participation.siteId, siteId);
    assert.equal(participation.contractorId, contractorId);
    assert.equal(participation.version, 1);

    const replayedParticipation = await participationCommands.publicCreate(
      siteId,
      {
        commandId: participationCommandId,
        contractorId,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      adminActor.context,
    );
    assert.equal(replayedParticipation.id, participation.id);

    await assert.rejects(
      participationCommands.publicCreate(
        siteId,
        {
          commandId: participationCommandId,
          contractorId: otherContractorId,
          validFrom: fromDate.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        adminActor.context,
      ),
      /Command ID already used with different parameters/,
    );

    // 3. Worker Site/Zone assignment workflow: actor refusals, version conflict refusal, and approval
    await assert.rejects(
      assignmentCommands.publicRequest(
        siteId,
        {
          commandId: randomUUID(),
          workerId: worker.id,
          siteContractorId: participation.id,
          zoneIds: [zoneId],
          validFrom: fromDate.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        ungrantedRepActor.context,
      ),
      /Main authority actor is not permitted/,
    );

    const requestedAssignment = await assignmentCommands.publicRequest(
      siteId,
      {
        commandId: randomUUID(),
        workerId: worker.id,
        siteContractorId: participation.id,
        zoneIds: [zoneId],
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      repActor.context,
    );
    assert.equal(requestedAssignment.status, WorkerSiteZoneAssignmentStatus.PENDING);
    assert.equal(requestedAssignment.version, 1);

    await assert.rejects(
      assignmentCommands.publicSafetyReview(
        siteId,
        requestedAssignment.id,
        {
          commandId: randomUUID(),
          expectedVersion: 1,
          approve: true,
        },
        siteManagerActor.context,
      ),
      /Main authority actor is not permitted/,
    );

    const safetyApproved = await assignmentCommands.publicSafetyReview(
      siteId,
      requestedAssignment.id,
      {
        commandId: randomUUID(),
        expectedVersion: 1,
        approve: true,
      },
      safetyOfficerActor.context,
    );
    assert.equal(safetyApproved.status, WorkerSiteZoneAssignmentStatus.SAFETY_APPROVED);
    assert.equal(safetyApproved.version, 2);

    // Stale expectedVersion must fail with 409 state conflict
    await assert.rejects(
      assignmentCommands.publicDecision(
        siteId,
        requestedAssignment.id,
        {
          commandId: randomUUID(),
          expectedVersion: 1,
          approve: true,
        },
        siteManagerActor.context,
      ),
      /Worker Site\/Zone assignment state conflict/,
    );

    const approvedAssignment = await assignmentCommands.publicDecision(
      siteId,
      requestedAssignment.id,
      {
        commandId: randomUUID(),
        expectedVersion: 2,
        approve: true,
      },
      siteManagerActor.context,
    );
    assert.equal(approvedAssignment.status, WorkerSiteZoneAssignmentStatus.APPROVED);
    assert.equal(approvedAssignment.version, 3);

    // 4. Two-tier Zone permission commands: actor refusals, containment refusals, and valid grants
    await assert.rejects(
      permissionCommands.publicGrantContractor(
        siteId,
        {
          commandId: randomUUID(),
          siteContractorId: participation.id,
          zoneId,
          validFrom: fromDate.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        wrongSiteManagerActor.context,
      ),
      /Main authority actor is not permitted/,
    );

    await assert.rejects(
      permissionCommands.publicGrantContractor(
        siteId,
        {
          commandId: randomUUID(),
          siteContractorId: participation.id,
          zoneId,
          validFrom: fromDate.toISOString(),
          validUntil: outOfBoundsAfter.toISOString(),
        },
        siteManagerActor.context,
      ),
      /Contractor Zone permission is outside active participation bounds/,
    );

    const contractorPermissionCommandId = randomUUID();
    const contractorPermission = await permissionCommands.publicGrantContractor(
      siteId,
      {
        commandId: contractorPermissionCommandId,
        siteContractorId: participation.id,
        zoneId,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      siteManagerActor.context,
    );
    assert.equal(contractorPermission.zoneId, zoneId);

    await assert.rejects(
      permissionCommands.publicGrantWorker(
        siteId,
        {
          commandId: randomUUID(),
          workerAssignmentId: approvedAssignment.id,
          contractorZonePermissionId: contractorPermission.id,
          validFrom: fromDate.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        ungrantedRepActor.context,
      ),
      /Main authority actor is not permitted/,
    );

    await assert.rejects(
      permissionCommands.publicGrantWorker(
        siteId,
        {
          commandId: randomUUID(),
          workerAssignmentId: approvedAssignment.id,
          contractorZonePermissionId: contractorPermission.id,
          validFrom: outOfBoundsBefore.toISOString(),
          validUntil: untilDate.toISOString(),
        },
        repActor.context,
      ),
      /Worker Zone permission is outside approved assignment or Contractor permission bounds/,
    );

    const workerPermissionCommandId = randomUUID();
    const workerPermission = await permissionCommands.publicGrantWorker(
      siteId,
      {
        commandId: workerPermissionCommandId,
        workerAssignmentId: approvedAssignment.id,
        contractorZonePermissionId: contractorPermission.id,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      repActor.context,
    );
    assert.equal(workerPermission.workerAssignmentId, approvedAssignment.id);

    // Verify MF-06 command journal and commit witness rows were recorded for the canonical commands
    const commandRows = await source.query(
      'SELECT command_id, operation FROM mf06_authority_command WHERE command_id = ANY($1::uuid[])',
      [[participationCommandId, contractorPermissionCommandId, workerPermissionCommandId]],
    );
    assert.equal(commandRows.length, 3);
    const witnessRows = await source.query(
      'SELECT command_id FROM mf06_authority_commit_witness WHERE command_id = ANY($1::uuid[])',
      [[participationCommandId, contractorPermissionCommandId, workerPermissionCommandId]],
    );
    assert.equal(witnessRows.length, 3);
    const factRows = await source.query(
      'SELECT command_id, source_kind FROM mf06_authority_fact WHERE command_id = ANY($1::uuid[])',
      [[participationCommandId, contractorPermissionCommandId, workerPermissionCommandId]],
    );
    assert.equal(factRows.length, 3);

    // 5. Two-tier Worker Zone permission grants ALLOWED, and Team Zone permission preserves ALLOWED when individual permission is revoked
    const twoTierAllowed = await source.transaction((manager) =>
      entryAuth.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: worker.externalId ?? undefined,
        verifiedWorkerId: worker.id,
        trackId: 101,
        evaluatedAt: evalAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(twoTierAllowed.status, 'ALLOWED');
    assert.equal(twoTierAllowed.reasonCode, 'VALID_ALLOW');

    // Non-admin cannot create legacy DENY grant
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
        siteManagerActor.context,
      ),
      /Configuration actor lacks required role/,
    );

    const team = await teamsService.createTeam(
      siteId,
      {
        contractorId,
        code: `TEAM-${randomUUID().slice(0, 8)}`,
        name: 'Authorized Crew',
      },
      adminActor.context,
    );
    await teamsService.addMember(
      siteId,
      team.id,
      {
        workerId: worker.id,
        joinedAt: fromDate.toISOString(),
      },
      adminActor.context,
    );
    const teamZonePerm = (await teamsService.grantZonePermission(
      siteId,
      team.id,
      {
        contractorZonePermissionId: contractorPermission.id,
        validFrom: fromDate.toISOString(),
        validUntil: untilDate.toISOString(),
      },
      adminActor.context,
    )) as TeamZonePermissionEntity;

    // Revoke individual Worker Zone permission; Team Zone permission must still authorize entry
    await permissionCommands.publicRevoke(
      siteId,
      'worker',
      workerPermission.id,
      {
        commandId: randomUUID(),
        revokedAt: fromDate.toISOString(),
      },
      repActor.context,
    );

    const teamAllowed = await source.transaction((manager) =>
      entryAuth.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: worker.externalId ?? undefined,
        verifiedWorkerId: worker.id,
        trackId: 102,
        evaluatedAt: evalAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(teamAllowed.status, 'ALLOWED');
    assert.equal(teamAllowed.reasonCode, 'VALID_ALLOW');

    // Revoke Team Zone permission; entry must now default-deny (NO_VALID_ALLOW)
    await teamsService.revokeZonePermission(
      siteId,
      team.id,
      teamZonePerm.id,
      fromDate.toISOString(),
      adminActor.context,
    );

    const afterTeamRevoke = await source.transaction((manager) =>
      entryAuth.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: worker.externalId ?? undefined,
        verifiedWorkerId: worker.id,
        trackId: 103,
        evaluatedAt: evalAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(afterTeamRevoke.status, 'DENIED');
    assert.equal(afterTeamRevoke.reasonCode, 'NO_VALID_ALLOW');

    // 6. Missing/unreconciled schema in savepoint fails closed as UNAVAILABLE without poisoning caller transaction
    await source.transaction(async (manager) => {
      const [{ current_schema: activeSchema }] = await manager.query(
        'SELECT current_schema() AS current_schema',
      );
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
      const unavailable = await entryAuth.decide(manager, input);
      assert.equal(unavailable.status, 'UNAVAILABLE');
      assert.equal(unavailable.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
      assert.equal(unavailable.workerId, worker.id);
      assert.equal((await manager.query('SELECT 1 AS ok'))[0].ok, 1);

      await manager.query(`SET LOCAL search_path TO "${activeSchema}"`);
      await entryAuth.record(manager, input, unavailable);
      assert.equal((await manager.query('SELECT 1 AS ok'))[0].ok, 1);
    });

    const savedUnavailable = await source
      .getRepository(ZoneEntryDecisionEntity)
      .findOneByOrFail({ eventId, zoneId, trackId: 11 });
    assert.equal(savedUnavailable.status, 'UNAVAILABLE');
    assert.equal(savedUnavailable.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
  });
});
