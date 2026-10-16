import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { DatabaseService } from '../../src/database/database.service.js';

// Offline metadata fixture observed by a separate read-only Neon audit. These
// tests never use cloud credentials, fetch cloud rows or call an AI service.
const observedPrefix = [
  'Mf05Mf06Foundation1789689600000',
  'CameraRegionConfiguration1790035200000',
  'UserAuthentication1790121600000',
  'SafetyAlertReadIndex1790467200000',
  'ScopedJwtAuthentication1790553600000',
  'Mf06ZoneAuthorization1790553600000',
  'SafetyAlertReviews1790640000000',
];

async function withLegacySeven(
  operation: (legacy: DataSource, upgrade: DataSource) => Promise<void>,
) {
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres' || !Array.isArray(options.migrations))
    throw new Error('Dedicated PostgreSQL migration graph required');
  const prefix = options.migrations.slice(0, 7);
  assert.deepEqual(
    prefix.map((migration) => (typeof migration === 'function' ? migration.name : migration)),
    observedPrefix,
  );
  const scoped = {
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  } as DataSourceOptions;
  const control = new DataSource(options),
    legacy = new DataSource({ ...scoped, migrations: prefix }),
    upgrade = new DataSource(scoped);
  await control.initialize();
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    await legacy.initialize();
    assert.equal((await legacy.runMigrations({ transaction: 'all' })).length, 7);
    await operation(legacy, upgrade);
  } finally {
    if (legacy.isInitialized) await legacy.destroy();
    if (upgrade.isInitialized) await upgrade.destroy();
    try {
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await control.destroy();
    }
  }
}

async function seed(legacy: DataSource, track: number) {
  const site = randomUUID(),
    camera = randomUUID(),
    zone = randomUUID(),
    worker = randomUUID(),
    event = randomUUID(),
    user = randomUUID();
  await legacy.query('INSERT INTO site(id,code,name) VALUES($1,$2,$3)', [
    site,
    site,
    'Synthetic upgrade Site',
  ]);
  await legacy.query(
    'INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$3,$3,$4)',
    [camera, site, camera, 'Synthetic camera metadata'],
  );
  await legacy.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1::uuid,$2::uuid,$1::text,$3,'RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zone, site, 'Synthetic Zone'],
  );
  await legacy.query(
    'INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1::uuid,$2::uuid,$1::text,$3)',
    [worker, site, 'Synthetic unmapped legacy Worker'],
  );
  await legacy.query(
    'INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,$3,$4,true,false)',
    [user, `upgrade-${user}`, 'Synthetic account', 'SYNTHETIC_HASH_NOT_A_CREDENTIAL'],
  );
  await legacy.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
    [randomUUID(), user, site],
  );
  for (const effect of ['ALLOW', 'DENY'])
    await legacy.query(
      "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from) VALUES($1,$2,$3,$4,$5,'2026-10-01T00:00:00.123456Z')",
      [randomUUID(), site, zone, worker, effect],
    );
  await legacy.query(
    "INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,$3::text,$3::uuid,$4,'2026-10-01T00:00:01.123456Z',$5::jsonb,'PROCESSED')",
    [
      event,
      'a'.repeat(64),
      camera,
      randomUUID(),
      JSON.stringify({
        syntheticSoftwareFixture: true,
        noHumanGroundTruth: true,
        noCameraPixels: true,
      }),
    ],
  );
  await legacy.query(
    "INSERT INTO zone_entry_decision(id,event_id,site_id,zone_id,worker_id,track_id,status,reason_code,evaluated_at) VALUES($1,$2,$3,$4,$5,$6,'UNAVAILABLE','IDENTITY_UNAVAILABLE','2026-10-01T00:00:02.123456Z')",
    [randomUUID(), event, site, zone, worker, track],
  );
  return { site, worker };
}

async function selectedRows(db: DataSource) {
  const result: Record<string, unknown[]> = {};
  for (const table of [
    'site',
    'camera',
    'zone',
    'worker',
    'app_user',
    'user_role_assignment',
    'zone_access_grant',
    'ai_observation_event',
    'zone_entry_decision',
  ])
    result[table] = (
      await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
    ).map((row: { row: unknown }) => row.row);
  return result;
}

test('observed seven-migration prefix upgrades populated synthetic data to MAIN58 without inventing identity or grants', async () => {
  await withLegacySeven(async (legacy, upgrade) => {
    const fixture = await seed(legacy, 2147483647),
      before = await selectedRows(legacy);
    const [originalTime] = await legacy.query(
      'SELECT to_char(captured_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS value FROM ai_observation_event',
    );
    await upgrade.initialize();
    assert.equal(await new DatabaseService(upgrade).isReachable(), true);
    assert.equal(
      await new DatabaseService(upgrade).isReady(),
      false,
      'Reachable legacy7 is not release58 readiness',
    );
    assert.equal(
      (await upgrade.query('SELECT count(*)::int AS total FROM migrations'))[0].total,
      7,
      'Readiness must not auto-migrate',
    );
    await legacy.destroy();
    const applied = await upgrade.runMigrations({ transaction: 'all' });
    assert.equal(applied.length, 51);
    assert.equal(
      (await upgrade.query('SELECT count(*)::int AS total FROM migrations'))[0].total,
      58,
    );
    assert.equal(await new DatabaseService(upgrade).isReady(), true);
    const after = await selectedRows(upgrade);
    for (const [table, rows] of Object.entries(before)) {
      assert.equal(after[table]?.length, rows.length);
      for (let index = 0; index < rows.length; index++)
        for (const [key, value] of Object.entries(rows[index] as Record<string, unknown>))
          assert.deepEqual(
            (after[table]![index] as Record<string, unknown>)[key],
            value,
            `${table}.${key} changed`,
          );
    }
    const [site] = await upgrade.query('SELECT access_policy_version FROM site WHERE id=$1', [
      fixture.site,
    ]);
    assert.equal(site.access_policy_version, 1);
    const [worker] = await upgrade.query('SELECT contractor_id,user_id FROM worker WHERE id=$1', [
      fixture.worker,
    ]);
    assert.deepEqual(worker, { contractor_id: null, user_id: null });
    const [time] = await upgrade.query(
      'SELECT to_char(captured_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS value FROM ai_observation_event',
    );
    assert.deepEqual(time, originalTime);
    const [track] = await upgrade.query(
      'SELECT pg_typeof(track_id)::text AS type,track_id::text AS value FROM zone_entry_decision',
    );
    assert.deepEqual(track, { type: 'bigint', value: '2147483647' });
    for (const table of [
      'worker_site_zone_assignment',
      'contractor_zone_permission',
      'worker_zone_permission',
      'safety_face_consent',
      'mf06_assessment_request',
      'mf06_assessment_job',
      'mf06_assessment',
      'mf06_authority_epoch',
    ])
      assert.equal(
        (await upgrade.query(`SELECT count(*)::int AS total FROM ${table}`))[0].total,
        0,
        `Unexpected generated ${table}`,
      );
    assert.equal(
      (await upgrade.query('SELECT epoch_id FROM mf06_authority_control WHERE singleton=1'))[0]
        .epoch_id,
      null,
    );
    assert.equal((await upgrade.runMigrations({ transaction: 'all' })).length, 0);
  });
});

test('invalid legacy Track rolls the entire pending migration batch back, retaining the original seven schema and rows', async () => {
  await withLegacySeven(async (legacy, upgrade) => {
    await seed(legacy, -1);
    const before = await selectedRows(legacy);
    if (legacy.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
    const schema = legacy.options.schema;
    assert.match(schema ?? '', /^isolated_test_[a-f0-9]{32}$/);
    const tablesBefore = await legacy.query(
      'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename',
      [schema],
    );
    await legacy.destroy();
    await upgrade.initialize();
    await assert.rejects(() => upgrade.runMigrations({ transaction: 'all' }), { code: '23514' });
    assert.deepEqual(await selectedRows(upgrade), before);
    assert.deepEqual(
      await upgrade.query(
        'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename',
        [schema],
      ),
      tablesBefore,
    );
    assert.equal(
      (await upgrade.query('SELECT count(*)::int AS total FROM migrations'))[0].total,
      7,
    );
    assert.equal(await new DatabaseService(upgrade).isReady(), false);
    const [track] = await upgrade.query(
      'SELECT pg_typeof(track_id)::text AS type,track_id::text AS value FROM zone_entry_decision',
    );
    assert.deepEqual(track, { type: 'integer', value: '-1' });
    assert.equal(
      (
        await upgrade.query(
          "SELECT to_regclass(format('%I.%I',current_schema(),'mf06_assessment_request')) AS relation",
        )
      )[0].relation,
      null,
    );
  });
});
