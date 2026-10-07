import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPastWorkDate } from '../src/scheduling-date.js';

test('work dates use the shift timezone and never lock today after the shift starts', () => {
  const now = new Date('2030-01-01T23:30:00Z');
  assert.equal(isPastWorkDate('2030-01-01', 'UTC', now), false);
  assert.equal(isPastWorkDate('2030-01-01', 'Asia/Ho_Chi_Minh', now), true);
  assert.equal(isPastWorkDate('2030-01-02', 'Asia/Ho_Chi_Minh', now), false);
  assert.equal(isPastWorkDate('2029-12-31', 'UTC', now), true);
  assert.equal(isPastWorkDate('2030-01-01', 'America/Los_Angeles', now), false);
  assert.throws(() => isPastWorkDate('2030-01-01', 'Invalid/Timezone', now), RangeError);
});
