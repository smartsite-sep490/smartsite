import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { createTestConfig } from '../support/config.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(async () => {
  await database.initialize();
});
after(async () => {
  await database.dispose();
});

async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin','not-a-password-hash',true,false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  const context = { actorUserId: actor, reauthorize: async () => {} };
  const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
  const [time] = await db.query(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
  );
  const input = {
    epochId: baseline.epochId,
    siteId: site,
    zoneId: zone,
    workerId: null,
    capturedAt: time.at as string,
    purpose: 'RETROSPECTIVE_REVIEW' as const,
  };
  return { actor, site, zone, context, input };
}

async function mutate(f: Awaited<ReturnType<typeof fixture>>, attributed = true, source = db) {
  return executeMainConfigurationCommand(
    source,
    attributed ? f.context : undefined,
    'ZONE_POLICY_UPDATE',
    { zoneId: f.zone },
    async (manager) => {
      await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
    },
  );
}

async function read(f: Awaited<ReturnType<typeof fixture>>, replica = false) {
  return db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    if (replica) await manager.query("SET LOCAL session_replication_role='replica'");
    return new MainAuthorityCapturedStateReader().read(manager, f.input);
  });
}

const invalidTriggers = [
  [
    'missing UPDATE/DELETE',
    'zone',
    'trg_mf06_capture_zone',
    "AFTER INSERT ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY')",
  ],
  [
    'BEFORE row',
    'zone',
    'trg_mf06_capture_zone',
    "BEFORE INSERT OR UPDATE OR DELETE ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY')",
  ],
  [
    'wrong source kind',
    'zone',
    'trg_mf06_capture_zone',
    "AFTER INSERT OR UPDATE OR DELETE ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('SITE')",
  ],
  [
    'missing source argument',
    'zone',
    'trg_mf06_capture_zone',
    'AFTER INSERT OR UPDATE OR DELETE ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority()',
  ],
  [
    'extra source argument',
    'zone',
    'trg_mf06_capture_zone',
    "AFTER INSERT OR UPDATE OR DELETE ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY','unused')",
  ],
  [
    'column-filtered UPDATE',
    'zone',
    'trg_mf06_capture_zone',
    "AFTER INSERT OR UPDATE OF name OR DELETE ON zone FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY')",
  ],
  [
    'conditional row capture',
    'zone',
    'trg_mf06_capture_zone',
    "AFTER INSERT OR UPDATE OR DELETE ON zone FOR EACH ROW WHEN (false) EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY')",
  ],
  [
    'BEFORE truncate',
    'zone',
    'trg_mf06_truncate_zone',
    "BEFORE TRUNCATE ON zone FOR EACH STATEMENT EXECUTE FUNCTION mf06_capture_main_authority('ZONE_POLICY')",
  ],
  [
    'wrong truncate kind',
    'zone',
    'trg_mf06_truncate_zone',
    "AFTER TRUNCATE ON zone FOR EACH STATEMENT EXECUTE FUNCTION mf06_capture_main_authority('SITE')",
  ],
  [
    'conditional command guard',
    'authorization_history_command',
    'trg_mf06_authority_command_insert',
    'BEFORE INSERT ON authorization_history_command FOR EACH ROW WHEN (false) EXECUTE FUNCTION mf06_authority_command_guard()',
  ],
  [
    'AFTER witness guard',
    'authorization_history_commit_receipt',
    'trg_mf06_authority_witness_insert',
    'AFTER INSERT ON authorization_history_commit_receipt FOR EACH ROW EXECUTE FUNCTION mf06_authority_witness_guard()',
  ],
] as const;

for (const [label, table, trigger, replacement] of invalidTriggers) {
  test(`rejects ${label} before a typed mutation or reconstructed archive`, async () => {
    const f = await fixture();
    const [original] = await db.query(
      'SELECT pg_get_triggerdef(t.oid) AS ddl FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2',
      [table, trigger],
    );
    await db.query(`DROP TRIGGER ${trigger} ON ${table}; CREATE TRIGGER ${trigger} ${replacement}`);
    try {
      // Check both consumers even if the first fails: the aggregate preserves both REDs.
      const command = await mutate(f).then(
        () => 'accepted',
        (e: { getStatus?: () => number }) => e.getStatus?.() ?? 'non-public-error',
      );
      const result = await read(f);
      assert.deepEqual(
        { command, reason: result.status === 'UNAVAILABLE' ? result.reason : result.status },
        { command: 503, reason: 'CAPTURE_UNAVAILABLE' },
      );
      assert.equal(
        (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [f.zone]))[0]
          .restriction_policy,
        'AUTHORIZATION_REQUIRED',
      );
    } finally {
      await db.query(`DROP TRIGGER ${trigger} ON ${table}`);
      await db.query(original.ddl as string);
    }
  });
}

test('actorless typed mutation rejects disabled installed capture without changing a row', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE zone DISABLE TRIGGER trg_mf06_capture_zone');
  try {
    await assert.rejects(
      mutate(f, false),
      (e: { getStatus?: () => number }) => e.getStatus?.() === 503,
    );
    assert.equal(
      (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [f.zone]))[0]
        .restriction_policy,
      'AUTHORIZATION_REQUIRED',
    );
  } finally {
    await db.query('ALTER TABLE zone ENABLE TRIGGER trg_mf06_capture_zone');
  }
});

test('actorless typed mutation rejects a partial installation', async () => {
  const f = await fixture();
  await db.query(
    'ALTER TABLE authorization_history_commit_receipt RENAME TO hidden_capture_witness',
  );
  try {
    await assert.rejects(
      mutate(f, false),
      (e: { getStatus?: () => number }) => e.getStatus?.() === 503,
    );
  } finally {
    await db.query(
      'ALTER TABLE hidden_capture_witness RENAME TO authorization_history_commit_receipt',
    );
  }
});

test('replica sessions cannot bypass origin capture for either consumer', async () => {
  const f = await fixture();
  // Explicit test-only adapter injects a transaction-local existing PostgreSQL setting.
  const replicaSource = {
    query: db.query.bind(db),
    transaction: async (...args: unknown[]) =>
      db.transaction('SERIALIZABLE', async (m) => {
        await m.query("SET LOCAL session_replication_role='replica'");
        return (args.at(-1) as (manager: EntityManager) => Promise<unknown>)(m);
      }),
  } as unknown as DataSource;
  for (const attributed of [true, false])
    await assert.rejects(
      mutate(f, attributed, replicaSource),
      (e: { getStatus?: () => number }) => e.getStatus?.() === 503,
    );
  assert.equal((await read(f, true)).status, 'UNAVAILABLE');
  assert.equal(
    (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [f.zone]))[0]
      .restriction_policy,
    'AUTHORIZATION_REQUIRED',
  );
});

test('valid actorless capture stays explicitly unattributed; it never invents an actor', async () => {
  const f = await fixture();
  await mutate(f, false);
  const [fact] = await db.query(
    "SELECT command_id,after_payload FROM authorization_history_revision WHERE source_kind='ZONE_POLICY' AND source_id=$1 ORDER BY revision DESC LIMIT 1",
    [f.zone],
  );
  assert.equal(fact.command_id, null);
  assert.equal(fact.after_payload.restriction_policy, 'NONE');
  const [gap] = await db.query(
    'SELECT reason FROM authorization_history_gap WHERE source_id=$1 ORDER BY observed_at DESC LIMIT 1',
    [f.zone],
  );
  assert.equal(gap.reason, 'UNATTRIBUTED_WRITE');
});

test('canonical installed triggers still permit witnessed commands and metadata reconstruction', async () => {
  const f = await fixture();
  assert.equal((await read(f)).status, 'RECONSTRUCTED');
  await mutate(f);
  const [fact] = await db.query(
    'SELECT f.command_id,c.actor_user_id,w.command_id AS witnessed FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
    [f.zone],
  );
  assert.equal(fact.actor_user_id, f.actor);
  assert.equal(fact.witnessed, fact.command_id);
});

for (const table of ['app_user', 'user_role_assignment']) {
  test(`initial Admin bootstrap refuses disabled ${table} capture before creating an account`, async () => {
    const owned = createIsolatedTestDatabase();
    try {
      await owned.initialize();
      const source = owned.dataSource;
      await source.query(`ALTER TABLE ${table} DISABLE TRIGGER trg_mf06_capture_${table}`);
      const service = new UsersService(source, new SiteConfigurationService(source));
      await assert.rejects(
        service.bootstrap('synthetic.bootstrap', 'Synthetic Admin', 'SyntheticAdmin123!'),
        (e: { getStatus?: () => number }) => e.getStatus?.() === 503,
      );
      assert.equal((await source.query('SELECT count(*)::int AS n FROM app_user'))[0].n, 0);
    } finally {
      await owned.dispose();
    }
  });
}

test('valid initial Admin bootstrap records unattributed account/role facts, not a synthetic authority command', async () => {
  const owned = createIsolatedTestDatabase();
  try {
    await owned.initialize();
    const source = owned.dataSource,
      service = new UsersService(source, new SiteConfigurationService(source));
    const created = await service.bootstrap(
      'synthetic.bootstrap',
      'Synthetic Admin',
      'SyntheticAdmin123!',
    );
    const facts: { source_kind: string; command_id: string | null }[] = await source.query(
      'SELECT source_kind,command_id FROM authorization_history_revision ORDER BY source_kind',
    );
    assert.deepEqual(facts, [
      { source_kind: 'USER_ACCOUNT', command_id: null },
      { source_kind: 'USER_ROLE', command_id: null },
    ]);
    assert.equal(
      (await source.query('SELECT count(*)::int AS n FROM authorization_history_command'))[0].n,
      0,
    );
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int AS n FROM authorization_history_gap WHERE reason='UNATTRIBUTED_WRITE'",
        )
      )[0].n,
      2,
    );
    assert.equal(created.mustChangePassword, false);
    await assert.rejects(
      service.bootstrap('synthetic.second', 'Second Admin', 'SyntheticAdmin123!'),
      (e: { getStatus?: () => number }) => e.getStatus?.() === 409,
    );
  } finally {
    await owned.dispose();
  }
});

test('uninstalled legacy journal preserves initial Admin bootstrap and actorless command compatibility', async () => {
  const owned = createIsolatedTestDatabase({ legacy: true });
  try {
    await owned.initialize();
    const source = owned.dataSource,
      service = new UsersService(source, new SiteConfigurationService(source));
    const created = await service.bootstrap(
      'synthetic.legacy',
      'Synthetic Admin',
      'SyntheticAdmin123!',
    );
    assert.equal(created.mustChangePassword, false);
    assert.equal(
      await executeMainConfigurationCommand(
        source,
        undefined,
        'USER_ACCOUNT_STATUS',
        {},
        async () => 'legacy-result',
      ),
      'legacy-result',
    );
  } finally {
    await owned.dispose();
  }
});

test('concurrent initial Admin requests see the winning Admin after the invariant lock', async () => {
  const owned = createIsolatedTestDatabase();
  try {
    await owned.initialize();
    const actual = owned.dataSource;
    let started = 0;
    let release!: () => void;
    const snapshotsReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Test-only adapter starts both reads before the lock without changing the
    // transaction isolation requested by production code.
    const source = {
      query: actual.query.bind(actual),
      transaction: async (...args: unknown[]) =>
        actual.transaction(
          typeof args[0] === 'string' ? (args[0] as 'SERIALIZABLE') : 'READ COMMITTED',
          async (manager) => {
            const attempt = ++started;
            if (attempt <= 2) {
              assert.equal(
                (await manager.query('SELECT count(*)::int AS n FROM app_user'))[0].n,
                0,
              );
              if (attempt === 2) release();
              await snapshotsReady;
            }
            return (args.at(-1) as (manager: EntityManager) => Promise<unknown>)(manager);
          },
        ),
    } as unknown as DataSource;
    const service = new UsersService(source, new SiteConfigurationService(source));
    const results = await Promise.allSettled([
      service.bootstrap('synthetic.first', 'First Admin', 'SyntheticAdmin123!'),
      service.bootstrap('synthetic.second', 'Second Admin', 'SyntheticAdmin123!'),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const denied = results.find((result) => result.status === 'rejected');
    assert.equal(denied?.status === 'rejected' ? denied.reason.getStatus() : null, 409);
    assert.equal(started, 2, 'actorless bootstrap retains current-statement snapshots');
    assert.equal((await actual.query('SELECT count(*)::int AS n FROM app_user'))[0].n, 1);
    assert.equal(
      (
        await actual.query("SELECT count(*)::int AS n FROM user_role_assignment WHERE role='ADMIN'")
      )[0].n,
      1,
    );
    assert.equal(
      (await actual.query('SELECT count(*)::int AS n FROM authorization_history_revision'))[0].n,
      2,
    );
    assert.equal(
      (await actual.query('SELECT count(*)::int AS n FROM authorization_history_command'))[0].n,
      0,
    );
  } finally {
    await owned.dispose();
  }
});

test('actorless commands retain READ COMMITTED while authenticated authority commands retain SERIALIZABLE', async () => {
  const f = await fixture();
  const isolation = (context: typeof f.context | undefined) =>
    executeMainConfigurationCommand(
      db,
      context,
      'ZONE_POLICY_UPDATE',
      {},
      async (manager) =>
        (await manager.query("SELECT current_setting('transaction_isolation') AS isolation"))[0]
          .isolation,
    );
  assert.equal(await isolation(undefined), 'read committed');
  assert.equal(await isolation(f.context), 'serializable');
});

for (const profile of ['canonical', 'legacy'] as const) {
  test(
    `actorless ${profile} password reset revokes a login that commits after its first metadata read`,
    { timeout: 30000 },
    async () => {
      const owned = createIsolatedTestDatabase(profile === 'legacy' ? { legacy: true } : {});
      let releaseLogin!: () => void;
      let login: Promise<Awaited<ReturnType<AuthService['login']>>> | undefined;
      let reset: Promise<void> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await owned.initialize();
        const actual = owned.dataSource;
        const user = await new UsersService(actual, new SiteConfigurationService(actual)).bootstrap(
          'synthetic.race',
          'Synthetic Admin',
          'SyntheticAdmin123!',
        );
        let inserted!: () => void, readSnapshot!: () => void;
        const loginInserted = new Promise<void>((resolve) => {
          inserted = resolve;
        });
        const loginRelease = new Promise<void>((resolve) => {
          releaseLogin = resolve;
        });
        const snapshotRead = new Promise<void>((resolve) => {
          readSnapshot = resolve;
        });
        const tokens = new AuthTokenService(new JwtService(), createTestConfig());
        // Real transactions/locks, with an explicit fixture-only pause before login commit.
        const loginSource = {
          manager: actual.manager,
          getRepository: actual.getRepository.bind(actual),
          transaction: async (work: (manager: EntityManager) => Promise<unknown>) =>
            actual.transaction(async (manager) => {
              const value = await work(manager);
              inserted();
              await loginRelease;
              return value;
            }),
        } as unknown as DataSource;
        const resetSource = {
          query: actual.query.bind(actual),
          transaction: async (...args: unknown[]) =>
            actual.transaction(
              typeof args[0] === 'string' ? (args[0] as 'SERIALIZABLE') : 'READ COMMITTED',
              async (manager) => {
                await manager.query('SELECT count(*) FROM auth_session WHERE user_id=$1', [
                  user.id,
                ]);
                readSnapshot();
                return (args.at(-1) as (manager: EntityManager) => Promise<unknown>)(manager);
              },
            ),
        } as unknown as DataSource;
        const auth = new AuthService(loginSource, tokens);
        login = auth.login(user.username, 'SyntheticAdmin123!', AuthClientType.MOBILE);
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Synthetic interleaving deadline exceeded')),
            10000,
          );
        });
        await Promise.race([
          loginInserted,
          login.then(() => {
            throw new Error('Login must be held before commit');
          }),
          deadline,
        ]);
        reset = new UsersService(resetSource, new SiteConfigurationService(actual)).resetPassword(
          user.id,
          { temporaryPassword: 'SyntheticReplacement123!' },
        );
        await Promise.race([
          snapshotRead,
          reset.then(() => {
            throw new Error('Reset must reach its first read');
          }),
          deadline,
        ]);
        releaseLogin();
        const [session] = await Promise.all([login, reset]);
        await assert.rejects(
          new AuthService(actual, tokens).authenticate(session.accessToken),
          (e: { getStatus?: () => number }) => e.getStatus?.() === 401,
        );
        assert.equal(
          (
            await actual.query(
              'SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL',
              [user.id],
            )
          )[0].n,
          0,
        );
      } finally {
        if (timeout) clearTimeout(timeout);
        releaseLogin?.();
        await Promise.allSettled([login, reset]);
        await owned.dispose();
      }
    },
  );
}
