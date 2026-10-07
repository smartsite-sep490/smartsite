import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('ERD migrations preserve legacy visitor counts, revoke old QR and refuse a lossy downgrade', async () => {
  const schema = `erd_upgrade_${randomUUID().replaceAll('-', '')}`;
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
    const baseline = migrations.filter((m) => !(m.name ?? m.constructor.name).startsWith('Erd'));
    const access = migrations.filter((m) => (m.name ?? m.constructor.name).startsWith('Erd'));
    for (const migration of baseline) await migration.up(runner);
    for (const migration of access) await migration.up(runner);
    for (const migration of [...access].reverse()) await migration.down(runner);
    const siteId = randomUUID(),
      userId = randomUUID(),
      visitId = randomUUID(),
      qrId = randomUUID();
    await runner.query("INSERT INTO site(id,code,name) VALUES($1,$2,'Synthetic legacy Site')", [
      siteId,
      siteId,
    ]);
    await runner.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,'Synthetic manager','synthetic-not-login',false)",
      [userId, userId],
    );
    await runner.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
      [randomUUID(), userId, siteId],
    );
    await runner.query(
      "INSERT INTO visitor_visit(id,site_id,access_key_hash,visitor_name,company,contact,host_name,purpose,target_area,group_size,gate_id,valid_from,valid_until,entered_count) VALUES($1,$2,$3,'Synthetic representative','Synthetic group','example.test','Synthetic host','Tour','Office',20,'gate-north-01',now(),now()+interval '1 hour',18)",
      [visitId, siteId, 'a'.repeat(64)],
    );
    await runner.query(
      "INSERT INTO qr_credential(id,token_hash,visit_id,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
      [qrId, 'b'.repeat(64), visitId],
    );
    for (const migration of access) await migration.up(runner);
    const visits = (await runner.query(
      'SELECT representative_visitor_id,site_manager_id,entered_count,exited_count FROM visitor_visit WHERE id=$1',
      [visitId],
    )) as Array<{
      representative_visitor_id: string;
      site_manager_id: string;
      entered_count: number;
      exited_count: number;
    }>;
    assert.deepEqual(visits, [
      {
        representative_visitor_id: visitId,
        site_manager_id: userId,
        entered_count: 18,
        exited_count: 0,
      },
    ]);
    const qr = (await runner.query(
      'SELECT site_id,direction,revoked_at FROM qr_credential WHERE id=$1',
      [qrId],
    )) as Array<{ site_id: string; direction: string; revoked_at: Date }>;
    assert.equal(qr[0]?.site_id, siteId);
    assert.equal(qr[0]?.direction, 'IN');
    assert.ok(qr[0]?.revoked_at);
    await runner.query(
      "UPDATE visitor_visit SET entered_count=40,exited_count=20,status='EXPIRED' WHERE id=$1",
      [visitId],
    );
    await runner.query('SAVEPOINT downgrade_check');
    await assert.rejects(access[0]!.down(runner), /downgrade refused/);
    await runner.query('ROLLBACK TO SAVEPOINT downgrade_check');
    assert.equal(await runner.hasColumn('visitor_visit', 'representative_visitor_id'), true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
