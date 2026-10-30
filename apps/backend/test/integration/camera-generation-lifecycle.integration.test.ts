import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import {
  provisionCameraWorkerGeneration as provision,
  revokeCameraWorkerGeneration as revoke,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { CameraWorkerGenerationEntity } from '../../src/database/entities/camera-worker-generation.entity.js';
import { CameraWorkerGenerations1794614400000 } from '../../src/database/migrations/1794614400000-CameraWorkerGenerations.js';

test('generation lifecycle retains server ownership, transactional replacement and exact schema', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  // Exercise this migration explicitly even when newer migrations are registered.
  const migrateGeneration = async (direction: 'up' | 'down') => {
    const runner = db.createQueryRunner();
    try {
      await runner.startTransaction();
      await new CameraWorkerGenerations1794614400000()[direction](runner);
      await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  };
  try {
    await owned.initialize();
    await t.test(
      'fresh metadata matches; empty rollback/up and parent cleanup remain valid',
      async () => {
        assert.deepEqual(
          (await db.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query),
          [],
        );
        await db.query('TRUNCATE app_user CASCADE');
        await db.query('TRUNCATE camera CASCADE');
        await migrateGeneration('down');
        await migrateGeneration('up');
      },
    );
    const site = randomUUID(),
      camera = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name)VALUES($1,$1::uuid::text,'Synthetic generation Site')",
      [site],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name)VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic generation Camera')",
      [camera, site],
    );
    const first = await provision(db, camera, [camera], 60000);
    await t.test(
      'only hash is persisted and default entity projection excludes credential',
      async () => {
        const [stored] = await db.query(
          'SELECT credential_sha256 FROM camera_worker_generation WHERE id=$1',
          [first.workerGenerationId],
        );
        assert.equal(
          stored.credential_sha256,
          createHash('sha256').update(first.secret).digest('hex'),
        );
        const projected = await db
          .getRepository(CameraWorkerGenerationEntity)
          .findOneByOrFail({ id: first.workerGenerationId });
        assert.equal(projected.credentialSha256, undefined);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM camera_configuration_application_receipt',
            )
          )[0].n,
          0,
        );
      },
    );
    await t.test(
      'failed local credential delivery preserves prior generation atomically',
      async () => {
        await assert.rejects(
          provision(db, camera, [camera], 60000, async () => {
            throw new Error('Synthetic local delivery failure');
          }),
          /Synthetic/,
        );
        const rows = await db.query('SELECT id FROM camera_worker_generation WHERE is_current');
        assert.deepEqual(rows, [{ id: first.workerGenerationId }]);
      },
    );
    await t.test(
      'parallel replacements leave one current generation; repeated revoke is terminal',
      async () => {
        await Promise.all([
          provision(db, camera, [camera], 60000),
          provision(db, camera, [camera], 60000),
        ]);
        const [current] = await db.query(
          'SELECT id FROM camera_worker_generation WHERE is_current',
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM camera_worker_generation'))[0].n,
          3,
        );
        await revoke(db, camera, [camera], current.id);
        const before = await db.query(
          'SELECT revoked_at FROM camera_worker_generation WHERE id=$1',
          [current.id],
        );
        await revoke(db, camera, [camera], current.id);
        assert.deepEqual(
          await db.query('SELECT revoked_at FROM camera_worker_generation WHERE id=$1', [
            current.id,
          ]),
          before,
        );
        await assert.rejects(
          db.query(
            'UPDATE camera_worker_generation SET is_current=true,revoked_at=NULL WHERE id=$1',
            [current.id],
          ),
          /immutable|terminal/,
        );
        await assert.rejects(
          db.query('TRUNCATE camera_worker_generation CASCADE'),
          /cannot be removed/,
        );
        await assert.rejects(migrateGeneration('down'), /populated worker generation history/);
      },
    );
  } finally {
    await owned.dispose();
  }
});
