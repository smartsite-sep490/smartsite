import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlertCandidateEvaluator } from '../src/modules/safety/alerts/alert-candidate-evaluator.js';

test('camera PPE requires a bound issued policy and creates only required explicit missing findings', () => {
  const evaluator = new AlertCandidateEvaluator();
  const event = {
    streamSessionId: '33333333-3333-4333-8333-333333333333',
    observations: [
      { type: 'PERSON', trackId: 7 },
      { type: 'PPE', trackId: 7, scope: 'CAMERA', ppeItem: 'HARD_HAT', status: 'MISSING' },
      { type: 'PPE', trackId: 7, scope: 'CAMERA', ppeItem: 'SAFETY_VEST', status: 'MISSING' },
      { type: 'PPE', trackId: 7, scope: 'CAMERA', ppeItem: 'GLOVES', status: 'PRESENT' },
    ],
  };
  const snapshot = structuredClone(event);
  const evaluate = (...args: unknown[]) => Reflect.apply(evaluator.evaluate, evaluator, args);
  assert.deepEqual(evaluate(event, new Map()), []);
  const findings = evaluate(event, new Map(), undefined, {
    cameraId: '11111111-1111-4111-8111-111111111111',
    requiredPpe: ['HARD_HAT', 'GLOVES'],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].candidateSubtype, 'PPE_HARD_HAT_MISSING');
  assert.equal(findings[0].zoneId, undefined);
  assert.equal(findings[0].candidateWorkerId, undefined);
  assert.equal(findings[0].trackId, 7);
  assert.equal(findings[0].cameraId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(event, snapshot);
  assert.deepEqual(
    evaluate(event, new Map(), undefined, { cameraId: 'camera', requiredPpe: [] }),
    [],
  );
});
