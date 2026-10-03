import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneRestrictionPolicy } from '../src/database/entities/enums.js';
import {
  checkCurrentWorkerZoneAllowPrerequisites,
  checkWorkerZoneAllowContainment,
  evaluateZoneAuthority,
  type CurrentWorkerZoneGrantPrerequisites,
} from '../src/modules/zones/zone-authority-chain.policy.js';

const ids = {
  siteId: '11111111-1111-4111-8111-111111111111',
  zoneId: '22222222-2222-4222-8222-222222222222',
  workerId: '33333333-3333-4333-8333-333333333333',
  contractorId: '44444444-4444-4444-8444-444444444444',
};
const validFrom = new Date('2026-10-10T08:00:00Z');
const validUntil = new Date('2026-10-10T17:00:00Z');
const interval = () => ({ ...ids, validFrom, validUntil, revokedAt: null });
const proposal = { ...ids, validFrom, validUntil };
const current = (): CurrentWorkerZoneGrantPrerequisites => ({
  ...ids,
  purpose: 'GRANT_CREATION',
  checkedAt: new Date('2026-10-04T08:00:00Z'),
  participationIntervals: [interval()],
  assignmentIntervals: [interval()],
  contractorGrants: [{ ...interval(), effect: 'ALLOW' }],
});

test('command prerequisites can validate a new grant but cannot authorize a camera observation', () => {
  const facts = current();
  assert.equal(checkCurrentWorkerZoneAllowPrerequisites(facts, proposal).status, 'CONTAINED');
  assert.equal(checkWorkerZoneAllowContainment(facts, proposal).status, 'UNAVAILABLE');
  assert.equal(
    evaluateZoneAuthority(facts, ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED, validFrom, ids)
      .status,
    'UNAVAILABLE',
  );
});

test('a mixed command/COMPLETE tag cannot masquerade as historical authorization', () => {
  const mixed = {
    ...current(),
    status: 'COMPLETE',
    snapshotVersion: 'synthetic',
    workerGrants: [{ ...interval(), effect: 'ALLOW' }],
  };
  assert.equal(
    evaluateZoneAuthority(mixed, ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED, validFrom, ids)
      .status,
    'UNAVAILABLE',
  );
  assert.equal(checkWorkerZoneAllowContainment(mixed, proposal).status, 'UNAVAILABLE');
});

test('current grant checks reject a mixed historical status tag rather than certifying its purpose', () => {
  assert.equal(
    checkCurrentWorkerZoneAllowPrerequisites({ ...current(), status: 'COMPLETE' }, proposal).status,
    'UNAVAILABLE',
  );
});

test('missing, malformed and mismatched command collections return unavailable', () => {
  for (const facts of [
    undefined,
    { ...current(), checkedAt: new Date(NaN) },
    { ...current(), purpose: 'LIVE' },
    { ...current(), contractorId: ids.workerId },
    { ...current(), participationIntervals: undefined },
    { ...current(), assignmentIntervals: [{ ...interval(), workerId: ids.contractorId }] },
    { ...current(), contractorGrants: [{ ...interval(), siteId: ids.zoneId, effect: 'DENY' }] },
  ])
    assert.equal(checkCurrentWorkerZoneAllowPrerequisites(facts, proposal).status, 'UNAVAILABLE');
});

test('current grant calculations preserve half-open coverage and Contractor DENY precedence', () => {
  const facts = current();
  const denied = {
    ...facts,
    contractorGrants: [...facts.contractorGrants, { ...interval(), effect: 'DENY' }],
  };
  assert.equal(
    checkCurrentWorkerZoneAllowPrerequisites(denied, proposal).reasonCode,
    'CONTRACTOR_DENY',
  );
  assert.equal(
    checkCurrentWorkerZoneAllowPrerequisites(facts, {
      ...proposal,
      validUntil: new Date(validUntil.getTime() + 1),
    }).status,
    'NOT_CONTAINED',
  );
  assert.equal(
    checkCurrentWorkerZoneAllowPrerequisites(facts, { ...proposal, validUntil: validFrom })
      .reasonCode,
    'INVALID_REQUEST',
  );
});
