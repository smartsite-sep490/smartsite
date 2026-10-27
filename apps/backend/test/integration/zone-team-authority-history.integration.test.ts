import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ZoneTeamAuthorityHistory1792886400000 } from '../../src/database/migrations/1792886400000-ZoneTeamAuthorityHistory.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
const actor = randomUUID(),
  site = randomUUID(),
  contractor = randomUUID(),
  team = randomUUID();
const migration = new ZoneTeamAuthorityHistory1792886400000();
let originalRegistry: unknown;
let commandTable: 'mf06_authority_command' | 'authorization_history_command';
let registryTable: 'mf06_authority_source' | 'authorization_history_source';
async function migrate(direction: 'up' | 'down') {
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await migration[direction](runner);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
before(async () => {
  await database.initialize();
  const namespaces: { name: string }[] = await db.query(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r'
    AND c.relname IN ('mf06_authority_command','authorization_history_command')`);
  assert.equal(namespaces.length, 1, 'Exactly one qualified command namespace is required');
  commandTable = namespaces[0]!.name as typeof commandTable;
  registryTable =
    commandTable === 'authorization_history_command'
      ? 'authorization_history_source'
      : 'mf06_authority_source';
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic','unusable',true,false)",
    [actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic')", [site]);
  await db.query("INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic')", [
    contractor,
  ]);
  await db.query(
    "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'Synthetic','synthetic',$4)",
    [team, site, contractor, actor],
  );
  originalRegistry = await db.query(`SELECT * FROM ${registryTable} ORDER BY source_kind`);
  await migrate('up');
});
after(async () => {
  await database.dispose();
});

test('new journal references the qualified command table without reviving a legacy namespace', async () => {
  const references: { target: string; same_target: boolean }[] = await db.query(
    `SELECT parent.relname AS target,k.confrelid=to_regclass($1) AS same_target
     FROM pg_constraint k JOIN pg_class parent ON parent.oid=k.confrelid
     WHERE k.conrelid='zone_team_authority_revision'::regclass AND k.contype='f'`,
    [commandTable],
  );
  assert.deepEqual(references, [{ target: commandTable, same_target: true }]);
  assert.equal(await db.showMigrations(), false);
});

test('V2 capture is additive; revision-zero seed and empty down preserve the installed registry', async () => {
  const [head] = await db.query(
    "SELECT revision::text,after_payload FROM zone_team_authority_head WHERE source_kind='TEAM' AND source_id=$1",
    [team],
  );
  assert.equal(head.revision, '0');
  assert.equal(head.after_payload.is_active, true);
  assert.equal((await db.query('SELECT * FROM zone_team_authority_revision')).length, 0);
  assert.deepEqual(
    await db.query(`SELECT * FROM ${registryTable} ORDER BY source_kind`),
    originalRegistry,
  );
  await migrate('down');
  await migrate('up');
  assert.equal((await db.query('SELECT id FROM contractor_team WHERE id=$1', [team])).length, 1);
});

test('known same-transaction command captures immutable masked before/after and hashes', async () => {
  const command = randomUUID();
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO ${commandTable}(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'TEAM_ARCHIVE',$3)`,
      [command, actor, 'a'.repeat(64)],
    );
    await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [command]);
    await manager.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
  });
  const [fact] = await db.query(
    `SELECT command_id,revision::text,before_payload,after_payload,
    before_hash=encode(sha256(convert_to(before_payload::text,'UTF8')),'hex') AS before_valid,
    after_hash=encode(sha256(convert_to(after_payload::text,'UTF8')),'hex') AS after_valid
    FROM zone_team_authority_revision WHERE source_id=$1`,
    [team],
  );
  assert.equal(fact.command_id, command);
  assert.equal(fact.revision, '1');
  assert.equal(fact.before_payload.is_active, true);
  assert.equal(fact.after_payload.is_active, false);
  assert.deepEqual(Object.keys(fact.after_payload).sort(), [
    'contractor_id',
    'id',
    'is_active',
    'site_id',
  ]);
  assert(fact.before_valid && fact.after_valid);
  assert.equal((await db.query('SELECT * FROM zone_team_authority_gap')).length, 0);
});

test('unattributed source write records a gap without failing the existing business write', async () => {
  await db.query('UPDATE contractor_team SET is_active=true WHERE id=$1', [team]);
  const [gap] = await db.query('SELECT reason FROM zone_team_authority_gap WHERE source_id=$1', [
    team,
  ]);
  assert.equal(gap.reason, 'UNATTRIBUTED_WRITE');
});

test('name/description-only change does not copy text or create an authority revision', async () => {
  const before = await db.query('SELECT count(*)::int AS n FROM zone_team_authority_revision');
  await db.query(
    "UPDATE contractor_team SET name='Private display text',description='Never journal this' WHERE id=$1",
    [team],
  );
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS n FROM zone_team_authority_revision'),
    before,
  );
});

test('rollback removes source change, new revision and gap together', async () => {
  const before = await db.query('SELECT count(*)::int AS n FROM zone_team_authority_revision');
  await assert.rejects(
    db.transaction(async (manager) => {
      await manager.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
      throw Error('Synthetic rollback');
    }),
    /Synthetic rollback/,
  );
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS n FROM zone_team_authority_revision'),
    before,
  );
  const [row] = await db.query('SELECT is_active FROM contractor_team WHERE id=$1', [team]);
  assert(row.is_active);
});

test('direct journal tamper and populated down are refused', async () => {
  for (const sql of [
    'UPDATE zone_team_authority_revision SET revision=revision+1',
    'DELETE FROM zone_team_authority_revision',
    'TRUNCATE zone_team_authority_revision',
    'UPDATE zone_team_authority_head SET revision=revision+1',
  ])
    await assert.rejects(db.query(sql));
  await assert.rejects(migrate('down'), /history must be preserved/);
  assert.deepEqual(
    await db.query(`SELECT * FROM ${registryTable} ORDER BY source_kind`),
    originalRegistry,
  );
});

test('command from an earlier transaction cannot attribute a later team write', async () => {
  const command = randomUUID();
  await db.query(
    `INSERT INTO ${commandTable}(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'TEAM_ARCHIVE',$3)`,
    [command, actor, 'b'.repeat(64)],
  );
  await db.transaction(async (manager) => {
    await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [command]);
    await manager.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
  });
  const [fact] = await db.query(
    'SELECT command_id FROM zone_team_authority_revision WHERE source_id=$1 ORDER BY revision DESC LIMIT 1',
    [team],
  );
  assert.equal(fact.command_id, null);
});

test('new assignment Zone IDs are captured while the installed registry stays unchanged', async () => {
  const worker = randomUUID(),
    zone = randomUUID(),
    assignment = randomUUID();
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name,is_active) VALUES($1,$2,$3,$1::uuid::text,'Synthetic',true)",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,zone_ids,requested_by_user_id,status,valid_from,valid_until) VALUES($1,$2,$3,ARRAY[$4::uuid],$5,'PENDING',now(),now()+interval '1 day')",
    [assignment, worker, site, zone, actor],
  );
  const [fact] = await db.query(
    "SELECT after_payload FROM zone_team_authority_revision WHERE source_kind='ASSIGNMENT' AND source_id=$1",
    [assignment],
  );
  assert.deepEqual(fact.after_payload.zone_ids, [zone]);
  assert.deepEqual(
    await db.query(`SELECT * FROM ${registryTable} ORDER BY source_kind`),
    originalRegistry,
  );
});

test('membership and team permission capture only their frozen business fields', async () => {
  const otherTeam = randomUUID(),
    worker = randomUUID(),
    member = randomUUID();
  const zone = randomUUID(),
    participation = randomUUID(),
    cp = randomUUID(),
    permission = randomUUID();
  const from = new Date(Date.now() - 3600000).toISOString(),
    until = new Date(Date.now() + 3600000).toISOString();
  await db.query(
    "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'Synthetic',$1::uuid::text,$4)",
    [otherTeam, site, contractor, actor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name,is_active) VALUES($1,$2,$3,$1::uuid::text,'Synthetic',true)",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO contractor_team_membership(id,team_id,worker_id,site_id,contractor_id,joined_at,assigned_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'Private note not for history')",
    [member, otherTeam, worker, site, contractor, from, actor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  await db.query(
    'INSERT INTO contractor_site_participation(id,contractor_id,site_id,is_active,valid_from,valid_until) VALUES($1,$2,$3,true,$4,$5)',
    [participation, contractor, site, from, until],
  );
  await db.query(
    'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
    [cp, participation, zone, from, until, actor],
  );
  await db.query(
    'INSERT INTO team_zone_permission(id,team_id,contractor_zone_permission_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
    [permission, otherTeam, cp, from, until, actor],
  );
  const facts = await db.query(
    'SELECT source_kind,after_payload FROM zone_team_authority_revision WHERE source_id=ANY($1::uuid[]) ORDER BY source_kind',
    [[member, permission]],
  );
  assert.deepEqual(
    facts.map((f: { source_kind: string }) => f.source_kind),
    ['TEAM_MEMBERSHIP', 'TEAM_PERMISSION'],
  );
  assert.equal(facts[0].after_payload.worker_id, worker);
  assert.equal(facts[1].after_payload.contractor_zone_permission_id, cp);
  assert(!JSON.stringify(facts).includes('Private note'));
  assert(!('assigned_by' in facts[0].after_payload));
  assert(!('granted_by' in facts[1].after_payload));
});
