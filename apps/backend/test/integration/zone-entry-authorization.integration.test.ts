import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  SiteEntity,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
  ZoneEntity,
  ZoneEntryDecisionEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { createTestConfig } from '../support/config.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import dataSource from '../support/test-data-source.js';

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  try {
    return await fn(dataSource);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

test('legacy single-tier Zone decision compatibility retains allow, deny, expiry, unknown and idempotent records', async () => {
  await withDataSource(async (source) => {
    const siteId = randomUUID();
    const zoneId = randomUUID();
    const cameraId = randomUUID();
    const regionId = randomUUID();
    const eventId = randomUUID();
    const capturedAt = new Date('2026-09-28T08:00:00.000Z');

    await source
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: `S-${siteId}`, name: 'Site' });
    await source.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: `CAM-${cameraId}`,
      code: `C-${cameraId}`,
      name: 'Camera',
      status: CameraStatus.ACTIVE,
    });
    await source.getRepository(ZoneEntity).insert({
      id: zoneId,
      siteId,
      code: `Z-${zoneId}`,
      name: 'Restricted',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
      configurationLocked: false,
    });
    const workforce = new WorkforceConfigurationService(source);
    const createdWorker = await workforce.create(siteId, {
      externalId: 'WORKER-001',
      displayName: 'Worker One',
    });
    assert.equal(createdWorker.siteId, siteId);
    const actualWorkerId = createdWorker.id;
    await source.getRepository(CameraObservationRegionEntity).insert({
      id: regionId,
      cameraId,
      zoneId,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    });
    await source.getRepository(AiObservationEventEntity).insert({
      eventId,
      payloadHash: 'a'.repeat(64),
      cameraExternalId: `CAM-${cameraId}`,
      resolvedCameraId: cameraId,
      streamSessionId: randomUUID(),
      capturedAt,
      receivedAt: capturedAt,
      rawPayload: {},
      processingStatus: EventProcessingStatus.SKIPPED_NO_CANDIDATE,
      processingNote: null,
    });

    const access = new ZoneAccessManagementService(source);
    // Existing legacy projection, not a new ALLOW command or proof of a
    // historical COMPLETE two-tier authority snapshot.
    await source.getRepository(ZoneAccessGrantEntity).insert({
      id: randomUUID(),
      siteId,
      zoneId,
      workerId: actualWorkerId,
      contractorId: null,
      effect: ZoneAccessEffect.ALLOW,
      validFrom: new Date('2026-09-28T07:00:00.000Z'),
      validUntil: new Date('2026-09-28T09:00:00.000Z'),
      revokedAt: null,
    });

    const service = new ZoneEntryAuthorizationService();
    const allowed = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 7,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(allowed.status, 'ALLOWED');
    assert.equal(allowed.workerId, actualWorkerId);

    await access.createGrant(siteId, zoneId, {
      workerId: actualWorkerId,
      effect: ZoneAccessEffect.DENY,
      validFrom: '2026-09-28T07:30:00.000Z',
      validUntil: null,
    });
    const denied = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: 'WORKER-001',
        verifiedWorkerId: actualWorkerId,
        trackId: 8,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(denied.status, 'DENIED');
    assert.equal(denied.reasonCode, 'EXPLICIT_DENY');

    const unknown = await source.transaction((manager) =>
      service.decide(manager, {
        eventId,
        siteId,
        zoneId,
        candidateWorkerId: undefined,
        trackId: 9,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      }),
    );
    assert.equal(unknown.status, 'UNAVAILABLE');

    await source.transaction(async (manager) => {
      await service.record(
        manager,
        {
          eventId,
          siteId,
          zoneId,
          candidateWorkerId: 'WORKER-001',
          trackId: 7,
          evaluatedAt: capturedAt,
        },
        allowed,
      );
      await service.record(
        manager,
        {
          eventId,
          siteId,
          zoneId,
          candidateWorkerId: 'WORKER-001',
          trackId: 7,
          evaluatedAt: capturedAt,
        },
        allowed,
      );
    });
    const recorded = await source.getRepository(ZoneEntryDecisionEntity).findBy({ eventId });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.status, 'ALLOWED');

    const denyGrant = (await access.listGrants(siteId, zoneId, 0, 20)).items.find(
      (grant) => grant.effect === ZoneAccessEffect.DENY,
    )!;
    await access.revokeGrant(siteId, zoneId, denyGrant.id, capturedAt);
    const ingestionEventId = randomUUID();
    const ingestion = new AiIngestionService(
      source,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(createTestConfig({ ALERT_COOLDOWN_SECONDS: '60' })),
      createTestConfig(),
      () => capturedAt,
      service,
    );
    const result = await ingestion.ingestEvent({
      eventId: ingestionEventId,
      schemaVersion: '1.0.0',
      cameraExternalId: `CAM-${cameraId}`,
      streamSessionId: randomUUID(),
      capturedAt: capturedAt.toISOString(),
      frameDimensions: { width: 1280, height: 720 },
      observations: [
        // A candidate summary must bind to one original PERSON in this event.
        // This evidence still does not verify a Worker or grant Zone access.
        {
          type: 'PERSON',
          trackId: 42,
          confidence: 0.95,
          boundingBox: {
            x1: 0.1,
            y1: 0.1,
            x2: 0.4,
            y2: 0.8,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          type: 'IDENTITY_CANDIDATE',
          trackId: 42,
          status: 'CANDIDATE',
          candidateWorkerId: 'WORKER-001',
          similarityScore: 0.98,
        },
        { type: 'ZONE_ENTRY', trackId: 42, regionId, geometryVersion: 1 },
      ],
      evidence: [],
    });
    assert.equal(result.status, EventProcessingStatus.PROCESSED);
    assert.equal(result.alertIds.length, 1);
    const unverifiedDecision = await source
      .getRepository(ZoneEntryDecisionEntity)
      .findOneByOrFail({ eventId: ingestionEventId, trackId: 42, zoneId });
    assert.equal(unverifiedDecision.status, 'UNAVAILABLE');
    assert.equal(unverifiedDecision.reasonCode, 'IDENTITY_UNAVAILABLE');
    assert.equal(unverifiedDecision.workerId, null);
    assert.equal(unverifiedDecision.candidateWorkerId, 'WORKER-001');
    const decisions = await access.listDecisions(siteId, { zoneId, offset: 0, limit: 20 });
    assert.equal(decisions.total, 2);
    assert.deepEqual(decisions.items.map((decision) => decision.status).sort(), [
      'ALLOWED',
      'UNAVAILABLE',
    ]);

    // Immutable v1 accepts zero and Track IDs beyond PostgreSQL INTEGER.
    for (const trackId of [0, 2147483648, Number.MAX_SAFE_INTEGER]) {
      const input = { eventId, siteId, zoneId, trackId, evaluatedAt: capturedAt };
      await source.transaction(async (manager) => {
        await service.record(manager, input, unknown);
        await service.record(manager, input, unknown);
      });
      const rows = await source.getRepository(ZoneEntryDecisionEntity).findBy({ eventId, trackId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.trackId, trackId);
      assert.equal(typeof rows[0]!.trackId, 'number');
    }
    const largeDecisions = await access.listDecisions(siteId, { zoneId, offset: 0, limit: 20 });
    assert.equal(largeDecisions.total, 5);
    for (const { trackId } of largeDecisions.items) {
      assert.equal(typeof JSON.parse(JSON.stringify({ trackId })).trackId, 'number');
    }

    // Identity review reads the original decision; it never uses a face candidate as authority.
    const exact = await access.listObservationDecisions(siteId, eventId, Number.MAX_SAFE_INTEGER);
    assert.equal(exact.total, 1);
    assert.equal(exact.items[0]?.status, 'UNAVAILABLE');
    assert.deepEqual(Object.keys(exact.items[0]!).sort(), [
      'evaluatedAt',
      'id',
      'reasonCode',
      'status',
      'zoneId',
    ]);
    assert.deepEqual(
      await access.listObservationDecisions(randomUUID(), eventId, Number.MAX_SAFE_INTEGER),
      { items: [], total: 0 },
    );
    assert.deepEqual(
      await access.listObservationDecisions(siteId, randomUUID(), Number.MAX_SAFE_INTEGER),
      { items: [], total: 0 },
    );
    assert.deepEqual(await access.listObservationDecisions(siteId, eventId, 999), {
      items: [],
      total: 0,
    });
    const otherZoneId = randomUUID();
    await source.getRepository(ZoneEntity).insert({
      id: otherZoneId,
      siteId,
      code: `Z-${otherZoneId}`,
      name: 'Overlapping zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      requiredPpe: [],
      configurationLocked: false,
    });
    await source.transaction(async (manager) => {
      const input = {
        eventId,
        siteId,
        zoneId: otherZoneId,
        trackId: Number.MAX_SAFE_INTEGER,
        evaluatedAt: capturedAt,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      };
      await service.record(manager, input, await service.decide(manager, input));
    });
    const overlapping = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
    );
    assert.equal(overlapping.total, 2);
    assert.deepEqual(
      new Set(overlapping.items.map((item) => item.status)),
      new Set(['DENIED', 'UNAVAILABLE']),
    );
    const first = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
      0,
      1,
    );
    const second = await access.listObservationDecisions(
      siteId,
      eventId,
      Number.MAX_SAFE_INTEGER,
      1,
      1,
    );
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    assert.deepEqual([...first.items, ...second.items], overlapping.items);
  });
});
