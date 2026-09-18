import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { computeCanonicalPayloadHash, type ValidationIssue } from '@smartsite/contracts';
import {
  AlertType,
  CameraStatus,
  EventProcessingStatus,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../src/database/entities/enums.js';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../src/database/entities/camera-observation-region.entity.js';
import { ZoneEntity } from '../src/database/entities/zone.entity.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { ObservationContextResolverService } from '../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from '../src/modules/zones/zone-authorization.service.js';
import { AlertCandidateEvaluator } from '../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../src/modules/safety/alerts/durable-grouping.service.js';
import {
  AiIngestionService,
  parseNormalizedCapturedAt,
} from '../src/integrations/ai/ai-ingestion.service.js';
import { AiIngestionController } from '../src/integrations/ai/ai-ingestion.controller.js';

interface MockStore {
  cameras: CameraEntity[];
  regions: CameraObservationRegionEntity[];
  zones: ZoneEntity[];
  rawEvents: AiObservationEventEntity[];
  alerts: SafetyAlertEntity[];
  mappings: AlertDetectionMappingEntity[];
}

function createMockDataSource(store: MockStore): DataSource {
  const manager: Partial<EntityManager> = {
    getRepository<T extends Record<string, unknown>>(target: unknown): Repository<T> {
      if (target === CameraEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              store.cameras.find((c) =>
                Object.entries(criteria).every(
                  ([k, v]) => (c as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        } as unknown as Repository<T>;
      }
      if (target === CameraObservationRegionEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              store.regions.find((r) =>
                Object.entries(criteria).every(
                  ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        } as unknown as Repository<T>;
      }
      if (target === ZoneEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              store.zones.find((z) =>
                Object.entries(criteria).every(
                  ([k, v]) => (z as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        } as unknown as Repository<T>;
      }
      if (target === AiObservationEventEntity) {
        return {
          create: (entity: AiObservationEventEntity) => ({ ...entity }),
          insert: async (entity: AiObservationEventEntity) => {
            store.rawEvents.push(entity);
            return { identifiers: [{ eventId: entity.eventId }] };
          },
        } as unknown as Repository<T>;
      }
      if (target === AlertDetectionMappingEntity) {
        return {
          insert: async (entity: AlertDetectionMappingEntity) => {
            store.mappings.push(entity);
            return { identifiers: [{ alertId: entity.alertId, eventId: entity.eventId }] };
          },
        } as unknown as Repository<T>;
      }
      if (target === SafetyAlertEntity) {
        return {
          create: (entity: SafetyAlertEntity) => ({ ...entity }),
          save: async (entity: SafetyAlertEntity) => {
            store.alerts.push(entity);
            return entity;
          },
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              store.alerts.find((a) =>
                Object.entries(criteria).every(
                  ([k, v]) => (a as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        } as unknown as Repository<T>;
      }
      throw new Error(`Unexpected entity in mock repository: ${String(target)}`);
    },
    query: (async (queryText: string): Promise<unknown> => {
      // Mock pg_advisory_xact_lock
      if (queryText.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: null }];
      }
      return [];
    }) as unknown as EntityManager['query'],
    createQueryBuilder: () => {
      const whereParams: Record<string, unknown> = {};
      const qb: Record<string, unknown> = {
        setLock: () => qb,
        where: (_condition: string, params?: Record<string, unknown>) => {
          if (params) Object.assign(whereParams, params);
          return qb;
        },
        andWhere: (_condition: string, params?: Record<string, unknown>) => {
          if (params) Object.assign(whereParams, params);
          return qb;
        },
        orderBy: () => qb,
        addOrderBy: () => qb,
        limit: () => qb,
        getMany: async () => {
          return store.alerts.filter((a) => {
            if (whereParams['siteId'] && a.siteId !== whereParams['siteId']) return false;
            if (whereParams['groupingKey'] && a.groupingKey !== whereParams['groupingKey'])
              return false;
            return true;
          });
        },
        update: () => qb,
        set: () => qb,
        execute: async () => ({ affected: 1 }),
      };
      return qb as unknown as SelectQueryBuilder<SafetyAlertEntity>;
    },
  };

  return {
    transaction: async <T>(cb: (mgr: EntityManager) => Promise<T>): Promise<T> => {
      return await cb(manager as EntityManager);
    },
  } as unknown as DataSource;
}

const FIXED_NOW = new Date('2026-09-19T12:00:00.000Z');

function createSampleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: '1.0.0',
    cameraExternalId: 'CAM-01',
    streamSessionId: '22222222-2222-4222-8222-222222222222',
    capturedAt: FIXED_NOW.toISOString(),
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

test('AiIngestionService: invalid schema throws BadRequestException with structured issues', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  const invalidPayload = {
    eventId: 'not-a-uuid',
    schemaVersion: '9.9.9',
  };

  await assert.rejects(
    async () => {
      await service.ingestEvent(invalidPayload);
    },
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      const res = err.getResponse() as Record<string, unknown>;
      assert.equal(res['message'], 'Validation failed');
      const issues = res['issues'] as ValidationIssue[];
      assert.ok(Array.isArray(issues));
      assert.ok(issues.length > 0);
      assert.ok(issues.some((i) => i.code === 'SCHEMA_VIOLATION'));
      return true;
    },
  );

  // Schema invalid events must NEVER be persisted to raw events (Spec §15.1)
  assert.equal(store.rawEvents.length, 0);
});

test('AiIngestionService: invalid geometry throws BadRequestException with INVALID_GEOMETRY issues', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  const invalidGeometryPayload = createSampleEvent({
    observations: [
      {
        type: 'PERSON',
        trackId: 101,
        confidence: 0.95,
        boundingBox: { x1: 0.5, y1: 0.1, x2: 0.2, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' }, // x1 > x2!
      },
    ],
  });

  await assert.rejects(
    async () => {
      await service.ingestEvent(invalidGeometryPayload);
    },
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      const res = err.getResponse() as Record<string, unknown>;
      assert.equal(res['message'], 'Validation failed');
      const issues = res['issues'] as ValidationIssue[];
      assert.ok(Array.isArray(issues));
      assert.ok(issues.some((i) => i.code === 'INVALID_GEOMETRY'));
      return true;
    },
  );

  assert.equal(store.rawEvents.length, 0);
});

test('AiIngestionService: clock older than 300s results in SKIPPED_CLOCK_SKEW and raw event is persisted', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  // 301 seconds in the past
  const pastTime = new Date(FIXED_NOW.getTime() - 301 * 1000);
  const payload = createSampleEvent({
    capturedAt: pastTime.toISOString(),
  });

  const result = await service.ingestEvent(payload);

  assert.equal(result.eventId, payload['eventId']);
  assert.equal(result.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.deepEqual(result.alertIds, []);

  // Raw event MUST be persisted with SKIPPED_CLOCK_SKEW
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.eventId, payload['eventId']);
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.ok(store.rawEvents[0]!.payloadHash);
  assert.equal(store.alerts.length, 0);
  assert.equal(store.mappings.length, 0);
});

test('AiIngestionService: clock more than 30s in the future results in SKIPPED_CLOCK_SKEW', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  // 31 seconds in the future
  const futureTime = new Date(FIXED_NOW.getTime() + 31 * 1000);
  const payload = createSampleEvent({
    capturedAt: futureTime.toISOString(),
  });

  const result = await service.ingestEvent(payload);

  assert.equal(result.eventId, payload['eventId']);
  assert.equal(result.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.deepEqual(result.alertIds, []);
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
});

test('AiIngestionService: unknown camera results in SKIPPED_UNKNOWN_CAMERA and persists raw event with resolvedCameraId null', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  const payload = createSampleEvent({ cameraExternalId: 'UNKNOWN-CAM' });
  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
  assert.deepEqual(result.alertIds, []);
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.resolvedCameraId, null);
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
});

test('AiIngestionService: known camera with no violation candidate results in SKIPPED_NO_CANDIDATE', async () => {
  const cameraId = '33333333-3333-4333-8333-333333333333';
  const siteId = '44444444-4444-4444-8444-444444444444';
  const camera: CameraEntity = {
    id: cameraId,
    siteId,
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Gate Camera',
    status: CameraStatus.ACTIVE,
    createdAt: FIXED_NOW,
  };
  const store: MockStore = {
    cameras: [camera],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  // PERSON only observation produces no alert candidates
  const payload = createSampleEvent();
  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
  assert.deepEqual(result.alertIds, []);
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.resolvedCameraId, cameraId);
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
  assert.equal(store.alerts.length, 0);
  assert.equal(store.mappings.length, 0);
});

test('AiIngestionService: valid violation candidate is PROCESSED, groups alert, and creates AlertDetectionMapping', async () => {
  const cameraId = '33333333-3333-4333-8333-333333333333';
  const siteId = '44444444-4444-4444-8444-444444444444';
  const regionId = '55555555-5555-4555-8555-555555555555';
  const zoneId = '66666666-6666-4666-8666-666666666666';

  const zone: ZoneEntity = {
    id: zoneId,
    siteId,
    code: 'ZONE-A',
    name: 'Hard Hat Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT'],
    createdAt: FIXED_NOW,
  };

  const region: CameraObservationRegionEntity = {
    id: regionId,
    cameraId,
    zoneId,
    coordinateSpace: 'NORMALIZED_0_1',
    version: 1,
    isActive: true,
    polygon: { type: 'Polygon', coordinates: [] },
    createdAt: FIXED_NOW,
  };

  const camera: CameraEntity = {
    id: cameraId,
    siteId,
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Gate Camera',
    status: CameraStatus.ACTIVE,
    createdAt: FIXED_NOW,
  };

  const store: MockStore = {
    cameras: [camera],
    regions: [region],
    zones: [zone],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };

  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  const payload = createSampleEvent({
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

  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.PROCESSED);
  assert.equal(result.alertIds.length, 1);

  // Raw event was inserted
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.eventId, payload['eventId']);
  assert.equal(store.rawEvents[0]!.resolvedCameraId, cameraId);
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.PROCESSED);

  // Alert was created/grouped
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0]!.siteId, siteId);
  assert.equal(store.alerts[0]!.alertType, AlertType.PPE_VIOLATION);
  assert.equal(store.alerts[0]!.candidateSubtype, 'PPE_HARD_HAT_MISSING');
  assert.equal(store.alerts[0]!.id, result.alertIds[0]);

  // AlertDetectionMapping was created
  assert.equal(store.mappings.length, 1);
  assert.equal(store.mappings[0]!.alertId, result.alertIds[0]);
  assert.equal(store.mappings[0]!.eventId, payload['eventId'] as string);
});

test('AiIngestionService: clock skew event still records resolvedCameraId when camera is known (Spec §15.2)', async () => {
  const cameraId = '33333333-3333-4333-8333-333333333333';
  const siteId = '44444444-4444-4444-8444-444444444444';
  const camera: CameraEntity = {
    id: cameraId,
    siteId,
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Gate Camera',
    status: CameraStatus.ACTIVE,
    createdAt: FIXED_NOW,
  };
  const store: MockStore = {
    cameras: [camera],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );

  // 400s in the past (clock skew)
  const pastTime = new Date(FIXED_NOW.getTime() - 400 * 1000);
  const payload = createSampleEvent({
    cameraExternalId: 'CAM-01',
    capturedAt: pastTime.toISOString(),
  });

  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.deepEqual(result.alertIds, []);
  assert.equal(store.rawEvents.length, 1);
  assert.equal(store.rawEvents[0]!.resolvedCameraId, cameraId); // Records resolvedCameraId!
  assert.equal(store.rawEvents[0]!.processingStatus, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.equal(store.alerts.length, 0);
});

test('AiIngestionController: delegates ingest to service and returns result', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => FIXED_NOW,
  );
  const controller = new AiIngestionController(service);

  const payload = createSampleEvent({ cameraExternalId: 'UNKNOWN-CAM' });
  const result = await controller.ingest(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA);
});

test('parseNormalizedCapturedAt: normalizes RFC 3339 leap second (:60) to :59 of same second', () => {
  const parsed1 = parseNormalizedCapturedAt('2026-12-31T23:59:60Z');
  assert.ok(parsed1);
  assert.ok(Number.isFinite(parsed1.getTime()));
  assert.equal(parsed1.toISOString(), '2026-12-31T23:59:59.000Z');

  const parsed2 = parseNormalizedCapturedAt('2026-12-31T23:59:60.500Z');
  assert.ok(parsed2);
  assert.ok(Number.isFinite(parsed2.getTime()));
  assert.equal(parsed2.toISOString(), '2026-12-31T23:59:59.500Z');

  const parsed3 = parseNormalizedCapturedAt('2026-12-31T23:59:60+02:00');
  assert.ok(parsed3);
  assert.ok(Number.isFinite(parsed3.getTime()));
  assert.equal(parsed3.toISOString(), '2026-12-31T21:59:59.000Z');

  const normal = parseNormalizedCapturedAt('2026-09-19T12:00:00.000Z');
  assert.ok(normal);
  assert.ok(Number.isFinite(normal.getTime()));
  assert.equal(normal.toISOString(), '2026-09-19T12:00:00.000Z');
});

test('AiIngestionService: bare-hour timezone offsets preserve raw events for ordinary and leap seconds', async () => {
  const now = new Date('2027-01-01T00:00:30.000Z');
  const camera: CameraEntity = {
    id: '33333333-3333-4333-8333-333333333333',
    siteId: '44444444-4444-4444-8444-444444444444',
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Gate Camera',
    status: CameraStatus.ACTIVE,
    createdAt: now,
  };

  for (const capturedAt of ['2026-12-31T23:59:59+00', '2026-12-31T23:59:60+00']) {
    const store: MockStore = {
      cameras: [camera],
      regions: [],
      zones: [],
      rawEvents: [],
      alerts: [],
      mappings: [],
    };
    const service = new AiIngestionService(
      createMockDataSource(store),
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(new ZoneAuthorizationService()),
      new DurableGroupingService(),
      undefined,
      () => now,
    );
    const payload = createSampleEvent({ capturedAt });

    const result = await service.ingestEvent(payload);

    assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
    assert.equal(store.rawEvents.length, 1);
    const saved = store.rawEvents[0]!;
    assert.equal(saved.capturedAt.toISOString(), '2026-12-31T23:59:59.000Z');
    assert.equal((saved.rawPayload as Record<string, unknown>)['capturedAt'], capturedAt);
    assert.equal(saved.payloadHash, computeCanonicalPayloadHash(payload));
    assert.equal(store.alerts.length, 0);
  }
});

test('AiIngestionService: schema-valid but unrepresentable timestamp still preserves raw event', async () => {
  const now = new Date('2027-01-01T00:00:30.000Z');
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const service = new AiIngestionService(
    createMockDataSource(store),
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(new ZoneAuthorizationService()),
    new DurableGroupingService(),
    undefined,
    () => now,
  );
  const capturedAt = '2026-12-31T24:59:60+01:00';
  const payload = createSampleEvent({ capturedAt });

  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.equal(store.rawEvents.length, 1);
  const saved = store.rawEvents[0]!;
  assert.equal(saved.capturedAt.toISOString(), now.toISOString());
  assert.equal((saved.rawPayload as Record<string, unknown>)['capturedAt'], capturedAt);
  assert.equal(saved.payloadHash, computeCanonicalPayloadHash(payload));
  assert.equal(store.alerts.length, 0);
  assert.equal(store.mappings.length, 0);
});

test('AiIngestionService: accepts RFC 3339 leap-second capturedAt (:60) near boundary, preserves raw payload and persists valid Date', async () => {
  const cameraId = '33333333-3333-4333-8333-333333333333';
  const siteId = '44444444-4444-4444-8444-444444444444';
  const camera: CameraEntity = {
    id: cameraId,
    siteId,
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Gate Camera',
    status: CameraStatus.ACTIVE,
    createdAt: FIXED_NOW,
  };
  const store: MockStore = {
    cameras: [camera],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();

  // Fake clock: exactly 61 seconds after the leap second event (near-boundary, well within 300s past window)
  const leapSecondClock = new Date('2027-01-01T00:01:00.000Z');
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => leapSecondClock,
  );

  const payload = createSampleEvent({
    cameraExternalId: 'CAM-01',
    capturedAt: '2026-12-31T23:59:60Z', // Leap second event!
  });

  const result = await service.ingestEvent(payload);

  // Schema valid leap second event must NOT fail or throw 400/500
  assert.equal(result.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
  assert.equal(store.rawEvents.length, 1);

  const savedRaw = store.rawEvents[0]!;
  // DB capturedAt column receives valid normalized Date (never NaN)
  assert.ok(savedRaw.capturedAt instanceof Date);
  assert.ok(Number.isFinite(savedRaw.capturedAt.getTime()));
  assert.equal(savedRaw.capturedAt.toISOString(), '2026-12-31T23:59:59.000Z');

  // Exact raw payload string with :60 preserved
  const savedPayload = savedRaw.rawPayload as Record<string, unknown>;
  assert.equal(savedPayload['capturedAt'], '2026-12-31T23:59:60Z');

  // Canonical payloadHash computed on original payload
  assert.equal(savedRaw.payloadHash, computeCanonicalPayloadHash(payload));
});

test('AiIngestionService: leap-second capturedAt outside past boundary results in SKIPPED_CLOCK_SKEW with valid normalized Date', async () => {
  const store: MockStore = {
    cameras: [],
    regions: [],
    zones: [],
    rawEvents: [],
    alerts: [],
    mappings: [],
  };
  const ds = createMockDataSource(store);
  const contextResolver = new ObservationContextResolverService();
  const zoneAuth = new ZoneAuthorizationService();
  const candidateEvaluator = new AlertCandidateEvaluator(zoneAuth);
  const groupingService = new DurableGroupingService();

  // Fake clock: 302 seconds after normalized leap second (exceeds 300s past window)
  const clockAfterBoundary = new Date('2027-01-01T00:05:01.000Z');
  const service = new AiIngestionService(
    ds,
    contextResolver,
    candidateEvaluator,
    groupingService,
    undefined,
    () => clockAfterBoundary,
  );

  const payload = createSampleEvent({
    capturedAt: '2026-12-31T23:59:60Z',
  });

  const result = await service.ingestEvent(payload);

  assert.equal(result.status, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
  assert.equal(store.rawEvents.length, 1);
  const savedRaw = store.rawEvents[0]!;
  assert.ok(Number.isFinite(savedRaw.capturedAt.getTime()));
  assert.equal(savedRaw.capturedAt.toISOString(), '2026-12-31T23:59:59.000Z');
  assert.equal(savedRaw.processingStatus, EventProcessingStatus.SKIPPED_CLOCK_SKEW);
});
