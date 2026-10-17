import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { refuseLegacyMainWriter } from '../../src/common/configuration/legacy-workforce-writer.js';
import { requireLegacyAuthoritySchema } from '../../src/modules/zones/legacy-authority-schema.js';
import { seedPreNamingStorage } from '../support/pre-naming-storage-fixture.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { MainZoneDenyCommandService } from '../../src/modules/zones/main-zone-deny-command.service.js';

const names = {
  mf06_assessment_request: 'zone_entry_assessment_request',
  mf06_assessment_job: 'zone_entry_assessment_job',
  mf06_assessment: 'zone_entry_assessment',
  mf06_authority_artifact: 'zone_entry_authority_artifact',
  mf06_authority_source: 'authorization_history_source',
  mf06_authority_command: 'authorization_history_command',
  mf06_authority_fact: 'authorization_history_revision',
  mf06_authority_commit_witness: 'authorization_history_commit_receipt',
  mf06_authority_gap: 'authorization_history_gap',
  mf06_authority_head: 'authorization_history_head',
  mf06_authority_epoch: 'authorization_history_epoch',
  mf06_authority_control: 'authorization_history_control',
  mf06_authority_baseline: 'authorization_history_baseline',
  mf06_assignment_command_result: 'worker_assignment_command_receipt',
  mf06_participation_command_result: 'contractor_participation_command_receipt',
  mf06_zone_permission_command_result: 'zone_permission_command_receipt',
  mf06_zone_deny_command_result: 'zone_access_denial_command_receipt',
};
const migration = 'ZoneEntryPhysicalStorage1792454400000';
async function fixture(populated = false) {
  const owned = createIsolatedTestDatabase({ canonical: true });
  const db = owned.dataSource,
    release = db.options.migrations;
  assert(Array.isArray(release));
  db.setOptions({
    migrations: release.filter((m) => typeof m !== 'function' || m.name !== migration),
  });
  try {
    await owned.initialize();
    const site = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic preservation Site')",
      [site],
    );
    const records = populated ? await seedPreNamingStorage(db, site) : null;
    const before = await snapshot(db, false);
    await db.destroy();
    db.setOptions({ migrations: release });
    await db.initialize();
    return { owned, db, before, records };
  } catch (error) {
    await owned.dispose();
    throw error;
  }
}
async function snapshot(
  db: ReturnType<typeof createIsolatedTestDatabase>['dataSource'],
  renamed: boolean,
) {
  const rows = [],
    catalog = [];
  for (const [oldName, newName] of Object.entries(names)) {
    const table = renamed ? newName : oldName;
    rows.push([
      oldName,
      await db.query(`SELECT to_jsonb(t)::text row FROM "${table}" t ORDER BY to_jsonb(t)::text`),
    ]);
    catalog.push(
      await db.query(
        `SELECT c.oid::text,t.tgname,t.oid::text trigger_oid,
      con.conname,con.oid::text constraint_oid,i.indexrelid::text index_oid
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_trigger t ON t.tgrelid=c.oid LEFT JOIN pg_constraint con ON con.conrelid=c.oid
      LEFT JOIN pg_index i ON i.indrelid=c.oid
      WHERE n.nspname=current_schema() AND c.relname=$1 ORDER BY t.oid,con.oid,i.indexrelid`,
        [table],
      ),
    );
  }
  return { rows, catalog };
}

test('physical naming preserves all rows, object identities, journal and active capture', async () => {
  const f = await fixture(true);
  try {
    const journal = await f.db.query('SELECT * FROM migrations ORDER BY id');
    await f.db.runMigrations({ transaction: 'all' });
    assert.deepEqual(await snapshot(f.db, true), f.before);
    assert.deepEqual(
      (await f.db.query('SELECT * FROM migrations ORDER BY id')).slice(0, -1),
      journal,
    );
    assert.equal(await hasMainAuthorityCapture(f.db.manager), true);
    assert.ok(f.records);
    for (const record of f.records.cases) {
      const replay = await new Mf06AssessmentStore(f.db).replay(
        record.request,
        record.command,
        f.records.site,
      );
      assert.equal(replay?.assessmentId, record.assessment);
      assert.deepEqual(replay?.authorityArtifact, record.archive);
      assert.equal(
        await new Mf06AssessmentStore(f.db).replay(record.request, record.command, randomUUID()),
        null,
      );
    }
    const receipt = await new MainZoneDenyCommandService(f.db).create(f.records.deny);
    assert.equal(receipt.replayed, true);
    assert.deepEqual(receipt.grant, f.records.grant);
    assert.deepEqual(await snapshot(f.db, true), f.before);
    assert.deepEqual(await f.db.runMigrations(), []);
    for (const oldName of Object.keys(names))
      assert.equal(
        (await f.db.query('SELECT to_regclass($1)::text name', [oldName]))[0].name,
        null,
      );
  } finally {
    await f.owned.dispose();
  }
});

test('separate legacy authority history remains intact alongside the canonical names', async () => {
  const f = await fixture();
  try {
    await f.db.query('CREATE TABLE zone_authority_fact(id int PRIMARY KEY, body text)');
    await f.db.query("INSERT INTO zone_authority_fact VALUES(1,'Synthetic legacy history')");
    const before = await f.db.query('SELECT * FROM zone_authority_fact');
    await f.db.runMigrations({ transaction: 'all' });
    assert.deepEqual(await f.db.query('SELECT * FROM zone_authority_fact'), before);
    assert.deepEqual(await snapshot(f.db, true), f.before);
  } finally {
    await f.owned.dispose();
  }
});

for (const entrypoint of ['configuration', 'workforce', 'legacy authority']) {
  test(`pre-naming journal refuses unjournaled ${entrypoint} writes`, async () => {
    const f = await fixture();
    try {
      let called = false;
      const attempt =
        entrypoint === 'configuration'
          ? executeMainConfigurationCommand(f.db, undefined, 'SITE_CREATE', {}, async () => {
              called = true;
            })
          : f.db.transaction((manager) =>
              entrypoint === 'workforce'
                ? refuseLegacyMainWriter(manager)
                : requireLegacyAuthoritySchema(manager),
            );
      await assert.rejects(
        attempt,
        (error: { getStatus?: () => number }) => error.getStatus?.() === 503,
      );
      assert.equal(called, false);
      assert.deepEqual(await snapshot(f.db, false), f.before);
    } finally {
      await f.owned.dispose();
    }
  });
}

for (const sabotage of ['canonical collision', 'tampered function']) {
  test(`physical naming refuses ${sabotage} and rolls back without changing data`, async () => {
    const f = await fixture();
    try {
      if (sabotage === 'canonical collision')
        await f.db.query('CREATE TABLE zone_entry_assessment(id int)');
      if (sabotage === 'tampered function')
        await f.db.query(`CREATE OR REPLACE FUNCTION mf06_authority_internal_guard()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
      const journal = await f.db.query('SELECT * FROM migrations ORDER BY id');
      await assert.rejects(f.db.runMigrations({ transaction: 'all' }), /collision|profile|legacy/i);
      assert.deepEqual(await snapshot(f.db, false), f.before);
      assert.deepEqual(await f.db.query('SELECT * FROM migrations ORDER BY id'), journal);
    } finally {
      await f.owned.dispose();
    }
  });
}
