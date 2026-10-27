import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import {
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  ZoneType,
  ZoneRestrictionPolicy,
  SafetyAlertEntity,
  AlertStatus,
  AiObservationEventEntity,
} from '../../src/database/entities/index.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ObservationFrameParts1794009600000 } from '../../src/database/migrations/1794009600000-ObservationFrameParts.js';

test('partitioned frames preserve counters, evidence mappings and eligible recipient scope on isolated PostgreSQL', async () => {
  const owned = createIsolatedTestDatabase();
  const source = owned.dataSource;
  try {
    await owned.initialize();
    const [{ schemaName }] = await source.query('SELECT current_schema() AS "schemaName"');
    assert.match(schemaName, /^isolated_test_[0-9a-f]{32}$/);
    console.info(`FRAME_TEST_SCHEMA:${schemaName}`);
    const cameraId = randomUUID(),
      otherCameraId = randomUUID(),
      siteId = randomUUID(),
      otherSiteId = randomUUID();
    const zoneId = randomUUID(),
      otherZoneId = randomUUID(),
      userId = randomUUID(),
      session = randomUUID();
    const regions = [randomUUID(), randomUUID(), randomUUID()];
    const otherRegion = randomUUID();
    const now = new Date(),
      capturedAt = now.toISOString();
    await source.getRepository(SiteEntity).save([
      { id: siteId, code: 'FRAME-SITE', name: 'Frame test' },
      { id: otherSiteId, code: 'FRAME-OTHER', name: 'Other frame test' },
    ]);
    await source.getRepository(CameraEntity).save([
      { id: cameraId, siteId, externalId: 'FRAME-CAM', code: 'FRAME-CAM', name: 'Frame camera' },
      {
        id: otherCameraId,
        siteId: otherSiteId,
        externalId: 'FRAME-OTHER',
        code: 'FRAME-OTHER',
        name: 'Other camera',
      },
    ]);
    await source.getRepository(ZoneEntity).save([
      {
        id: zoneId,
        siteId,
        code: 'FRAME-ZONE',
        name: 'Frame Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'],
      },
      {
        id: otherZoneId,
        siteId: otherSiteId,
        code: 'OTHER-ZONE',
        name: 'Other Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
        requiredPpe: ['HARD_HAT'],
      },
    ]);
    for (const [index, id] of [...regions, otherRegion].entries()) {
      await source.getRepository(CameraObservationRegionEntity).save({
        id,
        cameraId: index < 3 ? cameraId : otherCameraId,
        zoneId: index < 3 ? zoneId : otherZoneId,
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
      });
    }
    await source.getRepository(UserEntity).save({
      id: userId,
      username: 'frame-safety',
      displayName: 'Frame Safety',
      passwordHash: 'isolated-fixture-not-for-login',
      isActive: true,
      mustChangePassword: false,
    });
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId, siteId, role: UserRole.SAFETY_OFFICER });
    const config = createTestConfig({
      AI_PARTITIONED_FRAME_ENABLED: 'true',
      ALERT_COOLDOWN_SECONDS: '60',
    });
    const service = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(config, new SchedulingNotificationService(source)),
      config,
      () => now,
    );
    function part(frameId: string, index: number, streamSessionId = session) {
      return {
        eventId: randomUUID(),
        schemaVersion: '1.4.0',
        cameraExternalId: 'FRAME-CAM',
        streamSessionId,
        capturedAt,
        frameDimensions: { width: 640, height: 480 },
        framePartition: {
          frameId,
          sequenceNumber: '9007199254740993',
          partIndex: index,
          partCount: 3,
        },
        observations: [
          { type: 'PERSON', trackId: 7, confidence: 0.9 },
          {
            type: 'PPE',
            trackId: 7,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId: regions[index]!,
            geometryVersion: 1,
          },
          { type: 'ZONE_ENTRY', trackId: 7, regionId: regions[index]!, geometryVersion: 1 },
        ],
        evidence: [],
      };
    }
    const notificationCount = async () =>
      Number((await source.query('SELECT count(*) AS n FROM user_notification'))[0].n);
    const frameId = randomUUID(),
      first = part(frameId, 0),
      second = part(frameId, 1);
    const results = await Promise.all([service.ingestEvent(second), service.ingestEvent(first)]);
    assert(results.every((result) => result.status === 'PROCESSED'));
    assert.deepEqual([...results[0]!.alertIds].sort(), [...results[1]!.alertIds].sort());
    let alerts = await source.getRepository(SafetyAlertEntity).findBy({ siteId });
    assert.equal(alerts.length, 2);
    assert(alerts.every((alert) => alert.detectionCount === 1));
    assert.equal(await notificationCount(), 2);
    assert.equal(
      Number((await source.query('SELECT count(*) AS n FROM alert_detection_mapping'))[0].n),
      4,
    );
    assert.equal((await service.ingestEvent(first)).status, 'DUPLICATE_ACCEPTED');
    assert.equal(await notificationCount(), 2);

    await assert.rejects(
      service.ingestEvent({ ...first, eventId: randomUUID() }),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
    );
    await assert.rejects(
      service.ingestEvent({ ...first, frameDimensions: { width: 1280, height: 480 } }),
      (error: unknown) =>
        (error as { getResponse(): { code: string } }).getResponse().code ===
        'AI_EVENT_ID_CONFLICT',
    );
    const nanoConflict = part(frameId, 2);
    nanoConflict.capturedAt = capturedAt.replace('Z', '000001Z');
    await assert.rejects(
      service.ingestEvent(nanoConflict),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
    );
    assert.equal(await source.getRepository(AiObservationEventEntity).count(), 2);

    const ppe = alerts.find((alert) => alert.alertType === 'PPE_VIOLATION')!;
    await source
      .getRepository(SafetyAlertEntity)
      .update({ id: ppe.id }, { status: AlertStatus.CLOSED });
    const late = await service.ingestEvent(part(frameId, 2));
    assert(late.alertIds.includes(ppe.id));
    assert.equal(
      (await source.getRepository(SafetyAlertEntity).findOneByOrFail({ id: ppe.id })).status,
      AlertStatus.CLOSED,
    );
    assert.equal(await notificationCount(), 2);
    assert(
      (await source.getRepository(SafetyAlertEntity).findBy({ siteId })).every(
        (alert) => alert.detectionCount === 1,
      ),
    );

    const independent = part(randomUUID(), 0);
    independent.framePartition.sequenceNumber = '9007199254740994';
    await service.ingestEvent(independent);
    alerts = await source.getRepository(SafetyAlertEntity).findBy({ siteId });
    assert.equal(alerts.length, 3, 'same timestamp in a distinct frame is a new detection');
    assert.equal(await notificationCount(), 3);
    await service.ingestEvent(part(frameId, 0, randomUUID()));
    assert.equal(
      await notificationCount(),
      5,
      'same frame ID in another source session must not deduplicate',
    );
    const otherBase = part(frameId, 0);
    const other = {
      ...otherBase,
      cameraExternalId: 'FRAME-OTHER',
      observations: otherBase.observations.map((observation) =>
        typeof observation.regionId === 'string'
          ? { ...observation, regionId: otherRegion }
          : observation,
      ),
    };
    const otherResult = await service.ingestEvent(other);
    assert.equal(otherResult.alertIds.length, 2);
    assert.equal(
      await notificationCount(),
      5,
      'Site A officer must receive no Site B notification',
    );

    const disabledConfig = createTestConfig();
    const disabled = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(disabledConfig, new SchedulingNotificationService(source)),
      disabledConfig,
      () => now,
    );
    await assert.rejects(
      disabled.ingestEvent(part(randomUUID(), 0)),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 400,
    );
    const index = await source.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='uq_ai_event_frame_part'",
    );
    assert.equal(index.length, 1);
    assert.match(index[0].indexdef, /UNIQUE/);
    const duplicate = { ...first, eventId: randomUUID() };
    await assert.rejects(
      source.transaction((manager) =>
        manager.query(
          `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED')`,
          [
            duplicate.eventId,
            'a'.repeat(64),
            duplicate.cameraExternalId,
            cameraId,
            session,
            now,
            duplicate,
          ],
        ),
      ),
      (error: unknown) =>
        (error as { driverError?: { constraint: string } }).driverError?.constraint ===
        'uq_ai_event_frame_part',
    );

    const manyRegions = [...regions, ...Array.from({ length: 61 }, () => randomUUID())];
    for (const id of manyRegions.slice(regions.length)) {
      await source.getRepository(CameraObservationRegionEntity).save({
        id,
        cameraId,
        zoneId,
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
      });
    }
    assert.equal(
      await source
        .getRepository(CameraObservationRegionEntity)
        .countBy({ cameraId, isActive: true }),
      64,
    );
    const largeFrameId = randomUUID(),
      largeSession = randomUUID();
    const largeParts = [manyRegions.slice(0, 42), manyRegions.slice(42)].map(
      (regionIds, partIndex) => ({
        ...part(largeFrameId, 0, largeSession),
        eventId: randomUUID(),
        framePartition: {
          frameId: largeFrameId,
          sequenceNumber: '9007199254740995',
          partIndex,
          partCount: 2,
        },
        observations: [
          { type: 'PERSON', trackId: 11 },
          ...regionIds.flatMap((regionId) => [
            ...['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'].map((ppeItem) => ({
              type: 'PPE',
              trackId: 11,
              ppeItem,
              status: 'MISSING',
              regionId,
              geometryVersion: 1,
            })),
            { type: 'ZONE_ENTRY', trackId: 11, regionId, geometryVersion: 1 },
          ]),
        ],
      }),
    );
    const notificationBeforeLarge = await notificationCount();
    assert.deepEqual(
      largeParts.map((payload) => payload.observations.length),
      [253, 133],
    );
    const largeResults = await Promise.all(
      largeParts.map((payload) => service.ingestEvent(payload)),
    );
    assert.equal(largeResults[0]!.alertIds.length, 6);
    assert.deepEqual([...largeResults[0]!.alertIds].sort(), [...largeResults[1]!.alertIds].sort());
    for (const id of largeResults[0]!.alertIds) {
      assert.equal(
        (await source.getRepository(SafetyAlertEntity).findOneByOrFail({ id })).detectionCount,
        1,
      );
    }
    assert.equal((await notificationCount()) - notificationBeforeLarge, 6);
    const largeMappings = await source.query(
      'SELECT count(*) AS n FROM alert_detection_mapping WHERE event_id=ANY($1::uuid[])',
      [largeParts.map((payload) => payload.eventId)],
    );
    assert.equal(Number(largeMappings[0].n), 12);

    const duplicateFrameId = randomUUID(),
      duplicateFirst = part(duplicateFrameId, 0);
    duplicateFirst.framePartition.sequenceNumber = '9007199254740996';
    await service.ingestEvent(duplicateFirst);
    const beforeDuplicate = await source.getRepository(AiObservationEventEntity).count();
    const repeatedRegion = {
      ...part(duplicateFrameId, 1),
      framePartition: { ...duplicateFirst.framePartition, partIndex: 1 },
      observations: duplicateFirst.observations,
    };
    await assert.rejects(
      service.ingestEvent(repeatedRegion),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
    );
    assert.equal(await source.getRepository(AiObservationEventEntity).count(), beforeDuplicate);

    const legacy: Record<string, unknown> = {
      ...first,
      eventId: randomUUID(),
      schemaVersion: '1.3.0',
    };
    delete legacy.framePartition;
    assert.equal((await service.ingestEvent(legacy)).status, 'PROCESSED');
    const beforeRevert = await source.getRepository(AiObservationEventEntity).count();
    const runner = source.createQueryRunner();
    try {
      await new ObservationFrameParts1794009600000().down(runner);
      assert.equal(
        (
          await source.query(
            "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname='uq_ai_event_frame_part'",
          )
        ).length,
        0,
      );
      assert.equal(await source.getRepository(AiObservationEventEntity).count(), beforeRevert);
      await new ObservationFrameParts1794009600000().up(runner);
    } finally {
      await runner.release();
    }
  } finally {
    await owned.dispose();
  }
});
