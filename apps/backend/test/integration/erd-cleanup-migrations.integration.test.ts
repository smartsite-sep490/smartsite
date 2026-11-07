import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, type MigrationInterface, type QueryRunner } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const cutoff = 1794960000000;
const nameOf = (value: MigrationInterface) => value.name ?? value.constructor.name;
const retired = [
  'worker_gate_permission',
  'attendance_pair',
  'attendance_anomaly',
  'attendance_correction_request',
  'attendance_schedule_conflict',
  'timesheet',
  'visitor_gate_event',
];

async function predecessor(run: (source: DataSource, runner: QueryRunner) => Promise<void>) {
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  assert.equal(options.type, 'postgres');
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  const control = new DataSource({ ...options, entities: [], migrations: [] });
  const source = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  let runner: QueryRunner | undefined;
  try {
    await control.initialize();
    assert.deepEqual(
      (await control.query('SELECT current_database() AS db,current_user AS role'))[0],
      { db: 'smartsite_test', role: 'smartsite_test' },
    );
    await control.query(`CREATE SCHEMA "${schema}"`);
    await source.initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    for (const migration of [...source.migrations].sort(
      (a, b) =>
        Number(nameOf(a).slice(-13)) - Number(nameOf(b).slice(-13)) ||
        nameOf(a).localeCompare(nameOf(b)),
    )) {
      if (Number(nameOf(migration).slice(-13)) < cutoff) await migration.up(runner);
    }
    await run(source, runner);
  } finally {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner) await runner.release();
    if (source.isInitialized) await source.destroy();
    if (control.isInitialized) {
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await control.destroy();
    }
  }
}

function migration(source: DataSource, name: string) {
  const value = source.migrations.find((m) => nameOf(m) === name);
  assert.ok(value, `${name} must be registered`);
  return value;
}

async function fixture(runner: QueryRunner) {
  const site = randomUUID(),
    user = randomUUID(),
    worker = randomUUID(),
    day = randomUUID();
  await runner.query(
    "INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,'Synthetic cleanup')",
    [site],
  );
  await runner.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,'Synthetic','synthetic-unusable')",
    [user],
  );
  await runner.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1::uuid,$2,$1::text,'Synthetic')",
    [worker, site],
  );
  await runner.query(
    "INSERT INTO attendance_day(id,site_id,worker_id,work_date,timezone,status,regular_minutes,provisional_minutes,confirmed_minutes) VALUES($1,$2,$3,'2026-10-22','UTC','CONFIRMED',120,120,120)",
    [day, site, worker],
  );
  return { site, user, worker, day };
}

test('fresh normal migrations retire redundant storage and retain team and current attendance tables', async () => {
  const owned = createIsolatedTestDatabase();
  try {
    await owned.initialize();
    const runner = owned.dataSource.createQueryRunner();
    try {
      for (const table of retired) assert.equal(await runner.hasTable(table), false, table);
      for (const table of [
        'team_zone_permission',
        'attendance_event',
        'attendance_session',
        'attendance_day',
        'attendance_correction',
        'gate_event',
      ])
        assert.equal(await runner.hasTable(table), true, table);
      assert.equal(await runner.hasColumn('worker_site_zone_assignment', 'gate_id'), false);
      const schemaDiff = await owned.dataSource.driver.createSchemaBuilder().log();
      assert.deepEqual(schemaDiff.upQueries, []);
    } finally {
      await runner.release();
    }
  } finally {
    await owned.dispose();
  }
});

test('gate cleanup preserves worker assignments while removing retired gate grants and restriction column', async () => {
  await predecessor(async (source, runner) => {
    const f = await fixture(runner);
    await runner.query(
      "INSERT INTO worker_gate_permission(id,worker_id,site_id,gate_id,valid_from,created_by_user_id) VALUES($1,$2,$3,'gate-north-01',now(),$4)",
      [randomUUID(), f.worker, f.site, f.user],
    );
    const cleanup = migration(source, 'RetireGatePermissions1794960000000');
    await cleanup.up(runner);
    assert.equal(await runner.hasTable('worker_gate_permission'), false);
    assert.equal(await runner.hasColumn('worker_site_zone_assignment', 'gate_id'), false);
    assert.equal((await runner.query('SELECT count(*)::int AS n FROM worker'))[0].n, 1);
    await assert.rejects(cleanup.down(runner), /restore.*backup/i);
  });
});

test('legacy attendance cleanup refuses populated legacy records without dropping any table', async () => {
  await predecessor(async (source, runner) => {
    const f = await fixture(runner);
    await runner.query(
      "INSERT INTO attendance_pair(id,site_id,worker_id,work_date,status) VALUES($1,$2,$3,'2026-10-22','MATCHED')",
      [randomUUID(), f.site, f.worker],
    );
    await runner.query('SAVEPOINT refusal');
    await assert.rejects(
      migration(source, 'RetireLegacyAttendance1794960000001').up(runner),
      /legacy attendance.*data/i,
    );
    await runner.query('ROLLBACK TO SAVEPOINT refusal');
    for (const name of retired.slice(1, 5)) assert.equal(await runner.hasTable(name), true);
  });
});

test('timesheet cleanup validates a confirmed replica and preserves the day totals', async () => {
  await predecessor(async (source, runner) => {
    const f = await fixture(runner);
    await runner.query(
      "INSERT INTO timesheet(id,site_id,worker_id,period_start,period_end,total_minutes,status,attendance_day_id) VALUES($1,$2,$3,'2026-10-22','2026-10-22',120,'APPROVED',$4)",
      [randomUUID(), f.site, f.worker, f.day],
    );
    await migration(source, 'RetireTimesheetReplica1794960000002').up(runner);
    assert.equal(await runner.hasTable('timesheet'), false);
    assert.equal(
      (await runner.query('SELECT confirmed_minutes FROM attendance_day WHERE id=$1', [f.day]))[0]
        .confirmed_minutes,
      120,
    );
  });
});

for (const variant of [
  'orphan',
  'mismatch',
  'approval',
  'site',
  'worker',
  'period',
  'status',
] as const) {
  test(`timesheet cleanup refuses ${variant} data before dropping its source`, async () => {
    await predecessor(async (source, runner) => {
      const f = await fixture(runner);
      await runner.query(
        "INSERT INTO timesheet(id,site_id,worker_id,period_start,period_end,total_minutes,status,attendance_day_id,approved_at) VALUES($1,$2,$3,'2026-10-22','2026-10-22',$4,'APPROVED',$5,$6)",
        [
          randomUUID(),
          f.site,
          f.worker,
          variant === 'mismatch' ? 121 : 120,
          variant === 'orphan' ? null : f.day,
          variant === 'approval' ? new Date() : null,
        ],
      );
      if (variant === 'site' || variant === 'worker') {
        const other = await fixture(runner);
        if (variant === 'site') await runner.query('UPDATE timesheet SET site_id=$1', [other.site]);
        else await runner.query('UPDATE timesheet SET worker_id=$1', [other.worker]);
      } else if (variant === 'period')
        await runner.query("UPDATE timesheet SET period_end='2026-10-23'");
      else if (variant === 'status') await runner.query("UPDATE timesheet SET status='DRAFT'");
      await runner.query('SAVEPOINT refusal');
      await assert.rejects(
        migration(source, 'RetireTimesheetReplica1794960000002').up(runner),
        /timesheet.*reconcil/i,
      );
      await runner.query('ROLLBACK TO SAVEPOINT refusal');
      assert.equal(await runner.hasTable('timesheet'), true);
    });
  });
}

async function visitorFixture(runner: QueryRunner) {
  const f = await fixture(runner),
    visit = randomUUID(),
    visitor = randomUUID(),
    attempt = randomUUID(),
    event = randomUUID();
  await runner.query(
    "INSERT INTO visitor(id,full_name,contact,organization) VALUES($1,'Synthetic','synthetic@example.test','Synthetic')",
    [visitor],
  );
  await runner.query(
    "INSERT INTO visitor_visit(id,site_id,representative_visitor_id,site_manager_id,visitor_name,company,contact,host_name,purpose,target_area,group_size,gate_id,valid_from,valid_until,access_key_hash,status) VALUES($1,$2,$3,$4,'Synthetic','Synthetic','synthetic@example.test','Synthetic','Test','Office',1,'gate-north-01',now(),now()+interval '1 hour',repeat('a',64),'APPROVED')",
    [visit, f.site, visitor, f.user],
  );
  await runner.query(
    "INSERT INTO access_attempt(id,site_id,gate_id,operator_id,direction,method,visit_id,identity_status,authorization_status,schedule_status,reason_code,status,expires_at) VALUES($1,$2,'gate-north-01',$3,'IN','QR',$4,'MATCHED','ALLOWED','NOT_APPLICABLE','VISIT_APPROVED','USED',now()+interval '1 hour')",
    [attempt, f.site, f.user, visit],
  );
  await runner.query(
    "INSERT INTO gate_event(id,access_attempt_id,site_id,visit_id,direction,occurred_at,gate_name,idempotency_key,recorded_by) VALUES($1::uuid,$2,$3,$4,'IN','2026-10-22T10:00:00Z','gate-north-01',$1::text,$5)",
    [event, attempt, f.site, visit, f.user],
  );
  const attendees = [
    { memberId: randomUUID(), fullName: 'Synthetic', identityNumber: '000000000001' },
  ];
  await runner.query(
    "INSERT INTO visitor_gate_event(id,visit_id,operator_user_id,gate_id,direction,count,attendees,request_hash,created_at) VALUES($1,$2,$3,'gate-north-01','IN',1,$4,repeat('b',64),'2026-10-22T09:59:59.123456Z')",
    [event, visit, f.user, JSON.stringify(attendees)],
  );
  return { ...f, event, visit, attendees };
}

test('historical visitor roster migration still refuses a lossy downgrade on its predecessor schema', async () => {
  await predecessor(async (source, runner) => {
    await visitorFixture(runner);
    await runner.query('SAVEPOINT historical_downgrade');
    await assert.rejects(
      migration(source, 'VisitorRoster1792022400000').down(runner),
      /Visitor identity history/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT historical_downgrade');
    assert.equal(await runner.hasColumn('visitor_gate_event', 'attendees'), true);
  });
});

test('visitor merge preserves the common event ID, original timestamps, attendee data, operator and fingerprint', async () => {
  await predecessor(async (source, runner) => {
    const f = await visitorFixture(runner);
    await migration(source, 'MergeVisitorGateEvents1794960000003').up(runner);
    const [row] = await runner.query(
      "SELECT id,recorded_by,count,attendees,request_hash,visitor_event_created_at='2026-10-22T09:59:59.123456Z'::timestamptz AS exact_legacy_time,occurred_at='2026-10-22T10:00:00Z'::timestamptz AS exact_passage_time FROM gate_event WHERE id=$1",
      [f.event],
    );
    assert.deepEqual(row, {
      id: f.event,
      recorded_by: f.user,
      count: 1,
      attendees: f.attendees,
      request_hash: 'b'.repeat(64),
      exact_legacy_time: true,
      exact_passage_time: true,
    });
    assert.equal(await runner.hasTable('visitor_gate_event'), false);
    await runner.query('SAVEPOINT invalid_count');
    await assert.rejects(runner.query('UPDATE gate_event SET count=0 WHERE id=$1', [f.event]));
    await runner.query('ROLLBACK TO SAVEPOINT invalid_count');
    await assert.rejects(
      migration(source, 'MergeVisitorGateEvents1794960000003').down(runner),
      /restore.*backup/i,
    );
  });
});

for (const variant of [
  'missing',
  'missing-legacy',
  'direction',
  'operator',
  'gate',
  'unverified',
] as const) {
  test(`visitor merge refuses a ${variant} common-event conflict and preserves source data`, async () => {
    await predecessor(async (source, runner) => {
      const f = await visitorFixture(runner);
      if (variant === 'missing')
        await runner.query('DELETE FROM gate_event WHERE id=$1', [f.event]);
      else if (variant === 'missing-legacy')
        await runner.query('DELETE FROM visitor_gate_event WHERE id=$1', [f.event]);
      else if (variant === 'direction')
        await runner.query("UPDATE gate_event SET direction='OUT' WHERE id=$1", [f.event]);
      else if (variant === 'operator')
        await runner.query('UPDATE gate_event SET recorded_by=NULL WHERE id=$1', [f.event]);
      else if (variant === 'unverified')
        await runner.query("UPDATE access_attempt SET status='READY'");
      else
        await runner.query("UPDATE gate_event SET gate_name='gate-west-02' WHERE id=$1", [f.event]);
      await runner.query('SAVEPOINT refusal');
      await assert.rejects(
        migration(source, 'MergeVisitorGateEvents1794960000003').up(runner),
        /visitor.*reconcil/i,
      );
      await runner.query('ROLLBACK TO SAVEPOINT refusal');
      assert.equal(await runner.hasColumn('gate_event', 'count'), false);
      assert.equal(
        (await runner.query('SELECT count(*)::int AS n FROM visitor_gate_event'))[0].n,
        variant === 'missing-legacy' ? 0 : 1,
      );
    });
  });
}

test('normal upgrade rolls every cleanup back for an unexpected dependency, then preserves synthetic history after reconciliation', async () => {
  await predecessor(async (source, runner) => {
    const f = await visitorFixture(runner);
    await runner.query(
      "INSERT INTO timesheet(id,site_id,worker_id,period_start,period_end,total_minutes,status,attendance_day_id) VALUES($1,$2,$3,'2026-10-22','2026-10-22',120,'APPROVED',$4)",
      [randomUUID(), f.site, f.worker, f.day],
    );
    await runner.query(
      "INSERT INTO worker_gate_permission(id,worker_id,site_id,gate_id,valid_from,created_by_user_id) VALUES($1,$2,$3,'gate-north-01',now(),$4)",
      [randomUUID(), f.worker, f.site, f.user],
    );
    await runner.query('CREATE VIEW external_legacy_dependency AS SELECT id FROM attendance_pair');
    await runner.query(
      'CREATE TABLE migrations(id serial PRIMARY KEY,timestamp bigint NOT NULL,name varchar NOT NULL)',
    );
    const previous = source.migrations.filter((m) => Number(nameOf(m).slice(-13)) < cutoff);
    for (const value of previous)
      await runner.query('INSERT INTO migrations(timestamp,name) VALUES($1,$2)', [
        Number(nameOf(value).slice(-13)),
        nameOf(value),
      ]);
    await runner.commitTransaction();

    await assert.rejects(source.runMigrations(), /depend|cannot drop/i);
    for (const table of retired) assert.equal(await runner.hasTable(table), true, table);
    assert.equal(await runner.hasColumn('worker_site_zone_assignment', 'gate_id'), true);
    assert.equal(await runner.hasColumn('gate_event', 'count'), false);
    assert.equal(
      (await runner.query('SELECT count(*)::int AS n FROM migrations'))[0].n,
      previous.length,
    );
    assert.equal(
      (await runner.query('SELECT count(*)::int AS n FROM worker_gate_permission'))[0].n,
      1,
    );

    await runner.query('DROP VIEW external_legacy_dependency');
    assert.deepEqual(
      (await source.runMigrations()).map(({ name }) => name),
      [
        'RetireGatePermissions1794960000000',
        'RetireLegacyAttendance1794960000001',
        'RetireTimesheetReplica1794960000002',
        'MergeVisitorGateEvents1794960000003',
        'InstallAuthorityJournal1795046400000',
        'InstallAuthorityCutover1795046400001',
      ],
    );
    for (const table of retired) assert.equal(await runner.hasTable(table), false, table);
    assert.equal(
      (await runner.query('SELECT confirmed_minutes FROM attendance_day WHERE id=$1', [f.day]))[0]
        .confirmed_minutes,
      120,
    );
    assert.deepEqual(
      (
        await runner.query(
          'SELECT id,count,attendees,request_hash,recorded_by FROM gate_event WHERE id=$1',
          [f.event],
        )
      )[0],
      {
        id: f.event,
        count: 1,
        attendees: f.attendees,
        request_hash: 'b'.repeat(64),
        recorded_by: f.user,
      },
    );
    assert.equal((await source.runMigrations()).length, 0);
  });
});
