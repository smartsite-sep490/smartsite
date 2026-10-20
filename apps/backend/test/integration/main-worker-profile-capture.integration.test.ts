import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedWorkerProfileSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

async function fixture() {
  const actorId = randomUUID(),
    siteId = randomUUID(),
    contractorId = randomUUID(),
    workerId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic representative','not-a-password',true,false)",
    [actorId],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [contractorId],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
    [randomUUID(), actorId, siteId],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), actorId, contractorId],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,is_active,valid_from,valid_until) VALUES($1,$2,$3,true,clock_timestamp()-interval '1 day',NULL)",
    [randomUUID(), contractorId, siteId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name,is_active) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker',true)",
    [workerId, siteId, contractorId],
  );
  const accounts = new ContractorWorkerAccountsService(
    db,
    new ContractorOperationsService(db),
    new UsersService(db, new SiteConfigurationService(db)),
  );
  const actor = {
    id: actorId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
  const update = () =>
    accounts.update(
      actor,
      siteId,
      contractorId,
      workerId,
      {
        externalId: workerId,
        displayName: 'Synthetic Worker',
        isActive: false,
        expectedSnapshot: { externalId: workerId, displayName: 'Synthetic Worker', isActive: true },
      },
      { actorUserId: actorId, reauthorize: async () => {} },
    );
  const state = async () =>
    (
      await db.query(
        'SELECT w.is_active,s.access_policy_version FROM worker w JOIN site s ON s.id=w.site_id WHERE w.id=$1',
        [workerId],
      )
    )[0] as { is_active: boolean; access_policy_version: number };
  return { actorId, siteId, workerId, update, state };
}

for (const table of ['worker', 'site'] as const) {
  test(`Worker profile update refuses missing ${table} capture before changing Worker or Site`, async () => {
    const f = await fixture();
    const before = await f.state();
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER trg_mf06_capture_${table}`);
    try {
      await assert.rejects(
        f.update(),
        (error: { getStatus?: () => number }) => error.getStatus?.() === 503,
      );
      assert.deepEqual(await f.state(), before);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
            [f.actorId],
          )
        )[0].n,
        0,
      );
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER trg_mf06_capture_${table}`);
    }
  });
}

test('Worker profile update records both Worker and Site revisions when their capture is healthy', async () => {
  const f = await fixture();
  const before = await f.state();
  const result = await f.update();
  assert.equal(result.isActive, false);
  const after = await f.state();
  assert.equal(after.is_active, false);
  assert.equal(after.access_policy_version, before.access_policy_version + 1);
  const facts = await db.query(
    "SELECT r.source_kind FROM authorization_history_revision r JOIN authorization_history_command c USING(command_id) WHERE c.actor_user_id=$1 AND c.operation='WORKER_PROFILE_UPDATE' ORDER BY r.source_kind",
    [f.actorId],
  );
  assert.deepEqual(
    facts.map((row: { source_kind: string }) => row.source_kind),
    ['SITE', 'WORKER'],
  );
});
