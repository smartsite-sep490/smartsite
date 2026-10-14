import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
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
import { SitesController } from '../../src/modules/sites/sites.controller.js';
import { ZonesController } from '../../src/modules/zones/zones.controller.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
type Context = MainConfigurationCommandContext;
before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});
after(async () => {
  await database.dispose();
});
const policy = {
  type: ZoneType.RESTRICTED,
  restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  requiredPpe: ['SAFETY_VEST', 'HARD_HAT'],
};
async function fixture(role = 'ADMIN') {
  const actorUserId = randomUUID(),
    siteId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','synthetic-not-login',false)",
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
  const sites = new SiteConfigurationService(db),
    zones = new ZoneConfigurationService(db, sites);
  return {
    actorUserId,
    siteId,
    sites,
    zones,
    ctx: { actorUserId },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function zone(f: Fixture, ctx: Context | undefined = f.ctx) {
  return f.zones.create(f.siteId, { code: randomUUID(), name: 'Synthetic Zone', ...policy }, ctx);
}
const status = (n: number) => (e: unknown) =>
  (e as { getStatus?: () => number }).getStatus?.() === n;
async function attribution(id: string, operation: string, witnessed: true | null = true) {
  const row = (
    await db.query(
      'SELECT c.command_id,c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
      [id],
    )
  )[0];
  assert.ok(row, `${operation} must bind the real authenticated actor`);
  assert.equal(row.operation, operation);
  assert.equal(row.bound, true);
  assert.equal(row.witnessed, witnessed);
  return row;
}
test('existing Site create binds a global Admin to its initial main policy fact', async () => {
  const f = await fixture(),
    site = await f.sites.create({ code: randomUUID(), name: 'New Site' }, f.ctx);
  assert.equal((await attribution(site.id, 'SITE_CREATE')).actor_user_id, f.actorUserId);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [site.id]))[0]
      .access_policy_version,
    1,
  );
});
test('existing Zone create binds sorted PPE and policy without a fabricated legacy service command', async () => {
  const f = await fixture(),
    z = await zone(f);
  assert.equal((await attribution(z.id, 'ZONE_CREATE')).actor_user_id, f.actorUserId);
  assert.deepEqual(z.requiredPpe, ['HARD_HAT', 'SAFETY_VEST']);
  assert.equal(z.configurationLocked, false);
  assert.equal(
    (await db.query("SELECT to_regclass('zone_authority_command') IS NULL AS absent"))[0].absent,
    true,
  );
});
test('unlinked Zone policy updates share the existing main projection and immutable command', async () => {
  const f = await fixture(),
    z = await zone(f);
  const updated = await f.zones.updatePolicy(
    f.siteId,
    z.id,
    { ...policy, restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL, requiredPpe: [] },
    f.ctx,
  );
  assert.equal(updated.restrictionPolicy, 'PROHIBITED_FOR_ALL');
  assert.equal((await attribution(z.id, 'ZONE_POLICY_UPDATE')).actor_user_id, f.actorUserId);
});
test('locked policy allows an exact no-op but refuses changed PPE and leaves no orphan command', async () => {
  const f = await fixture(),
    z = await zone(f);
  await db.query('UPDATE zone SET configuration_locked=true WHERE id=$1', [z.id]);
  const count = (
    await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact WHERE source_id=$1', [z.id])
  )[0].n;
  assert.equal(
    (await f.zones.updatePolicy(f.siteId, z.id, policy, f.ctx)).configurationLocked,
    true,
  );
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact WHERE source_id=$1', [
        z.id,
      ])
    )[0].n,
    count,
  );
  const commands = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await assert.rejects(
    f.zones.updatePolicy(f.siteId, z.id, { ...policy, requiredPpe: [] }, f.ctx),
    status(409),
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
    commands,
  );
});
for (const role of ['SITE_MANAGER', 'SAFETY_OFFICER', 'WORKER'])
  test(`Site and Zone writes reject current ${role} in the transaction`, async () => {
    const f = await fixture(role);
    await assert.rejects(
      f.sites.create({ code: randomUUID(), name: 'Denied' }, f.ctx),
      status(403),
    );
    await assert.rejects(zone(f), status(403));
  });
test('Site and Zone reauthentication refuses a revoked session before any metadata is committed', async () => {
  const f = await fixture();
  let claims = 0;
  const ctx = {
    actorUserId: f.actorUserId,
    reauthorize: async (m: EntityManager) => {
      assert.equal(m.queryRunner?.isTransactionActive, true);
      claims++;
      throw Object.assign(new Error('Synthetic revocation'), { getStatus: () => 401 });
    },
  };
  await assert.rejects(f.sites.create({ code: randomUUID(), name: 'Denied' }, ctx), status(401));
  await assert.rejects(zone(f, ctx), status(401));
  assert.equal(claims, 2);
});
test('partial installed journal refuses Site and Zone creation', async () => {
  const f = await fixture();
  await db.query(
    'ALTER TABLE mf06_authority_commit_witness RENAME TO test_metadata_hidden_witness',
  );
  try {
    await assert.rejects(
      f.sites.create({ code: randomUUID(), name: 'Denied' }, f.ctx),
      status(503),
    );
    await assert.rejects(zone(f), status(503));
  } finally {
    await db.query(
      'ALTER TABLE test_metadata_hidden_witness RENAME TO mf06_authority_commit_witness',
    );
  }
});
test('disabled owning capture triggers refuse metadata writes', async () => {
  const f = await fixture();
  await db.query(
    'ALTER TABLE site DISABLE TRIGGER trg_mf06_capture_site;ALTER TABLE zone DISABLE TRIGGER trg_mf06_capture_zone',
  );
  try {
    await assert.rejects(
      f.sites.create({ code: randomUUID(), name: 'Denied' }, f.ctx),
      status(503),
    );
    await assert.rejects(zone(f), status(503));
  } finally {
    await db.query(
      'ALTER TABLE site ENABLE TRIGGER trg_mf06_capture_site;ALTER TABLE zone ENABLE TRIGGER trg_mf06_capture_zone',
    );
  }
});
test('source fact failure atomically rolls back a Zone and its actor command', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_metadata_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='ZONE_POLICY' THEN RAISE EXCEPTION 'Synthetic failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_metadata_fact_failure BEFORE INSERT ON mf06_authority_fact FOR EACH ROW EXECUTE FUNCTION test_metadata_fact_failure()",
  );
  try {
    await assert.rejects(zone(f));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone WHERE site_id=$1', [f.siteId]))[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM mf06_authority_command WHERE actor_user_id=$1',
          [f.actorUserId],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_metadata_fact_failure ON mf06_authority_fact;DROP FUNCTION test_metadata_fact_failure()',
    );
  }
});
test('actor-free internal metadata writes remain unattributed instead of inventing legacy service actors', async () => {
  const f = await fixture(),
    z = await f.zones.create(f.siteId, { code: randomUUID(), name: 'Internal Zone', ...policy });
  assert.equal(
    (await db.query('SELECT command_id FROM mf06_authority_fact WHERE source_id=$1', [z.id]))[0]
      .command_id,
    null,
  );
  assert.equal(
    (await db.query("SELECT to_regclass('zone_authority_command') IS NULL AS absent"))[0].absent,
    true,
  );
});

async function withApi(
  f: Fixture,
  work: (
    request: (path: string, body: unknown, method?: string) => Promise<Response>,
    guards: { sites: UserAuthGuard; zones: UserAuthGuard },
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
        body: JSON.stringify(body),
      });
    // Inspect the injected guard actually used for the transaction claim, not a
    // different module-local guard instance returned by a non-strict lookup.
    const sites = module.get(SitesController) as unknown as { auth: UserAuthGuard };
    const zones = module.get(ZonesController) as unknown as { auth: UserAuthGuard };
    await work(request, { sites: sites.auth, zones: zones.auth }, () =>
      request('/auth/logout', { clientType: 'MOBILE', refreshToken: session.refreshToken }),
    );
  } finally {
    await app.close();
    if (apiDatabase.isInitialized) await apiDatabase.destroy();
  }
}

test('actual AppModule Site and Zone HTTP writes bind the bearer actor inside all three transactions', async () => {
  const f = await fixture();
  await withApi(f, async (request, guards) => {
    let claims = 0;
    for (const guard of new Set(Object.values(guards))) {
      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, manager) => {
        if (manager) {
          assert.equal(manager.queryRunner?.isTransactionActive, true);
          claims++;
        }
        await original(r, manager);
      };
    }
    const created = await request('/sites', { code: randomUUID(), name: 'HTTP synthetic Site' });
    assert.equal(created.status, 201);
    const site = (await created.json()) as { id: string };
    assert.equal((await attribution(site.id, 'SITE_CREATE')).actor_user_id, f.actorUserId);
    const root = `/sites/${site.id}/zones`;
    const linked = await request(root, {
      code: randomUUID(),
      name: 'HTTP synthetic Zone',
      ...policy,
    });
    assert.equal(linked.status, 201);
    const z = (await linked.json()) as { id: string; requiredPpe: string[] };
    assert.deepEqual(z.requiredPpe, ['HARD_HAT', 'SAFETY_VEST']);
    assert.equal((await attribution(z.id, 'ZONE_CREATE')).actor_user_id, f.actorUserId);
    const updated = await request(
      `${root}/${z.id}/policy`,
      { ...policy, requiredPpe: [] },
      'PATCH',
    );
    assert.equal(updated.status, 200);
    assert.equal((await attribution(z.id, 'ZONE_POLICY_UPDATE')).actor_user_id, f.actorUserId);
    assert.equal(claims, 3);
  });
});

for (const target of ['SITE_CREATE', 'ZONE_CREATE', 'ZONE_POLICY_UPDATE'] as const)
  test(`actual HTTP logout before ${target} transaction claim returns 401 without committing metadata or an orphan command`, async () => {
    const f = await fixture(),
      z = await zone(f);
    await withApi(f, async (request, guards, logout) => {
      const guard = target === 'SITE_CREATE' ? guards.sites : guards.zones;
      let signal!: () => void, release!: () => void;
      const held = new Promise<void>((r) => {
        signal = r;
      });
      const resume = new Promise<void>((r) => {
        release = r;
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
      const code = randomUUID();
      const pending =
        target === 'SITE_CREATE'
          ? request('/sites', { code, name: 'Held Site' })
          : target === 'ZONE_CREATE'
            ? request(`/sites/${f.siteId}/zones`, { code, name: 'Held Zone', ...policy })
            : request(
                `/sites/${f.siteId}/zones/${z.id}/policy`,
                { ...policy, requiredPpe: [] },
                'PATCH',
              );
      try {
        await Promise.race([
          held,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Metadata transaction claim was not reached')),
              3000,
            ).unref();
          }),
        ]);
        assert.equal((await logout()).status, 204);
      } finally {
        release();
      }
      assert.equal((await pending).status, 401);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM site WHERE code=$1', [code]))[0].n,
        0,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM zone WHERE code=$1', [code]))[0].n,
        0,
      );
      assert.deepEqual((await f.zones.get(f.siteId, z.id)).requiredPpe, [
        'HARD_HAT',
        'SAFETY_VEST',
      ]);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
        count,
      );
    });
  });

test('main metadata duplicate codes and wrong Site policy writes retain existing conflict/scope behavior', async () => {
  const f = await fixture(),
    z = await zone(f);
  const site = await f.sites.create({ code: randomUUID(), name: 'Unique Site' }, f.ctx);
  const count = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await assert.rejects(f.sites.create({ code: site.code, name: 'Duplicate' }, f.ctx), status(409));
  await assert.rejects(
    f.zones.create(f.siteId, { code: z.code, name: 'Duplicate', ...policy }, f.ctx),
    status(409),
  );
  await assert.rejects(
    f.zones.updatePolicy(site.id, z.id, { ...policy, requiredPpe: [] }, f.ctx),
    status(404),
  );
  assert.equal(await f.zones.referenceName(site.id, z.id), null);
  assert.equal(await f.zones.referenceName(f.siteId, null), null);
  assert.equal(await f.zones.referenceName(f.siteId, z.id), z.name);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
    count,
  );
});

test('postcommit metadata witness failure keeps committed DTO successful while historical proof remains unconfirmed', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_metadata_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic witness failure';END $$;CREATE TRIGGER test_metadata_witness_failure BEFORE INSERT ON mf06_authority_commit_witness FOR EACH ROW EXECUTE FUNCTION test_metadata_witness_failure()",
  );
  try {
    const site = await f.sites.create({ code: randomUUID(), name: 'Committed Site' }, f.ctx);
    const z = await f.zones.create(
      site.id,
      { code: randomUUID(), name: 'Committed Zone', ...policy },
      f.ctx,
    );
    for (const [id, op] of [
      [site.id, 'SITE_CREATE'],
      [z.id, 'ZONE_CREATE'],
    ]) {
      const row = await attribution(id!, op!, null);
      assert.equal(row.witnessed, null);
      assert.equal(row.actor_user_id, f.actorUserId);
    }
  } finally {
    await db.query(
      'DROP TRIGGER test_metadata_witness_failure ON mf06_authority_commit_witness;DROP FUNCTION test_metadata_witness_failure()',
    );
  }
});
