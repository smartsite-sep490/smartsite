import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { GateRegistry1795046400001 } from '../../src/database/migrations/1795046400001-GateRegistry.js';
import { CameraEntity, CameraObservationRegionEntity } from '../../src/database/entities/index.js';

test('Gate upgrade retains unambiguous legacy Zone cameras and refuses unresolved legacy data', async (t) => {
  const owned = createIsolatedTestDatabase();
  await owned.initialize();
  const db = owned.dataSource;
  const migration = new GateRegistry1795046400001();
  async function legacyFixture(run: (runner: QueryRunner, ids: string[]) => Promise<void>) {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await migration.down(runner);
      const ids = Array.from({ length: 8 }, () => randomUUID());
      const [siteA, siteB, cameraA, cameraB, zoneA, zoneB, userId] = ids;
      for (const id of [siteA, siteB])
        await runner.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$2)', [
          id,
          'Synthetic migration Site',
        ]);
      await runner.query(
        'INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,$2,$3)',
        [userId, 'Synthetic account', 'synthetic-not-a-login-hash'],
      );
      for (const [id, siteId] of [
        [cameraA, siteA],
        [cameraB, siteB],
      ])
        await runner.query(
          'INSERT INTO camera(id,site_id,external_id,code,name,configuration_version) VALUES($1,$2,$1::uuid::text,$1::uuid::text,$3,7)',
          [id, siteId, 'Synthetic retained Zone camera'],
        );
      for (const [id, siteId] of [
        [zoneA, siteA],
        [zoneB, siteB],
      ])
        await runner.query(
          "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,$3,'STANDARD','NONE')",
          [id, siteId, 'Synthetic Zone'],
        );
      for (const [cameraId, zoneId] of [
        [cameraA, zoneA],
        [cameraB, zoneB],
        [cameraB, zoneB],
      ])
        await runner.query(
          'INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4)',
          [
            randomUUID(),
            cameraId,
            zoneId,
            {
              coordinates: [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            },
          ],
        );
      await run(runner, ids);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }
  try {
    await t.test('retains every original Camera, Region, Site and account field', async () => {
      await legacyFixture(async (runner) => {
        const cameras = await runner.query('SELECT to_jsonb(c) AS value FROM camera c ORDER BY id');
        const regions = await runner.query(
          'SELECT to_jsonb(r) AS value FROM camera_observation_region r ORDER BY id',
        );
        const users = await runner.query('SELECT to_jsonb(u) AS value FROM app_user u ORDER BY id');
        const sites = await runner.query('SELECT to_jsonb(s) AS value FROM site s ORDER BY id');
        await migration.up(runner);
        assert.deepEqual(
          await runner.query(
            "SELECT to_jsonb(c)-'type'-'gate_id' AS value FROM camera c ORDER BY id",
          ),
          cameras,
        );
        assert.deepEqual(
          await runner.query(
            "SELECT to_jsonb(r)-'site_id' AS value FROM camera_observation_region r ORDER BY id",
          ),
          regions,
        );
        assert.deepEqual(
          await runner.query('SELECT to_jsonb(u) AS value FROM app_user u ORDER BY id'),
          users,
        );
        assert.deepEqual(
          await runner.query('SELECT to_jsonb(s) AS value FROM site s ORDER BY id'),
          sites,
        );
        const mappedCameras = await runner.manager.getRepository(CameraEntity).find();
        assert.equal(mappedCameras.length, 2);
        assert.ok(
          mappedCameras.every(
            (c) => c.type === 'ZONE' && c.gateId === null && c.configurationVersion === 7,
          ),
        );
        const mappedRegions = await runner.manager
          .getRepository(CameraObservationRegionEntity)
          .find();
        assert.equal(mappedRegions.length, 3);
        assert.ok(
          mappedRegions.every(
            (r) => r.siteId === mappedCameras.find((c) => c.id === r.cameraId)!.siteId,
          ),
        );
        assert.deepEqual(await runner.query('SELECT count(*)::int AS count FROM gate'), [
          { count: 0 },
        ]);
      });
    });
    await t.test('refuses to invent a purpose for a camera without Region evidence', async () => {
      await legacyFixture(async (runner, ids) => {
        await runner.query('DELETE FROM camera_observation_region WHERE camera_id=$1', [ids[2]]);
        await runner.query('SAVEPOINT before_upgrade');
        await assert.rejects(migration.up(runner), /Camera without an observation Region/);
        await runner.query('ROLLBACK TO SAVEPOINT before_upgrade');
        assert.deepEqual(await runner.query("SELECT to_regclass('gate') AS name"), [
          { name: null },
        ]);
        assert.deepEqual(await runner.query('SELECT count(*)::int AS count FROM camera'), [
          { count: 2 },
        ]);
      });
    });
    await t.test('refuses cross-Site Region bindings without rewriting their history', async () => {
      await legacyFixture(async (runner, ids) => {
        await runner.query('UPDATE camera_observation_region SET zone_id=$1 WHERE camera_id=$2', [
          ids[5],
          ids[2],
        ]);
        await runner.query('SAVEPOINT before_upgrade');
        await assert.rejects(migration.up(runner), /invalid Camera\/Region\/Zone Site bindings/);
        await runner.query('ROLLBACK TO SAVEPOINT before_upgrade');
        assert.deepEqual(await runner.query("SELECT to_regclass('gate') AS name"), [
          { name: null },
        ]);
      });
    });
    await t.test(
      'refuses existing legacy Gate logs and preserves their original Gate identifier',
      async () => {
        await legacyFixture(async (runner, ids) => {
          await runner.query(
            "INSERT INTO gate_access_log(id,site_id,gate_id,operator_user_id,direction,decision) VALUES($1,$2,'legacy-main',$3,'IN','{}')",
            [randomUUID(), ids[0], ids[6]],
          );
          await runner.query('SAVEPOINT before_upgrade');
          await assert.rejects(
            migration.up(runner),
            /explicit migration plan for legacy Gate history/,
          );
          await runner.query('ROLLBACK TO SAVEPOINT before_upgrade');
          assert.deepEqual(await runner.query('SELECT gate_id FROM gate_access_log'), [
            { gate_id: 'legacy-main' },
          ]);
        });
      },
    );
  } finally {
    await owned.dispose();
  }
});
