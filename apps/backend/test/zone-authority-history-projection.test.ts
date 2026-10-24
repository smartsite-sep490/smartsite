import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  ZoneAuthoritySourceKind as Kind,
  ZoneRestrictionPolicy,
  ZoneAccessEffect,
  WorkerSiteZoneAssignmentStatus,
} from '../src/database/entities/index.js';
import { parseZoneAuthorityFact } from '../src/modules/zones/zone-authority-history.js';
import type { AuthorityHistoryRow } from '../src/modules/zones/zone-authority-reader.port.js';
import { projectSelectedZoneAuthority } from '../src/modules/zones/zone-authority-history-projection.js';

const scope = { siteId: randomUUID(), zoneId: randomUUID(), workerId: randomUUID() };
const contractorId = randomUUID();
const from = '2026-10-01T00:00:00.000Z';
function row(
  sourceKind: Kind,
  sourceId: string,
  payload: Record<string, unknown>,
): AuthorityHistoryRow {
  return {
    ...parseZoneAuthorityFact({
      sourceKind,
      sourceId,
      siteId: sourceKind === Kind.CONTRACTOR_STATE ? null : scope.siteId,
      effectiveFrom: new Date(from),
      effectiveTo: null,
      payload,
    }),
    id: randomUUID(),
    commandId: randomUUID(),
    revision: '1',
    recordedAt: new Date(from),
  };
}
function fixture(workerActive = true, contractorActive = true) {
  const assignmentId = randomUUID(),
    participationId = randomUUID(),
    grantId = randomUUID();
  return [
    row(Kind.WORKER_MEMBERSHIP, scope.workerId, {
      siteId: scope.siteId,
      workerId: scope.workerId,
      contractorId,
      isActive: workerActive,
    }),
    row(Kind.CONTRACTOR_STATE, contractorId, { contractorId, isActive: contractorActive }),
    row(Kind.ZONE_POLICY, scope.zoneId, {
      siteId: scope.siteId,
      zoneId: scope.zoneId,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    }),
    row(Kind.PARTICIPATION, participationId, {
      participationId,
      siteId: scope.siteId,
      contractorId,
      isActive: true,
      validFrom: from,
      validUntil: null,
    }),
    row(Kind.ASSIGNMENT, assignmentId, {
      assignmentId,
      siteId: scope.siteId,
      workerId: scope.workerId,
      contractorId,
      zoneIds: [scope.zoneId],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: from,
      validUntil: null,
    }),
    row(Kind.WORKER_ZONE_GRANT, grantId, {
      grantId,
      ...scope,
      contractorId,
      effect: ZoneAccessEffect.DENY,
      validFrom: from,
      validUntil: null,
      revokedAt: null,
    }),
  ];
}

test('historical membership determines Contractor; negative facts survive inactive eligibility without input mutation', () => {
  for (const [worker, contractor] of [
    [true, true],
    [false, true],
    [true, false],
  ]) {
    const selected = fixture(worker, contractor);
    const saved = structuredClone(selected);
    const result = projectSelectedZoneAuthority(selected, scope);
    assert.equal(result.status, 'PROJECTED');
    if (result.status === 'PROJECTED') {
      assert.equal(result.scope.contractorId, contractorId);
      assert.deepEqual(result.eligibility, { workerActive: worker, contractorActive: contractor });
      assert.equal(result.projection.participationIntervals.length, worker && contractor ? 1 : 0);
      assert.equal(result.projection.assignmentIntervals.length, worker && contractor ? 1 : 0);
      assert.equal(result.projection.workerGrants[0]?.effect, 'DENY');
      assert.ok(result.projection.workerGrants[0]?.validFrom instanceof Date);
    }
    assert.deepEqual(selected, saved);
  }
});

test('missing, cross-Site/Worker membership and missing Contractor/Zone state fail closed', () => {
  const selected = fixture();
  for (const rows of [
    selected.slice(1),
    selected.filter((f) => f.sourceKind !== Kind.CONTRACTOR_STATE),
    selected.filter((f) => f.sourceKind !== Kind.ZONE_POLICY),
  ])
    assert.equal(projectSelectedZoneAuthority(rows, scope).status, 'UNAVAILABLE');
  for (const other of [
    { ...scope, siteId: randomUUID() },
    { ...scope, workerId: randomUUID() },
    { ...scope, zoneId: randomUUID() },
  ])
    assert.equal(projectSelectedZoneAuthority(selected, other).status, 'UNAVAILABLE');
});

test('NULL membership, selected Worker grant and relevant assignment do not borrow a Contractor anchor', () => {
  for (const kind of [Kind.WORKER_MEMBERSHIP, Kind.WORKER_ZONE_GRANT, Kind.ASSIGNMENT]) {
    const selected = fixture().map((f) =>
      f.sourceKind === kind
        ? ({ ...f, payload: { ...f.payload, contractorId: null } } as AuthorityHistoryRow)
        : f,
    );
    assert.deepEqual(projectSelectedZoneAuthority(selected, scope), {
      status: 'UNAVAILABLE',
      reason: 'LEGACY_CONTRACTOR_ANCHOR',
    });
  }
});

test('unrelated Worker legacy facts cannot contaminate the selected subject', () => {
  const selected = fixture();
  const extra = selected.find((f) => f.sourceKind === Kind.WORKER_ZONE_GRANT)!;
  const workerId = randomUUID(),
    grantId = randomUUID();
  selected.unshift(
    row(Kind.WORKER_ZONE_GRANT, grantId, {
      ...extra.payload,
      grantId,
      workerId,
      contractorId: null,
    }),
  );
  const result = projectSelectedZoneAuthority(selected, scope);
  assert.equal(result.status, 'PROJECTED');
  if (result.status === 'PROJECTED') assert.equal(result.projection.workerGrants.length, 1);
});
