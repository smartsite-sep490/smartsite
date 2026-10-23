import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSafetyEpisodeReadCommand } from '../src/safety-episode-api.js';

test('read command keeps the exact displayed revision without coercion', () => {
  assert.deepEqual(parseSafetyEpisodeReadCommand({ seenRevision: 2 }), { seenRevision: 2 });
  assert.deepEqual(parseSafetyEpisodeReadCommand({ seenRevision: Number.MAX_SAFE_INTEGER }), {
    seenRevision: Number.MAX_SAFE_INTEGER,
  });
});

test('read command rejects missing, unsafe, coerced and recipient-controlled fields', () => {
  for (const input of [
    null,
    [],
    {},
    { seenRevision: 0 },
    { seenRevision: -1 },
    { seenRevision: 1.5 },
    { seenRevision: '2' },
    { seenRevision: NaN },
    { seenRevision: Infinity },
    { seenRevision: Number.MAX_SAFE_INTEGER + 1 },
    { seenRevision: 2, recipientId: 'other' },
    { seenRevision: 2, contentRevision: 3 },
    { seenRevision: 2, unread: false },
  ]) {
    assert.equal(parseSafetyEpisodeReadCommand(input), null);
  }
  assert.equal(parseSafetyEpisodeReadCommand(Object.create({ seenRevision: 2 })), null);
});
