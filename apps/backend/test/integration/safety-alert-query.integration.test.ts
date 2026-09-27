import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../src/database/entities/alert-detection-mapping.entity.js';
import {
  AlertStatus,
  AlertType,
  EventProcessingStatus,
} from '../../src/database/entities/enums.js';
import { SafetyAlertEntity } from '../../src/database/entities/safety-alert.entity.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import { SafetyAlertQueryService } from '../../src/modules/safety/alerts/safety-alert-query.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('Safety alert read model filters by Site and returns only curated event summaries', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const alertId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  const siteRepository = dataSource.getRepository(SiteEntity);
  const alertRepository = dataSource.getRepository(SafetyAlertEntity);
  const eventRepository = dataSource.getRepository(AiObservationEventEntity);
  const mappingRepository = dataSource.getRepository(AlertDetectionMappingEntity);
  try {
    await siteRepository.save([
      { id: siteId, code: `ALERT-${siteId.slice(0, 8)}`, name: 'Alert Site' },
      { id: otherSiteId, code: `OTHER-${otherSiteId.slice(0, 8)}`, name: 'Other Site' },
    ]);
    await alertRepository.save({
      id: alertId,
      siteId,
      zoneId: null,
      candidateWorkerId: null,
      identitySimilarityScore: null,
      identityQualityScore: null,
      alertType: AlertType.PPE_VIOLATION,
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      groupingKey: `site:${siteId}:ppe`,
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: new Date('2026-09-27T01:00:00Z'),
      lastDetectedAt: new Date('2026-09-27T01:00:02Z'),
      detectionCount: 2,
    });
    await eventRepository.save([
      {
        eventId: eventIds[0]!,
        payloadHash: 'a'.repeat(64),
        cameraExternalId: 'CAM-GATE-01',
        resolvedCameraId: null,
        streamSessionId: randomUUID(),
        capturedAt: new Date('2026-09-27T01:00:01Z'),
        rawPayload: { secretInternalField: 'must-not-leak' },
        processingStatus: EventProcessingStatus.PROCESSED,
        processingNote: null,
      },
      {
        eventId: eventIds[1]!,
        payloadHash: 'b'.repeat(64),
        cameraExternalId: 'CAM-GATE-01',
        resolvedCameraId: null,
        streamSessionId: randomUUID(),
        capturedAt: new Date('2026-09-27T01:00:02Z'),
        rawPayload: { anotherInternalField: true },
        processingStatus: EventProcessingStatus.PROCESSED,
        processingNote: null,
      },
    ]);
    await mappingRepository.save(eventIds.map((eventId) => ({ alertId, eventId })));

    const service = new SafetyAlertQueryService(dataSource);
    const page = await service.list(siteId, 0, 20, {
      status: AlertStatus.PENDING_REVIEW,
      type: AlertType.PPE_VIOLATION,
    });
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.id, alertId);
    assert.equal((await service.list(otherSiteId)).total, 0);

    const detail = await service.get(siteId, alertId);
    assert.equal(detail.detectionsTotal, 2);
    assert.deepEqual(
      detail.detections.map((item) => item.eventId),
      [eventIds[1], eventIds[0]],
    );
    assert.equal('rawPayload' in detail.detections[0]!, false);
    await assert.rejects(
      service.get(otherSiteId, alertId),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND',
    );
  } finally {
    await mappingRepository.delete({ alertId });
    await alertRepository.delete({ id: alertId });
    await eventRepository.delete(eventIds);
    await siteRepository.delete([siteId, otherSiteId]);
  }
});
