import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  SiteEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../src/database/entities/index.js';
import { executeZoneAuthorityCommand } from '../../src/modules/zones/zone-authority-history.js';
import {
  contractorFact,
  participationFact,
  workerMembershipFact,
  assignmentFact,
} from '../../src/modules/workforce/workforce-authority-history.js';
import { readWorkforceZoneAuthorityHistory } from '../../src/modules/workforce/workforce-zone-authority-history.query.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

async function fixture() {
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic history Site' });
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'TEST_WORKFORCE_HISTORY',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: { workerId },
    },
    async (manager) => {
      const contractor = await manager.getRepository(ContractorEntity).save({
        id: contractorId,
        code: contractorId,
        name: 'Synthetic Contractor',
        isActive: true,
      });
      const participation = await manager.getRepository(ContractorSiteParticipationEntity).save({
        id: randomUUID(),
        siteId,
        contractorId,
        isActive: false,
        validFrom: new Date('2026-10-01T00:00:00Z'),
        validUntil: null,
      });
      const worker = await manager.getRepository(WorkerEntity).save({
        id: workerId,
        siteId,
        contractorId,
        externalId: workerId,
        displayName: 'Synthetic Worker',
        isActive: true,
      });
      const at = new Date('2026-10-02T00:00:00Z');
      return [
        contractorFact(contractor, at),
        participationFact(participation, at),
        workerMembershipFact(worker, at),
      ];
    },
  );
  return { siteId, workerId, contractorId };
}

test('owner read includes global Contractor and inactive participation rather than filtering negative facts', async () => {
  const scope = await fixture();
  const evidence = await db.transaction('SERIALIZABLE', (manager) =>
    readWorkforceZoneAuthorityHistory(manager, scope),
  );
  assert.equal(evidence.facts.length, 3);
  assert.equal(evidence.sources.length, 3);
  assert.equal(evidence.facts.find((fact) => fact.sourceKind === 'CONTRACTOR_STATE')?.siteId, null);
  assert.equal(
    evidence.facts.find((fact) => fact.sourceKind === 'PARTICIPATION')?.payload.isActive,
    false,
  );
  assert.equal('status' in evidence, false, 'evidence does not claim COMPLETE');
  assert.ok(evidence.facts.every((fact) => fact.revision === '1'));
});

test('membership revisions remain readable after the Worker moves to another Site and is disabled', async () => {
  const scope = await fixture();
  const nextSiteId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: nextSiteId, code: nextSiteId, name: 'Synthetic other Site' });
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'TEST_MEMBERSHIP_MOVE',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: scope,
    },
    async (manager) => {
      await manager
        .getRepository(WorkerEntity)
        .update({ id: scope.workerId }, { siteId: nextSiteId, isActive: false });
      const row = await manager.getRepository(WorkerEntity).findOneByOrFail({ id: scope.workerId });
      return [workerMembershipFact(row, new Date('2026-10-03T00:00:00Z'))];
    },
  );
  const evidence = await db.transaction('SERIALIZABLE', (manager) =>
    readWorkforceZoneAuthorityHistory(manager, scope),
  );
  const memberships = evidence.facts.filter((row) => row.sourceKind === 'WORKER_MEMBERSHIP');
  assert.deepEqual(
    memberships.map((row) => row.siteId),
    [scope.siteId, nextSiteId],
  );
  assert.equal(memberships[1]?.payload.isActive, false);
  assert.equal(
    evidence.sources.find((row) => row.sourceKind === 'WORKER_MEMBERSHIP')?.siteId,
    nextSiteId,
  );
});

test('legacy NULL membership and unjournaled current sources stay visible for the assembler to reject', async () => {
  const scope = await fixture();
  await db.getRepository(WorkerEntity).update({ id: scope.workerId }, { contractorId: null });
  const result = await db.transaction('SERIALIZABLE', (manager) =>
    readWorkforceZoneAuthorityHistory(manager, scope),
  );
  assert.equal(
    result.sources.find((row) => row.sourceKind === 'WORKER_MEMBERSHIP')?.payload.contractorId,
    null,
  );
  assert.equal(
    result.facts.find((row) => row.sourceKind === 'WORKER_MEMBERSHIP')?.payload.contractorId,
    scope.contractorId,
  );
});

test('owner read cannot see an uncommitted source and retains the same transaction view after peer commit', async () => {
  const scope = await fixture();
  const writer = db.createQueryRunner();
  await writer.connect();
  await writer.startTransaction();
  const participationId = randomUUID();
  await writer.manager.getRepository(ContractorSiteParticipationEntity).insert({
    id: participationId,
    ...{ siteId: scope.siteId, contractorId: scope.contractorId },
    validFrom: new Date('2026-10-01T00:00:00Z'),
    validUntil: null,
    isActive: true,
  });
  try {
    await db.transaction('SERIALIZABLE', async (manager) => {
      const first = await readWorkforceZoneAuthorityHistory(manager, scope);
      assert.equal(
        first.sources.some((row) => row.sourceId === participationId),
        false,
      );
      await writer.commitTransaction();
      const second = await readWorkforceZoneAuthorityHistory(manager, scope);
      assert.deepEqual(second, first);
    });
    const fresh = await db.transaction('SERIALIZABLE', (manager) =>
      readWorkforceZoneAuthorityHistory(manager, scope),
    );
    assert.equal(
      fresh.sources.some((row) => row.sourceId === participationId),
      true,
    );
    assert.equal(
      fresh.facts.some((row) => row.sourceId === participationId),
      false,
      'missing audit is not hidden',
    );
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
  }
});

test('wrong Contractor/Site excludes their participation, without hiding Worker membership history', async () => {
  const scope = await fixture();
  const evidence = await db.transaction('SERIALIZABLE', (manager) =>
    readWorkforceZoneAuthorityHistory(manager, { ...scope, contractorId: randomUUID() }),
  );
  assert.equal(
    evidence.facts.some((row) => row.sourceKind === 'PARTICIPATION'),
    false,
  );
  assert.equal(
    evidence.facts.some((row) => row.sourceKind === 'CONTRACTOR_STATE'),
    false,
  );
  assert.equal(evidence.facts.filter((row) => row.sourceKind === 'WORKER_MEMBERSHIP').length, 1);
});

test('pending legacy NULL assignment stays in both source inventory and immutable evidence', async () => {
  const scope = await fixture();
  const userId = randomUUID();
  const { UserEntity } = await import('../../src/database/entities/index.js');
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic',
    passwordHash: 'not-runtime',
    isActive: true,
    mustChangePassword: false,
  });
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'TEST_LEGACY_ALLOCATION',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: scope,
    },
    async (manager) => {
      const row = await manager.getRepository(WorkerSiteZoneAssignmentEntity).save({
        id: randomUUID(),
        siteId: scope.siteId,
        workerId: scope.workerId,
        contractorId: null,
        zoneIds: [randomUUID()],
        status: WorkerSiteZoneAssignmentStatus.PENDING,
        validFrom: new Date('2026-10-01T00:00:00Z'),
        validUntil: null,
        requestedByUserId: userId,
      });
      return [assignmentFact(row, new Date('2026-10-02T00:00:00Z'))];
    },
  );
  const evidence = await db.transaction('SERIALIZABLE', (manager) =>
    readWorkforceZoneAuthorityHistory(manager, scope),
  );
  assert.equal(
    evidence.sources.find((row) => row.sourceKind === 'ASSIGNMENT')?.payload.contractorId,
    null,
  );
  assert.equal(
    evidence.facts.find((row) => row.sourceKind === 'ASSIGNMENT')?.payload.status,
    'PENDING',
  );
});
