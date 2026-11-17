import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { bootstrapUnownedCameraWorker } from '../../src/scripts/provision-camera-worker.js';
import {
  bootstrapCameraWorkerGeneration,
  provisionCameraWorkerGeneration,
  renewCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
const conflict = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 409;

test('bootstrap never displaces current/expired/revoked owners and concurrent cold starts have one winner', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      cameras = Array.from({ length: 4 }, () => randomUUID());
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic bootstrap Site')",
      [site],
    );
    for (const camera of cameras)
      await db.query(
        "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic bootstrap camera')",
        [camera, site],
      );
    const [camera, racing, rollback, inactive] = cameras as [string, string, string, string];
    const directory = await mkdtemp(join(tmpdir(), 'bootstrap-owner-proof-'));
    const connection = process.env.TEST_DATABASE_URL!,
      url = new URL(connection);
    const issue = () =>
      bootstrapUnownedCameraWorker(
        [
          '--camera-id',
          camera,
          '--lease-ms',
          '1000',
          '--output',
          join(directory, randomUUID() + '.json'),
          '--database-identity',
          `${url.hostname}:${url.port}/smartsite_test/${db.driver.schema}`,
        ],
        {
          DATABASE_URL: connection,
          DATABASE_SCHEMA: db.driver.schema,
          AI_CONFIGURATION_CAMERA_IDS: camera,
        },
      );
    const initial = await issue();
    assert.deepEqual(
      Object.keys(initial).sort(),
      ['cameraId', 'workerGenerationId', 'streamSessionId', 'expiresAt'].sort(),
    );
    const snapshot = () =>
      db.query(
        'SELECT id,is_current,issued_at,expires_at,superseded_at,revoked_at FROM camera_worker_generation ORDER BY id',
      );
    const before = await snapshot();
    await assert.rejects(issue(), conflict);
    assert.deepEqual(await snapshot(), before);
    await delay(Math.max(0, Date.parse(initial.expiresAt) - Date.now() + 100));
    await assert.rejects(issue(), conflict);
    assert.deepEqual(await snapshot(), before);
    await revokeCameraWorkerGeneration(db, camera, [camera], initial.workerGenerationId);
    const revoked = await snapshot();
    await assert.rejects(issue(), conflict);
    assert.deepEqual(await snapshot(), revoked);
    // Manual recovery is still explicit; adopting that reconciled current owner uses the guarded lane.
    const manual = await provisionCameraWorkerGeneration(db, camera, [camera], 60000);
    const resumed = await renewCameraWorkerGeneration(
      db,
      camera,
      [camera],
      60000,
      undefined,
      manual.workerGenerationId,
      randomUUID(),
    );
    assert.notEqual(resumed.workerGenerationId, manual.workerGenerationId);
    let deliveries = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        bootstrapCameraWorkerGeneration(db, racing, [racing], 60000, async () => {
          deliveries++;
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected' && conflict(r.reason)).length, 1);
    assert.equal(deliveries, 1);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM camera_worker_generation WHERE camera_id=$1',
          [racing],
        )
      )[0].n,
      1,
    );
    await assert.rejects(
      bootstrapCameraWorkerGeneration(db, rollback, [rollback], 60000, async () => {
        throw Error('Synthetic delivery failure');
      }),
      /Synthetic delivery failure/,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM camera_worker_generation WHERE camera_id=$1',
          [rollback],
        )
      )[0].n,
      0,
    );
    await bootstrapCameraWorkerGeneration(db, rollback, [rollback], 60000);
    await db.query("UPDATE camera SET status='INACTIVE' WHERE id=$1", [inactive]);
    await assert.rejects(
      bootstrapCameraWorkerGeneration(db, inactive, [inactive], 60000),
      conflict,
    );
    // Refused operator attempts retain empty recovery files, not newly issued secrets.
    const { readdir } = await import('node:fs/promises');
    const files = await Promise.all(
      (await readdir(directory)).map((f) => readFile(join(directory, f), 'utf8')),
    );
    assert.equal(files.filter((f) => f.length > 0).length, 1);
  } finally {
    await owned.dispose();
  }
});
