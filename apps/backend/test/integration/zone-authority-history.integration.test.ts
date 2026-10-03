import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, type MigrationInterface } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const migrationName = 'ZoneAuthorityHistory1791417600000';
const digest = 'a'.repeat(64);
const from = '2026-10-04T08:00:00Z';

async function isolated<T>(
  legacy: boolean,
  run: (db: DataSource, migrations: MigrationInterface[]) => Promise<T>,
): Promise<T> {
  const schema = `zone_authority_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const control = new DataSource(options);
  const db = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  await control.initialize();
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    await db.initialize();
    const registered = [...db.migrations];
    if (legacy)
      db.migrations.splice(
        0,
        db.migrations.length,
        ...registered.filter((m) => m.name !== migrationName),
      );
    await db.runMigrations();
    return await run(db, registered);
  } finally {
    if (db.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.destroy();
  }
}

function sqlState(code: string) {
  return (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function fixture(db: DataSource) {
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const zoneId = randomUUID();
  const workerId = randomUUID();
  const contractorId = randomUUID();
  const userId = randomUUID();
  for (const id of [siteId, otherSiteId])
    await db.query('INSERT INTO site(id,code,name) VALUES ($1,$1::uuid::text,$1::uuid::text)', [
      id,
    ]);
  await db.query('INSERT INTO contractor(id,code,name) VALUES ($1,$1::uuid::text,$1::uuid::text)', [
    contractorId,
  ]);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES ($1,$1::uuid::text,$1::uuid::text,'synthetic-not-a-login')",
    [userId],
  );
  await db.query(
    'INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES ($1,$2,$3,$1::uuid::text,$1::uuid::text)',
    [workerId, siteId, contractorId],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES ($1,$2,$1::uuid::text,$1::uuid::text,'RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  return { siteId, otherSiteId, zoneId, workerId, contractorId, userId };
}

async function command(db: DataSource) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO zone_authority_command(command_id,operation,actor_kind,service_subject,request_hash) VALUES ($1,'TEST_FACT','SERVICE','synthetic-test',$2)",
    [id, digest],
  );
  return id;
}

test('authority schema is registered on fresh migration without creating grants, history or ready epochs', async () => {
  await isolated(false, async (db) => {
    assert(db.migrations.some((m) => m.name === migrationName));
    const runner = db.createQueryRunner();
    try {
      for (const table of [
        'contractor_zone_access_grant',
        'zone_authority_command',
        'zone_authority_fact_revision',
        'zone_authority_history_epoch',
      ]) {
        assert.equal(await runner.hasTable(table), true, table);
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
        const metadata = db.entityMetadatas.find((m) => m.tableName === table);
        const physical = await runner.getTable(table);
        assert(metadata, `${table} entity missing`);
        assert(physical);
        assert.deepEqual(
          physical.columns.map((c) => [c.name, c.isNullable]).sort(),
          metadata.columns.map((c) => [c.databaseName, c.isNullable]).sort(),
        );
        assert.deepEqual(
          physical.foreignKeys.map((fk) => fk.name).sort(),
          metadata.foreignKeys.map((fk) => fk.name).sort(),
        );
        assert.deepEqual(
          physical.checks.map((c) => c.name).sort(),
          metadata.checks.map((c) => c.name).sort(),
        );
      }
      assert.equal(await runner.hasColumn('worker_site_zone_assignment', 'contractor_id'), true);
      assert.equal(await runner.hasColumn('zone_access_grant', 'contractor_id'), true);
      assert.equal((await db.runMigrations()).length, 0);
    } finally {
      await runner.release();
    }
  });
});

test('upgrade preserves legacy grants and assignments without inventing Contractor anchors or history', async () => {
  await isolated(true, async (db, registered) => {
    assert.equal(db.migrations.length, 22);
    const f = await fixture(db);
    const grantId = randomUUID();
    const assignmentId = randomUUID();
    await db.query(
      "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from) VALUES ($1,$2,$3,$4,'ALLOW',$5)",
      [grantId, f.siteId, f.zoneId, f.workerId, from],
    );
    await db.query(
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,zone_ids,status,valid_from,requested_by_user_id) VALUES ($1,$2,$3,$4,'APPROVED',$5,$6)",
      [assignmentId, f.workerId, f.siteId, [f.zoneId], from, f.userId],
    );
    const migration = registered.find((m) => m.name === migrationName);
    assert(migration, 'Authority migration must be registered');
    db.migrations.push(migration);
    assert.equal((await db.runMigrations()).length, 1);
    for (const [table, id] of [
      ['zone_access_grant', grantId],
      ['worker_site_zone_assignment', assignmentId],
    ]) {
      const rows = await db.query(`SELECT contractor_id FROM ${table} WHERE id=$1`, [id]);
      assert.deepEqual(rows, [{ contractor_id: null }]);
    }
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_fact_revision'))[0].n,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM contractor_zone_access_grant'))[0].n,
      0,
    );
    await db.undoLastMigration();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_access_grant'))[0].n, 1);
    assert.equal((await db.runMigrations()).length, 1);
  });
});

test('Contractor grants reject wrong Site, malformed effect and empty interval in PostgreSQL', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    const insert = (siteId: string, effect: string, until: string | null) =>
      db.query(
        'INSERT INTO contractor_zone_access_grant(id,site_id,zone_id,contractor_id,effect,valid_from,valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), siteId, f.zoneId, f.contractorId, effect, from, until],
      );
    await assert.rejects(insert(f.otherSiteId, 'ALLOW', null), sqlState('23503'));
    await assert.rejects(insert(f.siteId, 'UNKNOWN', null), sqlState('23514'));
    await assert.rejects(insert(f.siteId, 'ALLOW', from), sqlState('23514'));
    await insert(f.siteId, 'DENY', null);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM contractor_zone_access_grant'))[0].n,
      1,
    );
  });
});

test('authority command requires one actor, valid hash and immutable attribution', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    const insert = (kind: string, actor: string | null, service: string | null, hash = digest) =>
      db.query(
        "INSERT INTO zone_authority_command(command_id,operation,actor_kind,actor_user_id,service_subject,request_hash) VALUES ($1,'TEST_FACT',$2,$3,$4,$5)",
        [randomUUID(), kind, actor, service, hash],
      );
    await assert.rejects(insert('USER', null, null), sqlState('23514'));
    await assert.rejects(insert('SERVICE', f.userId, 'test'), sqlState('23514'));
    await assert.rejects(insert('SERVICE', null, 'test', 'BAD'), sqlState('23514'));
    await insert('USER', f.userId, null);
    const id = await command(db);
    for (const sql of [
      'UPDATE zone_authority_command SET operation=operation WHERE command_id=$1',
      'DELETE FROM zone_authority_command WHERE command_id=$1',
    ])
      await assert.rejects(db.query(sql, [id]), sqlState('23514'));
    await assert.rejects(db.query('TRUNCATE zone_authority_command CASCADE'), sqlState('23514'));
  });
});

test('facts enforce scope, revision, command binding, finite intervals and bounded object payload', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    const id = await command(db);
    const insert = (
      revision: string,
      site: string | null,
      payload: unknown,
      end: string | null = null,
    ) =>
      db.query(
        "INSERT INTO zone_authority_fact_revision(id,source_id,command_id,source_kind,revision,site_id,effective_from,effective_to,payload) VALUES ($1,$2,$3,'WORKER_MEMBERSHIP',$4,$5,$6,$7,$8)",
        [randomUUID(), f.workerId, id, revision, site, from, end, JSON.stringify(payload)],
      );
    await assert.rejects(insert('0', f.siteId, {}), sqlState('23514'));
    await assert.rejects(insert('1', null, {}), sqlState('23514'));
    await assert.rejects(insert('1', f.siteId, []), sqlState('23514'));
    await assert.rejects(insert('1', f.siteId, { large: 'x'.repeat(17000) }), sqlState('23514'));
    await assert.rejects(insert('1', f.siteId, {}, from), sqlState('23514'));
    await assert.rejects(insert('1', f.siteId, {}, 'infinity'), sqlState('23514'));
    await insert('1', f.siteId, { workerId: f.workerId });
    await assert.rejects(insert('1', f.siteId, {}), sqlState('23505'));
    await assert.rejects(db.query('DELETE FROM zone_authority_fact_revision'), sqlState('23514'));
    await assert.rejects(
      db.query('UPDATE zone_authority_fact_revision SET revision=2'),
      sqlState('23514'),
    );
    await assert.rejects(db.query('TRUNCATE zone_authority_fact_revision'), sqlState('23514'));
    assert.equal(
      (await db.query('SELECT revision FROM zone_authority_fact_revision'))[0].revision,
      '1',
    );
  });
});

test('epoch starts OFF and populated authority audit refuses downgrade without partial schema loss', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    await db.query(
      'INSERT INTO zone_authority_history_epoch(site_id,started_at,writer_manifest_hash) VALUES ($1,$2,$3)',
      [f.siteId, from, digest],
    );
    assert.deepEqual(await db.query('SELECT readiness FROM zone_authority_history_epoch'), [
      { readiness: 'OFF' },
    ]);
    await assert.rejects(db.undoLastMigration(), /Refusing to revert populated Zone authority/);
    const runner = db.createQueryRunner();
    try {
      assert.equal(await runner.hasTable('zone_authority_fact_revision'), true);
      assert.equal(await runner.hasColumn('zone_access_grant', 'contractor_id'), true);
    } finally {
      await runner.release();
    }
    assert.equal(
      (await db.query('SELECT readiness FROM zone_authority_history_epoch'))[0].readiness,
      'OFF',
    );
  });
});

test('Contractor anchors remain immutable while status and revocation updates retain legacy compatibility', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    const grantId = randomUUID();
    const assignmentId = randomUUID();
    await db.query(
      "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,contractor_id,effect,valid_from) VALUES ($1,$2,$3,$4,$5,'ALLOW',$6)",
      [grantId, f.siteId, f.zoneId, f.workerId, f.contractorId, from],
    );
    await db.query(
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,contractor_id,zone_ids,status,valid_from,requested_by_user_id) VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7)",
      [assignmentId, f.workerId, f.siteId, f.contractorId, [f.zoneId], from, f.userId],
    );
    await db.query('UPDATE zone_access_grant SET revoked_at=$1 WHERE id=$2', [from, grantId]);
    await db.query("UPDATE worker_site_zone_assignment SET status='SAFETY_REVIEWED' WHERE id=$1", [
      assignmentId,
    ]);
    for (const [table, id] of [
      ['zone_access_grant', grantId],
      ['worker_site_zone_assignment', assignmentId],
    ]) {
      await assert.rejects(
        db.query(`UPDATE ${table} SET contractor_id=NULL WHERE id=$1`, [id]),
        sqlState('23514'),
      );
      assert.deepEqual(await db.query(`SELECT contractor_id FROM ${table} WHERE id=$1`, [id]), [
        { contractor_id: f.contractorId },
      ]);
    }
    // These anchors alone are new information even when no history rows exist.
    await assert.rejects(db.undoLastMigration(), /Refusing to revert populated Zone authority/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 0);
    assert.equal(
      (await db.query('SELECT status FROM worker_site_zone_assignment'))[0].status,
      'SAFETY_REVIEWED',
    );
  });
});

test('failed fact transaction rolls back its command, and committed command prevents data-losing downgrade', async () => {
  await isolated(false, async (db) => {
    const f = await fixture(db);
    await assert.rejects(
      db.transaction(async (manager) => {
        const id = randomUUID();
        await manager.query(
          "INSERT INTO zone_authority_command(command_id,operation,actor_kind,service_subject,request_hash) VALUES ($1,'TEST_FACT','SERVICE','synthetic-test',$2)",
          [id, digest],
        );
        await manager.query(
          "INSERT INTO zone_authority_fact_revision(id,source_id,command_id,source_kind,revision,site_id,effective_from,payload) VALUES ($1,$2,$3,'WORKER_MEMBERSHIP',0,$4,$5,'{}')",
          [randomUUID(), f.workerId, id, f.siteId, from],
        );
      }),
      sqlState('23514'),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 0);
    const id = await command(db);
    await assert.rejects(db.undoLastMigration(), /Refusing to revert populated Zone authority/);
    assert.deepEqual(await db.query('SELECT command_id FROM zone_authority_command'), [
      { command_id: id },
    ]);
  });
});

test('empty audit permits parent cleanup, but populated audit blocks cascading truncate without loss', async () => {
  await isolated(false, async (db) => {
    await db.query('TRUNCATE app_user CASCADE');
    const id = await command(db);
    await assert.rejects(db.query('TRUNCATE app_user CASCADE'), sqlState('23514'));
    assert.deepEqual(await db.query('SELECT command_id FROM zone_authority_command'), [
      { command_id: id },
    ]);
  });
});
