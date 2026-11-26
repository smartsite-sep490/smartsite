import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as contracts from '../src/index.js';

const event = () =>
  JSON.parse(
    readFileSync(
      new URL('../schemas/v1.8/examples/mask-camera-observation.json', import.meta.url),
      'utf8',
    ),
  );
function validate(data: unknown): contracts.ValidationResult {
  const fn = (contracts as unknown as Record<string, unknown>).validateTrackedMaskPpeEvent;
  assert.equal(typeof fn, 'function', 'explicit v1.8 semantic validator must exist');
  return (fn as (input: unknown) => contracts.ValidationResult)(data);
}

test('v1.8 camera Mask and prior five families preserve their original payload', () => {
  for (const ppeItem of ['MASK', 'HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']) {
    for (const status of ['PRESENT', 'MISSING']) {
      const data = event();
      data.observations[1] = { ...data.observations[1], ppeItem, status };
      const before = structuredClone(data);
      assert.deepEqual(validate(data), { isValid: true, issues: [] });
      assert.deepEqual(data, before);
    }
  }
});

test('v1.8 stays explicit and does not widen legacy event readers', () => {
  const data = event();
  for (const version of ['1.5.0', '1.6.0', '1.7.0', '1.9.0'])
    assert.equal(validate({ ...data, schemaVersion: version }).isValid, false);
  assert.equal(contracts.validateTrackedCameraPpeEvent(data).isValid, false);
  assert.equal(contracts.validateTrackedEntryOriginEvent(data).isValid, false);
  assert.equal(contracts.validateObservationEvent(data).isValid, false);
  assert.equal(validate(null).isValid, false);
  assert.equal(validate({ ...data, allowed: true }).isValid, false);
});

test('camera Mask needs exactly one positioned original PERSON in its part', () => {
  const absent = event();
  absent.observations.shift();
  assert.equal(validate(absent).isValid, false);
  const unpositioned = event();
  delete unpositioned.observations[0].boundingBox;
  assert.equal(validate(unpositioned).isValid, false);
  const mismatched = event();
  mismatched.observations[1].trackId = 99;
  assert.equal(validate(mismatched).isValid, false);
  const duplicate = event();
  duplicate.observations.push(structuredClone(duplicate.observations[0]));
  assert.equal(validate(duplicate).isValid, false);
});

test('one original track cannot mix camera and Region Mask evidence', () => {
  const data = event();
  data.observations.push({
    type: 'PPE',
    trackId: 0,
    ppeItem: 'MASK',
    status: 'PRESENT',
    regionId: '00000000-0000-4000-8000-000000000010',
    geometryVersion: 1,
  });
  assert.equal(validate(data).isValid, false);
});

test('v1.8 retains geometric and unsigned frame-part bounds', () => {
  const box = event();
  box.observations[0].boundingBox.x2 = box.observations[0].boundingBox.x1;
  assert.equal(validate(box).isValid, false);
  const overflow = event();
  overflow.framePartition.sequenceNumber = '18446744073709551616';
  assert.equal(validate(overflow).isValid, false);
  const maximum = event();
  maximum.framePartition.sequenceNumber = '18446744073709551615';
  assert.equal(validate(maximum).isValid, true);
  const part = event();
  part.framePartition.partIndex = part.framePartition.partCount;
  assert.equal(validate(part).isValid, false);
});

test('different original people retain independent camera and Region evidence', () => {
  const data = event();
  data.observations.push({ ...structuredClone(data.observations[0]), trackId: 1 });
  data.observations.push({
    type: 'PPE',
    trackId: 1,
    ppeItem: 'MASK',
    status: 'MISSING',
    regionId: '00000000-0000-4000-8000-000000000010',
    geometryVersion: 1,
  });
  data.continuity.subjects.push({
    personObservationIndex: 2,
    segmentId: '00000000-0000-4000-8000-000000000021',
    link: { kind: 'START', reason: 'INITIAL' },
  });
  assert.equal(validate(data).isValid, true);
  data.observations[3].trackId = 0;
  assert.equal(validate(data).isValid, false);
});

test('a claimed crossing still requires a continuing original subject', () => {
  const data = event();
  data.observations.push({
    type: 'ZONE_ENTRY',
    trackId: 0,
    entryOrigin: 'OUTSIDE_TO_INSIDE',
    regionId: '00000000-0000-4000-8000-000000000010',
    geometryVersion: 1,
  });
  assert.equal(validate(data).isValid, false);
  data.continuity.subjects[0].link = {
    kind: 'CONTINUE',
    previousEventId: '00000000-0000-4000-8000-000000000022',
    previousPersonObservationIndex: 0,
  };
  assert.equal(validate(data).isValid, true);
  data.continuity.coverage = { status: 'INCOMPLETE', reason: 'FRAME_DROPPED' };
  assert.equal(validate(data).isValid, false);
});

test('v1.8 retains complete original-subject and segment consistency', () => {
  const missing = event();
  missing.continuity.subjects = [];
  assert.equal(validate(missing).isValid, false);
  const duplicate = event();
  duplicate.continuity.subjects.push(structuredClone(duplicate.continuity.subjects[0]));
  assert.equal(validate(duplicate).isValid, false);
  const wrongIndex = event();
  wrongIndex.continuity.subjects[0].personObservationIndex = 1;
  assert.equal(validate(wrongIndex).isValid, false);
  const activeRetired = event();
  activeRetired.continuity.retiredSegments.push({
    segmentId: activeRetired.continuity.subjects[0].segmentId,
    reason: 'LOST_TRACK',
  });
  assert.equal(validate(activeRetired).isValid, false);
  const self = event();
  self.continuity.subjects[0].link = {
    kind: 'CONTINUE',
    previousEventId: self.eventId,
    previousPersonObservationIndex: 0,
  };
  assert.equal(validate(self).isValid, false);
});

test('Harness and Hook remain regional PRESENT_ONLY in v1.8', () => {
  for (const ppeItem of ['FULL_BODY_HARNESS', 'LANYARD_HOOK']) {
    const camera = event();
    camera.observations[1].ppeItem = ppeItem;
    camera.observations[1].status = 'PRESENT';
    assert.equal(validate(camera).isValid, false);
    const regional = event();
    regional.observations[1] = {
      type: 'PPE',
      trackId: 0,
      ppeItem,
      status: 'PRESENT',
      regionId: '00000000-0000-4000-8000-000000000010',
      geometryVersion: 1,
    };
    assert.equal(validate(regional).isValid, true);
    regional.observations[1].status = 'MISSING';
    assert.equal(validate(regional).isValid, false);
  }
});
