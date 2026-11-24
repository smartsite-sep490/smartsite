import assert from 'node:assert/strict';
import test from 'node:test';
import { isEarlyShiftExit } from '../src/modules/workforce/attendance/attendance-review-policy.js';
const start = new Date('2026-11-24T06:00:00Z');
const end = new Date('2026-11-24T10:00:00Z');
test('early exit notifications exclude pre-shift passages and require a known shift window', () => {
  assert.equal(isEarlyShiftExit('OUT', new Date('2026-11-24T05:30:00Z'), start, end), false);
  assert.equal(isEarlyShiftExit('OUT', start, start, end), true);
  assert.equal(isEarlyShiftExit('OUT', new Date('2026-11-24T07:00:00Z'), start, end), true);
  assert.equal(isEarlyShiftExit('OUT', end, start, end), false);
  assert.equal(isEarlyShiftExit('OUT', new Date('2026-11-24T11:00:00Z'), start, end), false);
  assert.equal(isEarlyShiftExit('IN', start, start, end), false);
  assert.equal(isEarlyShiftExit('OUT', start, null, end), false);
  assert.equal(isEarlyShiftExit('OUT', start, start, null), false);
});
test('overnight early exits use the dated shift window', () => {
  const nightStart = new Date('2026-11-24T15:00:00Z');
  const nightEnd = new Date('2026-11-25T01:00:00Z');
  assert.equal(
    isEarlyShiftExit('OUT', new Date('2026-11-24T14:59:00Z'), nightStart, nightEnd),
    false,
  );
  assert.equal(
    isEarlyShiftExit('OUT', new Date('2026-11-25T00:00:00Z'), nightStart, nightEnd),
    true,
  );
});
