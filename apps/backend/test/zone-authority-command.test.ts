import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { withZoneAuthorityTransaction } from '../src/modules/zones/zone-authority-transaction.js';
import {
  executeZoneAuthorityCommand,
  parseZoneAuthorityFact,
} from '../src/modules/zones/zone-authority-history.js';
const invalid = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 400;

function fact() {
  const siteId = randomUUID();
  const zoneId = randomUUID();
  return {
    sourceKind: 'ZONE_POLICY',
    sourceId: zoneId,
    siteId,
    effectiveFrom: new Date('2026-10-04T08:00:00Z'),
    effectiveTo: null,
    payload: { zoneId, siteId, restrictionPolicy: 'AUTHORIZATION_REQUIRED' },
  };
}

test('authority fact parser rejects unknown keys, wrong scope/source, invalid dates and payload', async () => {
  const value = fact();
  assert.deepEqual(parseZoneAuthorityFact(value), value);
  for (const bad of [
    { ...value, identityVerified: true },
    { ...value, sourceId: randomUUID() },
    { ...value, siteId: randomUUID() },
    { ...value, effectiveFrom: new Date('invalid') },
    { ...value, effectiveTo: value.effectiveFrom },
    { ...value, payload: { ...value.payload, workerId: randomUUID() } },
    { ...value, payload: { ...value.payload, restrictionPolicy: 'AUTHORIZED' } },
  ])
    assert.throws(() => parseZoneAuthorityFact(bad), invalid);
});

test('typed authority facts preserve legacy null ownership and reject malformed intervals/duplicate Zones', async () => {
  const value = fact();
  const assignmentId = randomUUID();
  const payload = {
    assignmentId,
    workerId: randomUUID(),
    siteId: value.siteId,
    contractorId: null,
    zoneIds: [value.sourceId],
    status: 'APPROVED',
    validFrom: '2026-10-04T08:00:00Z',
    validUntil: null,
  };
  const assignment = { ...value, sourceKind: 'ASSIGNMENT', sourceId: assignmentId, payload };
  const parsed = parseZoneAuthorityFact(assignment);
  assert.equal(parsed.sourceKind, 'ASSIGNMENT');
  if (parsed.sourceKind === 'ASSIGNMENT') assert.equal(parsed.payload.contractorId, null);
  for (const bad of [
    { ...payload, zoneIds: [value.sourceId, value.sourceId] },
    { ...payload, zoneIds: Array.from({ length: 65 }, () => randomUUID()) },
    { ...payload, validUntil: payload.validFrom },
    { ...payload, validFrom: '2026-10-04T08:00:00' },
    { ...payload, faceEmbedding: [1, 2, 3] },
  ])
    assert.throws(() => parseZoneAuthorityFact({ ...assignment, payload: bad }), invalid);
});

test('global Contractor facts cannot masquerade as Site-scoped data', async () => {
  const value = fact();
  const contractorId = randomUUID();
  const global = {
    ...value,
    sourceKind: 'CONTRACTOR_STATE',
    sourceId: contractorId,
    siteId: null,
    payload: { contractorId, isActive: false },
  };
  assert.equal(parseZoneAuthorityFact(global).siteId, null);
  assert.throws(() => parseZoneAuthorityFact({ ...global, siteId: value.siteId }), invalid);
});

test('authority command rejects malformed, oversized and non-interoperable JSON before database access', async () => {
  const value = {
    commandId: randomUUID(),
    operation: 'TEST',
    actor: { kind: 'SERVICE', subject: 'synthetic' },
    request: {},
  };
  for (const bad of [
    { ...value, workerId: randomUUID() },
    { ...value, actor: { ...value.actor, userId: randomUUID() } },
    { ...value, request: { unsafe: Number.MAX_SAFE_INTEGER + 1 } },
    { ...value, request: { huge: 'a'.repeat(65537) } },
  ])
    await assert.rejects(
      executeZoneAuthorityCommand(undefined as unknown as DataSource, bad, async () => []),
      invalid,
    );
});

test('SERIALIZABLE retry reruns the whole transaction only for recognized database conflicts', async () => {
  for (const code of ['40001', '40P01']) {
    let calls = 0;
    const manager = {} as EntityManager;
    const source = {
      transaction: async (isolation: string, work: (m: EntityManager) => Promise<unknown>) => {
        assert.equal(isolation, 'SERIALIZABLE');
        calls++;
        return work(manager);
      },
    } as unknown as DataSource;
    const result = await withZoneAuthorityTransaction(source, async (m: EntityManager) => {
      assert.equal(m, manager);
      if (calls < 3)
        throw new QueryFailedError(
          'synthetic',
          [],
          Object.assign(new Error('synthetic database error'), { code }),
        );
      return 'committed';
    });
    assert.equal(result, 'committed');
    assert.equal(calls, 3);
  }
});

test('authority retry is bounded and never retries validation, uniqueness or arbitrary code-shaped errors', async () => {
  for (const [error, expected] of [
    [
      new QueryFailedError(
        'synthetic',
        [],
        Object.assign(new Error('synthetic database error'), { code: '40001' }),
      ),
      3,
    ],
    [
      new QueryFailedError(
        'synthetic',
        [],
        Object.assign(new Error('synthetic database error'), { code: '23505' }),
      ),
      1,
    ],
    [new Error('validation failure'), 1],
    [Object.assign(new Error('not a driver error'), { code: '40001' }), 1],
  ] as const) {
    let calls = 0;
    const source = {
      transaction: async () => {
        calls++;
        throw error;
      },
    } as unknown as DataSource;
    await assert.rejects(
      withZoneAuthorityTransaction(source, async () => null),
      (failure: unknown) => {
        if (expected === 3)
          return (
            failure instanceof PublicHttpException &&
            failure.getStatus() === 503 &&
            failure.publicPayload.code === 'SERVICE_UNAVAILABLE' &&
            !failure.message.includes('synthetic')
          );
        return failure === error;
      },
    );
    assert.equal(calls, expected);
  }
});
