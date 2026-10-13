import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import dataSource from '../support/test-data-source.js';
import { ContractorTeams1791676800004 } from '../../src/database/migrations/1791676800004-ContractorTeams.js';
test('team migration preserves applied history, conflicts unbound pending swaps and refuses lossy downgrade', async () => {
  await dataSource.initialize();
  const r = dataSource.createQueryRunner();
  await r.connect();
  await r.startTransaction();
  try {
    const schema = `team_migration_${randomUUID().replaceAll('-', '')}`;
    await r.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},public;
      CREATE TABLE site(id uuid PRIMARY KEY);CREATE TABLE contractor(id uuid PRIMARY KEY);CREATE TABLE app_user(id uuid PRIMARY KEY);
      CREATE TABLE worker(id uuid PRIMARY KEY,site_id uuid NOT NULL,contractor_id uuid,is_active boolean NOT NULL);
      CREATE TABLE shift_swap_request(id uuid PRIMARY KEY,status varchar(24) NOT NULL,review_reason varchar(1000));`);
    const pending = randomUUID(),
      applied = randomUUID();
    await r.query(
      `INSERT INTO shift_swap_request(id,status) VALUES($1,'PENDING_COWORKER'),($2,'APPLIED')`,
      [pending, applied],
    );
    const migration = new ContractorTeams1791676800004();
    await migration.up(r);
    assert.equal(
      (await r.query('SELECT status FROM shift_swap_request WHERE id=$1', [pending]))[0].status,
      'CONFLICTED',
    );
    assert.equal(
      (await r.query('SELECT status FROM shift_swap_request WHERE id=$1', [applied]))[0].status,
      'APPLIED',
    );
    assert.equal((await r.query('SELECT count(*) FROM contractor_team'))[0].count, '0');
    assert.equal((await r.query('SELECT count(*) FROM contractor_team_membership'))[0].count, '0');
    await migration.down(r);
    await migration.up(r);
    const site = randomUUID(),
      contractor = randomUUID(),
      user = randomUUID(),
      team = randomUUID();
    await r.query('INSERT INTO site VALUES($1)', [site]);
    await r.query('INSERT INTO contractor VALUES($1)', [contractor]);
    await r.query('INSERT INTO app_user VALUES($1)', [user]);
    await r.query(
      `INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'History','history',$4)`,
      [team, site, contractor, user],
    );
    await r.query('SAVEPOINT before_down');
    await assert.rejects(migration.down(r), /history must be preserved/);
    await r.query('ROLLBACK TO SAVEPOINT before_down');
    assert.equal((await r.query('SELECT count(*) FROM contractor_team'))[0].count, '1');
  } finally {
    await r.rollbackTransaction();
    await r.release();
    await dataSource.destroy();
  }
});
