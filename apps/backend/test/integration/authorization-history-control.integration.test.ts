import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import {
  MainAuthorityBaselineService,
  type MainAuthorityBaselineRecord,
} from '../../src/modules/zones/main-authority-baseline.service.js';
import { AuthorizationHistoryCutover1793059200000 } from '../../src/database/migrations/1793059200000-AuthorizationHistoryCutover.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import type { EntityManager } from 'typeorm';
import { hasNamedV2AuthorityCutoverPredecessor } from '../../src/common/configuration/authorization-history-cutover-predecessor-v1.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
const preparedBaselines: MainAuthorityBaselineRecord[] = [];
before(async () => {
  console.log(`ownedAuthorityControlSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
  const first = await baseline(),
    second = await baseline();
  preparedBaselines.push(first, second);
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await new AuthorizationHistoryCutover1793059200000().up(runner);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});
after(() => owned.dispose());

const refused = (error: unknown) =>
  (error as { driverError?: { code?: string } }).driverError?.code === '23514';

async function baseline() {
  if (preparedBaselines.length) return preparedBaselines.shift()!;
  const actor = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic cutover Admin','not-a-password',false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  return new MainAuthorityBaselineService(db).capture(
    { actorUserId: actor, reauthorize: async () => {} },
    'b'.repeat(64),
  );
}

let commandActor: string | undefined;
async function controlledCommand(work?: (manager: EntityManager, epoch: string) => Promise<void>) {
  const actor = commandActor ?? randomUUID(),
    epoch = randomUUID();
  if (!commandActor) {
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic cutover Admin','not-a-password',false)",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
      [randomUUID(), actor],
    );
    commandActor = actor;
  }
  await executeMainConfigurationCommand(
    db,
    { actorUserId: actor, reauthorize: async () => {} },
    'MAIN_AUTHORITY_BASELINE',
    { epochId: epoch, declaredWriterManifestHash: 'b'.repeat(64) },
    async (manager) => {
      await manager.query(
        'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
        [epoch, 'b'.repeat(64)],
      );
      await manager.query(
        "INSERT INTO authorization_history_baseline(epoch_id,command_id) VALUES($1,current_setting('smartsite.mf06_command_id')::uuid)",
        [epoch],
      );
      if (work) await work(manager, epoch);
      else
        await manager.query(
          'UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1',
          [epoch],
        );
    },
  );
  return epoch;
}

test('Authority control refuses a previously committed STAGING baseline without a controlled cutover', async () => {
  const saved = await baseline();
  assert.equal(saved.state, 'STAGING');
  const beforePointer = await db.query('SELECT * FROM authorization_history_control');
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await assert.rejects(
      runner.query('UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1', [
        saved.epochId,
      ]),
      refused,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await db.query('SELECT * FROM authorization_history_control'), beforePointer);
});

test('A caller-set cutover marker alone cannot retarget control to a new unbound epoch', async () => {
  const epoch = randomUUID();
  const beforePointer = await db.query('SELECT * FROM authorization_history_control');
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query(
      'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
      [epoch, 'b'.repeat(64)],
    );
    await runner.query("SELECT set_config('smartsite.mf06_cutover_epoch',$1,true)", [epoch]);
    await assert.rejects(
      runner.query('UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1', [
        epoch,
      ]),
      refused,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await db.query('SELECT * FROM authorization_history_control'), beforePointer);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_epoch WHERE epoch_id=$1',
        [epoch],
      )
    )[0].n,
    0,
  );
});

test('Direct READY promotion remains forbidden and preserves the committed baseline', async () => {
  const saved = await baseline();
  await assert.rejects(
    db.query("UPDATE authorization_history_epoch SET state='READY' WHERE epoch_id=$1", [
      saved.epochId,
    ]),
    refused,
  );
  assert.equal(
    (
      await db.query('SELECT state FROM authorization_history_epoch WHERE epoch_id=$1', [
        saved.epochId,
      ])
    )[0].state,
    'STAGING',
  );
});

test('New profile preserves STAGING capture and refuses a disabled cutover guard', async () => {
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
  const saved = await baseline();
  assert.equal(saved.state, 'STAGING');
  await db.query(
    'ALTER TABLE authorization_history_control DISABLE TRIGGER trg_mf06_authority_control_update',
  );
  try {
    assert.equal(await hasMainAuthorityCapture(db.manager), false);
  } finally {
    await db.query(
      'ALTER TABLE authorization_history_control ENABLE TRIGGER trg_mf06_authority_control_update',
    );
  }
});

test('Cutover rejects source writes after its baseline, including facts without the target epoch', async () => {
  const beforePointer = await db.query('SELECT * FROM authorization_history_control');
  const inserted = randomUUID();
  await assert.rejects(
    controlledCommand(async (manager, epoch) => {
      await manager.query(
        "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Post-baseline user','not-a-password',false)",
        [inserted],
      );
      await manager.query(
        'UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1',
        [epoch],
      );
    }),
    refused,
  );
  assert.deepEqual(await db.query('SELECT * FROM authorization_history_control'), beforePointer);
  assert.equal((await db.query('SELECT id FROM app_user WHERE id=$1', [inserted])).length, 0);
});

test('Unused cutover rollback restores the exact predecessor and rolls back without changing installed capability', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await new AuthorizationHistoryCutover1793059200000().down(runner);
    assert.equal(await hasNamedV2AuthorityCutoverPredecessor(runner.manager), true);
    assert.equal(await hasMainAuthorityCapture(runner.manager), true);
    assert.equal(
      (
        await runner.query(
          "SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='mf06_authority_control_guard'",
        )
      ).length,
      0,
    );
    await runner.query(
      'ALTER TABLE authorization_history_epoch ADD COLUMN activated_at timestamptz',
    );
    assert.equal(await hasMainAuthorityCapture(runner.manager), false);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
});

test('Cutover rollback refuses schema drift before accessing relations', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('SET LOCAL search_path TO pg_catalog');
    await assert.rejects(
      new AuthorizationHistoryCutover1793059200000().down(runner),
      /Explicit owned schema required/,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('Installed guard profile without its activation column is unavailable', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('ALTER TABLE authorization_history_epoch DROP COLUMN activated_at');
    assert.equal(await hasMainAuthorityCapture(runner.manager), false);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('Cutover rollback rejects changed function security metadata despite an unchanged body', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('ALTER FUNCTION mf06_authority_control_guard() SECURITY DEFINER');
    assert.equal(await hasMainAuthorityCapture(runner.manager), false);
    await assert.rejects(new AuthorizationHistoryCutover1793059200000().down(runner), refused);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('Controlled command commits a READY epoch with a witness; a failed replacement rolls back atomically', async () => {
  const epoch = await controlledCommand();
  const [saved] = await db.query(`SELECT e.state,c.epoch_id,
    w.transaction_id=b.transaction_id AS witnessed
    FROM authorization_history_control c JOIN authorization_history_epoch e USING(epoch_id)
    JOIN authorization_history_baseline b USING(epoch_id)
    JOIN authorization_history_commit_receipt w USING(command_id) WHERE c.singleton=1`);
  assert.deepEqual(saved, { state: 'READY', epoch_id: epoch, witnessed: true });
  let rolledBackEpoch: string | undefined;
  await assert.rejects(
    controlledCommand(async (manager, next) => {
      rolledBackEpoch = next;
      await manager.query(
        'UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1',
        [next],
      );
      throw new Error('Synthetic forced rollback');
    }),
    /Synthetic forced rollback/,
  );
  assert.deepEqual(await db.query('SELECT epoch_id FROM authorization_history_control'), [
    { epoch_id: epoch },
  ]);
  assert.deepEqual(
    await db.query('SELECT state FROM authorization_history_epoch WHERE epoch_id=$1', [epoch]),
    [{ state: 'READY' }],
  );
  assert.equal(
    (
      await db.query('SELECT epoch_id FROM authorization_history_epoch WHERE epoch_id=$1', [
        rolledBackEpoch,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT epoch_id FROM authorization_history_baseline WHERE epoch_id=$1', [
        rolledBackEpoch,
      ])
    ).length,
    0,
  );
  assert.deepEqual(
    await db.query('SELECT closed_at FROM authorization_history_epoch WHERE epoch_id=$1', [epoch]),
    [{ closed_at: null }],
  );
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await assert.rejects(new AuthorizationHistoryCutover1793059200000().down(runner), refused);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('Only controlled READY transition creates immutable activation provenance; closing STAGING does not', async () => {
  const [current] = await db.query(`SELECT e.epoch_id,e.activated_at IS NOT NULL AS activated,
    e.activated_at>=e.baseline_at AS after_baseline FROM authorization_history_control c
    JOIN authorization_history_epoch e USING(epoch_id) WHERE c.singleton=1`);
  assert.equal(current.activated, true);
  assert.equal(current.after_baseline, true);
  const marker = await db.query(
    'SELECT activated_at::text AS value FROM authorization_history_epoch WHERE epoch_id=$1',
    [current.epoch_id],
  );
  await assert.rejects(
    db.query(
      'UPDATE authorization_history_epoch SET activated_at=clock_timestamp() WHERE epoch_id=$1',
      [current.epoch_id],
    ),
    refused,
  );
  await db.query("UPDATE authorization_history_epoch SET state='GAPPED' WHERE epoch_id=$1", [
    current.epoch_id,
  ]);
  assert.deepEqual(
    await db.query(
      'SELECT activated_at::text AS value FROM authorization_history_epoch WHERE epoch_id=$1',
      [current.epoch_id],
    ),
    marker,
  );
  await db.query("UPDATE authorization_history_epoch SET state='CLOSED' WHERE epoch_id=$1", [
    current.epoch_id,
  ]);
  assert.deepEqual(
    await db.query(
      'SELECT activated_at::text AS value FROM authorization_history_epoch WHERE epoch_id=$1',
      [current.epoch_id],
    ),
    marker,
  );
  const staging = randomUUID();
  await db.query(
    'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
    [staging, 'b'.repeat(64)],
  );
  await db.query("UPDATE authorization_history_epoch SET state='CLOSED' WHERE epoch_id=$1", [
    staging,
  ]);
  assert.deepEqual(
    await db.query('SELECT activated_at FROM authorization_history_epoch WHERE epoch_id=$1', [
      staging,
    ]),
    [{ activated_at: null }],
  );
  await assert.rejects(
    db.query(
      'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash,activated_at) VALUES($1,$2,clock_timestamp())',
      [randomUUID(), 'b'.repeat(64)],
    ),
    refused,
  );
});
