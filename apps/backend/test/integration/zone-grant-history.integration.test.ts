import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  ContractorEntity,
  SiteEntity,
  WorkerEntity,
  ZoneEntity,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../../src/database/entities/index.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';

const database = createIsolatedTestDatabase();
const db = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());
const from = '2026-10-01T00:00:00.000Z',
  until = '2026-11-01T00:00:00.000Z';

async function fixture(contractorId: string | null = randomUUID()) {
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    workerId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic Zone history Site' });
  if (contractorId)
    await db.getRepository(ContractorEntity).insert({
      id: contractorId,
      code: contractorId,
      name: 'Synthetic Contractor',
      isActive: true,
    });
  await db.getRepository(WorkerEntity).insert({
    id: workerId,
    siteId,
    contractorId,
    externalId: workerId,
    displayName: 'Synthetic Worker',
    isActive: true,
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const service = new ZoneAccessManagementService(db);
  const input = { workerId, effect: ZoneAccessEffect.DENY, validFrom: from, validUntil: until };
  return { siteId, zoneId, workerId, contractorId, input, service };
}

test('Worker grant journals actual Contractor anchor while unassigned membership remains NULL', async () => {
  for (const contractorId of [randomUUID(), null]) {
    const f = await fixture(contractorId);
    const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input);
    assert.equal(grant.contractorId, contractorId);
    const facts = await db.query(
      'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1',
      [grant.id],
    );
    assert.equal(facts.length, 1);
    assert.equal(facts[0].revision, '1');
    assert.equal(facts[0].payload.contractorId, contractorId);
    assert.equal(facts[0].payload.effect, 'DENY');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
      0,
    );
  }
});

test('concurrent Worker grant revocations return the same first-persisted timestamp and journal that timestamp', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input);
  const proposals = [new Date('2026-10-03T08:00:00Z'), new Date('2026-10-03T09:00:00Z')];
  const results = await Promise.all(
    proposals.map((at) => f.service.revokeGrant(f.siteId, f.zoneId, grant.id, at)),
  );
  const persisted = await db.getRepository(ZoneAccessGrantEntity).findOneByOrFail({ id: grant.id });
  assert.ok(persisted.revokedAt);
  assert.ok(results.every((row) => row.revokedAt?.getTime() === persisted.revokedAt!.getTime()));
  const facts = await db.query(
    'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [grant.id],
  );
  assert.deepEqual(
    facts.map((row: { revision: string }) => row.revision),
    ['1', '2', '3'],
  );
  assert.ok(
    facts
      .slice(1)
      .every(
        (row: { payload: { revokedAt: string } }) =>
          row.payload.revokedAt === persisted.revokedAt!.toISOString(),
      ),
  );
});

test('a revocation audit failure rolls back the grant change and command', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input);
  const before = (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n;
  await db.query(`CREATE FUNCTION fail_synthetic_grant_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_kind='WORKER_ZONE_GRANT' AND NEW.payload->>'revokedAt' IS NOT NULL THEN RAISE EXCEPTION 'Synthetic revoke audit failure'; END IF;
    RETURN NEW; END $$`);
  await db.query(
    'CREATE TRIGGER fail_synthetic_grant_revoke BEFORE INSERT ON zone_authority_fact_revision FOR EACH ROW EXECUTE FUNCTION fail_synthetic_grant_revoke()',
  );
  try {
    await assert.rejects(
      f.service.revokeGrant(f.siteId, f.zoneId, grant.id, new Date('2026-10-03T08:00:00Z')),
    );
    assert.equal(
      (await db.getRepository(ZoneAccessGrantEntity).findOneByOrFail({ id: grant.id })).revokedAt,
      null,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n,
      before,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM zone_authority_fact_revision WHERE source_id=$1',
          [grant.id],
        )
      )[0].n,
      1,
    );
  } finally {
    await db.query('DROP TRIGGER fail_synthetic_grant_revoke ON zone_authority_fact_revision');
    await db.query('DROP FUNCTION fail_synthetic_grant_revoke()');
  }
});

test('revoking an old NULL grant does not attach the Worker current Contractor to historical ownership', async () => {
  const f = await fixture();
  const id = randomUUID();
  await db.getRepository(ZoneAccessGrantEntity).insert({
    id,
    siteId: f.siteId,
    zoneId: f.zoneId,
    workerId: f.workerId,
    contractorId: null,
    effect: ZoneAccessEffect.DENY,
    validFrom: new Date(from),
    validUntil: new Date(until),
    revokedAt: null,
  });
  const revoked = await f.service.revokeGrant(
    f.siteId,
    f.zoneId,
    id,
    new Date('2026-10-03T08:00:00Z'),
  );
  assert.equal(revoked.contractorId, null);
  const facts = await db.query(
    'SELECT payload FROM zone_authority_fact_revision WHERE source_id=$1',
    [id],
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].payload.contractorId, null);
});

test('USER grant commands recheck active Admin role and preserve actor attribution', async () => {
  const f = await fixture();
  const userId = randomUUID();
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic Admin',
    passwordHash: 'synthetic-not-a-login',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  const actor = { kind: 'USER' as const, userId };
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input, actor);
  await db.getRepository(UserRoleAssignmentEntity).delete({ userId });
  const denied = (error: unknown) =>
    error instanceof PublicHttpException && error.getStatus() === 403;
  await assert.rejects(
    f.service.revokeGrant(f.siteId, f.zoneId, grant.id, undefined, actor),
    denied,
  );
  await assert.rejects(f.service.createGrant(f.siteId, f.zoneId, f.input, actor), denied);
  assert.equal(
    (await db.getRepository(ZoneAccessGrantEntity).findOneByOrFail({ id: grant.id })).revokedAt,
    null,
  );
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  const revoked = await f.service.revokeGrant(f.siteId, f.zoneId, grant.id, undefined, actor);
  assert.ok(revoked.revokedAt);
  const commands = await db.query(
    'SELECT actor_kind,actor_user_id FROM zone_authority_command WHERE actor_user_id=$1',
    [userId],
  );
  assert.equal(commands.length, 2);
  assert.ok(
    commands.every(
      (row: { actor_kind: string; actor_user_id: string }) =>
        row.actor_kind === 'USER' && row.actor_user_id === userId,
    ),
  );
  const facts = await db.query(
    'SELECT payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [grant.id],
  );
  assert.equal(facts[1].payload.revokedAt, revoked.revokedAt.toISOString());
});

test('wrong Site or Zone cannot leave a grant command or modify audit history', async () => {
  const f = await fixture();
  const other = await fixture();
  const before = (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n;
  const notFound = (error: unknown) =>
    error instanceof PublicHttpException && error.getStatus() === 404;
  await assert.rejects(f.service.createGrant(other.siteId, f.zoneId, f.input), notFound);
  await assert.rejects(f.service.createGrant(f.siteId, other.zoneId, f.input), notFound);
  assert.equal(await db.getRepository(ZoneAccessGrantEntity).countBy({ workerId: f.workerId }), 0);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n,
    before,
  );
});
