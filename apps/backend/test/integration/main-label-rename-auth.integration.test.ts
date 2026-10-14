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
import { hashPassword } from '../../src/modules/auth/password.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';

const database = createIsolatedTestDatabase({ legacy: true }),
  db = database.dataSource;

before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});

after(async () => {
  await database.dispose();
});

// -----------------------------------------------------------------------------
// Barrier & Interception Utility (safe argument forwarding, <=5s timeout)
// -----------------------------------------------------------------------------

interface RenameBarrier {
  notifyEntered: () => void;
  waitUntilEntered: () => Promise<void>;
  release: () => void;
  waitUntilReleased: () => Promise<void>;
}

function createBarrier(timeoutMs = 5000): RenameBarrier {
  const latch = (message: string) => {
    let resolve!: () => void;
    let timer!: ReturnType<typeof setTimeout>;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      timer = setTimeout(() => no(new Error(message)), timeoutMs);
    });
    void promise.catch(() => undefined);
    return {
      promise,
      finish: () => {
        clearTimeout(timer);
        resolve();
      },
    };
  };
  const entered = latch('Service rename entry timed out');
  const released = latch('Rename barrier release timed out');
  return {
    notifyEntered: entered.finish,
    waitUntilEntered: () => entered.promise,
    release: () => {
      entered.finish();
      released.finish();
    },
    waitUntilReleased: () => released.promise,
  };
}

interface HeldRenameService {
  rename: (...args: never[]) => Promise<unknown>;
}

function interceptServiceRename(service: HeldRenameService, barrier: RenameBarrier): () => void {
  const original = service.rename;
  (service as unknown as { rename: (...args: unknown[]) => Promise<unknown> }).rename = async (
    ...args: unknown[]
  ) => {
    barrier.notifyEntered();
    await barrier.waitUntilReleased();
    return original.apply(service, args as never[]);
  };
  return () => {
    service.rename = original;
  };
}

// -----------------------------------------------------------------------------
// Fixture & Actor Helpers
// -----------------------------------------------------------------------------

async function fixture() {
  const uniqueSuffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const f = {
    site: {
      id: randomUUID(),
      code: `site_${uniqueSuffix}`,
      name: `Synthetic Site ${uniqueSuffix}`,
    },
    otherSite: {
      id: randomUUID(),
      code: `other_${uniqueSuffix}`,
      name: `Synthetic Other Site ${uniqueSuffix}`,
    },
    zone: {
      id: randomUUID(),
      code: `zone_${uniqueSuffix}`,
      name: `Synthetic Zone ${uniqueSuffix}`,
    },
    camera: {
      id: randomUUID(),
      code: `cam_${uniqueSuffix}`,
      externalId: `ext_cam_${uniqueSuffix}`,
      name: `Synthetic Camera ${uniqueSuffix}`,
    },
    region: {
      id: randomUUID(),
      polygon: '[[0,0],[1,0],[1,1],[0,1]]',
      coordinateSpace: 'NORMALIZED_0_1',
    },
    defaultPassword: 'SyntheticAdminPass123!',
  };

  // Primary Site
  await db.query('INSERT INTO site(id,code,name,access_policy_version) VALUES($1,$2,$3,1)', [
    f.site.id,
    f.site.code,
    f.site.name,
  ]);

  // Other Site for wrong-site scoping tests
  await db.query('INSERT INTO site(id,code,name,access_policy_version) VALUES($1,$2,$3,1)', [
    f.otherSite.id,
    f.otherSite.code,
    f.otherSite.name,
  ]);

  // Zone (preserves AUTHORIZATION_REQUIRED enum)
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe,configuration_locked,created_at) VALUES($1,$2,$3,$4,'RESTRICTED','AUTHORIZATION_REQUIRED','{}',false,now())",
    [f.zone.id, f.site.id, f.zone.code, f.zone.name],
  );

  // Camera
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name,status,configuration_version,created_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',1,now())",
    [f.camera.id, f.site.id, f.camera.externalId, f.camera.code, f.camera.name],
  );

  // Region (preserves NORMALIZED_0_1 coordinate space)
  await db.query(
    'INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon,coordinate_space,version,is_active,created_at) VALUES($1,$2,$3,$4,$5,1,true,now())',
    [f.region.id, f.camera.id, f.zone.id, f.region.polygon, f.region.coordinateSpace],
  );

  return f;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function createAdmin(f: Fixture, label: string) {
  const adminId = randomUUID();
  const uniqueHex = randomUUID().replaceAll('-', '').slice(0, 8);
  const username = `adm_${label}_${uniqueHex}`;
  const passwordHash = await hashPassword(f.defaultPassword);

  await db.query(
    'INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$2,$3,$4,false,true)',
    [adminId, username, `Admin ${label}`, passwordHash],
  );

  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), adminId],
  );

  return {
    id: adminId,
    username,
    password: f.defaultPassword,
  };
}

// -----------------------------------------------------------------------------
// Application Test Harness (Real AppModule, no guard bypass)
// -----------------------------------------------------------------------------

interface ClientContext {
  call: (
    method: 'POST' | 'PATCH' | 'PUT' | 'GET',
    path: string,
    body?: unknown,
    token?: string,
  ) => Promise<Response>;
  login: (
    username: string,
    password?: string,
  ) => Promise<{ accessToken: string; refreshToken: string }>;
  siteService: SiteConfigurationService;
  zoneService: ZoneConfigurationService;
  cameraService: CameraConfigurationService;
  apiDb: DataSource;
}

async function withApi(f: Fixture, work: (ctx: ClientContext) => Promise<void>) {
  const configuration = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  const apiDb = new DataSource(db.options);
  await apiDb.initialize();

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(configuration)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(configuration, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDb)
    .overrideProvider(DataSource)
    .useValue(apiDb)
    .compile();

  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });

  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();

    const loginHelper = async (username: string, password = f.defaultPassword) => {
      const response = await fetch(url + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, clientType: 'MOBILE' }),
      });
      assert.equal(response.status, 200, `Login failed for user ${username}`);
      return (await response.json()) as { accessToken: string; refreshToken: string };
    };

    const callHelper = (
      method: 'POST' | 'PATCH' | 'PUT' | 'GET',
      path: string,
      body?: unknown,
      token?: string,
    ) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
      return fetch(url + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    const siteService = module.get(SiteConfigurationService);
    const zoneService = module.get(ZoneConfigurationService);
    const cameraService = module.get(CameraConfigurationService);

    await work({
      call: callHelper,
      login: loginHelper,
      siteService,
      zoneService,
      cameraService,
      apiDb,
    });
  } finally {
    await app.close();
    if (apiDb.isInitialized) await apiDb.destroy();
  }
}

// -----------------------------------------------------------------------------
// Route & Revocation Declarations (3 routes x 4 revocations = 12 HTTP cases)
// -----------------------------------------------------------------------------

type RouteKind = 'site' | 'zone' | 'camera';
type RevocationType = 'logout' | 'inactive' | 'role' | 'temp-password';

interface RouteConfig {
  kind: RouteKind;
  label: string;
  getPath: (f: Fixture) => string;
  getService: (ctx: ClientContext) => HeldRenameService;
  getCurrentName: (db: DataSource, f: Fixture) => Promise<string>;
}

interface RevocationConfig {
  type: RevocationType;
  label: string;
  expectedStatus: number;
  apply: (db: DataSource, adminId: string, f: Fixture) => Promise<void>;
}

const ROUTES: RouteConfig[] = [
  {
    kind: 'site',
    label: 'Site Rename (PATCH /api/v1/sites/:siteId)',
    getPath: (f) => `/api/v1/sites/${f.site.id}`,
    getService: (ctx) => ctx.siteService,
    getCurrentName: async (db, f) => {
      const rows = await db.query('SELECT name FROM site WHERE id = $1', [f.site.id]);
      return rows[0].name;
    },
  },
  {
    kind: 'zone',
    label: 'Zone Rename (PATCH /api/v1/sites/:siteId/zones/:zoneId)',
    getPath: (f) => `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
    getService: (ctx) => ctx.zoneService,
    getCurrentName: async (db, f) => {
      const rows = await db.query('SELECT name FROM zone WHERE id = $1', [f.zone.id]);
      return rows[0].name;
    },
  },
  {
    kind: 'camera',
    label: 'Camera Rename (PATCH /api/v1/sites/:siteId/cameras/:cameraId)',
    getPath: (f) => `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
    getService: (ctx) => ctx.cameraService,
    getCurrentName: async (db, f) => {
      const rows = await db.query('SELECT name FROM camera WHERE id = $1', [f.camera.id]);
      return rows[0].name;
    },
  },
];

const REVOCATIONS: RevocationConfig[] = [
  {
    type: 'logout',
    label: 'session revocation (logout)',
    expectedStatus: 401,
    apply: async (db, adminId) => {
      await db.query('UPDATE auth_session SET revoked_at = now() WHERE user_id = $1', [adminId]);
    },
  },
  {
    type: 'inactive',
    label: 'account deactivation (is_active = false)',
    expectedStatus: 401,
    apply: async (db, adminId) => {
      await db.query('UPDATE app_user SET is_active = false WHERE id = $1', [adminId]);
    },
  },
  {
    type: 'role',
    label: 'role demotion (ADMIN -> WORKER)',
    expectedStatus: 403,
    apply: async (db, adminId, f) => {
      await db.query(
        "UPDATE user_role_assignment SET role = 'WORKER', site_id = $2 WHERE user_id = $1 AND role = 'ADMIN'",
        [adminId, f.site.id],
      );
    },
  },
  {
    type: 'temp-password',
    label: 'temporary password flag (must_change_password = true)',
    expectedStatus: 403,
    apply: async (db, adminId) => {
      await db.query('UPDATE app_user SET must_change_password = true WHERE id = $1', [adminId]);
    },
  },
];

// -----------------------------------------------------------------------------
// Suite 1-3: 12 HTTP Revocation Cases (3 routes x 4 revocations)
// -----------------------------------------------------------------------------

for (const route of ROUTES) {
  test(`[Route: ${route.kind}] Reauthorizes at entry against 4 revocation conditions during held execution`, async () => {
    const f = await fixture();
    await withApi(f, async (ctx) => {
      for (const rev of REVOCATIONS) {
        // Dedicated actor per case: avoids crosstalk and complies with login rate limits (4 logins <= 5 throttle)
        const admin = await createAdmin(f, `${route.kind}_${rev.type}`);
        const session = await ctx.login(admin.username);
        const barrier = createBarrier(5000);
        const service = route.getService(ctx);
        const restore = interceptServiceRename(service, barrier);

        try {
          const originalName = await route.getCurrentName(db, f);
          const targetName = `Attempt_${route.kind}_${rev.type}_${randomUUID().slice(0, 6)}`;

          const reqPromise = ctx.call(
            'PATCH',
            route.getPath(f),
            { name: targetName },
            session.accessToken,
          );

          // Wait until HTTP guards have passed and service.rename is entered
          await barrier.waitUntilEntered();

          // Mutate authorization state before releasing service execution
          await rev.apply(db, admin.id, f);

          // Release service execution
          barrier.release();

          const res = await reqPromise;

          // Expect 401 on logout/inactive, 403 on role demotion/temp password.
          // Note: Current backend (HEAD 9c14751) returns 200 because it lacks configurationCommandContext;
          // this assert will legitimately fail RED until Root fixes source.
          assert.equal(
            res.status,
            rev.expectedStatus,
            `[${route.kind} x ${rev.type}] Expected HTTP ${rev.expectedStatus} on mid-flight revocation, got ${res.status}`,
          );

          // Verify entity name in database remains completely unchanged
          const nameAfter = await route.getCurrentName(db, f);
          assert.equal(
            nameAfter,
            originalName,
            `[${route.kind} x ${rev.type}] Name must remain unchanged in database`,
          );
        } finally {
          restore();
          barrier.release();
        }
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Suite 4: Happy path (Unicode trim), No-op, Invariant preservation & Zero Authority side-effects
// -----------------------------------------------------------------------------

test('Label renames happy path trims Unicode, handles no-op, preserves invariants, and produces zero authority records', async () => {
  const f = await fixture();
  const admin = await createAdmin(f, 'happy');

  await withApi(f, async ({ call, login }) => {
    const session = await login(admin.username);

    // Measure baseline counts of authority tables (must not have any new records)
    const beforeCommands = (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_command')
    )[0].n as number;
    const beforeFacts = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact'))[0]
      .n as number;
    const beforeWitnesses = (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_commit_witness')
    )[0].n as number;

    // 1. Site Rename with Unicode & surrounding whitespace
    const unicodeSiteName = '   Công Trường Phía Đông - Khu Vực \u{1F3D7}   ';
    const expectedTrimmedSiteName = 'Công Trường Phía Đông - Khu Vực \u{1F3D7}';
    const siteRes = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: unicodeSiteName },
      session.accessToken,
    );
    assert.equal(siteRes.status, 200);
    const siteJson = (await siteRes.json()) as { id: string; name: string };
    assert.equal(siteJson.name, expectedTrimmedSiteName);

    // Verify Site in database
    const [siteDb] = await db.query(
      'SELECT name, code, access_policy_version FROM site WHERE id = $1',
      [f.site.id],
    );
    assert.equal(siteDb.name, expectedTrimmedSiteName);
    assert.equal(siteDb.code, f.site.code, 'Site code must remain unchanged');
    assert.equal(
      siteDb.access_policy_version,
      1,
      'Site access_policy_version must remain unchanged',
    );

    // 2. Zone Rename with Unicode & surrounding whitespace
    const unicodeZoneName = '   Khu Vực Nguy Hiểm - Hạn Chế Vào \u{26A0}   ';
    const expectedTrimmedZoneName = 'Khu Vực Nguy Hiểm - Hạn Chế Vào \u{26A0}';
    const zoneRes = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: unicodeZoneName },
      session.accessToken,
    );
    assert.equal(zoneRes.status, 200);
    const zoneJson = (await zoneRes.json()) as { id: string; name: string };
    assert.equal(zoneJson.name, expectedTrimmedZoneName);

    // Verify Zone invariants in database
    const [zoneDb] = await db.query(
      'SELECT name, code, type, restriction_policy, required_ppe, configuration_locked FROM zone WHERE id = $1',
      [f.zone.id],
    );
    assert.equal(zoneDb.name, expectedTrimmedZoneName);
    assert.equal(zoneDb.code, f.zone.code, 'Zone code must remain unchanged');
    assert.equal(zoneDb.type, 'RESTRICTED', 'Zone type must remain unchanged');
    assert.equal(
      zoneDb.restriction_policy,
      'AUTHORIZATION_REQUIRED',
      'Zone restriction_policy must remain AUTHORIZATION_REQUIRED',
    );
    assert.equal(
      zoneDb.configuration_locked,
      false,
      'Zone configuration_locked must remain unchanged',
    );

    // 3. Camera Rename with Unicode & surrounding whitespace
    const unicodeCameraName = '   Camera Quan Sát Cổng Chính \u{1F4F9}   ';
    const expectedTrimmedCameraName = 'Camera Quan Sát Cổng Chính \u{1F4F9}';
    const cameraRes = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: unicodeCameraName },
      session.accessToken,
    );
    assert.equal(cameraRes.status, 200);
    const cameraJson = (await cameraRes.json()) as { id: string; name: string };
    assert.equal(cameraJson.name, expectedTrimmedCameraName);

    // Verify Camera & Region invariants in database
    const [cameraDb] = await db.query(
      'SELECT name, code, external_id, status, configuration_version FROM camera WHERE id = $1',
      [f.camera.id],
    );
    assert.equal(cameraDb.name, expectedTrimmedCameraName);
    assert.equal(cameraDb.code, f.camera.code, 'Camera code must remain unchanged');
    assert.equal(
      cameraDb.external_id,
      f.camera.externalId,
      'Camera external_id must remain unchanged',
    );
    assert.equal(cameraDb.status, 'ACTIVE', 'Camera status must remain ACTIVE');
    assert.equal(
      cameraDb.configuration_version,
      '1',
      'Camera configuration_version must remain unchanged',
    );

    const [regionDb] = await db.query(
      'SELECT id, camera_id, zone_id, polygon, coordinate_space, version, is_active FROM camera_observation_region WHERE id = $1',
      [f.region.id],
    );
    assert.ok(regionDb, 'Attached region must remain intact');
    assert.deepEqual(
      regionDb.polygon,
      JSON.parse(f.region.polygon),
      'Region polygon geometry must remain unchanged',
    );
    assert.equal(
      regionDb.coordinate_space,
      'NORMALIZED_0_1',
      'Region coordinate_space must remain NORMALIZED_0_1',
    );
    assert.equal(regionDb.version, 1, 'Region version must remain unchanged');
    assert.equal(regionDb.is_active, true, 'Region is_active must remain unchanged');

    // 4. No-op Renames (same name submitted)
    const siteNoop = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: expectedTrimmedSiteName },
      session.accessToken,
    );
    assert.equal(siteNoop.status, 200);

    const zoneNoop = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: expectedTrimmedZoneName },
      session.accessToken,
    );
    assert.equal(zoneNoop.status, 200);

    const cameraNoop = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: expectedTrimmedCameraName },
      session.accessToken,
    );
    assert.equal(cameraNoop.status, 200);

    // 5. Assert ZERO authority records emitted for label-only renames
    const afterCommands = (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_command')
    )[0].n as number;
    const afterFacts = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact'))[0]
      .n as number;
    const afterWitnesses = (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_commit_witness')
    )[0].n as number;

    assert.equal(afterCommands, beforeCommands, 'Label renames must not emit authority commands');
    assert.equal(afterFacts, beforeFacts, 'Label renames must not emit authority facts');
    assert.equal(afterWitnesses, beforeWitnesses, 'Label renames must not emit commit witnesses');
  });
});

// -----------------------------------------------------------------------------
// Suite 5: Same-name rename no-op must still check authentication and authorization
// -----------------------------------------------------------------------------

test('Same-name rename no-op preserves authorization checking during held execution', async () => {
  const f = await fixture();
  const admin = await createAdmin(f, 'same_name_auth');

  await withApi(f, async (ctx) => {
    const session = await ctx.login(admin.username);
    const barrier = createBarrier(5000);
    const restore = interceptServiceRename(ctx.siteService, barrier);

    try {
      // Send identical name
      const reqPromise = ctx.call(
        'PATCH',
        `/api/v1/sites/${f.site.id}`,
        { name: f.site.name },
        session.accessToken,
      );

      await barrier.waitUntilEntered();

      // Deactivate actor mid-flight
      await db.query('UPDATE app_user SET is_active = false WHERE id = $1', [admin.id]);

      barrier.release();

      const res = await reqPromise;
      // Authorization must still be enforced: returns 401 Unauthorized
      assert.equal(
        res.status,
        401,
        `Same-name rename must still enforce authorization; expected 401, got ${res.status}`,
      );
    } finally {
      restore();
      barrier.release();
    }
  });
});

// -----------------------------------------------------------------------------
// Suite 6: Strict DTO Validation (400 Bad Request on control chars, max length, forbidden actor fields)
// -----------------------------------------------------------------------------

test('Label renames strictly enforce DTO validation against control characters, max length, empty names, and forbidden actor fields', async () => {
  const f = await fixture();
  const admin = await createAdmin(f, 'dto_validation');

  await withApi(f, async ({ call, login }) => {
    const session = await login(admin.username);

    // 1. Control characters rejection (\u0000, \n, \u0007)
    const siteCtrl = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: 'Invalid\u0000NullByte' },
      session.accessToken,
    );
    assert.equal(siteCtrl.status, 400, 'Control character null byte must be rejected with 400');

    const zoneCtrl = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: 'Invalid\nNewline' },
      session.accessToken,
    );
    assert.equal(zoneCtrl.status, 400, 'Control character newline must be rejected with 400');

    const cameraCtrl = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: 'Invalid\u0007Bell' },
      session.accessToken,
    );
    assert.equal(cameraCtrl.status, 400, 'Control character bell must be rejected with 400');

    // 2. Max length exceeding 255 characters
    const tooLongName = 'A'.repeat(256);
    const siteLong = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: tooLongName },
      session.accessToken,
    );
    assert.equal(siteLong.status, 400, 'Name exceeding 255 chars must be rejected with 400');

    const zoneLong = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: tooLongName },
      session.accessToken,
    );
    assert.equal(zoneLong.status, 400, 'Zone name exceeding 255 chars must be rejected with 400');

    const cameraLong = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: tooLongName },
      session.accessToken,
    );
    assert.equal(
      cameraLong.status,
      400,
      'Camera name exceeding 255 chars must be rejected with 400',
    );

    // 3. Empty or whitespace-only names
    const siteEmpty = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: '' },
      session.accessToken,
    );
    assert.equal(siteEmpty.status, 400, 'Empty site name must be rejected with 400');

    const zoneSpaces = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: '    ' },
      session.accessToken,
    );
    assert.equal(zoneSpaces.status, 400, 'Whitespace-only zone name must be rejected with 400');

    const cameraEmpty = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: '' },
      session.accessToken,
    );
    assert.equal(cameraEmpty.status, 400, 'Empty camera name must be rejected with 400');

    // 4. Forbidden actor fields (DTO whitelisting)
    const siteActor = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}`,
      { name: 'Valid Site Name', actorId: randomUUID() },
      session.accessToken,
    );
    assert.equal(siteActor.status, 400, 'Forbidden actorId field must be rejected with 400');

    const zoneActor = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${f.zone.id}`,
      { name: 'Valid Zone Name', actor_user_id: randomUUID() },
      session.accessToken,
    );
    assert.equal(zoneActor.status, 400, 'Forbidden actor_user_id field must be rejected with 400');

    const cameraActor = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${f.camera.id}`,
      { name: 'Valid Camera Name', userId: randomUUID() },
      session.accessToken,
    );
    assert.equal(cameraActor.status, 400, 'Forbidden userId field must be rejected with 400');
  });
});

// -----------------------------------------------------------------------------
// Suite 7: Routing & Scoping (404 Not Found on wrong site or missing entity)
// -----------------------------------------------------------------------------

test('Label renames enforce site scoping and missing resource 404 responses', async () => {
  const f = await fixture();
  const admin = await createAdmin(f, 'scoping_404');

  await withApi(f, async ({ call, login }) => {
    const session = await login(admin.username);
    const nonExistentId = randomUUID();

    // 1. Missing Site
    const missingSite = await call(
      'PATCH',
      `/api/v1/sites/${nonExistentId}`,
      { name: 'Any Name' },
      session.accessToken,
    );
    assert.equal(missingSite.status, 404, 'Missing site must return 404');

    // 2. Missing Zone
    const missingZone = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/zones/${nonExistentId}`,
      { name: 'Any Name' },
      session.accessToken,
    );
    assert.equal(missingZone.status, 404, 'Missing zone must return 404');

    // 3. Zone requested under Wrong Site
    const wrongSiteZone = await call(
      'PATCH',
      `/api/v1/sites/${f.otherSite.id}/zones/${f.zone.id}`,
      { name: 'Any Name' },
      session.accessToken,
    );
    assert.equal(wrongSiteZone.status, 404, 'Zone requested under wrong site must return 404');

    // 4. Missing Camera
    const missingCamera = await call(
      'PATCH',
      `/api/v1/sites/${f.site.id}/cameras/${nonExistentId}`,
      { name: 'Any Name' },
      session.accessToken,
    );
    assert.equal(missingCamera.status, 404, 'Missing camera must return 404');

    // 5. Camera requested under Wrong Site
    const wrongSiteCamera = await call(
      'PATCH',
      `/api/v1/sites/${f.otherSite.id}/cameras/${f.camera.id}`,
      { name: 'Any Name' },
      session.accessToken,
    );
    assert.equal(wrongSiteCamera.status, 404, 'Camera requested under wrong site must return 404');
  });
});
