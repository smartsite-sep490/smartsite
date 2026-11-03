import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { before, after, test } from 'node:test';
import { QueryFailedError } from 'typeorm';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';
import { CanonicalMf06Results1794182400000 } from '../../src/database/migrations/1794182400000-CanonicalMf06Results.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(async () => {
  assert(db.options.type === 'postgres');
  assert.match(db.options.schema ?? '', /^isolated_test_[a-f0-9]{32}$/);
  console.info('Owned archive-version test schema:', db.options.schema);
  await isolated.initialize();
  const migrationNames = db.migrations.map(
    (migration) => migration.name ?? migration.constructor.name,
  );
  assert(migrationNames.includes('CanonicalMf06Results1794182400000'));
});
after(() => isolated.dispose());

async function roundTrip(version: 'V1' | 'V2') {
  const fixture = await storeVersionFixture(db, version);
  if (version === 'V2') {
    const archive = structuredClone(fixture.archive);
    const membership = archive.payload.sources.find(
      (source) => source.sourceKind === 'TEAM_MEMBERSHIP',
    );
    assert(membership);
    membership.fields = [
      'id',
      'team_id',
      'worker_id',
      'site_id',
      'contractor_id',
      'joined_at',
      'left_at',
    ];
    archive.sha256 = computeCanonicalPayloadHash(archive.payload);
    fixture.archive = archive;
    fixture.input.authorityArtifact = archive;
  }
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
    const migration = new CanonicalMf06Results1794182400000();
    await migration.down(manager.queryRunner);
  });

test('V1 round-trips on canonical result storage through the actual store and lease CAS', () =>
  roundTrip('V1'));
test('canonical populated downgrade refusal preserves V1 bytes and the registered guard OID', async () => {
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
  await assert.rejects(() => rollback(), /Refusing populated MF06 assessment revert/);
  assert.deepEqual(await guard(), before);
  assert.deepEqual(await bodies(), original);
});
test('V2 round-trips on canonical result storage through the actual store and lease CAS', () =>
  roundTrip('V2'));

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
  await assert.rejects(() => rollback(), /Refusing populated MF06 assessment revert/);
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

test('named Main V2 membership order round-trips without rewriting the archived payload', async () => {
  const fixture = await storeVersionFixture(db, 'V2');
  const archive = structuredClone(fixture.archive);
  const membership = archive.payload.sources.find(
    (source) => source.sourceKind === 'TEAM_MEMBERSHIP',
  );
  assert(membership);
  membership.fields = [
    'id',
    'site_id',
    'contractor_id',
    'team_id',
    'worker_id',
    'joined_at',
    'left_at',
  ];
  archive.sha256 = computeCanonicalPayloadHash(archive.payload);
  const store = new Mf06AssessmentStore(db);
  const input = { ...fixture.input, authorityArtifact: archive };
  const recorded = await store.finalize(input);
  assert.equal(recorded.state, 'RECORDED');
  if (recorded.state !== 'RECORDED') throw Error('No named V2 recorded result');
  assert.deepEqual(recorded.assessment.authorityArtifact, archive);
  const replay = await store.finalize(input);
  assert.equal(replay.state, 'REPLAY');
  if (replay.state !== 'REPLAY') throw Error('No named V2 replay');
  assert.deepEqual(replay.assessment.authorityArtifact, archive);
});
