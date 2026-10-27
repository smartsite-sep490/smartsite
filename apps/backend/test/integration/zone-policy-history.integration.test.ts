import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  SiteEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Zone PPE policy history is immutable, truthful at cutover and atomic with commands', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const migrations = db.options.migrations;
  assert(Array.isArray(migrations));
  const policyIndex = migrations.findIndex(
    (m) => typeof m === 'function' && m.name === 'ZonePolicyRevisions1793664000000',
  );
  assert.equal(policyIndex, 77);
  db.setOptions({ migrations: migrations.slice(0, policyIndex + 1) });
  const siteId = randomUUID(),
    oldZoneId = randomUUID();
  const policy = {
    type: ZoneType.HAZARDOUS,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT'],
  };
  try {
    await owned.initialize();
    const rows = (id: string) =>
      db.query('SELECT * FROM zone_policy_revision WHERE zone_id=$1 ORDER BY policy_revision', [
        id,
      ]);
    await t.test(
      'fresh schema contains the reviewed table and supports empty rollback',
      async () => {
        assert.deepEqual(await rows(oldZoneId), []);
        const [last] = await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1');
        assert.equal(last.name, 'ZonePolicyRevisions1793664000000');
        await db.undoLastMigration();
        assert.equal(
          (await db.query("SELECT to_regclass('zone_policy_revision') AS name"))[0].name,
          null,
        );
      },
    );
    await db
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: siteId, name: 'Synthetic policy Site' });
    await db.getRepository(ZoneEntity).insert({
      id: oldZoneId,
      siteId,
      code: oldZoneId,
      name: 'Old Zone',
      ...policy,
      createdAt: new Date('2020-01-01Z'),
    });
    const before = Date.now();
    const cameraId = randomUUID(),
      regionId = randomUUID();
    const polygon = {
      coordinates: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    };
    await db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId: cameraId,
      code: cameraId,
      name: 'Historical camera',
    });
    await db.getRepository(CameraObservationRegionEntity).insert({
      id: regionId,
      cameraId,
      zoneId: oldZoneId,
      polygon,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 3,
      isActive: true,
    });
    await db.query(
      `INSERT INTO camera_region_geometry_revision
      (region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline)
      VALUES($1,3,$2,$3,1,'NORMALIZED_0_1',$4,true,true)`,
      [regionId, cameraId, oldZoneId, JSON.stringify(polygon)],
    );
    const oldGeometry = await db.query('SELECT * FROM camera_region_geometry_revision');
    await db.runMigrations();
    await t.test(
      'upgrade preserves geometry history and creates only a current-policy baseline',
      async () => {
        const [row] = await rows(oldZoneId);
        assert.equal(row.policy_revision, '1');
        assert.equal(row.is_cutover_baseline, true);
        assert.deepEqual(row.required_ppe, ['HARD_HAT']);
        assert.ok(row.recorded_at.getTime() >= before);
        assert.deepEqual(
          await db.query('SELECT * FROM camera_region_geometry_revision'),
          oldGeometry,
        );
      },
    );
    const service = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await service.create(siteId, { name: 'New Zone', ...policy });
    await t.test(
      'create, no-op, rename and serialized real policy changes have exact revisions',
      async () => {
        assert.equal((await rows(zone.id))[0].is_cutover_baseline, false);
        await service.updatePolicy(siteId, zone.id, policy);
        await service.rename(siteId, zone.id, { name: 'Renamed Zone' });
        assert.equal((await rows(zone.id)).length, 1);
        await Promise.all([
          service.updatePolicy(siteId, zone.id, { ...policy, requiredPpe: ['SAFETY_VEST'] }),
          service.updatePolicy(siteId, zone.id, { ...policy, requiredPpe: ['GLOVES'] }),
        ]);
        const history = await rows(zone.id);
        assert.deepEqual(
          history.map((r: { policy_revision: string }) => r.policy_revision),
          ['1', '2', '3'],
        );
        assert.deepEqual(history[0].required_ppe, ['HARD_HAT']);
        assert.deepEqual(history[2].required_ppe, (await service.get(siteId, zone.id)).requiredPpe);
      },
    );
    await t.test(
      'history insertion failure rolls back mutable policy and new Zone creation',
      async () => {
        await db.query(
          "CREATE FUNCTION synthetic_reject_policy_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic policy failure' USING ERRCODE='23514'; END $$",
        );
        await db.query(
          'CREATE TRIGGER synthetic_reject_policy BEFORE INSERT ON zone_policy_revision FOR EACH ROW EXECUTE FUNCTION synthetic_reject_policy_history()',
        );
        const saved = await service.get(siteId, zone.id);
        try {
          await assert.rejects(
            service.updatePolicy(siteId, zone.id, { ...policy, requiredPpe: ['BOOTS'] }),
            /Synthetic policy failure/,
          );
          assert.deepEqual((await service.get(siteId, zone.id)).requiredPpe, saved.requiredPpe);
          await assert.rejects(
            service.create(siteId, { code: 'ROLLBACK', name: 'Must roll back', ...policy }),
            /Synthetic policy failure/,
          );
          assert.equal(await db.getRepository(ZoneEntity).countBy({ siteId, code: 'ROLLBACK' }), 0);
          assert.equal((await rows(zone.id)).length, 3);
        } finally {
          await db.query('DROP TRIGGER synthetic_reject_policy ON zone_policy_revision');
          await db.query('DROP FUNCTION synthetic_reject_policy_history()');
        }
      },
    );
    await t.test('locked Zone cannot change policy or append a revision', async () => {
      await db.transaction(async (manager) =>
        service.markLinked(manager, await service.lockForRegion(manager, siteId, zone.id)),
      );
      await assert.rejects(
        service.updatePolicy(siteId, zone.id, { ...policy, requiredPpe: ['BOOTS'] }),
        /locked/,
      );
      assert.equal((await rows(zone.id)).length, 3);
    });
    await t.test(
      'missing policy history and exhausted revision fail closed without changing policy',
      async () => {
        const id = randomUUID();
        await db
          .getRepository(ZoneEntity)
          .insert({ id, siteId, code: id, name: 'Unjournaled Zone', ...policy });
        await assert.rejects(
          service.updatePolicy(siteId, id, { ...policy, requiredPpe: ['BOOTS'] }),
          /history is unavailable/,
        );
        assert.deepEqual((await service.get(siteId, id)).requiredPpe, ['HARD_HAT']);
        await db.query(
          `INSERT INTO zone_policy_revision(zone_id,policy_revision,site_id,zone_type,restriction_policy,required_ppe)
        SELECT zone_id,9007199254740991,site_id,zone_type,restriction_policy,required_ppe FROM zone_policy_revision WHERE zone_id=$1`,
          [oldZoneId],
        );
        await assert.rejects(
          service.updatePolicy(siteId, oldZoneId, { ...policy, requiredPpe: ['BOOTS'] }),
          /revision limit reached/,
        );
        assert.deepEqual((await service.get(siteId, oldZoneId)).requiredPpe, ['HARD_HAT']);
      },
    );
    await t.test(
      'database rejects mutable history, invalid PPE, mismatched scope and populated rollback',
      async () => {
        for (const sql of [
          'UPDATE zone_policy_revision SET is_cutover_baseline=false',
          'DELETE FROM zone_policy_revision',
          'TRUNCATE zone_policy_revision',
        ])
          await assert.rejects(db.query(sql), (e: { code?: string }) => e.code === '23514');
        const clone =
          'INSERT INTO zone_policy_revision(zone_id,policy_revision,site_id,zone_type,restriction_policy,required_ppe) SELECT zone_id,99,$2,zone_type,restriction_policy,$3 FROM zone_policy_revision WHERE zone_id=$1 LIMIT 1';
        for (const ppe of [['MASK'], ['HARD_HAT', 'HARD_HAT'], [null]])
          await assert.rejects(
            db.query(clone, [zone.id, siteId, ppe]),
            (e: { code?: string }) => e.code === '23514',
          );
        const other = randomUUID();
        await db.getRepository(SiteEntity).insert({ id: other, code: other, name: 'Other Site' });
        await assert.rejects(
          db.query(clone, [zone.id, other, []]),
          (e: { code?: string }) => e.code === '23503',
        );
        await assert.rejects(db.undoLastMigration(), /policy history must be retained/);
        assert.equal((await rows(zone.id)).length, 3);
      },
    );
  } finally {
    await owned.dispose();
  }
});
