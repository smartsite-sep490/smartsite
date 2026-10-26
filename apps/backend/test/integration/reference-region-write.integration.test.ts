import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  CameraConfigurationReferenceEntity,
  CameraEntity,
  CameraStatus,
} from '../../src/database/entities/index.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import type { CameraConfigurationImageService } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { CameraConfigurationReferenceService } from '../../src/modules/cameras/camera-configuration-reference.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase({ canonical: true });
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

const sites = new SiteConfigurationService(db);
const zones = new ZoneConfigurationService(db, sites);
const cameras = new CameraConfigurationService(db, zones, sites);

const tri = (min: number, max: number) => ({
  coordinates: [
    [min, min],
    [max, min],
    [0.5, max],
  ],
});
const polygonA = tri(0.1, 0.9);
const polygonB = tri(0.15, 0.85);
const refBody = (referenceId: string, ver = 2, viewRev = 1, polygon = polygonB) => ({
  expectedConfigurationVersion: ver,
  referenceId,
  viewRevision: viewRev,
  confirmReferenceView: true,
  polygon,
});

const status = (code: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === code;

async function actor(role: string, siteId: string | null) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [id],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    id,
    role,
    siteId,
  ]);
  return { actorUserId: id };
}

async function createFixture() {
  const siteId = randomUUID(),
    zoneId = randomUUID();
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  const context = await actor('SITE_MANAGER', siteId);
  const camera = await cameras.create(
    siteId,
    { code: randomUUID(), externalId: `SYNTH-CAM-${randomUUID()}`, name: 'Synthetic camera' },
    context,
  );
  let sessionId = randomUUID();
  const images = {
    async read(_token: string, requestedSite: string, requestedCamera: string) {
      const current = await db
        .getRepository(CameraEntity)
        .findOneByOrFail({ id: requestedCamera, siteId: requestedSite });
      const capturedAt = new Date();
      return {
        schemaVersion: 1 as const,
        purpose: 'REGION_CONFIGURATION' as const,
        sourceKind: 'LIVE' as const,
        siteId: current.siteId,
        cameraId: current.id,
        configurationVersion: current.configurationVersion,
        referenceExpiresAt: new Date(capturedAt.getTime() + 300_000).toISOString(),
        frame: {
          cameraExternalId: current.externalId,
          sessionId,
          sequenceNumber: '1',
          capturedAt: capturedAt.toISOString(),
          width: 120,
          height: 80,
          imageSha256: 'a'.repeat(64),
          imageDataUrl: 'SYNTHETIC_IMAGE_ADAPTER_NO_CAMERA',
        },
      };
    },
    async authorize(_token: string, _requestedSite: string, manager?: EntityManager) {
      if (manager) assert.equal(manager.queryRunner?.isTransactionActive, true);
      return context.actorUserId;
    },
  } as unknown as CameraConfigurationImageService;
  const references = new CameraConfigurationReferenceService(db, images);
  return {
    siteId,
    zoneId,
    context,
    camera,
    references,
    rotateSession: () => (sessionId = randomUUID()),
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
const createRef = (f: Fixture, refId: string, ver = 1, viewRev = 1, poly = polygonA) =>
  cameras.createReferenceRegion(
    f.siteId,
    f.camera.id,
    { zoneId: f.zoneId, ...refBody(refId, ver, viewRev, poly) },
    f.context,
  );
const patchRef = (f: Fixture, regionId: string, body: unknown) =>
  cameras.updateReferencePolygon(f.siteId, f.camera.id, regionId, body, f.context);

const commandCount = async () =>
  (await db.query('SELECT count(*)::int AS n FROM authorization_history_command'))[0].n as number;

const regionRevisions = async (regionId: string) =>
  db.query(
    'SELECT * FROM camera_region_geometry_revision WHERE region_id = $1 ORDER BY geometry_version ASC',
    [regionId],
  );

test('reference-bound create and same-coordinate revalidation persist all 4 provenance fields and bump revisions', async () => {
  const f = await createFixture();
  const issued1 = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  assert.equal(issued1.reference.configurationVersion, 1);
  assert.equal(issued1.reference.viewRevision, 1);

  const created = await createRef(f, issued1.reference.referenceId);
  assert.equal(created.version, 1);
  assert.equal(created.configurationVersion, 2);
  assert.equal(
    (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
      .configuration_locked,
    true,
  );

  // Reconfirming identical coordinates against a fresh reference must advance both revisions.
  const issued2 = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  assert.equal(issued2.reference.configurationVersion, 2);
  assert.equal(issued2.reference.viewRevision, 1);
  assert.notEqual(issued2.reference.referenceId, issued1.reference.referenceId);

  const reconfirmed = await patchRef(
    f,
    created.id,
    refBody(issued2.reference.referenceId, 2, 1, polygonA),
  );
  assert.equal(reconfirmed.version, 2);
  assert.equal(reconfirmed.configurationVersion, 3);

  const rows = await regionRevisions(created.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(
      (r: { geometry_version: number; configuration_version: string }) =>
        `${r.geometry_version}:${r.configuration_version}`,
    ),
    ['1:2', '2:3'],
  );
  assert.equal(rows[0].reference_id, issued1.reference.referenceId);
  assert.equal(rows[1].reference_id, issued2.reference.referenceId);
  for (const row of rows) {
    assert.equal(row.is_active, true);
    assert.equal(row.is_cutover_baseline, false);
    assert.notEqual(row.reference_id, null);
    assert.equal(row.view_revision, '1');
    assert.equal(row.confirmed_by_user_id, f.context.actorUserId);
    assert.notEqual(row.confirmed_at, null);
    assert.ok(row.confirmed_at instanceof Date);
    assert.ok(row.confirmed_at.getTime() <= row.recorded_at.getTime());
    assert.deepEqual(row.polygon, polygonA);
  }
});

test('status mutations preserve reference provenance while legacy polygon writes clear current provenance without altering history', async () => {
  const f = await createFixture();
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const created = await createRef(f, issued.reference.referenceId);
  const step1 = { isActive: false, expectedConfigurationVersion: 2 };
  const step2 = { isActive: true, expectedConfigurationVersion: 3 };
  const step3 = { polygon: polygonB, expectedConfigurationVersion: 4 };
  await cameras.setRegionActive(f.siteId, f.camera.id, created.id, step1, f.context);
  await cameras.setRegionActive(f.siteId, f.camera.id, created.id, step2, f.context);
  await cameras.updatePolygon(f.siteId, f.camera.id, created.id, step3, f.context);

  const rows = await regionRevisions(created.id);
  assert.equal(rows.length, 4);
  for (const idx of [0, 1, 2]) {
    assert.equal(rows[idx].reference_id, issued.reference.referenceId);
    assert.equal(rows[idx].view_revision, '1');
    assert.equal(rows[idx].confirmed_by_user_id, f.context.actorUserId);
    assert.notEqual(rows[idx].confirmed_at, null);
    assert.ok(rows[idx].confirmed_at instanceof Date);
  }
  assert.equal(rows[1].is_active, false);
  assert.equal(rows[2].is_active, true);
  assert.equal(rows[3].geometry_version, 4);
  assert.equal(rows[3].configuration_version, '5');
  assert.equal(rows[3].reference_id, null);
  assert.equal(rows[3].view_revision, null);
  assert.equal(rows[3].confirmed_by_user_id, null);
  assert.equal(rows[3].confirmed_at, null);
  assert.deepEqual(rows[3].polygon, polygonB);
});

test('stale expectedVersion, reused reference, expired, future-issued, mismatched view, retired view after rotation, cross-site, spoofed-body and inactive camera fail atomically', async () => {
  const f = await createFixture(),
    other = await createFixture();
  const ref1 = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const region = await createRef(f, ref1.reference.referenceId);
  const refAtV2 = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const otherRef = await other.references.read('synthetic-token', other.siteId, other.camera.id);
  const sibling = await cameras.create(
    f.siteId,
    {
      code: randomUUID(),
      externalId: randomUUID(),
      name: 'Same-site sibling camera',
    },
    f.context,
  );
  const siblingRef = await f.references.read('synthetic-token', f.siteId, sibling.id);

  const expiredRefId = randomUUID(),
    futureRefId = randomUUID(),
    nowMs = Date.now();
  const baseRow = {
    cameraId: f.camera.id,
    siteId: f.siteId,
    viewRevision: '1',
    sessionId: refAtV2.reference.sessionId,
    sourceKind: 'LIVE' as const,
    width: 120,
    height: 80,
    imageSha256: 'a'.repeat(64),
    configurationVersion: '2',
    issuedByUserId: f.context.actorUserId,
  };
  await db.getRepository(CameraConfigurationReferenceEntity).insert([
    {
      ...baseRow,
      id: expiredRefId,
      capturedAt: new Date(nowMs - 240_000),
      issuedAt: new Date(nowMs - 239_500),
      expiresAt: new Date(nowMs - 60_000),
    },
    {
      ...baseRow,
      id: futureRefId,
      capturedAt: new Date(nowMs + 60_000),
      issuedAt: new Date(nowMs + 60_500),
      expiresAt: new Date(nowMs + 180_000),
    },
  ]);

  const beforeCommands = await commandCount();

  // Pre-rotation checks while viewRevision=1 is still current and camera configurationVersion=2:
  // 1. Stale expectedConfigurationVersion (distinct from reused reference version)
  // 2. Reused reference from configurationVersion=1 (with current expectedConfigurationVersion=2)
  // 3. Expired reference on current viewRevision=1 and expectedConfigurationVersion=2 (before rotation)
  // 4. Future-issued reference on current viewRevision=1 and expectedConfigurationVersion=2
  // 5. Mismatched viewRevision in request body against current viewRevision=1
  for (const conflictBody of [
    refBody(refAtV2.reference.referenceId, 1, 1),
    refBody(ref1.reference.referenceId, 2, 1),
    refBody(expiredRefId, 2, 1),
    refBody(futureRefId, 2, 1),
    refBody(refAtV2.reference.referenceId, 2, 2),
  ]) {
    await assert.rejects(patchRef(f, region.id, conflictBody), status(409));
  }

  // 6. Cross-site / cross-camera reference spoofing (before rotation)
  await assert.rejects(
    patchRef(f, region.id, refBody(otherRef.reference.referenceId, 2, 1)),
    (err: unknown) => status(409)(err) || status(404)(err),
  );
  await assert.rejects(
    patchRef(f, region.id, refBody(siblingRef.reference.referenceId, 2, 1)),
    status(409),
  );

  // Rotate stream session to allocate viewRevision=2 and retire viewRevision=1.
  f.rotateSession();
  const refAtView2 = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  assert.equal(refAtView2.reference.viewRevision, 2);

  // 7. Retired view after rotation (refAtV2 was issued on now-retired viewRevision=1)
  await assert.rejects(
    patchRef(f, region.id, refBody(refAtV2.reference.referenceId, 2, 1)),
    status(409),
  );

  // 8. Spoofed actor field or unconfirmed view in body -> 400
  for (const invalidBody of [
    { ...refBody(refAtView2.reference.referenceId, 2, 2), confirmReferenceView: false },
    {
      ...refBody(refAtView2.reference.referenceId, 2, 2),
      confirmedByUserId: other.context.actorUserId,
    },
  ]) {
    await assert.rejects(patchRef(f, region.id, invalidBody), status(400));
  }

  assert.equal(await commandCount(), beforeCommands);
  assert.equal((await cameras.get(f.siteId, f.camera.id)).configurationVersion, 2);
  assert.equal((await cameras.getRegion(f.siteId, f.camera.id, region.id)).version, 1);
  assert.equal((await regionRevisions(region.id)).length, 1);

  // 9. Inactive camera rejects reference-bound write with 409
  await cameras.setStatus(
    f.siteId,
    f.camera.id,
    { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 2 },
    f.context,
  );
  const cmdsAfterStop = await commandCount();
  await assert.rejects(
    patchRef(f, region.id, refBody(refAtView2.reference.referenceId, 3, 2)),
    status(409),
  );
  assert.equal(await commandCount(), cmdsAfterStop);
  const stoppedHistory = await regionRevisions(region.id);
  assert.equal(stoppedHistory.length, 2);
  for (const field of ['reference_id', 'view_revision', 'confirmed_by_user_id', 'confirmed_at'])
    assert.deepEqual(stoppedHistory[1][field], stoppedHistory[0][field]);
});

test('missing context, global ADMIN, SAFETY_OFFICER, foreign manager, revoked session recheck and role loss are denied without orphan rows', async () => {
  const f = await createFixture(),
    other = await createFixture();
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const body = { zoneId: f.zoneId, ...refBody(issued.reference.referenceId, 1, 1, polygonA) };
  const before = await commandCount();

  for (const deniedContext of [
    undefined,
    await actor('ADMIN', null),
    await actor('SAFETY_OFFICER', f.siteId),
    other.context,
  ]) {
    await assert.rejects(
      cameras.createReferenceRegion(f.siteId, f.camera.id, body, deniedContext),
      status(403),
    );
  }

  let rechecked = false;
  await assert.rejects(
    cameras.createReferenceRegion(f.siteId, f.camera.id, body, {
      ...f.context,
      reauthorize: async (manager) => {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        rechecked = true;
        throw Object.assign(new Error('revoked session recheck'), { getStatus: () => 401 });
      },
    }),
    status(401),
  );
  assert.equal(rechecked, true);

  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.context.actorUserId]);
  await assert.rejects(
    cameras.createReferenceRegion(f.siteId, f.camera.id, body, f.context),
    status(403),
  );

  assert.equal(await commandCount(), before);
  assert.equal((await cameras.get(f.siteId, f.camera.id)).configurationVersion, 1);
  assert.deepEqual(
    await db.query('SELECT id FROM camera_observation_region WHERE camera_id=$1', [f.camera.id]),
    [],
  );
});

test('concurrent saves against one camera version commit exactly one region and history', async () => {
  const f = await createFixture();
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const before = await commandCount();
  const results = await Promise.allSettled([
    createRef(f, issued.reference.referenceId),
    createRef(f, issued.reference.referenceId),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert(rejected?.status === 'rejected' && status(409)(rejected.reason));
  assert.equal(await commandCount(), before + 1);
  assert.equal((await cameras.get(f.siteId, f.camera.id)).configurationVersion, 2);
  const regions = await cameras.listRegions(f.siteId, f.camera.id);
  assert.equal(regions.total, 1);
  assert.equal((await regionRevisions(regions.items[0]!.id)).length, 1);
});

test('history insertion failure rolls back region, camera, Zone lock and journal together', async () => {
  const f = await createFixture();
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const before = await commandCount();
  await db.query(`CREATE FUNCTION synthetic_region_history_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback probe'; END $$`);
  await db.query(`CREATE TRIGGER synthetic_region_history_failure BEFORE INSERT ON
    camera_region_geometry_revision FOR EACH ROW EXECUTE FUNCTION synthetic_region_history_failure()`);
  try {
    await assert.rejects(createRef(f, issued.reference.referenceId), /synthetic rollback probe/);
    assert.equal(await commandCount(), before);
    assert.equal((await cameras.get(f.siteId, f.camera.id)).configurationVersion, 1);
    assert.equal((await cameras.listRegions(f.siteId, f.camera.id)).total, 0);
    assert.equal(
      (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
        .configuration_locked,
      false,
    );
  } finally {
    await db.query(
      'DROP TRIGGER synthetic_region_history_failure ON camera_region_geometry_revision',
    );
    await db.query('DROP FUNCTION synthetic_region_history_failure()');
  }
});

test('read/reopen projects matching geometry provenance and revalidation without crossing site scope', async () => {
  const f = await createFixture();
  const legacy = await cameras.createRegion(
    f.siteId,
    f.camera.id,
    {
      zoneId: f.zoneId,
      polygon: polygonA,
      expectedConfigurationVersion: 1,
    },
    f.context,
  );
  const unconfirmed = {
    status: 'UNCONFIRMED',
    referenceId: null,
    viewRevision: null,
    confirmedByUserId: null,
    confirmedAt: null,
  };
  assert.deepEqual(
    Reflect.get(await cameras.getRegion(f.siteId, f.camera.id, legacy.id), 'geometryConfirmation'),
    unconfirmed,
  );
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  await patchRef(f, legacy.id, refBody(issued.reference.referenceId, 2, 1, polygonA));
  const [history] = (await regionRevisions(legacy.id)).slice(-1);
  const expected = {
    status: 'MANUALLY_CONFIRMED',
    referenceId: issued.reference.referenceId,
    viewRevision: 1,
    confirmedByUserId: f.context.actorUserId,
    confirmedAt: history.confirmed_at.toISOString(),
  };
  assert.deepEqual(
    Reflect.get(await cameras.getRegion(f.siteId, f.camera.id, legacy.id), 'geometryConfirmation'),
    expected,
  );
  const page = await cameras.listRegions(f.siteId, f.camera.id, 0, 1);
  assert.equal(page.total, 1);
  assert.deepEqual(Reflect.get(page.items[0]!, 'geometryConfirmation'), expected);
  f.rotateSession();
  await f.references.read('synthetic-token', f.siteId, f.camera.id);
  assert.deepEqual(
    Reflect.get(await cameras.getRegion(f.siteId, f.camera.id, legacy.id), 'geometryConfirmation'),
    { ...expected, status: 'NEEDS_REVALIDATION' },
  );
  const other = await createFixture();
  await assert.rejects(cameras.getRegion(other.siteId, f.camera.id, legacy.id), status(404));
  await assert.rejects(cameras.listRegions(other.siteId, f.camera.id), status(404));
});

test('expired authoring reference preserves historical confirmation and paged mixed Region states', async () => {
  const f = await createFixture();
  const issued = await f.references.read('synthetic-token', f.siteId, f.camera.id);
  const past = new Date(Date.now() - 600_000);
  const oldReferenceId = randomUUID();
  await db.getRepository(CameraConfigurationReferenceEntity).insert({
    id: oldReferenceId,
    cameraId: f.camera.id,
    siteId: f.siteId,
    viewRevision: '1',
    sessionId: issued.reference.sessionId,
    sourceKind: 'LIVE',
    width: 120,
    height: 80,
    imageSha256: 'a'.repeat(64),
    configurationVersion: '1',
    capturedAt: past,
    issuedAt: past,
    expiresAt: new Date(past.getTime() + 300_000),
    issuedByUserId: f.context.actorUserId,
  });
  // Synthetic historical fixture; no elapsed-time sleeps or reference/history rewrites.
  const id = randomUUID();
  await db.query(
    `INSERT INTO camera_observation_region
    (id,camera_id,zone_id,polygon,coordinate_space,version,is_active)
    VALUES($1,$2,$3,$4::jsonb,'NORMALIZED_0_1',1,true)`,
    [id, f.camera.id, f.zoneId, JSON.stringify(polygonA)],
  );
  await db.query(
    `INSERT INTO camera_region_geometry_revision
    (region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,
     polygon,is_active,reference_id,view_revision,confirmed_by_user_id,confirmed_at)
    VALUES($1,1,$2,$3,1,'NORMALIZED_0_1',$4::jsonb,true,$5,1,$6,$7)`,
    [
      id,
      f.camera.id,
      f.zoneId,
      JSON.stringify(polygonA),
      oldReferenceId,
      f.context.actorUserId,
      new Date(past.getTime() + 1000),
    ],
  );
  const legacy = await cameras.createRegion(
    f.siteId,
    f.camera.id,
    { zoneId: f.zoneId, polygon: polygonB, expectedConfigurationVersion: 1 },
    f.context,
  );
  const confirmation = (await cameras.getRegion(f.siteId, f.camera.id, id)).geometryConfirmation;
  assert.equal(confirmation.status, 'MANUALLY_CONFIRMED');
  assert.equal(confirmation.referenceId, oldReferenceId);
  const seen = new Map();
  for (const offset of [0, 1]) {
    const result = await cameras.listRegions(f.siteId, f.camera.id, offset, 1);
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 1);
    seen.set(result.items[0]!.id, result.items[0]!.geometryConfirmation.status);
  }
  assert.equal(seen.get(id), 'MANUALLY_CONFIRMED');
  assert.equal(seen.get(legacy.id), 'UNCONFIRMED');
  assert.deepEqual((await cameras.listRegions(f.siteId, f.camera.id, 2, 1)).items, []);
});
