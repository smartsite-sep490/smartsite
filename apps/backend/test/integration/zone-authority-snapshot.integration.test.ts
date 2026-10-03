import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { after, before, test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorZoneAccessGrantEntity,
  SiteEntity,
  UserEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  ZoneAccessGrantEntity,
  ZoneAccessEffect,
  ZoneAuthorityHistoryEpochEntity,
  ZoneAuthoritySourceKind,
} from '../../src/database/entities/index.js';
import { executeZoneAuthorityCommand } from '../../src/modules/zones/zone-authority-history.js';
import {
  contractorFact,
  participationFact,
  workerMembershipFact,
  assignmentFact,
} from '../../src/modules/workforce/workforce-authority-history.js';
import { ZoneAuthoritySnapshotService } from '../../src/modules/zones/zone-authority-snapshot.service.js';
import { evaluateZoneAuthority } from '../../src/modules/zones/zone-authority-chain.policy.js';
import { withZoneAuthorityTransaction } from '../../src/modules/zones/zone-authority-transaction.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase(),
  db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());
const manifest = 'b'.repeat(64);
const sourceAt = new Date('2026-10-01T00:00:00Z'),
  epochAt = new Date('2026-10-02T00:00:00Z'),
  capturedAt = new Date('2026-10-03T12:00:00Z');
const reader = new ZoneAuthoritySnapshotService({ writerManifestHash: manifest });

async function fixture() {
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID(),
    userId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic audit Site' });
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic',
    passwordHash: 'not-runtime',
    isActive: true,
    mustChangePassword: false,
  });
  const assignmentId = randomUUID(),
    workerGrantId = randomUUID(),
    contractorGrantId = randomUUID();
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'SYNTHETIC_CUTOVER_FIXTURE',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: { siteId },
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
        contractorId,
        siteId,
        isActive: true,
        validFrom: sourceAt,
        validUntil: null,
      });
      const worker = await manager.getRepository(WorkerEntity).save({
        id: workerId,
        contractorId,
        siteId,
        externalId: workerId,
        displayName: 'Synthetic',
        isActive: true,
      });
      const zone = await manager.getRepository(ZoneEntity).save({
        id: zoneId,
        siteId,
        code: zoneId,
        name: 'Synthetic Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      });
      const assignment = await manager.getRepository(WorkerSiteZoneAssignmentEntity).save({
        id: assignmentId,
        workerId,
        contractorId,
        siteId,
        zoneIds: [zoneId],
        status: WorkerSiteZoneAssignmentStatus.APPROVED,
        validFrom: sourceAt,
        validUntil: null,
        requestedByUserId: userId,
      });
      const common = {
        siteId,
        zoneId,
        contractorId,
        effect: ZoneAccessEffect.ALLOW,
        validFrom: sourceAt,
        validUntil: null,
        revokedAt: null,
      };
      await manager
        .getRepository(ContractorZoneAccessGrantEntity)
        .insert({ id: contractorGrantId, ...common });
      await manager
        .getRepository(ZoneAccessGrantEntity)
        .insert({ id: workerGrantId, workerId, ...common });
      const grantPayload = {
        siteId,
        zoneId,
        contractorId,
        effect: ZoneAccessEffect.ALLOW,
        validFrom: sourceAt.toISOString(),
        validUntil: null,
        revokedAt: null,
      };
      return [
        contractorFact(contractor, sourceAt),
        participationFact(participation, sourceAt),
        workerMembershipFact(worker, sourceAt),
        assignmentFact(assignment, sourceAt),
        {
          sourceKind: ZoneAuthoritySourceKind.ZONE_POLICY,
          sourceId: zone.id,
          siteId,
          effectiveFrom: sourceAt,
          effectiveTo: null,
          payload: { zoneId, siteId, restrictionPolicy: zone.restrictionPolicy },
        },
        {
          sourceKind: ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT,
          sourceId: contractorGrantId,
          siteId,
          effectiveFrom: sourceAt,
          effectiveTo: null,
          payload: { ...grantPayload, grantId: contractorGrantId },
        },
        {
          sourceKind: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
          sourceId: workerGrantId,
          siteId,
          effectiveFrom: sourceAt,
          effectiveTo: null,
          payload: { ...grantPayload, grantId: workerGrantId, workerId },
        },
      ];
    },
  );
  // Explicit audited synthetic baseline, not a production READY/cutover operation.
  await db
    .getRepository(ZoneAuthorityHistoryEpochEntity)
    .insert({ siteId, startedAt: epochAt, readiness: 'READY', writerManifestHash: manifest });
  return {
    siteId,
    zoneId,
    workerId,
    contractorId,
    assignmentId,
    workerGrantId,
    contractorGrantId,
    capturedAt,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
  };
}
async function read(f: Awaited<ReturnType<typeof fixture>>, service = reader) {
  const { siteId, zoneId, workerId, capturedAt, purpose } = f;
  return db.transaction('SERIALIZABLE', (manager) =>
    service.read(manager, { siteId, zoneId, workerId, capturedAt, purpose }),
  );
}

test('a validated audited synthetic two-tier history yields a bounded digest-bound internal snapshot', async () => {
  const f = await fixture(),
    result = await read(f);
  assert.equal(result.status, 'COMPLETE');
  if (result.status === 'COMPLETE') {
    assert.equal(
      evaluateZoneAuthority(result.snapshot, result.restrictionPolicy, f.capturedAt, f).status,
      'ALLOWED',
    );
    assert.equal(
      result.artifact.snapshotVersion,
      computeCanonicalPayloadHash(result.artifact.payload),
    );
    assert.equal(result.snapshot.snapshotVersion, result.artifact.snapshotVersion);
    assert.equal(result.artifact.payload.purpose, f.purpose);
  }
});

test('OFF, wrong manifest, pre-cutover and default unconfigured reader cannot certify COMPLETE', async () => {
  const f = await fixture();
  assert.equal((await read(f, new ZoneAuthoritySnapshotService())).status, 'UNAVAILABLE');
  assert.equal(
    (await read(f, new ZoneAuthoritySnapshotService({ writerManifestHash: 'c'.repeat(64) })))
      .status,
    'UNAVAILABLE',
  );
  assert.equal((await read({ ...f, capturedAt: sourceAt })).status, 'UNAVAILABLE');
  await db
    .getRepository(ZoneAuthorityHistoryEpochEntity)
    .update({ siteId: f.siteId }, { readiness: 'OFF' });
  assert.equal((await read(f)).status, 'UNAVAILABLE');
});

test('direct unjournaled projection edit is unavailable rather than a complete deny/allow', async () => {
  const f = await fixture();
  await db.getRepository(ContractorEntity).update({ id: f.contractorId }, { isActive: false });
  assert.equal((await read(f)).status, 'UNAVAILABLE');
});

test('global Contractor disable with genuine revision is complete negative evidence', async () => {
  const f = await fixture();
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'SYNTHETIC_GLOBAL_DISABLE',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: { contractorId: f.contractorId },
    },
    async (manager) => {
      await manager
        .getRepository(ContractorEntity)
        .update({ id: f.contractorId }, { isActive: false });
      return [
        contractorFact(
          await manager.getRepository(ContractorEntity).findOneByOrFail({ id: f.contractorId }),
          new Date('2026-10-03T00:00:00Z'),
        ),
      ];
    },
  );
  const result = await read(f);
  assert.equal(result.status, 'COMPLETE');
  if (result.status === 'COMPLETE')
    assert.equal(
      evaluateZoneAuthority(result.snapshot, result.restrictionPolicy, f.capturedAt, f).status,
      'DENIED',
    );
});

test('legacy replay has no stored artifact; reader refuses current state as a replacement', async () => {
  const f = await fixture();
  const result = await db.transaction('SERIALIZABLE', (manager) =>
    reader.read(manager, {
      siteId: f.siteId,
      zoneId: f.zoneId,
      workerId: f.workerId,
      capturedAt,
      purpose: 'REPLAY_RECORDED_ASSESSMENT',
    }),
  );
  assert.deepEqual(result, { status: 'UNAVAILABLE', reason: 'RECORDED_SNAPSHOT_REQUIRED' });
});

test('reader rejects a non-snapshot transaction and wrong Site without changing original decisions', async () => {
  const f = await fixture();
  const input = {
    siteId: f.siteId,
    zoneId: f.zoneId,
    workerId: f.workerId,
    capturedAt,
    purpose: f.purpose,
  };
  assert.equal((await reader.read(db.manager, input)).status, 'UNAVAILABLE');
  const committed = await db.transaction('READ COMMITTED', (manager) =>
    reader.read(manager, input),
  );
  assert.equal(committed.status, 'UNAVAILABLE');
  assert.equal((await read({ ...f, siteId: randomUUID() })).status, 'UNAVAILABLE');
});

async function insertSyntheticDeny(manager: EntityManager, f: Awaited<ReturnType<typeof fixture>>) {
  const commandId = randomUUID(),
    grantId = randomUUID();
  const payload = {
    grantId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    contractorId: f.contractorId,
    effect: ZoneAccessEffect.DENY,
    validFrom: sourceAt.toISOString(),
    validUntil: null,
    revokedAt: null,
  };
  await manager.query(
    "INSERT INTO zone_authority_command(command_id, operation, actor_kind, service_subject, request_hash) VALUES ($1,'SYNTHETIC_VISIBILITY','SERVICE','SYNTHETIC_HISTORY_TEST',$2)",
    [commandId, 'd'.repeat(64)],
  );
  await manager.getRepository(ContractorZoneAccessGrantEntity).insert({
    id: grantId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    contractorId: f.contractorId,
    effect: ZoneAccessEffect.DENY,
    validFrom: sourceAt,
    validUntil: null,
    revokedAt: null,
  });
  await manager.query(
    "INSERT INTO zone_authority_fact_revision(id,command_id,source_kind,source_id,site_id,revision,effective_from,payload) VALUES ($1,$2,'CONTRACTOR_ZONE_GRANT',$3,$4,1,$5,$6::jsonb)",
    [randomUUID(), commandId, grantId, f.siteId, sourceAt, JSON.stringify(payload)],
  );
  return grantId;
}

test('late commit recorded before reader is excluded from its old view and artifact; new view sees DENY', async () => {
  const f = await fixture(),
    peer = db.createQueryRunner();
  await peer.connect();
  await peer.startTransaction();
  const denyId = await insertSyntheticDeny(peer.manager, f);
  let firstReadAt: unknown;
  try {
    await db.transaction('SERIALIZABLE', async (manager) => {
      const first = await reader.read(manager, {
        siteId: f.siteId,
        zoneId: f.zoneId,
        workerId: f.workerId,
        capturedAt,
        purpose: f.purpose,
      });
      assert.equal(first.status, 'COMPLETE');
      if (first.status === 'COMPLETE') firstReadAt = first.artifact.payload.readAt;
      await peer.commitTransaction();
      const second = await reader.read(manager, {
        siteId: f.siteId,
        zoneId: f.zoneId,
        workerId: f.workerId,
        capturedAt,
        purpose: f.purpose,
      });
      assert.equal(second.status, 'COMPLETE');
      if (first.status === 'COMPLETE' && second.status === 'COMPLETE') {
        assert.equal(first.snapshot.contractorGrants.length, 1);
        assert.deepEqual(first.artifact.payload.evidence, second.artifact.payload.evidence);
        assert.equal(
          first.artifact.snapshotVersion,
          computeCanonicalPayloadHash(first.artifact.payload),
        );
        assert.equal(
          evaluateZoneAuthority(first.snapshot, first.restrictionPolicy, capturedAt, f).status,
          'ALLOWED',
        );
      }
    });
    const fresh = await read(f);
    assert.equal(fresh.status, 'COMPLETE');
    if (fresh.status === 'COMPLETE') {
      assert.equal(fresh.snapshot.contractorGrants.length, 2);
      assert.equal(
        evaluateZoneAuthority(fresh.snapshot, fresh.restrictionPolicy, capturedAt, f).reasonCode,
        'EXPLICIT_DENY',
      );
      const stamps: { before: boolean }[] = await db.query(
        'SELECT recorded_at <= $2::timestamptz AS before FROM zone_authority_fact_revision WHERE source_id=$1',
        [denyId, firstReadAt],
      );
      assert.equal(stamps[0]?.before, true);
    }
  } finally {
    if (peer.isTransactionActive) await peer.rollbackTransaction();
    await peer.release();
  }
});

test('audited Worker ALLOW revocation is complete negative history, while an unaudited grant is unavailable', async () => {
  const f = await fixture();
  const revokedAt = new Date('2026-10-03T00:00:00Z');
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'SYNTHETIC_WORKER_REVOKE',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: { grantId: f.workerGrantId },
    },
    async (manager) => {
      await manager
        .getRepository(ZoneAccessGrantEntity)
        .update({ id: f.workerGrantId }, { revokedAt });
      return [
        {
          sourceKind: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
          sourceId: f.workerGrantId,
          siteId: f.siteId,
          effectiveFrom: revokedAt,
          effectiveTo: null,
          payload: {
            grantId: f.workerGrantId,
            siteId: f.siteId,
            zoneId: f.zoneId,
            contractorId: f.contractorId,
            workerId: f.workerId,
            effect: ZoneAccessEffect.ALLOW,
            validFrom: sourceAt.toISOString(),
            validUntil: null,
            revokedAt: revokedAt.toISOString(),
          },
        },
      ];
    },
  );
  const before = await read({ ...f, capturedAt: new Date('2026-10-02T12:00:00Z') });
  const after = await read(f);
  assert.equal(before.status, 'COMPLETE');
  assert.equal(after.status, 'COMPLETE');
  if (before.status === 'COMPLETE' && after.status === 'COMPLETE') {
    assert.equal(
      evaluateZoneAuthority(
        before.snapshot,
        before.restrictionPolicy,
        new Date('2026-10-02T12:00:00Z'),
        f,
      ).status,
      'ALLOWED',
    );
    assert.equal(
      evaluateZoneAuthority(after.snapshot, after.restrictionPolicy, capturedAt, f).status,
      'DENIED',
    );
  }
  // Source exists with no journal entry: never interpret it as an absent permission.
  await db.getRepository(ZoneAccessGrantEntity).insert({
    id: randomUUID(),
    siteId: f.siteId,
    zoneId: f.zoneId,
    workerId: f.workerId,
    contractorId: f.contractorId,
    effect: ZoneAccessEffect.ALLOW,
    validFrom: sourceAt,
    validUntil: null,
    revokedAt: null,
  });
  assert.deepEqual(await read(f), { status: 'UNAVAILABLE', reason: 'INCOMPLETE_HISTORY' });
});

test('an audited legacy Worker grant cannot borrow the current Contractor anchor', async () => {
  const f = await fixture();
  await executeZoneAuthorityCommand(
    db,
    {
      commandId: randomUUID(),
      operation: 'SYNTHETIC_LEGACY_GRANT',
      actor: { kind: 'SERVICE', subject: 'SYNTHETIC_HISTORY_TEST' },
      request: { siteId: f.siteId },
    },
    async (manager) => {
      const grantId = randomUUID();
      await manager.getRepository(ZoneAccessGrantEntity).insert({
        id: grantId,
        siteId: f.siteId,
        zoneId: f.zoneId,
        workerId: f.workerId,
        contractorId: null,
        effect: ZoneAccessEffect.DENY,
        validFrom: sourceAt,
        validUntil: null,
        revokedAt: null,
      });
      return [
        {
          sourceKind: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
          sourceId: grantId,
          siteId: f.siteId,
          effectiveFrom: sourceAt,
          effectiveTo: null,
          payload: {
            grantId,
            siteId: f.siteId,
            zoneId: f.zoneId,
            workerId: f.workerId,
            contractorId: null,
            effect: ZoneAccessEffect.DENY,
            validFrom: sourceAt.toISOString(),
            validUntil: null,
            revokedAt: null,
          },
        },
      ];
    },
  );
  assert.deepEqual(await read(f), { status: 'UNAVAILABLE', reason: 'LEGACY_CONTRACTOR_ANCHOR' });
});

test('transaction retry re-reads history instead of returning an artifact from an aborted attempt', async () => {
  const f = await fixture();
  let attempts = 0;
  const result = await withZoneAuthorityTransaction(db, async (manager) => {
    attempts++;
    const candidate = await reader.read(manager, {
      siteId: f.siteId,
      zoneId: f.zoneId,
      workerId: f.workerId,
      capturedAt,
      purpose: f.purpose,
    });
    assert.equal(candidate.status, 'COMPLETE');
    if (attempts === 1) {
      await db.transaction((peer) => insertSyntheticDeny(peer, f));
      // Inject real PostgreSQL SQLSTATE40001 after the first read; no native SSI claim.
      await manager.query(
        "DO $$ BEGIN RAISE EXCEPTION 'synthetic serialization retry' USING ERRCODE='40001'; END $$",
      );
    }
    return candidate;
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, 'COMPLETE');
  if (result.status === 'COMPLETE')
    assert.equal(
      evaluateZoneAuthority(result.snapshot, result.restrictionPolicy, capturedAt, f).status,
      'DENIED',
    );
});

test('missing source table propagates PostgreSQL error rather than converting failed reads into empty COMPLETE', async () => {
  const f = await fixture();
  await assert.rejects(
    db.transaction('SERIALIZABLE', async (manager) => {
      // File-owned isolated schema; rollback restores the table after the failed read.
      await manager.query('ALTER TABLE worker RENAME TO synthetic_worker_unavailable');
      return reader.read(manager, {
        siteId: f.siteId,
        zoneId: f.zoneId,
        workerId: f.workerId,
        capturedAt,
        purpose: f.purpose,
      });
    }),
    (error: unknown) =>
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === '42P01',
  );
  assert.equal((await read(f)).status, 'COMPLETE');
});
