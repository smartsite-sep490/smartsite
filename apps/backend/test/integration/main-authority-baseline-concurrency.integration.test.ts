import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { QueryRunner } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});
after(() => database.dispose());

async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
  const password = 'SyntheticBaseline1!';
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic',$2,false)",
    [actor, await hashPassword(password)],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic')", [site]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zone, site],
  );
  const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
  const session = await auth.login(actor, password, AuthClientType.MOBILE);
  const request = {
    headers: { authorization: `Bearer ${session.accessToken}` },
    rawHeaders: ['Authorization', `Bearer ${session.accessToken}`],
    user: session.user,
  } as AuthenticatedRequest;
  const context = configurationCommandContext(request, new UserAuthGuard(auth));
  return { actor, site, zone, context, service: new MainAuthorityBaselineService(db) };
}

async function waitForSourceTableLock() {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const rows: { waiting: boolean }[] = await db.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
      WHERE relation='zone'::regclass AND mode='ShareLock' AND NOT granted AND pid<>pg_backend_pid()) AS waiting`);
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Capture never reached its owned Zone table lock');
}

test(
  'source locks precede the MVCC snapshot: a writer committed while capture waits is included',
  { timeout: 10000 },
  async () => {
    const f = await fixture(),
      writer = db.createQueryRunner();
    await writer.startTransaction();
    let capture: ReturnType<MainAuthorityBaselineService['capture']> | undefined;
    try {
      await writer.query('UPDATE zone SET required_ppe=ARRAY[$2::text] WHERE id=$1', [
        f.zone,
        'HARD_HAT',
      ]);
      capture = f.service.capture(f.context, 'a'.repeat(64));
      // Attach immediately so a failed lock timeout cannot become an unhandled rejection.
      void capture.catch(() => undefined);
      await waitForSourceTableLock();
      await writer.commitTransaction();
      const record = await capture;
      const sources = record.snapshot.sources as {
        sourceKind: string;
        rows: Record<string, unknown>[];
      }[];
      const row = sources
        .find((s) => s.sourceKind === 'ZONE_POLICY')
        ?.rows.find((r) => r.id === f.zone);
      assert.ok(row);
      assert.deepEqual(row.required_ppe, ['HARD_HAT']);
      assert.equal(record.state, 'STAGING');
      assert.equal(record.witnessConfirmed, true);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      if (capture) await capture.catch(() => undefined);
    }
  },
);

test(
  'source lock wait is finite and leaves no baseline command or epoch on timeout',
  { timeout: 10000 },
  async () => {
    const f = await fixture(),
      writer = db.createQueryRunner();
    const before = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_epoch'))[0].n;
    await writer.startTransaction();
    try {
      await writer.query('UPDATE zone SET required_ppe=ARRAY[$2::text] WHERE id=$1', [
        f.zone,
        'HARD_HAT',
      ]);
      await assert.rejects(
        f.service.capture(f.context, 'b'.repeat(64)),
        (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM mf06_authority_epoch'))[0].n,
        before,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM mf06_authority_command WHERE actor_user_id=$1',
            [f.actor],
          )
        )[0].n,
        0,
      );
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
    }
  },
);

test('completed capture remains stored but a revoked original bearer cannot receive private baseline metadata', async () => {
  const f = await fixture(),
    original = db.query.bind(db);
  db.query = (async (sql: string, params?: unknown[], runner?: QueryRunner) => {
    const value = await original(sql, params, runner);
    if (sql.startsWith('INSERT INTO mf06_authority_commit_witness'))
      await original('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1', [
        f.actor,
      ]);
    return value;
  }) as typeof db.query;
  try {
    await assert.rejects(f.service.capture(f.context, 'c'.repeat(64)), { status: 401 });
  } finally {
    db.query = original;
  }
  const rows = await db.query(
    `SELECT e.state,w.command_id AS witnessed FROM mf06_authority_baseline b
    JOIN mf06_authority_epoch e USING(epoch_id) JOIN mf06_authority_command c USING(command_id)
    LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE c.actor_user_id=$1`,
    [f.actor],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'STAGING');
  assert.ok(rows[0].witnessed);
});

test('JS-inexact source numbers cannot be returned beside an exact PostgreSQL snapshot hash', async () => {
  const f = await fixture();
  // Region polygon JSON may come from privileged legacy SQL rather than normal JS DTOs.
  const camera = randomUUID(),
    region = randomUUID();
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic')",
    [camera, f.site],
  );
  await db.query(
    `INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon)
    VALUES($1,$2,$3,'[[0,0],[0.10000000000000000001,0],[0,1]]')`,
    [region, camera, f.zone],
  );
  await assert.rejects(
    f.service.capture(f.context, 'd'.repeat(64)),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
});

test('caller-supplied baseline body, hashes and clock cannot replace the database-owned projection', async () => {
  const f = await fixture(),
    epoch = randomUUID(),
    manifest = 'e'.repeat(64);
  const rows = await executeMainConfigurationCommand(
    db,
    f.context,
    'MAIN_AUTHORITY_BASELINE',
    { epoch },
    async (manager) => {
      await manager.query(
        'INSERT INTO mf06_authority_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
        [epoch, manifest],
      );
      return manager.query(
        `INSERT INTO mf06_authority_baseline(epoch_id,command_id,captured_at,transaction_id,
      source_registry_hash,snapshot_hash,hash_algorithm,row_count,snapshot_json)
      VALUES($1,current_setting('smartsite.mf06_command_id')::uuid,'1900-01-01Z',pg_current_xact_id(),$2,$2,
      'POSTGRES_JSONB_TEXT_SHA256_V1',0,'{"forged":true}')
      RETURNING snapshot_json,source_registry_hash,snapshot_hash,row_count,captured_at`,
        [epoch, '0'.repeat(64)],
      );
    },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot_json.forged, undefined);
  assert.equal(rows[0].snapshot_json.version, 'MF06_MAIN_BASELINE_JSONB_V1');
  assert.equal(rows[0].snapshot_json.sources.length, 18);
  assert(rows[0].row_count > 0);
  assert.notEqual(rows[0].snapshot_hash, '0'.repeat(64));
  assert.equal(
    (await db.query('SELECT state FROM mf06_authority_epoch WHERE epoch_id=$1', [epoch]))[0].state,
    'STAGING',
  );
  assert.equal(
    (
      await db.query(
        "SELECT captured_at>'2026-01-01Z'::timestamptz AS live FROM mf06_authority_baseline WHERE epoch_id=$1",
        [epoch],
      )
    )[0].live,
    true,
  );
});

test('a metadata payload above two MiB is refused even with a small row count', async () => {
  const f = await fixture();
  const before = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_epoch'))[0].n;
  // Privileged legacy rows can exceed normal DTO budgets; no model/media content is used.
  await db.query('UPDATE zone SET required_ppe=ARRAY[$2::text] WHERE id=$1', [
    f.zone,
    'X'.repeat(2097152),
  ]);
  try {
    await assert.rejects(
      f.service.capture(f.context, 'f'.repeat(64)),
      (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 413,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM mf06_authority_epoch'))[0].n,
      before,
    );
  } finally {
    await db.query("UPDATE zone SET required_ppe='{}' WHERE id=$1", [f.zone]);
  }
});
