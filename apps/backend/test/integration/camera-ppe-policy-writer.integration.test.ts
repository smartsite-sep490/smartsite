import 'reflect-metadata';
import { CameraPpePolicyService } from '../../src/modules/cameras/camera-ppe-policy.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import type { CameraConfigurationBundle } from '@smartsite/contracts';
import { CameraPpePolicyStorage1795046400010 } from '../../src/database/migrations/1795046400010-CameraPpePolicyStorage.js';
import { readCurrentCameraPolicyBundle } from '../../src/modules/cameras/camera-policy-bundle-reader.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { CAMERA_CONFIGURATION_IMAGE_FETCH } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { buildSourcePayload } from '../support/camera-configuration-image-fixture.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
const bundleMigrations = db.options.migrations;
assert(Array.isArray(bundleMigrations));
db.setOptions({
  migrations: bundleMigrations.filter(
    (m) => typeof m === 'function' && Number(m.name.match(/\d{13}$/)?.[0]) <= 1794528000000,
  ),
});
let app: NestExpressApplication, auth: AuthService, base: string;
const site = randomUUID(),
  otherSite = randomUUID(),
  camera = randomUUID();
let hash: string;
const password = 'Synthetic_camera_password_123';
let sourceSession = randomUUID();
before(async () => {
  await owned.initialize();
  hash = await hashPassword(password);
  await db.query(
    'INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text),($2::uuid,$2::text,$2::text)',
    [site, otherSite],
  );
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,'camera-a','SYNTHETIC','Synthetic camera')",
    [camera, site],
  );
  const config = createTestConfig({
    LOG_FORMAT: 'json',
    ...(process.env.TEST_CAMERA_POLICY_BROWSER_SCRIPT
      ? { CORS_ORIGINS: 'http://127.0.0.1:5198' }
      : {}),
    AI_CONFIGURATION_CAMERA_IDS: camera,
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-bundle-source-token',
    SMARTSITE_AI_PREVIEW_SOURCES: '{"camera-a":"http://ai-source.test"}',
  });
  const browserJpeg = process.env.TEST_CAMERA_POLICY_BROWSER_SCRIPT
    ? await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ddeeff' } })
        .jpeg()
        .toBuffer()
    : undefined;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(CAMERA_CONFIGURATION_IMAGE_FETCH)
    .useValue(async (url: string, options: RequestInit) => {
      assert.equal(
        url,
        'http://ai-source.test/v1/realtime/configuration-image?cameraExternalId=camera-a',
      );
      assert.equal(options.redirect, 'error');
      return new Response(
        JSON.stringify(
          buildSourcePayload({
            capturedAt: new Date().toISOString(),
            frame: {
              sessionId: sourceSession,
              ...(browserJpeg
                ? {
                    imageDataUrl: 'data:image/jpeg;base64,' + browserJpeg.toString('base64'),
                    imageSha256: createHash('sha256').update(browserJpeg).digest('hex'),
                  }
                : {}),
            },
          }),
        ),
        { headers: { 'Content-Type': 'application/json' } },
      );
    })
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1/sites/${site}/cameras/${camera}`;
  auth = module.get(AuthService);
});
after(async () => {
  if (app) await app.close();
  await owned.dispose();
});

async function actor(role: string, siteId: string | null) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,$2)',
    [id, hash],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    id,
    siteId,
    role,
  ]);
  const session = await auth.login(id, password, AuthClientType.WEB);
  return { id, session, headers: { Authorization: `Bearer ${session.accessToken}` } };
}

const polygon = {
  coordinates: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.5, 0.9],
  ],
};
const serviceHeaders = { Authorization: 'Bearer synthetic-bundle-source-token' };
const bundleUrl = () =>
  `${base.replace('/sites/', '/integrations/ai/sites/').replace(`/sites/${site}`, '')}/configuration-bundle`;

test('authorized PPE commands initialize, revise and replay one immutable camera bundle', async (t) => {
  const manager = await actor('SITE_MANAGER', site);
  const officer = await actor('SAFETY_OFFICER', site);
  const outsider = await actor('SITE_MANAGER', otherSite);
  const context = (account: typeof manager): MainConfigurationCommandContext => ({
    actorUserId: account.id,
    reauthorize: async (tx) => {
      const checked = await auth.authenticate(account.session.accessToken, tx);
      assert.equal(checked.user.id, account.id);
    },
  });
  const zoneResponse = await fetch(`${base.slice(0, base.indexOf('/cameras/'))}/zones`, {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Legacy empty PPE',
      type: 'STANDARD',
      restrictionPolicy: 'NONE',
      requiredPpe: [],
    }),
  });
  assert.equal(zoneResponse.status, 201);
  const zoneId = (await zoneResponse.json()).id;
  const refResponse = await fetch(`${base}/configuration-reference`, { headers: manager.headers });
  assert.equal(refResponse.status, 200);
  const ref = (await refResponse.json()).reference;
  const save = await fetch(`${base}/reference-regions`, {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zoneId,
      polygon,
      expectedConfigurationVersion: ref.configurationVersion,
      referenceId: ref.referenceId,
      viewRevision: ref.viewRevision,
      confirmReferenceView: true,
    }),
  });
  assert.equal(save.status, 201);
  const regionId = (await save.json()).region.id as string;
  const dormantReferenceResponse = await fetch(`${base}/configuration-reference`, {
    headers: manager.headers,
  });
  assert.equal(dormantReferenceResponse.status, 200);
  const dormantReference = (await dormantReferenceResponse.json()).reference;
  const dormantSave = await fetch(`${base}/reference-regions`, {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zoneId,
      polygon,
      expectedConfigurationVersion: dormantReference.configurationVersion,
      referenceId: dormantReference.referenceId,
      viewRevision: dormantReference.viewRevision,
      confirmReferenceView: true,
    }),
  });
  assert.equal(dormantSave.status, 201);
  const dormantResult = await dormantSave.json();
  const dormantId = dormantResult.region.id as string;
  const dormantOff = await fetch(`${base}/regions/${dormantId}/status`, {
    method: 'PATCH',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedConfigurationVersion: dormantResult.configurationVersion,
      isActive: false,
    }),
  });
  assert.equal(dormantOff.status, 200);
  const legacyResponse = await fetch(bundleUrl(), { headers: serviceHeaders });
  assert.equal(legacyResponse.status, 200);
  const legacy = (await legacyResponse.json()) as CameraConfigurationBundle;
  assert.deepEqual(legacy.regions[0]!.requiredPpe, []);
  await t.test('v2 polling requires deliberate adoption before conditional caching', async () => {
    const response = await fetch(bundleUrl() + '/v2', {
      headers: { ...serviceHeaders, 'If-None-Match': '*' },
    });
    assert.equal(response.status, 409);
  });
  const policyRequest = (path: string, method: string, body: unknown, headers = manager.headers) =>
    fetch(`${base}/ppe-policy${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const beforeMigration = {
    commandId: randomUUID(),
    expectedConfigurationVersion: legacy.configurationVersion,
    policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
    regionPolicies: [{ regionId, policy: { mode: 'INHERIT' } }],
  };
  assert.equal((await policyRequest('/initialize', 'POST', beforeMigration)).status, 503);
  const uninitialized = await policyRequest('', 'GET', undefined, officer.headers);
  assert.equal(uninitialized.status, 200);
  assert.deepEqual(await uninitialized.json(), {
    cameraId: camera,
    regionId: null,
    configurationVersion: legacy.configurationVersion,
    savedRevision: null,
    policy: null,
  });
  assert.equal((await policyRequest('', 'GET', undefined, outsider.headers)).status, 403);
  await db.transaction((tx) => new CameraPpePolicyStorage1795046400010().up(tx.queryRunner!));
  const writer = new CameraPpePolicyService(db, app.get(ZoneConfigurationService));
  const initial = {
    commandId: randomUUID(),
    expectedConfigurationVersion: legacy.configurationVersion,
    policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
    regionPolicies: [{ regionId, policy: { mode: 'INHERIT' } }],
  };
  const current = () => db.transaction((tx) => readCurrentCameraPolicyBundle(tx, camera));
  const count = async () =>
    Number((await db.query('SELECT count(*) AS n FROM camera_configuration_bundle'))[0].n);
  const initialCount = await count();
  await t.test('missing session callback, wrong role and wrong Site cannot write', async () => {
    await assert.rejects(writer.initialize(site, camera, initial, { actorUserId: manager.id }));
    await assert.rejects(
      writer.initialize(site, camera, initial, context(officer)),
      /Site Manager/,
    );
    await assert.rejects(
      writer.initialize(site, camera, initial, context(outsider)),
      /Site Manager/,
    );
    assert.equal(await count(), initialCount);
  });
  await t.test(
    'initial adoption requires every active Region and refuses invented IDs',
    async () => {
      for (const regionPolicies of [
        [],
        [{ regionId: randomUUID(), policy: { mode: 'INHERIT' } }],
      ]) {
        await assert.rejects(
          writer.initialize(site, camera, { ...initial, regionPolicies }, context(manager)),
          /Region/,
        );
      }
      assert.equal(await count(), initialCount);
    },
  );
  let result: Awaited<ReturnType<CameraPpePolicyService['initialize']>>;
  await t.test(
    'initialization commits explicit user choice without altering legacy history',
    async () => {
      assert.equal(
        (await policyRequest('/initialize', 'POST', initial, officer.headers)).status,
        403,
      );
      assert.equal(
        (await policyRequest('/initialize', 'POST', initial, outsider.headers)).status,
        403,
      );
      const response = await policyRequest('/initialize', 'POST', initial);
      assert.equal(response.status, 201);
      result = await response.json();
      assert.equal(result.configurationVersion, legacy.configurationVersion + 1);
      const oldWorker = await fetch(bundleUrl(), {
        headers: { ...serviceHeaders, 'If-None-Match': '*' },
      });
      assert.equal(oldWorker.status, 409);
      assert.equal(
        (await oldWorker.json()).message,
        'Camera requires policy configuration bundle v2',
      );
      assert.equal(result.replayed, false);
      const bundle = await current();
      assert.deepEqual(bundle.cameraPpePolicy, initial.policy);
      assert.deepEqual(bundle.regions[0]!.ppePolicy, { mode: 'INHERIT' });
      assert.equal(bundle.bundleSha256, result.bundleSha256);
      assert.equal(
        (
          await db.query(
            'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE configuration_version=$1',
            [legacy.configurationVersion],
          )
        )[0].bundle_sha256,
        legacy.bundleSha256,
      );
    },
  );
  await t.test('exact replay returns original issuance and changed reuse conflicts', async () => {
    assert.deepEqual(await writer.initialize(site, camera, initial, context(manager)), {
      ...result,
      replayed: true,
    });
    await assert.rejects(
      writer.initialize(
        site,
        camera,
        { ...initial, policy: { mode: 'DISABLED', reason: 'changed' } },
        context(manager),
      ),
      /command/i,
    );
    assert.equal(await count(), initialCount + 1);
  });
  await t.test('Region override and later camera default preserve each other', async () => {
    const regionResponse = await policyRequest(`/regions/${regionId}`, 'PATCH', {
      commandId: randomUUID(),
      expectedConfigurationVersion: result.configurationVersion,
      policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
    });
    assert.equal(regionResponse.status, 200);
    const region = await regionResponse.json();
    const cameraResponse = await policyRequest('', 'PATCH', {
      commandId: randomUUID(),
      expectedConfigurationVersion: region.configurationVersion,
      policy: { mode: 'DISABLED', reason: 'Camera default paused' },
    });
    assert.equal(cameraResponse.status, 200);
    const bundle = await current();
    assert.deepEqual(bundle.cameraPpePolicy, { mode: 'DISABLED', reason: 'Camera default paused' });
    assert.deepEqual(bundle.regions[0]!.ppePolicy, { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] });
    await assert.rejects(
      writer.setCameraPolicy(
        site,
        camera,
        {
          commandId: randomUUID(),
          expectedConfigurationVersion: result.configurationVersion,
          policy: initial.policy,
        },
        context(manager),
      ),
      /version/,
    );
  });
  await t.test(
    'two concurrent revisions commit only one and retrying its command is idempotent',
    async () => {
      const bundle = await current();
      const commands = [0, 1].map(() => ({
        commandId: randomUUID(),
        expectedConfigurationVersion: bundle.configurationVersion,
        policy: initial.policy,
      }));
      const outcomes = await Promise.allSettled(
        commands.map((command) => writer.setCameraPolicy(site, camera, command, context(manager))),
      );
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
      const winner = outcomes.findIndex((outcome) => outcome.status === 'fulfilled');
      assert.equal(
        (await writer.setCameraPolicy(site, camera, commands[winner], context(manager))).replayed,
        true,
      );
    },
  );
  await t.test(
    'child insertion failure rolls back header and camera counter together',
    async () => {
      const before = await current(),
        rows = await count();
      await db.query(`CREATE FUNCTION fail_policy_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic binding failure' USING ERRCODE='23514'; END $$`);
      await db.query(`CREATE TRIGGER fail_policy_binding BEFORE INSERT ON camera_configuration_bundle_region
      FOR EACH ROW EXECUTE FUNCTION fail_policy_binding()`);
      try {
        await assert.rejects(
          writer.setRegionPolicy(
            site,
            camera,
            regionId,
            {
              commandId: randomUUID(),
              expectedConfigurationVersion: before.configurationVersion,
              policy: { mode: 'INHERIT' },
            },
            context(manager),
          ),
          /Synthetic binding failure/,
        );
        assert.equal(await count(), rows);
        assert.deepEqual(await current(), before);
      } finally {
        await db.query('DROP TRIGGER fail_policy_binding ON camera_configuration_bundle_region');
        await db.query('DROP FUNCTION fail_policy_binding()');
      }
    },
  );
  await t.test('same command cannot commit for two different cameras concurrently', async () => {
    const second = randomUUID();
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,'second-camera','SECOND','Second')",
      [second, site],
    );
    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,
      width,height,view_validity,is_current,created_at) VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
      [second, site, randomUUID()],
    );
    const before = await current(),
      rows = await count(),
      commandId = randomUUID();
    const outcomes = await Promise.allSettled([
      writer.setCameraPolicy(
        site,
        camera,
        {
          commandId,
          expectedConfigurationVersion: before.configurationVersion,
          policy: initial.policy,
        },
        context(manager),
      ),
      writer.initialize(
        site,
        second,
        { commandId, expectedConfigurationVersion: 1, policy: initial.policy, regionPolicies: [] },
        context(manager),
      ),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
    assert.equal(await count(), rows + 1);
    const versions = await db.query(
      'SELECT id,configuration_version FROM camera WHERE id=ANY($1::uuid[])',
      [[camera, second]],
    );
    const winner = outcomes.findIndex((outcome) => outcome.status === 'fulfilled');
    for (const row of versions)
      assert.equal(
        Number(row.configuration_version),
        row.id === camera
          ? before.configurationVersion + (winner === 0 ? 1 : 0)
          : winner === 1
            ? 2
            : 1,
      );
  });
  const mutate = async (path: string, body: unknown) => {
    const response = await fetch(`${base}/${path}`, {
      method: 'PATCH',
      headers: { ...manager.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const reference = async () => {
    const response = await fetch(`${base}/configuration-reference`, { headers: manager.headers });
    assert.equal(response.status, 200);
    return (await response.json()).reference;
  };
  await t.test(
    'reference polygon updates preserve independent camera and Region policies',
    async () => {
      const before = await current(),
        ref = await reference();
      await mutate(`regions/${regionId}/reference-polygon`, {
        expectedConfigurationVersion: before.configurationVersion,
        referenceId: ref.referenceId,
        viewRevision: ref.viewRevision,
        confirmReferenceView: true,
        polygon: {
          coordinates: [
            [0.15, 0.15],
            [0.85, 0.15],
            [0.5, 0.85],
          ],
        },
      });
      const after = await current();
      assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
      assert.deepEqual(after.regions[0]!.ppePolicy, before.regions[0]!.ppePolicy);
      assert.equal(after.regions[0]!.geometryVersion, before.regions[0]!.geometryVersion + 1);
      assert.notEqual(after.bundleSha256, before.bundleSha256);
    },
  );
  await t.test(
    'Region disable/re-enable restores its retained policy after an empty bundle',
    async () => {
      const before = await current();
      await mutate(`regions/${regionId}/status`, {
        expectedConfigurationVersion: before.configurationVersion,
        isActive: false,
      });
      const empty = await current();
      assert.equal(empty.regions.length, 0);
      await mutate(`regions/${regionId}/status`, {
        expectedConfigurationVersion: empty.configurationVersion,
        isActive: true,
      });
      const after = await current();
      assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
      assert.deepEqual(after.regions[0]!.ppePolicy, before.regions[0]!.ppePolicy);
    },
  );
  await t.test('Camera disable/re-enable preserves v2 through a counter gap', async () => {
    const before = await current(),
      rows = await count();
    await mutate('status', {
      expectedConfigurationVersion: before.configurationVersion,
      status: 'INACTIVE',
    });
    const saved = await policyRequest(`/regions/${regionId}`, 'GET', undefined, officer.headers);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      cameraId: camera,
      regionId,
      configurationVersion: before.configurationVersion + 1,
      savedRevision: before.configurationVersion,
      policy: before.regions[0]!.ppePolicy,
    });
    assert.equal((await policyRequest(`/regions/${randomUUID()}`, 'GET', undefined)).status, 404);
    assert.equal(await count(), rows);
    await mutate('status', {
      expectedConfigurationVersion: before.configurationVersion + 1,
      status: 'ACTIVE',
    });
    const after = await current();
    assert.equal(after.configurationVersion, before.configurationVersion + 2);
    assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
    assert.deepEqual(after.regions[0]!.ppePolicy, before.regions[0]!.ppePolicy);
  });
  await t.test(
    'a new v2 Region needs deliberate PPE and cannot silently downgrade the Camera',
    async () => {
      const before = await current(),
        ref = await reference(),
        rows = await count();
      const input = {
        zoneId,
        polygon,
        expectedConfigurationVersion: before.configurationVersion,
        referenceId: ref.referenceId,
        viewRevision: ref.viewRevision,
        confirmReferenceView: true,
      };
      const response = await fetch(`${base}/reference-regions`, {
        method: 'POST',
        headers: { ...manager.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 409);
      assert.equal(await count(), rows);
      assert.deepEqual(await current(), before);
      const command = { ...input, ppePolicy: { mode: 'INHERIT' } };
      assert.equal(
        (await policyRequest('/reference-regions', 'POST', command, officer.headers)).status,
        403,
      );
      assert.equal((await policyRequest('/reference-regions', 'POST', input)).status, 400);
      assert.equal(await count(), rows);
      const created = await policyRequest('/reference-regions', 'POST', command);
      assert.equal(created.status, 201);
      const { region: added, configurationVersion } = await created.json();
      const after = await current();
      assert.equal(configurationVersion, after.configurationVersion);
      assert.equal(added.geometryConfirmation.referenceId, ref.referenceId);
      assert.equal((await policyRequest('/reference-regions', 'POST', command)).status, 409);
      assert.equal(await count(), rows + 1);
      assert.equal(after.regions.length, 2);
      assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
      assert.deepEqual(after.regions.find((region) => region.regionId === added.id)!.ppePolicy, {
        mode: 'INHERIT',
      });
      assert.deepEqual(
        after.regions.find((region) => region.regionId === regionId)!.ppePolicy,
        before.regions[0]!.ppePolicy,
      );
    },
  );
  await t.test(
    'unconfirmed polygon edit pauses issuance and later confirmation retains PPE',
    async () => {
      const before = await current(),
        rows = await count();
      const changed = {
        coordinates: [
          [0.2, 0.2],
          [0.8, 0.2],
          [0.5, 0.8],
        ],
      };
      await mutate(`regions/${regionId}/polygon`, {
        expectedConfigurationVersion: before.configurationVersion,
        polygon: changed,
      });
      assert.equal(await count(), rows);
      await assert.rejects(current(), /unavailable/);
      const ref = await reference();
      const regionCount = Number(
        (
          await db.query('SELECT count(*) AS n FROM camera_observation_region WHERE camera_id=$1', [
            camera,
          ])
        )[0].n,
      );
      await assert.rejects(
        app.get(CameraConfigurationService).createPolicyReferenceRegion(
          site,
          camera,
          {
            zoneId,
            polygon,
            expectedConfigurationVersion: before.configurationVersion + 1,
            referenceId: ref.referenceId,
            viewRevision: ref.viewRevision,
            confirmReferenceView: true,
            ppePolicy: { mode: 'INHERIT' },
          },
          manager.session.accessToken,
          context(manager),
        ),
        /unavailable/,
      );
      assert.equal(
        Number(
          (
            await db.query(
              'SELECT count(*) AS n FROM camera_observation_region WHERE camera_id=$1',
              [camera],
            )
          )[0].n,
        ),
        regionCount,
      );
      await mutate(`regions/${regionId}/reference-polygon`, {
        expectedConfigurationVersion: before.configurationVersion + 1,
        referenceId: ref.referenceId,
        viewRevision: ref.viewRevision,
        confirmReferenceView: true,
        polygon: changed,
      });
      const after = await current();
      assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
      for (const region of before.regions)
        assert.deepEqual(
          after.regions.find((row) => row.regionId === region.regionId)!.ppePolicy,
          region.ppePolicy,
        );
    },
  );
  await t.test(
    'new source view waits for all manual confirmations while retaining all policies',
    async () => {
      const before = await current(),
        rows = await count();
      sourceSession = randomUUID();
      await reference();
      await assert.rejects(current(), /unavailable/);
      assert.equal(await count(), rows);
      let revision = before.configurationVersion;
      for (const region of before.regions) {
        const ref = await reference();
        await mutate(`regions/${region.regionId}/reference-polygon`, {
          expectedConfigurationVersion: revision++,
          referenceId: ref.referenceId,
          viewRevision: ref.viewRevision,
          confirmReferenceView: true,
          polygon: region.polygon,
        });
      }
      const after = await current();
      assert.equal(after.viewRevision, before.viewRevision + 1);
      assert.deepEqual(after.cameraPpePolicy, before.cameraPpePolicy);
      for (const region of before.regions)
        assert.deepEqual(
          after.regions.find((row) => row.regionId === region.regionId)!.ppePolicy,
          region.ppePolicy,
        );
      assert.equal(await count(), rows + 1);
    },
  );
  await t.test(
    'unadopted inactive Region refuses implicit activation and stale-view policy adoption atomically',
    async () => {
      const before = await current(),
        rows = await count();
      const dormant = await db.query(
        'SELECT is_active,version FROM camera_observation_region WHERE id=$1',
        [dormantId],
      );
      const ordinary = await fetch(`${base}/regions/${dormantId}/status`, {
        method: 'PATCH',
        headers: { ...manager.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedConfigurationVersion: before.configurationVersion,
          isActive: true,
        }),
      });
      assert.equal(ordinary.status, 409);
      const ready = await current();
      const activation = {
        commandId: randomUUID(),
        expectedConfigurationVersion: ready.configurationVersion,
        policy: { mode: 'EXPLICIT', requiredPpe: ['BOOTS'] },
      };
      await assert.rejects(
        writer.activateRegionWithPolicy(site, camera, dormantId, activation, context(officer)),
        /Site Manager/,
      );
      await assert.rejects(
        writer.activateRegionWithPolicy(site, camera, dormantId, activation, context(manager)),
        /confirmed/,
      );
      assert.deepEqual(
        await db.query('SELECT is_active,version FROM camera_observation_region WHERE id=$1', [
          dormantId,
        ]),
        dormant,
      );
      assert.deepEqual(await current(), ready);
      assert.equal(await count(), rows);
    },
  );
  await t.test(
    'manual inactive confirmation and explicit activation adopt policy with replay protection',
    async () => {
      const before = await current(),
        ref = await reference();
      await mutate(`regions/${dormantId}/reference-polygon`, {
        expectedConfigurationVersion: before.configurationVersion,
        referenceId: ref.referenceId,
        viewRevision: ref.viewRevision,
        confirmReferenceView: true,
        polygon,
      });
      const ready = await current();
      const input = {
        commandId: randomUUID(),
        expectedConfigurationVersion: ready.configurationVersion,
        policy: { mode: 'EXPLICIT', requiredPpe: ['BOOTS'] },
      };
      const response = await policyRequest(`/regions/${dormantId}/activate`, 'POST', input);
      assert.equal(response.status, 201);
      const saved = await response.json();
      const after = await current();
      assert.equal(after.configurationVersion, ready.configurationVersion + 1);
      assert.deepEqual(after.cameraPpePolicy, ready.cameraPpePolicy);
      assert.deepEqual(
        after.regions.find((region) => region.regionId === dormantId)!.ppePolicy,
        input.policy,
      );
      for (const region of ready.regions)
        assert.deepEqual(
          after.regions.find((row) => row.regionId === region.regionId)!.ppePolicy,
          region.ppePolicy,
        );
      assert.deepEqual(
        await writer.activateRegionWithPolicy(site, camera, dormantId, input, context(manager)),
        { ...saved, replayed: true },
      );
      await assert.rejects(
        writer.activateRegionWithPolicy(
          site,
          camera,
          dormantId,
          { ...input, policy: { mode: 'INHERIT' } },
          context(manager),
        ),
        /command/,
      );
      await mutate(`regions/${dormantId}/status`, {
        expectedConfigurationVersion: after.configurationVersion,
        isActive: false,
      });
      const empty = await current();
      await mutate(`regions/${dormantId}/status`, {
        expectedConfigurationVersion: empty.configurationVersion,
        isActive: true,
      });
      assert.deepEqual(
        (await current()).regions.find((region) => region.regionId === dormantId)!.ppePolicy,
        input.policy,
      );
    },
  );
  await t.test('revocation prevents even an otherwise valid replay', async () => {
    await db.query("DELETE FROM user_role_assignment WHERE user_id=$1 AND role='SITE_MANAGER'", [
      manager.id,
    ]);
    await assert.rejects(
      writer.initialize(site, camera, initial, context(manager)),
      (error: unknown) => (error as { getStatus: () => number }).getStatus() === 401,
    );
  });
  const browserScript = process.env.TEST_CAMERA_POLICY_BROWSER_SCRIPT;
  if (browserScript) {
    await t.test(
      'Site Manager configures a reference-bound PPE region in installed Chrome',
      async () => {
        const browserActor = await actor('SITE_MANAGER', site);
        const browserEnv: NodeJS.ProcessEnv = { ...process.env, VITE_API_URL: await app.getUrl() };
        delete browserEnv.TEST_DATABASE_URL;
        delete browserEnv.PGPASSWORD;
        const child = spawn(process.execPath, [browserScript], {
          env: browserEnv,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
        });
        const completion = new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
          child.stdin.on('error', reject);
        });
        child.stdin.end(
          JSON.stringify({ siteId: site, cameraId: camera, manager: browserActor.id, password }),
        );
        const timeout = setTimeout(() => child.kill(), 60_000);
        const exitCode = await completion.finally(() => clearTimeout(timeout));
        const safe = output.replaceAll(password, '[TEST_PASSWORD]');
        assert.equal(exitCode, 0, safe);
        process.stdout.write(safe);
      },
    );
  }
});
