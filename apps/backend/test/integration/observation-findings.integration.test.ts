import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  SafetyAlertEntity,
  SiteEntity,
  CameraEntity,
  AlertType,
  AlertStatus,
  EventProcessingStatus,
} from '../../src/database/entities/index.js';
import { SafetyObservationFindingsService } from '../../src/modules/safety/alerts/safety-observation-findings.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('same-event findings preserve exact person, Site and legacy provenance boundaries', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      otherSiteId = randomUUID(),
      cameraId = randomUUID();
    await db
      .getRepository(SiteEntity)
      .insert([siteId, otherSiteId].map((id) => ({ id, code: id, name: 'Synthetic Site' })));
    await db
      .getRepository(CameraEntity)
      .insert({
        id: cameraId,
        siteId,
        code: cameraId,
        externalId: cameraId,
        name: 'Synthetic camera',
      });
    const raw = {
      eventId: randomUUID(),
      schemaVersion: '1.0.0',
      cameraExternalId: cameraId,
      streamSessionId: randomUUID(),
      capturedAt: '2026-10-23T00:00:00Z',
      frameDimensions: { width: 1280, height: 720 },
      observations: Array.from({ length: 10 }, (_, trackId) => ({
        type: 'PERSON',
        trackId,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      })),
      evidence: [],
    };
    const events = [raw, { ...raw, eventId: randomUUID() }];
    for (const event of events)
      await db
        .getRepository(AiObservationEventEntity)
        .insert({
          eventId: event.eventId,
          cameraExternalId: cameraId,
          resolvedCameraId: cameraId,
          streamSessionId: event.streamSessionId,
          capturedAt: new Date(event.capturedAt),
          rawPayload: event,
          payloadHash: computeCanonicalPayloadHash(event),
          processingStatus: EventProcessingStatus.PROCESSED,
        });
    const ids: string[] = [];
    for (const [index, subject] of [0, 0, 3, 8, null].entries()) {
      const id = randomUUID();
      ids.push(id);
      await db
        .getRepository(SafetyAlertEntity)
        .insert({
          id,
          siteId,
          alertType: AlertType.PPE_VIOLATION,
          candidateSubtype: index === 1 ? 'PPE_SAFETY_VEST_MISSING' : 'PPE_HARD_HAT_MISSING',
          groupingKey: id,
          status: AlertStatus.PENDING_REVIEW,
          firstDetectedAt: new Date(raw.capturedAt),
          lastDetectedAt: new Date(raw.capturedAt),
          detectionCount: 1,
        });
      await db
        .getRepository(AlertDetectionMappingEntity)
        .insert({ alertId: id, eventId: raw.eventId, personObservationIndex: subject });
    }
    await db
      .getRepository(AlertDetectionMappingEntity)
      .insert({ alertId: ids[2]!, eventId: events[1]!.eventId, personObservationIndex: 0 });
    const service = new SafetyObservationFindingsService(db);
    const first = await service.list(siteId, ids[0]!, raw.eventId, 0, 1);
    assert.deepEqual(first.subject, {
      kind: 'EVENT_LOCAL',
      eventId: raw.eventId,
      personObservationIndex: 0,
    });
    assert.equal(first.total, 2);
    assert.equal(first.items.length, 1);
    const second = await service.list(siteId, ids[0]!, raw.eventId, 1, 1);
    assert.deepEqual(
      new Set([...first.items, ...second.items].map((item) => item.id)),
      new Set(ids.slice(0, 2)),
    );
    assert.equal((await service.list(siteId, ids[2]!, raw.eventId)).total, 1);
    assert.equal((await service.list(siteId, ids[3]!, raw.eventId)).total, 1);
    assert.deepEqual(await service.list(siteId, ids[4]!, raw.eventId), {
      subject: null,
      items: [],
      total: 0,
    });
    assert.deepEqual(
      (await service.list(siteId, ids[2]!, events[1]!.eventId)).items.map((item) => item.id),
      [ids[2]],
    );
    await assert.rejects(service.list(otherSiteId, ids[0]!, raw.eventId), /not found/i);
    await assert.rejects(service.list(siteId, ids[0]!, events[1]!.eventId), /not found/i);
    await assert.rejects(service.list(siteId, ids[0]!, raw.eventId, 0, 101));
    await db
      .getRepository(AiObservationEventEntity)
      .update({ eventId: raw.eventId }, { payloadHash: '0'.repeat(64) });
    assert.equal((await service.list(siteId, ids[0]!, raw.eventId)).subject, null);
    const duplicate = { ...raw, observations: [...raw.observations, raw.observations[0]!] };
    await db
      .getRepository(AiObservationEventEntity)
      .update(
        { eventId: raw.eventId },
        { rawPayload: duplicate, payloadHash: computeCanonicalPayloadHash(duplicate) },
      );
    assert.equal((await service.list(siteId, ids[0]!, raw.eventId)).subject, null);
    await db
      .getRepository(AiObservationEventEntity)
      .update(
        { eventId: raw.eventId },
        { rawPayload: raw, payloadHash: computeCanonicalPayloadHash(raw) },
      );
    await db.getRepository(SafetyAlertEntity).update({ id: ids[3]! }, { siteId: otherSiteId });
    assert.deepEqual(await service.list(siteId, ids[0]!, raw.eventId), {
      subject: null,
      items: [],
      total: 0,
    });
  } finally {
    await owned.dispose();
  }
});
