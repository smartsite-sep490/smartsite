import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as contracts from '../src/index.js';

const vectors = JSON.parse(
  readFileSync(new URL('../../examples/v1.5/tracked-frame-vectors.json', import.meta.url), 'utf8'),
);
const base = vectors.vectors[0].event;
const event = () => ({
  ...structuredClone(base),
  schemaVersion: '1.7.0',
  observations: [
    {
      type: 'PERSON',
      trackId: 0,
      boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.8 },
    },
    { type: 'PPE', trackId: 0, scope: 'CAMERA', ppeItem: 'HARD_HAT', status: 'MISSING' },
  ],
  continuity: {
    ...structuredClone(base.continuity),
    subjects: [structuredClone(base.continuity.subjects[0])],
  },
});
function validator(): typeof contracts.validateTrackedEntryOriginEvent {
  const value = (contracts as unknown as Record<string, unknown>).validateTrackedCameraPpeEvent;
  assert.equal(typeof value, 'function', 'canonical v1.7 validator must be exported');
  return value as typeof contracts.validateTrackedEntryOriginEvent;
}
test('v1.7 camera-scope evidence validates without mutating its source', () => {
  const payload = event(),
    before = structuredClone(payload);
  assert.deepEqual(validator()(payload), { isValid: true, issues: [] });
  assert.deepEqual(payload, before);
});
test('camera-scope PPE requires a positioned matching PERSON', () => {
  const payload = event();
  delete (payload.observations[0] as { boundingBox?: unknown }).boundingBox;
  assert.equal(validator()(payload).isValid, false);
});
test('one track cannot combine camera and Region scope PPE', () => {
  const payload = event();
  const mixed = {
    ...payload,
    observations: [
      ...payload.observations,
      {
        type: 'PPE',
        trackId: 0,
        ppeItem: 'SAFETY_VEST',
        status: 'MISSING',
        regionId: '00000000-0000-4000-8000-000000000010',
        geometryVersion: 1,
      },
    ],
  };
  assert.equal(validator()(mixed).isValid, false);
});
test('legacy v1.6 intake stays separate from camera-scope v1.7', () => {
  assert.equal(
    contracts.validateTrackedEntryOriginEvent({ ...structuredClone(base), schemaVersion: '1.6.0' })
      .isValid,
    true,
  );
  assert.equal(contracts.validateTrackedEntryOriginEvent(event()).isValid, false);
  assert.equal(validator()({ ...event(), schemaVersion: '1.8.0' }).isValid, false);
});
