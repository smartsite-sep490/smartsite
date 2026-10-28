import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCanonicalPayloadHash, validateObservationEvent } from '@smartsite/contracts';
import {
  mf06FrameSequenceText,
  selectMf06FrameReference,
} from '../src/modules/safety/assessments/mf06-frame-reference.js';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SESSION_ID = '66666666-7777-4888-9999-000000000000';
const OTHER_SESSION_ID = 'ffffffff-1111-4222-8333-444444444444';
const REGION_ID = '12345678-1234-4123-8123-1234567890ab';
const FRAME_SHA = 'a'.repeat(64);
const ALT_SHA = 'b'.repeat(64);
const CROP_SHA = 'c'.repeat(64);

function makeFrameUri(session = SESSION_ID, seq: string | number = 42, event = EVENT_ID): string {
  return `local://evidence/${session}/${seq}/${event}.jpg`;
}

function makeFixture(overrides: Record<string, unknown> = {}) {
  const raw = {
    schemaVersion: '1.2.0',
    eventId: EVENT_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    capturedAt: '2026-10-20T06:00:00Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId: REGION_ID, geometryVersion: 3 },
    ],
    evidence: [
      { kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA },
      {
        kind: 'CROP',
        uri: `local://evidence/${SESSION_ID}/42/crop-7.jpg`,
        sha256: CROP_SHA,
        trackId: 7,
      },
    ],
    ...overrides,
  };
  const expected = {
    eventId: EVENT_ID,
    streamSessionId: SESSION_ID,
    payloadHash: computeCanonicalPayloadHash(raw),
  };
  return { raw, expected };
}

test('v1.4 preserves exact uint64 frame sequences and immutable partition metadata', () => {
  for (const sequenceNumber of ['0', '9007199254740993', '18446744073709551615']) {
    const framePartition = { frameId: OTHER_EVENT_ID, sequenceNumber, partIndex: 1, partCount: 2 };
    const { raw, expected } = makeFixture({
      schemaVersion: '1.4.0',
      framePartition,
      evidence: [
        { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, sequenceNumber), sha256: FRAME_SHA },
      ],
    });
    const selected = selectMf06FrameReference(raw, expected);
    assert(selected);
    assert.equal(selected.sequenceNumber, sequenceNumber);
    assert.equal(mf06FrameSequenceText(selected), sequenceNumber);
    assert.deepEqual(selected.framePartition, framePartition);
    assert(Object.isFrozen(selected.framePartition));
    framePartition.partIndex = 0;
    assert.equal(selected.framePartition?.partIndex, 1);
  }
});

test('v1.4 rejects rounded, noncanonical, overflowing and mismatched frame references', () => {
  for (const sequenceNumber of ['01', '-1', '18446744073709551616']) {
    const framePartition = { frameId: OTHER_EVENT_ID, sequenceNumber, partIndex: 0, partCount: 1 };
    const { raw, expected } = makeFixture({
      schemaVersion: '1.4.0',
      framePartition,
      evidence: [
        { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, sequenceNumber), sha256: FRAME_SHA },
      ],
    });
    assert.equal(selectMf06FrameReference(raw, expected), null);
  }
  const sequenceNumber = '9007199254740993';
  for (const uri of [
    makeFrameUri(SESSION_ID, Number(sequenceNumber)),
    makeFrameUri(OTHER_SESSION_ID, sequenceNumber),
    makeFrameUri(SESSION_ID, sequenceNumber, OTHER_EVENT_ID),
  ]) {
    const { raw, expected } = makeFixture({
      schemaVersion: '1.4.0',
      framePartition: { frameId: OTHER_EVENT_ID, sequenceNumber, partIndex: 0, partCount: 1 },
      evidence: [{ kind: 'FRAME', uri, sha256: FRAME_SHA }],
    });
    assert.equal(selectMf06FrameReference(raw, expected), null);
  }
});

test('1. valid v1.2 event selects frozen FRAME reference without aliasing raw dimensions and matches UUIDs case-insensitively', () => {
  const { raw, expected } = makeFixture();
  assert.equal(validateObservationEvent(raw).isValid, true);

  const selected = selectMf06FrameReference(raw, expected);
  assert.notEqual(selected, null);
  assert.deepEqual(selected, {
    eventId: EVENT_ID,
    streamSessionId: SESSION_ID,
    sequenceNumber: 42,
    uri: makeFrameUri(),
    sha256: FRAME_SHA,
    payloadHash: expected.payloadHash,
    frameDimensions: { width: 1280, height: 720 },
  });
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected?.frameDimensions), true);
  assert.notStrictEqual(selected?.frameDimensions, raw.frameDimensions);

  raw.frameDimensions.width = 3840;
  assert.equal(selected?.frameDimensions.width, 1280);

  const mixedCaseRaw = makeFixture({
    eventId: EVENT_ID.toUpperCase(),
    streamSessionId: SESSION_ID.toUpperCase(),
    evidence: [
      {
        kind: 'FRAME',
        uri: makeFrameUri(SESSION_ID.toUpperCase(), 42, EVENT_ID.toUpperCase()),
        sha256: FRAME_SHA,
      },
    ],
  }).raw;
  const mixedPayloadHash = computeCanonicalPayloadHash(mixedCaseRaw);
  const mixedSelected = selectMf06FrameReference(mixedCaseRaw, {
    eventId: EVENT_ID.toLowerCase(),
    streamSessionId: SESSION_ID.toLowerCase(),
    payloadHash: mixedPayloadHash,
  });
  assert.notEqual(mixedSelected, null);
  assert.equal(mixedSelected?.eventId.toLowerCase(), EVENT_ID);
  assert.equal(mixedSelected?.streamSessionId.toLowerCase(), SESSION_ID);
  assert.equal(mixedSelected?.sequenceNumber, 42);
  assert.equal(mixedSelected?.payloadHash, mixedPayloadHash);
});

test('2. legacy schema versions, missing/invalid evidence digests, or events without FRAME evidence return null', () => {
  for (const schemaVersion of ['1.0.0', '1.1.0']) {
    const legacyRaw = {
      ...makeFixture().raw,
      schemaVersion,
      evidence: [{ kind: 'FRAME', uri: makeFrameUri() }],
    };
    assert.equal(validateObservationEvent(legacyRaw).isValid, true);
    assert.equal(
      selectMf06FrameReference(legacyRaw, {
        eventId: EVENT_ID,
        streamSessionId: SESSION_ID,
        payloadHash: computeCanonicalPayloadHash(legacyRaw),
      }),
      null,
    );
  }

  for (const invalidEvidence of [
    [],
    [{ kind: 'CROP', uri: makeFrameUri(), sha256: CROP_SHA, trackId: 7 }],
    [{ kind: 'SNAPSHOT', uri: makeFrameUri(), sha256: CROP_SHA }],
    [{ kind: 'FRAME', uri: makeFrameUri() }],
    [{ kind: 'FRAME', uri: makeFrameUri(), sha256: 'A'.repeat(64) }],
  ]) {
    const candidate = { ...makeFixture().raw, evidence: invalidEvidence };
    assert.equal(
      selectMf06FrameReference(candidate, {
        eventId: EVENT_ID,
        streamSessionId: SESSION_ID,
        payloadHash: computeCanonicalPayloadHash(candidate),
      }),
      null,
    );
  }
});

test('3. payload/frame hash mutations, mismatched expected context, or cross-session/cross-event FRAME URIs return null', () => {
  const { raw, expected } = makeFixture();
  raw.evidence[0]!.sha256 = ALT_SHA;
  assert.equal(selectMf06FrameReference(raw, expected), null);

  const fresh = makeFixture();
  assert.equal(
    selectMf06FrameReference(fresh.raw, { ...fresh.expected, payloadHash: ALT_SHA }),
    null,
  );
  assert.equal(
    selectMf06FrameReference(fresh.raw, { ...fresh.expected, eventId: OTHER_EVENT_ID }),
    null,
  );
  assert.equal(
    selectMf06FrameReference(fresh.raw, { ...fresh.expected, streamSessionId: OTHER_SESSION_ID }),
    null,
  );

  for (const foreignUri of [
    makeFrameUri(OTHER_SESSION_ID, 42, EVENT_ID),
    makeFrameUri(SESSION_ID, 42, OTHER_EVENT_ID),
  ]) {
    const mismatchedUriFixture = makeFixture({
      evidence: [{ kind: 'FRAME', uri: foreignUri, sha256: FRAME_SHA }],
    });
    assert.equal(
      selectMf06FrameReference(mismatchedUriFixture.raw, mismatchedUriFixture.expected),
      null,
    );
  }
});

test('4. identical duplicate FRAME items succeed while conflicting or additional malformed FRAME items fail closed', () => {
  const duplicateFrame = makeFixture({
    evidence: [
      { kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA },
      { kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA },
      { kind: 'SNAPSHOT', uri: `local://evidence/${SESSION_ID}/42/snap.jpg`, sha256: CROP_SHA },
    ],
  });
  const selected = selectMf06FrameReference(duplicateFrame.raw, duplicateFrame.expected);
  assert.notEqual(selected, null);
  assert.equal(selected?.sequenceNumber, 42);
  assert.equal(selected?.sha256, FRAME_SHA);

  for (const ambiguousFrames of [
    [
      { kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA },
      { kind: 'FRAME', uri: makeFrameUri(), sha256: ALT_SHA },
    ],
    [
      { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, 42, EVENT_ID), sha256: FRAME_SHA },
      { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, 43, EVENT_ID), sha256: FRAME_SHA },
    ],
    [
      { kind: 'FRAME', uri: makeFrameUri(), sha256: FRAME_SHA },
      { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, 42, OTHER_EVENT_ID), sha256: FRAME_SHA },
    ],
  ]) {
    const f = makeFixture({ evidence: ambiguousFrames });
    assert.equal(selectMf06FrameReference(f.raw, f.expected), null);
  }
});

test('5. sequence number bounds and unsupported URI formats are strictly enforced', () => {
  for (const validSeq of [0, Number.MAX_SAFE_INTEGER]) {
    const validBound = makeFixture({
      evidence: [
        { kind: 'FRAME', uri: makeFrameUri(SESSION_ID, validSeq, EVENT_ID), sha256: FRAME_SHA },
      ],
    });
    const res = selectMf06FrameReference(validBound.raw, validBound.expected);
    assert.equal(res?.sequenceNumber, validSeq);
  }

  for (const badUri of [
    makeFrameUri(SESSION_ID, '9007199254740992', EVENT_ID),
    makeFrameUri(SESSION_ID, '01', EVENT_ID),
    makeFrameUri(SESSION_ID, '-1', EVENT_ID),
    `https://example.com/evidence/${SESSION_ID}/42/${EVENT_ID}.jpg`,
    `local://evidence/${SESSION_ID}/42/../42/${EVENT_ID}.jpg`,
    `local://evidence/${SESSION_ID}/42/${EVENT_ID}.png`,
  ]) {
    const bad = makeFixture({ evidence: [{ kind: 'FRAME', uri: badUri, sha256: FRAME_SHA }] });
    assert.equal(selectMf06FrameReference(bad.raw, bad.expected), null);
  }
});

test('6. accessor properties on raw nested FRAME uri or expected.payloadHash are rejected without executing getters', () => {
  const base = makeFixture();
  let getterCalls = 0;

  const frameWithUriGetter: Record<string, unknown> = { kind: 'FRAME', sha256: FRAME_SHA };
  Object.defineProperty(frameWithUriGetter, 'uri', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return makeFrameUri();
    },
  });
  const rawWithUriGetter = { ...base.raw, evidence: [frameWithUriGetter] };
  assert.equal(selectMf06FrameReference(rawWithUriGetter, base.expected), null);
  assert.equal(getterCalls, 0);

  const expectedWithHashGetter: Record<string, unknown> = {
    eventId: EVENT_ID,
    streamSessionId: SESSION_ID,
  };
  Object.defineProperty(expectedWithHashGetter, 'payloadHash', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return base.expected.payloadHash;
    },
  });
  assert.equal(
    selectMf06FrameReference(base.raw, expectedWithHashGetter as unknown as typeof base.expected),
    null,
  );
  assert.equal(getterCalls, 0);
});
