import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectObservationSubject,
  selectZoneEntrySubject,
} from '../src/modules/safety/identity/observation-identity-subject.js';

const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
const person = (trackId = 7, boundingBox: unknown = box) => ({
  type: 'PERSON',
  trackId,
  boundingBox,
});

const regionId = '44444444-4444-4444-8444-444444444444';
const zoneEntry = (trackId = 7) => ({
  type: 'ZONE_ENTRY',
  trackId,
  regionId,
  geometryVersion: 3,
});

test('each Zone entry binds its exact original PERSON, not another person or PPE box', () => {
  const secondBox = { ...box, x1: 0.6, x2: 0.9 };
  const payload = {
    observations: [
      { type: 'PPE', trackId: 7, boundingBox: secondBox },
      person(8, secondBox),
      zoneEntry(7),
      person(7),
      zoneEntry(8),
    ],
  };
  for (const [zoneIndex, personIndex, trackId, bounds] of [
    [2, 3, 7, box],
    [4, 1, 8, secondBox],
  ] as const) {
    assert.deepEqual(selectZoneEntrySubject(payload, zoneIndex), {
      zoneEligible: true,
      zoneObservationIndex: zoneIndex,
      trackId,
      regionId,
      geometryVersion: 3,
      subjectBindingStatus: 'BOUND',
      personObservationIndex: personIndex,
      personBoundingBox: bounds,
    });
  }
});

test('repeated Zone entries keep independent indices and geometry, never dedupe by Track', () => {
  const secondRegionId = '55555555-5555-4555-8555-555555555555';
  const observations = [
    person(),
    zoneEntry(),
    zoneEntry(),
    { ...zoneEntry(), regionId: secondRegionId, geometryVersion: 9 },
  ];
  for (const zoneIndex of [1, 2, 3]) {
    const selected = selectZoneEntrySubject({ observations }, zoneIndex);
    assert.equal(selected.zoneEligible, true);
    if (!selected.zoneEligible) assert.fail('expected original Zone anchor');
    assert.equal(selected.zoneObservationIndex, zoneIndex);
    assert.equal(selected.personObservationIndex, 0);
    assert.equal(selected.regionId, zoneIndex === 3 ? secondRegionId : regionId);
    assert.equal(selected.geometryVersion, zoneIndex === 3 ? 9 : 3);
  }
});

test('duplicate same-track PERSONs stay ambiguous even if only one box is usable', () => {
  for (const duplicate of [person(), { type: 'PERSON', trackId: 7 }]) {
    assert.deepEqual(
      selectZoneEntrySubject({ observations: [person(), zoneEntry(), duplicate] }, 1),
      {
        zoneEligible: true,
        zoneObservationIndex: 1,
        trackId: 7,
        regionId,
        geometryVersion: 3,
        subjectBindingStatus: 'AMBIGUOUS_PERSON_TRACK',
        personObservationIndex: null,
      },
    );
  }
});

test('Zone entry without a same-track PERSON never borrows PPE or face candidate bounds', () => {
  const result = selectZoneEntrySubject(
    {
      observations: [
        person(8),
        { type: 'PPE', trackId: 7, boundingBox: box },
        { type: 'IDENTITY_CANDIDATE', trackId: 7, candidateWorkerId: 'untrusted-worker' },
        zoneEntry(),
      ],
    },
    3,
  );
  assert.deepEqual(result, {
    zoneEligible: true,
    zoneObservationIndex: 3,
    trackId: 7,
    regionId,
    geometryVersion: 3,
    subjectBindingStatus: 'PERSON_NOT_FOUND',
    personObservationIndex: null,
  });
  assert.equal('workerId' in result, false);
  assert.equal('candidateWorkerId' in result, false);
  assert.equal('allowed' in result, false);
});

test('unavailable PERSON box retains the original index but is not a BOUND subject', () => {
  for (const boundingBox of [undefined, null, { ...box, x2: box.x1 }]) {
    assert.deepEqual(
      selectZoneEntrySubject(
        { observations: [{ type: 'PERSON', trackId: 7, boundingBox }, zoneEntry()] },
        1,
      ),
      {
        zoneEligible: true,
        zoneObservationIndex: 1,
        trackId: 7,
        regionId,
        geometryVersion: 3,
        subjectBindingStatus: 'PERSON_BOX_UNAVAILABLE',
        personObservationIndex: 0,
      },
    );
  }
});

test('invalid Zone observation index, payload, type and anchors are rejected explicitly', () => {
  const payload = { observations: [person(), zoneEntry()] };
  for (const index of [-1, 0.5, 256, NaN, Infinity]) {
    assert.deepEqual(selectZoneEntrySubject(payload, index), {
      zoneEligible: false,
      zoneObservationIndex: index,
      unavailableReason: 'INVALID_ZONE_INDEX',
    });
  }
  for (const input of [null, {}, { observations: null }, { observations: new Array(257) }]) {
    assert.equal(selectZoneEntrySubject(input, 0).zoneEligible, false);
  }
  assert.deepEqual(selectZoneEntrySubject(payload, 0), {
    zoneEligible: false,
    zoneObservationIndex: 0,
    unavailableReason: 'NOT_ZONE_ENTRY',
  });
  assert.deepEqual(selectZoneEntrySubject(payload, 2), {
    zoneEligible: false,
    zoneObservationIndex: 2,
    unavailableReason: 'ZONE_ENTRY_NOT_FOUND',
  });
  for (const change of [
    { trackId: -1 },
    { trackId: '7' },
    { trackId: Number.MAX_SAFE_INTEGER + 1 },
    { trackId: 0.5 },
    { regionId: 'not-a-uuid' },
    { regionId: null },
    { geometryVersion: 0 },
    { geometryVersion: 0.5 },
    { geometryVersion: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.deepEqual(
      selectZoneEntrySubject({ observations: [person(), { ...zoneEntry(), ...change }] }, 1),
      {
        zoneEligible: false,
        zoneObservationIndex: 1,
        unavailableReason: 'ZONE_ENTRY_INVALID',
      },
    );
  }
});

test('Zone subject selection snapshots box fields and accepts canonical track zero', () => {
  const originalBox = { ...box };
  const originalPerson = person(0, originalBox);
  const payload = { observations: [originalPerson, zoneEntry(0)] };
  const selected = selectZoneEntrySubject(payload, 1);
  assert.equal(selected.zoneEligible, true);
  if (!selected.zoneEligible || selected.subjectBindingStatus !== 'BOUND')
    assert.fail('expected usable exact subject');
  originalBox.x1 = 0;
  assert.deepEqual(selected.personBoundingBox, box);
  assert.equal(selected.trackId, 0);
  assert.equal(originalPerson.boundingBox, originalBox);
});

test('Zone binding preserves final allowed PERSON index and safe integer anchors', () => {
  const largeTrackId = Number.MAX_SAFE_INTEGER;
  const originalRegionId = 'abcdabcd-abcd-4abc-8abc-abcdabcdabcd'.toUpperCase();
  const observations: unknown[] = Array.from({ length: 256 }, () => ({
    type: 'IDENTITY_CANDIDATE',
    trackId: 1,
    status: 'UNKNOWN',
  }));
  observations[0] = {
    ...zoneEntry(largeTrackId),
    regionId: originalRegionId,
    geometryVersion: Number.MAX_SAFE_INTEGER,
  };
  observations[255] = person(largeTrackId);
  const selected = selectZoneEntrySubject({ observations }, 0);
  assert.deepEqual(selected, {
    zoneEligible: true,
    zoneObservationIndex: 0,
    trackId: largeTrackId,
    regionId: originalRegionId,
    geometryVersion: Number.MAX_SAFE_INTEGER,
    subjectBindingStatus: 'BOUND',
    personObservationIndex: 255,
    personBoundingBox: box,
  });
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
