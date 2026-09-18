import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
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
} from '../../src/database/entities/index.js';
import dataSource from '../../src/database/typeorm.data-source.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from '../../src/modules/zones/zone-authorization.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { isEventIdConflict } from '../../src/integrations/ai/typeorm-error.js';

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
      new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
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

test('AiIngestionService: retry with same eventId but changed payload throws 409 ConflictException in real PostgreSQL', async () => {
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
    const groupingService = new DurableGroupingService();
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
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
        assert.ok(err instanceof ConflictException);
        const res = (err as ConflictException).getResponse() as Record<string, unknown>;
        assert.ok(
          typeof res['message'] === 'string' &&
            res['message'].includes('already exists with a different payload hash'),
        );
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

test('AiIngestionService: other named unique violation in real PostgreSQL is not classified as duplicate and is rethrown', async () => {
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
    const groupingService = new DurableGroupingService();

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
    );

    await assert.rejects(
      async () => {
        await failingService.ingestEvent(createSampleEvent());
      },
      (err: unknown) => {
        assert.equal(err, siteUniqueError);
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
      new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
    );

    const eventId = randomUUID();
    const payload = createSampleEvent({
      eventId,
      cameraExternalId,
      observations: [
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
  });
});

test('AiIngestionService: unknown camera persists raw event with null resolvedCameraId FK in real PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const contextResolver = new ObservationContextResolverService();
    const zoneAuth = new ZoneAuthorizationService();
    const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
    const groupingService = new DurableGroupingService();
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
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
      new DurableGroupingService(),
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
    assert.equal(
      await source.getRepository(SafetyAlertEntity).countBy({ siteId }),
      0,
    );
    assert.equal(
      await source.getRepository(AlertDetectionMappingEntity).countBy({ eventId }),
      0,
    );
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
      new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 }),
    );
    const service = new AiIngestionService(
      source,
      contextResolver,
      candidateEvaluator,
      groupingService,
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
