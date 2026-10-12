import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { OptionalPasswordChange1791676800002 } from '../../src/database/migrations/1791676800002-OptionalPasswordChange.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('optional password migration clears legacy requirements, preserves passwords/status and changes the default', async () => {
  const source = new DataSource(buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() }));
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const schema = `optional_password_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(`CREATE TABLE app_user (id uuid PRIMARY KEY, password_hash text NOT NULL,
      is_active boolean NOT NULL, must_change_password boolean NOT NULL DEFAULT TRUE)`);
    const active = randomUUID(),
      disabled = randomUUID(),
      existing = randomUUID(),
      fresh = randomUUID();
    await runner.query(
      `INSERT INTO app_user VALUES ($1,'synthetic-active-hash',true,true),
      ($2,'synthetic-disabled-hash',false,true),($3,'synthetic-existing-hash',true,false)`,
      [active, disabled, existing],
    );
    const migration = new OptionalPasswordChange1791676800002();
    await migration.up(runner);
    const rows = await runner.query('SELECT * FROM app_user');
    assert.equal(rows.length, 3);
    assert.ok(
      rows.every((row: { must_change_password: boolean }) => row.must_change_password === false),
    );
    assert.equal(
      rows.find((row: { id: string }) => row.id === active).password_hash,
      'synthetic-active-hash',
    );
    assert.equal(rows.find((row: { id: string }) => row.id === disabled).is_active, false);
    await runner.query(
      "INSERT INTO app_user(id,password_hash,is_active) VALUES($1,'synthetic-new-hash',true)",
      [fresh],
    );
    assert.equal(
      (await runner.query('SELECT must_change_password FROM app_user WHERE id=$1', [fresh]))[0]
        .must_change_password,
      false,
    );
    await migration.down(runner);
    assert.equal(
      (await runner.query('SELECT COUNT(*)::int AS n FROM app_user WHERE must_change_password'))[0]
        .n,
      0,
    );
    await migration.up(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
