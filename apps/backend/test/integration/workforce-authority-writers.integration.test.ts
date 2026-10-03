import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
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
  ZoneAccessGrantEntity,
} from '../../src/database/entities/index.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../../src/modules/workforce/contractor-operations.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());
const forbidden = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 403;
const from = new Date('2026-10-01T00:00:00Z'),
  until = new Date('2026-11-01T00:00:00Z');

async function fixture() {
  const siteId = randomUUID(),
    userId = randomUUID(),
    zoneId = randomUUID();
  await db.getRepository(SiteEntity).insert({ id: siteId, code: siteId, name: 'Synthetic Site' });
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic',
    passwordHash: 'synthetic-not-a-login',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const actor: WorkforceActor = {
    id: userId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  return { siteId, zoneId, userId, actor, service: new ContractorOperationsService(db) };
}

async function membership() {
  const base = await fixture();
  const contractorId = randomUUID(),
    workerId = randomUUID();
  await db
    .getRepository(ContractorEntity)
    .insert({ id: contractorId, code: contractorId, name: 'Synthetic', isActive: true });
  await db.getRepository(ContractorSiteParticipationEntity).insert({
    id: randomUUID(),
    contractorId,
    siteId: base.siteId,
    validFrom: from,
    validUntil: until,
    isActive: true,
  });
  await db.getRepository(WorkerEntity).insert({
    id: workerId,
    contractorId,
    siteId: base.siteId,
    externalId: workerId,
    displayName: 'Synthetic',
    isActive: true,
  });
  return { ...base, contractorId, workerId };
}

test('Contractor, participation, Worker and assignment lifecycle journal six matching commands without granting Zone access', async () => {
  const f = await fixture();
  const contractor = await f.service.createContractor(f.actor, {
    code: `C_${randomUUID().replaceAll('-', '').toUpperCase()}`,
    name: 'Synthetic',
  });
  const participation = await f.service.createParticipation(f.actor, contractor.id, {
    siteId: f.siteId,
    validFrom: from.toISOString(),
    validUntil: until.toISOString(),
  });
  const worker = await f.service.createWorker(f.actor, contractor.id, {
    siteId: f.siteId,
    externalId: randomUUID(),
    displayName: 'Synthetic',
  });
  const assignment = await f.service.requestAssignment(f.actor, worker.id, {
    siteId: f.siteId,
    zoneIds: [f.zoneId],
    validFrom: from.toISOString(),
    validUntil: until.toISOString(),
  });
  assert.equal(assignment.contractorId, contractor.id);
  await f.service.safetyReview(f.actor, assignment.id);
  await f.service.siteManagerDecision(f.actor, assignment.id, { approve: true });
  const facts = await db.query(
    'SELECT source_kind,source_id,revision,payload,command_id FROM zone_authority_fact_revision WHERE source_id=ANY($1::uuid[]) ORDER BY source_kind,revision',
    [[contractor.id, participation.id, worker.id, assignment.id]],
  );
  assert.equal(facts.length, 6);
  const allocation = facts.filter((r: { source_kind: string }) => r.source_kind === 'ASSIGNMENT');
  assert.deepEqual(
    allocation.map((r: { revision: string }) => r.revision),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    allocation.map((r: { payload: { status: string } }) => r.payload.status),
    ['PENDING', 'SAFETY_REVIEWED', 'APPROVED'],
  );
  assert.ok(
    allocation.every(
      (r: { payload: { contractorId: string } }) => r.payload.contractorId === contractor.id,
    ),
  );
  const commands = await db.query(
    'SELECT actor_kind,actor_user_id FROM zone_authority_command WHERE command_id=ANY($1::uuid[])',
    [facts.map((r: { command_id: string }) => r.command_id)],
  );
  assert.equal(commands.length, 6);
  assert.ok(
    commands.every(
      (c: { actor_kind: string; actor_user_id: string }) =>
        c.actor_kind === 'USER' && c.actor_user_id === f.userId,
    ),
  );
  assert.equal(await db.getRepository(ZoneAccessGrantEntity).countBy({ workerId: worker.id }), 0);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
    0,
  );
});

test('positive reviews reject changed Contractor membership without rewriting the submission anchor', async () => {
  const f = await membership();
  const replacement = randomUUID();
  await db
    .getRepository(ContractorEntity)
    .insert({ id: replacement, code: replacement, name: 'Synthetic replacement', isActive: true });
  await db.getRepository(ContractorSiteParticipationEntity).insert({
    id: randomUUID(),
    contractorId: replacement,
    siteId: f.siteId,
    validFrom: from,
    validUntil: until,
    isActive: true,
  });
  for (const stage of ['SAFETY', 'MANAGER'] as const) {
    const assignmentId = randomUUID();
    const status =
      stage === 'SAFETY'
        ? WorkerSiteZoneAssignmentStatus.PENDING
        : WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED;
    await db.getRepository(WorkerSiteZoneAssignmentEntity).insert({
      id: assignmentId,
      workerId: f.workerId,
      contractorId: f.contractorId,
      siteId: f.siteId,
      zoneIds: [f.zoneId],
      status,
      validFrom: from,
      validUntil: until,
      requestedByUserId: f.userId,
    });
    await db.getRepository(WorkerEntity).update(f.workerId, { contractorId: replacement });
    await assert.rejects(
      stage === 'SAFETY'
        ? f.service.safetyReview(f.actor, assignmentId)
        : f.service.siteManagerDecision(f.actor, assignmentId, { approve: true }),
      forbidden,
    );
    const retained = await db
      .getRepository(WorkerSiteZoneAssignmentEntity)
      .findOneByOrFail({ id: assignmentId });
    assert.equal(retained.status, status);
    assert.equal(retained.contractorId, f.contractorId);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM zone_authority_fact_revision WHERE source_id=$1',
          [assignmentId],
        )
      )[0].n,
      0,
    );
  }
});

test('stale actor roles cannot authorize a new Contractor command after the database role is revoked', async () => {
  const f = await fixture();
  await db.getRepository(UserRoleAssignmentEntity).delete({ userId: f.userId });
  const code = `C_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  await assert.rejects(f.service.createContractor(f.actor, { code, name: 'Synthetic' }), forbidden);
  assert.equal(await db.getRepository(ContractorEntity).countBy({ code }), 0);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM zone_authority_command WHERE actor_user_id=$1',
        [f.userId],
      )
    )[0].n,
    0,
  );
});

test('journal failure rolls back the new assignment and its command', async () => {
  const f = await membership();
  await db.query(`CREATE FUNCTION fail_synthetic_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_kind='ASSIGNMENT' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.query(
    'CREATE TRIGGER fail_synthetic_assignment_audit BEFORE INSERT ON zone_authority_fact_revision FOR EACH ROW EXECUTE FUNCTION fail_synthetic_assignment_audit()',
  );
  try {
    await assert.rejects(
      f.service.requestAssignment(f.actor, f.workerId, {
        siteId: f.siteId,
        zoneIds: [f.zoneId],
        validFrom: from.toISOString(),
        validUntil: until.toISOString(),
      }),
    );
    assert.equal(
      await db.getRepository(WorkerSiteZoneAssignmentEntity).countBy({ workerId: f.workerId }),
      0,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM zone_authority_command WHERE actor_user_id=$1',
          [f.userId],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query('DROP TRIGGER fail_synthetic_assignment_audit ON zone_authority_fact_revision');
    await db.query('DROP FUNCTION fail_synthetic_assignment_audit()');
  }
});

test('concurrent Safety review permits one transition and only one new audit revision', async () => {
  const f = await membership();
  const assignment = await f.service.requestAssignment(f.actor, f.workerId, {
    siteId: f.siteId,
    zoneIds: [f.zoneId],
    validFrom: from.toISOString(),
    validUntil: until.toISOString(),
  });
  const attempts = await Promise.allSettled([
    f.service.safetyReview(f.actor, assignment.id),
    f.service.safetyReview(f.actor, assignment.id),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  const facts = await db.query(
    'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [assignment.id],
  );
  assert.deepEqual(
    facts.map((r: { revision: string }) => r.revision),
    ['1', '2'],
  );
  assert.equal(facts[1].payload.status, 'SAFETY_REVIEWED');
});

test('Site configuration journals global Contractor reuse and Site participation without inferring Zone grants', async () => {
  const first = await fixture(),
    second = await fixture();
  const service = new WorkforceConfigurationService(db);
  const input = { code: randomUUID(), name: 'Synthetic shared Contractor' };
  const created = await service.createContractor(first.siteId, input);
  const reused = await service.createContractor(second.siteId, input);
  assert.equal(reused.id, created.id);
  const facts = await db.query(
    'SELECT source_kind,site_id,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [created.id],
  );
  assert.equal(facts.length, 2);
  assert.ok(
    facts.every(
      (row: { source_kind: string; site_id: string | null }) =>
        row.source_kind === 'CONTRACTOR_STATE' && row.site_id === null,
    ),
  );
  const participation = await db
    .getRepository(ContractorSiteParticipationEntity)
    .findBy({ contractorId: created.id });
  assert.equal(participation.length, 2);
  const scoped = await db.query(
    'SELECT site_id FROM zone_authority_fact_revision WHERE source_id=ANY($1::uuid[])',
    [participation.map((row) => row.id)],
  );
  assert.deepEqual(
    scoped.map((row: { site_id: string }) => row.site_id).sort(),
    [first.siteId, second.siteId].sort(),
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM contractor_zone_access_grant WHERE contractor_id=$1',
        [created.id],
      )
    )[0].n,
    0,
  );
});

test('Worker configuration and account linking journal NULL membership without claiming identified Worker or Zone permission', async () => {
  const f = await fixture();
  const service = new WorkforceConfigurationService(db);
  const worker = await service.create(f.siteId, {
    externalId: randomUUID(),
    displayName: 'Synthetic unassigned',
  });
  await service.linkAccount(f.siteId, worker.id, { userId: f.userId });
  const prepared = await service.forAccount(f.siteId, { userId: f.userId });
  assert.equal(prepared.id, worker.id);
  const facts = await db.query(
    'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [worker.id],
  );
  assert.deepEqual(
    facts.map((row: { revision: string }) => row.revision),
    ['1', '2', '3'],
  );
  assert.ok(
    facts.every(
      (row: { payload: { contractorId: string | null } }) => row.payload.contractorId === null,
    ),
  );
  assert.ok(facts.every((row: { payload: Record<string, unknown> }) => !('userId' in row.payload)));
  assert.equal(await db.getRepository(ZoneAccessGrantEntity).countBy({ workerId: worker.id }), 0);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
    0,
  );
});

test('account-first Worker creation journals its real nullable membership and preserves record idempotency', async () => {
  const f = await fixture();
  const service = new WorkforceConfigurationService(db);
  const first = await service.forAccount(f.siteId, { userId: f.userId });
  const second = await service.forAccount(f.siteId, { userId: f.userId });
  assert.equal(second.id, first.id);
  assert.equal(
    await db.getRepository(WorkerEntity).countBy({ siteId: f.siteId, userId: f.userId }),
    1,
  );
  const facts = await db.query(
    'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [first.id],
  );
  assert.deepEqual(
    facts.map((row: { revision: string }) => row.revision),
    ['1', '2'],
  );
  assert.equal(facts[0].payload.contractorId, null);
});

test('configuration Worker projection rolls back when membership history cannot be written', async () => {
  const f = await fixture();
  const service = new WorkforceConfigurationService(db);
  await db.query(`CREATE FUNCTION fail_synthetic_membership_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_kind='WORKER_MEMBERSHIP' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.query(
    'CREATE TRIGGER fail_synthetic_membership_audit BEFORE INSERT ON zone_authority_fact_revision FOR EACH ROW EXECUTE FUNCTION fail_synthetic_membership_audit()',
  );
  try {
    const externalId = randomUUID();
    await assert.rejects(service.create(f.siteId, { externalId, displayName: 'Synthetic' }));
    assert.equal(await db.getRepository(WorkerEntity).countBy({ siteId: f.siteId, externalId }), 0);
  } finally {
    await db.query('DROP TRIGGER fail_synthetic_membership_audit ON zone_authority_fact_revision');
    await db.query('DROP FUNCTION fail_synthetic_membership_audit()');
  }
});

test('all four Site configuration writers attribute commands to the authenticated USER and recheck Admin revocation', async () => {
  const f = await fixture();
  const service = new WorkforceConfigurationService(db);
  const actor = { kind: 'USER' as const, userId: f.userId };
  await service.createContractor(f.siteId, { code: randomUUID(), name: 'Synthetic' }, actor);
  const worker = await service.create(
    f.siteId,
    { externalId: randomUUID(), displayName: 'Synthetic' },
    actor,
  );
  await service.linkAccount(f.siteId, worker.id, { userId: f.userId }, actor);
  await service.forAccount(f.siteId, { userId: f.userId }, actor);
  const commands = await db.query(
    'SELECT actor_kind,actor_user_id FROM zone_authority_command WHERE actor_user_id=$1',
    [f.userId],
  );
  assert.equal(commands.length, 4);
  assert.ok(
    commands.every(
      (row: { actor_kind: string; actor_user_id: string }) =>
        row.actor_kind === 'USER' && row.actor_user_id === f.userId,
    ),
  );
  await db.getRepository(UserRoleAssignmentEntity).delete({ userId: f.userId });
  await assert.rejects(
    service.createContractor(f.siteId, { code: randomUUID(), name: 'Synthetic' }, actor),
    forbidden,
  );
  await assert.rejects(
    service.create(f.siteId, { externalId: randomUUID(), displayName: 'Synthetic' }, actor),
    forbidden,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM zone_authority_command WHERE actor_user_id=$1',
        [f.userId],
      )
    )[0].n,
    4,
  );
});

test('bound Worker creation rechecks active Site participation in the same audited transaction', async () => {
  const f = await membership();
  const userId = randomUUID();
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic Worker account',
    passwordHash: 'synthetic-not-a-login',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.WORKER, siteId: f.siteId });
  const service = new WorkforceConfigurationService(db);
  const created = await service.create(f.siteId, {
    externalId: randomUUID(),
    displayName: 'Synthetic',
    contractorId: f.contractorId,
    userId,
  });
  const facts = await db.query(
    'SELECT payload FROM zone_authority_fact_revision WHERE source_id=$1',
    [created.id],
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].payload.contractorId, f.contractorId);
  await db
    .getRepository(ContractorSiteParticipationEntity)
    .update({ contractorId: f.contractorId, siteId: f.siteId }, { isActive: false });
  const externalId = randomUUID();
  await assert.rejects(
    service.create(f.siteId, {
      externalId,
      displayName: 'Synthetic',
      contractorId: f.contractorId,
      userId,
    }),
  );
  assert.equal(await db.getRepository(WorkerEntity).countBy({ siteId: f.siteId, externalId }), 0);
});
