import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
test('MF03 migration preserves legacy multiple shifts, blocks new conflicts and refuses lossy downgrade', async () => {
  const schema = `mf03_upgrade_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('PostgreSQL required');
  const source = new DataSource({ ...options, schema });
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    const migrations = [...source.migrations].sort(
      (a, b) =>
        Number((a.name ?? a.constructor.name).slice(-13)) -
        Number((b.name ?? b.constructor.name).slice(-13)),
    );
    const mf03Migrations = migrations.filter((m) => (m.name ?? '').startsWith('Mf03'));
    const mf03 = mf03Migrations[0]!;
    for (const migration of migrations.filter(
      (m) =>
        !mf03Migrations.includes(m) &&
        ![
          'ShiftBreak1791763200001',
          'GateScheduleDenial1791849600000',
          'AttendanceAbsence1792022400000',
        ].includes(m.name ?? ''),
    ))
      await migration.up(runner);
    const site = randomUUID(),
      worker = randomUUID(),
      version = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    await runner.query(
      "INSERT INTO site(id,code,name)VALUES($1::uuid,$1::text,'Synthetic legacy')",
      [site],
    );
    await runner.query(
      "INSERT INTO worker(id,site_id,external_id,display_name)VALUES($1::uuid,$2,$1::text,'Synthetic Worker')",
      [worker, site],
    );
    await runner.query(
      "INSERT INTO schedule_version(id,site_id,version,effective_from)VALUES($1,$2,1,'2026-01-01')",
      [version, site],
    );
    for (const id of [first, second]) {
      await runner.query(
        "INSERT INTO shift(id,site_id,name,starts_at,ends_at,timezone)VALUES($1,$2,'Synthetic shift','2026-10-08T08:00:00Z','2026-10-08T17:00:00Z','UTC')",
        [id, site],
      );
      await runner.query(
        "INSERT INTO worker_schedule(id,site_id,worker_id,shift_id,schedule_version_id,work_date,is_active)VALUES($1,$2,$3,$4,$5,'2026-10-08',true)",
        [randomUUID(), site, worker, id, version],
      );
    }
    for (const migration of mf03Migrations) await migration.up(runner);
    const duplicateMigration = mf03Migrations.at(-1)!;
    await duplicateMigration.down(runner);
    assert.equal(await runner.hasColumn('attendance_session', 'ignore_reason'), false);
    await duplicateMigration.up(runner);
    const reviewer = randomUUID(),
      duplicateEvent = randomUUID();
    await runner.query(
      "INSERT INTO app_user(id,username,display_name,password_hash)VALUES($1::uuid,$1::text,'Synthetic reviewer','synthetic-not-login')",
      [reviewer],
    );
    await runner.query(
      "INSERT INTO attendance_event(id,site_id,worker_id,kind,method,occurred_at,reason_code)VALUES($1,$2,$3,'CHECK_IN','FACE',now(),'NORMAL_CHECK_IN')",
      [duplicateEvent, site, worker],
    );
    await runner.query(
      "INSERT INTO attendance_session(id,site_id,worker_id,check_in_event_id,effective_out_at,status,ignored_by,ignored_at,ignore_reason)VALUES($1,$2,$3,$4,now(),'IGNORED',$5,now(),'Verified duplicate')",
      [randomUUID(), site, worker, duplicateEvent, reviewer],
    );
    await runner.query('SAVEPOINT ignored_downgrade');
    await assert.rejects(duplicateMigration.down(runner), /review history must be preserved/);
    await runner.query('ROLLBACK TO SAVEPOINT ignored_downgrade');
    assert.equal(
      (await runner.query('SELECT COUNT(*)::int AS n FROM attendance_schedule_conflict'))[0].n,
      2,
    );
    assert.equal(
      (await runner.query('SELECT COUNT(*)::int AS n FROM worker_schedule WHERE is_active'))[0].n,
      2,
    );
    await runner.query('SAVEPOINT conflicting_shift');
    await assert.rejects(
      runner.query(
        "INSERT INTO worker_schedule(id,site_id,worker_id,shift_id,schedule_version_id,work_date,is_active)VALUES($1,$2,$3,$4,$5,'2026-10-08',true)",
        [randomUUID(), site, worker, first, version],
      ),
    );
    await runner.query('ROLLBACK TO SAVEPOINT conflicting_shift');
    await runner.query(
      "INSERT INTO attendance_day(id,site_id,worker_id,work_date,timezone,status)VALUES($1,$2,$3,'2026-10-08','UTC','NEEDS_REVIEW')",
      [randomUUID(), site, worker],
    );
    await runner.query('SAVEPOINT downgrade');
    await assert.rejects(mf03.down(runner), /downgrade refused/);
    await runner.query('ROLLBACK TO SAVEPOINT downgrade');
    assert.equal(await runner.hasTable('attendance_day'), true);
    const shiftBreak = migrations.find((m) => m.name === 'ShiftBreak1791763200001')!;
    await shiftBreak.up(runner);
    assert.equal(
      (await runner.query('SELECT break_starts_at FROM shift WHERE id=$1', [first]))[0]
        .break_starts_at,
      null,
    );
    assert.equal(
      (await runner.query('SELECT break_starts_at FROM attendance_day'))[0].break_starts_at,
      null,
    );
    await runner.query('SAVEPOINT invalid_break');
    await assert.rejects(
      runner.query("UPDATE shift SET break_starts_at='2026-10-08T12:00:00Z' WHERE id=$1", [first]),
    );
    await runner.query('ROLLBACK TO SAVEPOINT invalid_break');
    await runner.query(
      "UPDATE shift SET break_starts_at='2026-10-08T12:00:00Z', break_ends_at='2026-10-08T13:00:00Z' WHERE id=$1",
      [first],
    );
    await runner.query('SAVEPOINT break_downgrade');
    await assert.rejects(shiftBreak.down(runner), /cannot be discarded/);
    await runner.query('ROLLBACK TO SAVEPOINT break_downgrade');
    const denialMigration = migrations.find((m) => m.name === 'GateScheduleDenial1791849600000')!;
    await denialMigration.up(runner);
    const denialContractor = randomUUID();
    await runner.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$2,'Synthetic denial contractor')",
      [denialContractor, denialContractor],
    );
    await runner.query(
      "INSERT INTO user_notification(id,recipient_user_id,site_id,worker_id,recipient_role,request_type,request_id,event,content,contractor_id) VALUES($1,$2,$3,$4,'WORKER','ATTENDANCE',$5,'ENTRY_DENIED_NO_SCHEDULE','{}',$6)",
      [randomUUID(), reviewer, site, worker, randomUUID(), denialContractor],
    );
    await runner.query('SAVEPOINT denial_downgrade');
    await assert.rejects(denialMigration.down(runner), /history must be preserved/);
    await runner.query('ROLLBACK TO SAVEPOINT denial_downgrade');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
