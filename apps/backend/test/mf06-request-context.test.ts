import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import {
  Mf06RequestContextReader,
  inspectMf06StoredBinding,
} from '../src/modules/safety/assessments/mf06-request-context.js';

function fixture() {
  const cameraId = randomUUID(),
    eventId = randomUUID(),
    streamSessionId = randomUUID();
  const regionId = randomUUID(),
    otherRegionId = randomUUID();
  const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
  const raw = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: `CAM-${cameraId}`,
    streamSessionId,
    capturedAt: '2026-10-01T00:00:00Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      { type: 'PERSON', trackId: 7, boundingBox: box },
      { type: 'PERSON', trackId: 8, boundingBox: box },
      { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 3 },
      { type: 'ZONE_ENTRY', trackId: 8, regionId: otherRegionId, geometryVersion: 5 },
    ],
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg` }],
  };
  const event = {
    eventId,
    payloadHash: computeCanonicalPayloadHash(raw),
    cameraExternalId: raw.cameraExternalId,
    resolvedCameraId: cameraId,
    streamSessionId,
    capturedAt: new Date(raw.capturedAt),
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
  } as AiObservationEventEntity;
  const request = {
    requestId: randomUUID(),
    eventId,
    payloadHash: event.payloadHash,
    personObservationIndex: 0,
    zoneObservationIndex: 2,
    subjectBindingStatus: 'BOUND',
    trackId: 7,
    siteId: randomUUID(),
    cameraId,
    cameraExternalId: raw.cameraExternalId,
    streamSessionId,
    regionId,
    geometryVersion: 3,
    zoneId: randomUUID(),
    capturedAt: new Date(raw.capturedAt),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: 'b'.repeat(64),
    requestedAt: new Date('2026-10-01T00:01:00Z'),
  } as ZoneEntryAssessmentRequestEntity;
  const rehash = () => {
    event.payloadHash = computeCanonicalPayloadHash(event.rawPayload);
    request.payloadHash = event.payloadHash;
  };
  return { request, event, raw, otherRegionId, rehash };
}

test('MF06 context binds the exact requested PERSON/Zone indices, not first available person', () => {
  const f = fixture();
  Object.assign(f.request, {
    personObservationIndex: 1,
    zoneObservationIndex: 3,
    trackId: 8,
    regionId: f.otherRegionId,
    geometryVersion: 5,
  });
  const result = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;
  assert.equal(result.subject?.personObservationIndex, 1);
  assert.equal(result.subject?.trackId, 8);
  assert.equal(result.request.zoneObservationIndex, 3);
  assert.equal(result.request.siteId, f.request.siteId);
  assert.match(result.contextDigest, /^[0-9a-f]{64}$/);
  assert.equal('workerId' in result, false);
  assert.equal('outcome' in result, false);
  assert.equal(JSON.stringify(result).includes('local://'), false);
});

for (const change of [
  { eventId: randomUUID() },
  { payloadHash: 'c'.repeat(64) },
  { cameraId: randomUUID() },
  { cameraExternalId: 'wrong-camera' },
  { streamSessionId: randomUUID() },
  { capturedAt: new Date('2026-10-01T00:00:01Z') },
  { trackId: 8 },
  { regionId: randomUUID() },
  { geometryVersion: 4 },
  { personObservationIndex: 1 },
  { zoneObservationIndex: 0 },
  { subjectBindingStatus: 'PERSON_NOT_FOUND', personObservationIndex: null },
  { requestRevision: 0 },
  { requestRevision: 2147483648 },
  { bindingHash: 'B'.repeat(64) },
  { requestedPurpose: 'GATE_ENROLLMENT' },
  { requestedAt: new Date(NaN) },
  { siteId: 'invalid' },
] as const)
  test(`MF06 rejects mismatched or malformed stored ${Object.keys(change).join('/')}`, () => {
    const f = fixture();
    Object.assign(f.request, change);
    assert.equal(inspectMf06StoredBinding(f.request, f.event).status, 'UNAVAILABLE');
  });

test('MF06 canonical raw hash rejects an edited source, including a replaced PERSON box', () => {
  const f = fixture();
  f.raw.observations[0]!.trackId = 99;
  assert.equal(inspectMf06StoredBinding(f.request, f.event).status, 'UNAVAILABLE');
});

test('MF06 preserves an unresolved ambiguous subject without inventing identity', () => {
  const f = fixture();
  f.raw.observations[1]!.trackId = 7;
  f.rehash();
  Object.assign(f.request, {
    subjectBindingStatus: 'AMBIGUOUS_PERSON_TRACK',
    personObservationIndex: null,
  });
  const result = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(result.status, 'MATCHED');
  if (result.status === 'MATCHED') assert.equal(result.subject, null);
  Object.assign(f.request, { subjectBindingStatus: 'BOUND', personObservationIndex: 0 });
  assert.equal(inspectMf06StoredBinding(f.request, f.event).status, 'UNAVAILABLE');
});

test('MF06 missing PERSON and missing box remain honest stored unresolved states', () => {
  for (const status of ['PERSON_NOT_FOUND', 'PERSON_BOX_UNAVAILABLE'] as const) {
    const f = fixture();
    if (status === 'PERSON_NOT_FOUND') f.raw.observations[0]!.trackId = 77;
    else delete (f.raw.observations[0] as Record<string, unknown>).boundingBox;
    f.rehash();
    Object.assign(f.request, {
      subjectBindingStatus: status,
      personObservationIndex: status === 'PERSON_NOT_FOUND' ? null : 0,
    });
    const result = inspectMf06StoredBinding(f.request, f.event);
    assert.equal(result.status, 'MATCHED');
    if (result.status === 'MATCHED') assert.equal(result.subject, null);
  }
});

test('MF06 retains captured camera/Site after camera deletion and does not query mutable registry', () => {
  const f = fixture();
  f.event.resolvedCameraId = null;
  const result = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(result.status, 'MATCHED');
  if (result.status === 'MATCHED') assert.equal(result.subject?.cameraId, f.request.cameraId);
});

test('MF06 allows no-candidate event, rejects skipped clock-skew ingestion, and discloses no business result', () => {
  const f = fixture();
  f.event.processingStatus = EventProcessingStatus.SKIPPED_NO_CANDIDATE;
  assert.equal(inspectMf06StoredBinding(f.request, f.event).status, 'MATCHED');
  f.event.processingStatus = EventProcessingStatus.SKIPPED_CLOCK_SKEW;
  assert.equal(inspectMf06StoredBinding(f.request, f.event).status, 'UNAVAILABLE');
});

test('MF06 fresh internal context digest is deterministic, binds purpose/revision and does not certify opaque stored hash', () => {
  const f = fixture();
  const first = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(first.status, 'MATCHED');
  if (first.status !== 'MATCHED') return;
  assert.notEqual(first.contextDigest, f.request.bindingHash);
  assert.deepEqual(inspectMf06StoredBinding(f.request, f.event), first);
  f.request.requestedPurpose = 'RETROSPECTIVE_REVIEW';
  const review = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(review.status, 'MATCHED');
  if (review.status === 'MATCHED') assert.notEqual(review.contextDigest, first.contextDigest);
  f.request.requestRevision++;
  const revision = inspectMf06StoredBinding(f.request, f.event);
  if (revision.status === 'MATCHED') assert.notEqual(revision.contextDigest, first.contextDigest);
});

test('MF06 reader filters exact Site/request and reads source in one repeatable transaction', async () => {
  const f = fixture();
  const calls: unknown[] = [];
  const manager = {
    getRepository: (entity: unknown) => ({
      findOneBy: async (where: Record<string, unknown>) => {
        calls.push({ entity, where });
        if (entity === ZoneEntryAssessmentRequestEntity)
          return where.siteId === f.request.siteId ? f.request : null;
        if (entity === AiObservationEventEntity) return f.event;
        throw new Error('Mutable registry/identity/media must not be consulted');
      },
    }),
  } as unknown as EntityManager;
  const db = {
    transaction: async (isolation: string, operation: (m: EntityManager) => unknown) => {
      assert.equal(isolation, 'REPEATABLE READ');
      return operation(manager);
    },
  } as unknown as DataSource;
  const reader = new Mf06RequestContextReader(db);
  assert.equal((await reader.load(f.request.siteId, f.request.requestId)).status, 'MATCHED');
  assert.deepEqual(calls, [
    {
      entity: ZoneEntryAssessmentRequestEntity,
      where: { requestId: f.request.requestId, siteId: f.request.siteId },
    },
    { entity: AiObservationEventEntity, where: { eventId: f.request.eventId } },
  ]);
  calls.length = 0;
  const denied = await reader.load(randomUUID(), f.request.requestId);
  assert.deepEqual(denied, { status: 'UNAVAILABLE', reason: 'REQUEST_NOT_FOUND' });
  assert.equal(calls.length, 1);
  calls.length = 0;
  assert.equal((await reader.load('invalid', f.request.requestId)).status, 'UNAVAILABLE');
  assert.equal(calls.length, 0);
});

test('MF06 matched snapshots cannot be changed through returned references or later source edits', () => {
  const f = fixture();
  const result = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED' || !result.subject) return;
  const original = JSON.stringify(result);
  f.request.siteId = randomUUID();
  f.request.capturedAt.setTime(0);
  f.raw.observations[0]!.boundingBox!.x1 = 0.3;
  assert.equal(JSON.stringify(result), original);
  assert.throws(() => {
    (result.request as { trackId: number }).trackId = 99;
  }, TypeError);
  assert.throws(() => {
    result.subject!.personBoundingBox.x1 = 0.3;
  }, TypeError);
  assert.throws(() => {
    result.subject!.trackId = 99;
  }, TypeError);
});

test('MF06 scoped reader refuses a wrong request scope from a storage adapter and does not read its event', async () => {
  const f = fixture();
  let eventReads = 0;
  const manager = {
    getRepository: (entity: unknown) => ({
      findOneBy: async () => {
        if (entity === ZoneEntryAssessmentRequestEntity) return f.request;
        eventReads++;
        return f.event;
      },
    }),
  } as unknown as EntityManager;
  const db = {
    transaction: async (_isolation: string, operation: (m: EntityManager) => unknown) =>
      operation(manager),
  } as unknown as DataSource;
  const reader = new Mf06RequestContextReader(db);
  for (const [site, request] of [
    [randomUUID(), f.request.requestId],
    [f.request.siteId, randomUUID()],
  ])
    assert.deepEqual(await reader.load(site!, request!), {
      status: 'UNAVAILABLE',
      reason: 'REQUEST_NOT_FOUND',
    });
  assert.equal(eventReads, 0);
});

test('MF06 internal reader differentiates missing source and preserves infrastructure failure', async () => {
  const f = fixture();
  const fault = new Error('Synthetic database outage');
  const db = {
    transaction: async (_isolation: string, operation: (m: EntityManager) => unknown) =>
      operation({
        getRepository: (entity: unknown) => ({
          findOneBy: async () => (entity === ZoneEntryAssessmentRequestEntity ? f.request : null),
        }),
      } as unknown as EntityManager),
  } as unknown as DataSource;
  assert.deepEqual(
    await new Mf06RequestContextReader(db).load(f.request.siteId, f.request.requestId),
    { status: 'UNAVAILABLE', reason: 'EVENT_NOT_FOUND' },
  );
  const broken = {
    transaction: async () => {
      throw fault;
    },
  } as unknown as DataSource;
  await assert.rejects(
    new Mf06RequestContextReader(broken).load(f.request.siteId, f.request.requestId),
    (error) => error === fault,
  );
});

test('MF06 matches normalized timestamp offsets/fractions while preserving original capturedAt in subject', () => {
  const f = fixture();
  f.raw.capturedAt = '2026-10-01T07:00:00.0000+07:00';
  f.rehash();
  const result = inspectMf06StoredBinding(f.request, f.event);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;
  assert.equal(result.request.capturedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(result.subject?.capturedAt, f.raw.capturedAt);
});
