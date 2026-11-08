import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import * as contracts from '../src/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = {
  schemaVersion: '1.0.0' as const,
  cameraId: id(90),
  workerGenerationId: id(91),
  streamSessionId: id(2),
  configurationVersion: 1,
  bundleSha256: 'b'.repeat(64),
  viewRevision: 1,
  receiptCommandId: id(92),
  sourceKind: 'LIVE' as const,
};
function event() {
  return {
    eventId: id(1),
    schemaVersion: '1.5.0',
    cameraExternalId: 'CAM-1',
    streamSessionId: id(2),
    capturedAt: '2026-11-01T00:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    framePartition: {
      frameId: id(3),
      sequenceNumber: '18446744073709551615',
      partIndex: 0,
      partCount: 1,
    },
    observations: [{ type: 'PERSON', trackId: 9 }],
    evidence: [],
    continuity: {
      schemaVersion: '1.0.0',
      profileSha256: 'a'.repeat(64),
      coverage: { status: 'COMPLETE' },
      subjects: [
        { personObservationIndex: 0, segmentId: id(4), link: { kind: 'START', reason: 'INITIAL' } },
      ],
      retiredSegments: [],
    },
  };
}
function validate(payload: unknown) {
  const fn = (contracts as unknown as Record<string, unknown>).validateTrackedObservationEvent;
  assert.equal(typeof fn, 'function', 'explicit tracked-frame validator must exist');
  return (fn as (data: unknown) => { isValid: boolean; issues: unknown[] })(payload);
}

test('published synthetic examples retain pinned canonical and existing binding hashes', () => {
  const local = new URL('../examples/v1.5/tracked-frame-vectors.json', import.meta.url);
  const file = existsSync(local)
    ? local
    : new URL('../../examples/v1.5/tracked-frame-vectors.json', import.meta.url);
  const { vectors } = JSON.parse(readFileSync(file, 'utf8')) as {
    vectors: {
      name: string;
      event: unknown;
      context: contracts.WorkerEventDeliveryContext;
      expectedPayloadHash: string;
      expectedBindingHash: string;
    }[];
  };
  assert.equal(vectors.length, 4);
  for (const vector of vectors) {
    assert.equal(validate(vector.event).isValid, true, vector.name);
    const hash = contracts.computeCanonicalPayloadHash(vector.event);
    assert.equal(hash, vector.expectedPayloadHash, vector.name);
    assert.equal(
      contracts.computeWorkerEventBindingHash(hash, vector.context),
      vector.expectedBindingHash,
      vector.name,
    );
  }
});

test('explicit candidate accepts a complete subject, while all existing admission stays closed', () => {
  const payload = event();
  assert.equal(validate(payload).isValid, true);
  assert.equal(contracts.validateObservationEvent(payload).isValid, false);
  assert.equal(contracts.validateEightFamilyObservationEvent(payload).isValid, false);
  assert.equal(contracts.validatePartitionedObservationEvent(payload).isValid, false);
  assert.notEqual(contracts.parseWorkerEventDeliveryContext(context), null);
  assert.equal(
    contracts.parseWorkerEventDeliveryEnvelope({ schemaVersion: '1.0.0', context, event: payload }),
    null,
  );
  const legacy: Record<string, unknown> = { ...payload };
  delete legacy.continuity;
  assert.notEqual(
    contracts.parseWorkerEventDeliveryEnvelope({
      schemaVersion: '1.0.0',
      context,
      event: { ...legacy, schemaVersion: '1.4.0' },
    }),
    null,
  );
});

test('empty COMPLETE and INCOMPLETE lifecycle records are distinct; incomplete cannot claim subjects', () => {
  const payload = event();
  const empty = {
    ...payload,
    observations: [],
    continuity: { ...payload.continuity, subjects: [] },
  };
  assert.equal(validate(empty).isValid, true);
  const incomplete = {
    ...empty,
    continuity: {
      ...empty.continuity,
      coverage: { status: 'INCOMPLETE', reason: 'INFERENCE_ERROR' },
    },
  };
  assert.equal(validate(incomplete).isValid, true);
  assert.equal(
    validate({
      ...payload,
      continuity: { ...payload.continuity, coverage: incomplete.continuity.coverage },
    }).isValid,
    false,
  );
  assert.equal(
    validate({ ...empty, continuity: { ...empty.continuity, coverage: { status: 'INCOMPLETE' } } })
      .isValid,
    false,
  );
});

test('CONTINUE binds original predecessor position, changes canonical hash, and does not mutate input', () => {
  const payload = event();
  const continued = {
    ...payload,
    continuity: {
      ...payload.continuity,
      subjects: [
        {
          personObservationIndex: 0,
          segmentId: id(4),
          link: { kind: 'CONTINUE', previousEventId: id(8), previousPersonObservationIndex: 255 },
        },
      ],
    },
  };
  const before = JSON.stringify(continued);
  assert.equal(validate(continued).isValid, true);
  assert.equal(JSON.stringify(continued), before);
  assert.notEqual(
    contracts.computeCanonicalPayloadHash(payload),
    contracts.computeCanonicalPayloadHash(continued),
  );
  assert.notEqual(
    contracts.computeWorkerEventBindingHash(
      contracts.computeCanonicalPayloadHash(payload),
      context,
    ),
    contracts.computeWorkerEventBindingHash(
      contracts.computeCanonicalPayloadHash(continued),
      context,
    ),
  );
  assert.equal(
    validate({
      ...continued,
      continuity: {
        ...continued.continuity,
        subjects: [
          {
            ...continued.continuity.subjects[0],
            link: { ...continued.continuity.subjects[0].link, previousEventId: payload.eventId },
          },
        ],
      },
    }).isValid,
    false,
  );
});

test('offline/decode failure without a captured frame cannot masquerade as a frame lifecycle record', () => {
  const payload = event();
  for (const reason of ['SOURCE_UNAVAILABLE', 'DECODE_ERROR']) {
    assert.equal(
      validate({
        ...payload,
        observations: [],
        continuity: {
          ...payload.continuity,
          subjects: [],
          coverage: { status: 'INCOMPLETE', reason },
        },
      }).isValid,
      false,
    );
  }
});

test('three affected people among ten retain ten exact PERSON references and three independent subject claims', () => {
  const payload = event();
  const people = Array.from({ length: 10 }, (_, trackId) => ({ type: 'PERSON', trackId }));
  const observations = [
    ...people,
    ...[1, 4, 8].flatMap((trackId) =>
      ['HARD_HAT', 'SAFETY_VEST'].map((ppeItem) => ({
        type: 'PPE',
        trackId,
        ppeItem,
        status: 'MISSING',
        regionId: id(50),
        geometryVersion: 1,
      })),
    ),
  ];
  const subjects = people.map((_, personObservationIndex) => ({
    personObservationIndex,
    segmentId: id(20 + personObservationIndex),
    link: { kind: 'START', reason: 'INITIAL' },
  }));
  assert.equal(
    validate({ ...payload, observations, continuity: { ...payload.continuity, subjects } }).isValid,
    true,
  );
  assert.equal(
    validate({
      ...payload,
      observations,
      continuity: { ...payload.continuity, subjects: subjects.slice(0, 3) },
    }).isValid,
    false,
  );
});

test('incomplete PERSON evidence is retained without tracking claims; predecessor forks are rejected', () => {
  const payload = event();
  assert.equal(
    validate({
      ...payload,
      continuity: {
        ...payload.continuity,
        coverage: { status: 'INCOMPLETE', reason: 'INFERENCE_ERROR' },
        subjects: [],
      },
    }).isValid,
    true,
  );
  const link = { kind: 'CONTINUE', previousEventId: id(8), previousPersonObservationIndex: 0 };
  assert.equal(
    validate({
      ...payload,
      observations: [
        { type: 'PERSON', trackId: 1 },
        { type: 'PERSON', trackId: 2 },
      ],
      continuity: {
        ...payload.continuity,
        subjects: [
          { personObservationIndex: 0, segmentId: id(10), link },
          { personObservationIndex: 1, segmentId: id(11), link },
        ],
      },
    }).isValid,
    false,
  );
});

test('rejects forged positions, duplicate subjects, repeated segment owners and active-retired collisions', () => {
  const payload = event();
  const subject = payload.continuity.subjects[0];
  for (const subjects of [
    [{ ...subject, personObservationIndex: 1 }],
    [subject, subject],
    [subject, { ...subject, personObservationIndex: 1 }],
  ])
    assert.equal(
      validate({ ...payload, continuity: { ...payload.continuity, subjects } }).isValid,
      false,
    );
  assert.equal(
    validate({
      ...payload,
      continuity: {
        ...payload.continuity,
        retiredSegments: [{ segmentId: subject.segmentId, reason: 'VIEW_CHANGE' }],
      },
    }).isValid,
    false,
  );
});

test('retirement is bounded, unique, explicitly reasoned and never a Worker identity', () => {
  const payload = event();
  const retired = { segmentId: id(12), reason: 'AMBIGUOUS_ASSOCIATION' };
  assert.equal(
    validate({ ...payload, continuity: { ...payload.continuity, retiredSegments: [retired] } })
      .isValid,
    true,
  );
  for (const retiredSegments of [
    [retired, retired],
    [{ ...retired, reason: 'INITIAL' }],
    [{ ...retired, workerId: id(99) }],
  ]) {
    assert.equal(
      validate({ ...payload, continuity: { ...payload.continuity, retiredSegments } }).isValid,
      false,
    );
  }
});

test('retains uint64, frame-part, same-part PERSON ownership and geometry validation', () => {
  const payload = event();
  for (const sequenceNumber of ['18446744073709551616', 8, '01']) {
    assert.equal(
      validate({ ...payload, framePartition: { ...payload.framePartition, sequenceNumber } })
        .isValid,
      false,
    );
  }
  assert.equal(
    validate({ ...payload, framePartition: { ...payload.framePartition, partIndex: 1 } }).isValid,
    false,
  );
  assert.equal(
    validate({ ...payload, observations: [payload.observations[0], payload.observations[0]] })
      .isValid,
    false,
  );
  assert.equal(
    validate({
      ...payload,
      observations: [
        {
          ...payload.observations[0],
          boundingBox: { x1: 0.8, x2: 0.2, y1: 0, y2: 1, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    }).isValid,
    false,
  );
});

test('strict version/metadata never accepts unknown fields, unsafe profile or mixed START/CONTINUE', () => {
  const payload = event();
  for (const continuity of [
    { ...payload.continuity, profileSha256: 'A'.repeat(64) },
    { ...payload.continuity, qualified: true },
    {
      ...payload.continuity,
      subjects: [
        {
          ...payload.continuity.subjects[0],
          link: { kind: 'START', reason: 'INITIAL', previousEventId: id(8) },
        },
      ],
    },
  ])
    assert.equal(validate({ ...payload, continuity }).isValid, false);
  assert.equal(validate({ ...payload, workerId: id(99) }).isValid, false);
});
