import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(async () => {
  await database.initialize();
});
after(async () => {
  await database.dispose();
});

async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin','SYNTHETIC_NOT_A_PASSWORD',true,false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  return { actor, site, zone };
}

async function journalCounts() {
  return (
    await db.query(`SELECT
    (SELECT count(*)::int FROM mf06_authority_command) AS commands,
    (SELECT count(*)::int FROM mf06_authority_fact) AS facts,
    (SELECT count(*)::int FROM mf06_authority_gap) AS gaps,
    (SELECT count(*)::int FROM mf06_authority_commit_witness) AS witnesses`)
  )[0];
}

const invalidMasks = [
  [
    'missing permission field',
    'ZONE_POLICY',
    'zone',
    ['id', 'site_id', 'required_ppe', 'configuration_locked'],
  ],
  ['empty projection', 'ZONE_POLICY', 'zone', []],
  [
    'unknown projection field',
    'ZONE_POLICY',
    'zone',
    [
      'id',
      'site_id',
      'restriction_policy',
      'required_ppe',
      'configuration_locked',
      'not_a_real_field',
    ],
  ],
  [
    'reordered canonical fields',
    'ZONE_POLICY',
    'zone',
    ['site_id', 'id', 'restriction_policy', 'required_ppe', 'configuration_locked'],
  ],
  [
    'credential projection',
    'USER_ACCOUNT',
    'app_user',
    ['id', 'is_active', 'must_change_password', 'created_at', 'password_hash'],
  ],
  [
    'unapproved account projection',
    'USER_ACCOUNT',
    'app_user',
    ['id', 'is_active', 'must_change_password', 'created_at', 'username'],
  ],
] as const;

for (const [label, kind, table, fields] of invalidMasks) {
  test(`rejects ${label} before authenticated or actorless writes and journal changes`, async () => {
    const f = await fixture();
    const [original] = await db.query(
      'SELECT fields FROM mf06_authority_source WHERE source_kind=$1',
      [kind],
    );
    // Simulate an already-damaged catalog only in this test-owned schema. The
    // canonical source trigger remains installed/enabled throughout the calls.
    await db.query(
      'ALTER TABLE mf06_authority_source DISABLE TRIGGER trg_mf06_authority_source_immutable',
    );
    await db.query('UPDATE mf06_authority_source SET fields=$1 WHERE source_kind=$2', [
      [...fields],
      kind,
    ]);
    await db.query(
      'ALTER TABLE mf06_authority_source ENABLE TRIGGER trg_mf06_authority_source_immutable',
    );
    try {
      const beforeCounts = await journalCounts();
      let callbacks = 0;
      const outcomes = [];
      for (const attributed of [true, false]) {
        outcomes.push(
          await executeMainConfigurationCommand(
            db,
            attributed ? { actorUserId: f.actor, reauthorize: async () => {} } : undefined,
            table === 'zone' ? 'ZONE_POLICY_UPDATE' : 'USER_ACCOUNT_STATUS',
            table === 'zone' ? { zoneId: f.zone } : { userId: f.actor },
            async (manager) => {
              callbacks++;
              if (table === 'zone')
                await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [
                  f.zone,
                ]);
              else
                await manager.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
            },
          ).then(
            () => 'accepted',
            (error: { getStatus?: () => number }) => error.getStatus?.() ?? 'non-public-error',
          ),
        );
      }
      assert.deepEqual(outcomes, [503, 503]);
      assert.equal(callbacks, 0);
      assert.deepEqual(await journalCounts(), beforeCounts);
      assert.equal(
        (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [f.zone]))[0]
          .restriction_policy,
        'AUTHORIZATION_REQUIRED',
      );
      assert.equal(
        (await db.query('SELECT is_active FROM app_user WHERE id=$1', [f.actor]))[0].is_active,
        true,
      );
    } finally {
      await db.query(
        'ALTER TABLE mf06_authority_source DISABLE TRIGGER trg_mf06_authority_source_immutable',
      );
      await db.query('UPDATE mf06_authority_source SET fields=$1 WHERE source_kind=$2', [
        original.fields,
        kind,
      ]);
      await db.query(
        'ALTER TABLE mf06_authority_source ENABLE TRIGGER trg_mf06_authority_source_immutable',
      );
    }
  });
}

test('canonical all-source and selected-source masks accept a real typed permission change', async () => {
  const f = await fixture();
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
  assert.equal(await hasMainAuthorityCapture(db.manager, ['zone']), true);
  const beforeCounts = await journalCounts();
  await executeMainConfigurationCommand(
    db,
    { actorUserId: f.actor, reauthorize: async () => {} },
    'ZONE_POLICY_UPDATE',
    { zoneId: f.zone },
    async (manager) => {
      await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
    },
  );
  const counts = await journalCounts();
  assert.equal(counts.commands, beforeCounts.commands + 1);
  assert.equal(counts.facts, beforeCounts.facts + 1);
  assert.equal(counts.gaps, beforeCounts.gaps);
  assert.equal(counts.witnesses, beforeCounts.witnesses + 1);
});

test('empty, duplicate or unknown selected source tables are unavailable', async () => {
  for (const tables of [[], ['zone', 'zone'], ['zone', 'not_a_source']])
    assert.equal(await hasMainAuthorityCapture(db.manager, tables), false);
});
