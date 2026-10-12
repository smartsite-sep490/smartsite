import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRepeatedGatePassage } from '../src/modules/workforce/gate-repeat-policy.js';

test('repeated scans are blocked until the opposite passage or a new workday', () => {
  const previous = { direction: 'IN' as const, occurredAt: new Date('2030-01-01T01:00:00Z') };
  assert.equal(isRepeatedGatePassage('IN', new Date('2030-01-01T01:00:11Z'), previous, null), true);
  assert.equal(
    isRepeatedGatePassage('OUT', new Date('2030-01-01T01:00:11Z'), previous, null),
    false,
  );
  assert.equal(
    isRepeatedGatePassage('IN', new Date('2030-01-02T01:00:00Z'), previous, null),
    false,
  );
  assert.equal(isRepeatedGatePassage('IN', previous.occurredAt, null, null), false);
  assert.equal(
    isRepeatedGatePassage(
      'OUT',
      new Date('2030-01-01T01:00:11Z'),
      { ...previous, direction: 'OUT' },
      null,
    ),
    true,
  );
});

test('overnight shift and approved overtime retain the previous workday until its end', () => {
  const previous = { direction: 'IN' as const, occurredAt: new Date('2030-01-01T15:00:00Z') };
  const day = {
    workDate: '2030-01-01',
    timezone: 'Asia/Ho_Chi_Minh',
    endsAt: new Date('2030-01-02T01:00:00Z'),
  };
  assert.equal(isRepeatedGatePassage('IN', new Date('2030-01-01T18:00:00Z'), previous, day), true);
  assert.equal(isRepeatedGatePassage('IN', new Date('2030-01-02T01:00:00Z'), previous, day), false);
  assert.throws(() =>
    isRepeatedGatePassage('IN', previous.occurredAt, previous, {
      ...day,
      timezone: 'Invalid/Zone',
    }),
  );
});
