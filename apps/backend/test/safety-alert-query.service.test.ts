import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { AlertStatus, AlertType, EventProcessingStatus } from '../src/database/entities/enums.js';
import { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { SafetyAlertReviewEntity } from '../src/database/entities/safety-alert-review.entity.js';
import { SafetyAlertQueryService } from '../src/modules/safety/alerts/safety-alert-query.service.js';
import type { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';

const noEvidence = {
  summarize: () => [],
} as unknown as SafetyAlertEvidenceService;

function alert(overrides: Partial<SafetyAlertEntity> = {}): SafetyAlertEntity {
  return Object.assign(new SafetyAlertEntity(), {
    id: randomUUID(),
    siteId: randomUUID(),
    zoneId: null,
    candidateWorkerId: null,
    identitySimilarityScore: null,
    identityQualityScore: null,
    alertType: AlertType.PPE_VIOLATION,
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    groupingKey: 'group',
    status: AlertStatus.PENDING_REVIEW,
    firstDetectedAt: new Date('2026-09-27T01:00:00Z'),
    lastDetectedAt: new Date('2026-09-27T01:01:00Z'),
    detectionCount: 2,
    revision: 0,
    createdAt: new Date('2026-09-27T01:00:00Z'),
    updatedAt: new Date('2026-09-27T01:00:00Z'),
    ...overrides,
  });
}

test('SafetyAlertQueryService lists a scoped, filtered and stable page', async () => {
  const siteId = randomUUID();
  const expected = alert({ siteId });
  let receivedOptions: unknown;
  const alertRepository = {
    async findAndCount(options: unknown) {
      receivedOptions = options;
      return [[expected], 1] as const;
    },
  };
  const dataSource = {
    getRepository: (entity: unknown) => {
      assert.equal(entity, SafetyAlertEntity);
      return alertRepository;
    },
  } as unknown as DataSource;
  const service = new SafetyAlertQueryService(dataSource, noEvidence);

  const result = await service.list(siteId, 5, 10, {
    status: AlertStatus.PENDING_REVIEW,
    type: AlertType.PPE_VIOLATION,
  });

  assert.deepEqual(result, { items: [expected], total: 1 });
  assert.deepEqual(receivedOptions, {
    where: {
      siteId,
      status: AlertStatus.PENDING_REVIEW,
      alertType: AlertType.PPE_VIOLATION,
    },
    order: { lastDetectedAt: 'DESC', id: 'ASC' },
    skip: 5,
    take: 10,
  });
});

test('SafetyAlertQueryService rejects invalid IDs, pagination and filters before database access', async () => {
  const service = new SafetyAlertQueryService(undefined as unknown as DataSource, noEvidence);
  const invalid = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';

  await assert.rejects(service.list('not-a-uuid'), invalid);
  await assert.rejects(service.list(randomUUID(), 0, 101), invalid);
  await assert.rejects(service.list(randomUUID(), 0, 20, { status: 'REVIEWED_BY_AI' }), invalid);
  await assert.rejects(service.list(randomUUID(), 0, 20, { type: 'UNKNOWN_ALERT' }), invalid);
});

test('SafetyAlertQueryService returns curated detections without raw event payload', async () => {
  const siteId = randomUUID();
  const alertId = randomUUID();
  const stored = alert({ id: alertId, siteId });
  const detection = {
    eventId: randomUUID(),
    cameraExternalId: 'CAM-GATE-01',
    capturedAt: new Date('2026-09-27T01:01:00Z'),
    processingStatus: EventProcessingStatus.PROCESSED,
    rawPayload: {
      evidence: [{ kind: 'FRAME', uri: `local://evidence/${randomUUID()}/1/${randomUUID()}.jpg` }],
    },
  };
  const queryBuilder = {
    innerJoin() {
      return this;
    },
    select() {
      return this;
    },
    addSelect() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    addOrderBy() {
      return this;
    },
    limit() {
      return this;
    },
    async getRawMany() {
      return [detection];
    },
  };
  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === SafetyAlertEntity)
        return {
          async findOneBy(where: { id: string; siteId: string }) {
            return where.id === alertId && where.siteId === siteId ? stored : null;
          },
        };
      if (entity === AlertDetectionMappingEntity)
        return {
          createQueryBuilder: () => queryBuilder,
          countBy: async () => 1,
        };
      if (entity === SafetyAlertReviewEntity)
        return {
          find: async () => [],
          countBy: async () => 0,
        };
      throw new Error(`unexpected repository: ${String(entity)}`);
    },
  } as unknown as DataSource;
  const evidence = [{ index: 0, kind: 'FRAME' as const, available: false }];
  const service = new SafetyAlertQueryService(dataSource, {
    summarize: (rawPayload: unknown) => {
      assert.equal(rawPayload, detection.rawPayload);
      return evidence;
    },
  } as unknown as SafetyAlertEvidenceService);

  const result = await service.get(siteId, alertId);

  assert.equal(result.alert, stored);
  assert.deepEqual(result.detections, [
    {
      eventId: detection.eventId,
      cameraExternalId: detection.cameraExternalId,
      capturedAt: detection.capturedAt,
      processingStatus: detection.processingStatus,
      evidence,
    },
  ]);
  assert.equal(result.detectionsTotal, 1);
  assert.deepEqual(result.reviews, []);
  assert.equal(result.reviewsTotal, 0);
  assert.equal('rawPayload' in result.detections[0]!, false);
});

test('SafetyAlertQueryService hides an alert outside the requested Site', async () => {
  const dataSource = {
    getRepository: (entity: unknown) => {
      assert.equal(entity, SafetyAlertEntity);
      return { findOneBy: async () => null };
    },
  } as unknown as DataSource;
  const service = new SafetyAlertQueryService(dataSource, noEvidence);

  await assert.rejects(
    service.get(randomUUID(), randomUUID()),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND',
  );
});
