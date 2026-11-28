import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { parseSafetyFrameInboxPage, type CameraRegionConfiguration } from '@smartsite/contracts';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { configureApplication } from '../../src/configure-app.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const FIVE_PPE = ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'] as const;
const PROFILE_HASH = 'a'.repeat(64);
const ROUTE_EPOCH = '00000000-0000-4000-8000-000000000001';
const TEST_PASSWORD = 'Synthetic_e2e_password_123';

interface CameraFixture {
  siteId: string;
  cameraId: string;
  generation: Awaited<ReturnType<typeof provisionCameraWorkerGeneration>>;
  context: {
    schemaVersion: '1.0.0';
    cameraId: string;
    workerGenerationId: string;
    streamSessionId: string;
    configurationVersion: number;
    bundleSha256: string;
    viewRevision: number;
    receiptCommandId: string;
    sourceKind: 'LIVE';
  };
  regions: [string, string];
  zones: [string, string];
}

async function applyTrackedV17Profile(schema: string) {
  const ds = new DataSource(
    buildMigrationOptions(
      { DATABASE_URL: resolveTestDatabaseUrl(), DATABASE_TIMEOUT_MS: 2000 },
      { profile: 'tracked-v17-identification-ppe', schema },
    ),
  );
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

async function seedUserWithRole(
  db: DataSource,
  passwordHash: string,
  role: 'SAFETY_OFFICER' | 'SITE_MANAGER',
  siteId: string,
): Promise<{ id: string; username: string }> {
  const id = randomUUID();
  const username = `${role.toLowerCase()}-${id.slice(0, 8)}`;
  await db.query(
    'INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,$3,$4,true,false)',
    [id, username, `Synthetic ${role}`, passwordHash],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    id,
    siteId,
    role,
  ]);
  return { id, username };
}

async function seedTwoRegionCamera(
  db: DataSource,
  issuerId: string,
  requiredPpe: readonly (typeof FIVE_PPE)[number][],
  siteId?: string,
): Promise<CameraFixture> {
  const resolvedSiteId = siteId ?? randomUUID();
  const cameraId = randomUUID();
  if (!siteId) {
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Grouped Alert Site')",
      [resolvedSiteId],
    );
  }
  await db.query(
    "INSERT INTO camera(type,id,site_id,external_id,code,name) VALUES('ZONE',$1,$2,$1::uuid::text,$1::uuid::text,'Synthetic Grouped Camera')",
    [cameraId, resolvedSiteId],
  );
  const generation = await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 120000);
  await db.query(
    `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
     VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
    [cameraId, resolvedSiteId, generation.streamSessionId],
  );
  const zonesSvc = new ZoneConfigurationService(db, new SiteConfigurationService(db));
  const zoneA = await zonesSvc.create(resolvedSiteId, {
    name: 'Synthetic Zone A',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [...requiredPpe],
  });
  const zoneB = await zonesSvc.create(resolvedSiteId, {
    name: 'Synthetic Zone B',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [...requiredPpe],
  });
  const referenceId = randomUUID();
  await db.query(
    `WITH moment AS (SELECT clock_timestamp() AS at)
     INSERT INTO camera_configuration_reference(id,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,captured_at,issued_at,expires_at,issued_by_user_id)
     SELECT $1,$2,1,$3,$4,'LIVE',120,80,$5,1,at,at,at+INTERVAL '1 minute',$6 FROM moment`,
    [referenceId, cameraId, resolvedSiteId, generation.streamSessionId, PROFILE_HASH, issuerId],
  );
  const regionA = randomUUID();
  const regionB = randomUUID();
  const polygons = [
    {
      regionId: regionA,
      zone: zoneA,
      polygon: {
        coordinates: [
          [0.05, 0.05],
          [0.55, 0.05],
          [0.55, 0.95],
          [0.05, 0.95],
        ],
      },
    },
    {
      regionId: regionB,
      zone: zoneB,
      polygon: {
        coordinates: [
          [0.45, 0.05],
          [0.95, 0.05],
          [0.95, 0.95],
          [0.45, 0.95],
        ],
      },
    },
  ] as const;
  const bundleRegions: Array<CameraRegionConfiguration['regions'][number]> = [];
  for (const item of polygons) {
    await db.query(
      'INSERT INTO camera_observation_region(site_id,id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4,$5::jsonb)',
      [resolvedSiteId, item.regionId, cameraId, item.zone.id, JSON.stringify(item.polygon)],
    );
    await db.query(
      `INSERT INTO camera_region_geometry_revision(region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline,reference_id,view_revision,confirmed_by_user_id,confirmed_at,recorded_at)
       VALUES($1,1,$2,$3,1,'NORMALIZED_0_1',$4::jsonb,true,false,$5,1,$6,clock_timestamp(),clock_timestamp())`,
      [item.regionId, cameraId, item.zone.id, JSON.stringify(item.polygon), referenceId, issuerId],
    );
    await db.transaction(async (tx) =>
      zonesSvc.markLinked(tx, await zonesSvc.lockForRegion(tx, resolvedSiteId, item.zone.id)),
    );
    bundleRegions.push({
      regionId: item.regionId,
      geometryVersion: 1,
      coordinateSpace: 'NORMALIZED_0_1' as const,
      polygon: item.polygon,
    });
  }
  await db.transaction(async (tx) => {
    await recordCameraConfigurationBundle(
      tx,
      await tx.getRepository(CameraEntity).findOneByOrFail({ id: cameraId }),
      {
        schemaVersion: '1.0.0',
        configurationVersion: 1,
        cameraExternalId: cameraId,
        regions: [...bundleRegions].sort((a, b) => a.regionId.localeCompare(b.regionId)),
      },
      zonesSvc,
    );
  });
  const [bundleRow] = await db.query<Array<{ bundle_sha256: string }>>(
    'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=1',
    [cameraId],
  );
  assert.ok(bundleRow);
  const bundleSha256 = bundleRow.bundle_sha256;
  const receiptCommandId = randomUUID();
  await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, {
    commandId: receiptCommandId,
    workerGenerationId: generation.workerGenerationId,
    streamSessionId: generation.streamSessionId,
    configurationVersion: 1,
    bundleSha256,
    viewRevision: 1,
    outcome: 'LOADED',
  });
  return {
    siteId: resolvedSiteId,
    cameraId,
    generation,
    context: {
      schemaVersion: '1.0.0',
      cameraId,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      receiptCommandId,
      sourceKind: 'LIVE',
    },
    regions: [regionA, regionB],
    zones: [zoneA.id, zoneB.id],
  };
}

async function initializeV2CameraPpePolicy(
  baseUrl: string,
  runtimeDb: DataSource,
  fixture: CameraFixture,
  managerToken: string,
) {
  const response = await fetch(
    `${baseUrl}/api/v1/sites/${fixture.siteId}/cameras/${fixture.cameraId}/ppe-policy/initialize`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${managerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedConfigurationVersion: 1,
        policy: { mode: 'EXPLICIT', requiredPpe: [...FIVE_PPE] },
        regionPolicies: fixture.regions.map((regionId) => ({
          regionId,
          policy: { mode: 'INHERIT' },
        })),
      }),
    },
  );
  assert.equal(response.status, 201, await response.clone().text());
  const [bundleRow] = await runtimeDb.query<Array<{ bundle_sha256: string }>>(
    'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=2',
    [fixture.cameraId],
  );
  assert.ok(bundleRow);
  const bundleSha256 = bundleRow.bundle_sha256;
  const receiptCommandId = randomUUID();
  await recordCameraConfigurationAcknowledgement(
    runtimeDb,
    fixture.cameraId,
    fixture.generation.secret,
    {
      commandId: receiptCommandId,
      workerGenerationId: fixture.generation.workerGenerationId,
      streamSessionId: fixture.generation.streamSessionId,
      configurationVersion: 2,
      bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    },
  );
  Object.assign(fixture.context, { configurationVersion: 2, bundleSha256, receiptCommandId });
}

function frameEvidence(streamSessionId: string, seq: string, eventId: string, sha256: string) {
  return [
    {
      kind: 'FRAME',
      uri: `local://evidence/${streamSessionId}/${seq}/${eventId}.jpg`,
      sha256,
    },
  ];
}

async function createSyntheticFrameJpeg(colorA: string, colorB: string) {
  const bytes = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#334455' },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="24" height="44"><rect width="24" height="44" fill="${colorA}"/></svg>`,
        ),
        left: 16,
        top: 16,
      },
      {
        input: Buffer.from(
          `<svg width="24" height="44"><rect width="24" height="44" fill="${colorB}"/></svg>`,
        ),
        left: 72,
        top: 16,
      },
    ])
    .jpeg()
    .toBuffer();
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function bootTrackedHttpApp(
  db: DataSource,
  allowedCameraIds: string[],
  storageRoot: string,
  cacheBust: string,
) {
  const serviceToken = 'synthetic-grouped-e2e-service-token-32b';
  const env: Record<string, string> = {
    LOG_FORMAT: 'json',
    EVIDENCE_LOCAL_ROOT: storageRoot,
    STORAGE_LOCAL_ROOT: storageRoot,
    SAFETY_IDENTIFICATION_ENABLED: 'true',
    SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
    AI_CONFIGURATION_CAMERA_IDS: allowedCameraIds.join(','),
    DATABASE_URL: resolveTestDatabaseUrl(),
    DATABASE_SCHEMA: db.driver.schema!,
    SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v17-identification-ppe',
    AI_TRACKED_FRAME_RUNTIME_ENABLED: 'true',
    AI_EVIDENCE_OBJECT_STORAGE_ENABLED: 'true',
    AI_TRACKED_FRAME_RUNTIME_POLICY: JSON.stringify({
      profile: {
        wireVersion: '1.7.0',
        routeEpoch: ROUTE_EPOCH,
        profileSha256: PROFILE_HASH,
        allowedCameraIds,
        clockToleranceMs: 10000,
      },
      pending: {
        pendingTtlMs: 30000,
        maxPendingFrames: 16,
        maxPendingParts: 32,
        maxPendingPayloadBytes: 250000,
      },
      heads: {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '2',
        maxSegmentRows: 32,
      },
      recovery: { intervalMs: 25, maxFramesPerCamera: 8 },
      maxRecipients: 8,
    }),
  };
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  const { AppModule } = await import(
    new URL(`../../src/app.module.js?grouped-e2e=${cacheBust}`, import.meta.url).href
  );
  const config = createTestConfig(env);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const runtimeDb = module.get(DataSource);
  assert.equal(runtimeDb.driver.schema, db.driver.schema);
  return {
    app,
    module,
    runtimeDb,
    baseUrl: await app.getUrl(),
    serviceToken,
    close: async () => {
      await app.close();
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

async function submitAndSealTrackedFrame(params: {
  baseUrl: string;
  serviceToken: string;
  fixture: CameraFixture;
  parts: Array<Record<string, unknown>>;
  jpegBytes?: Buffer;
}) {
  const aiBase = `${params.baseUrl}/api/v1/integrations/ai`;
  const headers = {
    authorization: `Bearer ${params.serviceToken}`,
    'x-worker-generation-secret': params.fixture.generation.secret,
    'content-type': 'application/json',
  };
  if (params.jpegBytes) {
    for (const part of params.parts) {
      const form = new FormData();
      form.append('schemaVersion', '1.0.0');
      form.append('event', JSON.stringify(part));
      form.append('context', JSON.stringify(params.fixture.context));
      form.append(
        'frame',
        new Blob([new Uint8Array(params.jpegBytes)], { type: 'image/jpeg' }),
        'frame.jpg',
      );
      const uploaded = await fetch(`${aiBase}/tracked-parts/evidence`, {
        method: 'POST',
        headers: {
          authorization: headers.authorization,
          'x-worker-generation-secret': headers['x-worker-generation-secret'],
        },
        body: form,
      });
      assert.equal(uploaded.status, 200, await uploaded.clone().text());
    }
  }
  const receipts: unknown[] = [];
  for (const part of params.parts) {
    const res = await fetch(`${aiBase}/tracked-parts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        event: part,
        context: params.fixture.context,
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    receipts.push(await res.json());
  }
  const firstPart = params.parts[0] as { framePartition: { frameId: string } };
  const resultUrl =
    `${aiBase}/cameras/${params.fixture.cameraId}` +
    `/generations/${params.fixture.generation.workerGenerationId}` +
    `/sessions/${params.fixture.generation.streamSessionId}` +
    `/tracked-frames/${firstPart.framePartition.frameId}/result`;
  for (let attempt = 0; attempt < 80; attempt++) {
    const res = await fetch(resultUrl, { headers });
    if (res.status === 200) {
      return {
        receipts,
        resultUrl,
        headers,
        result: (await res.json()) as {
          kind: string;
          subjects: Array<{ segmentId: string; eventId: string; personObservationIndex: number }>;
          retiredSegmentIds: string[];
        },
      };
    }
    assert.equal(res.status, 404, await res.clone().text());
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for sealed result on frame ${firstPart.framePartition.frameId}`);
}

test('E2E grouped correlated alerts: multi-PPE single case, multi-person single frame group, retry/repeated/brief interruption non-duplication, and distinct person separation', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const storageRoot = await mkdtemp(join(tmpdir(), 'smartsite-grouped-e2e-1-'));
  let runtime: Awaited<ReturnType<typeof bootTrackedHttpApp>> | undefined;
  try {
    await owned.initialize();
    await applyTrackedV17Profile(db.driver.schema!);
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const siteId = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Grouped E2E Site 1')",
      [siteId],
    );
    const manager = await seedUserWithRole(db, passwordHash, 'SITE_MANAGER', siteId);
    const officer = await seedUserWithRole(db, passwordHash, 'SAFETY_OFFICER', siteId);
    const camera = await seedTwoRegionCamera(db, manager.id, FIVE_PPE, siteId);

    runtime = await bootTrackedHttpApp(db, [camera.cameraId], storageRoot, 'scenario1');
    const authSvc = runtime.module.get(AuthService);
    const managerAuth = await authSvc.login(manager.username, TEST_PASSWORD, AuthClientType.WEB);
    const officerAuth = await authSvc.login(officer.username, TEST_PASSWORD, AuthClientType.WEB);
    const officerHeaders = { authorization: `Bearer ${officerAuth.accessToken}` };

    await initializeV2CameraPpePolicy(
      runtime.baseUrl,
      runtime.runtimeDb,
      camera,
      managerAuth.accessToken,
    );

    const frameStartMs = Date.now() - 2000;
    const at = (offsetMs: number) => new Date(frameStartMs + offsetMs).toISOString();
    const img0 = await createSyntheticFrameJpeg('#e11d48', '#22c55e');

    // 1) One person missing 3 PPE items in frame 0 (plus compliant Person 3 control) -> 1 case, 3 findings, 0 for compliant Person 3.
    const segA = randomUUID();
    const segCompliant = randomUUID();
    const frame0Id = randomUUID();
    const event0Id = randomUUID();
    const event0 = {
      schemaVersion: '1.7.0',
      eventId: event0Id,
      cameraExternalId: camera.cameraId,
      streamSessionId: camera.generation.streamSessionId,
      capturedAt: at(0),
      frameDimensions: { width: 120, height: 80 },
      framePartition: { frameId: frame0Id, sequenceNumber: '0', partIndex: 0, partCount: 1 },
      observations: [
        {
          type: 'PERSON',
          trackId: 10,
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.1, y1: 0.1, x2: 0.42, y2: 0.9 },
        },
        ...(['HARD_HAT', 'SAFETY_VEST', 'GLOVES'] as const).map((ppeItem) => ({
          type: 'PPE',
          trackId: 10,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[0],
          geometryVersion: 1,
        })),
        {
          type: 'PERSON',
          trackId: 30,
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.56, y1: 0.1, x2: 0.9, y2: 0.9 },
        },
        ...FIVE_PPE.map((ppeItem) => ({
          type: 'PPE',
          trackId: 30,
          ppeItem,
          status: 'PRESENT',
          regionId: camera.regions[1],
          geometryVersion: 1,
        })),
      ],
      evidence: frameEvidence(camera.generation.streamSessionId, '0', event0Id, img0.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segA,
            link: { kind: 'START', reason: 'INITIAL' },
          },
          {
            personObservationIndex: 4,
            segmentId: segCompliant,
            link: { kind: 'START', reason: 'INITIAL' },
          },
        ],
        retiredSegments: [],
      },
    };
    const sealed0 = await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event0],
      jpegBytes: img0.bytes,
    });
    assert.equal(sealed0.result.kind, 'ADMITTED_TRACKED_FRAME');

    // Retry identical /tracked-parts delivery concurrently: same receipt, zero duplication.
    const retryResponses = await Promise.all(
      [1, 2].map(() =>
        fetch(`${runtime!.baseUrl}/api/v1/integrations/ai/tracked-parts`, {
          method: 'POST',
          headers: sealed0.headers,
          body: JSON.stringify({ schemaVersion: '1.0.0', event: event0, context: camera.context }),
        }),
      ),
    );
    for (const res of retryResponses) {
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), sealed0.receipts[0]);
    }

    const dbSnap1 = await db.query<
      Array<{ episodes: number; alerts: number; recipients: number; legacy: number }>
    >(
      `SELECT
         (SELECT count(*)::int FROM safety_episode) AS episodes,
         (SELECT count(*)::int FROM safety_alert) AS alerts,
         (SELECT count(*)::int FROM safety_episode_recipient) AS recipients,
         (SELECT count(*)::int FROM user_notification) AS legacy`,
    );
    assert.deepEqual(dbSnap1[0], { episodes: 1, alerts: 3, recipients: 1, legacy: 0 });

    // Check inbox & expand missing PPE cleanly to 5 families in the SAME person episode (CONTINUE seq 1).
    const img1 = await createSyntheticFrameJpeg('#e11d48', '#22c55e');
    const event1Id = randomUUID();
    const event1 = {
      ...event0,
      eventId: event1Id,
      capturedAt: at(250),
      framePartition: { frameId: randomUUID(), sequenceNumber: '1', partIndex: 0, partCount: 1 },
      observations: [
        event0.observations[0],
        ...FIVE_PPE.map((ppeItem) => ({
          type: 'PPE',
          trackId: 10,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[0],
          geometryVersion: 1,
        })),
      ],
      evidence: frameEvidence(camera.generation.streamSessionId, '1', event1Id, img1.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segA,
            link: {
              kind: 'CONTINUE',
              previousEventId: event0.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
        retiredSegments: [],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event1],
      jpegBytes: img1.bytes,
    });

    const framesRes1 = await fetch(
      `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${siteId}&cameraId=${camera.cameraId}`,
      { headers: officerHeaders },
    );
    assert.equal(framesRes1.status, 200);
    const framesBody1 = parseSafetyFrameInboxPage(await framesRes1.json());
    assert.ok(framesBody1, 'Frame inbox response must satisfy SafetyFrameInboxPage contract');
    assert.equal(framesBody1.total, 1);
    assert.equal(framesBody1.unreadCount, 1);
    assert.equal(framesBody1.items[0]!.cases.length, 1);
    assert.equal(framesBody1.items[0]!.findingCount, 5);
    assert.equal(framesBody1.items[0]!.cases[0]!.findingCount, 5);
    assert.equal(framesBody1.items[0]!.cases[0]!.contentRevision, 2);

    const epAId = framesBody1.items[0]!.cases[0]!.episodeId;
    const recipientAId = framesBody1.items[0]!.cases[0]!.recipientId;

    // Officer acknowledges reading revision 2 -> unread becomes false.
    const readRes = await fetch(
      `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/${recipientAId}/read`,
      {
        method: 'PATCH',
        headers: { ...officerHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ seenRevision: 2 }),
      },
    );
    assert.equal(readRes.status, 200);
    assert.deepEqual(await readRes.json(), {
      id: recipientAId,
      contentRevision: 2,
      seenRevision: 2,
      unread: false,
    });

    // 2) Repeated frame (seq 2): unchanged missing PPE -> NO new case, NO new alerts, NO revision bump, NO unread reset.
    const img2 = await createSyntheticFrameJpeg('#e11d48', '#22c55e');
    const event2Id = randomUUID();
    const event2 = {
      ...event1,
      eventId: event2Id,
      capturedAt: at(500),
      framePartition: { frameId: randomUUID(), sequenceNumber: '2', partIndex: 0, partCount: 1 },
      evidence: frameEvidence(camera.generation.streamSessionId, '2', event2Id, img2.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segA,
            link: {
              kind: 'CONTINUE',
              previousEventId: event1.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
        retiredSegments: [],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event2],
      jpegBytes: img2.bytes,
    });

    // 3a) Brief track interruption — occlusion frame (seq 3: observations=[], retiredSegments=[]), then seq 4 resumes segA with NEW trackId 99!
    const event3Occlusion = {
      schemaVersion: '1.7.0',
      eventId: randomUUID(),
      cameraExternalId: camera.cameraId,
      streamSessionId: camera.generation.streamSessionId,
      capturedAt: at(750),
      frameDimensions: { width: 120, height: 80 },
      framePartition: { frameId: randomUUID(), sequenceNumber: '3', partIndex: 0, partCount: 1 },
      observations: [],
      evidence: [],
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [],
        retiredSegments: [],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event3Occlusion],
    });

    const img4 = await createSyntheticFrameJpeg('#e11d48', '#22c55e');
    const event4Id = randomUUID();
    const event4Reacquired = {
      ...event2,
      eventId: event4Id,
      capturedAt: at(1000),
      framePartition: { frameId: randomUUID(), sequenceNumber: '4', partIndex: 0, partCount: 1 },
      observations: [
        {
          type: 'PERSON',
          trackId: 99,
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.1, y1: 0.1, x2: 0.42, y2: 0.9 },
        },
        ...FIVE_PPE.map((ppeItem) => ({
          type: 'PPE',
          trackId: 99,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[0],
          geometryVersion: 1,
        })),
      ],
      evidence: frameEvidence(camera.generation.streamSessionId, '4', event4Id, img4.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segA,
            link: {
              kind: 'CONTINUE',
              previousEventId: event2.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
        retiredSegments: [],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event4Reacquired],
      jpegBytes: img4.bytes,
    });

    // 3b) Dropped frame (seq 5 dropped completely; seq 6 arrives directly with CONTINUE -> event4 within maxSourceSequenceGap='2').
    const img6 = await createSyntheticFrameJpeg('#e11d48', '#22c55e');
    const event6Id = randomUUID();
    const event6AfterGap = {
      ...event4Reacquired,
      eventId: event6Id,
      capturedAt: at(1250),
      framePartition: { frameId: randomUUID(), sequenceNumber: '6', partIndex: 0, partCount: 1 },
      evidence: frameEvidence(camera.generation.streamSessionId, '6', event6Id, img6.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segA,
            link: {
              kind: 'CONTINUE',
              previousEventId: event4Reacquired.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
        retiredSegments: [],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event6AfterGap],
      jpegBytes: img6.bytes,
    });

    // Assert NO duplicate episodes, alerts, recipients, or unread resets occurred across repeated frames + brief interruptions.
    const alertCounts = await db.query<Array<{ subtype: string; detection_count: number }>>(
      'SELECT candidate_subtype AS subtype, detection_count FROM safety_alert WHERE episode_id=$1 ORDER BY candidate_subtype',
      [epAId],
    );
    assert.deepEqual(alertCounts, [
      { subtype: 'PPE_BOOTS_MISSING', detection_count: 4 },
      { subtype: 'PPE_GLOVES_MISSING', detection_count: 5 },
      { subtype: 'PPE_GOGGLES_MISSING', detection_count: 4 },
      { subtype: 'PPE_HARD_HAT_MISSING', detection_count: 5 },
      { subtype: 'PPE_SAFETY_VEST_MISSING', detection_count: 5 },
    ]);
    const framesAfterRepeat = parseSafetyFrameInboxPage(
      await (
        await fetch(
          `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${siteId}&cameraId=${camera.cameraId}`,
          { headers: officerHeaders },
        )
      ).json(),
    );
    assert.ok(framesAfterRepeat);
    assert.equal(framesAfterRepeat.total, 1);
    assert.equal(framesAfterRepeat.unreadCount, 0);
    assert.equal(framesAfterRepeat.items[0]!.cases.length, 1);
    assert.equal(framesAfterRepeat.items[0]!.cases[0]!.contentRevision, 2);
    assert.equal(framesAfterRepeat.items[0]!.cases[0]!.unread, false);

    // Confirm /tracked and /observations expose consolidated history without leaking raw storage URIs.
    const trackedDetailRes = await fetch(
      `${runtime.baseUrl}/api/v1/sites/${siteId}/safety-episodes/${epAId}/tracked`,
      { headers: officerHeaders },
    );
    assert.equal(trackedDetailRes.status, 200);
    const trackedDetail = (await trackedDetailRes.json()) as {
      findings: Array<{ alertId: string; candidateSubtype: string; observationCount: number }>;
    };
    const hardHatFinding = trackedDetail.findings.find(
      (f) => f.candidateSubtype === 'PPE_HARD_HAT_MISSING',
    );
    assert.ok(hardHatFinding);
    assert.equal(hardHatFinding.observationCount, 5);

    const obsRes = await fetch(
      `${runtime.baseUrl}/api/v1/sites/${siteId}/safety-episodes/${epAId}/observations?alertId=${hardHatFinding.alertId}&includeObservedPpe=true&limit=10`,
      { headers: officerHeaders },
    );
    assert.equal(obsRes.status, 200);
    const obsBody = (await obsRes.json()) as {
      total: number;
      items: Array<{ eventId: string; sourceSequence: string }>;
    };
    assert.equal(obsBody.total, 5);
    assert.deepEqual(
      obsBody.items.map((item) => item.sourceSequence),
      ['6', '4', '2', '1', '0'],
    );
    const obsAllRes = await fetch(
      `${runtime.baseUrl}/api/v1/sites/${siteId}/safety-episodes/${epAId}/observations?limit=20`,
      { headers: officerHeaders },
    );
    assert.equal(obsAllRes.status, 200);
    assert.equal(((await obsAllRes.json()) as { total: number }).total, 23);
    assert.ok(!JSON.stringify(obsBody).includes('local://'));

    // 4) Multiple persons in same multi-part frame (seq 7): Person B (part 0) + Person D reusing trackId 99 (part 1) + retried/retired segA!
    // Also proves: (a) multiple persons in SAME frame -> 1 frame group with 2 cases;
    // (b) Person D reusing numeric trackId=99 after segA retires NEVER merges into segA!
    const segB = randomUUID();
    const segD = randomUUID();
    const sharedFrame7Id = randomUUID();
    const img7 = await createSyntheticFrameJpeg('#2563eb', '#f59e0b');
    const event7Part0Id = randomUUID();
    const event7Part1Id = randomUUID();
    const part7_0 = {
      schemaVersion: '1.7.0',
      eventId: event7Part0Id,
      cameraExternalId: camera.cameraId,
      streamSessionId: camera.generation.streamSessionId,
      capturedAt: at(1500),
      frameDimensions: { width: 120, height: 80 },
      framePartition: { frameId: sharedFrame7Id, sequenceNumber: '7', partIndex: 0, partCount: 2 },
      observations: [
        {
          type: 'PERSON',
          trackId: 101,
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.1, y1: 0.1, x2: 0.42, y2: 0.9 },
        },
        ...(['HARD_HAT', 'BOOTS'] as const).map((ppeItem) => ({
          type: 'PPE',
          trackId: 101,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[0],
          geometryVersion: 1,
        })),
      ],
      evidence: frameEvidence(camera.generation.streamSessionId, '7', event7Part0Id, img7.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segB,
            link: { kind: 'START', reason: 'INITIAL' },
          },
        ],
        retiredSegments: [{ segmentId: segA, reason: 'LOST_TRACK' }],
      },
    };
    const part7_1 = {
      ...part7_0,
      eventId: event7Part1Id,
      framePartition: { frameId: sharedFrame7Id, sequenceNumber: '7', partIndex: 1, partCount: 2 },
      evidence: frameEvidence(camera.generation.streamSessionId, '7', event7Part1Id, img7.sha256),
      observations: [
        {
          type: 'PERSON',
          trackId: 99, // Intentionally reuses trackId 99 right after segA retired!
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.56, y1: 0.1, x2: 0.9, y2: 0.9 },
        },
        ...(['SAFETY_VEST', 'GOGGLES'] as const).map((ppeItem) => ({
          type: 'PPE',
          trackId: 99,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[1],
          geometryVersion: 1,
        })),
      ],
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segD,
            link: { kind: 'START', reason: 'LOST_TRACK' },
          },
        ],
        retiredSegments: [{ segmentId: segA, reason: 'LOST_TRACK' }],
      },
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [part7_0, part7_1],
      jpegBytes: img7.bytes,
    });

    const epStates = await db.query<
      Array<{ segmentId: string; state: string; collectionState: string; findingCount: number }>
    >(
      `SELECT e.tracking_segment_id AS "segmentId", s.state, e.collection_state AS "collectionState",
              (SELECT count(*)::int FROM safety_alert a WHERE a.episode_id=e.id) AS "findingCount"
       FROM safety_episode e
       JOIN ai_subject_segment s ON s.segment_id=e.tracking_segment_id
       ORDER BY e.first_observed_at ASC`,
    );
    const expectedEpisodes = [
      { segmentId: segA, state: 'RETIRED', collectionState: 'SEALED', findingCount: 5 },
      { segmentId: segB, state: 'ACTIVE', collectionState: 'COLLECTING', findingCount: 2 },
      { segmentId: segD, state: 'ACTIVE', collectionState: 'COLLECTING', findingCount: 2 },
    ];
    const bySegment = (left: { segmentId: string }, right: { segmentId: string }) =>
      left.segmentId.localeCompare(right.segmentId);
    assert.deepEqual(epStates.sort(bySegment), expectedEpisodes.sort(bySegment));

    const framesMulti = parseSafetyFrameInboxPage(
      await (
        await fetch(
          `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${siteId}&cameraId=${camera.cameraId}`,
          { headers: officerHeaders },
        )
      ).json(),
    );
    assert.ok(framesMulti);
    assert.equal(framesMulti.total, 2, 'Frame 0 (segA) and Frame 7 (segB + segD) are 2 groups');
    assert.equal(framesMulti.unreadCount, 1);

    const frame7Group = framesMulti.items.find((f) => f.frameKey.endsWith(`:${sharedFrame7Id}`));
    assert.ok(frame7Group, 'Shared multi-person multi-part frame must form one frame group');
    assert.equal(frame7Group.findingCount, 4);
    assert.equal(frame7Group.unread, true);
    assert.equal(frame7Group.cases.length, 2, 'Both flagged persons appear as distinct cases');
    assert.ok(
      frame7Group.cases.every(
        (entry) => entry.source !== null && entry.source.sha256 === img7.sha256,
      ),
    );
    for (const entry of frame7Group.cases) {
      assert.ok(entry.source);
      const mediaUrl =
        `${runtime.baseUrl}/api/v1/sites/${siteId}/safety-episodes/${entry.episodeId}` +
        `/findings/${entry.source.alertId}/events/${entry.source.eventId}/frame` +
        `?personObservationIndex=${entry.source.personObservationIndex}&evidenceIndex=${entry.source.evidenceIndex}&representation=SUBJECT`;
      const mediaRes: Response = await fetch(mediaUrl, { headers: officerHeaders });
      assert.equal(mediaRes.status, 200, await mediaRes.clone().text());
      const cropMeta = await sharp(Buffer.from(await mediaRes.arrayBuffer())).metadata();
      assert.ok((cropMeta.width ?? 120) < 120 && (cropMeta.height ?? 80) < 80);
    }

    const alertsPage = (await (
      await fetch(`${runtime.baseUrl}/api/v1/sites/${siteId}/safety-alerts?limit=50`, {
        headers: officerHeaders,
      })
    ).json()) as { total: number; items: Array<{ id: string }> };
    assert.equal(alertsPage.total, 9, '5 findings for segA + 2 for segB + 2 for segD');

    // Reading only one case in frame 7 keeps the sibling case and frame group unread.
    const readOneCase = await fetch(
      `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/${frame7Group.cases[0]!.recipientId}/read`,
      {
        method: 'PATCH',
        headers: { ...officerHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ seenRevision: 1 }),
      },
    );
    assert.equal(readOneCase.status, 200);
    const framesPartialRead = parseSafetyFrameInboxPage(
      await (
        await fetch(
          `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${siteId}&readStatus=UNREAD`,
          { headers: officerHeaders },
        )
      ).json(),
    );
    assert.ok(framesPartialRead);
    assert.equal(framesPartialRead.total, 1);
    assert.equal(framesPartialRead.unreadCount, 1);
    assert.equal(framesPartialRead.items[0]!.frameKey, frame7Group.frameKey);
    assert.equal(framesPartialRead.items[0]!.cases.filter((c) => c.unread).length, 1);

    // Same-person split across multiple parts of one frame (seq 8): compliant in part 0, missing in part 1!
    const segMultiPartSinglePerson = randomUUID();
    const frame8Id = randomUUID();
    const img8 = await createSyntheticFrameJpeg('#9333ea', '#22c55e');
    const event8Part0Id = randomUUID();
    const event8Part1Id = randomUUID();
    const event8Part0 = {
      schemaVersion: '1.7.0',
      eventId: event8Part0Id,
      cameraExternalId: camera.cameraId,
      streamSessionId: camera.generation.streamSessionId,
      capturedAt: at(1750),
      frameDimensions: { width: 120, height: 80 },
      framePartition: { frameId: frame8Id, sequenceNumber: '8', partIndex: 0, partCount: 2 },
      observations: [
        {
          type: 'PERSON',
          trackId: 202,
          boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.46, y1: 0.1, x2: 0.54, y2: 0.9 },
        },
        {
          type: 'PPE',
          trackId: 202,
          ppeItem: 'HARD_HAT',
          status: 'PRESENT',
          regionId: camera.regions[0],
          geometryVersion: 1,
        },
      ],
      evidence: frameEvidence(camera.generation.streamSessionId, '8', event8Part0Id, img8.sha256),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segMultiPartSinglePerson,
            link: { kind: 'START', reason: 'INITIAL' },
          },
        ],
        retiredSegments: [],
      },
    };
    const event8Part1 = {
      ...event8Part0,
      eventId: event8Part1Id,
      framePartition: { frameId: frame8Id, sequenceNumber: '8', partIndex: 1, partCount: 2 },
      evidence: frameEvidence(camera.generation.streamSessionId, '8', event8Part1Id, img8.sha256),
      observations: [
        event8Part0.observations[0],
        ...(['SAFETY_VEST', 'GLOVES'] as const).map((ppeItem) => ({
          type: 'PPE',
          trackId: 202,
          ppeItem,
          status: 'MISSING',
          regionId: camera.regions[1],
          geometryVersion: 1,
        })),
      ],
    };
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: camera,
      parts: [event8Part0, event8Part1],
      jpegBytes: img8.bytes,
    });
    const framesWithPart1OnlyViolation = parseSafetyFrameInboxPage(
      await (
        await fetch(
          `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${siteId}&frameKey=${encodeURIComponent(`tracked:${(await db.query<Array<{ scope: string }>>('SELECT scope_sha256 AS scope FROM ai_subject_segment WHERE segment_id=$1', [segMultiPartSinglePerson]))[0]!.scope}:${frame8Id}`)}`,
          { headers: officerHeaders },
        )
      ).json(),
    );
    assert.ok(framesWithPart1OnlyViolation);
    assert.equal(framesWithPart1OnlyViolation.total, 1);
    assert.equal(framesWithPart1OnlyViolation.items[0]!.cases.length, 1);
    assert.equal(framesWithPart1OnlyViolation.items[0]!.cases[0]!.findingCount, 2);
    // Record what source actually looks like when episode anchor is part 0 but findings are in part 1:
    const part1Source = framesWithPart1OnlyViolation.items[0]!.cases[0]!.source;
    assert.ok(
      part1Source !== null,
      'Multi-part single-person episode with findings only in part 1 must still resolve source media',
    );
    assert.equal(part1Source.eventId, event8Part1Id);
    const part1FrameRes: Response = await fetch(
      `${runtime.baseUrl}/api/v1/sites/${siteId}/safety-episodes/${framesWithPart1OnlyViolation.items[0]!.cases[0]!.episodeId}/findings/${part1Source.alertId}/events/${part1Source.eventId}/frame?personObservationIndex=${part1Source.personObservationIndex}&evidenceIndex=${part1Source.evidenceIndex}&representation=FRAME`,
      { headers: officerHeaders },
    );
    assert.equal(part1FrameRes.status, 200);
    assert.deepEqual(Buffer.from(await part1FrameRes.arrayBuffer()), img8.bytes);

    // Conflicting retry with a different eventId on already-sealed sequence 8 -> 409 Conflict, zero side effects.
    const conflictEventRes = await fetch(
      `${runtime.baseUrl}/api/v1/integrations/ai/tracked-parts`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.serviceToken}`,
          'x-worker-generation-secret': camera.generation.secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: '1.0.0',
          event: { ...event8Part0, eventId: randomUUID() },
          context: camera.context,
        }),
      },
    );
    assert.equal(conflictEventRes.status, 409);

    // Exceeding maxSourceSequenceGap ('2') by jumping 8 -> 11 stays gated in PENDING_PREDECESSOR (SOURCE_GAP) without creating duplicate alerts.
    const gapExceededEventId = randomUUID();
    const gapExceededFrameId = randomUUID();
    const gapExceededEvent = {
      ...event8Part1,
      eventId: gapExceededEventId,
      capturedAt: at(2000),
      framePartition: {
        frameId: gapExceededFrameId,
        sequenceNumber: '11',
        partIndex: 0,
        partCount: 1,
      },
      evidence: frameEvidence(
        camera.generation.streamSessionId,
        '11',
        gapExceededEventId,
        img8.sha256,
      ),
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: PROFILE_HASH,
        coverage: { status: 'COMPLETE' },
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segMultiPartSinglePerson,
            link: {
              kind: 'CONTINUE',
              previousEventId: event8Part1Id,
              previousPersonObservationIndex: 0,
            },
          },
        ],
        retiredSegments: [],
      },
    };
    const gapRes = await fetch(`${runtime.baseUrl}/api/v1/integrations/ai/tracked-parts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.serviceToken}`,
        'x-worker-generation-secret': camera.generation.secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        event: gapExceededEvent,
        context: camera.context,
      }),
    });
    assert.equal(gapRes.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const [gapRow] = await db.query<Array<{ state: string }>>(
      'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
      [gapExceededEventId],
    );
    assert.equal(gapRow?.state, 'PENDING_PREDECESSOR');
    assert.equal(
      (await db.query<Array<{ n: number }>>('SELECT count(*)::int AS n FROM safety_alert'))[0]!.n,
      11,
    );
  } finally {
    if (runtime) await runtime.close();
    await rm(storageRoot, { recursive: true, force: true });
    await owned.dispose();
  }
});

test('E2E isolation: distinct sessions, distinct cameras, and distinct sites never merge cases or frame groups', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const storageRoot = await mkdtemp(join(tmpdir(), 'smartsite-grouped-e2e-2-'));
  let runtime: Awaited<ReturnType<typeof bootTrackedHttpApp>> | undefined;
  try {
    await owned.initialize();
    await applyTrackedV17Profile(db.driver.schema!);
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const site1 = randomUUID();
    const site2 = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Site 1'),($2,$2::uuid::text,'Site 2')",
      [site1, site2],
    );
    const manager1 = await seedUserWithRole(db, passwordHash, 'SITE_MANAGER', site1);
    const manager2 = await seedUserWithRole(db, passwordHash, 'SITE_MANAGER', site2);
    const officer1 = await seedUserWithRole(db, passwordHash, 'SAFETY_OFFICER', site1);
    const officer2 = await seedUserWithRole(db, passwordHash, 'SAFETY_OFFICER', site2);

    const cam1 = await seedTwoRegionCamera(db, manager1.id, FIVE_PPE, site1);
    const cam2SameSite = await seedTwoRegionCamera(db, manager1.id, FIVE_PPE, site1);
    const cam3OtherSite = await seedTwoRegionCamera(db, manager2.id, FIVE_PPE, site2);

    runtime = await bootTrackedHttpApp(
      db,
      [cam1.cameraId, cam2SameSite.cameraId, cam3OtherSite.cameraId],
      storageRoot,
      'scenario2',
    );
    const authSvc = runtime.module.get(AuthService);
    const [m1Auth, m2Auth, o1Auth, o2Auth] = await Promise.all([
      authSvc.login(manager1.username, TEST_PASSWORD, AuthClientType.WEB),
      authSvc.login(manager2.username, TEST_PASSWORD, AuthClientType.WEB),
      authSvc.login(officer1.username, TEST_PASSWORD, AuthClientType.WEB),
      authSvc.login(officer2.username, TEST_PASSWORD, AuthClientType.WEB),
    ]);
    await Promise.all([
      initializeV2CameraPpePolicy(runtime.baseUrl, runtime.runtimeDb, cam1, m1Auth.accessToken),
      initializeV2CameraPpePolicy(
        runtime.baseUrl,
        runtime.runtimeDb,
        cam2SameSite,
        m1Auth.accessToken,
      ),
      initializeV2CameraPpePolicy(
        runtime.baseUrl,
        runtime.runtimeDb,
        cam3OtherSite,
        m2Auth.accessToken,
      ),
    ]);

    const sharedFrameId = randomUUID();
    const segCam1Gen1 = randomUUID();
    const imgA = await createSyntheticFrameJpeg('#e11d48', '#22c55e');
    const buildSinglePerson = (
      fx: CameraFixture,
      frameId: string,
      segId: string,
      trackId: number,
      sha256: string,
    ) => {
      const eventId = randomUUID();
      return {
        schemaVersion: '1.7.0',
        eventId,
        cameraExternalId: fx.cameraId,
        streamSessionId: fx.generation.streamSessionId,
        capturedAt: new Date().toISOString(),
        frameDimensions: { width: 120, height: 80 },
        framePartition: { frameId, sequenceNumber: '0', partIndex: 0, partCount: 1 },
        observations: [
          {
            type: 'PERSON',
            trackId,
            boundingBox: { coordinateSpace: 'NORMALIZED_0_1', x1: 0.1, y1: 0.1, x2: 0.42, y2: 0.9 },
          },
          {
            type: 'PPE',
            trackId,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId: fx.regions[0],
            geometryVersion: 1,
          },
        ],
        evidence: frameEvidence(fx.generation.streamSessionId, '0', eventId, sha256),
        continuity: {
          schemaVersion: '1.0.0',
          profileSha256: PROFILE_HASH,
          coverage: { status: 'COMPLETE' },
          subjects: [
            {
              personObservationIndex: 0,
              segmentId: segId,
              link: { kind: 'START', reason: 'INITIAL' },
            },
          ],
          retiredSegments: [],
        },
      };
    };

    // Session 1 on cam1: emits frame with sharedFrameId and segCam1Gen1.
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: cam1,
      parts: [buildSinglePerson(cam1, sharedFrameId, segCam1Gen1, 1, imgA.sha256)],
      jpegBytes: imgA.bytes,
    });

    // Rotate worker generation/streamSession on cam1 (SOURCE_RESTART).
    const nextGen = await provisionCameraWorkerGeneration(
      runtime.runtimeDb,
      cam1.cameraId,
      [cam1.cameraId],
      120000,
      undefined,
      {
        commandId: randomUUID(),
        expectedGenerationId: cam1.generation.workerGenerationId,
        reason: 'SOURCE_RESTART',
      },
    );
    const nextReceiptId = randomUUID();
    await recordCameraConfigurationAcknowledgement(
      runtime.runtimeDb,
      cam1.cameraId,
      nextGen.secret,
      {
        commandId: nextReceiptId,
        workerGenerationId: nextGen.workerGenerationId,
        streamSessionId: nextGen.streamSessionId,
        configurationVersion: 2,
        bundleSha256: cam1.context.bundleSha256,
        viewRevision: 1,
        outcome: 'LOADED',
      },
    );
    const cam1Gen2: CameraFixture = {
      ...cam1,
      generation: nextGen,
      context: {
        ...cam1.context,
        workerGenerationId: nextGen.workerGenerationId,
        streamSessionId: nextGen.streamSessionId,
        receiptCommandId: nextReceiptId,
      },
    };
    const imgB = await createSyntheticFrameJpeg('#0ea5e9', '#f59e0b');
    // Session 2 on cam1 reuses same trackId=1 AND same frameId UUID: must create distinct episode & distinct frameKey!
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: cam1Gen2,
      parts: [buildSinglePerson(cam1Gen2, sharedFrameId, randomUUID(), 1, imgB.sha256)],
      jpegBytes: imgB.bytes,
    });

    // Different camera on Site 1 using same sharedFrameId UUID -> distinct frame group!
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: cam2SameSite,
      parts: [buildSinglePerson(cam2SameSite, sharedFrameId, randomUUID(), 1, imgA.sha256)],
      jpegBytes: imgA.bytes,
    });

    // Different Site 2 camera using same sharedFrameId -> isolated to Site 2 officer only!
    await submitAndSealTrackedFrame({
      baseUrl: runtime.baseUrl,
      serviceToken: runtime.serviceToken,
      fixture: cam3OtherSite,
      parts: [buildSinglePerson(cam3OtherSite, sharedFrameId, randomUUID(), 1, imgA.sha256)],
      jpegBytes: imgA.bytes,
    });

    const site1Frames = parseSafetyFrameInboxPage(
      await (
        await fetch(`${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?limit=10`, {
          headers: { authorization: `Bearer ${o1Auth.accessToken}` },
        })
      ).json(),
    );
    assert.ok(site1Frames);
    assert.equal(
      site1Frames.total,
      3,
      'Gen1 + Gen2 (new session) + Cam2 must be 3 distinct frame groups',
    );
    assert.equal(new Set(site1Frames.items.map((item) => item.cases[0]!.episodeId)).size, 3);
    assert.ok(site1Frames.items.every((item) => item.siteId === site1));

    const site2Frames = parseSafetyFrameInboxPage(
      await (
        await fetch(`${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?limit=10`, {
          headers: { authorization: `Bearer ${o2Auth.accessToken}` },
        })
      ).json(),
    );
    assert.ok(site2Frames);
    assert.equal(site2Frames.total, 1);
    assert.equal(site2Frames.items[0]!.siteId, site2);

    // Cross-site request must return 403.
    const crossSiteRes = await fetch(
      `${runtime.baseUrl}/api/v1/me/safety-episode-inbox/frames?siteId=${site2}`,
      { headers: { authorization: `Bearer ${o1Auth.accessToken}` } },
    );
    assert.equal(crossSiteRes.status, 403);
  } finally {
    if (runtime) await runtime.close();
    await rm(storageRoot, { recursive: true, force: true });
    await owned.dispose();
  }
});
