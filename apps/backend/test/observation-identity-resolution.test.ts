import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import {
  parseObservationIdentityCommand,
  observationIdentityCommandHash,
} from '../src/modules/safety/identity/observation-identity-command.js';

const resolve = () => ({
  commandId: randomUUID(),
  expectedRevision: 0,
  expectedEventHash: 'a'.repeat(64),
  action: 'RESOLVE',
  reason: 'Correct person selected.',
  workerId: randomUUID(),
  evidenceIndex: 0,
  expectedEvidenceSha256: 'b'.repeat(64),
});
const invalid = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';

test('reason bounds count Unicode code points consistently with PostgreSQL char_length', () => {
  assert.throws(
    () => parseObservationIdentityCommand({ ...resolve(), reason: '😀'.repeat(3) }),
    invalid,
  );
  assert.equal(
    parseObservationIdentityCommand({ ...resolve(), reason: '😀'.repeat(5) }).reason,
    '😀'.repeat(5),
  );
  assert.equal(
    parseObservationIdentityCommand({ ...resolve(), reason: '😀'.repeat(1000) }).reason,
    '😀'.repeat(1000),
  );
  assert.throws(
    () => parseObservationIdentityCommand({ ...resolve(), reason: '😀'.repeat(1001) }),
    invalid,
  );
});

test('identity commands normalize UUIDs and reason without accepting extra authority fields', () => {
  const input = resolve();
  assert.deepEqual(
    parseObservationIdentityCommand({
      ...input,
      commandId: input.commandId.toUpperCase(),
      workerId: input.workerId.toUpperCase(),
      reason: `  ${input.reason}  `,
    }),
    input,
  );
  for (const extra of [
    { verifiedWorkerId: randomUUID() },
    { trackId: 7 },
    { siteId: randomUUID() },
    { uri: 'local://evidence/unsafe' },
  ]) {
    assert.throws(() => parseObservationIdentityCommand({ ...input, ...extra }), invalid);
  }
});

test('CLEAR forbids Worker/media fields even when null or explicitly undefined', () => {
  const input = {
    commandId: randomUUID(),
    expectedRevision: 1,
    expectedEventHash: 'a'.repeat(64),
    action: 'CLEAR',
    reason: 'Incorrect identity removed.',
  };
  assert.deepEqual(parseObservationIdentityCommand(input), input);
  for (const key of ['workerId', 'evidenceIndex', 'expectedEvidenceSha256']) {
    for (const value of [null, undefined, 0, randomUUID()]) {
      assert.throws(() => parseObservationIdentityCommand({ ...input, [key]: value }), invalid);
    }
  }
});

test('identity discriminator and required RESOLVE fields fail closed', () => {
  for (const input of [
    null,
    [],
    {},
    { ...resolve(), action: 'VERIFY' },
    { ...resolve(), action: 'resolve' },
  ]) {
    assert.throws(() => parseObservationIdentityCommand(input), invalid);
  }
  for (const key of [
    'workerId',
    'evidenceIndex',
    'expectedEvidenceSha256',
    'commandId',
    'reason',
    'expectedRevision',
    'expectedEventHash',
  ]) {
    const input: Record<string, unknown> = resolve();
    delete input[key];
    assert.throws(() => parseObservationIdentityCommand(input), invalid);
  }
});

test('revision/index/hashes/reason have exact bounds and never coerce values', () => {
  for (const expectedRevision of [-1, 0.5, 2147483647, '0', NaN, Infinity])
    assert.throws(
      () => parseObservationIdentityCommand({ ...resolve(), expectedRevision }),
      invalid,
    );
  for (const evidenceIndex of [-1, 256, 0.5, '0'])
    assert.throws(() => parseObservationIdentityCommand({ ...resolve(), evidenceIndex }), invalid);
  for (const hash of ['a'.repeat(63), 'A'.repeat(64), 'x'.repeat(64), null]) {
    assert.throws(
      () => parseObservationIdentityCommand({ ...resolve(), expectedEventHash: hash }),
      invalid,
    );
    assert.throws(
      () => parseObservationIdentityCommand({ ...resolve(), expectedEvidenceSha256: hash }),
      invalid,
    );
  }
  for (const reason of ['1234', ' '.repeat(10), 'a'.repeat(1001), 'abc\u0000def', 'test-\ud800'])
    assert.throws(() => parseObservationIdentityCommand({ ...resolve(), reason }), invalid);
  for (const reason of ['12345', 'a'.repeat(1000)])
    assert.equal(
      parseObservationIdentityCommand({
        ...resolve(),
        reason,
        expectedRevision: 2147483646,
        evidenceIndex: 255,
      }).reason,
      reason,
    );
});

test('canonical command hash binds actor and exact scope and ignores object key order', () => {
  const input = parseObservationIdentityCommand(resolve());
  const scope = {
    siteId: randomUUID(),
    alertId: randomUUID(),
    eventId: randomUUID(),
    personObservationIndex: 0,
    actorUserId: randomUUID(),
  };
  const first = observationIdentityCommandHash(scope, input);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.equal(
    first,
    observationIdentityCommandHash(scope, parseObservationIdentityCommand(reordered)),
  );
  assert.match(first, /^[0-9a-f]{64}$/);
  for (const changed of [
    { actorUserId: randomUUID() },
    { eventId: randomUUID() },
    { personObservationIndex: 1 },
    { siteId: randomUUID() },
    { alertId: randomUUID() },
  ]) {
    assert.notEqual(first, observationIdentityCommandHash({ ...scope, ...changed }, input));
  }
  assert.notEqual(
    first,
    observationIdentityCommandHash(scope, { ...input, reason: 'Different explanation.' }),
  );
});
