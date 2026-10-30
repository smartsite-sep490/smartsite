import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';

import {
  AiObservationEventEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  ZoneEntryAssessmentJobEntity,
  ZoneEntryAssessmentRequestEntity,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import type { BackendEnvironment } from '../../src/config/environment.js';

import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';

// -----------------------------------------------------------------------------
// Database isolation and Synthetic Fixtures
// -----------------------------------------------------------------------------

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;

before(async () => {
  await isolated.initialize();
});

after(async () => {
  await isolated.dispose();
});

beforeEach(async () => {
  // Only this file's disposable schema; release earlier fixture capacity without deleting history.
  await db.query(
    "UPDATE zone_entry_assessment_job SET status = 'CANCELLED', head_revision = head_revision + 1, updated_at = statement_timestamp(), lease_token = NULL, lease_expires_at = NULL WHERE status IN ('PENDING', 'CLAIMED')",
  );
});

interface InfrastructureFixture {
  siteId: string;
  site2Id: string;
  cameraId: string;
  externalId: string;
  zone1Id: string;
  zone2Id: string;
  region1Id: string;
  region2Id: string;
}

async function setupInfrastructure(manager: EntityManager): Promise<InfrastructureFixture> {
  const siteId = randomUUID();
  const site2Id = randomUUID();
  const cameraId = randomUUID();
  const externalId = `cam-ext-${randomUUID().slice(0, 8)}`;
  const zone1Id = randomUUID();
  const zone2Id = randomUUID();
  const region1Id = randomUUID();
  const region2Id = randomUUID();

  await manager.getRepository(SiteEntity).insert([
    {
      id: siteId,
      code: `SITE-${siteId.slice(0, 6)}`,
      name: 'Primary Synthetic Test Site',
    },
    {
      id: site2Id,
      code: `SITE-${site2Id.slice(0, 6)}`,
      name: 'Secondary Synthetic Test Site',
    },
  ]);

  await manager.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId,
    code: `CAM-${cameraId.slice(0, 6)}`,
    name: 'Synthetic Test Camera',
    status: CameraStatus.ACTIVE,
  });

  await manager.getRepository(ZoneEntity).insert([
    {
      id: zone1Id,
      siteId,
      code: `ZONE-01-${zone1Id.slice(0, 6)}`,
      name: 'Restricted Zone 1',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    },
    {
      id: zone2Id,
      siteId,
      code: `ZONE-02-${zone2Id.slice(0, 6)}`,
      name: 'Restricted Zone 2',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    },
  ]);

  const defaultPolygon = {
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };

  await manager.getRepository(CameraObservationRegionEntity).insert([
    {
      id: region1Id,
      cameraId,
      zoneId: zone1Id,
      polygon: defaultPolygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    },
    {
      id: region2Id,
      cameraId,
      zoneId: zone2Id,
      polygon: defaultPolygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    },
  ]);

  return { siteId, site2Id, cameraId, externalId, zone1Id, zone2Id, region1Id, region2Id };
}

const standardPersonBox = Object.freeze({
  x1: 0.1,
  y1: 0.2,
  x2: 0.4,
  y2: 0.8,
  coordinateSpace: 'NORMALIZED_0_1' as const,
});

function createPersonObservation(trackId: number, box: unknown = standardPersonBox) {
  return {
    type: 'PERSON',
    trackId,
    boundingBox: box,
  };
}

function createZoneEntryObservation(trackId: number, regionId: string, geometryVersion = 1) {
  return {
    type: 'ZONE_ENTRY',
    trackId,
    regionId,
    geometryVersion,
  };
}

interface SyntheticPayloadOptions {
  eventId?: string;
  externalId: string;
  observations: Array<Record<string, unknown>>;
  capturedAt?: string;
  streamSessionId?: string;
}

function createSyntheticPayload(options: SyntheticPayloadOptions) {
  return {
    eventId: options.eventId ?? randomUUID(),
    schemaVersion: '1.0.0',
    cameraExternalId: options.externalId,
    streamSessionId: options.streamSessionId ?? randomUUID(),
    capturedAt: options.capturedAt ?? '2026-10-10T12:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: options.observations,
    evidence: [],
  };
}

const fixedTestNow = new Date('2026-10-10T12:00:00.000Z');
const fixedTestClock = () => fixedTestNow;

function buildIngestionService(options: {
  db: DataSource;
  config: ConfigService<BackendEnvironment, true>;
  clock?: () => Date;
  enqueueService?: Mf06IngestionEnqueueService;
  contextResolver?: ObservationContextResolverService;
  groupingService?: DurableGroupingService;
}) {
  const contextResolver = options.contextResolver ?? new ObservationContextResolverService();
  const candidateEvaluator = new AlertCandidateEvaluator();
  const groupingService =
    options.groupingService ??
    new DurableGroupingService(options.config, new SchedulingNotificationService(options.db));
  const zoneAuth = new ZoneEntryAuthorizationService();
  const enqueueService =
    options.enqueueService ?? new Mf06IngestionEnqueueService(options.db, options.config);

  return new AiIngestionService(
    options.db,
    contextResolver,
    candidateEvaluator,
    groupingService,
    options.config,
    options.clock ?? fixedTestClock,
    zoneAuth,
    enqueueService,
  );
}

async function insertPriorJob(
  manager: EntityManager,
  infra: InfrastructureFixture,
  status: 'PENDING' | 'CLAIMED',
  options?: {
    isExpired?: boolean;
    referenceNow?: Date;
  },
): Promise<{ eventId: string; requestId: string }> {
  const eventId = randomUUID();
  const streamSessionId = randomUUID();
  const now = options?.referenceNow ?? fixedTestNow;

  const rawPayload = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: infra.externalId,
    streamSessionId,
    capturedAt: '2026-10-10T12:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [createPersonObservation(1), createZoneEntryObservation(1, infra.region1Id, 1)],
    evidence: [],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);

  await manager.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash,
    cameraExternalId: infra.externalId,
    resolvedCameraId: infra.cameraId,
    streamSessionId,
    capturedAt: new Date('2026-10-10T12:00:00.000Z'),
    receivedAt: now,
    rawPayload,
    processingStatus: EventProcessingStatus.PROCESSED,
  });

  const requestId = randomUUID();
  const bindingHash = computeCanonicalPayloadHash({
    algorithm: 'MF06_OBSERVATION_SUBJECT_BINDING_V1',
    eventId,
    zoneObservationIndex: 1,
    personObservationIndex: 0,
    subjectBindingStatus: 'BOUND',
    trackId: 1,
    regionId: infra.region1Id,
    geometryVersion: 1,
    personBoundingBox: standardPersonBox,
  });

  await manager.query(
    `INSERT INTO zone_entry_assessment_request (
      request_id, event_id, payload_hash, person_observation_index, zone_observation_index,
      subject_binding_status, track_id, site_id, camera_id, camera_external_id,
      stream_session_id, region_id, geometry_version, zone_id, captured_at,
      requested_purpose, request_revision, binding_hash
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )`,
    [
      requestId,
      eventId,
      payloadHash,
      0,
      1,
      'BOUND',
      1,
      infra.siteId,
      infra.cameraId,
      infra.externalId,
      streamSessionId,
      infra.region1Id,
      1,
      infra.zone1Id,
      new Date('2026-10-10T12:00:00.000Z'),
      'INITIAL_OBSERVATION_ASSESSMENT',
      1,
      bindingHash,
    ],
  );

  if (options?.isExpired) {
    const createdAt = new Date(now.getTime() - 2 * 3600 * 1000);
    const leaseExpiresAt = status === 'CLAIMED' ? new Date(now.getTime() - 1 * 3600 * 1000) : null;
    const deadlineAt = new Date(now.getTime() - 30 * 60 * 1000);
    const leaseToken = status === 'CLAIMED' ? randomUUID() : null;

    await manager.query(
      `INSERT INTO zone_entry_assessment_job (
        request_id, status, attempt_count, head_revision, lease_token,
        lease_expires_at, next_attempt_at, deadline_at, created_at, updated_at
      ) VALUES ($1, $2, 0, 1, $3, $4, $5, $6, $7, $8)`,
      [requestId, status, leaseToken, leaseExpiresAt, createdAt, deadlineAt, createdAt, createdAt],
    );
  } else {
    const createdAt = now;
    const deadlineAt = new Date(now.getTime() + 300 * 1000);
    const leaseToken = status === 'CLAIMED' ? randomUUID() : null;
    const leaseExpiresAt = status === 'CLAIMED' ? new Date(now.getTime() + 60 * 1000) : null;

    await manager.query(
      `INSERT INTO zone_entry_assessment_job (
        request_id, status, attempt_count, head_revision, lease_token,
        lease_expires_at, next_attempt_at, deadline_at, created_at, updated_at
      ) VALUES ($1, $2, 0, 1, $3, $4, $5, $6, $7, $8)`,
      [requestId, status, leaseToken, leaseExpiresAt, createdAt, deadlineAt, createdAt, createdAt],
    );
  }

  return { eventId, requestId };
}

// -----------------------------------------------------------------------------
// Test Suite: Mf06 Ingestion Enqueue Integration
// -----------------------------------------------------------------------------

describe('MF06 Ingestion Enqueue Service Integration Tests', () => {
  it('enabled intake without its provider fails unavailable before any raw persistence', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '2',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));
    const service = new AiIngestionService(
      db,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(config, new SchedulingNotificationService(db)),
      config,
      fixedTestClock,
    );
    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [createPersonObservation(7), createZoneEntryObservation(7, infra.region1Id)],
    });
    await assert.rejects(
      service.ingestEvent(payload),
      (error: unknown) =>
        error instanceof PublicHttpException &&
        error.getStatus() === 503 &&
        error.publicPayload.code === 'AI_INGESTION_UNAVAILABLE',
    );
    assert.equal(
      await db.getRepository(AiObservationEventEntity).countBy({ eventId: payload.eventId }),
      0,
    );
  });

  it('Case 1: default OFF executes zero assessment SQL even if assessment tables are missing/renamed', async () => {
    const config = createTestConfig({ MF06_ENQUEUE_ENABLED: 'false' });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(101),
        createZoneEntryObservation(101, infra.region1Id, 1),
      ],
    });

    // Temporarily rename assessment tables to prove default OFF never touches them
    await db.query(
      'ALTER TABLE zone_entry_assessment_job RENAME TO mf06_assessment_job_temp_off_hidden',
    );
    await db.query(
      'ALTER TABLE zone_entry_assessment_request RENAME TO mf06_assessment_request_temp_off_hidden',
    );

    try {
      const service = buildIngestionService({ db, config });
      const result = await service.ingestEvent(payload);

      assert.equal(result.eventId, payload.eventId);
      assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
      assert.deepEqual(result.alertIds, []);
      // Assert no requestIds in public result
      assert.equal((result as unknown as Record<string, unknown>)['requestIds'], undefined);

      const rawCount = await db
        .getRepository(AiObservationEventEntity)
        .countBy({ eventId: payload.eventId });
      assert.equal(rawCount, 1, 'Raw event must be preserved even when assessment is disabled');
    } finally {
      await db.query(
        'ALTER TABLE mf06_assessment_request_temp_off_hidden RENAME TO zone_entry_assessment_request',
      );
      await db.query(
        'ALTER TABLE mf06_assessment_job_temp_off_hidden RENAME TO zone_entry_assessment_job',
      );
    }
  });

  it('Case 2: enabled path with no-alert ZONE policy NONE creates request and PENDING job atomically', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(202),
        createZoneEntryObservation(202, infra.region1Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });
    const result = await service.ingestEvent(payload);

    assert.equal(result.eventId, payload.eventId);
    // ZoneRestrictionPolicy.NONE yields no safety alert candidates
    assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
    assert.deepEqual(result.alertIds, []);
    assert.equal((result as unknown as Record<string, unknown>)['requestIds'], undefined);

    // Verify assessment request
    const request = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneBy({ eventId: payload.eventId });
    assert.ok(request, 'Assessment request must be enqueued');
    assert.equal(request.subjectBindingStatus, 'BOUND');
    assert.equal(request.trackId, 202);
    assert.equal(request.personObservationIndex, 0);
    assert.equal(request.zoneObservationIndex, 1);
    assert.equal(request.siteId, infra.siteId);
    assert.equal(request.cameraId, infra.cameraId);
    assert.equal(request.cameraExternalId, infra.externalId);
    assert.equal(request.regionId, infra.region1Id);
    assert.equal(request.zoneId, infra.zone1Id);
    assert.equal(request.requestedPurpose, 'INITIAL_OBSERVATION_ASSESSMENT');
    assert.equal(request.requestRevision, 1);

    // Verify assessment job
    const job = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: request.requestId });
    assert.ok(job, 'Assessment job must be created atomically');
    assert.equal(job.status, 'PENDING');
    assert.equal(job.attemptCount, 0);
    assert.equal(job.headRevision, 1);
    assert.equal(job.leaseToken, null);
    assert.equal(job.leaseExpiresAt, null);
  });

  it('Case 3: preserves original raw hash, observation indices, camera, and Site context', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(303),
        createZoneEntryObservation(303, infra.region2Id, 1),
      ],
    });
    const expectedHash = computeCanonicalPayloadHash(payload);

    const service = buildIngestionService({ db, config });
    await service.ingestEvent(payload);

    const raw = await db
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: payload.eventId });
    assert.equal(raw.payloadHash, expectedHash);
    assert.equal(raw.cameraExternalId, infra.externalId);
    assert.equal(raw.resolvedCameraId, infra.cameraId);

    const req = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneByOrFail({ eventId: payload.eventId });
    assert.equal(req.payloadHash, expectedHash);
    assert.equal(req.siteId, infra.siteId);
    assert.equal(req.cameraId, infra.cameraId);
    assert.equal(req.regionId, infra.region2Id);
    assert.equal(req.zoneId, infra.zone2Id);
    assert.match(req.bindingHash, /^[0-9a-f]{64}$/);
  });

  it('Case 4: concurrent ingestion of identical payload for same event yields 1 raw, 1 request, 1 job and DUPLICATE_ACCEPTED', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(404),
        createZoneEntryObservation(404, infra.region1Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });
    const [res1, res2] = await Promise.all([
      service.ingestEvent(payload),
      service.ingestEvent(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.equal(statuses[0], 'DUPLICATE_ACCEPTED');
    assert.equal(statuses[1], EventProcessingStatus.SKIPPED_NO_CANDIDATE);

    const rawCount = await db
      .getRepository(AiObservationEventEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(rawCount, 1, 'Exactly one raw event row must be persisted');

    const reqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(reqCount, 1, 'Exactly one assessment request must exist');

    const req = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneByOrFail({ eventId: payload.eventId });
    const job = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: req.requestId });
    assert.ok(job, 'Exactly one job must exist for the request');
  });

  it('Case 5: changed payload hash for existing eventId throws 409 conflict and prevents rewrite', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const sharedEventId = randomUUID();
    const payloadA = createSyntheticPayload({
      eventId: sharedEventId,
      externalId: infra.externalId,
      observations: [
        createPersonObservation(501),
        createZoneEntryObservation(501, infra.region1Id, 1),
      ],
    });

    const payloadB = createSyntheticPayload({
      eventId: sharedEventId,
      externalId: infra.externalId,
      observations: [
        createPersonObservation(502),
        createZoneEntryObservation(502, infra.region1Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });
    await service.ingestEvent(payloadA);

    await assert.rejects(
      async () => await service.ingestEvent(payloadB),
      (err: unknown) => {
        assert.ok(err instanceof PublicHttpException);
        assert.equal(err.getStatus(), HttpStatus.CONFLICT);
        assert.equal(err.publicPayload.code, 'AI_EVENT_ID_CONFLICT');
        return true;
      },
    );

    const raw = await db
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: sharedEventId });
    assert.equal(
      raw.payloadHash,
      computeCanonicalPayloadHash(payloadA),
      'Original payload hash must remain unchanged',
    );

    const req = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneByOrFail({ eventId: sharedEventId });
    assert.equal(req.trackId, 501, 'Original request trackId must not be overwritten');
  });

  it('Case 6: multi-ZONE entries in a single event produce distinct requests and jobs', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(601),
        createZoneEntryObservation(601, infra.region1Id, 1),
        createPersonObservation(602),
        createZoneEntryObservation(602, infra.region2Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });
    const result = await service.ingestEvent(payload);
    assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);

    const requests = await db.getRepository(ZoneEntryAssessmentRequestEntity).find({
      where: { eventId: payload.eventId },
      order: { zoneObservationIndex: 'ASC' },
    });
    assert.equal(requests.length, 2, 'Two distinct requests must be created');

    assert.equal(requests[0]!.zoneObservationIndex, 1);
    assert.equal(requests[0]!.personObservationIndex, 0);
    assert.equal(requests[0]!.regionId, infra.region1Id);
    assert.equal(requests[0]!.zoneId, infra.zone1Id);

    assert.equal(requests[1]!.zoneObservationIndex, 3);
    assert.equal(requests[1]!.personObservationIndex, 2);
    assert.equal(requests[1]!.regionId, infra.region2Id);
    assert.equal(requests[1]!.zoneId, infra.zone2Id);

    const job1 = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: requests[0]!.requestId });
    const job2 = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: requests[1]!.requestId });
    assert.ok(job1 && job2, 'Both assessment jobs must exist');
  });

  it('Case 7: ineligible events (unconfigured region, clock skew, unknown camera) create zero requests or jobs', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));
    const service = buildIngestionService({ db, config });

    // 7a: Unconfigured region
    const unconfiguredRegionId = randomUUID();
    const badRegionPayload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(701),
        createZoneEntryObservation(701, unconfiguredRegionId, 1),
      ],
    });
    const badRegionResult = await service.ingestEvent(badRegionPayload);
    assert.equal(badRegionResult.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
    const badRegionReqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: badRegionPayload.eventId });
    assert.equal(badRegionReqCount, 0, 'Unconfigured region must produce zero assessment requests');

    // 7b: Clock skew
    const skewPayload = createSyntheticPayload({
      externalId: infra.externalId,
      capturedAt: '2026-10-10T10:00:00.000Z', // 2 hours in the past (> 300s)
      observations: [
        createPersonObservation(702),
        createZoneEntryObservation(702, infra.region1Id, 1),
      ],
    });
    const skewResult = await service.ingestEvent(skewPayload);
    assert.equal(skewResult.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
    const skewReqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: skewPayload.eventId });
    assert.equal(skewReqCount, 0, 'Clock skew event must produce zero assessment requests');

    // 7c: Unknown camera
    const unknownCameraPayload = createSyntheticPayload({
      externalId: `unknown-camera-${randomUUID().slice(0, 8)}`,
      observations: [
        createPersonObservation(703),
        createZoneEntryObservation(703, infra.region1Id, 1),
      ],
    });
    const unknownCamResult = await service.ingestEvent(unknownCameraPayload);
    assert.equal(unknownCamResult.status, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
    const unknownCamReqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: unknownCameraPayload.eventId });
    assert.equal(unknownCamReqCount, 0, 'Unknown camera must produce zero assessment requests');
  });

  it('Case 8: downstream failure after enqueue rolls back raw event, assessment requests, and jobs', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    // Update zone to PROHIBITED_FOR_ALL so that candidateEvaluator produces a violation candidate
    await db
      .getRepository(ZoneEntity)
      .update(infra.zone1Id, { restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL });

    // Mock durable grouping service that throws during groupCandidate
    class ThrowingGroupingService extends DurableGroupingService {
      override async groupCandidate(): Promise<never> {
        throw new Error('SIMULATED_GROUPING_PERSISTENCE_FAILURE');
      }
    }

    const failingGrouping = new ThrowingGroupingService(
      config,
      new SchedulingNotificationService(db),
    );
    let enqueuedCount = 0;
    class RecordingEnqueue extends Mf06IngestionEnqueueService {
      override async enqueueFresh(manager: EntityManager, event: AiObservationEventEntity) {
        const ids = await super.enqueueFresh(manager, event);
        enqueuedCount = ids.length;
        return ids;
      }
    }
    const service = buildIngestionService({
      db,
      config,
      groupingService: failingGrouping,
      enqueueService: new RecordingEnqueue(db, config),
    });

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(801),
        createZoneEntryObservation(801, infra.region1Id, 1),
      ],
    });

    await assert.rejects(async () => await service.ingestEvent(payload));
    assert.equal(
      enqueuedCount,
      1,
      'A request was actually inserted before the forced grouping failure',
    );

    // Entire transaction must roll back: raw event, requests, jobs must be 0
    const rawCount = await db
      .getRepository(AiObservationEventEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(rawCount, 0, 'Raw event must be rolled back on downstream failure');

    const reqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(reqCount, 0, 'Assessment request must be rolled back on downstream failure');

    // Restore zone restriction policy
    await db
      .getRepository(ZoneEntity)
      .update(infra.zone1Id, { restrictionPolicy: ZoneRestrictionPolicy.NONE });
  });

  it('Case 9: strict outstanding capacity cap rejects entire multi-entry event and retains prior rows', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '2',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    // Pre-populate 1 job so current outstanding count = 1
    const prior = await db.transaction((manager) =>
      insertPriorJob(manager, infra, 'PENDING', { isExpired: false }),
    );

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(901),
        createZoneEntryObservation(901, infra.region1Id, 1),
        createPersonObservation(902),
        createZoneEntryObservation(902, infra.region2Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });

    // With 2 entries, outstanding would become 1 + 2 = 3 > cap(2) -> reject entire event
    await assert.rejects(
      async () => await service.ingestEvent(payload),
      (err: unknown) => {
        assert.ok(err instanceof PublicHttpException);
        assert.equal(err.getStatus(), HttpStatus.SERVICE_UNAVAILABLE);
        assert.equal(err.publicPayload.code, 'AI_INGESTION_UNAVAILABLE');
        return true;
      },
    );

    // Verify rejected event left no traces
    const rawCount = await db
      .getRepository(AiObservationEventEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(rawCount, 0, 'Rejected multi-entry event raw record must be rolled back');

    const reqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: payload.eventId });
    assert.equal(reqCount, 0, 'Rejected multi-entry requests must be rolled back');

    // Verify prior job and request remain intact
    const priorJob = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: prior.requestId });
    assert.ok(priorJob, 'Prior job must be retained');
  });

  it('Case 10: outstanding capacity counts expired PENDING and CLAIMED jobs without purging them', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '2',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    // Pre-populate 1 expired PENDING and 1 expired CLAIMED job (total outstanding = 2)
    const priorPending = await db.transaction((manager) =>
      insertPriorJob(manager, infra, 'PENDING', { isExpired: true, referenceNow: fixedTestNow }),
    );
    const priorClaimed = await db.transaction((manager) =>
      insertPriorJob(manager, infra, 'CLAIMED', { isExpired: true, referenceNow: fixedTestNow }),
    );

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(1001),
        createZoneEntryObservation(1001, infra.region1Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });

    // With 2 existing expired nonterminal jobs, capacity is already reached (2 >= cap 2)
    await assert.rejects(
      async () => await service.ingestEvent(payload),
      (err: unknown) => {
        assert.ok(err instanceof PublicHttpException);
        assert.equal(err.getStatus(), HttpStatus.SERVICE_UNAVAILABLE);
        assert.equal(err.publicPayload.code, 'AI_INGESTION_UNAVAILABLE');
        return true;
      },
    );

    // Verify expired jobs are NOT purged
    const pendingExists = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: priorPending.requestId });
    const claimedExists = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: priorClaimed.requestId });
    assert.ok(pendingExists && claimedExists, 'Expired nonterminal jobs must remain in database');
  });

  it('Case 11: bounded contention test holding advisory xact lock in documented namespace', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const blockerRunner = db.createQueryRunner();
    await blockerRunner.connect();
    await blockerRunner.startTransaction();

    try {
      // Hold advisory transaction lock on documented admission namespace
      await blockerRunner.query(
        'SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || $1))',
        [':mf06-enqueue-v1'],
      );

      const payload = createSyntheticPayload({
        externalId: infra.externalId,
        observations: [
          createPersonObservation(1101),
          createZoneEntryObservation(1101, infra.region1Id, 1),
        ],
      });

      const service = buildIngestionService({ db, config });

      // Ingestion must fail immediately with admission contention
      await assert.rejects(
        async () => await service.ingestEvent(payload),
        (err: unknown) => {
          assert.ok(err instanceof PublicHttpException);
          assert.equal(err.getStatus(), HttpStatus.SERVICE_UNAVAILABLE);
          assert.equal(err.publicPayload.code, 'AI_INGESTION_UNAVAILABLE');
          return true;
        },
      );

      const rawCount = await db
        .getRepository(AiObservationEventEntity)
        .countBy({ eventId: payload.eventId });
      assert.equal(rawCount, 0, 'Advisory contention failure must roll back raw event');
    } finally {
      // Release advisory lock by ending blocker transaction
      await blockerRunner.rollbackTransaction();
      await blockerRunner.release();
    }

    // Now re-attempt with new payload after lock release: must succeed
    const unblockedPayload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(1102),
        createZoneEntryObservation(1102, infra.region1Id, 1),
      ],
    });
    const service = buildIngestionService({ db, config });
    const result = await service.ingestEvent(unblockedPayload);
    assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);

    const reqCount = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .countBy({ eventId: unblockedPayload.eventId });
    assert.equal(reqCount, 1, 'Event after lock release must enqueue successfully');
  });

  it('Case 12: concurrent capacity with cap = 1 strictly prevents exceeding capacity', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '1',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    const payload1 = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(1201),
        createZoneEntryObservation(1201, infra.region1Id, 1),
      ],
    });

    const payload2 = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(1202),
        createZoneEntryObservation(1202, infra.region1Id, 1),
      ],
    });

    const service = buildIngestionService({ db, config });
    const outcomes = await Promise.allSettled([
      service.ingestEvent(payload1),
      service.ingestEvent(payload2),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent event must succeed under cap = 1');
    assert.equal(rejected.length, 1, 'Other concurrent event must be rejected');

    const err = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(err instanceof PublicHttpException);
    assert.equal(err.getStatus(), HttpStatus.SERVICE_UNAVAILABLE);
    assert.equal(err.publicPayload.code, 'AI_INGESTION_UNAVAILABLE');

    // Verify exactly 1 job in total
    const [{ total: totalJobs }] = await db.query(
      "SELECT count(*)::integer AS total FROM zone_entry_assessment_job WHERE status IN ('PENDING','CLAIMED')",
    );
    assert.equal(totalJobs, 1, 'Total jobs in database must never exceed cap 1');
  });

  it('Case 13: Camera reassignment while paused after locked first resolve waits, then initial context/request old Site preserved', async () => {
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
    });
    const infra = await db.transaction((manager) => setupInfrastructure(manager));

    let cameraResolvedTrigger: (() => void) | null = null;
    const cameraResolvedPromise = new Promise<void>((resolve) => {
      cameraResolvedTrigger = resolve;
    });

    let resumeTrigger!: () => void;
    const resumePromise = new Promise<void>((resolve) => {
      resumeTrigger = resolve;
    });

    class PausingObservationContextResolver extends ObservationContextResolverService {
      override async resolveCamera(
        manager: EntityManager,
        cameraExternalId: string,
        lockForAssessment = false,
      ): Promise<CameraEntity | undefined> {
        const result = await super.resolveCamera(manager, cameraExternalId, lockForAssessment);
        if (cameraResolvedTrigger) {
          cameraResolvedTrigger();
          cameraResolvedTrigger = null;
        }
        await resumePromise;
        return result;
      }
    }

    const pausingResolver = new PausingObservationContextResolver();
    const service = buildIngestionService({
      db,
      config,
      contextResolver: pausingResolver,
    });

    const payload = createSyntheticPayload({
      externalId: infra.externalId,
      observations: [
        createPersonObservation(1301),
        createZoneEntryObservation(1301, infra.region1Id, 1),
      ],
    });

    // 1. Start ingestion in background (will pause after resolveCamera holds FOR SHARE lock)
    const ingestionPromise = service.ingestEvent(payload);

    // 2. Wait until ingestion has resolved camera and holds FOR SHARE lock
    await cameraResolvedPromise;

    // 3. Attempt concurrent camera reassignment in a separate connection
    const updateRunner = db.createQueryRunner();
    await updateRunner.connect();

    let updateCompleted = false;
    const updatePromise = updateRunner
      .query('UPDATE camera SET site_id = $1 WHERE id = $2', [infra.site2Id, infra.cameraId])
      .then(() => {
        updateCompleted = true;
      });

    // 4. Verify without arbitrary timers: check pg_stat_activity / pg_blocking_pids that UPDATE is blocked
    let wasBlocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.query(
        `SELECT pid, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
         WHERE query LIKE '%UPDATE camera SET site_id%'
           AND pid <> pg_backend_pid()`,
      );
      if (
        Array.isArray(rows) &&
        rows.length > 0 &&
        Array.isArray(rows[0].blockers) &&
        rows[0].blockers.length > 0
      ) {
        wasBlocked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    try {
      assert.ok(wasBlocked, 'Concurrent camera UPDATE must be blocked by FOR SHARE row lock');
      assert.equal(updateCompleted, false, 'UPDATE must not complete while lock is held');

      // 5. Unpause ingestion to let it complete and commit with initial site context
      if (resumeTrigger) {
        resumeTrigger();
      }
      const ingestionResult = await ingestionPromise;
      assert.equal(ingestionResult.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);

      // 6. Wait for unblocked UPDATE to complete
    } finally {
      resumeTrigger();
      await ingestionPromise.catch(() => undefined);
      await updatePromise;
      await updateRunner.release();
    }

    // 7. Verify assessment request preserved the initial context (infra.siteId, NOT site2Id)
    const req = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneByOrFail({ eventId: payload.eventId });
    assert.equal(
      req.siteId,
      infra.siteId,
      'Assessment request must preserve initial siteId resolved under lock',
    );
  });

  it('Case 14: actual AppModule HTTP wires the default-gated provider without any model or identity resolver', async () => {
    const owned = createIsolatedTestDatabase();
    await owned.initialize();
    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '2',
      SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-mf06-ingestion-service-token',
    });
    const fixture = await owned.dataSource.transaction(setupInfrastructure);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(owned.dataSource)
      .overrideProvider(DataSource)
      .useValue(owned.dataSource)
      .compile();
    const app = module.createNestApplication<NestExpressApplication>({ logger: false });
    try {
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const payload = createSyntheticPayload({
        externalId: fixture.externalId,
        capturedAt: new Date().toISOString(),
        observations: [
          createPersonObservation(1401),
          createZoneEntryObservation(1401, fixture.region1Id, 1),
        ],
      });
      const post = (body: unknown, token?: string) =>
        fetch(`${base}/api/v1/integrations/ai/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
      assert.equal((await post(payload)).status, 401);
      assert.equal(await owned.dataSource.getRepository(AiObservationEventEntity).count(), 0);
      const token = config.getOrThrow('SMARTSITE_AI_SERVICE_TOKEN', { infer: true });
      const first = await post(payload, token);
      assert.equal(first.status, 202);
      assert.deepEqual(await first.json(), {
        eventId: payload.eventId,
        status: 'SKIPPED_NO_CANDIDATE',
        alertIds: [],
      });
      const replay = await post(payload, token);
      assert.equal(replay.status, 202);
      assert.equal(((await replay.json()) as { status: string }).status, 'DUPLICATE_ACCEPTED');
      assert.equal((await post({ ...payload, streamSessionId: randomUUID() }, token)).status, 409);
      const overCapacity = {
        ...payload,
        eventId: randomUUID(),
        observations: [
          ...payload.observations,
          createZoneEntryObservation(1401, fixture.region1Id, 1),
        ],
      };
      const refused = await post(overCapacity, token);
      assert.equal(refused.status, 503);
      const failure = (await refused.json()) as { code: string };
      assert.equal(failure.code, 'AI_INGESTION_UNAVAILABLE');
      assert.equal(
        await owned.dataSource
          .getRepository(AiObservationEventEntity)
          .countBy({ eventId: overCapacity.eventId }),
        0,
      );
      assert.equal(
        await owned.dataSource.getRepository(ZoneEntryAssessmentRequestEntity).count(),
        1,
      );
      assert.equal(await owned.dataSource.getRepository(ZoneEntryAssessmentJobEntity).count(), 1);
    } finally {
      await app.close();
      await owned.dispose();
    }
  });
});
