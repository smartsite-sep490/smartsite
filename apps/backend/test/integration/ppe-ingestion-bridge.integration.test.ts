import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { type EntityManager, QueryFailedError } from 'typeorm';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
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
  UserEntity,
  UserNotificationEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const FIVE_PPE_ITEMS = ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'] as const;
const EXPECTED_PPE_SUBTYPES = [
  'PPE_BOOTS_MISSING',
  'PPE_GLOVES_MISSING',
  'PPE_GOGGLES_MISSING',
  'PPE_HARD_HAT_MISSING',
  'PPE_SAFETY_VEST_MISSING',
] as const;

class FailingAfterInsertNotificationService extends SchedulingNotificationService {
  override async recordPpeAlert(
    manager: EntityManager,
    alert: SafetyAlertEntity,
    cameraId: string,
  ): Promise<number> {
    const inserted = await super.recordPpeAlert(manager, alert, cameraId);
    assert.equal(inserted, 1);
    throw new QueryFailedError(
      'INSERT INTO user_notification',
      [],
      Object.assign(new Error('synthetic notification failure after insert'), {
        code: '23514',
        constraint: 'chk_notification_ppe_target',
      }),
    );
  }
}

test('legacy PPE ingestion -> durable grouping -> scoped notifications in real PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const schema = (db.options as { schema: string }).schema;
  t.diagnostic(`ownedPpeIngestionBridgeSchema=${schema}`);

  try {
    await owned.initialize();

    const siteId = randomUUID();
    const foreignSiteId = randomUUID();
    const cameraId = randomUUID();
    const cameraExternalId = `SYNTH-CAM-${randomUUID()}`;
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const currentOfficerId = randomUUID();
    const foreignOfficerId = randomUUID();

    await db.getRepository(SiteEntity).insert([
      { id: siteId, code: 'SYNTH-PPE-SITE-1', name: 'Synthetic PPE Site 1' },
      { id: foreignSiteId, code: 'SYNTH-PPE-SITE-2', name: 'Synthetic Foreign Site 2' },
    ]);
    await db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: cameraExternalId,
      code: cameraExternalId,
      name: 'Synthetic PPE Camera 1',
      status: CameraStatus.ACTIVE,
    });
    await db.getRepository(ZoneEntity).insert({
      id: zoneId,
      siteId,
      code: 'SYNTH-PPE-ZONE-1',
      name: 'Synthetic PPE Zone 1',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [...FIVE_PPE_ITEMS],
    });
    await db.getRepository(CameraObservationRegionEntity).insert({
      id: regionId,
      cameraId,
      zoneId,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      polygon: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ],
    });
    await db.getRepository(UserEntity).insert([
      {
        id: currentOfficerId,
        username: `synth-so-1-${currentOfficerId.slice(0, 8)}`,
        displayName: 'Synthetic Current Safety Officer',
        passwordHash: 'synth-password-hash',
        isActive: true,
        mustChangePassword: false,
      },
      {
        id: foreignOfficerId,
        username: `synth-so-2-${foreignOfficerId.slice(0, 8)}`,
        displayName: 'Synthetic Foreign Safety Officer',
        passwordHash: 'synth-password-hash',
        isActive: true,
        mustChangePassword: false,
      },
    ]);
    await db.getRepository(UserRoleAssignmentEntity).insert([
      { id: randomUUID(), userId: currentOfficerId, role: UserRole.SAFETY_OFFICER, siteId },
      {
        id: randomUUID(),
        userId: foreignOfficerId,
        role: UserRole.SAFETY_OFFICER,
        siteId: foreignSiteId,
      },
    ]);

    const currentOfficer: AuthenticatedUser = {
      id: currentOfficerId,
      username: `synth-so-1-${currentOfficerId.slice(0, 8)}`,
      displayName: 'Synthetic Current Safety Officer',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
    };
    const foreignOfficer: AuthenticatedUser = {
      id: foreignOfficerId,
      username: `synth-so-2-${foreignOfficerId.slice(0, 8)}`,
      displayName: 'Synthetic Foreign Safety Officer',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: foreignSiteId }],
    };

    const config = createTestConfig({
      ALERT_COOLDOWN_SECONDS: '60',
    });
    const resolver = new ObservationContextResolverService();
    const evaluator = new AlertCandidateEvaluator();
    const notifications = new SchedulingNotificationService(db);
    const grouping = new DurableGroupingService(config, notifications);
    const ingestion = new AiIngestionService(db, resolver, evaluator, grouping, config);

    const buildV12Event = (opts: {
      eventId?: string;
      streamSessionId: string;
      capturedAt: string;
      trackId: number;
      ppeItems: readonly string[];
    }) => {
      const eventId = opts.eventId ?? randomUUID();
      return {
        eventId,
        schemaVersion: '1.2.0',
        cameraExternalId,
        streamSessionId: opts.streamSessionId,
        capturedAt: opts.capturedAt,
        frameDimensions: { width: 640, height: 480 },
        observations: [
          {
            type: 'PERSON',
            trackId: opts.trackId,
            confidence: 0.96,
            boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
          },
          ...opts.ppeItems.map((ppeItem, idx) => ({
            type: 'PPE',
            trackId: opts.trackId,
            ppeItem,
            status: 'MISSING',
            regionId,
            geometryVersion: 1,
            confidence: 0.91,
            boundingBox: {
              x1: 0.12 + idx * 0.01,
              y1: 0.2 + idx * 0.01,
              x2: 0.38 + idx * 0.01,
              y2: 0.85 + idx * 0.01,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          })),
        ],
        evidence: [
          {
            kind: 'FRAME',
            uri: `local://evidence/${opts.streamSessionId}/${opts.trackId}/${eventId}.jpg`,
            sha256: 'a'.repeat(64),
          },
        ],
      };
    };

    // 1. Canonical v1.2.0 event with Person + 5 explicit MISSING PPE observations creates 5 alerts + 5 scoped notifications
    const session1 = randomUUID();
    const event1 = buildV12Event({
      streamSessionId: session1,
      capturedAt: new Date(Date.now() - 10_000).toISOString(),
      trackId: 7,
      ppeItems: FIVE_PPE_ITEMS,
    });
    const event1Hash = computeCanonicalPayloadHash(event1);
    const res1 = await ingestion.ingestEvent(event1);
    assert.equal(res1.status, EventProcessingStatus.PROCESSED);
    assert.equal(res1.alertIds.length, 5);

    const raw1 = await db
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: event1.eventId });
    assert.equal(raw1.payloadHash, event1Hash);
    assert.equal(raw1.processingStatus, EventProcessingStatus.PROCESSED);

    const alerts1 = await db.getRepository(SafetyAlertEntity).findBy({ siteId });
    assert.equal(alerts1.length, 5);
    assert.deepEqual(alerts1.map((a) => a.candidateSubtype).sort(), [...EXPECTED_PPE_SUBTYPES]);
    assert.ok(
      alerts1.every(
        (a) =>
          a.alertType === AlertType.PPE_VIOLATION &&
          a.status === AlertStatus.PENDING_REVIEW &&
          a.detectionCount === 1,
      ),
    );

    const inbox1 = await notifications.list(currentOfficer);
    assert.equal(inbox1.total, 5);
    assert.equal(inbox1.unreadCount, 5);
    assert.deepEqual(inbox1.items.map((i) => i.safetyAlert?.candidateSubtype).sort(), [
      ...EXPECTED_PPE_SUBTYPES,
    ]);
    assert.deepEqual(
      inbox1.items.map((i) => (i.target as { alertId: string }).alertId).sort(),
      [...res1.alertIds].sort(),
    );
    assert.equal((await notifications.list(foreignOfficer)).total, 0);

    // 2. Same-event retry produces no duplicate alerts or notifications
    const dupRes = await ingestion.ingestEvent(structuredClone(event1));
    assert.equal(dupRes.status, 'DUPLICATE_ACCEPTED');
    assert.deepEqual(dupRes.alertIds, []);
    assert.equal(await db.getRepository(SafetyAlertEntity).countBy({ siteId }), 5);
    assert.equal((await notifications.list(currentOfficer)).total, 5);

    // 3. New same-session event groups into existing 5 alerts and emits no new notifications
    const event2 = buildV12Event({
      streamSessionId: session1,
      capturedAt: new Date(Date.now() - 8_000).toISOString(),
      trackId: 7,
      ppeItems: FIVE_PPE_ITEMS,
    });
    const res2 = await ingestion.ingestEvent(event2);
    assert.equal(res2.status, EventProcessingStatus.PROCESSED);
    assert.deepEqual([...res2.alertIds].sort(), [...res1.alertIds].sort());
    const groupedAlerts = await db.getRepository(SafetyAlertEntity).findBy({ siteId });
    assert.equal(groupedAlerts.length, 5);
    assert.ok(groupedAlerts.every((a) => a.detectionCount === 2));
    assert.equal(
      await db.getRepository(AlertDetectionMappingEntity).countBy({ eventId: event2.eventId }),
      5,
    );
    assert.equal((await notifications.list(currentOfficer)).total, 5);

    // 4. Person-only event skips candidate creation and emits no new alerts or notifications
    const personOnlyEvent = buildV12Event({
      streamSessionId: session1,
      capturedAt: new Date(Date.now() - 6_000).toISOString(),
      trackId: 8,
      ppeItems: [],
    });
    const personRes = await ingestion.ingestEvent(personOnlyEvent);
    assert.equal(personRes.status, EventProcessingStatus.SKIPPED_NO_CANDIDATE);
    assert.deepEqual(personRes.alertIds, []);
    assert.equal(await db.getRepository(SafetyAlertEntity).countBy({ siteId }), 5);
    assert.equal((await notifications.list(currentOfficer)).total, 5);

    // 5. Unsupported MASK MISSING is rejected before any database writes
    const maskEvent = buildV12Event({
      streamSessionId: session1,
      capturedAt: new Date(Date.now() - 5_000).toISOString(),
      trackId: 9,
      ppeItems: ['MASK'],
    });
    await assert.rejects(
      () => ingestion.ingestEvent(maskEvent),
      (err: unknown) =>
        err instanceof PublicHttpException &&
        err.getStatus() === 400 &&
        (err.getResponse() as { code?: string }).code === 'VALIDATION_FAILED',
    );
    assert.equal(
      await db.getRepository(AiObservationEventEntity).findOneBy({ eventId: maskEvent.eventId }),
      null,
    );
    assert.equal(await db.getRepository(SafetyAlertEntity).countBy({ siteId }), 5);
    assert.equal((await notifications.list(currentOfficer)).total, 5);

    // 6. Subclass notification writer throws QueryFailedError after super insert -> 503 & full rollback, then normal retry succeeds
    const failingGrouping = new DurableGroupingService(
      config,
      new FailingAfterInsertNotificationService(db),
    );
    const failingIngestion = new AiIngestionService(
      db,
      resolver,
      evaluator,
      failingGrouping,
      config,
    );
    const rollbackEvent = buildV12Event({
      streamSessionId: randomUUID(),
      capturedAt: new Date(Date.now() - 4_000).toISOString(),
      trackId: 77,
      ppeItems: FIVE_PPE_ITEMS,
    });
    await assert.rejects(
      () => failingIngestion.ingestEvent(rollbackEvent),
      (err: unknown) =>
        err instanceof PublicHttpException &&
        err.getStatus() === 503 &&
        (err.getResponse() as { code?: string }).code === 'AI_INGESTION_UNAVAILABLE',
    );
    assert.equal(
      await db
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: rollbackEvent.eventId }),
      null,
    );
    assert.equal(
      await db
        .getRepository(AlertDetectionMappingEntity)
        .countBy({ eventId: rollbackEvent.eventId }),
      0,
    );
    assert.equal(await db.getRepository(SafetyAlertEntity).countBy({ siteId }), 5);
    assert.equal(await db.getRepository(UserNotificationEntity).countBy({ siteId }), 5);

    const retryRecovered = await ingestion.ingestEvent(rollbackEvent);
    assert.equal(retryRecovered.status, EventProcessingStatus.PROCESSED);
    assert.equal(retryRecovered.alertIds.length, 5);
    const rawRecovered = await db
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: rollbackEvent.eventId });
    assert.equal(rawRecovered.payloadHash, computeCanonicalPayloadHash(rollbackEvent));
    assert.equal(await db.getRepository(SafetyAlertEntity).countBy({ siteId }), 10);
    const inboxRecovered = await notifications.list(currentOfficer);
    assert.equal(inboxRecovered.total, 10);
    assert.equal(inboxRecovered.unreadCount, 10);
    assert.equal((await notifications.list(foreignOfficer)).total, 0);
  } finally {
    await owned.dispose();
  }
});
