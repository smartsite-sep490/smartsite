import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const modulePath = '../src/modules/safety/checklist-policy.js';
const policy = await import(modulePath).catch(() => null);

test('checklist results cover every item once; missing evidence may be reported as Fail', () => {
  assert.ok(policy, 'Checklist result policy has not been implemented');
  const items = [
    { id: 'a', evidenceRequired: true },
    { id: 'b', evidenceRequired: false },
  ];
  const valid = [
    { itemId: 'a', answer: 'FAIL', note: 'Document missing', fileIndexes: [] },
    { itemId: 'b', answer: 'PASS', note: '', fileIndexes: [] },
  ];
  assert.doesNotThrow(() => policy.validateChecklistResults(items, valid, 0));
  assert.throws(() => policy.validateChecklistResults(items, [valid[0]], 0));
  assert.throws(() => policy.validateChecklistResults(items, [valid[0], valid[0]], 0));
  assert.throws(() =>
    policy.validateChecklistResults(items, [{ ...valid[0], answer: 'PASS' }, valid[1]], 0),
  );
  assert.throws(() =>
    policy.validateChecklistResults(items, [{ ...valid[0], note: '' }, valid[1]], 0),
  );
  assert.throws(() =>
    policy.validateChecklistResults(
      items,
      [{ ...valid[0], answer: 'NOT_APPLICABLE', note: '' }, valid[1]],
      0,
    ),
  );
  assert.doesNotThrow(() =>
    policy.validateChecklistResults(
      items,
      [{ ...valid[0], answer: 'PASS', fileIndexes: [0] }, valid[1]],
      1,
    ),
  );
  assert.throws(() =>
    policy.validateChecklistResults(
      items,
      [
        { ...valid[0], fileIndexes: [0] },
        { ...valid[1], fileIndexes: [0] },
      ],
      1,
    ),
  );
});

test('checklist transitions prevent cancellation of pending/accepted reports and reject self-review', () => {
  assert.ok(policy, 'Checklist transition policy has not been implemented');
  assert.equal(policy.checklistTransition('ASSIGNED', 'start'), 'IN_PROGRESS');
  assert.equal(policy.checklistTransition('IN_PROGRESS', 'submit'), 'SUBMITTED');
  assert.equal(policy.checklistTransition('SUBMITTED', 'return'), 'IN_PROGRESS');
  assert.equal(policy.checklistTransition('SUBMITTED', 'accept'), 'ACCEPTED');
  assert.throws(() => policy.checklistTransition('SUBMITTED', 'cancel'));
  assert.throws(() => policy.checklistTransition('ACCEPTED', 'submit'));
  assert.throws(() => policy.requireChecklistReviewer('same', 'same'));
  assert.doesNotThrow(() => policy.requireChecklistReviewer('safety', 'representative'));
});
