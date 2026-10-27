import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedBaselineTeamSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

for (const table of ['contractor_team', 'contractor_team_membership', 'team_zone_permission']) {
  test(`Baseline refuses disabled ${table} capture before creating any epoch or command`, async () => {
    const actor = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic baseline Admin','not-a-password',false)",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
      [randomUUID(), actor],
    );
    const before = (
      await db.query(
        'SELECT (SELECT count(*)::int FROM authorization_history_epoch) AS epochs,(SELECT count(*)::int FROM authorization_history_baseline) AS baselines,(SELECT count(*)::int FROM authorization_history_command) AS commands',
      )
    )[0];
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER trg_mf06_capture_${table}`);
    try {
      await assert.rejects(
        new MainAuthorityBaselineService(db).capture(
          { actorUserId: actor, reauthorize: async () => {} },
          'b'.repeat(64),
        ),
        (error: { getStatus?: () => number }) => error.getStatus?.() === 503,
      );
      assert.deepEqual(
        (
          await db.query(
            'SELECT (SELECT count(*)::int FROM authorization_history_epoch) AS epochs,(SELECT count(*)::int FROM authorization_history_baseline) AS baselines,(SELECT count(*)::int FROM authorization_history_command) AS commands',
          )
        )[0],
        before,
      );
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER trg_mf06_capture_${table}`);
    }
  });
}

test('Healthy baseline includes all eighteen V2 source kinds and remains STAGING', async () => {
  const actor = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic baseline Admin','not-a-password',false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  const baseline = await new MainAuthorityBaselineService(db).capture(
    { actorUserId: actor, reauthorize: async () => {} },
    'b'.repeat(64),
  );
  assert.equal(baseline.state, 'STAGING');
  const sources = baseline.snapshot.sources as { sourceKind: string }[];
  assert.equal(sources.length, 18);
  for (const kind of ['TEAM', 'TEAM_MEMBERSHIP', 'TEAM_PERMISSION'])
    assert(sources.some((source) => source.sourceKind === kind));
});
