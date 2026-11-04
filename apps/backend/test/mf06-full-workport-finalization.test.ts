import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mf06ZoneEntryAssessmentWorkPort } from '../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';

test('full identity/policy composition requests the pre-snapshot writable authority fence', () => {
  // Constructor only: these dependencies must not be read until explicitly invoked.
  const port = new Mf06ZoneEntryAssessmentWorkPort(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  assert.equal((port as { finalizationScope?: string }).finalizationScope, 'AUTHORITY_SNAPSHOT');
});

const capturedAt = '2026-10-30T00:00:01.000Z';
const exactCapturedAt = '2026-10-30T00:00:01.000123Z';
function preparationFixture(authorityCapturedAt: string | null) {
  const claim = {
    requestId: 'request',
    leaseToken: 'lease',
    headRevision: 1,
    attemptCount: 1,
    leaseExpiresAt: capturedAt,
    deadlineAt: capturedAt,
  };
  const context = {
    status: 'MATCHED',
    claim,
    siteId: 'site',
    request: { zoneId: 'zone', capturedAt, requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT' },
    authorityCapturedAt,
    contextDigest: 'context',
    claimContextDigest: 'claim-context',
  };
  let receivedTime: string | undefined;
  const port = new Mf06ZoneEntryAssessmentWorkPort(
    { driver: { schema: 'owned_test' } } as never,
    {
      readForClaim: async () => context,
      revalidateForClaim: async () => ({ ...context, claimContextDigest: 'changed' }),
    } as never,
    {
      prepareForEvent: async (value: { capturedAt: string }) => {
        receivedTime = value.capturedAt;
        return { status: 'UNAVAILABLE', reason: 'AUTHORITY_UNAVAILABLE' };
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { port, claim, receivedTime: () => receivedTime };
}

test('full composition preserves the authenticated microsecond capture instant', async () => {
  const f = preparationFixture(exactCapturedAt);
  await f.port.prepare(f.claim, new AbortController().signal);
  assert.equal(f.receivedTime(), exactCapturedAt);
});

test('legacy preparation retains its millisecond capture instant', async () => {
  const f = preparationFixture(null);
  await f.port.prepare(f.claim, new AbortController().signal);
  assert.equal(f.receivedTime(), capturedAt);
});

test('finalization rejects a changed authenticated claim before reading decision data', async () => {
  const f = preparationFixture(exactCapturedAt);
  const signal = new AbortController().signal;
  const handle = await f.port.prepare(f.claim, signal);
  const manager = {
    query: async () => [{ schema_valid: true, isolation_valid: true, writable: true }],
    getRepository: () => {
      throw Error('Must reject the changed claim first');
    },
  };
  assert.deepEqual(await f.port.finalize(manager as never, f.claim, handle, signal), {
    state: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });
});
