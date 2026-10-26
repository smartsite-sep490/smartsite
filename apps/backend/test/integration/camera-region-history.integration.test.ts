import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Region history preserves active state, cutover truth and atomic legacy mutations', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const polygon = {
    coordinates: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  };
  const changed = {
    coordinates: [
      [0, 0],
      [0.8, 0],
      [0, 0.8],
    ],
  };
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    oldId = randomUUID();
  try {
    await owned.initialize();
    const history = () =>
      db.query(
        'SELECT * FROM camera_region_geometry_revision ORDER BY region_id, geometry_version',
      );
    await t.test('fresh schema has history and permits empty rollback', async () => {
      assert.deepEqual(await history(), []);
      await db.undoLastMigration();
      assert.equal(
        (await db.query("SELECT to_regclass('camera_region_geometry_revision') AS name"))[0].name,
        null,
      );
    });
    await db
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: siteId, name: 'Synthetic history Site' });
    await db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: cameraId,
      code: cameraId,
      name: 'Synthetic Camera',
      configurationVersion: 11,
    });
    await db.getRepository(ZoneEntity).insert({
      id: zoneId,
      siteId,
      code: zoneId,
      name: 'Synthetic Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      requiredPpe: ['HARD_HAT'],
    });
    await db.getRepository(CameraObservationRegionEntity).insert({
      id: oldId,
      cameraId,
      zoneId,
      polygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 7,
      isActive: false,
      createdAt: new Date('2020-01-01Z'),
    });
    const beforeUpgrade = Date.now();
    await db.runMigrations();
    await t.test('upgrade records one truthful current-state baseline', async () => {
      const [baseline] = await history();
      assert.equal(baseline.region_id, oldId);
      assert.equal(baseline.geometry_version, 7);
      assert.equal(baseline.configuration_version, '11');
      assert.equal(baseline.is_active, false);
      assert.equal(baseline.is_cutover_baseline, true);
      assert.equal(baseline.reference_id, null);
      assert.equal(baseline.confirmed_at, null);
      assert.ok(baseline.recorded_at.getTime() >= beforeUpgrade);
      assert.equal((await history()).length, 1);
    });
    const sites = new SiteConfigurationService(db);
    const zones = new ZoneConfigurationService(db, sites);
    const cameras = new CameraConfigurationService(db, zones, sites);
    let id: string;
    await t.test(
      'legacy create, polygon, active and Camera status changes append exact versions',
      async () => {
        const created = await cameras.createRegion(siteId, cameraId, {
          zoneId,
          polygon,
          expectedConfigurationVersion: 11,
        });
        id = created.id;
        await cameras.updatePolygon(siteId, cameraId, id, {
          polygon: changed,
          expectedConfigurationVersion: 12,
        });
        await cameras.updatePolygon(siteId, cameraId, id, {
          polygon: changed,
          expectedConfigurationVersion: 13,
        });
        await cameras.setRegionActive(siteId, cameraId, id, {
          isActive: false,
          expectedConfigurationVersion: 13,
        });
        await cameras.setRegionActive(siteId, cameraId, id, {
          isActive: true,
          expectedConfigurationVersion: 14,
        });
        await cameras.setStatus(siteId, cameraId, {
          status: CameraStatus.INACTIVE,
          expectedConfigurationVersion: 15,
        });
        const rows = (await history()).filter((r: { region_id: string }) => r.region_id === id);
        assert.deepEqual(
          rows.map((r: { geometry_version: number }) => r.geometry_version),
          [1, 2, 3, 4, 5],
        );
        assert.deepEqual(
          rows.map((r: { configuration_version: string }) => r.configuration_version),
          ['12', '13', '14', '15', '16'],
        );
        assert.deepEqual(
          rows.map((r: { is_active: boolean }) => r.is_active),
          [true, true, false, true, true],
        );
        assert.deepEqual(rows[0].polygon, polygon);
        assert.deepEqual(rows[4].polygon, changed);
        assert.ok(
          rows.every(
            (r: { is_cutover_baseline: boolean; reference_id: string | null }) =>
              !r.is_cutover_baseline && r.reference_id === null,
          ),
        );
        assert.equal((await cameras.getRegion(siteId, cameraId, oldId)).version, 7);
      },
    );
    await t.test('history failure rolls back Region and Camera mutations together', async () => {
      await db.query(
        "CREATE FUNCTION synthetic_reject_region_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure' USING ERRCODE='23514'; END $$",
      );
      await db.query(
        'CREATE TRIGGER synthetic_reject_history BEFORE INSERT ON camera_region_geometry_revision FOR EACH ROW EXECUTE FUNCTION synthetic_reject_region_history()',
      );
      try {
        await assert.rejects(
          cameras.setRegionActive(siteId, cameraId, id!, {
            isActive: false,
            expectedConfigurationVersion: 16,
          }),
        );
        const region = await cameras.getRegion(siteId, cameraId, id!);
        assert.equal(region.version, 5);
        assert.equal(region.isActive, true);
        assert.equal((await cameras.get(siteId, cameraId)).configurationVersion, 16);
        assert.equal((await history()).length, 6);
      } finally {
        await db.query('DROP TRIGGER synthetic_reject_history ON camera_region_geometry_revision');
        await db.query('DROP FUNCTION synthetic_reject_region_history()');
      }
    });
    await t.test(
      'composite Region scope and complete confirmation provenance are required',
      async () => {
        const otherCamera = randomUUID();
        await db.getRepository(CameraEntity).insert({
          id: otherCamera,
          siteId,
          externalId: otherCamera,
          code: otherCamera,
          name: 'Other synthetic Camera',
        });
        const clone = `INSERT INTO camera_region_geometry_revision
        (region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline,reference_id)
        SELECT region_id,geometry_version+1,$1,zone_id,100,coordinate_space,polygon,is_active,false,$2
        FROM camera_region_geometry_revision WHERE region_id=$3`;
        await assert.rejects(
          db.query(clone, [otherCamera, null, oldId]),
          (e: { code?: string }) => e.code === '23503',
        );
        await assert.rejects(
          db.query(clone, [cameraId, randomUUID(), oldId]),
          (e: { code?: string }) => e.code === '23514',
        );
        assert.equal((await history()).length, 6);
      },
    );
    await t.test(
      'immutable history rejects update, delete, truncate and populated rollback',
      async () => {
        for (const sql of [
          'UPDATE camera_region_geometry_revision SET is_active=NOT is_active',
          'DELETE FROM camera_region_geometry_revision',
          'TRUNCATE camera_region_geometry_revision',
        ]) {
          await assert.rejects(db.query(sql), (e: { code?: string }) => e.code === '23514');
        }
        await assert.rejects(db.undoLastMigration(), /Region revision history must be retained/);
        assert.equal((await history()).length, 6);
      },
    );
  } finally {
    await owned.dispose();
  }
});
