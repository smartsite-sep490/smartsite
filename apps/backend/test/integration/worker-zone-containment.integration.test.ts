import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorZoneAccessGrantEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
} from '../../src/database/entities/index.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ZoneAccessManagementService,
  type CreateZoneAccessGrantCommand,
} from '../../src/modules/zones/zone-access-management.service.js';
import { ContractorZoneAccessManagementService } from '../../src/modules/zones/contractor-zone-access-management.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase();
const db = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());
const from = '2026-10-10T08:00:00.000Z',
  until = '2026-10-10T17:00:00.000Z';
const rejected = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 409;

async function fixture(ceiling = true, assignmentAnchor: 'CURRENT' | 'LEGACY_NULL' = 'CURRENT') {
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID(),
    userId = randomUUID(),
    assignmentId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic containment Site' });
  await db
    .getRepository(ContractorEntity)
    .insert({ id: contractorId, code: contractorId, name: 'Synthetic Contractor', isActive: true });
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic Admin',
    passwordHash: 'synthetic-not-runtime',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  await db.getRepository(ContractorSiteParticipationEntity).insert({
    id: randomUUID(),
    contractorId,
    siteId,
    isActive: true,
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validUntil: null,
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  await db.getRepository(WorkerEntity).insert({
    id: workerId,
    siteId,
    contractorId,
    externalId: workerId,
    displayName: 'Synthetic Worker',
    isActive: true,
  });
  await db.getRepository(WorkerSiteZoneAssignmentEntity).insert({
    id: assignmentId,
    siteId,
    contractorId: assignmentAnchor === 'LEGACY_NULL' ? null : contractorId,
    workerId,
    zoneIds: [zoneId],
    status: WorkerSiteZoneAssignmentStatus.APPROVED,
    validFrom: new Date(from),
    validUntil: new Date(until),
    requestedByUserId: userId,
  });
  const actor = { kind: 'USER' as const, userId };
  const input = { workerId, effect: ZoneAccessEffect.ALLOW, validFrom: from, validUntil: until };
  const service = new ZoneAccessManagementService(db),
    contractor = new ContractorZoneAccessManagementService(db);
  const grant = ceiling
    ? await contractor.createGrant(
        siteId,
        zoneId,
        { contractorId, effect: ZoneAccessEffect.ALLOW, validFrom: from, validUntil: until },
        actor,
      )
    : null;
  return {
    siteId,
    zoneId,
    contractorId,
    workerId,
    userId,
    assignmentId,
    actor,
    input,
    service,
    contractor,
    grant,
  };
}

async function assertRejectedWithoutWrites(
  f: Awaited<ReturnType<typeof fixture>>,
  input: CreateZoneAccessGrantCommand = f.input,
) {
  const count = (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n;
  await assert.rejects(f.service.createGrant(f.siteId, f.zoneId, input, f.actor), rejected);
  assert.equal(await db.getRepository(ZoneAccessGrantEntity).countBy({ workerId: f.workerId }), 0);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n,
    count,
  );
}

test('Worker ALLOW is created and journaled only with the scoped Contractor ceiling, participation and approved allocation', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor);
  assert.equal(grant.contractorId, f.contractorId);
  assert.equal(grant.effect, ZoneAccessEffect.ALLOW);
  const facts = await db.query(
    'SELECT payload FROM zone_authority_fact_revision WHERE source_id=$1',
    [grant.id],
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].payload.contractorId, f.contractorId);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
    0,
  );
});

test('Worker ALLOW cannot be issued with absent or shorter Contractor Zone authority', async () => {
  await assertRejectedWithoutWrites(await fixture(false));
  const f = await fixture();
  await db
    .getRepository(ContractorZoneAccessGrantEntity)
    .update({ id: f.grant!.id }, { validUntil: new Date('2026-10-10T16:59:59.999Z') });
  await assertRejectedWithoutWrites(f);
});

test('entire Worker grant interval must fit active participation and APPROVED anchored assignment', async () => {
  for (const variant of [
    'participation-end',
    'participation-disabled',
    'assignment-end',
    'assignment-pending',
    'assignment-reviewed',
    'assignment-rejected',
    'assignment-cancelled',
    'assignment-null',
    'assignment-wrong-zone',
  ] as const) {
    const f = await fixture(true, variant === 'assignment-null' ? 'LEGACY_NULL' : 'CURRENT');
    if (variant === 'participation-end')
      await db
        .getRepository(ContractorSiteParticipationEntity)
        .update(
          { siteId: f.siteId, contractorId: f.contractorId },
          { validUntil: new Date('2026-10-10T12:00:00Z') },
        );
    else if (variant === 'participation-disabled')
      await db
        .getRepository(ContractorSiteParticipationEntity)
        .update({ siteId: f.siteId, contractorId: f.contractorId }, { isActive: false });
    else if (variant !== 'assignment-null') {
      const patch =
        variant === 'assignment-end'
          ? { validUntil: new Date('2026-10-10T12:00:00Z') }
          : variant === 'assignment-wrong-zone'
            ? { zoneIds: [randomUUID()] }
            : {
                status:
                  variant === 'assignment-pending'
                    ? WorkerSiteZoneAssignmentStatus.PENDING
                    : variant === 'assignment-reviewed'
                      ? WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED
                      : variant === 'assignment-rejected'
                        ? WorkerSiteZoneAssignmentStatus.REJECTED
                        : WorkerSiteZoneAssignmentStatus.CANCELLED,
              };
      await db.getRepository(WorkerSiteZoneAssignmentEntity).update({ id: f.assignmentId }, patch);
    }
    await assertRejectedWithoutWrites(f);
  }
});

test('adjacent Contractor intervals cover but a1ms gap or finite coverage for infinity does not', async () => {
  for (const gap of [0, 1]) {
    const f = await fixture();
    const join = new Date('2026-10-10T12:00:00Z');
    await db
      .getRepository(ContractorZoneAccessGrantEntity)
      .update({ id: f.grant!.id }, { validUntil: join });
    await f.contractor.createGrant(
      f.siteId,
      f.zoneId,
      {
        contractorId: f.contractorId,
        effect: ZoneAccessEffect.ALLOW,
        validFrom: new Date(join.getTime() + gap).toISOString(),
        validUntil: until,
      },
      f.actor,
    );
    if (gap) await assertRejectedWithoutWrites(f);
    else
      assert.equal(
        (await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor)).effect,
        ZoneAccessEffect.ALLOW,
      );
  }
  const f = await fixture();
  await assertRejectedWithoutWrites(f, { ...f.input, validUntil: null });
});

test('overlapping Contractor DENY and early ALLOW revocation block issuance; exact end non-overlap does not', async () => {
  for (const overlapping of [true, false]) {
    const f = await fixture();
    await f.contractor.createGrant(
      f.siteId,
      f.zoneId,
      {
        contractorId: f.contractorId,
        effect: ZoneAccessEffect.DENY,
        validFrom: overlapping ? '2026-10-10T12:00:00Z' : until,
        validUntil: '2026-10-10T18:00:00Z',
      },
      f.actor,
    );
    if (overlapping) await assertRejectedWithoutWrites(f);
    else
      assert.equal(
        (await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor)).effect,
        ZoneAccessEffect.ALLOW,
      );
  }
  const f = await fixture();
  await f.contractor.revokeGrant(f.siteId, f.zoneId, f.grant!.id, f.actor);
  await assertRejectedWithoutWrites(f);
});

test('NULL/inactive ownership cannot issue Worker ALLOW while explicit DENY remains available', async () => {
  for (const variant of ['null', 'contractor-inactive'] as const) {
    const f = await fixture();
    if (variant === 'null')
      await db.getRepository(WorkerEntity).update({ id: f.workerId }, { contractorId: null });
    else
      await db.getRepository(ContractorEntity).update({ id: f.contractorId }, { isActive: false });
    await assertRejectedWithoutWrites(f);
    const grant = await f.service.createGrant(
      f.siteId,
      f.zoneId,
      { ...f.input, effect: ZoneAccessEffect.DENY },
      f.actor,
    );
    assert.equal(grant.effect, ZoneAccessEffect.DENY);
    assert.equal(grant.contractorId, variant === 'null' ? null : f.contractorId);
  }
});

test('moving Worker to another Contractor cannot reuse the old Contractor allocation even when the new ceiling exists', async () => {
  const f = await fixture();
  const newContractorId = randomUUID();
  await db.getRepository(ContractorEntity).insert({
    id: newContractorId,
    code: newContractorId,
    name: 'Synthetic new Contractor',
    isActive: true,
  });
  await db.getRepository(ContractorSiteParticipationEntity).insert({
    id: randomUUID(),
    siteId: f.siteId,
    contractorId: newContractorId,
    isActive: true,
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validUntil: null,
  });
  await db
    .getRepository(WorkerEntity)
    .update({ id: f.workerId }, { contractorId: newContractorId });
  await f.contractor.createGrant(
    f.siteId,
    f.zoneId,
    {
      contractorId: newContractorId,
      effect: ZoneAccessEffect.ALLOW,
      validFrom: from,
      validUntil: until,
    },
    f.actor,
  );
  await assertRejectedWithoutWrites(f);
});

test('a locked concurrent Contractor revocation is re-read after serialization retry before Worker grant commits', async () => {
  const f = await fixture();
  const blocker = db.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  // Synthetic peer transaction changes the current projection. This does not
  // certify writer coverage or historical completeness of privileged DB edits.
  await blocker.query('UPDATE contractor_zone_access_grant SET revoked_at=$2 WHERE id=$1', [
    f.grant!.id,
    '2026-10-10T12:00:00Z',
  ]);
  const pending = Promise.allSettled([f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor)]);
  try {
    const scope: { schema: string }[] = await db.query('SELECT current_schema() AS schema');
    const deadline = Date.now() + 5000;
    let waiting = 0;
    do {
      const rows: { n: number }[] = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 AND query LIKE '%contractor_zone_access_grant%'`,
        [`%${scope[0]!.schema}%`],
      );
      waiting = rows[0]!.n;
      if (waiting < 1) await new Promise((resolve) => setTimeout(resolve, 20));
    } while (waiting < 1 && Date.now() < deadline);
    assert.equal(
      waiting,
      1,
      'Worker command must lock/read actual Contractor grants in its transaction',
    );
    await blocker.commitTransaction();
    const result = (await pending)[0]!;
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.ok(rejected(result.reason));
    assert.equal(
      await db.getRepository(ZoneAccessGrantEntity).countBy({ workerId: f.workerId }),
      0,
    );
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
    await pending;
  }
});
