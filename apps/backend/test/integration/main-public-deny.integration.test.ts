import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { ZoneAccessController } from '../../src/modules/zones/zone-access.controller.js';
import {
  ZoneAccessManagementService,
  type CreateZoneAccessGrantCommand,
} from '../../src/modules/zones/zone-access-management.service.js';
import { ZoneAccessEffect } from '../../src/database/entities/zone-access-grant.entity.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
before(async () => {
  await database.initialize();
});
after(async () => {
  await database.dispose();
});
type Context = MainConfigurationCommandContext;
const status = (n: number) => (e: unknown) =>
  (e as { getStatus?: () => number }).getStatus?.() === n;
async function fixture(role = 'SITE_MANAGER') {
  const actorUserId = randomUUID(),
    siteId = randomUUID(),
    zoneId = randomUUID(),
    workerId = randomUUID(),
    contractorId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [actorUserId],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    actorUserId,
    role,
    role === 'ADMIN' ? null : siteId,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [contractorId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [workerId, siteId, contractorId],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  const access = new ZoneAccessManagementService(db);
  return {
    actorUserId,
    siteId,
    zoneId,
    workerId,
    contractorId,
    access,
    ctx: { actorUserId },
    input: {
      workerId,
      effect: ZoneAccessEffect.DENY,
      validFrom: '2026-10-01T00:00:00Z',
      validUntil: null,
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function create(f: Fixture, ctx: Context | undefined = f.ctx) {
  return f.access.createGrant(f.siteId, f.zoneId, f.input, ctx);
}
async function attribution(id: string, op: string, witnessed: true | null = true) {
  const row = (
    await db.query(
      'SELECT c.operation,c.actor_user_id,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
      [id],
    )
  )[0];
  assert.ok(row);
  assert.equal(row.operation, op);
  assert.equal(row.bound, true);
  assert.equal(row.witnessed, witnessed);
  return row;
}

test('existing public DENY create binds real actor, main fields and no legacy SERVICE history', async () => {
  const f = await fixture(),
    g = await create(f);
  assert.equal(g.effect, 'DENY');
  assert.equal(g.validUntil, null);
  assert.equal(g.contractorId, null);
  assert.equal((await attribution(g.id, 'ZONE_DENY_CREATE')).actor_user_id, f.actorUserId);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT to_regclass(current_schema() || '.zone_authority_command') AS old_journal",
      )
    )[0].old_journal,
    null,
  );
});
test('existing public flat ALLOW is refused even with Main Contractor permission and approved assignment', async () => {
  const f = await fixture(),
    participation = randomUUID();
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2020-01-01Z',NULL)",
    [participation, f.contractorId, f.siteId],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,site_id,site_contractor_id,worker_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED','2026-10-01Z','2026-11-01Z',$6)",
    [randomUUID(), f.siteId, participation, f.workerId, f.zoneId, f.actorUserId],
  );
  await db.query(
    "INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,granted_by,valid_from,valid_until) VALUES($1,$2,$3,$4,'2026-10-01Z','2026-11-01Z')",
    [randomUUID(), participation, f.zoneId, f.actorUserId],
  );
  await assert.rejects(
    f.access.createGrant(f.siteId, f.zoneId, {
      ...f.input,
      effect: ZoneAccessEffect.ALLOW,
      validUntil: '2026-11-01T00:00:00Z',
    }),
    status(409),
  );
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE worker_id=$1', [
        f.workerId,
      ])
    )[0].n,
    0,
  );
});
test('public DENY validation preserves an actual one-microsecond interval in PostgreSQL', async () => {
  const f = await fixture(),
    g = await f.access.createGrant(
      f.siteId,
      f.zoneId,
      {
        ...f.input,
        validFrom: '2026-10-01T00:00:00.000001Z',
        validUntil: '2026-10-01T00:00:00.000002Z',
      },
      f.ctx,
    );
  assert.equal(
    (
      await db.query(
        "SELECT valid_until-valid_from=interval '1 microsecond' AS exact FROM zone_access_grant WHERE id=$1",
        [g.id],
      )
    )[0].exact,
    true,
  );
});
test('actor-free public service callers remain unattributed instead of inventing SERVICE facts', async () => {
  const f = await fixture(),
    g = await f.access.createGrant(f.siteId, f.zoneId, f.input);
  assert.equal(
    (await db.query('SELECT command_id FROM mf06_authority_fact WHERE source_id=$1', [g.id]))[0]
      .command_id,
    null,
  );
  assert.equal(
    (
      await db.query(
        "SELECT to_regclass(current_schema() || '.zone_authority_command') AS old_journal",
      )
    )[0].old_journal,
    null,
  );
});
test('concurrent public revokes keep one first timestamp and one actual revoke source fact', async () => {
  const f = await fixture(),
    g = await create(f);
  const proposed = [new Date('2026-10-10T01:00:00Z'), new Date('2026-10-10T02:00:00Z')];
  const values = await Promise.all(
    proposed.map((at) => f.access.revokeGrant(f.siteId, f.zoneId, g.id, at, f.ctx)),
  );
  assert.equal(values[0]!.revokedAt?.getTime(), values[1]!.revokedAt?.getTime());
  assert.ok(proposed.some((p) => p.getTime() === values[0]!.revokedAt?.getTime()));
  assert.equal((await attribution(g.id, 'ZONE_DENY_REVOKE')).actor_user_id, f.actorUserId);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact WHERE source_id=$1', [
        g.id,
      ])
    )[0].n,
    2,
  );
});
for (const role of ['ADMIN', 'SAFETY_OFFICER', 'WORKER'])
  test(`public DENY transactions refuse ${role}`, async () => {
    const f = await fixture(role);
    await assert.rejects(create(f), status(403));
  });
test('public grant scope and reversed/unknown inputs fail without orphan commands', async () => {
  const f = await fixture(),
    other = await fixture();
  const n = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await assert.rejects(f.access.createGrant(other.siteId, f.zoneId, f.input, f.ctx), status(403));
  await assert.rejects(
    f.access.createGrant(f.siteId, f.zoneId, { ...f.input, workerId: other.workerId }, f.ctx),
    status(404),
  );
  await assert.rejects(
    f.access.createGrant(
      f.siteId,
      f.zoneId,
      { ...f.input, validUntil: '2026-09-30T00:00:00Z' },
      f.ctx,
    ),
    status(400),
  );
  await assert.rejects(
    f.access.createGrant(
      f.siteId,
      f.zoneId,
      { ...f.input, trusted: true } as CreateZoneAccessGrantCommand,
      f.ctx,
    ),
    status(400),
  );
  assert.equal((await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n, n);
});
test('partial journal and disabled DENY capture refuse authenticated creates', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE mf06_authority_commit_witness RENAME TO test_public_deny_witness');
  try {
    await assert.rejects(create(f), status(503));
  } finally {
    await db.query('ALTER TABLE test_public_deny_witness RENAME TO mf06_authority_commit_witness');
  }
  await db.query(
    'ALTER TABLE zone_access_grant DISABLE TRIGGER trg_mf06_capture_zone_access_grant',
  );
  try {
    await assert.rejects(create(f), status(503));
  } finally {
    await db.query(
      'ALTER TABLE zone_access_grant ENABLE TRIGGER trg_mf06_capture_zone_access_grant',
    );
  }
});
async function withApi(
  f: Fixture,
  work: (
    request: (path: string, body: unknown, method?: string) => Promise<Response>,
    guard: UserAuthGuard,
    logout: () => Promise<Response>,
  ) => Promise<void>,
) {
  const password = 'SyntheticMetadata123!';
  await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
    f.actorUserId,
    await hashPassword(password),
  ]);
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  const apiDatabase = new DataSource(db.options);
  await apiDatabase.initialize();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDatabase)
    .overrideProvider(DataSource)
    .useValue(apiDatabase)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const login = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.actorUserId, password, clientType: 'MOBILE' }),
    });
    assert.equal(login.status, 200);
    const session = (await login.json()) as { accessToken: string; refreshToken: string };
    const token = session.accessToken;
    const request = (path: string, body: unknown, method = 'POST') =>
      fetch(`${url}/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    // Inspect the injected guard actually used for the transaction claim, not a
    // different module-local guard instance returned by a non-strict lookup.
    const controller = module.get(ZoneAccessController) as unknown as { auth: UserAuthGuard };
    await work(request, controller.auth, () =>
      request('/auth/logout', { clientType: 'MOBILE', refreshToken: session.refreshToken }),
    );
  } finally {
    await app.close();
    if (apiDatabase.isInitialized) await apiDatabase.destroy();
  }
}

test('actual AppModule public DENY create/list/revoke retains DTOs and claims the bearer inside both transactions', async () => {
  const f = await fixture();
  await withApi(f, async (request, guard) => {
    let claims = 0;
    const original = guard.authenticateRequest.bind(guard);
    guard.authenticateRequest = async (r, manager) => {
      if (manager) {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        claims++;
      }
      await original(r, manager);
    };
    const root = `/sites/${f.siteId}/zones/${f.zoneId}/access-grants`;
    const created = await request(root, f.input);
    assert.equal(created.status, 201);
    const g = (await created.json()) as { id: string; effect: string; revokedAt: string | null };
    assert.equal(g.effect, 'DENY');
    assert.equal(g.revokedAt, null);
    assert.equal('contractorId' in g, false);
    assert.equal((await attribution(g.id, 'ZONE_DENY_CREATE')).actor_user_id, f.actorUserId);
    const listing = await request(root, undefined, 'GET');
    assert.equal(listing.status, 200);
    const page = (await listing.json()) as { items: { id: string }[]; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.id, g.id);
    assert.deepEqual(await f.access.listGrants(f.siteId, f.zoneId, 20, 20), {
      items: [],
      total: 1,
    });
    const denied = await request(root, { ...f.input, effect: 'ALLOW' });
    assert.equal(denied.status, 409);
    const extra = await request(root, { ...f.input, actorUserId: f.actorUserId });
    assert.equal(extra.status, 400);
    const revoked = await request(`${root}/${g.id}/revoke`, {}, 'PATCH');
    assert.equal(revoked.status, 200);
    assert.ok(((await revoked.json()) as { revokedAt: string }).revokedAt);
    assert.equal((await attribution(g.id, 'ZONE_DENY_REVOKE')).actor_user_id, f.actorUserId);
    assert.equal(claims, 3); // includes rejected ALLOW, not boundary-rejected extra DTO field
  });
});
for (const operation of ['create', 'revoke'] as const)
  test(`real HTTP logout before DENY ${operation} claim returns 401 with no mutation or orphan journal command`, async () => {
    const f = await fixture(),
      g = operation === 'revoke' ? await create(f) : null;
    await withApi(f, async (request, guard, logout) => {
      let signal!: () => void, release!: () => void;
      const held = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, manager) => {
        if (manager) {
          signal();
          await resume;
        }
        await original(r, manager);
      };
      const count = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
      const root = `/sites/${f.siteId}/zones/${f.zoneId}/access-grants`;
      const pending =
        operation === 'create'
          ? request(root, f.input)
          : request(`${root}/${g!.id}/revoke`, {}, 'PATCH');
      try {
        await Promise.race([
          held,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('DENY transaction claim not reached')), 3000).unref();
          }),
        ]);
        assert.equal((await logout()).status, 204);
      } finally {
        release();
      }
      assert.equal((await pending).status, 401);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
        count,
      );
      const rows = await db.query('SELECT revoked_at FROM zone_access_grant WHERE worker_id=$1', [
        f.workerId,
      ]);
      assert.equal(rows.length, operation === 'create' ? 0 : 1);
      if (rows.length) assert.equal(rows[0].revoked_at, null);
    });
  });

test('DENY source fact failure rolls back create and revoke together with the actor command', async () => {
  const f = await fixture(),
    g = await create(f);
  const count = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await db.query(
    "CREATE FUNCTION test_deny_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='ZONE_GRANT' THEN RAISE EXCEPTION 'Synthetic failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_deny_fact_failure BEFORE INSERT ON mf06_authority_fact FOR EACH ROW EXECUTE FUNCTION test_deny_fact_failure()",
  );
  try {
    const syntheticFailure = (error: unknown) =>
      error instanceof Error && error.message.includes('Synthetic failure');
    await assert.rejects(create(f), syntheticFailure);
    await assert.rejects(
      f.access.revokeGrant(f.siteId, f.zoneId, g.id, undefined, f.ctx),
      syntheticFailure,
    );
    const rows = await db.query('SELECT revoked_at FROM zone_access_grant WHERE worker_id=$1', [
      f.workerId,
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, null);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
      count,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_deny_fact_failure ON mf06_authority_fact;DROP FUNCTION test_deny_fact_failure()',
    );
  }
});

test('postcommit DENY witness failure keeps the already committed success without claiming confirmed history', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_deny_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure';END $$;CREATE TRIGGER test_deny_witness_failure BEFORE INSERT ON mf06_authority_commit_witness FOR EACH ROW EXECUTE FUNCTION test_deny_witness_failure()",
  );
  try {
    const g = await create(f);
    assert.equal((await attribution(g.id, 'ZONE_DENY_CREATE', null)).actor_user_id, f.actorUserId);
    assert.equal((await f.access.listGrants(f.siteId, f.zoneId)).total, 1);
  } finally {
    await db.query(
      'DROP TRIGGER test_deny_witness_failure ON mf06_authority_commit_witness;DROP FUNCTION test_deny_witness_failure()',
    );
  }
});
for (const changed of ['deactivated', 'temporary-password', 'role-reassigned'] as const)
  test(`public DENY claim rejects current actor ${changed} for both creates and no-op revokes`, async () => {
    const f = await fixture(),
      g = await create(f);
    await f.access.revokeGrant(f.siteId, f.zoneId, g.id, undefined, f.ctx);
    if (changed === 'deactivated')
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actorUserId]);
    if (changed === 'temporary-password')
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actorUserId]);
    if (changed === 'role-reassigned')
      await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
    await assert.rejects(create(f), status(403));
    await assert.rejects(
      f.access.revokeGrant(f.siteId, f.zoneId, g.id, undefined, f.ctx),
      status(403),
    );
  });
