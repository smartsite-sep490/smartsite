import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { provisionCameraWorker } from '../../src/scripts/provision-camera-worker.js';
import { CameraWorkerGenerations1793836800000 } from '../../src/database/migrations/1793836800000-CameraWorkerGenerations.js';

const fixtureRoot = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : tmpdir();
const workerGenerationMigration = new CameraWorkerGenerations1793836800000();

type Provision = (
  source: DataSource,
  cameraId: string,
  allowedCameraIds: readonly string[],
  leaseMs: number,
) => Promise<{
  workerGenerationId: string;
  streamSessionId: string;
  secret: string;
  expiresAt: string;
}>;
type Revoke = (
  source: DataSource,
  cameraId: string,
  allowedCameraIds: readonly string[],
  generationId: string,
) => Promise<void>;

test('reviewed release persists owned worker generations and immutable configuration receipts', async (t) => {
  const owned = createIsolatedTestDatabase();
  try {
    await owned.initialize();
    const [{ schemaName }] = await owned.dataSource.query(
      'SELECT current_schema() AS "schemaName"',
    );
    assert.match(schemaName, /^isolated_test_[0-9a-f]{32}$/);
    console.info(`FRAME_TEST_SCHEMA:${schemaName}`);
    const tables = await owned.dataSource.query(
      `SELECT to_regclass('camera_worker_generation') AS generation,
        to_regclass('camera_configuration_application_receipt') AS receipt`,
    );
    assert.equal(tables[0].generation, 'camera_worker_generation');
    assert.equal(tables[0].receipt, 'camera_configuration_application_receipt');
    await t.test('empty rollback and upgrade preserve preexisting camera rows', async () => {
      const siteId = randomUUID(),
        cameraId = randomUUID();
      await owned.dataSource.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Preserved site')",
        [siteId],
      );
      await owned.dataSource.query(
        "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Preserved camera')",
        [cameraId, siteId],
      );
      // Later migrations must not change which rollback is under test.
      await owned.dataSource.transaction((manager) =>
        workerGenerationMigration.down(manager.queryRunner!),
      );
      assert.equal(
        (await owned.dataSource.query("SELECT to_regclass('camera_worker_generation') AS name"))[0]
          .name,
        null,
      );
      await owned.dataSource.transaction((manager) =>
        workerGenerationMigration.up(manager.queryRunner!),
      );
      assert.equal(
        (await owned.dataSource.query('SELECT id FROM camera WHERE id=$1', [cameraId]))[0].id,
        cameraId,
      );
    });
  } finally {
    await owned.dispose();
  }
});

test('operator generations supersede atomically and never persist plaintext credentials', async (t) => {
  const provision: Provision = provisionCameraWorkerGeneration;
  const revoke: Revoke = revokeCameraWorkerGeneration;
  assert.equal(typeof provision, 'function', 'Operator provision command is implemented');
  assert.equal(typeof revoke, 'function', 'Operator revocation command is implemented');
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      otherSite = randomUUID(),
      cameraId = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic operator site'),($2,$2::uuid::text,'Other site')",
      [siteId, otherSite],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic camera')",
      [cameraId, siteId],
    );
    const rows = () =>
      db.query('SELECT * FROM camera_worker_generation WHERE camera_id=$1 ORDER BY issued_at,id', [
        cameraId,
      ]);
    await t.test('allowlist and finite lease rejected before any issuance', async () => {
      for (const [allowed, lease] of [
        [[], 60000],
        [[cameraId], 0],
        [[cameraId], NaN],
        [[cameraId], 86400001],
      ] as const)
        await assert.rejects(provision!(db, cameraId, allowed, lease));
      assert.equal((await rows()).length, 0);
    });
    const first = await provision!(db, cameraId, [cameraId], 60000);
    await t.test(
      'failed credential delivery rolls back issuance and preserves current generation',
      async () => {
        const before = await rows();
        await assert.rejects(
          provisionCameraWorkerGeneration(db, cameraId, [cameraId], 60000, async () => {
            throw new Error('Synthetic local delivery failure');
          }),
          /Synthetic local delivery failure/,
        );
        assert.deepEqual(await rows(), before);
      },
    );
    await t.test('server allocates session and secret, only its digest is stored', async () => {
      assert.match(first.secret, /^[A-Za-z0-9_-]{43}$/);
      const [stored] = await rows();
      assert.equal(stored.id, first.workerGenerationId);
      assert.equal(stored.stream_session_id, first.streamSessionId);
      assert.equal(
        stored.credential_sha256,
        createHash('sha256').update(first.secret).digest('hex'),
      );
      assert(!JSON.stringify(stored).includes(first.secret));
      assert.equal(new Date(first.expiresAt).getTime() - stored.issued_at.getTime(), 60000);
    });
    await t.test('concurrent provision leaves exactly one active generation', async () => {
      const issued = await Promise.all([
        provision!(db, cameraId, [cameraId], 60000),
        provision!(db, cameraId, [cameraId], 60000),
      ]);
      const stored = await rows();
      assert.equal(stored.length, 3);
      assert.equal(stored.filter((row: { is_current: boolean }) => row.is_current).length, 1);
      assert.equal(
        stored.find((row: { id: string }) => row.id === first.workerGenerationId).is_current,
        false,
      );
      assert.notEqual(issued[0]!.secret, issued[1]!.secret);
      assert.notEqual(issued[0]!.streamSessionId, issued[1]!.streamSessionId);
    });
    await t.test(
      'actual operator command delivers credentials only for its explicit owned database target',
      async () => {
        const directory = await mkdtemp(path.join(fixtureRoot, 'worker-generation-pg-test-'));
        const output = path.join(directory, 'credential.json');
        const connection = resolveTestDatabaseUrl();
        const url = new URL(connection);
        assert.equal(db.options.type, 'postgres');
        if (db.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
        const schema = String(db.options.schema);
        await provisionCameraWorker(
          [
            '--camera-id',
            cameraId,
            '--lease-ms',
            '60000',
            '--output',
            output,
            '--database-identity',
            `${url.hostname}:${url.port}/${url.pathname.slice(1)}/${schema}`,
          ],
          {
            DATABASE_URL: connection,
            DATABASE_SCHEMA: schema,
            AI_CONFIGURATION_CAMERA_IDS: cameraId,
          },
        );
        const delivered = JSON.parse(await readFile(output, 'utf8'));
        const current = (await rows()).find((row: { is_current: boolean }) => row.is_current);
        assert.equal(delivered.cameraId, cameraId);
        assert.equal(delivered.workerGenerationId, current.id);
        assert.equal(delivered.streamSessionId, current.stream_session_id);
        assert.equal(
          createHash('sha256').update(delivered.secret).digest('hex'),
          current.credential_sha256,
        );
        assert(!JSON.stringify(current).includes(delivered.secret));
      },
    );
    await t.test('lifecycle and cross-site storage fail closed', async () => {
      await assert.rejects(
        db.query('UPDATE camera_worker_generation SET credential_sha256=$2 WHERE id=$1', [
          first.workerGenerationId,
          'b'.repeat(64),
        ]),
        /immutable/,
      );
      await assert.rejects(
        db.query(
          'UPDATE camera_worker_generation SET is_current=true,superseded_at=NULL WHERE id=$1',
          [first.workerGenerationId],
        ),
        /immutable/,
      );
      await assert.rejects(
        db.query('DELETE FROM camera_worker_generation WHERE id=$1', [first.workerGenerationId]),
        /cannot be removed/,
      );
      await assert.rejects(
        db.query(
          `INSERT INTO camera_worker_generation(id,camera_id,site_id,stream_session_id,credential_sha256,is_current,issued_at,expires_at,superseded_at)
        SELECT $1,$2,$3,$4,$5,false,now,now+INTERVAL '1 minute',now FROM (SELECT clock_timestamp() AS now) t`,
          [randomUUID(), cameraId, otherSite, randomUUID(), 'a'.repeat(64)],
        ),
        (error: unknown) =>
          (error as { driverError?: { constraint: string } }).driverError?.constraint ===
          'fk_camera_worker_generation_camera_site',
      );
    });
    await t.test(
      'receipt foreign keys bind session and issued bundle hash and reject history edits',
      async () => {
        const generation = (await rows()).find((row: { is_current: boolean }) => row.is_current);
        await db.query(
          `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
        VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
          [cameraId, siteId, generation.stream_session_id],
        );
        await db.query(
          `INSERT INTO camera_configuration_bundle(camera_id,configuration_version,site_id,camera_external_id,view_revision,issued_at,bundle_sha256)
        VALUES($1,1,$2,$1::uuid::text,1,clock_timestamp(),$3)`,
          [cameraId, siteId, 'c'.repeat(64)],
        );
        // Synthetic storage fixture only: this hash is not a qualified runtime bundle.
        const insert = (sessionId: string, hash: string) =>
          db.query(
            `INSERT INTO camera_configuration_application_receipt
        (command_id,camera_id,site_id,worker_generation_id,stream_session_id,configuration_version,view_revision,bundle_sha256,outcome,payload_sha256,received_at)
        VALUES($1,$2,$3,$4,$5,1,1,$6,'LOADED',$7,clock_timestamp()) RETURNING command_id,receipt_order`,
            [randomUUID(), cameraId, siteId, generation.id, sessionId, hash, 'd'.repeat(64)],
          );
        await assert.rejects(
          insert(randomUUID(), 'c'.repeat(64)),
          (error: unknown) =>
            (error as { driverError?: { constraint: string } }).driverError?.constraint ===
            'fk_camera_application_receipt_generation',
        );
        await assert.rejects(
          insert(generation.stream_session_id, 'e'.repeat(64)),
          (error: unknown) =>
            (error as { driverError?: { constraint: string } }).driverError?.constraint ===
            'fk_camera_application_receipt_bundle',
        );
        const [firstReceipt] = await insert(generation.stream_session_id, 'c'.repeat(64));
        const [secondReceipt] = await insert(generation.stream_session_id, 'c'.repeat(64));
        assert(BigInt(secondReceipt.receipt_order) > BigInt(firstReceipt.receipt_order));
        await assert.rejects(
          db.query(
            "UPDATE camera_configuration_application_receipt SET outcome='REJECTED' WHERE command_id=$1",
            [firstReceipt.command_id],
          ),
          /immutable/,
        );
        await assert.rejects(
          db.query('DELETE FROM camera_configuration_application_receipt WHERE command_id=$1', [
            firstReceipt.command_id,
          ]),
          /immutable/,
        );
        await assert.rejects(
          db.query('TRUNCATE camera_configuration_application_receipt'),
          /immutable/,
        );
      },
    );
    await t.test('revoke is repeatable, cannot reactivate and preserves history', async () => {
      const current = (await rows()).find((row: { is_current: boolean }) => row.is_current);
      await revoke!(db, cameraId, [cameraId], current.id);
      const revoked = (await rows()).find((row: { id: string }) => row.id === current.id);
      assert(revoked.revoked_at instanceof Date);
      await revoke!(db, cameraId, [cameraId], current.id);
      assert.equal(
        (await rows()).filter((row: { is_current: boolean }) => row.is_current).length,
        0,
      );
      assert.equal(
        (await rows()).find((row: { id: string }) => row.id === current.id).revoked_at.getTime(),
        revoked.revoked_at.getTime(),
      );
      await assert.rejects(
        db.transaction((manager) => workerGenerationMigration.down(manager.queryRunner!)),
        /populated worker generation history/,
      );
    });
  } finally {
    await owned.dispose();
  }
});
