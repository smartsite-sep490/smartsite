import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { decodeStoredAuthoritySnapshot } from '../src/modules/zones/zone-authority-snapshot-codec.js';
import { evaluateZoneAuthority } from '../src/modules/zones/zone-authority-chain.policy.js';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AUTHORITY_SNAPSHOT_BYTE_LIMIT,
} from '../src/modules/zones/zone-authority-reader.port.js';

function fixture(effect: 'ALLOW' | 'DENY' = 'ALLOW') {
  const scope = {
    siteId: randomUUID(),
    zoneId: randomUUID(),
    workerId: randomUUID(),
    contractorId: randomUUID(),
  };
  const from = '2026-10-01T00:00:00.000Z',
    capturedAt = '2026-10-03T00:00:00.000Z',
    readAt = '2026-10-04T00:00:00.000Z';
  const interval = { validFrom: from, validUntil: null, revokedAt: null };
  const participationId = randomUUID(),
    assignmentId = randomUUID(),
    contractorGrantId = randomUUID(),
    workerGrantId = randomUUID();
  const sources = [
    {
      sourceKind: 'CONTRACTOR_STATE',
      sourceId: scope.contractorId,
      siteId: null,
      payload: { contractorId: scope.contractorId, isActive: true },
    },
    {
      sourceKind: 'WORKER_MEMBERSHIP',
      sourceId: scope.workerId,
      siteId: scope.siteId,
      payload: {
        siteId: scope.siteId,
        workerId: scope.workerId,
        contractorId: scope.contractorId,
        isActive: true,
      },
    },
    {
      sourceKind: 'ZONE_POLICY',
      sourceId: scope.zoneId,
      siteId: scope.siteId,
      payload: {
        siteId: scope.siteId,
        zoneId: scope.zoneId,
        restrictionPolicy: 'AUTHORIZATION_REQUIRED',
      },
    },
    {
      sourceKind: 'PARTICIPATION',
      sourceId: participationId,
      siteId: scope.siteId,
      payload: {
        participationId,
        siteId: scope.siteId,
        contractorId: scope.contractorId,
        isActive: true,
        validFrom: from,
        validUntil: null,
      },
    },
    {
      sourceKind: 'ASSIGNMENT',
      sourceId: assignmentId,
      siteId: scope.siteId,
      payload: {
        assignmentId,
        siteId: scope.siteId,
        workerId: scope.workerId,
        contractorId: scope.contractorId,
        zoneIds: [scope.zoneId],
        status: 'APPROVED',
        validFrom: from,
        validUntil: null,
      },
    },
    {
      sourceKind: 'CONTRACTOR_ZONE_GRANT',
      sourceId: contractorGrantId,
      siteId: scope.siteId,
      payload: {
        grantId: contractorGrantId,
        siteId: scope.siteId,
        zoneId: scope.zoneId,
        contractorId: scope.contractorId,
        effect: 'ALLOW',
        ...interval,
      },
    },
    {
      sourceKind: 'WORKER_ZONE_GRANT',
      sourceId: workerGrantId,
      siteId: scope.siteId,
      payload: { grantId: workerGrantId, ...scope, effect, ...interval },
    },
  ];
  const payload = {
    schemaVersion: '1.0.0',
    readerVersion: 'zone-authority-history-v1',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    scope,
    capturedAt,
    readAt,
    epoch: {
      siteId: scope.siteId,
      startedAt: '2026-10-02T00:00:00.000Z',
      writerManifestHash: 'b'.repeat(64),
    },
    coverage: { method: 'SCOPED_SOURCE_CLOSURE', transactionIsolation: 'SERIALIZABLE' },
    evidence: {
      sources,
      facts: sources.map((source) => ({
        ...structuredClone(source),
        id: randomUUID(),
        commandId: randomUUID(),
        revision: '1',
        effectiveFrom: from,
        effectiveTo: null,
        recordedAt: from,
      })),
    },
    policyProjection: {
      status: 'COMPLETE',
      ...scope,
      participationIntervals: [{ ...scope, ...interval }],
      assignmentIntervals: [{ ...scope, ...interval }],
      contractorGrants: [{ ...scope, effect: 'ALLOW', ...interval }],
      workerGrants: [{ ...scope, effect, ...interval }],
    },
    restrictionPolicy: 'AUTHORIZATION_REQUIRED',
    eligibility: { workerActive: true, contractorActive: true },
  };
  const artifact = { payload, snapshotVersion: computeCanonicalPayloadHash(payload) };
  const expected = {
    siteId: scope.siteId,
    zoneId: scope.zoneId,
    workerId: scope.workerId,
    capturedAt: new Date(capturedAt),
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
    snapshotVersion: artifact.snapshotVersion,
  };
  return { artifact, expected };
}
function reason(value: ReturnType<typeof decodeStoredAuthoritySnapshot>) {
  assert.equal(value.status, 'UNAVAILABLE');
  return value.status === 'UNAVAILABLE' ? value.reason : null;
}

test('saved ALLOW and negative DENY decode into typed policy Dates without input mutation', () => {
  for (const effect of ['ALLOW', 'DENY'] as const) {
    const f = fixture(effect),
      saved = structuredClone(f.artifact);
    const result = decodeStoredAuthoritySnapshot(f.artifact, f.expected);
    assert.equal(result.status, 'VALID');
    if (result.status === 'VALID') {
      assert.ok(result.snapshot.workerGrants[0]?.validFrom instanceof Date);
      assert.deepEqual(result.capturedAt, f.expected.capturedAt);
      assert.equal(result.purpose, f.expected.purpose);
      assert.equal(
        evaluateZoneAuthority(
          result.snapshot,
          result.restrictionPolicy,
          result.capturedAt,
          f.expected,
        ).status,
        effect === 'ALLOW' ? 'ALLOWED' : 'DENIED',
      );
    }
    assert.deepEqual(f.artifact, saved);
    assert.equal(
      decodeStoredAuthoritySnapshot(f.artifact, {
        ...f.expected,
        workerId: f.expected.workerId.toUpperCase(),
      }).status,
      'VALID',
    );
  }
});

test('trusted expected scope, original purpose, capture time and row digest are independently binding', () => {
  const f = fixture();
  for (const delta of [
    { siteId: randomUUID() },
    { zoneId: randomUUID() },
    { workerId: randomUUID() },
    { purpose: 'RETROSPECTIVE_REVIEW' as const },
    { capturedAt: new Date('2026-10-03T00:00:00.001Z') },
  ])
    assert.equal(
      reason(decodeStoredAuthoritySnapshot(f.artifact, { ...f.expected, ...delta })),
      'SNAPSHOT_BINDING_MISMATCH',
    );
  assert.equal(
    reason(
      decodeStoredAuthoritySnapshot(f.artifact, { ...f.expected, snapshotVersion: 'a'.repeat(64) }),
    ),
    'SNAPSHOT_DIGEST_MISMATCH',
  );
  const changed = structuredClone(f.artifact);
  changed.payload.eligibility.workerActive = false;
  assert.equal(
    reason(decodeStoredAuthoritySnapshot(changed, f.expected)),
    'SNAPSHOT_DIGEST_MISMATCH',
  );
});

test('rehashing a changed projection, policy, scope Contractor or eligibility cannot override unchanged history', () => {
  const mutations = [
    (p: ReturnType<typeof fixture>['artifact']['payload']) => {
      p.policyProjection.workerGrants[0]!.effect = 'DENY';
    },
    (p: ReturnType<typeof fixture>['artifact']['payload']) => {
      p.eligibility.contractorActive = false;
    },
    (p: ReturnType<typeof fixture>['artifact']['payload']) => {
      p.restrictionPolicy = 'NONE';
    },
    (p: ReturnType<typeof fixture>['artifact']['payload']) => {
      p.scope.contractorId = randomUUID();
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.artifact.payload);
    f.artifact.snapshotVersion = computeCanonicalPayloadHash(f.artifact.payload);
    assert.equal(
      reason(
        decodeStoredAuthoritySnapshot(f.artifact, {
          ...f.expected,
          snapshotVersion: f.artifact.snapshotVersion,
        }),
      ),
      'SNAPSHOT_PROJECTION_MISMATCH',
    );
  }
});

test('closed structures, non-JSON values and impossible metadata times are rejected', () => {
  const f = fixture();
  const changed: unknown[] = [
    { ...f.artifact, extra: true },
    { ...f.artifact, payload: { ...f.artifact.payload, extra: true } },
    {
      ...f.artifact,
      payload: { ...f.artifact.payload, capturedAt: new Date(f.expected.capturedAt) },
    },
    { ...f.artifact, payload: { ...f.artifact.payload, readAt: 'not-a-date' } },
    {
      ...f.artifact,
      payload: { ...f.artifact.payload, scope: { ...f.artifact.payload.scope, extra: undefined } },
    },
    {
      ...f.artifact,
      payload: {
        ...f.artifact.payload,
        eligibility: { ...f.artifact.payload.eligibility, extra: NaN },
      },
    },
    { ...f.artifact, payload: { ...f.artifact.payload, readAt: Infinity } },
  ];
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  changed.push(cycle);
  for (const value of changed)
    assert.equal(reason(decodeStoredAuthoritySnapshot(value, f.expected)), 'MALFORMED_SNAPSHOT');
  for (const [key, value] of [
    ['readAt', '2026-10-02T00:00:00.000Z'],
    ['capturedAt', '2026-10-01T00:00:00.000Z'],
    ['readAt', '2026-02-30T00:00:00.000Z'],
  ]) {
    const g = fixture();
    Object.assign(g.artifact.payload, { [key!]: value });
    g.artifact.snapshotVersion = computeCanonicalPayloadHash(g.artifact.payload);
    assert.equal(
      reason(
        decodeStoredAuthoritySnapshot(g.artifact, {
          ...g.expected,
          snapshotVersion: g.artifact.snapshotVersion,
        }),
      ),
      'MALFORMED_SNAPSHOT',
    );
  }
});

test('missing, orphaned, gapped, malformed and legacy anchored evidence never yields a saved authority', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.artifact.payload.evidence.facts = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.artifact.payload.evidence.sources = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.artifact.payload.evidence.facts[0]!.revision = '2';
    },
    (f: ReturnType<typeof fixture>) => {
      Object.assign(f.artifact.payload.evidence.facts[0]!.payload, { secret: 'forbidden' });
    },
    (f: ReturnType<typeof fixture>) => {
      Object.assign(f.artifact.payload.evidence.facts[1]!.payload, { contractorId: null });
      Object.assign(f.artifact.payload.evidence.sources[1]!.payload, { contractorId: null });
    },
  ]) {
    const f = fixture();
    mutate(f);
    f.artifact.snapshotVersion = computeCanonicalPayloadHash(f.artifact.payload);
    assert.equal(
      decodeStoredAuthoritySnapshot(f.artifact, {
        ...f.expected,
        snapshotVersion: f.artifact.snapshotVersion,
      }).status,
      'UNAVAILABLE',
    );
  }
});

test('unknown versions and count/byte overflow fail closed without truncation', () => {
  for (const field of ['readerVersion', 'schemaVersion']) {
    const f = fixture();
    Object.assign(f.artifact.payload, { [field]: 'future-v2' });
    assert.equal(
      reason(decodeStoredAuthoritySnapshot(f.artifact, f.expected)),
      'UNSUPPORTED_SNAPSHOT_VERSION',
    );
  }
  for (const field of ['facts', 'sources'] as const) {
    const f = fixture();
    Object.assign(f.artifact.payload.evidence, {
      [field]: Array(AUTHORITY_HISTORY_FACT_LIMIT + 1).fill(f.artifact.payload.evidence[field][0]),
    });
    assert.equal(reason(decodeStoredAuthoritySnapshot(f.artifact, f.expected)), 'RESOURCE_LIMIT');
  }
  const f = fixture();
  assert.equal(
    reason(
      decodeStoredAuthoritySnapshot(
        {
          ...f.artifact,
          payload: { ...f.artifact.payload, padding: 'x'.repeat(AUTHORITY_SNAPSHOT_BYTE_LIMIT) },
        },
        f.expected,
      ),
    ),
    'RESOURCE_LIMIT',
  );
  const largeFact = fixture();
  Object.assign(largeFact.artifact.payload.evidence.facts[0]!.payload, {
    padding: 'x'.repeat(16384),
  });
  assert.equal(
    reason(decodeStoredAuthoritySnapshot(largeFact.artifact, largeFact.expected)),
    'RESOURCE_LIMIT',
  );
});

test('offset-aware validity strings are supported, future inactive revisions stay evidence without changing captured-time eligibility', () => {
  const f = fixture();
  for (const source of f.artifact.payload.evidence.sources)
    if ('validFrom' in source.payload) source.payload.validFrom = '2026-10-01T07:00:00+07:00';
  for (const fact of f.artifact.payload.evidence.facts)
    if ('validFrom' in fact.payload) fact.payload.validFrom = '2026-10-01T07:00:00+07:00';
  const first = f.artifact.payload.evidence.facts[0]!;
  const inactive = structuredClone(first);
  Object.assign(inactive, {
    id: randomUUID(),
    commandId: randomUUID(),
    revision: '2',
    recordedAt: f.artifact.payload.readAt,
    effectiveFrom: f.artifact.payload.readAt,
  });
  Object.assign(inactive.payload, { isActive: false });
  f.artifact.payload.evidence.facts.push(inactive);
  Object.assign(f.artifact.payload.evidence.sources[0]!.payload, { isActive: false });
  f.artifact.snapshotVersion = computeCanonicalPayloadHash(f.artifact.payload);
  const result = decodeStoredAuthoritySnapshot(f.artifact, {
    ...f.expected,
    snapshotVersion: f.artifact.snapshotVersion,
  });
  assert.equal(result.status, 'VALID');
  if (result.status === 'VALID')
    assert.equal(
      evaluateZoneAuthority(
        result.snapshot,
        result.restrictionPolicy,
        result.capturedAt,
        f.expected,
      ).status,
      'ALLOWED',
    );
});

test('extra fields at every closed boundary and malformed independent context are rejected', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => Object.assign(f.artifact.payload.scope, { extra: true }),
    (f: ReturnType<typeof fixture>) => Object.assign(f.artifact.payload.epoch, { extra: true }),
    (f: ReturnType<typeof fixture>) => Object.assign(f.artifact.payload.coverage, { extra: true }),
    (f: ReturnType<typeof fixture>) =>
      Object.assign(f.artifact.payload.policyProjection, { extra: true }),
    (f: ReturnType<typeof fixture>) =>
      Object.assign(f.artifact.payload.policyProjection.workerGrants[0]!, { extra: true }),
    (f: ReturnType<typeof fixture>) =>
      Object.assign(f.artifact.payload.evidence.facts[0]!, { extra: true }),
    (f: ReturnType<typeof fixture>) =>
      Object.assign(f.artifact.payload.evidence.sources[0]!, { extra: true }),
    (f: ReturnType<typeof fixture>) => Object.assign(f.artifact.payload.evidence, { extra: true }),
    (f: ReturnType<typeof fixture>) =>
      Object.assign(f.artifact.payload.eligibility, { extra: true }),
  ]) {
    const f = fixture();
    mutate(f);
    f.artifact.snapshotVersion = computeCanonicalPayloadHash(f.artifact.payload);
    assert.equal(
      reason(
        decodeStoredAuthoritySnapshot(f.artifact, {
          ...f.expected,
          snapshotVersion: f.artifact.snapshotVersion,
        }),
      ),
      'MALFORMED_SNAPSHOT',
    );
  }
  const f = fixture();
  for (const delta of [
    { capturedAt: new Date(NaN) },
    { workerId: 'Track-8' },
    { snapshotVersion: '' },
  ])
    assert.equal(
      reason(decodeStoredAuthoritySnapshot(f.artifact, { ...f.expected, ...delta })),
      'MALFORMED_SNAPSHOT',
    );
});

test('in-memory objects with non-JSON prototypes or hidden data cannot masquerade as saved JSON', () => {
  const f = fixture();
  const inherited = structuredClone(f.artifact);
  Object.setPrototypeOf(inherited.payload, { hiddenContext: 'not stored JSON' });
  const symbolic = structuredClone(f.artifact);
  Object.defineProperty(symbolic.payload, Symbol('hidden'), { value: true });
  const hidden = structuredClone(f.artifact);
  Object.defineProperty(hidden.payload, 'hidden', { value: true, enumerable: false });
  for (const value of [inherited, symbolic, hidden])
    assert.equal(reason(decodeStoredAuthoritySnapshot(value, f.expected)), 'MALFORMED_SNAPSHOT');
});
