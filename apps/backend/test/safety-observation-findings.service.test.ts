import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import { SafetyObservationFindingsService } from '../src/modules/safety/alerts/safety-observation-findings.service.js';

function fixture(capturedAt: string, processingStatus = EventProcessingStatus.PROCESSED) {
  const eventId = randomUUID(),
    alertId = randomUUID(),
    siteId = randomUUID();
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: 'test-camera',
    streamSessionId: randomUUID(),
    capturedAt,
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 1,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [],
  };
  const event = {
    eventId,
    rawPayload: raw,
    payloadHash: computeCanonicalPayloadHash(raw),
    cameraExternalId: raw.cameraExternalId,
    streamSessionId: raw.streamSessionId,
    capturedAt: new Date(capturedAt.replace(':60', ':59')),
    processingStatus,
  };
  const query = {
    innerJoin() {
      return this;
    },
    where() {
      return this;
    },
    andWhere() {
      return this;
    },
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    async getExists() {
      return false;
    },
    async getCount() {
      return 1;
    },
    async getMany() {
      return [{ id: alertId }];
    },
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === AiObservationEventEntity)
        return {
          async findOneBy() {
            return event;
          },
        };
      if (entity === AlertDetectionMappingEntity)
        return {
          async findOneBy() {
            return { personObservationIndex: 0 };
          },
          createQueryBuilder: () => query,
        };
      return {
        async existsBy() {
          return true;
        },
        createQueryBuilder: () => query,
      };
    },
  };
  const source = {
    async transaction(_isolation: unknown, callback: (m: unknown) => unknown) {
      return callback(manager);
    },
  } as unknown as DataSource;
  return { service: new SafetyObservationFindingsService(source), eventId, alertId, siteId };
}

test('findings use the same leap-second normalization as ingestion', async () => {
  const { service, siteId, alertId, eventId } = fixture('2026-06-30T23:59:60.250Z');
  const result = await service.list(siteId, alertId, eventId);
  assert.deepEqual(result.subject, { kind: 'EVENT_LOCAL', eventId, personObservationIndex: 0 });
  assert.equal(result.total, 1);
});

test('findings do not project skipped observation events even with a stale mapping', async () => {
  const { service, siteId, alertId, eventId } = fixture(
    '2026-06-30T23:59:59Z',
    EventProcessingStatus.SKIPPED_NO_CANDIDATE,
  );
  assert.deepEqual(await service.list(siteId, alertId, eventId), {
    subject: null,
    items: [],
    total: 0,
  });
});
