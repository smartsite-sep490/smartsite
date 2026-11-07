import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { ZONE_ENTRY_STORAGE_NAMES } from '../../src/common/configuration/zone-entry-storage-profile-v1.js';
import { InstallAuthorityJournal1795046400000 } from '../../src/database/migrations/1795046400000-InstallAuthorityJournal.js';
import { InstallAuthorityCutover1795046400001 } from '../../src/database/migrations/1795046400001-InstallAuthorityCutover.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const journal = InstallAuthorityJournal1795046400000.name;
const cutover = InstallAuthorityCutover1795046400001.name;
const authorityTables: string[] = Object.values(ZONE_ENTRY_STORAGE_NAMES)
  .filter((name) => !name.startsWith('zone_entry_'))
  .sort();

const relations = (db: DataSource) =>
  db.query<{ relname: string; oid: string }[]>(
    "SELECT relname,oid::text FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' ORDER BY relname",
  );

const artifactGuard = (db: DataSource) =>
  db.query<{ definition: string }[]>(
    "SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='mf06_b2_artifact_insert_guard'",
  );

const installedMigrations = (db: DataSource) =>
  db.query<{ name: string }[]>('SELECT name FROM migrations ORDER BY id');

async function assertInstalledWithoutActivation(db: DataSource) {
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
  assert.deepEqual(
    await db.query('SELECT epoch_id FROM authorization_history_control WHERE singleton=1'),
    [{ epoch_id: null }],
  );
}

test('fresh registry installs canonical authority history without activating an epoch', async (t) => {
  const owned = createIsolatedTestDatabase();
  t.after(() => owned.dispose());
  await owned.initialize();

  const db = owned.dataSource;
  const applied = await installedMigrations(db);
  assert.deepEqual(
    applied.slice(-2).map(({ name }) => name),
    [journal, cutover],
  );
  const tables = (await relations(db)).map(({ relname }) => relname);
  assert.equal(authorityTables.length, 13);
  assert.deepEqual(
    tables.filter((name) => authorityTables.includes(name)),
    authorityTables,
  );
  assert.equal(
    tables.some((name) => name.startsWith('mf06_authority_')),
    false,
  );
  await assertInstalledWithoutActivation(db);
  assert.deepEqual(await db.runMigrations(), []);
});

test('upgrade preserves existing data and the exact-time guard, and only the empty cutover can roll back', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true });
  t.after(() => owned.dispose());
  await owned.initialize();

  const db = owned.dataSource;
  const id = randomUUID();
  await db.query("INSERT INTO site(id,code,name) VALUES($1,'AUTH-UPGRADE','Existing Site')", [id]);
  const site = () => db.query('SELECT to_jsonb(s) AS data FROM site s WHERE id=$1', [id]);
  const beforeSite = await site();
  const beforeRelations = await relations(db);
  const beforeGuard = await artifactGuard(db);
  assert.equal(beforeGuard.length, 1);
  const [guard] = beforeGuard;
  assert.ok(guard);
  assert.match(guard.definition, /COALESCE\(req.authority_captured_at,req.captured_at\)/);

  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('SET LOCAL search_path=pg_catalog');
    await assert.rejects(
      new InstallAuthorityJournal1795046400000().up(runner),
      /Explicit authority journal schema required/,
    );
    await assert.rejects(
      new InstallAuthorityCutover1795046400001().up(runner),
      /Explicit owned schema required/,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await relations(db), beforeRelations);

  db.migrations.push(
    new InstallAuthorityJournal1795046400000(),
    new InstallAuthorityCutover1795046400001(),
  );
  assert.deepEqual(
    (await db.runMigrations()).map(({ name }) => name),
    [journal, cutover],
  );
  await assertInstalledWithoutActivation(db);

  const afterRelations = await relations(db);
  const beforeNames = new Set(beforeRelations.map(({ relname }) => relname));
  assert.deepEqual(
    afterRelations.filter(({ relname }) => beforeNames.has(relname)),
    beforeRelations,
  );
  assert.deepEqual(
    afterRelations.filter(({ relname }) => !beforeNames.has(relname)).map(({ relname }) => relname),
    authorityTables,
  );
  assert.deepEqual(await site(), beforeSite);
  assert.deepEqual(await artifactGuard(db), beforeGuard);

  await db.undoLastMigration();
  assert.equal((await installedMigrations(db)).at(-1)?.name, journal);
  await assert.rejects(db.undoLastMigration(), /Authority journal is forward-only/);
  assert.equal((await installedMigrations(db)).at(-1)?.name, journal);
  assert.deepEqual(
    (await db.runMigrations()).map(({ name }) => name),
    [cutover],
  );
  await assertInstalledWithoutActivation(db);
  assert.deepEqual(await artifactGuard(db), beforeGuard);
});
