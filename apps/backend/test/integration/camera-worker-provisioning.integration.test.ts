import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { provisionCameraWorker } from '../../src/scripts/provision-camera-worker.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('operator provisions only an explicit migrated owned schema with durable exclusive delivery', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const root = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : tmpdir();
  const dir = await mkdtemp(path.join(root, 'operator-owned-test-'));
  try {
    await owned.initialize();
    const site = randomUUID(),
      camera = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name)VALUES($1,$1::uuid::text,'Synthetic operator Site')",
      [site],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name)VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic operator Camera')",
      [camera, site],
    );
    const url = resolveTestDatabaseUrl();
    const target = new URL(url);
    assert.equal(db.options.type, 'postgres');
    const schema = db.options.schema;
    assert.equal(typeof schema, 'string');
    const env = { DATABASE_URL: url, DATABASE_SCHEMA: schema, AI_CONFIGURATION_CAMERA_IDS: camera };
    const args = (output: string, scope = schema, id: string = camera) => [
      '--camera-id',
      id,
      '--lease-ms',
      '60000',
      '--output',
      path.join(dir, output),
      '--database-identity',
      `${target.hostname}:${target.port}/${target.pathname.slice(1)}/${scope}`,
    ];
    let generationId: string;
    await t.test(
      'actual command function uses the explicit target and persists only the credential hash',
      async () => {
        await provisionCameraWorker(args('credential.json'), env);
        const credential = JSON.parse(await readFile(path.join(dir, 'credential.json'), 'utf8'));
        generationId = credential.workerGenerationId;
        assert.equal(credential.cameraId, camera);
        assert.equal(credential.schemaVersion, '1.0.0');
        const [stored] = await db.query(
          'SELECT id,stream_session_id,credential_sha256,is_current FROM camera_worker_generation WHERE camera_id=$1',
          [camera],
        );
        assert.equal(stored.id, credential.workerGenerationId);
        assert.equal(stored.stream_session_id, credential.streamSessionId);
        assert.equal(
          stored.credential_sha256,
          createHash('sha256').update(credential.secret).digest('hex'),
        );
        assert.equal(stored.is_current, true);
      },
    );
    await t.test(
      'existing output refuses issuance and preserves the current generation',
      async () => {
        await assert.rejects(provisionCameraWorker(args('credential.json'), env));
        const rows = await db.query(
          'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
          [camera],
        );
        assert.deepEqual(rows, [{ id: generationId }]);
      },
    );
    await t.test('missing schema cannot fall through to public or issue a generation', async () => {
      const absent = `isolated_test_absent_${randomUUID().replaceAll('-', '')}`;
      await assert.rejects(
        provisionCameraWorker(args('missing-schema.json', absent), {
          ...env,
          DATABASE_SCHEMA: absent,
        }),
        /Connected database identity mismatch/,
      );
      assert.equal((await readFile(path.join(dir, 'missing-schema.json'))).length, 0);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM camera_worker_generation'))[0].n,
        1,
      );
    });
    await t.test(
      'failed issuance leaves the recovery artifact and prior generation intact',
      async () => {
        const missing = randomUUID();
        await assert.rejects(
          provisionCameraWorker(args('missing-camera.json', schema, missing), {
            ...env,
            AI_CONFIGURATION_CAMERA_IDS: missing,
          }),
        );
        assert.equal((await readFile(path.join(dir, 'missing-camera.json'))).length, 0);
        assert.deepEqual(
          await db.query('SELECT id FROM camera_worker_generation WHERE is_current'),
          [{ id: generationId }],
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
