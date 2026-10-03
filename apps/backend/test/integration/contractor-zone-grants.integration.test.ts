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
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
} from '../../src/database/entities/index.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { ContractorZoneAccessManagementService } from '../../src/modules/zones/contractor-zone-access-management.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase();
const db = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());
const badRequest = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 400;
const notFound = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 404;
const forbidden = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 403;

async function fixture() {
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    contractorId = randomUUID(),
    userId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic grant Site' });
  await db
    .getRepository(ContractorEntity)
    .insert({ id: contractorId, code: contractorId, name: 'Synthetic Contractor', isActive: true });
  await db.getRepository(ContractorSiteParticipationEntity).insert({
    id: randomUUID(),
    siteId,
    contractorId,
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
  await db.getRepository(UserEntity).insert({
    id: userId,
    username: userId,
    displayName: 'Synthetic Admin',
    passwordHash: 'not-a-runtime-hash',
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  const actor = { kind: 'USER' as const, userId };
  const input = {
    contractorId,
    effect: ZoneAccessEffect.ALLOW,
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: '2026-11-01T00:00:00Z',
  };
  return {
    siteId,
    zoneId,
    contractorId,
    userId,
    actor,
    input,
    service: new ContractorZoneAccessManagementService(db),
  };
}

test('Contractor grant journals scoped ceiling and USER attribution without granting Workers or activating history', async () => {
  for (const effect of [ZoneAccessEffect.ALLOW, ZoneAccessEffect.DENY]) {
    const f = await fixture();
    const grant = await f.service.createGrant(f.siteId, f.zoneId, { ...f.input, effect }, f.actor);
    assert.equal(grant.siteId, f.siteId);
    assert.equal(grant.zoneId, f.zoneId);
    assert.equal(grant.contractorId, f.contractorId);
    assert.equal(grant.effect, effect);
    assert.equal(grant.revokedAt, null);
    const rows = await db.query(
      `SELECT f.revision,f.payload,c.actor_kind,c.actor_user_id FROM zone_authority_fact_revision f JOIN zone_authority_command c ON c.command_id=f.command_id WHERE f.source_id=$1`,
      [grant.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revision, '1');
    assert.equal(rows[0].payload.contractorId, f.contractorId);
    assert.equal(rows[0].payload.effect, effect);
    assert.equal(rows[0].actor_kind, 'USER');
    assert.equal(rows[0].actor_user_id, f.userId);
    assert.equal(await db.getRepository(ZoneAccessGrantEntity).countBy({ siteId: f.siteId }), 0);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
      0,
    );
  }
});

test('Contractor grant refuses wrong Site/Zone and missing scoped participation atomically', async () => {
  const f = await fixture(),
    other = await fixture();
  const commands = (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n;
  await assert.rejects(f.service.createGrant(other.siteId, f.zoneId, f.input, f.actor), notFound);
  await assert.rejects(f.service.createGrant(f.siteId, other.zoneId, f.input, f.actor), notFound);
  await assert.rejects(
    f.service.createGrant(
      f.siteId,
      f.zoneId,
      { ...f.input, contractorId: other.contractorId },
      f.actor,
    ),
    forbidden,
  );
  assert.equal(
    await db
      .getRepository(ContractorZoneAccessGrantEntity)
      .countBy({ contractorId: f.contractorId }),
    0,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n,
    commands,
  );
});

test('inactive Contractor or expired/disabled participation cannot receive a new Zone ceiling', async () => {
  for (const variant of ['contractor', 'disabled', 'expired', 'future'] as const) {
    const f = await fixture();
    if (variant === 'contractor')
      await db.getRepository(ContractorEntity).update({ id: f.contractorId }, { isActive: false });
    else
      await db
        .getRepository(ContractorSiteParticipationEntity)
        .update(
          { contractorId: f.contractorId, siteId: f.siteId },
          variant === 'disabled'
            ? { isActive: false }
            : variant === 'expired'
              ? { validUntil: new Date('2020-01-02T00:00:00Z') }
              : { validFrom: new Date('2099-01-01T00:00:00Z') },
        );
    await assert.rejects(f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor), forbidden);
    assert.equal(
      await db
        .getRepository(ContractorZoneAccessGrantEntity)
        .countBy({ contractorId: f.contractorId }),
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
  }
});

test('Contractor grant rejects malformed, unknown-field and non-increasing intervals before writing', async () => {
  const f = await fixture();
  for (const input of [
    { ...f.input, workerId: randomUUID() },
    { ...f.input, effect: 'OTHER' },
    { ...f.input, validFrom: '2026-10-01T00:00:00' },
    { ...f.input, validUntil: f.input.validFrom },
    { ...f.input, validUntil: '2026-09-01T00:00:00Z' },
    { ...f.input, validFrom: 'Infinity' },
  ])
    await assert.rejects(
      f.service.createGrant(f.siteId, f.zoneId, input as typeof f.input, f.actor),
      badRequest,
    );
  assert.equal(
    await db
      .getRepository(ContractorZoneAccessGrantEntity)
      .countBy({ contractorId: f.contractorId }),
    0,
  );
});

test('Contractor grant requires current global Admin and permits revocation after Contractor participation ends', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor);
  await db.getRepository(UserRoleAssignmentEntity).delete({ userId: f.userId });
  await assert.rejects(f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor), forbidden);
  await assert.rejects(f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor), forbidden);
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId: f.userId, role: UserRole.ADMIN, siteId: null });
  await db
    .getRepository(ContractorSiteParticipationEntity)
    .update({ siteId: f.siteId, contractorId: f.contractorId }, { isActive: false });
  await db.getRepository(ContractorEntity).update({ id: f.contractorId }, { isActive: false });
  const revoked = await f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor);
  assert.ok(revoked.revokedAt);
  const fact = (
    await db.query(
      'SELECT payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision DESC LIMIT 1',
      [grant.id],
    )
  )[0];
  assert.equal(fact.payload.revokedAt, revoked.revokedAt.toISOString());
});

test('Contractor revoke is scoped and concurrent commands retain the first persisted DB timestamp', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor);
  await assert.rejects(f.service.revokeGrant(randomUUID(), f.zoneId, grant.id, f.actor), notFound);
  await assert.rejects(f.service.revokeGrant(f.siteId, randomUUID(), grant.id, f.actor), notFound);
  const blocker = db.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  await blocker.query('SELECT id FROM contractor_zone_access_grant WHERE id=$1 FOR UPDATE', [
    grant.id,
  ]);
  const pending = Promise.allSettled([
    f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor),
    f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor),
  ]);
  let values: ContractorZoneAccessGrantEntity[];
  try {
    const scope: { schema: string }[] = await db.query('SELECT current_schema() AS schema');
    const deadline = Date.now() + 5000;
    let waiting = 0;
    do {
      const rows: { n: number }[] = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event_type='Lock'
         AND query LIKE $1 AND query LIKE '%contractor_zone_access_grant%'`,
        [`%${scope[0]!.schema}%`],
      );
      waiting = rows[0]!.n;
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    } while (waiting < 2 && Date.now() < deadline);
    assert.equal(waiting, 2, 'Both commands must reach the actual locked Contractor grant');
    await blocker.commitTransaction();
    values = (await pending).map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
    await pending;
  }
  const stored = await db
    .getRepository(ContractorZoneAccessGrantEntity)
    .findOneByOrFail({ id: grant.id });
  assert.ok(stored.revokedAt);
  assert.ok(values.every((row) => row.revokedAt?.getTime() === stored.revokedAt!.getTime()));
  const repeated = await f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor);
  assert.equal(repeated.revokedAt?.getTime(), stored.revokedAt.getTime());
  const facts = await db.query(
    'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
    [grant.id],
  );
  assert.deepEqual(
    facts.map((row: { revision: string }) => row.revision),
    ['1', '2', '3', '4'],
  );
  assert.ok(
    facts
      .slice(1)
      .every(
        (row: { payload: { revokedAt: string } }) =>
          row.payload.revokedAt === stored.revokedAt!.toISOString(),
      ),
  );
});

test('failed Contractor grant audit rolls back create and revoke projections plus commands', async () => {
  const f = await fixture();
  const grant = await f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor);
  const commands = (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n;
  await db.query(
    `CREATE FUNCTION fail_contractor_grant_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='CONTRACTOR_ZONE_GRANT' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.query(
    'CREATE TRIGGER test_fail_contractor_grant_fact BEFORE INSERT ON zone_authority_fact_revision FOR EACH ROW EXECUTE FUNCTION fail_contractor_grant_fact()',
  );
  try {
    await assert.rejects(
      f.service.createGrant(f.siteId, f.zoneId, f.input, f.actor),
      /synthetic audit failure/,
    );
    await assert.rejects(
      f.service.revokeGrant(f.siteId, f.zoneId, grant.id, f.actor),
      /synthetic audit failure/,
    );
    assert.equal(
      await db
        .getRepository(ContractorZoneAccessGrantEntity)
        .countBy({ contractorId: f.contractorId }),
      1,
    );
    assert.equal(
      (await db.getRepository(ContractorZoneAccessGrantEntity).findOneByOrFail({ id: grant.id }))
        .revokedAt,
      null,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n,
      commands,
    );
  } finally {
    await db.query('DROP TRIGGER test_fail_contractor_grant_fact ON zone_authority_fact_revision');
    await db.query('DROP FUNCTION fail_contractor_grant_fact()');
  }
});
