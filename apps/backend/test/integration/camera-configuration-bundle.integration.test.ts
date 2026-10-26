import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  computeCanonicalPayloadHash,
  parseCameraConfigurationBundlePayload,
} from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import {
  CameraEntity,
  CameraStatus,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraConfigurationReferenceService } from '../../src/modules/cameras/camera-configuration-reference.service.js';
import type { CameraConfigurationImageService } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('issued camera bundles retain exact immutable geometry and PPE policy without read-side issuance', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const headers = () =>
      db.query('SELECT * FROM camera_configuration_bundle ORDER BY configuration_version');
    await t.test('fresh schema permits empty rollback and re-upgrade', async () => {
      assert.deepEqual(await headers(), []);
      await db.undoLastMigration();
      assert.equal(
        (await db.query("SELECT to_regclass('camera_configuration_bundle') AS name"))[0].name,
        null,
      );
      await db.runMigrations();
    });
    const sites = new SiteConfigurationService(db),
      zones = new ZoneConfigurationService(db, sites);
    const cameras = new CameraConfigurationService(db, zones, sites);
    const site = await sites.create({ code: randomUUID(), name: 'Synthetic bundle Site' });
    const actorId = randomUUID(),
      context = { actorUserId: actorId };
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
      [actorId],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
      [randomUUID(), actorId, site.id],
    );
    const zone = await zones.create(
      site.id,
      {
        name: 'Required PPE',
        type: ZoneType.HAZARDOUS,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
        requiredPpe: ['SAFETY_VEST', 'HARD_HAT'],
      },
      context,
    );
    const camera = await cameras.create(
      site.id,
      { code: randomUUID(), externalId: randomUUID(), name: 'Synthetic Camera' },
      context,
    );
    let sessionId = randomUUID();
    const references = new CameraConfigurationReferenceService(db, {
      async read(_token: string, _site: string, requestedCamera: string) {
        const current = await db
          .getRepository(CameraEntity)
          .findOneByOrFail({ id: requestedCamera });
        const now = new Date().toISOString();
        return {
          schemaVersion: 1,
          purpose: 'REGION_CONFIGURATION',
          sourceKind: 'LIVE',
          siteId: site.id,
          cameraId: current.id,
          configurationVersion: current.configurationVersion,
          referenceExpiresAt: new Date(Date.parse(now) + 300000).toISOString(),
          frame: {
            sessionId,
            sequenceNumber: '1',
            cameraExternalId: current.externalId,
            capturedAt: now,
            width: 120,
            height: 80,
            imageSha256: 'a'.repeat(64),
            imageDataUrl: 'SYNTHETIC_NO_CAMERA',
          },
        };
      },
      async authorize(_token: string, _site: string, manager?: EntityManager) {
        if (manager) assert(manager.queryRunner?.isTransactionActive);
        return actorId;
      },
    } as unknown as CameraConfigurationImageService);
    const reference = () => references.read('synthetic-token', site.id, camera.id);
    const polygon = {
      coordinates: [
        [0.1, 0.1],
        [0.8, 0.1],
        [0.5, 0.8],
      ],
    };
    let regionId: string;
    let secondRegionId: string;
    await t.test(
      'reference reads issue nothing; reference-bound write retains canonical configuration',
      async () => {
        const issued = await reference();
        await reference();
        assert.deepEqual(await headers(), []);
        const region = await cameras.createReferenceRegion(
          site.id,
          camera.id,
          {
            zoneId: zone.id,
            expectedConfigurationVersion: 1,
            referenceId: issued.reference.referenceId,
            viewRevision: 1,
            confirmReferenceView: true,
            polygon,
          },
          context,
        );
        regionId = region.id;
        const [header] = await headers();
        assert.equal(header.configuration_version, '2');
        assert.equal(header.view_revision, '1');
        const bindings = await db.query(
          `SELECT b.*,g.polygon,g.coordinate_space,p.required_ppe FROM camera_configuration_bundle_region b
        JOIN camera_region_geometry_revision g ON g.region_id=b.region_id AND g.geometry_version=b.geometry_version
        JOIN zone_policy_revision p ON p.zone_id=b.zone_id AND p.policy_revision=b.policy_revision WHERE b.camera_id=$1`,
          [camera.id],
        );
        assert.equal(bindings.length, 1);
        assert.equal(bindings[0].policy_revision, '1');
        const content = {
          schemaVersion: '1.0.0',
          cameraId: camera.id,
          cameraExternalId: camera.externalId,
          configurationVersion: 2,
          viewRevision: 1,
          issuedAt: header.issued_at.toISOString(),
          regions: [
            {
              regionId,
              geometryVersion: 1,
              coordinateSpace: 'NORMALIZED_0_1',
              polygon,
              zoneId: zone.id,
              policyRevision: 1,
              requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
            },
          ],
        };
        assert.deepEqual(bindings[0].polygon, polygon);
        assert.deepEqual(bindings[0].required_ppe, ['HARD_HAT', 'SAFETY_VEST']);
        assert.equal(header.bundle_sha256, computeCanonicalPayloadHash(content));
        assert.equal(
          parseCameraConfigurationBundlePayload(
            JSON.stringify({ ...content, bundleSha256: header.bundle_sha256 }),
          ).isValid,
          true,
        );
      },
    );
    await t.test(
      'new view never recomputes old bundle; reconfirmation advances configuration',
      async () => {
        const original = await headers();
        sessionId = randomUUID();
        const issued = await reference();
        assert.equal(issued.reference.viewRevision, 2);
        assert.deepEqual(await headers(), original);
        await cameras.updateReferencePolygon(
          site.id,
          camera.id,
          regionId!,
          {
            expectedConfigurationVersion: 2,
            referenceId: issued.reference.referenceId,
            viewRevision: 2,
            confirmReferenceView: true,
            polygon,
          },
          context,
        );
        const current = await headers();
        assert.equal(current.length, 2);
        assert.deepEqual(current[0], original[0]);
        assert.equal(current[1].configuration_version, '3');
        assert.equal(current[1].view_revision, '2');
      },
    );
    await t.test(
      'bundle insertion failure rolls back region, camera and geometry history',
      async () => {
        const issued = await reference();
        await db.query(
          "CREATE FUNCTION synthetic_reject_bundle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic bundle failure' USING ERRCODE='23514'; END $$",
        );
        await db.query(
          'CREATE TRIGGER synthetic_bundle BEFORE INSERT ON camera_configuration_bundle FOR EACH ROW EXECUTE FUNCTION synthetic_reject_bundle()',
        );
        try {
          await assert.rejects(
            cameras.updateReferencePolygon(
              site.id,
              camera.id,
              regionId!,
              {
                expectedConfigurationVersion: 3,
                referenceId: issued.reference.referenceId,
                viewRevision: 2,
                confirmReferenceView: true,
                polygon,
              },
              context,
            ),
            /Synthetic bundle failure/,
          );
          assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 3);
          assert.equal((await cameras.getRegion(site.id, camera.id, regionId!)).version, 2);
          assert.equal((await headers()).length, 2);
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM camera_region_geometry_revision WHERE region_id=$1',
                [regionId!],
              )
            )[0].n,
            2,
          );
        } finally {
          await db.query('DROP TRIGGER synthetic_bundle ON camera_configuration_bundle');
          await db.query('DROP FUNCTION synthetic_reject_bundle()');
        }
      },
    );
    await t.test(
      'mixed view regions cannot issue; reconfirming all permits exact historical bindings',
      async () => {
        sessionId = randomUUID();
        const issued = await reference();
        const second = await cameras.createReferenceRegion(
          site.id,
          camera.id,
          {
            zoneId: zone.id,
            expectedConfigurationVersion: 3,
            referenceId: issued.reference.referenceId,
            viewRevision: 3,
            confirmReferenceView: true,
            polygon,
          },
          context,
        );
        secondRegionId = second.id;
        assert.equal((await headers()).length, 2);
        const refreshed = await reference();
        await cameras.updateReferencePolygon(
          site.id,
          camera.id,
          regionId!,
          {
            expectedConfigurationVersion: 4,
            referenceId: refreshed.reference.referenceId,
            viewRevision: 3,
            confirmReferenceView: true,
            polygon,
          },
          context,
        );
        const bindings = await db.query(
          'SELECT region_id,geometry_version FROM camera_configuration_bundle_region WHERE camera_id=$1 AND configuration_version=5 ORDER BY region_id',
          [camera.id],
        );
        assert.deepEqual(
          bindings,
          [
            { region_id: regionId!, geometry_version: 3 },
            { region_id: second.id, geometry_version: 1 },
          ].sort((a, b) => a.region_id.localeCompare(b.region_id)),
        );
        await cameras.setRegionActive(
          site.id,
          camera.id,
          second.id,
          { expectedConfigurationVersion: 5, isActive: false },
          context,
        );
        await cameras.setRegionActive(
          site.id,
          camera.id,
          regionId!,
          { expectedConfigurationVersion: 6, isActive: false },
          context,
        );
        const [empty] = await db.query(
          'SELECT * FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=7',
          [camera.id],
        );
        assert.ok(empty);
        assert.deepEqual(
          await db.query(
            'SELECT * FROM camera_configuration_bundle_region WHERE camera_id=$1 AND configuration_version=7',
            [camera.id],
          ),
          [],
        );
        await cameras.setStatus(
          site.id,
          camera.id,
          { expectedConfigurationVersion: 7, status: CameraStatus.INACTIVE },
          context,
        );
        assert.deepEqual(
          await db.query(
            'SELECT * FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=8',
            [camera.id],
          ),
          [],
        );
        await cameras.setStatus(
          site.id,
          camera.id,
          { expectedConfigurationVersion: 8, status: CameraStatus.ACTIVE },
          context,
        );
        await cameras.createRegion(
          site.id,
          camera.id,
          { zoneId: zone.id, expectedConfigurationVersion: 9, polygon },
          context,
        );
        assert.deepEqual(
          await db.query(
            'SELECT * FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=10',
            [camera.id],
          ),
          [],
        );
        const beforeRead = await headers();
        assert.equal(
          (await cameras.buildConfigurationForCamera(camera.id)).configurationVersion,
          10,
        );
        assert.deepEqual(await headers(), beforeRead);
      },
    );
    await t.test(
      'missing policy history rolls back a reference-bound create without inventing provenance',
      async () => {
        const id = randomUUID();
        await db.query(
          "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Unjournaled','STANDARD','NONE')",
          [id, site.id],
        );
        const other = await cameras.create(
          site.id,
          { code: randomUUID(), externalId: randomUUID(), name: 'Other synthetic Camera' },
          context,
        );
        const issued = await references.read('synthetic-token', site.id, other.id);
        await assert.rejects(
          cameras.createReferenceRegion(
            site.id,
            other.id,
            {
              zoneId: id,
              expectedConfigurationVersion: 1,
              referenceId: issued.reference.referenceId,
              viewRevision: 1,
              confirmReferenceView: true,
              polygon,
            },
            context,
          ),
          /policy history is unavailable/,
        );
        assert.equal((await cameras.get(site.id, other.id)).configurationVersion, 1);
        assert.deepEqual((await cameras.listRegions(site.id, other.id)).items, []);
        assert.equal((await zones.get(site.id, id)).configurationLocked, false);
        assert.deepEqual(
          await db.query('SELECT * FROM camera_configuration_bundle WHERE camera_id=$1', [
            other.id,
          ]),
          [],
        );
      },
    );
    await t.test(
      'stored bundles and bindings cannot be changed, removed or rolled back',
      async () => {
        const otherZone = await zones.create(
          site.id,
          {
            name: 'Other policy scope',
            type: ZoneType.STANDARD,
            restrictionPolicy: ZoneRestrictionPolicy.NONE,
            requiredPpe: [],
          },
          context,
        );
        await assert.rejects(
          db.query(
            `INSERT INTO camera_configuration_bundle_region
          (camera_id,configuration_version,region_id,geometry_version,zone_id,policy_revision)
          VALUES($1,2,$2,1,$3,1)`,
            [camera.id, secondRegionId!, otherZone.id],
          ),
          (e: { code?: string }) => e.code === '23503',
        );
        await assert.rejects(
          db.query(
            `INSERT INTO camera_configuration_bundle_region
          (camera_id,configuration_version,region_id,geometry_version,zone_id,policy_revision)
          VALUES($1,2,$2,1,$3,999)`,
            [camera.id, secondRegionId!, zone.id],
          ),
          (e: { code?: string }) => e.code === '23503',
        );
        for (const table of ['camera_configuration_bundle', 'camera_configuration_bundle_region'])
          for (const sql of [
            `UPDATE ${table} SET configuration_version=configuration_version`,
            `DELETE FROM ${table}`,
            `TRUNCATE ${table} CASCADE`,
          ])
            await assert.rejects(db.query(sql), (e: { code?: string }) => e.code === '23514');
        await assert.rejects(db.undoLastMigration(), /bundle history must be retained/);
        assert.equal((await headers()).length, 6);
      },
    );
  } finally {
    await owned.dispose();
  }
});
