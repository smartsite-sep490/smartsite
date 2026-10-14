import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkWorkerZoneAllowContainment as check,
  evaluateZoneAuthority,
  type CompleteZoneAuthoritySnapshot,
} from '../src/modules/zones/zone-authority-chain.policy.js';
import { ZoneRestrictionPolicy } from '../src/database/entities/enums.js';

const ids = {
  siteId: '11111111-1111-4111-8111-111111111111',
  zoneId: '22222222-2222-4222-8222-222222222222',
  workerId: '33333333-3333-4333-8333-333333333333',
  contractorId: '44444444-4444-4444-8444-444444444444',
};
const at = (hours: number) => new Date(Date.UTC(2026, 9, 3, hours));
const interval = (from = 8, until: number | null = 17) => ({
  ...ids,
  validFrom: at(from),
  validUntil: until === null ? null : at(until),
  revokedAt: null as Date | null,
});
const facts = () => ({
  status: 'COMPLETE' as const,
  snapshotVersion: 'synthetic-owner-snapshot-1',
  ...ids,
  participationIntervals: [interval()],
  assignmentIntervals: [interval()],
  contractorGrants: [{ ...interval(), effect: 'ALLOW' as 'ALLOW' | 'DENY' }],
  workerGrants: [{ ...interval(), effect: 'ALLOW' as 'ALLOW' | 'DENY' }],
});
const proposal = (from = 8, until: number | null = 17) => ({
  ...ids,
  validFrom: at(from),
  validUntil: until === null ? null : at(until),
});

test('a scoped ALLOW interval fits the complete authority chain at both boundaries', () => {
  assert.deepEqual(check(facts(), proposal()), {
    status: 'CONTAINED',
    reasonCode: 'FULL_COVERAGE',
  });
});

for (const layer of [
  'participationIntervals',
  'assignmentIntervals',
  'contractorGrants',
] as const) {
  test(`${layer}: covering the start alone cannot permit the entire requested interval`, () => {
    const snapshot = facts();
    snapshot[layer][0]!.validUntil = at(10);
    assert.equal(check(snapshot, proposal())?.status, 'NOT_CONTAINED');
  });

  test(`${layer}: a one-millisecond gap fails even when both endpoints are covered`, () => {
    const snapshot = facts();
    Object.assign(snapshot, {
      [layer]: [
        { ...interval(8, 12), effect: 'ALLOW' },
        { ...interval(12, 17), validFrom: new Date(at(12).getTime() + 1), effect: 'ALLOW' },
      ],
    });
    assert.equal(check(snapshot, proposal())?.status, 'NOT_CONTAINED');
  });

  test(`${layer}: revocation truncates coverage without deleting a child grant`, () => {
    const snapshot = facts();
    snapshot[layer][0]!.revokedAt = at(12);
    assert.equal(check(snapshot, proposal())?.status, 'NOT_CONTAINED');
    assert.equal(check(snapshot, proposal(8, 12))?.status, 'CONTAINED');
  });
}

test('unordered overlapping and adjacent intervals cover continuously in every layer', () => {
  const snapshot = facts();
  const intervals = [interval(12, 17), interval(8, 10), interval(9, 12)];
  snapshot.participationIntervals = intervals;
  snapshot.assignmentIntervals = intervals;
  snapshot.contractorGrants = intervals.map((value) => ({ ...value, effect: 'ALLOW' }));
  assert.equal(check(snapshot, proposal())?.status, 'CONTAINED');
});

test('Contractor DENY inside an otherwise covered interval prevents containment', () => {
  const snapshot = facts();
  snapshot.contractorGrants.push({ ...interval(11, 12), effect: 'DENY' });
  assert.deepEqual(check(snapshot, proposal()), {
    status: 'NOT_CONTAINED',
    reasonCode: 'CONTRACTOR_DENY',
  });
});

test('half-open DENY boundaries do not suppress an adjacent ALLOW interval', () => {
  const snapshot = facts();
  snapshot.contractorGrants.push(
    { ...interval(7, 8), effect: 'DENY' },
    { ...interval(17, 18), effect: 'DENY' },
  );
  assert.equal(check(snapshot, proposal())?.status, 'CONTAINED');
});

test('a cancelled future ALLOW supplies no coverage; a cancelled DENY supplies no restriction', () => {
  const snapshot = facts();
  snapshot.contractorGrants[0]!.revokedAt = at(7);
  assert.equal(check(snapshot, proposal())?.status, 'NOT_CONTAINED');
  snapshot.contractorGrants[0]!.revokedAt = null;
  snapshot.contractorGrants.push({ ...interval(10, 12), revokedAt: at(9), effect: 'DENY' });
  assert.equal(check(snapshot, proposal())?.status, 'CONTAINED');
});

test('open-ended ALLOW needs open-ended coverage in every authority layer', () => {
  const snapshot = facts();
  for (const layer of [
    'participationIntervals',
    'assignmentIntervals',
    'contractorGrants',
  ] as const) {
    assert.equal(check(snapshot, proposal(8, null))?.status, 'NOT_CONTAINED');
    snapshot[layer][0]!.validUntil = null;
  }
  assert.equal(check(snapshot, proposal(8, null))?.status, 'CONTAINED');
  snapshot.assignmentIntervals[0]!.revokedAt = at(17);
  assert.equal(check(snapshot, proposal(8, null))?.status, 'NOT_CONTAINED');
});

test('complete empty parent rights are not contained; missing history is unavailable', () => {
  assert.equal(check({ ...facts(), contractorGrants: [] }, proposal())?.status, 'NOT_CONTAINED');
  for (const snapshot of [
    undefined,
    { status: 'UNAVAILABLE' },
    { ...facts(), assignmentIntervals: undefined },
  ]) {
    assert.equal(check(snapshot, proposal())?.status, 'UNAVAILABLE');
  }
});

test('malformed request times and missing/cross-scope IDs are unavailable, not a business denial', () => {
  for (const change of [
    { validFrom: new Date('invalid') },
    { validUntil: new Date('invalid') },
    { validUntil: at(8) },
    { validUntil: at(7) },
    { workerId: 'track-7' },
    { contractorId: undefined },
  ])
    assert.equal(check(facts(), { ...proposal(), ...change })?.status, 'UNAVAILABLE');
  const other = '55555555-5555-4555-8555-555555555555';
  for (const field of ['siteId', 'zoneId', 'workerId', 'contractorId']) {
    assert.equal(check(facts(), { ...proposal(), [field]: other })?.status, 'UNAVAILABLE');
  }
  const snapshot = facts();
  snapshot.contractorGrants[0]!.contractorId = other;
  assert.equal(check(snapshot, proposal())?.status, 'UNAVAILABLE');
  snapshot.contractorGrants[0]!.contractorId = ids.contractorId;
  snapshot.assignmentIntervals[0]!.validFrom = new Date('invalid');
  assert.equal(check(snapshot, proposal())?.status, 'UNAVAILABLE');
});

test('containment does not mutate owner snapshots or authorize a real entry', () => {
  const snapshot: CompleteZoneAuthoritySnapshot = facts();
  const before = structuredClone(snapshot);
  assert.equal(check(snapshot, proposal(9, 10))?.status, 'CONTAINED');
  assert.deepEqual(snapshot, before);
});

test('a contained proposal does not bypass an existing Worker DENY for entry authorization', () => {
  const snapshot = facts();
  snapshot.workerGrants.push({ ...interval(9, 10), effect: 'DENY' });
  assert.equal(check(snapshot, proposal()).status, 'CONTAINED');
  assert.equal(
    evaluateZoneAuthority(snapshot, ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED, at(9), ids)
      .reasonCode,
    'EXPLICIT_DENY',
  );
});
