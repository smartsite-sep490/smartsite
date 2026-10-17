import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  ZoneEntryAssessmentJobEntity,
  ZoneEntryAssessmentRequestEntity,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { parseNormalizedCapturedAt } from '../../src/common/parse-normalized-captured-at.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { Mf06EnqueueService } from '../../src/modules/safety/assessments/mf06-enqueue.service.js';

// -----------------------------------------------------------------------------
// Test Database & Synthetic Fixtures Setup
// -----------------------------------------------------------------------------

const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;

before(async () => {
  await isolated.initialize();
});

it('committed raw event without requests cannot be backfilled from a reassigned current Camera', async () => {
  const service = new Mf06EnqueueService(db);
  let infra!: InfrastructureFixture;
  let event!: AiObservationEventEntity;
  await db.transaction(async (manager) => {
    infra = await setupInfrastructure(manager);
    event = await insertSyntheticEvent(manager, {
      infra,
      observations: [createPersonObservation(7), createZoneEntryObservation(7, infra.region1Id)],
    });
  });
  const replacementSite = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: replacementSite, code: replacementSite, name: 'Synthetic reassignment' });
  await db.getRepository(CameraEntity).update(infra.cameraId, { siteId: replacementSite });
  const ids = await db.transaction((manager) => service.enqueueFresh(manager, event));
  assert.deepEqual(ids, []);
  assert.equal(
    await db.getRepository(ZoneEntryAssessmentRequestEntity).countBy({ eventId: event.eventId }),
    0,
  );
});

it('historical replay retains original request and job head after current Camera is deactivated', async () => {
  const service = new Mf06EnqueueService(db);
  let infra!: InfrastructureFixture;
  let event!: AiObservationEventEntity;
  let original!: readonly string[];
  await db.transaction(async (manager) => {
    infra = await setupInfrastructure(manager);
    event = await insertSyntheticEvent(manager, {
      infra,
      observations: [createPersonObservation(8), createZoneEntryObservation(8, infra.region1Id)],
    });
    original = await service.enqueueFresh(manager, event);
    assert.equal(original.length, 1);
  });
  const jobBefore = await db
    .getRepository(ZoneEntryAssessmentJobEntity)
    .findOneByOrFail({ requestId: original[0] });
  await db
    .getRepository(CameraEntity)
    .update(infra.cameraId, { status: CameraStatus.INACTIVE, externalId: randomUUID() });
  assert.deepEqual(
    await db.transaction((manager) => service.enqueueFresh(manager, event)),
    original,
  );
  assert.deepEqual(
    await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneByOrFail({ requestId: original[0] }),
    jobBefore,
  );
});

it('a caller event hash mismatch cannot redirect a stored fresh source', async () => {
  const service = new Mf06EnqueueService(db);
  await db.transaction(async (manager) => {
    const infra = await setupInfrastructure(manager);
    const event = await insertSyntheticEvent(manager, {
      infra,
      observations: [createPersonObservation(9), createZoneEntryObservation(9, infra.region1Id)],
    });
    assert.deepEqual(
      await service.enqueueFresh(manager, { ...event, payloadHash: 'b'.repeat(64) }),
      [],
    );
    assert.equal(
      await manager
        .getRepository(ZoneEntryAssessmentRequestEntity)
        .countBy({ eventId: event.eventId }),
      0,
    );
  });
});

it('historical replay also rejects a caller hash mismatch instead of returning another binding', async () => {
  const service = new Mf06EnqueueService(db);
  let event!: AiObservationEventEntity;
  await db.transaction(async (manager) => {
    const infra = await setupInfrastructure(manager);
    event = await insertSyntheticEvent(manager, {
      infra,
      observations: [createPersonObservation(10), createZoneEntryObservation(10, infra.region1Id)],
    });
    assert.equal((await service.enqueueFresh(manager, event)).length, 1);
  });
  assert.deepEqual(
    await db.transaction((manager) =>
      service.enqueueFresh(manager, { ...event, payloadHash: 'b'.repeat(64) }),
    ),
    [],
  );
});

it('malformed UUID or hash is refused before PostgreSQL casts poison the caller transaction', async () => {
  const service = new Mf06EnqueueService(db);
  await db.transaction(async (manager) => {
    const infra = await setupInfrastructure(manager);
    const event = await insertSyntheticEvent(manager, {
      infra,
      observations: [createPersonObservation(11), createZoneEntryObservation(11, infra.region1Id)],
    });
    assert.deepEqual(await service.enqueueFresh(manager, { ...event, eventId: 'invalid' }), []);
    assert.deepEqual(await service.enqueueFresh(manager, { ...event, payloadHash: 'invalid' }), []);
    assert.equal((await manager.query('SELECT 1 AS n'))[0].n, 1);
    assert.equal((await service.enqueueFresh(manager, event)).length, 1);
  });
});

after(async () => {
  await isolated.dispose();
});

interface InfrastructureFixture {
  siteId: string;
  cameraId: string;
  externalId: string;
  zone1Id: string;
  zone2Id: string;
  region1Id: string;
  region2Id: string;
}

async function setupInfrastructure(manager: EntityManager): Promise<InfrastructureFixture> {
  const siteId = randomUUID();
  const cameraId = randomUUID();
  const externalId = `cam-ext-${randomUUID().slice(0, 8)}`;
  const zone1Id = randomUUID();
  const zone2Id = randomUUID();
  const region1Id = randomUUID();
  const region2Id = randomUUID();

  await manager.getRepository(SiteEntity).insert({
    id: siteId,
    code: `SITE-${siteId.slice(0, 6)}`,
    name: 'Synthetic Test Site',
  });

  await manager.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId,
    code: `CAM-${cameraId.slice(0, 6)}`,
    name: 'Synthetic Test Camera',
    status: CameraStatus.ACTIVE,
  });

  await manager.getRepository(ZoneEntity).insert([
    {
      id: zone1Id,
      siteId,
      code: `ZONE-01-${zone1Id.slice(0, 6)}`,
      name: 'Restricted Zone 1',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    },
    {
      id: zone2Id,
      siteId,
      code: `ZONE-02-${zone2Id.slice(0, 6)}`,
      name: 'Restricted Zone 2',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    },
  ]);

  const defaultPolygon = {
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };

  await manager.getRepository(CameraObservationRegionEntity).insert([
    {
      id: region1Id,
      cameraId,
      zoneId: zone1Id,
      polygon: defaultPolygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    },
    {
      id: region2Id,
      cameraId,
      zoneId: zone2Id,
      polygon: defaultPolygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    },
  ]);

  return { siteId, cameraId, externalId, zone1Id, zone2Id, region1Id, region2Id };
}

const standardPersonBox = Object.freeze({
  x1: 0.1,
  y1: 0.2,
  x2: 0.4,
  y2: 0.8,
  coordinateSpace: 'NORMALIZED_0_1',
});

function createPersonObservation(trackId: number, box: unknown = standardPersonBox) {
  return {
    type: 'PERSON',
    confidence: 0.9,
    trackId,
    boundingBox: box,
  };
}

function createZoneEntryObservation(trackId: number, regionId: string, geometryVersion = 1) {
  return {
    type: 'ZONE_ENTRY',
    trackId,
    regionId,
    geometryVersion,
  };
}

interface CreateEventOptions {
  infra: InfrastructureFixture;
  observations: Array<Record<string, unknown>>;
  capturedAt?: string;
  processingStatus?: EventProcessingStatus;
  processingNote?: string | null;
  resolvedCameraId?: string | null;
  corruptHash?: boolean;
}

async function insertSyntheticEvent(
  manager: EntityManager,
  options: CreateEventOptions,
): Promise<AiObservationEventEntity> {
  const eventId = randomUUID();
  const streamSessionId = randomUUID();
  const capturedAtStr = options.capturedAt ?? '2026-10-10T12:00:00.123Z';
  const capturedAt = parseNormalizedCapturedAt(capturedAtStr);
  assert.ok(capturedAt, 'capturedAt must be a parseable timestamp');

  const rawPayload = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: options.infra.externalId,
    streamSessionId,
    capturedAt: capturedAtStr,
    frameDimensions: { width: 1280, height: 720 },
    observations: options.observations,
    evidence: [],
  };

  const payloadHash = options.corruptHash
    ? '0'.repeat(64)
    : computeCanonicalPayloadHash(rawPayload);

  const eventRepo = manager.getRepository(AiObservationEventEntity);
  const event = eventRepo.create({
    eventId,
    payloadHash,
    cameraExternalId: options.infra.externalId,
    resolvedCameraId:
      options.resolvedCameraId !== undefined ? options.resolvedCameraId : options.infra.cameraId,
    streamSessionId,
    capturedAt,
    receivedAt: new Date(),
    rawPayload,
    processingStatus: options.processingStatus ?? EventProcessingStatus.SKIPPED_NO_CANDIDATE,
    processingNote: options.processingNote ?? null,
  });

  await eventRepo.insert(event as unknown as QueryDeepPartialEntity<AiObservationEventEntity>);
  return event;
}

// -----------------------------------------------------------------------------
// Test Suite: MF06 Enqueue Service Integration Tests
// -----------------------------------------------------------------------------

describe('MF06 Enqueue Service Integration Tests (B3 Software-Only)', () => {
  it('Case 1: enqueues 1 request and 1 PENDING job for single eligible ZONE_ENTRY under SKIPPED_NO_CANDIDATE', async () => {
    const service = new Mf06EnqueueService(db);

    let createdRequestIds: readonly string[] = [];
    let savedEventId = '';
    let infraRef!: InfrastructureFixture;

    await db.transaction(async (manager) => {
      infraRef = await setupInfrastructure(manager);
      const observations = [
        createPersonObservation(101),
        createZoneEntryObservation(101, infraRef.region1Id, 1),
      ];

      const event = await insertSyntheticEvent(manager, {
        infra: infraRef,
        observations,
        processingStatus: EventProcessingStatus.SKIPPED_NO_CANDIDATE,
      });
      savedEventId = event.eventId;

      createdRequestIds = await service.enqueueFresh(manager, event);
    });

    assert.equal(createdRequestIds.length, 1, 'Exactly one request ID must be returned');
    const [requestId] = createdRequestIds;
    assert.ok(requestId, 'requestId must be defined');

    const requestRepo = db.getRepository(ZoneEntryAssessmentRequestEntity);
    const request = await requestRepo.findOneBy({ requestId });
    assert.ok(request, 'ZoneEntryAssessmentRequestEntity must be persisted in database');

    assert.equal(request.eventId, savedEventId);
    assert.equal(request.personObservationIndex, 0);
    assert.equal(request.zoneObservationIndex, 1);
    assert.equal(request.subjectBindingStatus, 'BOUND');
    assert.equal(request.trackId, 101);
    assert.equal(request.siteId, infraRef.siteId);
    assert.equal(request.cameraId, infraRef.cameraId);
    assert.equal(request.cameraExternalId, infraRef.externalId);
    assert.equal(request.zoneId, infraRef.zone1Id);
    assert.equal(request.regionId, infraRef.region1Id);
    assert.equal(request.geometryVersion, 1);
    assert.equal(request.requestedPurpose, 'INITIAL_OBSERVATION_ASSESSMENT');
    assert.equal(request.requestRevision, 1);
    assert.match(request.bindingHash, /^[0-9a-f]{64}$/);

    const jobRepo = db.getRepository(ZoneEntryAssessmentJobEntity);
    const job = await jobRepo.findOneBy({ requestId });
    assert.ok(job, 'ZoneEntryAssessmentJobEntity must be persisted in database');

    assert.equal(job.status, 'PENDING');
    assert.equal(job.attemptCount, 0);
    assert.equal(job.headRevision, 1);
    assert.equal(job.leaseToken, null);
    assert.equal(job.leaseExpiresAt, null);
    assert.equal(job.lastErrorCode, null);
    assert.ok(job.nextAttemptAt instanceof Date);
    assert.ok(job.deadlineAt instanceof Date);
    assert.ok(
      job.deadlineAt.getTime() > job.createdAt.getTime(),
      'Job deadline must be in the future of creation time',
    );
  });

  it('Case 2: correctly binds multiple ZONE_ENTRY observations to distinct PERSON and region indices', async () => {
    const service = new Mf06EnqueueService(db);

    let requestIds: readonly string[] = [];
    let infraRef!: InfrastructureFixture;

    await db.transaction(async (manager) => {
      infraRef = await setupInfrastructure(manager);
      const observations = [
        createPersonObservation(101),
        createZoneEntryObservation(101, infraRef.region1Id, 1),
        createPersonObservation(202),
        createZoneEntryObservation(202, infraRef.region2Id, 1),
      ];

      const event = await insertSyntheticEvent(manager, {
        infra: infraRef,
        observations,
        processingStatus: EventProcessingStatus.PROCESSED,
      });

      requestIds = await service.enqueueFresh(manager, event);
    });

    assert.equal(
      requestIds.length,
      2,
      'Two requests must be generated for two distinct zone entries',
    );

    const requestRepo = db.getRepository(ZoneEntryAssessmentRequestEntity);
    const requests = await requestRepo.find({
      where: [{ requestId: requestIds[0] }, { requestId: requestIds[1] }],
    });
    assert.equal(requests.length, 2);

    const req1 = requests.find((r) => r.trackId === 101);
    const req2 = requests.find((r) => r.trackId === 202);

    assert.ok(req1, 'Request for track 101 must exist');
    assert.ok(req2, 'Request for track 202 must exist');

    assert.equal(req1.personObservationIndex, 0);
    assert.equal(req1.zoneObservationIndex, 1);
    assert.equal(req1.regionId, infraRef.region1Id);
    assert.equal(req1.zoneId, infraRef.zone1Id);
    assert.equal(req1.subjectBindingStatus, 'BOUND');

    assert.equal(req2.personObservationIndex, 2);
    assert.equal(req2.zoneObservationIndex, 3);
    assert.equal(req2.regionId, infraRef.region2Id);
    assert.equal(req2.zoneId, infraRef.zone2Id);
    assert.equal(req2.subjectBindingStatus, 'BOUND');

    const jobRepo = db.getRepository(ZoneEntryAssessmentJobEntity);
    const jobs = await jobRepo.find({
      where: [{ requestId: requestIds[0] }, { requestId: requestIds[1] }],
    });
    assert.equal(jobs.length, 2, 'Each request must have an associated job');
    for (const job of jobs) {
      assert.equal(job.status, 'PENDING');
      assert.equal(job.headRevision, 1);
    }
  });

  it('Case 3: handles PERSON_NOT_FOUND, AMBIGUOUS_PERSON_TRACK, and dedupes duplicate entries without job duplication', async () => {
    const service = new Mf06EnqueueService(db);

    await db.transaction(async (manager) => {
      const infra = await setupInfrastructure(manager);

      // Subcase 3a: PERSON_NOT_FOUND (Zone entry with no person having matching trackId)
      const eventNotFound = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(999), // Different trackId
          createZoneEntryObservation(303, infra.region1Id, 1),
        ],
      });
      const idsNotFound = await service.enqueueFresh(manager, eventNotFound);
      assert.equal(idsNotFound.length, 1);

      const reqNotFound = await manager
        .getRepository(ZoneEntryAssessmentRequestEntity)
        .findOneBy({ requestId: idsNotFound[0] });
      assert.ok(reqNotFound);
      assert.equal(reqNotFound.subjectBindingStatus, 'PERSON_NOT_FOUND');
      assert.equal(reqNotFound.personObservationIndex, null);
      assert.equal(reqNotFound.trackId, 303);

      const jobNotFound = await manager
        .getRepository(ZoneEntryAssessmentJobEntity)
        .findOneBy({ requestId: idsNotFound[0] });
      assert.ok(jobNotFound);
      assert.equal(jobNotFound.status, 'PENDING');

      // Subcase 3b: AMBIGUOUS_PERSON_TRACK (Zone entry with 2 PERSONs sharing same trackId)
      const eventAmbiguous = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(404),
          createPersonObservation(404),
          createZoneEntryObservation(404, infra.region1Id, 1),
        ],
      });
      const idsAmbiguous = await service.enqueueFresh(manager, eventAmbiguous);
      assert.equal(idsAmbiguous.length, 1);

      const reqAmbiguous = await manager
        .getRepository(ZoneEntryAssessmentRequestEntity)
        .findOneBy({ requestId: idsAmbiguous[0] });
      assert.ok(reqAmbiguous);
      assert.equal(reqAmbiguous.subjectBindingStatus, 'AMBIGUOUS_PERSON_TRACK');
      assert.equal(reqAmbiguous.personObservationIndex, null);
      assert.equal(reqAmbiguous.trackId, 404);

      // Subcase 3c: Multiple identical ZONE_ENTRY observations within same raw payload
      // Different raw zone indices remain distinct; replay of each exact key deduplicates.
      const eventDuplicateEntries = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(505),
          createZoneEntryObservation(505, infra.region1Id, 1),
          createZoneEntryObservation(505, infra.region1Id, 1),
        ],
      });
      const idsDuplicate = await service.enqueueFresh(manager, eventDuplicateEntries);
      assert.equal(
        idsDuplicate.length,
        2,
        'Distinct raw zone observation indices must remain distinct',
      );

      const jobsForDuplicate = await manager
        .getRepository(ZoneEntryAssessmentJobEntity)
        .find({ where: { requestId: idsDuplicate[0] } });
      assert.equal(jobsForDuplicate.length, 1, 'Exactly one job must exist for deduped request');
    });
  });

  it('Case 4: returns zero enqueue for invalid clock skew, unknown camera, missing zone entry, or invalid geometry', async () => {
    const service = new Mf06EnqueueService(db);

    await db.transaction(async (manager) => {
      const infra = await setupInfrastructure(manager);

      // Subcase 4a: Clock skew status
      const skewEvent = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(101),
          createZoneEntryObservation(101, infra.region1Id, 1),
        ],
        processingStatus: EventProcessingStatus.SKIPPED_CLOCK_SKEW,
        processingNote: 'Captured time skew exceeded tolerance',
      });
      const skewIds = await service.enqueueFresh(manager, skewEvent);
      assert.deepEqual(skewIds, [], 'Clock skew event must yield zero enqueue');

      // Subcase 4b: Unknown camera status or resolvedCameraId null
      const unknownCamEvent = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(101),
          createZoneEntryObservation(101, infra.region1Id, 1),
        ],
        processingStatus: EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA,
        resolvedCameraId: null,
      });
      const unknownCamIds = await service.enqueueFresh(manager, unknownCamEvent);
      assert.deepEqual(unknownCamIds, [], 'Unknown camera event must yield zero enqueue');

      // Subcase 4c: No ZONE_ENTRY observation present (only PERSON)
      const noZoneEvent = await insertSyntheticEvent(manager, {
        infra,
        observations: [createPersonObservation(101)],
        processingStatus: EventProcessingStatus.PROCESSED,
      });
      const noZoneIds = await service.enqueueFresh(manager, noZoneEvent);
      assert.deepEqual(noZoneIds, [], 'Event without ZONE_ENTRY must yield zero enqueue');

      // Subcase 4d: Invalid geometry / unconfigured regionId
      const unconfiguredRegionId = randomUUID();
      const invalidGeoEvent = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(101),
          createZoneEntryObservation(101, unconfiguredRegionId, 999),
        ],
        processingStatus: EventProcessingStatus.PROCESSED,
      });
      const invalidGeoIds = await service.enqueueFresh(manager, invalidGeoEvent);
      assert.deepEqual(invalidGeoIds, [], 'Event with unconfigured region must yield zero enqueue');

      // Subcase 4e: Corrupted payload hash
      const corruptHashEvent = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(101),
          createZoneEntryObservation(101, infra.region1Id, 1),
        ],
        processingStatus: EventProcessingStatus.PROCESSED,
        corruptHash: true,
      });
      const corruptHashIds = await service.enqueueFresh(manager, corruptHashEvent);
      assert.deepEqual(
        corruptHashIds,
        [],
        'Event with corrupt payload hash must yield zero enqueue',
      );

      // Verify that no requests or jobs were written for any of these invalid events
      const allRequests = await manager.getRepository(ZoneEntryAssessmentRequestEntity).find({
        where: [
          { eventId: skewEvent.eventId },
          { eventId: unknownCamEvent.eventId },
          { eventId: noZoneEvent.eventId },
          { eventId: invalidGeoEvent.eventId },
          { eventId: corruptHashEvent.eventId },
        ],
      });
      assert.equal(allRequests.length, 0, 'No requests must be persisted for invalid events');
    });
  });

  it('Case 5: caller transaction rollback completely eliminates persisted event, request, and job', async () => {
    const service = new Mf06EnqueueService(db);
    let capturedEventId = '';
    let capturedRequestId = '';

    await assert.rejects(
      db.transaction(async (manager) => {
        const infra = await setupInfrastructure(manager);
        const event = await insertSyntheticEvent(manager, {
          infra,
          observations: [
            createPersonObservation(707),
            createZoneEntryObservation(707, infra.region1Id, 1),
          ],
          processingStatus: EventProcessingStatus.PROCESSED,
        });
        capturedEventId = event.eventId;

        const requestIds = await service.enqueueFresh(manager, event);
        assert.equal(requestIds.length, 1);
        capturedRequestId = requestIds[0]!;

        // Intentionally abort the caller transaction
        throw new Error('Simulated caller rollback');
      }),
      /Simulated caller rollback/,
    );

    assert.ok(capturedEventId, 'Event ID must have been set before rollback');
    assert.ok(capturedRequestId, 'Request ID must have been set before rollback');

    const eventInDb = await db
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: capturedEventId });
    assert.equal(eventInDb, null, 'Rolled-back event must not exist in database');

    const requestInDb = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneBy({ requestId: capturedRequestId });
    assert.equal(requestInDb, null, 'Rolled-back assessment request must not exist in database');

    const jobInDb = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findOneBy({ requestId: capturedRequestId });
    assert.equal(jobInDb, null, 'Rolled-back assessment job must not exist in database');
  });

  it('Case 6: repeated enqueueFresh on same event is idempotent and does not duplicate requests or jobs', async () => {
    const service = new Mf06EnqueueService(db);
    let infra!: InfrastructureFixture;
    let event!: AiObservationEventEntity;
    let initialRequestIds: readonly string[] = [];

    // First transaction: initial event insert & enqueue
    await db.transaction(async (manager) => {
      infra = await setupInfrastructure(manager);
      event = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(808),
          createZoneEntryObservation(808, infra.region1Id, 1),
        ],
        processingStatus: EventProcessingStatus.PROCESSED,
      });

      initialRequestIds = await service.enqueueFresh(manager, event);
    });

    assert.equal(initialRequestIds.length, 1);
    const initialRequestId = initialRequestIds[0]!;

    // Second transaction: re-invoking enqueueFresh on the exact same event
    let repeatedRequestIds: readonly string[] = [];
    await db.transaction(async (manager) => {
      repeatedRequestIds = await service.enqueueFresh(manager, event);
    });

    // Idempotent return: either returns existing request IDs or empty array indicating zero new enqueue
    assert.deepEqual(
      repeatedRequestIds,
      initialRequestIds,
      'Replay returns exact retained request IDs',
    );
    if (repeatedRequestIds.length > 0) {
      assert.equal(
        repeatedRequestIds[0],
        initialRequestId,
        'Replayed enqueue must match original request ID if returned',
      );
    }

    // Database verification: must still have exactly 1 request and 1 job
    const requests = await db
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findBy({ eventId: event.eventId });
    assert.equal(requests.length, 1, 'Exactly one request must exist in database after replay');

    const jobs = await db
      .getRepository(ZoneEntryAssessmentJobEntity)
      .findBy({ requestId: initialRequestId });
    assert.equal(jobs.length, 1, 'Exactly one job must exist in database after replay');
    assert.equal(jobs[0]?.status, 'PENDING');
    assert.equal(jobs[0]?.headRevision, 1);
  });

  it('Case 7: enforces exact active transaction guard', async () => {
    const service = new Mf06EnqueueService(db);

    let infra!: InfrastructureFixture;
    let event!: AiObservationEventEntity;

    await db.transaction(async (manager) => {
      infra = await setupInfrastructure(manager);
      event = await insertSyntheticEvent(manager, {
        infra,
        observations: [
          createPersonObservation(909),
          createZoneEntryObservation(909, infra.region1Id, 1),
        ],
        processingStatus: EventProcessingStatus.PROCESSED,
      });
    });

    // Calling enqueueFresh with an inactive / non-transactional manager must fail closed
    const nonTxManager = db.manager;
    await assert.rejects(
      async () => {
        await service.enqueueFresh(nonTxManager, event);
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'MF06_ACTIVE_TRANSACTION_REQUIRED');
        return true;
      },
      'enqueueFresh must reject when called outside an active transaction',
    );
  });
});
