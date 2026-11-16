import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCreatePolicyReferenceRegionCommand as parse,
  parseCreateReferenceRegionCommand as legacy,
} from '../src/camera-region-reference-command.js';
const base = {
  expectedConfigurationVersion: 1,
  referenceId: '00000000-0000-4000-8000-000000000001',
  viewRevision: 1,
  confirmReferenceView: true,
  zoneId: '00000000-0000-4000-8000-000000000002',
  polygon: {
    coordinates: [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.5, 0.9],
    ],
  },
};
test('new Region creation requires an explicit valid choice while legacy shape remains strict', () => {
  for (const ppePolicy of [
    { mode: 'INHERIT' },
    { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
    { mode: 'DISABLED', reason: 'Manual pause' },
  ]) {
    assert.deepEqual(parse({ ...base, ppePolicy }).ppePolicy, ppePolicy);
    assert.throws(() => legacy({ ...base, ppePolicy }));
  }
  assert.throws(() => parse(base));
});
test('PPE choice cannot bypass reference, confirmation or authority-field validation', () => {
  const input = { ...base, ppePolicy: { mode: 'INHERIT' } };
  for (const ppePolicy of [
    null,
    { mode: 'EXPLICIT', requiredPpe: [] },
    { mode: 'DISABLED', reason: '' },
    { mode: 'INHERIT', actorId: 'invented' },
  ])
    assert.throws(() => parse({ ...input, ppePolicy }));
  assert.throws(() => parse({ ...input, confirmReferenceView: false }));
  assert.throws(() => parse({ ...input, siteId: 'invented' }));
  assert.throws(() => parse({ ...input, referenceId: 'wrong' }));
});
