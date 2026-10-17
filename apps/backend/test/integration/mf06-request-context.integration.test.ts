import { ZoneEntryAssessmentJobEntity } from '../../src/database/entities/zone-entry-assessment-job.entity.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraStatus,
  EventProcessingStatus,
  ZoneEntryAssessmentRequestEntity,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { Mf06RequestContextReader } from '../../src/modules/safety/assessments/mf06-request-context.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase({ canonical: true });
const db = isolated.dataSource;
const reader = new Mf06RequestContextReader(db);
before(() => isolated.initialize());
after(() => isolated.dispose());

const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
async function fixture(ambiguous = false, invalidCanonicalHash = false) {
  const siteId = randomUUID();
  const cameraId = randomUUID();
  const zoneId = randomUUID();
  const regionId = randomUUID();
  const eventId = randomUUID();
  const streamSessionId = randomUUID();
  const externalId = randomUUID();
  await db.getRepository(SiteEntity).insert({ id: siteId, code: siteId, name: 'Context Site' });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId,
    code: cameraId,
    name: 'Context Camera',
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Context Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
  });
  const raw = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: externalId,
    streamSessionId,
    capturedAt: '2026-10-10T00:00:00.123Z',
    frameDimensions: { width: 640, height: 480 },
    observations: [
      { type: 'PERSON', trackId: ambiguous ? 8 : 7, boundingBox: box },
      { type: 'ZONE_ENTRY', trackId: 7, regionId: randomUUID(), geometryVersion: 2 },
      { type: 'PERSON', trackId: 8, boundingBox: { ...box, x1: 0.5, x2: 0.8 } },
      { type: 'ZONE_ENTRY', trackId: 8, regionId, geometryVersion: 3 },
    ],
    evidence: [],
  };
  const payloadHash = invalidCanonicalHash ? 'a'.repeat(64) : computeCanonicalPayloadHash(raw);
  await db.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash,
    cameraExternalId: externalId,
    resolvedCameraId: cameraId,
    streamSessionId,
    capturedAt: new Date(raw.capturedAt),
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
  });
  const selected = selectZoneEntrySubject(raw, 3);
  assert.ok(selected.zoneEligible);
  const requestId = randomUUID();
  await db.getRepository(ZoneEntryAssessmentRequestEntity).insert({
    requestId,
    eventId,
    payloadHash,
    personObservationIndex: selected.personObservationIndex,
    zoneObservationIndex: 3,
    subjectBindingStatus: selected.subjectBindingStatus,
    trackId: 8,
    siteId,
    cameraId,
    cameraExternalId: externalId,
    streamSessionId,
    regionId,
    geometryVersion: 3,
    zoneId,
    capturedAt: new Date(raw.capturedAt),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: 'b'.repeat(64),
  });
  return { siteId, cameraId, zoneId, regionId, requestId, externalId };
}

test('real MF06 context selects the requested second PERSON and denies another Site', async () => {
  const f = await fixture();
  const result = await reader.load(f.siteId.toUpperCase(), f.requestId.toUpperCase());
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;
  assert.equal(result.subject?.personObservationIndex, 2);
  assert.equal(result.subject?.trackId, 8);
  assert.equal(result.subject?.personBoundingBox.x1, 0.5);
  assert.equal(result.request.zoneObservationIndex, 3);
  assert.equal(result.request.regionId, f.regionId);
  assert.equal(result.request.storedBindingHash, 'b'.repeat(64));
  assert.equal('workerId' in result, false);
  assert.equal('authoritySnapshot' in result, false);
  assert.equal('outcome' in result, false);
  assert.deepEqual(await reader.load(randomUUID(), f.requestId), {
    status: 'UNAVAILABLE',
    reason: 'REQUEST_NOT_FOUND',
  });
  assert.deepEqual(await reader.load(f.siteId, randomUUID()), {
    status: 'UNAVAILABLE',
    reason: 'REQUEST_NOT_FOUND',
  });
});

test('real MF06 context retains captured provenance after current Camera edits and deletion', async () => {
  const f = await fixture();
  const original = await reader.load(f.siteId, f.requestId);
  assert.equal(original.status, 'MATCHED');
  await db.getRepository(CameraEntity).update(f.cameraId, {
    externalId: randomUUID(),
    status: CameraStatus.INACTIVE,
    name: 'Changed current metadata',
  });
  await db.getRepository(ZoneEntity).update(f.zoneId, { name: 'Renamed current Zone' });
  assert.deepEqual(await reader.load(f.siteId, f.requestId), original);
  await db.getRepository(CameraEntity).delete(f.cameraId);
  assert.deepEqual(await reader.load(f.siteId, f.requestId), original);
  assert.equal(
    await db.getRepository(ZoneEntryAssessmentRequestEntity).countBy({ requestId: f.requestId }),
    1,
  );
  assert.equal(await db.getRepository(ZoneEntryAssessmentJobEntity).count(), 0);
});

test('real stored hash agreement cannot certify a noncanonical MF06 raw event', async () => {
  const f = await fixture(false, true);
  assert.deepEqual(await reader.load(f.siteId, f.requestId), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });
});

test('real ambiguous MF06 Track remains a matched request without a resolved PERSON', async () => {
  const f = await fixture(true);
  const result = await reader.load(f.siteId, f.requestId);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;
  assert.equal(result.request.subjectBindingStatus, 'AMBIGUOUS_PERSON_TRACK');
  assert.equal(result.request.personObservationIndex, null);
  assert.equal(result.subject, null);
});
