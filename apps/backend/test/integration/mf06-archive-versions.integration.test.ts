import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { QueryFailedError } from 'typeorm';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';
import { Mf06TeamAuthorityHistory1792281600000 } from '../../src/database/migrations/1792281600000-Mf06TeamAuthorityHistory.js';

const isolated = createIsolatedTestDatabase({ canonical: true });
const db = isolated.dataSource;
before(async () => {
  assert(db.options.type === 'postgres');
  assert.match(db.options.schema ?? '', /^isolated_test_[a-f0-9]{32}$/);
  console.info('Owned archive-version test schema:', db.options.schema);
  await isolated.initialize();
  assert.equal(db.migrations.length, 75);
  const migrationNames = db.migrations.map(
    (migration) => migration.name ?? migration.constructor.name,
  );
  assert(migrationNames.includes('Mf06TeamAuthorityHistory1792281600000'));
  assert(migrationNames.includes('ZoneEntryPhysicalStorage1792454400000'));
});
after(() => isolated.dispose());

async function roundTrip(version: 'V1' | 'V2') {
  const fixture = await storeVersionFixture(db, version);
  const store = new Mf06AssessmentStore(db);
  const result = await store.finalize(fixture.input);
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') throw Error('No recorded fixture result');
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(result.assessment.provenance, 'SYNTHETIC_TEST');
  assert.deepEqual(result.assessment.authorityArtifact, fixture.archive);
  const replay = await store.finalize(fixture.input);
  assert.equal(replay.state, 'REPLAY');
  const [head] = await db.query(
    'SELECT status,lease_token FROM zone_entry_assessment_job WHERE request_id=$1',
    [fixture.requestId],
  );
  assert.deepEqual(head, { status: 'SUCCEEDED', lease_token: null });
}
async function guard() {
  const [row]: { oid: number; body: string; definition: string }[] = await db.query(`
    SELECT p.oid,p.prosrc body,pg_get_functiondef(p.oid) definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema()
    AND p.proname='mf06_b2_artifact_insert_guard'`);
  assert(row);
  return row;
}
const rollback = () =>
  db.transaction(async (manager) => {
    assert(manager.queryRunner);
    const migration = new Mf06TeamAuthorityHistory1792281600000();
    await migration.down(manager.queryRunner);
  });

test('V1 round-trips on canonical70 through the actual store and lease CAS', () => roundTrip('V1'));
test('canonical70 already-installed guard and forward-only rollback preserve populated V1 bytes and guard OID', async () => {
  const before = await guard();
  assert.match(before.body, /MF06_MAIN_AUTHORITY_ARCHIVE_V1/);
  assert.match(before.body, /MF06_MAIN_AUTHORITY_ARCHIVE_V2/);
  assert.match(before.body, /zone_entry_assessment_request/);
  assert.doesNotMatch(before.body, /mf06_assessment_request/);
  const bodies = () =>
    db.query(
      'SELECT artifact_id,body::text,body_hash,sha256,stored_at::text FROM zone_entry_authority_artifact ORDER BY artifact_id',
    );
  const original = await bodies();
  assert.equal(original.length, 1);
  await assert.rejects(() => rollback(), /forward recovery/);
  assert.deepEqual(await guard(), before);
  assert.deepEqual(await bodies(), original);
});
test('V2 round-trips on canonical70 through the actual store and lease CAS', () => roundTrip('V2'));

test('database rejects malformed V2 envelope, scope, masks and row budget before attachment', async () => {
  const fixture = await storeVersionFixture(db, 'V2');
  for (const fault of [
    'missing-format',
    'unknown-format',
    'mixed-version',
    'wrong-site',
    'source-count',
    'extra-field',
    'missing-zone-mask',
    'row-budget',
  ]) {
    const body = structuredClone(fixture.archive);
    const source = (kind: string) => {
      const value = body.payload.sources.find((s) => s.sourceKind === kind);
      assert(value);
      return value;
    };
    if (fault === 'missing-format') Reflect.deleteProperty(body, 'format');
    if (fault === 'unknown-format') Object.assign(body, { format: 'UNKNOWN' });
    if (fault === 'mixed-version') body.payload.version = 'MF06_MAIN_AUTHORITY_ARCHIVE_V1';
    if (fault === 'wrong-site') body.payload.context.siteId = randomUUID();
    if (fault === 'source-count') body.payload.sources = body.payload.sources.slice(0, -1);
    if (fault === 'extra-field') source('SITE').rows[0]!.private = 'not allowed';
    if (fault === 'missing-zone-mask')
      source('ASSIGNMENT').fields = source('ASSIGNMENT').fields.slice(0, -1);
    if (fault === 'row-budget')
      source('TEAM').rows = Array.from({ length: 2049 }, () => ({
        id: randomUUID(),
        site_id: fixture.input.siteId,
        contractor_id: randomUUID(),
        is_active: true,
      }));
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await assert.rejects(
        () =>
          runner.query(
            'INSERT INTO zone_entry_authority_artifact(artifact_id,request_id,sha256,body) VALUES($1,$2,$3,$4::jsonb)',
            [randomUUID(), fixture.requestId, fixture.archive.sha256, JSON.stringify(body)],
          ),
        (error: unknown) =>
          error instanceof QueryFailedError &&
          (error.driverError as { code?: string }).code === '23514',
        fault,
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }
});
test('rollback refuses stored V2 without changing guard or immutable history', async () => {
  const before = await guard();
  const bodies = await db.query(
    'SELECT artifact_id,body::text,body_hash FROM zone_entry_authority_artifact ORDER BY artifact_id',
  );
  assert.equal(bodies.length, 2);
  await assert.rejects(() => rollback(), /forward recovery/);
  assert.deepEqual(await guard(), before);
  assert.deepEqual(
    await db.query(
      'SELECT artifact_id,body::text,body_hash FROM zone_entry_authority_artifact ORDER BY artifact_id',
    ),
    bodies,
  );
});
test('stored V2 remains immutable against update, delete and truncate', async () => {
  const bodies = () =>
    db.query(
      'SELECT artifact_id,body::text,body_hash FROM zone_entry_authority_artifact ORDER BY artifact_id',
    );
  const before = await bodies();
  for (const statement of [
    "UPDATE zone_entry_authority_artifact SET body=body||'{\"extra\":true}'::jsonb WHERE body->>'format'='MF06_MAIN_AUTHORITY_ARCHIVE_V2'",
    "DELETE FROM zone_entry_authority_artifact WHERE body->>'format'='MF06_MAIN_AUTHORITY_ARCHIVE_V2'",
    'TRUNCATE zone_entry_authority_artifact,zone_entry_assessment',
  ]) {
    await assert.rejects(
      () => db.query(statement),
      (error: unknown) =>
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23514',
    );
    assert.deepEqual(await bodies(), before);
  }
});
