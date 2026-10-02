import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectObservationSubject } from '../src/modules/safety/identity/observation-identity-subject.js';

const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
const person = (trackId = 7, boundingBox: unknown = box) => ({
  type: 'PERSON',
  trackId,
  boundingBox,
});

test('two PERSONs retain original observation indices and independent boxes', () => {
  const secondBox = { ...box, x1: 0.6, x2: 0.9 };
  const payload = {
    observations: [
      { type: 'PPE', trackId: 7, boundingBox: box },
      person(),
      { type: 'ZONE_ENTRY', trackId: 8 },
      person(8, secondBox),
    ],
  };
  assert.deepEqual(selectObservationSubject(payload, 1), {
    eligible: true,
    personObservationIndex: 1,
    trackId: 7,
    personBoundingBox: box,
  });
  assert.deepEqual(selectObservationSubject(payload, 3), {
    eligible: true,
    personObservationIndex: 3,
    trackId: 8,
    personBoundingBox: secondBox,
  });
});

test('duplicate PERSON track blocks resolve even when one duplicate has no box', () => {
  const payload = { observations: [person(), { type: 'PERSON', trackId: 7 }] };
  for (const index of [0, 1])
    assert.deepEqual(selectObservationSubject(payload, index), {
      eligible: false,
      personObservationIndex: index,
      trackId: 7,
      unavailableReason: 'AMBIGUOUS_PERSON_TRACK',
    });
});

test('PPE boxes cannot substitute a missing PERSON box', () => {
  const payload = {
    observations: [
      { type: 'PERSON', trackId: 7 },
      { type: 'PPE', trackId: 7, boundingBox: box },
    ],
  };
  assert.equal(selectObservationSubject(payload, 0).eligible, false);
  assert.deepEqual(selectObservationSubject(payload, 1), {
    eligible: false,
    personObservationIndex: 1,
    unavailableReason: 'NOT_PERSON',
  });
});

test('ZONE_ENTRY and identity candidate cannot be selected as a PERSON', () => {
  for (const type of ['ZONE_ENTRY', 'IDENTITY_CANDIDATE']) {
    assert.deepEqual(selectObservationSubject({ observations: [{ type, trackId: 7 }] }, 0), {
      eligible: false,
      personObservationIndex: 0,
      unavailableReason: 'NOT_PERSON',
    });
  }
});

test('missing, degenerate, non-finite and unnormalized boxes block resolution', () => {
  for (const invalidBox of [
    undefined,
    null,
    [],
    { ...box, x1: box.x2 },
    { ...box, x1: 0.5 },
    { ...box, y2: box.y1 },
    { ...box, y1: -0.1 },
    { ...box, x2: 1.1 },
    { ...box, x1: NaN },
    { ...box, y2: Infinity },
    { ...box, x1: '0.1' },
    { ...box, coordinateSpace: 'PIXELS' },
    { ...box, coordinateSpace: undefined },
    { ...box, unexpected: true },
  ]) {
    const payload = { observations: [{ type: 'PERSON', trackId: 7, boundingBox: invalidBox }] };
    assert.deepEqual(selectObservationSubject(payload, 0), {
      eligible: false,
      personObservationIndex: 0,
      trackId: 7,
      unavailableReason: 'PERSON_BOX_UNAVAILABLE',
    });
  }
});

test('Track ID must be a nonnegative safe integer and is never coerced', () => {
  for (const trackId of [-1, 0.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.deepEqual(selectObservationSubject({ observations: [{ ...person(), trackId }] }, 0), {
      eligible: false,
      personObservationIndex: 0,
      unavailableReason: 'INVALID_TRACK_ID',
    });
  }
  for (const trackId of [0, 2147483648, Number.MAX_SAFE_INTEGER]) {
    const result = selectObservationSubject({ observations: [person(trackId)] }, 0);
    assert.equal(result.eligible, true);
    assert.equal(result.trackId, trackId);
  }
});

test('indices are original integers in 0..255 and cannot fall back to the first PERSON', () => {
  for (const index of [-1, 0.5, 256, NaN, Infinity]) {
    assert.equal(selectObservationSubject({ observations: [person()] }, index).eligible, false);
  }
  assert.deepEqual(selectObservationSubject({ observations: [person()] }, 1), {
    eligible: false,
    personObservationIndex: 1,
    unavailableReason: 'SUBJECT_NOT_FOUND',
  });
});

test('oversized or malformed observations fail closed without truncating them', () => {
  for (const payload of [
    null,
    [],
    {},
    { observations: {} },
    { observations: Array(257).fill(person()) },
  ]) {
    assert.deepEqual(selectObservationSubject(payload, 0), {
      eligible: false,
      personObservationIndex: 0,
      unavailableReason: 'OBSERVATIONS_UNAVAILABLE',
    });
  }
});

test('a selected box is copied and selection does not mutate the immutable raw event', () => {
  const frozenBox = Object.freeze({ ...box });
  const payload = Object.freeze({
    observations: Object.freeze([Object.freeze(person(7, frozenBox))]),
  });
  const result = selectObservationSubject(payload, 0);
  assert.ok(result.eligible);
  assert.notEqual(result.personBoundingBox, frozenBox);
  assert.deepEqual(payload.observations[0]?.boundingBox, box);
});

test('a frame-bound PERSON may have a box that spans the complete image', () => {
  const full = { x1: 0, y1: 0, x2: 1, y2: 1, coordinateSpace: 'NORMALIZED_0_1' };
  assert.equal(selectObservationSubject({ observations: [person(7, full)] }, 0).eligible, true);
});
