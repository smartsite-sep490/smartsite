import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneRestrictionPolicy } from '../src/database/entities/enums.js';
import {
  evaluateZoneAuthority,
  type CompleteZoneAuthoritySnapshot,
} from '../src/modules/zones/zone-authority-chain.policy.js';

const ids = {
  siteId: '11111111-1111-4111-8111-111111111111',
  zoneId: '22222222-2222-4222-8222-222222222222',
  workerId: '33333333-3333-4333-8333-333333333333',
  contractorId: '44444444-4444-4444-8444-444444444444',
};
const time = (value: string) => new Date(`2026-10-02T${value}:00Z`);
const interval = () => ({
  ...ids,
  validFrom: time('08:00'),
  validUntil: time('17:00'),
  revokedAt: null,
});
type MutableSnapshot = Omit<
  CompleteZoneAuthoritySnapshot,
  'participationIntervals' | 'assignmentIntervals' | 'contractorGrants' | 'workerGrants'
> & {
  participationIntervals: Array<CompleteZoneAuthoritySnapshot['participationIntervals'][number]>;
  assignmentIntervals: Array<CompleteZoneAuthoritySnapshot['assignmentIntervals'][number]>;
  contractorGrants: Array<CompleteZoneAuthoritySnapshot['contractorGrants'][number]>;
  workerGrants: Array<CompleteZoneAuthoritySnapshot['workerGrants'][number]>;
};
const snapshot = (): MutableSnapshot => ({
  status: 'COMPLETE' as const,
  snapshotVersion: 'synthetic-history-revision-1',
  ...ids,
  participationIntervals: [interval()],
  assignmentIntervals: [interval()],
  contractorGrants: [
    {
      ...interval(),
      effect: 'ALLOW',
    },
  ],
  workerGrants: [{ ...ids, ...interval(), effect: 'ALLOW' as const }],
});
const policy = ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED;

test('a two-tier policy can distinguish missing contractor rights from worker rights', () => {
  const facts = snapshot();
  facts.contractorGrants = [];
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'DENIED');
});

test('both tiers and membership must be active for an allowed event-time assessment', () => {
  const result = evaluateZoneAuthority(snapshot(), policy, time('09:00'), ids);
  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.reasonCode, 'VALID_ALLOW');
  assert.equal(result.workerId, ids.workerId);
});

test('site participation alone cannot replace contractor zone authorization', () => {
  const facts = snapshot();
  facts.contractorGrants = [];
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'DENIED');
  facts.contractorGrants = snapshot().contractorGrants;
  facts.workerGrants = [];
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'DENIED');
});

test('unavailable history and unknown identity remain unavailable, not unauthorized', () => {
  for (const facts of [undefined, { status: 'UNAVAILABLE', reason: 'READER_OFFLINE' }]) {
    const result = evaluateZoneAuthority(facts, policy, time('09:00'), ids);
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
  }
  const result = evaluateZoneAuthority(snapshot(), policy, time('09:00'), {
    ...ids,
    workerId: undefined,
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
});

test('missing contractor scope or incomplete collections are not complete no-allow history', () => {
  for (const key of [
    'contractorId',
    'participationIntervals',
    'assignmentIntervals',
    'contractorGrants',
    'workerGrants',
    'snapshotVersion',
  ]) {
    const facts = { ...snapshot(), [key]: undefined };
    const result = evaluateZoneAuthority(facts, policy, time('09:00'), ids);
    assert.equal(result.status, 'UNAVAILABLE', key);
  }
});

test('cross-worker/site/zone/contractor grant contamination never allows', () => {
  const other = '55555555-5555-4555-8555-555555555555';
  for (const field of ['siteId', 'zoneId', 'workerId']) {
    assert.equal(
      evaluateZoneAuthority({ ...snapshot(), [field]: other }, policy, time('09:00'), ids).status,
      'UNAVAILABLE',
    );
  }
  for (const field of ['siteId', 'zoneId', 'contractorId']) {
    const facts = snapshot();
    facts.contractorGrants[0] = { ...facts.contractorGrants[0]!, [field]: other };
    assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'UNAVAILABLE');
  }
  for (const field of ['siteId', 'zoneId', 'workerId', 'contractorId']) {
    const facts = snapshot();
    facts.workerGrants[0] = { ...facts.workerGrants[0]!, [field]: other };
    assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'UNAVAILABLE');
  }
});

test('end and revocation boundaries exclude each layer even with a surviving worker allow', () => {
  for (const key of [
    'participationIntervals',
    'assignmentIntervals',
    'contractorGrants',
    'workerGrants',
  ] as const) {
    const facts = snapshot();
    facts[key][0]!.validUntil = time('09:00');
    assert.equal(evaluateZoneAuthority(facts, policy, time('08:59'), ids).status, 'ALLOWED', key);
    assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'DENIED', key);
    facts[key][0]!.validUntil = time('17:00');
    Object.assign(facts[key][0]!, { revokedAt: time('09:00') });
    assert.equal(evaluateZoneAuthority(facts, policy, time('08:59'), ids).status, 'ALLOWED', key);
    assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'DENIED', key);
  }
});

test('an explicit deny at either tier wins over simultaneous allow', () => {
  for (const key of ['contractorGrants', 'workerGrants'] as const) {
    const facts = snapshot();
    facts[key].push({ ...facts.workerGrants[0]!, effect: 'DENY' });
    const result = evaluateZoneAuthority(facts, policy, time('09:00'), ids);
    assert.equal(result.status, 'DENIED');
    assert.equal(result.reasonCode, 'EXPLICIT_DENY');
  }
});

test('invalid time/interval/effect cannot erase a deny or produce a valid allow', () => {
  assert.equal(
    evaluateZoneAuthority(snapshot(), policy, new Date('invalid'), ids).status,
    'UNAVAILABLE',
  );
  for (const key of [
    'participationIntervals',
    'assignmentIntervals',
    'contractorGrants',
    'workerGrants',
  ] as const) {
    for (const change of [
      { validFrom: new Date('invalid') },
      { validUntil: time('08:00') },
      { revokedAt: new Date('invalid') },
    ]) {
      const facts = snapshot();
      Object.assign(facts[key][0]!, change);
      assert.equal(
        evaluateZoneAuthority(facts, policy, time('09:00'), ids).status,
        'UNAVAILABLE',
        key,
      );
    }
  }
  const facts = snapshot();
  Object.assign(facts.contractorGrants[0]!, { effect: 'INVALID' });
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'UNAVAILABLE');
});

test('none and prohibited policies remain independent of unknown identity or missing history', () => {
  assert.equal(
    evaluateZoneAuthority(undefined, ZoneRestrictionPolicy.NONE, new Date('invalid'), {
      ...ids,
      workerId: undefined,
    }).reasonCode,
    'POLICY_NONE',
  );
  assert.equal(
    evaluateZoneAuthority(
      undefined,
      ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      new Date('invalid'),
      { ...ids, workerId: undefined },
    ).reasonCode,
    'PROHIBITED_FOR_ALL',
  );
});

test('start boundary is inclusive and future or revoked denies do not suppress valid allows', () => {
  assert.equal(evaluateZoneAuthority(snapshot(), policy, time('07:59'), ids).status, 'DENIED');
  assert.equal(evaluateZoneAuthority(snapshot(), policy, time('08:00'), ids).status, 'ALLOWED');
  const facts = snapshot();
  facts.contractorGrants.push({
    ...facts.contractorGrants[0]!,
    effect: 'DENY',
    validFrom: time('10:00'),
  });
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'ALLOWED');
  facts.contractorGrants[1]!.validFrom = time('08:00');
  facts.contractorGrants[1]!.revokedAt = time('09:00');
  assert.equal(
    evaluateZoneAuthority(facts, policy, time('08:59'), ids).reasonCode,
    'EXPLICIT_DENY',
  );
  assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'ALLOWED');
  facts.contractorGrants[1]!.validFrom = time('10:00');
  // A scheduled grant can be cancelled before its effective start.
  assert.equal(evaluateZoneAuthority(facts, policy, time('10:00'), ids).status, 'ALLOWED');
});

test('complete empty membership is denial while malformed dates and Track ID identity abstain', () => {
  for (const key of ['participationIntervals', 'assignmentIntervals'] as const) {
    const facts = snapshot();
    facts[key] = [];
    assert.equal(
      evaluateZoneAuthority(facts, policy, time('09:00'), ids).reasonCode,
      'NO_VALID_ALLOW',
    );
    Object.assign(facts, {
      [key]: [{ validFrom: '2026-10-02T08:00:00Z', validUntil: null, revokedAt: null }],
    });
    assert.equal(evaluateZoneAuthority(facts, policy, time('09:00'), ids).status, 'UNAVAILABLE');
  }
  assert.equal(
    evaluateZoneAuthority(snapshot(), policy, time('09:00'), { ...ids, workerId: '7' }).reasonCode,
    'IDENTITY_UNAVAILABLE',
  );
});

test('membership intervals from another site/contractor/worker/zone never satisfy the chain', () => {
  const other = '55555555-5555-4555-8555-555555555555';
  for (const field of ['siteId', 'contractorId']) {
    const facts = snapshot();
    Object.assign(facts.participationIntervals[0]!, { [field]: other });
    assert.equal(
      evaluateZoneAuthority(facts, policy, time('09:00'), ids).status,
      'UNAVAILABLE',
      `participation:${field}`,
    );
  }
  for (const field of ['siteId', 'contractorId', 'workerId', 'zoneId']) {
    const facts = snapshot();
    Object.assign(facts.assignmentIntervals[0]!, { [field]: other });
    assert.equal(
      evaluateZoneAuthority(facts, policy, time('09:00'), ids).status,
      'UNAVAILABLE',
      `assignment:${field}`,
    );
  }
});
