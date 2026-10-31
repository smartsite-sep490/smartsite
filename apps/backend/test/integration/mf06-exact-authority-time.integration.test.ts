import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { ExactMf06AuthorityTime1794787200000 } from '../../src/database/migrations/1794787200000-ExactMf06AuthorityTime.js';
import {
  parseMainAuthorityInstant,
  sealMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { computeMf06InitialBinding } from '../../src/modules/safety/assessments/mf06-event-admission.js';

function createPreExactDatabase() {
  const owned = createIsolatedTestDatabase();
  const migrations = owned.dataSource.options.migrations;
  assert(Array.isArray(migrations));
  owned.dataSource.setOptions({
    migrations: migrations.filter((migration) => migration !== ExactMf06AuthorityTime1794787200000),
  });
  return owned;
}

test('normal migration discovery installs exact authority storage in its owned schema', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const [column] = await db.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='zone_entry_assessment_request'
      AND column_name='authority_captured_at') AS present`);
    assert.equal(column.present, true);
    assert.equal(await db.showMigrations(), false);
    assert(
      db.migrations.some((migration) => migration instanceof ExactMf06AuthorityTime1794787200000),
    );
  } finally {
    await owned.dispose();
  }
});

test('exact authority migration preserves parser microseconds and artifact guard checks', async () => {
  const owned = createPreExactDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const [before] = await db.query(`SELECT pg_get_functiondef(p.oid) AS body
      FROM pg_proc p WHERE p.pronamespace=current_schema()::regnamespace
      AND p.proname='mf06_b2_artifact_insert_guard'`);
    const migration = new ExactMf06AuthorityTime1794787200000();
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await migration.up(runner);
      await runner.commitTransaction();
      for (const value of [
        '2026-10-31T00:00:00.123456Z',
        '2026-10-31T07:00:00.123456+07:00',
        '2026-10-31T00:00:00.000001-23:59',
        '2026-10-31T00:00:00.999999+23:59',
        '2000-02-29T00:00:00Z',
      ]) {
        const [row] = await db.query(
          `SELECT (extract(epoch FROM mf06_exact_authority_instant($1))*1000000)::numeric(30,0)::text AS micros`,
          [value],
        );
        assert.equal(row.micros, String(parseMainAuthorityInstant(value)), value);
      }
      for (const value of [
        '2026-02-30T00:00:00Z',
        '2026-10-31T00:00:60Z',
        '2026-10-31T00:00:00.1234567Z',
        '2026-10-31T00:00:00',
        '2026-10-31t00:00:00z',
        '0000-01-01T00:00:00Z',
      ]) {
        assert.equal(parseMainAuthorityInstant(value), null);
        const [row] = await db.query(
          'SELECT mf06_exact_authority_instant($1) IS NULL AS rejected',
          [value],
        );
        assert.equal(row.rejected, true, value);
      }
      const [after] = await db.query(`SELECT pg_get_functiondef(p.oid) AS body
        FROM pg_proc p WHERE p.pronamespace=current_schema()::regnamespace
        AND p.proname='mf06_b2_artifact_insert_guard'`);
      assert.equal(
        after.body,
        before.body.replaceAll(
          'req.captured_at',
          'COALESCE(req.authority_captured_at,req.captured_at)',
        ),
        'All existing artifact checks and trusted function options must remain identical',
      );
      const [column] = await db.query(`SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='zone_entry_assessment_request'
        AND column_name='authority_captured_at'`);
      assert.deepEqual(column, { is_nullable: 'YES', data_type: 'timestamp with time zone' });
      await runner.startTransaction();
      await migration.down(runner);
      await runner.commitTransaction();
      const [restored] = await db.query(`SELECT pg_get_functiondef(p.oid) AS body
        FROM pg_proc p WHERE p.pronamespace=current_schema()::regnamespace
        AND p.proname='mf06_b2_artifact_insert_guard'`);
      assert.equal(restored.body, before.body);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await owned.dispose();
  }
});

test('exact time trigger derives storage metadata without rewriting legacy requests and refuses populated rollback', async () => {
  const owned = createPreExactDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const fixture = await storeVersionFixture(db, 'V2', '1.3.0');
    const [original] = await db.query(
      'SELECT * FROM zone_entry_assessment_request WHERE request_id=$1',
      [fixture.requestId],
    );
    const [event] = await db.query('SELECT * FROM ai_observation_event WHERE event_id=$1', [
      original.event_id,
    ]);
    const migration = new ExactMf06AuthorityTime1794787200000();
    await db.transaction((manager) => migration.up(manager.queryRunner!));
    const [legacy] = await db.query(
      'SELECT authority_captured_at FROM zone_entry_assessment_request WHERE request_id=$1',
      [fixture.requestId],
    );
    assert.equal(legacy.authority_captured_at, null, 'No historical backfill');
    const insert = async (
      classification: string | null,
      capturedAt: string,
      purpose = 'INITIAL_OBSERVATION_ASSESSMENT',
      callerTime: string | null = null,
      unbound = false,
    ) => {
      const eventId = randomUUID(),
        requestId = randomUUID();
      const raw = { ...event.raw_payload, eventId, capturedAt };
      if (unbound)
        raw.observations = raw.observations.map((row: { type: string }) =>
          row.type === 'PERSON' ? { ...row, trackId: 999 } : row,
        );
      const payloadHash = computeCanonicalPayloadHash(raw);
      // Deliberately storage-only admission fixture, NOT an authenticated bound-worker receipt.
      const admission = classification ? { classification } : null;
      await db.query(
        `INSERT INTO ai_observation_event
        (event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status,processing_note,admission_context)
        VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED',NULL,$8)`,
        [
          eventId,
          payloadHash,
          event.camera_external_id,
          event.resolved_camera_id,
          event.stream_session_id,
          new Date(capturedAt),
          raw,
          admission,
        ],
      );
      const selected = selectZoneEntrySubject(raw, original.zone_observation_index);
      assert(selected.zoneEligible);
      const request = {
        ...original,
        request_id: requestId,
        event_id: eventId,
        payload_hash: payloadHash,
        captured_at: new Date(capturedAt),
        requested_purpose: purpose,
        binding_hash: computeMf06InitialBinding(eventId, selected),
        subject_binding_status: selected.subjectBindingStatus,
        person_observation_index: selected.personObservationIndex,
        authority_captured_at: callerTime,
      };
      const columns = Object.keys(request);
      assert(columns.every((column) => /^[a-z_]+$/.test(column)));
      await db.query(
        `INSERT INTO zone_entry_assessment_request(${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
        Object.values(request),
      );
      const [stored] = await db.query(
        `SELECT captured_at, to_char(authority_captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact
        FROM zone_entry_assessment_request WHERE request_id=$1`,
        [requestId],
      );
      const [rawAfter] = await db.query(
        'SELECT payload_hash,raw_payload FROM ai_observation_event WHERE event_id=$1',
        [eventId],
      );
      assert.equal(rawAfter.payload_hash, payloadHash);
      assert.deepEqual(rawAfter.raw_payload, raw);
      return { requestId, stored, bindingHash: request.binding_hash };
    };
    const live = await insert('LIVE', '2026-10-10T00:00:00.123456Z');
    assert.equal(live.stored.captured_at.toISOString(), '2026-10-10T00:00:00.123Z');
    assert.equal(live.stored.exact, '2026-10-10T00:00:00.123456Z');
    await assert.rejects(
      db.query(
        'INSERT INTO zone_entry_authority_artifact(artifact_id,request_id,sha256,body) VALUES($1,$2,$3,$4::jsonb)',
        [randomUUID(), live.requestId, fixture.archive.sha256, JSON.stringify(fixture.archive)],
      ),
      /archive scope or format invalid/,
    );
    for (const [classification, purpose] of [
      [null, 'INITIAL_OBSERVATION_ASSESSMENT'],
      ['REVIEW_ONLY', 'INITIAL_OBSERVATION_ASSESSMENT'],
      ['LIVE', 'RETROSPECTIVE_REVIEW'],
    ] as const) {
      assert.equal(
        (await insert(classification, '2026-10-10T00:00:00.123456Z', purpose)).stored.exact,
        null,
      );
    }
    assert.equal((await insert('LIVE', '2026-10-10T00:00:00.1234567Z')).stored.exact, null);
    assert.equal(
      (
        await insert(
          'LIVE',
          '2026-10-10T00:00:00.123456Z',
          'INITIAL_OBSERVATION_ASSESSMENT',
          null,
          true,
        )
      ).stored.exact,
      null,
    );
    await assert.rejects(
      insert(
        'LIVE',
        '2026-10-10T00:00:00.123456Z',
        'INITIAL_OBSERVATION_ASSESSMENT',
        '2026-10-10T00:00:00.123Z',
      ),
      /derived by storage/,
    );
    await assert.rejects(
      db.query(
        'UPDATE zone_entry_assessment_request SET authority_captured_at=NULL WHERE request_id=$1',
        [live.requestId],
      ),
      /immutable/,
    );
    await assert.rejects(
      db.transaction((manager) => migration.down(manager.queryRunner!)),
      /history must be retained/,
    );
    const [retained] = await db.query(
      `SELECT to_char(authority_captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact
      FROM zone_entry_assessment_request WHERE request_id=$1`,
      [live.requestId],
    );
    assert.equal(retained.exact, '2026-10-10T00:00:00.123456Z');

    // Persistence-only proof: this synthetic admission is not a qualified live worker.
    const store = new Mf06AssessmentStore(db);
    assert.equal((await store.finalize(fixture.input)).state, 'RECORDED');
    assert.ok(await store.replay(fixture.requestId, fixture.input.commandId, fixture.input.siteId));
    const [oldJob] = await db.query('SELECT * FROM zone_entry_assessment_job WHERE request_id=$1', [
      fixture.requestId,
    ]);
    const leaseToken = randomUUID();
    const job = {
      ...oldJob,
      request_id: live.requestId,
      status: 'CLAIMED',
      head_revision: 2,
      lease_token: leaseToken,
      attempt_count: 1,
      lease_expires_at: new Date(Date.now() + 120000),
      deadline_at: new Date(Date.now() + 300000),
    };
    const jobColumns = Object.keys(job);
    assert(jobColumns.every((column) => /^[a-z_]+$/.test(column)));
    await db.query(
      `INSERT INTO zone_entry_assessment_job(${jobColumns.join(',')}) VALUES(${jobColumns.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(job),
    );
    const context = { ...fixture.archive.payload.context, capturedAt: live.stored.exact };
    const sealed = sealMainAuthorityArchive({ ...fixture.archive.payload, context }, context);
    assert.equal(sealed.status, 'VALID');
    if (sealed.status !== 'VALID') throw Error('Invalid exact persistence archive');
    const input = {
      ...fixture.input,
      claim: { requestId: live.requestId, leaseToken, headRevision: 2 },
      bindingHash: live.bindingHash,
      commandId: randomUUID(),
      authorityArtifact: sealed.archive,
    };
    const saved = await store.finalize(input);
    assert.equal(saved.state, 'RECORDED');
    if (saved.state !== 'RECORDED') throw Error('Exact persistence failed');
    assert.equal(saved.assessment.capturedAt, '2026-10-10T00:00:00.123000Z');
    assert.equal(saved.assessment.authorityArtifact?.payload.context.capturedAt, live.stored.exact);
    const replay = await store.replay(live.requestId, input.commandId, input.siteId);
    assert.deepEqual(replay, saved.assessment);
    assert.equal((await store.finalize(input)).state, 'REPLAY');
  } finally {
    await owned.dispose();
  }
});

test('exact migration refuses actual missing-parent and system schemas before altering storage', async () => {
  const owned = createPreExactDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const empty = `isolated_test_${randomUUID().replaceAll('-', '')}`;
    await assert.rejects(
      db.transaction(async (manager) => {
        await manager.query(`CREATE SCHEMA "${empty}"`);
        await manager.query("SELECT set_config('search_path',$1,true)", [empty]);
        await new ExactMf06AuthorityTime1794787200000().up(manager.queryRunner!);
      }),
      /parents must belong to target schema/,
    );
    const [removed] = await db.query('SELECT to_regnamespace($1) IS NULL AS absent', [empty]);
    assert.equal(removed.absent, true);
    await assert.rejects(
      db.transaction(async (manager) => {
        await manager.query('SET LOCAL search_path TO pg_catalog');
        await new ExactMf06AuthorityTime1794787200000().up(manager.queryRunner!);
      }),
      /Explicit owned application schema required/,
    );
    const [column] = await db.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='zone_entry_assessment_request'
      AND column_name='authority_captured_at') AS present`);
    assert.equal(column.present, false);
  } finally {
    await owned.dispose();
  }
});
