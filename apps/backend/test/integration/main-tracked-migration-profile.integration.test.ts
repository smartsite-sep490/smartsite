import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const migrations = [
  'WorkerEventAdmission1795046400002',
  'TrackedSubjectStorage1795046400003',
  'TrackedPendingRecoveryIndex1795046400004',
  'TrackedWireGenerationFence1795046400008',
];

test('Main tracked profile upgrades and rolls back a populated event-local schema without changing history', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'DIRECT_URL',
    'DATABASE_URL_UNPOOLED',
    'DATABASE_SCHEMA',
    'SMARTSITE_DB_MIGRATION_PROFILE',
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  let profile: DataSource | undefined;
  const openProfile = async (label: string): Promise<DataSource> =>
    (
      await import(
        new URL('../../src/database/typeorm.data-source.js?' + label, import.meta.url).href
      )
    ).default;
  try {
    await owned.initialize();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    delete process.env.DIRECT_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    delete process.env.DATABASE_SCHEMA;
    delete process.env.SMARTSITE_DB_MIGRATION_PROFILE;
    const defaultMigrations = (await openProfile('default')).options.migrations;
    assert.ok(Array.isArray(defaultMigrations) && defaultMigrations.length > 0);
    assert.ok(
      defaultMigrations.every(
        (migration) => typeof migration === 'function' && !migrations.includes(migration.name),
      ),
    );
    process.env.SMARTSITE_DB_MIGRATION_PROFILE = 'tracked-v16';
    await assert.rejects(openProfile('missing-schema'), /explicit tracked schema/i);
    process.env.DATABASE_SCHEMA = db.driver.schema!;

    const siteId = randomUUID(),
      cameraId = randomUUID(),
      eventId = randomUUID();
    const sessionId = randomUUID(),
      episodeId = randomUUID(),
      hash = 'a'.repeat(64);
    await db.query('INSERT INTO site(id,code,name) VALUES($1,$2,$2)', [
      siteId,
      'tracked-profile-test',
    ]);
    await db.query('INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$3,$3,$3)', [
      cameraId,
      siteId,
      'tracked-profile-camera',
    ]);
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,
         stream_session_id,captured_at,raw_payload,processing_status)
       VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,'PROCESSED')`,
      [
        eventId,
        hash,
        'tracked-profile-camera',
        cameraId,
        sessionId,
        {
          schemaVersion: '1.0.0',
          observations: [{ type: 'PERSON', trackId: 7 }],
        },
      ],
    );
    await db.query(
      `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,
         first_observed_at,last_observed_at)
       SELECT $1,$2,$3,event_id,0,payload_hash,captured_at,captured_at FROM ai_observation_event WHERE event_id=$4`,
      [episodeId, siteId, cameraId, eventId],
    );
    const snapshot = async () =>
      (
        await db.query(
          `SELECT to_jsonb(e)-'subject_kind'-'tracking_segment_id'-'tracking_scope_sha256' AS episode,
                r.raw_payload,r.payload_hash FROM safety_episode e JOIN ai_observation_event r ON r.event_id=e.event_id
         WHERE e.id=$1`,
          [episodeId],
        )
      )[0];
    const before = await snapshot();
    profile = await openProfile('explicit');
    await profile.initialize();
    assert.equal(profile.driver.schema, db.driver.schema);
    assert.deepEqual(
      (await profile.runMigrations()).map(({ name }) => name),
      migrations,
    );
    assert.deepEqual(await profile.runMigrations(), []);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      await db.query('SELECT subject_kind FROM safety_episode WHERE id=$1', [episodeId]),
      [{ subject_kind: 'EVENT_LOCAL' }],
    );
    await assert.rejects(
      db.query(
        `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,
           stream_session_id,captured_at,raw_payload,processing_status)
         VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,'PROCESSED')`,
        [
          randomUUID(),
          hash,
          'tracked-profile-camera',
          cameraId,
          randomUUID(),
          { schemaVersion: '1.6.0' },
        ],
      ),
      { constraint: 'chk_v16_requires_tracked_route' },
    );
    for (let index = 0; index < migrations.length; index++) await profile.undoLastMigration();
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (await profile.runMigrations()).map(({ name }) => name),
      migrations,
    );
    const freshSchema = 'fresh_tracked_' + randomUUID().replaceAll('-', '');
    let fresh: DataSource | undefined;
    await db.query('CREATE SCHEMA "' + freshSchema + '"');
    try {
      process.env.DATABASE_SCHEMA = freshSchema;
      fresh = await openProfile('fresh-bootstrap');
      await fresh.initialize();
      const applied = await fresh.runMigrations();
      const firstProfileIndex = applied.findIndex(({ name }) => name === migrations[0]);
      assert.ok(firstProfileIndex >= 0);
      assert.deepEqual(
        applied.filter(({ name }) => migrations.includes(name)).map(({ name }) => name),
        migrations,
      );
      for (let index = firstProfileIndex; index < applied.length; index++)
        await fresh.undoLastMigration();
      const remaining = await fresh.query('SELECT name FROM migrations ORDER BY id');
      assert.deepEqual(
        remaining.map((row: { name: string }) => row.name),
        applied.slice(0, firstProfileIndex).map(({ name }) => name),
      );
      assert.equal(
        (
          await fresh.query(
            "SELECT to_jsonb(e)->'admission_context' AS admission FROM ai_observation_event e LIMIT 1",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await fresh.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='ai_observation_event' AND column_name='admission_context'",
            [freshSchema],
          )
        )[0].n,
        0,
      );
    } finally {
      if (fresh?.isInitialized) await fresh.destroy();
      await db.query('DROP SCHEMA "' + freshSchema + '" CASCADE');
      process.env.DATABASE_SCHEMA = db.driver.schema!;
    }
    const generation = randomUUID();
    await db.query(
      `INSERT INTO camera_worker_generation(id,camera_id,site_id,stream_session_id,credential_sha256,
         is_current,issued_at,expires_at,observation_route_mode,tracking_route_epoch,tracked_wire_version)
       SELECT $1,$2,$3,$4,$5,true,now(),now()+interval '1 minute','EPISODE_TRACKED',$6,'1.6.0'`,
      [generation, cameraId, siteId, randomUUID(), hash, randomUUID()],
    );
    const trackedEvent = randomUUID(),
      frameId = randomUUID();
    const [owner] = await db.query(
      'SELECT stream_session_id,tracking_route_epoch FROM camera_worker_generation WHERE id=$1',
      [generation],
    );
    await db.query(
      `INSERT INTO ai_observation_event(
        event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,
        raw_payload,processing_status,safety_route_mode,safety_route_epoch,tracking_scope_sha256,
        tracking_generation_id,tracking_site_id,tracking_frame_id,tracking_source_sequence,
        tracking_part_index,tracking_part_count,tracking_frame_state,tracking_pending_until,tracking_transport_ack)
       VALUES($1,$2,'tracked-profile-camera',$3,$4,clock_timestamp(),$5,'PROCESSED',
        'EPISODE_TRACKED',$6,$2,$7,$8,$9,1,0,1,'PENDING_PARTS',now()+interval '1 minute','{}')`,
      [
        trackedEvent,
        hash,
        cameraId,
        owner.stream_session_id,
        {
          schemaVersion: '1.6.0',
          eventId: trackedEvent,
          streamSessionId: owner.stream_session_id,
          framePartition: { frameId, sequenceNumber: '1', partIndex: 0, partCount: 1 },
        },
        owner.tracking_route_epoch,
        generation,
        siteId,
        frameId,
      ],
    );
    await db.query(
      "UPDATE ai_observation_event SET tracking_frame_state='SEALED',tracking_frame_result='{}' WHERE event_id=$1",
      [trackedEvent],
    );
    assert.deepEqual(
      await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
        trackedEvent,
      ]),
      [{ tracking_frame_state: 'SEALED' }],
    );
    for (const sql of [
      "UPDATE ai_observation_event SET tracking_pending_until=tracking_pending_until+interval '1 second' WHERE event_id=$1",
      "UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY' WHERE event_id=$1",
    ])
      await assert.rejects(db.query(sql, [trackedEvent]), { code: '23514' });
    await assert.rejects(profile.undoLastMigration(), /generation history must be retained/i);
    assert.deepEqual(
      await db.query('SELECT tracked_wire_version FROM camera_worker_generation WHERE id=$1', [
        generation,
      ]),
      [{ tracked_wire_version: '1.6.0' }],
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    if (profile?.isInitialized) await profile.destroy();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await owned.dispose();
  }
});
