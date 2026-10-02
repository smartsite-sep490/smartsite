import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
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
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { SafetyAlertQueryService } from '../../src/modules/safety/alerts/safety-alert-query.service.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('identity FRAME digest retains historical Site scope and rejects contradictory mappings in PostgreSQL', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const alertIds = [randomUUID(), randomUUID()];
  const eventId = randomUUID();
  const cameraId = randomUUID();
  const streamSessionId = randomUUID();
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-integration-'));
  const bytes = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: `CAM-${cameraId}`,
    streamSessionId,
    capturedAt: '2026-10-01T00:00:00Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: {
          x1: 0.1,
          y1: 0.1,
          x2: 0.9,
          y2: 0.9,
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
    ],
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg` }],
  };
  const payloadHash = computeCanonicalPayloadHash(raw);
  try {
    await dataSource.getRepository(SiteEntity).insert([
      { id: siteId, code: `S-${siteId}`, name: 'Historical Site' },
      { id: otherSiteId, code: `S-${otherSiteId}`, name: 'Other Site' },
    ]);
    await dataSource.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: raw.cameraExternalId,
      code: `C-${cameraId}`,
      name: 'Camera',
    });
    for (const [index, id] of alertIds.entries()) {
      await dataSource.getRepository(SafetyAlertEntity).insert({
        id,
        siteId: index === 0 ? siteId : otherSiteId,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey: `identity-frame-${id}`,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: new Date(raw.capturedAt),
        lastDetectedAt: new Date(raw.capturedAt),
      });
    }
    await dataSource.getRepository(AiObservationEventEntity).insert({
      eventId,
      payloadHash,
      cameraExternalId: raw.cameraExternalId,
      resolvedCameraId: cameraId,
      streamSessionId,
      capturedAt: new Date(raw.capturedAt),
      rawPayload: raw,
      processingStatus: EventProcessingStatus.PROCESSED,
    });
    await dataSource
      .getRepository(AlertDetectionMappingEntity)
      .insert({ alertId: alertIds[0]!, eventId });
    await writeFile(join(root, `${streamSessionId}_1_${eventId}.jpg`), bytes);
    const service = new SafetyAlertEvidenceService(
      dataSource,
      new ConfigService<BackendEnvironment, true>(
        validateEnvironment({ NODE_ENV: 'test', EVIDENCE_LOCAL_ROOT: root }),
      ),
    );
    await dataSource.getRepository(CameraEntity).update({ id: cameraId }, { siteId: otherSiteId });
    const content = await service.readFrameForIdentityReview(
      siteId,
      alertIds[0]!,
      eventId,
      '0',
      payloadHash,
    );
    assert.deepEqual(content.bytes, bytes);
    assert.equal(content.sha256, createHash('sha256').update(bytes).digest('hex'));
    await assert.rejects(
      service.readFrameForIdentityReview(otherSiteId, alertIds[0]!, eventId, '0', payloadHash),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND',
    );
    await dataSource
      .getRepository(AlertDetectionMappingEntity)
      .insert({ alertId: alertIds[1]!, eventId });
    await assert.rejects(
      service.readFrameForIdentityReview(siteId, alertIds[0]!, eventId, '0', payloadHash),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT',
    );
  } finally {
    await dataSource.getRepository(AlertDetectionMappingEntity).delete({ eventId });
    await dataSource.getRepository(SafetyAlertEntity).delete(alertIds);
    await dataSource.getRepository(AiObservationEventEntity).delete({ eventId });
    await dataSource.getRepository(CameraEntity).delete({ id: cameraId });
    await dataSource.getRepository(SiteEntity).delete([siteId, otherSiteId]);
    await rm(root, { recursive: true, force: true });
  }
});

test('Safety alert read model filters by Site and returns only curated event summaries', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const alertId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  const streamSessionId = randomUUID();
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'smartsite-evidence-integration-'));
  const evidenceFile = `${streamSessionId}_11_${eventIds[0]}.jpg`;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
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
        streamSessionId,
        capturedAt: new Date('2026-09-27T01:00:01Z'),
        rawPayload: {
          secretInternalField: 'must-not-leak',
          evidence: [
            {
              kind: 'FRAME',
              uri: `local://evidence/${streamSessionId}/11/${eventIds[0]}.jpg`,
            },
          ],
        },
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
    await writeFile(join(evidenceRoot, evidenceFile), jpeg);

    const config = new ConfigService<BackendEnvironment, true>(
      validateEnvironment({ NODE_ENV: 'test', EVIDENCE_LOCAL_ROOT: evidenceRoot }),
    );
    const evidenceService = new SafetyAlertEvidenceService(dataSource, config);
    const service = new SafetyAlertQueryService(dataSource, evidenceService);
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
    const evidence = await evidenceService.read(siteId, alertId, eventIds[0]!, '0');
    assert.equal(evidence.fileName, evidenceFile);
    assert.deepEqual(evidence.bytes, jpeg);
    await assert.rejects(
      evidenceService.read(otherSiteId, alertId, eventIds[0]!, '0'),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND',
    );
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
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
