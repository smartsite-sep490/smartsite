import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  AlertStatus,
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
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('subject provenance survives upgrade, retry and rollback boundaries in isolated PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const registered = db.options.migrations;
  assert(Array.isArray(registered));
  // Rehearse this historical boundary even when later migrations are registered.
  const production = registered.filter((migration) => {
    assert(typeof migration === 'function');
    const timestamp = Number(migration.name.slice(-13));
    assert(Number.isSafeInteger(timestamp) && timestamp > 0);
    return timestamp <= 1793404800000;
  });
  db.setOptions({ migrations: production });
  assert.equal(production.length, 65);
  assert(
    production.some(
      (migration) =>
        typeof migration === 'function' && migration.name === 'AlertDetectionSubject1793404800000',
    ),
  );
  try {
    await owned.initialize();
    const [column] = await db.query(`SELECT data_type,is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='alert_detection_mapping'
      AND column_name='person_observation_index'`);
    assert.deepEqual(column, { data_type: 'smallint', is_nullable: 'YES' });
    const [last] = await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1');
    assert.equal(last.name, 'AlertDetectionSubject1793404800000');
    await db.undoLastMigration(); // Empty provenance: reproduce the populated predecessor below.

    const siteId = randomUUID(),
      cameraId = randomUUID(),
      zoneId = randomUUID(),
      regionId = randomUUID();
    const cameraExternalId = `SYNTH-SUBJECT-${randomUUID()}`;
    await db
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: 'SUBJECT-SITE', name: 'Synthetic Site' });
    await db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: 'SUBJECT-CAMERA',
      name: 'Synthetic Camera',
      status: CameraStatus.ACTIVE,
    });
    await db.getRepository(ZoneEntity).insert({
      id: zoneId,
      siteId,
      code: 'SUBJECT-ZONE',
      name: 'Synthetic Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES'],
    });
    await db.getRepository(CameraObservationRegionEntity).insert({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    });
    const box = { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
    const person = (trackId: number) => ({
      type: 'PERSON',
      trackId,
      confidence: 0.9,
      boundingBox: box,
    });
    const missing = (trackId: number, ppeItem = 'HARD_HAT') => ({
      type: 'PPE',
      trackId,
      ppeItem,
      status: 'MISSING',
      regionId,
      geometryVersion: 1,
      confidence: 0.9,
      boundingBox: box,
    });
    const sessionId = randomUUID();
    const event = (observations: object[]) => ({
      eventId: randomUUID(),
      schemaVersion: '1.2.0',
      cameraExternalId,
      streamSessionId: sessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 640, height: 480 },
      observations,
      evidence: [],
    });
    const legacy = event([person(90), missing(90)]);
    const legacyAlertId = randomUUID();
    await db.getRepository(AiObservationEventEntity).insert({
      eventId: legacy.eventId,
      payloadHash: computeCanonicalPayloadHash(legacy),
      cameraExternalId,
      resolvedCameraId: cameraId,
      streamSessionId: sessionId,
      capturedAt: new Date(legacy.capturedAt),
      receivedAt: new Date(),
      rawPayload: legacy,
      processingStatus: EventProcessingStatus.PROCESSED,
      processingNote: null,
    });
    await db.getRepository(SafetyAlertEntity).insert({
      id: legacyAlertId,
      siteId,
      zoneId,
      alertType: AlertType.PPE_VIOLATION,
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      groupingKey: 'SYNTHETIC-LEGACY',
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: new Date(legacy.capturedAt),
      lastDetectedAt: new Date(legacy.capturedAt),
      detectionCount: 1,
    });
    await db.query('INSERT INTO alert_detection_mapping(alert_id,event_id) VALUES($1,$2)', [
      legacyAlertId,
      legacy.eventId,
    ]);
    const before = await db.query(
      'SELECT alert_id,event_id,created_at FROM alert_detection_mapping',
    );
    await db.runMigrations();
    assert.deepEqual(
      await db.query('SELECT alert_id,event_id,created_at FROM alert_detection_mapping'),
      before,
    );
    assert.equal(
      (
        await db
          .getRepository(AlertDetectionMappingEntity)
          .findOneByOrFail({ eventId: legacy.eventId })
      ).personObservationIndex,
      null,
    );

    const config = createTestConfig();
    const ingestion = new AiIngestionService(
      db,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(config, new SchedulingNotificationService(db)),
      config,
    );
    await t.test('legacy replay does not guess or backfill a historical subject', async () => {
      assert.equal((await ingestion.ingestEvent(legacy)).status, 'DUPLICATE_ACCEPTED');
      assert.equal(
        (
          await db
            .getRepository(AlertDetectionMappingEntity)
            .findOneByOrFail({ eventId: legacy.eventId })
        ).personObservationIndex,
        null,
      );
    });

    const people = Array.from({ length: 10 }, (_, index) => person(index));
    const first = event([
      missing(2),
      ...people,
      missing(2, 'SAFETY_VEST'),
      missing(5),
      missing(5, 'SAFETY_VEST'),
      missing(9, 'GLOVES'),
    ]);
    await t.test(
      'three of ten people map five findings to exact subjects, preserving raw hash and retry',
      async () => {
        const result = await ingestion.ingestEvent(first);
        assert.equal(result.alertIds.length, 5);
        const mappings = await db
          .getRepository(AlertDetectionMappingEntity)
          .findBy({ eventId: first.eventId });
        assert.deepEqual(
          mappings.map((row) => row.personObservationIndex).sort((a, b) => a! - b!),
          [3, 3, 6, 6, 10],
        );
        const raw = await db
          .getRepository(AiObservationEventEntity)
          .findOneByOrFail({ eventId: first.eventId });
        assert.deepEqual(raw.rawPayload, first);
        assert.equal(raw.payloadHash, computeCanonicalPayloadHash(first));
        assert.equal((await ingestion.ingestEvent(first)).status, 'DUPLICATE_ACCEPTED');
        assert.equal(
          await db.getRepository(AlertDetectionMappingEntity).countBy({ eventId: first.eventId }),
          5,
        );
        await assert.rejects(
          ingestion.ingestEvent({ ...first, observations: [...first.observations].reverse() }),
          (error: { getStatus(): number }) => error.getStatus() === 409,
        );
      },
    );

    await t.test(
      'legacy cooldown alert can retain different original indices in different events',
      async () => {
        const second = event([person(2), missing(2), missing(2, 'SAFETY_VEST')]);
        const result = await ingestion.ingestEvent(second);
        const original = await db
          .getRepository(AlertDetectionMappingEntity)
          .findBy({ eventId: first.eventId });
        assert(result.alertIds.every((id) => original.some((row) => row.alertId === id)));
        const mappings = await db
          .getRepository(AlertDetectionMappingEntity)
          .findBy({ eventId: second.eventId });
        assert.equal(mappings.length, 2);
        assert(mappings.every((row) => row.personObservationIndex === 0));
        assert.equal(original.filter((row) => row.personObservationIndex === 3).length, 2);
      },
    );

    await t.test(
      'ambiguous or absent people keep nullable mappings, never discard findings',
      async () => {
        for (const observations of [[person(40), person(40), missing(40)], [missing(41)]]) {
          const payload = event(observations);
          assert.equal((await ingestion.ingestEvent(payload)).alertIds.length, 1);
          const mapping = await db
            .getRepository(AlertDetectionMappingEntity)
            .findOneByOrFail({ eventId: payload.eventId });
          assert.equal(mapping.personObservationIndex, null);
        }
      },
    );

    await t.test(
      'range checks reject invalid indices and failed mapping rolls back raw event and alert',
      async () => {
        for (const value of [-1, 256])
          await assert.rejects(
            db.query(
              'UPDATE alert_detection_mapping SET person_observation_index=$1 WHERE event_id=$2',
              [value, legacy.eventId],
            ),
            (error: { code: string }) => error.code === '23514',
          );
        await db.query(
          'ALTER TABLE alert_detection_mapping ADD CONSTRAINT synthetic_subject_failure CHECK(person_observation_index<>1)',
        );
        const rejected = event([missing(70), person(70)]);
        const alertsBefore = await db.getRepository(SafetyAlertEntity).count();
        try {
          await assert.rejects(
            ingestion.ingestEvent(rejected),
            (error: { getStatus(): number }) => error.getStatus() === 503,
          );
          assert.equal(
            await db.getRepository(AiObservationEventEntity).countBy({ eventId: rejected.eventId }),
            0,
          );
          assert.equal(await db.getRepository(SafetyAlertEntity).count(), alertsBefore);
          assert.equal(
            await db
              .getRepository(AlertDetectionMappingEntity)
              .countBy({ eventId: rejected.eventId }),
            0,
          );
        } finally {
          await db.query(
            'ALTER TABLE alert_detection_mapping DROP CONSTRAINT synthetic_subject_failure',
          );
        }
      },
    );

    await t.test('populated rollback refuses to erase provenance', async () => {
      await assert.rejects(db.undoLastMigration(), /subject provenance must be retained/);
      assert.equal(
        await db.getRepository(AlertDetectionMappingEntity).countBy({ eventId: first.eventId }),
        5,
      );
    });
  } finally {
    await owned.dispose();
  }
});
