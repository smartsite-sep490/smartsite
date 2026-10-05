import { createTestConfig } from '../support/config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { DataSource, QueryFailedError } from 'typeorm';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  AlertType,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  SafetyAlertEntity,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  ZoneEntryDecisionEntity,
} from '../../src/database/entities/index.js';
import dataSource from '../support/test-data-source.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from '../../src/modules/zones/zone-authorization.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { isEventIdConflict } from '../../src/integrations/ai/typeorm-error.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  return await fn(dataSource);
}

after(async () => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
});

function createSampleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    schemaVersion: '1.0.0',
    cameraExternalId: 'CAM-DEFAULT',
    streamSessionId: randomUUID(),
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 1920, height: 1080 },
    observations: [
      {
        type: 'PERSON',
        trackId: 101,
        confidence: 0.95,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [],
    ...overrides,
  };
}

test('conflicting identity candidates preserve raw evidence without selecting a Worker in PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteId = randomUUID();
    const cameraId = randomUUID();
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const cameraExternalId = `CAM-IDENTITY-${randomUUID()}`;
    await source.getRepository(SiteEntity).save({
      id: siteId,
      code: `SITE-${randomUUID()}`,
      name: 'Synthetic conflicting identity site',
    });
    await source.getRepository(CameraEntity).save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Synthetic identity camera',
      status: CameraStatus.ACTIVE,
    });
    await source.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: `ZONE-${randomUUID()}`,
      name: 'Synthetic auth-required zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: ['HARD_HAT'],
    });
    await source.getRepository(CameraObservationRegionEntity).save({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });
    const service = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(createTestConfig()),
      createTestConfig(),
    );
    const identities = [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 101,
        status: 'CANDIDATE',
        candidateWorkerId: 'SYNTHETIC-A',
        similarityScore: 0.81,
        qualityScore: 0.91,
      },
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 101,
        status: 'CANDIDATE',
        candidateWorkerId: 'SYNTHETIC-B',
        similarityScore: 0.82,
        qualityScore: 0.92,
      },
    ];
    for (const ordered of [identities, [...identities].reverse()]) {
      const eventId = randomUUID();
      const payload = createSampleEvent({
        eventId,
        cameraExternalId,
        observations: [
          { type: 'PERSON', trackId: 101, confidence: 0.95 },
          ...ordered,
          {
            type: 'PPE',
            trackId: 101,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId,
            geometryVersion: 1,
            confidence: 0.9,
          },
          { type: 'ZONE_ENTRY', trackId: 101, regionId, geometryVersion: 1, confidence: 0.9 },
        ],
      });
      const result = await service.ingestEvent(payload);
      assert.equal(result.status, EventProcessingStatus.PROCESSED);
      assert.equal(result.alertIds.length, 2);
      for (const alertId of result.alertIds) {
        const alert = await source
          .getRepository(SafetyAlertEntity)
          .findOneByOrFail({ id: alertId });
        assert.equal(alert.candidateWorkerId, null);
        assert.equal(alert.identitySimilarityScore, null);
        assert.equal(alert.identityQualityScore, null);
      }
      const decision = await source
        .getRepository(ZoneEntryDecisionEntity)
        .findOneByOrFail({ eventId });
      assert.equal(decision.status, 'UNAVAILABLE');
      assert.equal(decision.candidateWorkerId, null);
      assert.equal(decision.workerId, null);
      const raw = await source.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId });
      assert.deepEqual(raw.rawPayload, payload);
      const originalHash = raw.payloadHash;
      const retry = await service.ingestEvent(payload);
      assert.equal(retry.status, 'DUPLICATE_ACCEPTED');
      assert.deepEqual(retry.alertIds, []);
      const rawAfter = await source
        .getRepository(AiObservationEventEntity)
        .findOneByOrFail({ eventId });
      assert.equal(rawAfter.payloadHash, originalHash);
      assert.deepEqual(rawAfter.rawPayload, payload);
      assert.equal(await source.getRepository(AlertDetectionMappingEntity).countBy({ eventId }), 2);
    }
  });
});

test('AiIngestionService: 5 concurrent identical retries in real PostgreSQL result in exactly 1 PROCESSED and 4 DUPLICATE_ACCEPTED with no alert side effect', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const cameraRepo = source.getRepository(CameraEntity);
    const zoneRepo = source.getRepository(ZoneEntity);
    const regionRepo = source.getRepository(CameraObservationRegionEntity);

    const siteId = randomUUID();
    const cameraId = randomUUID();
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const cameraExternalId = `CAM-CONCUR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await siteRepo.save({
      id: siteId,
      code: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Concurrent Ingestion Site',
    });

    await cameraRepo.save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Concurrent Test Camera',
      status: CameraStatus.ACTIVE,
    });

    await zoneRepo.save({
      id: zoneId,
      siteId,
      code: `ZONE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Concurrent Test Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT'],
    });

    await regionRepo.save({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });

    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(
      createTestConfig({ ALERT_COOLDOWN_SECONDS: String(60) }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const sharedEventId = randomUUID();
    const payload = createSampleEvent({
      eventId: sharedEventId,
      cameraExternalId,
      observations: [
        {
          type: 'PPE',
          trackId: 101,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId,
          geometryVersion: 1,
          confidence: 0.98,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });

    // Fire 5 identical requests concurrently
    const tasks = Array.from({ length: 5 }).map(() => service.ingestEvent(payload));
    const results = await Promise.all(tasks);

    // Exactly 1 request wins and becomes PROCESSED; the other 4 catch duplicate PK and become DUPLICATE_ACCEPTED
    const processedCount = results.filter(
      (r) => r.status === EventProcessingStatus.PROCESSED,
    ).length;
    const duplicateCount = results.filter((r) => r.status === 'DUPLICATE_ACCEPTED').length;

    assert.equal(processedCount, 1);
    assert.equal(duplicateCount, 4);

    // Verify all DUPLICATE_ACCEPTED responses have empty alertIds
    for (const dup of results.filter((r) => r.status === 'DUPLICATE_ACCEPTED')) {
      assert.deepEqual(dup.alertIds, []);
    }

    // Real DB assertions:
    // Exactly 1 raw event exists
    const rawEvents = await source
      .getRepository(AiObservationEventEntity)
      .find({ where: { eventId: sharedEventId } });
    assert.equal(rawEvents.length, 1);
    assert.equal(rawEvents[0]!.processingStatus, EventProcessingStatus.PROCESSED);
    assert.equal(rawEvents[0]!.resolvedCameraId, cameraId);

    // Exactly 1 mapping exists
    const mappings = await source
      .getRepository(AlertDetectionMappingEntity)
      .find({ where: { eventId: sharedEventId } });
    assert.equal(mappings.length, 1);

    // Exactly 1 alert was created
    const alerts = await source.getRepository(SafetyAlertEntity).find({
      where: { siteId, alertType: AlertType.PPE_VIOLATION },
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.detectionCount, 1);
  });
});

test('AiIngestionService: retry with same eventId but changed payload returns public 409 in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const cameraRepo = source.getRepository(CameraEntity);

    const siteId = randomUUID();
    const cameraId = randomUUID();
    const cameraExternalId = `CAM-CONFLICT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await siteRepo.save({
      id: siteId,
      code: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Conflict Test Site',
    });

    await cameraRepo.save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Conflict Test Camera',
      status: CameraStatus.ACTIVE,
    });

    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(createTestConfig());
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const sharedEventId = randomUUID();
    const payloadOriginal = createSampleEvent({
      eventId: sharedEventId,
      cameraExternalId,
    });

    // First ingestion succeeds
    const result1 = await service.ingestEvent(payloadOriginal);
    assert.equal(result1.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);

    const initialRaw = await source
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: sharedEventId });
    assert.ok(initialRaw);
    const originalHash = initialRaw.payloadHash;

    // Second ingestion with modified payload (e.g. different frame dimensions or observations)
    const payloadModified = createSampleEvent({
      eventId: sharedEventId,
      cameraExternalId,
      frameDimensions: { width: 3840, height: 2160 }, // Changed dimensions -> different hash!
    });

    await assert.rejects(
      async () => {
        await service.ingestEvent(payloadModified);
      },
      (err: unknown) => {
        assert.ok(err instanceof PublicHttpException);
        assert.equal(err.getStatus(), 409);
        const res = err.getResponse() as Record<string, unknown>;
        assert.equal(res['code'], 'AI_EVENT_ID_CONFLICT');
        assert.equal(res['message'], 'Event ID already exists with a different payload');
        return true;
      },
    );

    // Verify DB still holds original uncorrupted row
    const afterRaw = await source
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: sharedEventId });
    assert.ok(afterRaw);
    assert.equal(afterRaw.payloadHash, originalHash);
    assert.equal(
      (afterRaw.rawPayload as Record<string, unknown> & { frameDimensions: { width: number } })
        .frameDimensions.width,
      1920,
    );
  });
});

test('AiIngestionService: other named unique violation is not classified as duplicate and is sanitized', async () => {
  await withDataSource(async (source) => {
    // 1. Prove that PostgreSQL throws QueryFailedError with 23505 and uq_site_code for duplicate site code
    const siteRepo = source.getRepository(SiteEntity);
    const sharedCode = `SITE-UQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await siteRepo.save({
      id: randomUUID(),
      code: sharedCode,
      name: 'Unique Code Site 1',
    });

    let siteUniqueError: unknown;
    try {
      await siteRepo.save({
        id: randomUUID(),
        code: sharedCode,
        name: 'Unique Code Site 2',
      });
    } catch (err) {
      siteUniqueError = err;
    }

    assert.ok(siteUniqueError instanceof QueryFailedError);
    // Classifier returns false for uq_site_code
    assert.equal(isEventIdConflict(siteUniqueError), false);

    // 2. Prove that if an unrelated unique violation happens during service execution, it is rethrown
    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(createTestConfig());

    // Force an unrelated unique violation inside the transaction
    const failingService = new AiIngestionService(
      {
        ...source,
        transaction: async () => {
          throw siteUniqueError;
        },
      } as unknown as DataSource,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    await assert.rejects(
      async () => {
        await failingService.ingestEvent(createSampleEvent());
      },
      (err: unknown) => {
        assert.ok(err instanceof PublicHttpException);
        assert.equal(err.getStatus(), 503);
        const response = JSON.stringify(err.getResponse());
        assert.match(response, /AI_INGESTION_UNAVAILABLE/);
        assert.doesNotMatch(response, /INSERT INTO|Unique Code Site|SITE-UQ/);
        return true;
      },
    );
  });
});

test('AiIngestionService: actionable event creates AlertDetectionMapping and persists raw event in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const cameraRepo = source.getRepository(CameraEntity);
    const zoneRepo = source.getRepository(ZoneEntity);
    const regionRepo = source.getRepository(CameraObservationRegionEntity);

    const siteId = randomUUID();
    const cameraId = randomUUID();
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const cameraExternalId = `CAM-ACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await siteRepo.save({
      id: siteId,
      code: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Actionable Ingestion Site',
    });

    await cameraRepo.save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Actionable Test Camera',
      status: CameraStatus.ACTIVE,
    });

    await zoneRepo.save({
      id: zoneId,
      siteId,
      code: `ZONE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Actionable Test Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT'],
    });

    await regionRepo.save({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });

    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(
      createTestConfig({ ALERT_COOLDOWN_SECONDS: String(60) }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const eventId = randomUUID();
    const candidateWorkerIdAtStorageBoundary = 'W'.repeat(128);
    const payload = createSampleEvent({
      eventId,
      cameraExternalId,
      observations: [
        {
          type: 'PERSON',
          trackId: 201,
          confidence: 0.95,
          boundingBox: {
            x1: 0.15,
            y1: 0.15,
            x2: 0.45,
            y2: 0.85,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          type: 'PPE',
          trackId: 201,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId,
          geometryVersion: 1,
          confidence: 0.96,
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
          trackId: 201,
          status: 'CANDIDATE',
          candidateWorkerId: candidateWorkerIdAtStorageBoundary,
          similarityScore: 0.93,
        },
      ],
    });

    const result = await service.ingestEvent(payload);
    assert.equal(result.status, EventProcessingStatus.PROCESSED);
    assert.equal(result.alertIds.length, 1);

    const alertId = result.alertIds[0]!;

    // Verify raw event in real PostgreSQL
    const raw = await source.getRepository(AiObservationEventEntity).findOneBy({ eventId });
    assert.ok(raw);
    assert.equal(raw.resolvedCameraId, cameraId);
    assert.equal(raw.processingStatus, EventProcessingStatus.PROCESSED);
    assert.equal(raw.processingNote, null);

    // Verify AlertDetectionMapping in real PostgreSQL
    const mapping = await source
      .getRepository(AlertDetectionMappingEntity)
      .findOneBy({ alertId, eventId });
    assert.ok(mapping);
    assert.equal(mapping.alertId, alertId);
    assert.equal(mapping.eventId, eventId);

    // Verify SafetyAlert in real PostgreSQL
    const alert = await source.getRepository(SafetyAlertEntity).findOneBy({ id: alertId });
    assert.ok(alert);
    assert.equal(alert.siteId, siteId);
    assert.equal(alert.alertType, AlertType.PPE_VIOLATION);
    assert.equal(alert.candidateSubtype, 'PPE_HARD_HAT_MISSING');
    assert.equal(alert.candidateWorkerId, candidateWorkerIdAtStorageBoundary);
  });
});

test('AiIngestionService: unknown camera persists raw event with null resolvedCameraId FK in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(createTestConfig());
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const unknownExternalId = `CAM-NONEXISTENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const eventId = randomUUID();
    const payload = createSampleEvent({
      eventId,
      cameraExternalId: unknownExternalId,
    });

    const result = await service.ingestEvent(payload);
    assert.equal(result.status, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
    assert.deepEqual(result.alertIds, []);

    // Verify in real PostgreSQL: nullable foreign key resolved_camera_id is NULL
    const raw = await source.getRepository(AiObservationEventEntity).findOneBy({ eventId });
    assert.ok(raw);
    assert.equal(raw.cameraExternalId, unknownExternalId);
    assert.equal(raw.resolvedCameraId, null);
    assert.equal(raw.processingStatus, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
    assert.equal(raw.processingNote, 'Camera external ID not found or inactive');

    // No alerts or mappings
    const mappings = await source
      .getRepository(AlertDetectionMappingEntity)
      .find({ where: { eventId } });
    assert.equal(mappings.length, 0);
  });
});

test('AiIngestionService: inactive camera preserves raw PPE event without creating an alert in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteId = randomUUID();
    const cameraId = randomUUID();
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const cameraExternalId = `CAM-INACTIVE-${randomUUID()}`;

    await source.getRepository(SiteEntity).save({
      id: siteId,
      code: `SITE-${randomUUID()}`,
      name: 'Inactive Camera Site',
    });
    await source.getRepository(CameraEntity).save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Inactive Test Camera',
      status: CameraStatus.INACTIVE,
    });
    await source.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: `ZONE-${randomUUID()}`,
      name: 'PPE Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT'],
    });
    await source.getRepository(CameraObservationRegionEntity).save({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });

    const service = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(new ZoneAuthorizationService()),
      new DurableGroupingService(createTestConfig()),
      createTestConfig(),
    );
    const eventId = randomUUID();
    const result = await service.ingestEvent(
      createSampleEvent({
        eventId,
        cameraExternalId,
        observations: [
          {
            type: 'PPE',
            trackId: 101,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId,
            geometryVersion: 1,
          },
        ],
      }),
    );

    assert.equal(result.status, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
    assert.deepEqual(result.alertIds, []);
    const raw = await source.getRepository(AiObservationEventEntity).findOneBy({ eventId });
    assert.ok(raw);
    assert.equal(raw.processingStatus, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
    assert.equal(raw.resolvedCameraId, null);
    assert.equal(raw.cameraExternalId, cameraExternalId);
    assert.equal(await source.getRepository(SafetyAlertEntity).countBy({ siteId }), 0);
    assert.equal(await source.getRepository(AlertDetectionMappingEntity).countBy({ eventId }), 0);
  });
});

test('AiIngestionService: mixed observation regions and geometry versions in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const cameraRepo = source.getRepository(CameraEntity);
    const zoneRepo = source.getRepository(ZoneEntity);
    const regionRepo = source.getRepository(CameraObservationRegionEntity);

    const siteId = randomUUID();
    const cameraId = randomUUID();
    const zoneId = randomUUID();
    const region1Id = randomUUID();
    const region2Id = randomUUID();
    const cameraExternalId = `CAM-MIX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await siteRepo.save({
      id: siteId,
      code: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Mixed Test Site',
    });

    await cameraRepo.save({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Mixed Test Camera',
      status: CameraStatus.ACTIVE,
    });

    await zoneRepo.save({
      id: zoneId,
      siteId,
      code: `ZONE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Mixed Test Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    });

    await regionRepo.save({
      id: region1Id,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });

    await regionRepo.save({
      id: region2Id,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 2,
      isActive: true,
      polygon: { type: 'Polygon', coordinates: [] },
    });

    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(
      createTestConfig({ ALERT_COOLDOWN_SECONDS: String(60) }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const eventId = randomUUID();
    const payload = createSampleEvent({
      eventId,
      cameraExternalId,
      observations: [
        {
          type: 'PPE',
          trackId: 101,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId: region1Id,
          geometryVersion: 1,
          confidence: 0.95,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          type: 'PPE',
          trackId: 102,
          ppeItem: 'SAFETY_VEST',
          status: 'MISSING',
          regionId: region2Id,
          geometryVersion: 2,
          confidence: 0.92,
          boundingBox: { x1: 0.5, y1: 0.1, x2: 0.8, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });

    const result = await service.ingestEvent(payload);
    assert.equal(result.status, EventProcessingStatus.PROCESSED);
    assert.equal(result.alertIds.length, 2);

    const mappings = await source
      .getRepository(AlertDetectionMappingEntity)
      .find({ where: { eventId } });
    assert.equal(mappings.length, 2);

    const raw = await source.getRepository(AiObservationEventEntity).findOneBy({ eventId });
    assert.ok(raw);
    assert.equal(raw.processingStatus, EventProcessingStatus.PROCESSED);
  });
});

test('AiIngestionService: zero or duplicate PERSON on track retains alerts with null identity columns and UNAVAILABLE zone decision in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const cameraRepo = source.getRepository(CameraEntity);
    const zoneRepo = source.getRepository(ZoneEntity);
    const regionRepo = source.getRepository(CameraObservationRegionEntity);

    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService(
      createTestConfig({ ALERT_COOLDOWN_SECONDS: String(60) }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
      createTestConfig(),
    );

    const cases = [
      {
        name: 'zero PERSON on track',
        trackId: 301,
        personObservations: [],
      },
      {
        name: 'duplicate PERSON on track',
        trackId: 401,
        personObservations: [
          {
            type: 'PERSON',
            trackId: 401,
            confidence: 0.94,
            boundingBox: {
              x1: 0.1,
              y1: 0.1,
              x2: 0.4,
              y2: 0.8,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
          {
            type: 'PERSON',
            trackId: 401,
            confidence: 0.91,
            boundingBox: {
              x1: 0.12,
              y1: 0.12,
              x2: 0.42,
              y2: 0.82,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
        ],
      },
    ];

    for (const testCase of cases) {
      const siteId = randomUUID();
      const cameraId = randomUUID();
      const zoneId = randomUUID();
      const regionId = randomUUID();
      const cameraExternalId = `CAM-PERSON-TABLE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      await siteRepo.save({
        id: siteId,
        code: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `Person Table Site (${testCase.name})`,
      });

      await cameraRepo.save({
        id: cameraId,
        siteId,
        externalId: cameraExternalId,
        code: cameraExternalId,
        name: `Person Table Camera (${testCase.name})`,
        status: CameraStatus.ACTIVE,
      });

      await zoneRepo.save({
        id: zoneId,
        siteId,
        code: `ZONE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `Person Table Zone (${testCase.name})`,
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
        requiredPpe: ['HARD_HAT'],
      });

      await regionRepo.save({
        id: regionId,
        cameraId,
        zoneId,
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
        polygon: { type: 'Polygon', coordinates: [] },
      });

      const eventId = randomUUID();
      const candidateWorkerId = 'W'.repeat(64);
      const payload = createSampleEvent({
        eventId,
        cameraExternalId,
        observations: [
          ...testCase.personObservations,
          {
            type: 'PPE',
            trackId: testCase.trackId,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId,
            geometryVersion: 1,
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
            type: 'ZONE_ENTRY',
            trackId: testCase.trackId,
            regionId,
            geometryVersion: 1,
            confidence: 0.92,
          },
          {
            type: 'IDENTITY_CANDIDATE',
            trackId: testCase.trackId,
            status: 'CANDIDATE',
            candidateWorkerId,
            similarityScore: 0.93,
            qualityScore: 0.88,
          },
        ],
      });

      const original = structuredClone(payload);
      const expectedHash = computeCanonicalPayloadHash(original);

      const result = await service.ingestEvent(payload);
      assert.equal(result.status, EventProcessingStatus.PROCESSED);
      assert.equal(result.alertIds.length, 2);

      // Assert payload unchanged by ingestion
      assert.deepEqual(payload, original);

      // Assert alerts include exact PPE_VIOLATION and RESTRICTED_ZONE_INTRUSION types with null identity columns
      const alerts = await Promise.all(
        result.alertIds.map((id) =>
          source.getRepository(SafetyAlertEntity).findOneByOrFail({ id }),
        ),
      );
      assert.equal(alerts.length, 2);
      const alertTypes = alerts.map((a) => a.alertType).sort();
      assert.deepEqual(
        alertTypes,
        [AlertType.PPE_VIOLATION, AlertType.RESTRICTED_ZONE_INTRUSION].sort(),
      );
      assert.deepEqual(alerts.map((alert) => alert.candidateSubtype).sort(), [
        'PPE_HARD_HAT_MISSING',
        'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
      ]);
      for (const alert of alerts) {
        assert.equal(alert.candidateWorkerId, null);
        assert.equal(alert.identitySimilarityScore, null);
        assert.equal(alert.identityQualityScore, null);
      }

      // Assert mapping alert IDs equal result IDs
      const mappings = await source
        .getRepository(AlertDetectionMappingEntity)
        .find({ where: { eventId } });
      assert.equal(mappings.length, 2);
      const mappingAlertIds = mappings.map((m) => m.alertId).sort();
      const expectedAlertIds = [...result.alertIds].sort();
      assert.deepEqual(mappingAlertIds, expectedAlertIds);

      // Verify Zone decision recorded as UNAVAILABLE / IDENTITY_UNAVAILABLE
      const decision = await source
        .getRepository(ZoneEntryDecisionEntity)
        .findOneByOrFail({ eventId });
      assert.equal(decision.status, 'UNAVAILABLE');
      assert.equal(decision.reasonCode, 'IDENTITY_UNAVAILABLE');
      assert.equal(decision.candidateWorkerId, null);
      assert.equal(decision.workerId, null);
      assert.equal(decision.trackId, testCase.trackId);

      // Assert raw matches original payload and expected canonical hash
      const raw = await source.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId });
      assert.equal(raw.processingStatus, EventProcessingStatus.PROCESSED);
      assert.equal(raw.processingNote, null);
      assert.equal(raw.payloadHash, expectedHash);
      assert.deepEqual(raw.rawPayload, original);
    }
  });
});
