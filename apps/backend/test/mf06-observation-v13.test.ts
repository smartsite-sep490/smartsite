import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import { selectMf06FrameReference } from '../src/modules/safety/assessments/mf06-frame-reference.js';
import { inspectMf06StoredBinding } from '../src/modules/safety/assessments/mf06-request-context.js';
import { reviewRawEventIsConsistent } from '../src/modules/safety/identity/observation-identity-event.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const CAMERA_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_SESSION_ID = 'ffffffff-1111-4222-8333-444444444444';
const REGION_ID = '66666666-6666-4666-8666-666666666666';
const ZONE_ID = '77777777-7777-4777-8777-777777777777';
const CAPTURED_AT = '2026-10-20T06:00:00.000Z';
const REQUESTED_AT = '2026-10-20T06:00:01.000Z';
const FRAME_SHA = 'a'.repeat(64);
const BINDING_HASH = 'b'.repeat(64);
const ALT_HASH = 'f'.repeat(64);

function makeFrameUri(session = SESSION_ID, seq: number | string = 42, event = EVENT_ID): string {
  return `local://evidence/${session}/${seq}/${event}.jpg`;
}

function makeRawV13Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.3.0',
    eventId: EVENT_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    capturedAt: CAPTURED_AT,
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        confidence: 0.96,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      {
        type: 'ZONE_ENTRY',
        trackId: 7,
        regionId: REGION_ID,
        geometryVersion: 3,
        confidence: 0.95,
      },
      {
        type: 'PPE',
        trackId: 7,
        ppeItem: 'MASK',
        status: 'PRESENT',
        regionId: REGION_ID,
        geometryVersion: 3,
        confidence: 0.91,
        boundingBox: { x1: 0.18, y1: 0.22, x2: 0.3, y2: 0.34, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [{ kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA }],
    ...overrides,
  };
}

function makeV13Fixture(
  rawOverrides: Record<string, unknown> = {},
  persistedOverrides: {
    request?: Partial<ZoneEntryAssessmentRequestEntity>;
    event?: Partial<AiObservationEventEntity>;
  } = {},
) {
  const rawPayload = makeRawV13Payload(rawOverrides);
  const payloadHash = computeCanonicalPayloadHash(rawPayload);

  const request = Object.assign(new ZoneEntryAssessmentRequestEntity(), {
    requestId: REQUEST_ID,
    eventId: EVENT_ID,
    payloadHash,
    personObservationIndex: 0,
    zoneObservationIndex: 1,
    subjectBindingStatus: 'BOUND',
    trackId: 7,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    regionId: REGION_ID,
    geometryVersion: 3,
    zoneId: ZONE_ID,
    capturedAt: new Date(CAPTURED_AT),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: BINDING_HASH,
    requestedAt: new Date(REQUESTED_AT),
    ...persistedOverrides.request,
  });

  const event = Object.assign(new AiObservationEventEntity(), {
    eventId: EVENT_ID,
    schemaVersion: String(rawPayload.schemaVersion ?? '1.3.0'),
    cameraExternalId: 'CAM-NORTH-01',
    resolvedCameraId: CAMERA_ID,
    streamSessionId: SESSION_ID,
    capturedAt: new Date(CAPTURED_AT),
    payloadHash,
    rawPayload,
    processingStatus: EventProcessingStatus.PROCESSED,
    ...persistedOverrides.event,
  });

  return { rawPayload, payloadHash, request, event };
}

test('1. consistent v1.3 PERSON + ZONE_ENTRY + MASK(PRESENT) matches MF06 stored binding and selects FRAME while shared MF08 validator still rejects v1.3', () => {
  const { rawPayload, payloadHash, request, event } = makeV13Fixture();

  assert.equal(reviewRawEventIsConsistent(event), false);

  const inspected = inspectMf06StoredBinding(request, event);
  assert.equal(inspected.status, 'MATCHED');
  if (inspected.status !== 'MATCHED') return;

  assert.equal(inspected.request.eventId, EVENT_ID);
  assert.equal(inspected.request.payloadHash, payloadHash);
  assert.equal(inspected.request.personObservationIndex, 0);
  assert.equal(inspected.request.zoneObservationIndex, 1);
  assert.equal(inspected.subject?.trackId, 7);
  assert.equal(inspected.subject?.capturedAt, CAPTURED_AT);

  const selectedFrame = selectMf06FrameReference(rawPayload, inspected.request);
  assert.notEqual(selectedFrame, null);
  assert.deepEqual(selectedFrame, {
    eventId: EVENT_ID,
    streamSessionId: SESSION_ID,
    sequenceNumber: 42,
    uri: makeFrameUri(),
    sha256: FRAME_SHA,
    payloadHash,
    frameDimensions: { width: 1280, height: 720 },
  });
  assert.equal(Object.isFrozen(selectedFrame), true);
});

test('2. rejects raw/persisted header, timestamp, or payloadHash mismatches, FULL_BODY_HARNESS MISSING, and unknown schemaVersion', () => {
  const base = makeV13Fixture();

  for (const mismatch of [
    makeV13Fixture({ cameraExternalId: 'CAM-OTHER-99' }),
    makeV13Fixture({
      eventId: OTHER_EVENT_ID,
      evidence: [
        { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, 42, OTHER_EVENT_ID), sha256: FRAME_SHA },
      ],
    }),
    makeV13Fixture({
      streamSessionId: OTHER_SESSION_ID,
      evidence: [
        { kind: 'FRAME', uri: makeFrameUri(OTHER_SESSION_ID, 42, EVENT_ID), sha256: FRAME_SHA },
      ],
    }),
    makeV13Fixture({ capturedAt: '2026-10-20T06:00:02.000Z' }),
    makeV13Fixture({}, { request: { payloadHash: ALT_HASH }, event: { payloadHash: ALT_HASH } }),
  ]) {
    assert.deepEqual(inspectMf06StoredBinding(mismatch.request, mismatch.event), {
      status: 'UNAVAILABLE',
      reason: 'INVALID_STORED_BINDING',
    });
  }

  const invalidHarnessMissing = makeV13Fixture({
    observations: [
      ...(base.rawPayload.observations as Record<string, unknown>[]).slice(0, 2),
      {
        type: 'PPE',
        trackId: 7,
        ppeItem: 'FULL_BODY_HARNESS',
        status: 'MISSING',
        regionId: REGION_ID,
        geometryVersion: 3,
      },
    ],
  });
  const unknownVersion = makeV13Fixture({ schemaVersion: '1.4.0' });

  for (const rejected of [invalidHarnessMissing, unknownVersion]) {
    assert.deepEqual(inspectMf06StoredBinding(rejected.request, rejected.event), {
      status: 'UNAVAILABLE',
      reason: 'INVALID_STORED_BINDING',
    });
    assert.equal(
      selectMf06FrameReference(rejected.rawPayload, {
        eventId: EVENT_ID,
        streamSessionId: SESSION_ID,
        payloadHash: rejected.payloadHash,
      }),
      null,
    );
  }
});

test('3. rejects accessor getters on nested raw FRAME uri or observation fields without executing them', () => {
  const base = makeV13Fixture();
  let getterCalls = 0;

  const frameWithUriGetter: Record<string, unknown> = { kind: 'FRAME', sha256: FRAME_SHA };
  Object.defineProperty(frameWithUriGetter, 'uri', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return makeFrameUri();
    },
  });
  const rawWithUriGetter = { ...base.rawPayload, evidence: [frameWithUriGetter] };
  const eventWithUriGetter = Object.assign(new AiObservationEventEntity(), {
    ...base.event,
    rawPayload: rawWithUriGetter,
  });

  assert.deepEqual(inspectMf06StoredBinding(base.request, eventWithUriGetter), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });
  assert.equal(
    selectMf06FrameReference(rawWithUriGetter, {
      eventId: EVENT_ID,
      streamSessionId: SESSION_ID,
      payloadHash: base.payloadHash,
    }),
    null,
  );
  assert.equal(getterCalls, 0);

  const maskObsWithStatusGetter: Record<string, unknown> = {
    type: 'PPE',
    trackId: 7,
    ppeItem: 'MASK',
    regionId: REGION_ID,
    geometryVersion: 3,
  };
  Object.defineProperty(maskObsWithStatusGetter, 'status', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'PRESENT';
    },
  });
  const rawWithObsGetter = {
    ...base.rawPayload,
    observations: [
      ...(base.rawPayload.observations as Record<string, unknown>[]).slice(0, 2),
      maskObsWithStatusGetter,
    ],
  };
  const eventWithObsGetter = Object.assign(new AiObservationEventEntity(), {
    ...base.event,
    rawPayload: rawWithObsGetter,
  });

  assert.deepEqual(inspectMf06StoredBinding(base.request, eventWithObsGetter), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });
  assert.equal(
    selectMf06FrameReference(rawWithObsGetter, {
      eventId: EVENT_ID,
      streamSessionId: SESSION_ID,
      payloadHash: base.payloadHash,
    }),
    null,
  );
  assert.equal(getterCalls, 0);
  const eventWithPayloadGetter = Object.assign(new AiObservationEventEntity(), base.event);
  Object.defineProperty(eventWithPayloadGetter, 'rawPayload', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return base.rawPayload;
    },
  });
  assert.deepEqual(inspectMf06StoredBinding(base.request, eventWithPayloadGetter), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });
  assert.equal(getterCalls, 0);
});
