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
import { CamerasController } from '../../src/modules/cameras/cameras.controller.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraStatus } from '../../src/database/entities/enums.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
const triangle = {
  coordinates: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};
type Context = MainConfigurationCommandContext;
type Camera = Awaited<ReturnType<CameraConfigurationService['create']>>;
type Region = Awaited<ReturnType<CameraConfigurationService['createRegion']>>;
before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});
after(async () => {
  await database.dispose();
});
async function fixture(role = 'ADMIN') {
  const actorUserId = randomUUID(),
    siteId = randomUUID(),
    zoneId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-runtime-secret',false)",
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
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  const sites = new SiteConfigurationService(db),
    zones = new ZoneConfigurationService(db, sites),
    service = new CameraConfigurationService(db, zones, sites);
  return { actorUserId, siteId, zoneId, service, context: { actorUserId } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function create(f: Fixture, context: Context | undefined = f.context) {
  const code = randomUUID();
  return f.service.create(f.siteId, { code, name: 'Synthetic camera', externalId: code }, context);
}
async function attribution(id: string, operation: string) {
  const rows = await db.query(
    'SELECT c.command_id,c.actor_user_id,c.operation,f.source_kind,f.transaction_id=c.transaction_id AS same_tx,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f LEFT JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1 ORDER BY f.revision DESC LIMIT 1',
    [id],
  );
  assert.ok(rows[0]?.command_id, `${operation} must retain a same-transaction main command`);
  assert.equal(rows[0].operation, operation);
  assert.equal(rows[0].same_tx, true);
  assert.equal(rows[0].witnessed, true);
  return rows[0];
}
function status(n: number) {
  return (e: unknown) => (e as { getStatus?: () => number }).getStatus?.() === n;
}
test('existing Camera create path records authenticated actor and main journal in the same transaction', async () => {
  const f = await fixture(),
    camera = await create(f);
  const row = await attribution(camera.id, 'CAMERA_CREATE');
  assert.equal(row.actor_user_id, f.actorUserId);
  assert.equal(camera.configurationVersion, 1);
  assert.equal(camera.status, CameraStatus.ACTIVE);
});
test('Region create binds camera revision, polygon and permanent Zone lock to one command', async () => {
  const f = await fixture(),
    camera = await create(f),
    region = await f.service.createRegion(
      f.siteId,
      camera.id,
      { zoneId: f.zoneId, polygon: triangle, expectedConfigurationVersion: 1 },
      f.context,
    );
  const row = await attribution(region.id, 'REGION_CREATE');
  assert.equal(region.configurationVersion, 2);
  assert.equal(region.version, 1);
  assert.equal(
    (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
      .configuration_locked,
    true,
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT source_kind FROM mf06_authority_fact WHERE command_id=$1 ORDER BY source_kind',
        [row.command_id],
      )
    ).map((r: { source_kind: string }) => r.source_kind),
    ['CAMERA', 'REGION', 'ZONE_POLICY'],
  );
});
test('polygon edit and region status preserve their revision rules and main command attribution', async () => {
  const f = await fixture(),
    camera = await create(f),
    region = await f.service.createRegion(
      f.siteId,
      camera.id,
      { zoneId: f.zoneId, polygon: triangle, expectedConfigurationVersion: 1 },
      f.context,
    );
  const updated = await f.service.updatePolygon(
    f.siteId,
    camera.id,
    region.id,
    {
      polygon: {
        coordinates: [
          [0, 0],
          [0.9, 0],
          [0, 0.9],
        ],
      },
      expectedConfigurationVersion: 2,
    },
    f.context,
  );
  assert.equal(updated.version, 2);
  assert.equal(updated.configurationVersion, 3);
  await attribution(region.id, 'REGION_POLYGON_UPDATE');
  const inactive = await f.service.setRegionActive(
    f.siteId,
    camera.id,
    region.id,
    { isActive: false, expectedConfigurationVersion: 3 },
    f.context,
  );
  assert.equal(inactive.version, 3);
  assert.equal(inactive.configurationVersion, 4);
  await attribution(region.id, 'REGION_STATUS_UPDATE');
  assert.equal(
    (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
      .configuration_locked,
    true,
  );
});
test('Camera status mutation records camera and every active Region version under one command', async () => {
  const f = await fixture(),
    camera = await create(f),
    region = await f.service.createRegion(
      f.siteId,
      camera.id,
      { zoneId: f.zoneId, polygon: triangle, expectedConfigurationVersion: 1 },
      f.context,
    );
  const result = await f.service.setStatus(
    f.siteId,
    camera.id,
    { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 2 },
    f.context,
  );
  const row = await attribution(camera.id, 'CAMERA_STATUS_UPDATE');
  assert.equal(result.configurationVersion, 3);
  assert.equal(
    (await db.query('SELECT version FROM camera_observation_region WHERE id=$1', [region.id]))[0]
      .version,
    2,
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT source_kind FROM mf06_authority_fact WHERE command_id=$1 ORDER BY source_kind',
        [row.command_id],
      )
    ).map((r: { source_kind: string }) => r.source_kind),
    ['CAMERA', 'REGION'],
  );
});
test('stale revision and foreign Site mutations fail without orphan commands or changed geometry', async () => {
  const f = await fixture(),
    camera = await create(f),
    other = await fixture();
  const n = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await assert.rejects(
    f.service.setStatus(
      f.siteId,
      camera.id,
      { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 2 },
      f.context,
    ),
    status(409),
  );
  await assert.rejects(
    f.service.setStatus(
      other.siteId,
      camera.id,
      { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 1 },
      f.context,
    ),
    status(404),
  );
  assert.equal((await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n, n);
});
for (const role of ['SITE_MANAGER', 'SAFETY_OFFICER', 'WORKER'])
  test(`late camera mutation rejects current ${role}`, async () => {
    const f = await fixture(role);
    await assert.rejects(create(f), status(403));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
      0,
    );
  });
test('late authentication claim executes inside the transaction and refusal prevents a write', async () => {
  const f = await fixture();
  let claimed = 0;
  await assert.rejects(
    create(f, {
      actorUserId: f.actorUserId,
      reauthorize: async (manager) => {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        claimed++;
        throw Object.assign(new Error('synthetic revoked session'), { getStatus: () => 401 });
      },
    }),
    status(401),
  );
  assert.equal(claimed, 1);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
    0,
  );
});
test('current actor disable/password/role change is rejected before mutation', async () => {
  for (const field of ['is_active', 'must_change_password', 'role']) {
    const f = await fixture();
    if (field === 'role')
      await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
    else
      await db.query(`UPDATE app_user SET ${field}=$2 WHERE id=$1`, [
        f.actorUserId,
        field === 'must_change_password',
      ]);
    await assert.rejects(create(f), status(403));
  }
});
test('journal fact failure rolls back actual Camera/Region/Zone mutations', async () => {
  const f = await fixture(),
    camera = await create(f);
  await db.query(
    `CREATE FUNCTION test_camera_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='REGION' THEN RAISE EXCEPTION 'synthetic fact failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_camera_fact_failure BEFORE INSERT ON mf06_authority_fact FOR EACH ROW EXECUTE FUNCTION test_camera_fact_failure()`,
  );
  try {
    await assert.rejects(
      f.service.createRegion(
        f.siteId,
        camera.id,
        { zoneId: f.zoneId, polygon: triangle, expectedConfigurationVersion: 1 },
        f.context,
      ),
    );
    assert.equal(
      (await db.query('SELECT configuration_version FROM camera WHERE id=$1', [camera.id]))[0]
        .configuration_version,
      '1',
    );
    assert.equal(
      (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
        .configuration_locked,
      false,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM camera_observation_region WHERE camera_id=$1',
          [camera.id],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_camera_fact_failure ON mf06_authority_fact;DROP FUNCTION test_camera_fact_failure()',
    );
  }
});
test('postcommit witness failure preserves successful existing API semantics without advising an unsafe create retry', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_camera_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic witness failure';END $$;CREATE TRIGGER test_camera_witness_failure BEFORE INSERT ON mf06_authority_commit_witness FOR EACH ROW EXECUTE FUNCTION test_camera_witness_failure()",
  );
  try {
    const camera = await create(f);
    assert.ok(camera.id);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
      1,
    );
    const row = (
      await db.query('SELECT command_id FROM mf06_authority_fact WHERE source_id=$1', [camera.id])
    )[0];
    assert.ok(row.command_id);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM mf06_authority_commit_witness WHERE command_id=$1',
          [row.command_id],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_camera_witness_failure ON mf06_authority_commit_witness;DROP FUNCTION test_camera_witness_failure()',
    );
  }
});
test('partial installed journal fails closed before Camera create', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE mf06_authority_commit_witness RENAME TO test_hidden_camera_witness');
  try {
    await assert.rejects(create(f), status(503));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
      0,
    );
  } finally {
    await db.query(
      'ALTER TABLE test_hidden_camera_witness RENAME TO mf06_authority_commit_witness',
    );
  }
});
test('legacy internal caller without actor never receives fabricated main attribution', async () => {
  const f = await fixture(),
    code = randomUUID();
  const camera = await f.service.create(f.siteId, {
    code,
    name: 'Synthetic legacy camera',
    externalId: code,
  });
  assert.equal(
    (
      await db.query('SELECT command_id FROM mf06_authority_fact WHERE source_id=$1', [camera.id])
    )[0].command_id,
    null,
  );
});

test('disabled capture trigger refuses an authenticated mutation before writing', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE camera DISABLE TRIGGER trg_mf06_capture_camera');
  try {
    await assert.rejects(create(f), status(503));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
      0,
    );
  } finally {
    await db.query('ALTER TABLE camera ENABLE TRIGGER trg_mf06_capture_camera');
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
  const password = 'SyntheticCamera123!';
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
    const controller = module.get(CamerasController) as unknown as { auth: UserAuthGuard };
    await work(request, controller.auth, () =>
      request('/auth/logout', { clientType: 'MOBILE', refreshToken: session.refreshToken }),
    );
  } finally {
    await app.close();
    if (apiDatabase.isInitialized) await apiDatabase.destroy();
  }
}

test('actual AppModule HTTP Camera and Region endpoints bind the real authenticated actor on all five writes', async () => {
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
    const root = `/sites/${f.siteId}/cameras`,
      code = randomUUID();
    const created = await request(root, { code, externalId: code, name: 'HTTP synthetic Camera' });
    assert.equal(created.status, 201);
    const camera = (await created.json()) as Camera;
    assert.equal((await attribution(camera.id, 'CAMERA_CREATE')).actor_user_id, f.actorUserId);
    const linked = await request(`${root}/${camera.id}/regions`, {
      zoneId: f.zoneId,
      polygon: triangle,
      expectedConfigurationVersion: 1,
    });
    assert.equal(linked.status, 201);
    const region = ((await linked.json()) as { region: Region }).region;
    assert.equal((await attribution(region.id, 'REGION_CREATE')).actor_user_id, f.actorUserId);
    assert.equal(
      (
        await request(
          `${root}/${camera.id}/regions/${region.id}/polygon`,
          {
            polygon: {
              coordinates: [
                [0, 0],
                [0.9, 0],
                [0, 0.9],
              ],
            },
            expectedConfigurationVersion: 2,
          },
          'PATCH',
        )
      ).status,
      200,
    );
    await attribution(region.id, 'REGION_POLYGON_UPDATE');
    assert.equal(
      (
        await request(
          `${root}/${camera.id}/regions/${region.id}/status`,
          { isActive: false, expectedConfigurationVersion: 3 },
          'PATCH',
        )
      ).status,
      200,
    );
    await attribution(region.id, 'REGION_STATUS_UPDATE');
    assert.equal(
      (
        await request(
          `${root}/${camera.id}/status`,
          { status: 'INACTIVE', expectedConfigurationVersion: 4 },
          'PATCH',
        )
      ).status,
      200,
    );
    await attribution(camera.id, 'CAMERA_STATUS_UPDATE');
    assert.equal(claims, 5);
  });
});

test('actual HTTP logout between initial guard and transaction claim denies Camera create without an orphan command', async () => {
  const f = await fixture();
  await withApi(f, async (request, guard, logout) => {
    let signal!: () => void, release!: () => void;
    const held = new Promise<void>((r) => {
        signal = r;
      }),
      resume = new Promise<void>((r) => {
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
    const pending = request(`/sites/${f.siteId}/cameras`, {
      code,
      externalId: code,
      name: 'Held synthetic Camera',
    });
    try {
      await Promise.race([
        held,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Transaction authentication claim was not reached')),
            3000,
          );
          timeout.unref();
        }),
      ]);
      assert.equal((await logout()).status, 204);
    } finally {
      release();
    }
    assert.equal((await pending).status, 401);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM camera WHERE site_id=$1', [f.siteId]))[0].n,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
      count,
    );
  });
});
