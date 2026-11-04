import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import type { CameraConfigurationAcknowledgement } from '@smartsite/contracts';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';

type Ack = (
  source: DataSource,
  cameraId: string,
  secret: string,
  input: unknown,
) => Promise<{
  replayed: boolean;
  commandId: string;
  configurationVersion: number;
  outcome: string;
  receivedAt: string;
}>;
const status = (expected: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === expected;

test('configuration ACK requires a live server-issued generation and exact immutable bundle', async (t) => {
  const ack: Ack = recordCameraConfigurationAcknowledgement;
  assert.equal(typeof ack, 'function', 'ACK recorder is implemented');
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      cameraId = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'ACK test site')", [
      siteId,
    ]);
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'ACK test camera')",
      [cameraId, siteId],
    );
    const generation = await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 60000);
    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
      VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
      [cameraId, siteId, generation.streamSessionId],
    );
    const issue = async (version: number) => {
      await db.transaction(async (manager) => {
        await manager
          .getRepository(CameraEntity)
          .update({ id: cameraId }, { configurationVersion: version });
        const camera = await manager.getRepository(CameraEntity).findOneByOrFail({ id: cameraId });
        await recordCameraConfigurationBundle(
          manager,
          camera,
          {
            schemaVersion: '1.0.0',
            configurationVersion: version,
            cameraExternalId: camera.externalId,
            regions: [],
          },
          new ZoneConfigurationService(db, new SiteConfigurationService(db)),
        );
      });
      return (
        await db.query(
          'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=$2',
          [cameraId, version],
        )
      )[0].bundle_sha256 as string;
    };
    const hash = await issue(1);
    const body: CameraConfigurationAcknowledgement = {
      commandId: randomUUID(),
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256: hash,
      viewRevision: 1,
      outcome: 'LOADED',
    };
    const count = async () =>
      Number(
        (
          await db.query('SELECT count(*) AS count FROM camera_configuration_application_receipt')
        )[0].count,
      );
    await t.test('credential, session and canonical body reject before writing', async () => {
      await assert.rejects(ack!(db, cameraId, '', body), status(401));
      await assert.rejects(ack!(db, cameraId, 'x'.repeat(43), body), status(401));
      await assert.rejects(
        ack!(db, cameraId, generation.secret, { ...body, streamSessionId: randomUUID() }),
        status(409),
      );
      await assert.rejects(
        ack!(db, cameraId, generation.secret, { ...body, workerGenerationId: randomUUID() }),
        status(401),
      );
      await assert.rejects(
        ack!(db, cameraId, generation.secret, { ...body, appliedAt: new Date().toISOString() }),
        status(400),
      );
      assert.equal(await count(), 0);
    });
    await t.test('concurrent same-command requests insert one immutable receipt', async () => {
      const receipts = await Promise.all(
        Array.from({ length: 5 }, () => ack!(db, cameraId, generation.secret, body)),
      );
      assert.equal(receipts.filter((row) => !row.replayed).length, 1);
      assert.equal(new Set(receipts.map((row) => row.receivedAt)).size, 1);
      assert.equal(await count(), 1);
      assert(!JSON.stringify(receipts).includes(generation.secret));
      await assert.rejects(
        ack!(db, cameraId, generation.secret, { ...body, outcome: 'REJECTED' }),
        status(409),
      );
    });
    await t.test('unissued versions, mismatched hash and view cannot be acknowledged', async () => {
      for (const delta of [
        { configurationVersion: 2 },
        { bundleSha256: 'f'.repeat(64) },
        { viewRevision: 2 },
      ])
        await assert.rejects(
          ack!(db, cameraId, generation.secret, { ...body, commandId: randomUUID(), ...delta }),
          status(409),
        );
      assert.equal(await count(), 1);
    });
    const newerHash = await issue(2);
    await t.test(
      'old reported version is only a receipt, and cannot regress a newer receipt',
      async () => {
        const oldReceipt = await ack!(db, cameraId, generation.secret, {
          ...body,
          commandId: randomUUID(),
        });
        assert.equal(oldReceipt.configurationVersion, 1);
        assert(!('applicationState' in oldReceipt));
        await ack!(db, cameraId, generation.secret, {
          ...body,
          commandId: randomUUID(),
          configurationVersion: 2,
          bundleSha256: newerHash,
        });
        await assert.rejects(
          ack!(db, cameraId, generation.secret, { ...body, commandId: randomUUID() }),
          status(409),
        );
        assert.equal(await count(), 3);
      },
    );
    await t.test('replay still authenticates after revocation', async () => {
      await revokeCameraWorkerGeneration(db, cameraId, [cameraId], generation.workerGenerationId);
      await assert.rejects(ack!(db, cameraId, generation.secret, body), status(409));
      assert.equal(await count(), 3);
    });
    await t.test(
      'lease expiry after a camera lock wait rejects even an earlier-started transaction',
      async () => {
        const expiring = await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 1000);
        const holder = db.createQueryRunner();
        await holder.connect();
        await holder.startTransaction();
        try {
          await holder.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [cameraId]);
          const pending = ack!(db, cameraId, expiring.secret, {
            ...body,
            commandId: randomUUID(),
            workerGenerationId: expiring.workerGenerationId,
            streamSessionId: expiring.streamSessionId,
            configurationVersion: 2,
            bundleSha256: newerHash,
          });
          await holder.query('SELECT pg_sleep(1.15)');
          await holder.commitTransaction();
          await assert.rejects(pending, status(409));
          assert.equal(await count(), 3);
        } finally {
          if (holder.isTransactionActive) await holder.rollbackTransaction();
          await holder.release();
        }
      },
    );
    await t.test(
      'a server clock earlier than issuance cannot authenticate a generation',
      async () => {
        const current = (
          await db.query(
            'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
            [cameraId],
          )
        )[0];
        await revokeCameraWorkerGeneration(db, cameraId, [cameraId], current.id);
        const futureId = randomUUID(),
          futureSession = randomUUID(),
          futureSecret = 'z'.repeat(43);
        await db.query(
          `INSERT INTO camera_worker_generation(id,camera_id,site_id,stream_session_id,credential_sha256,is_current,issued_at,expires_at)
        SELECT $1,$2,$3,$4,$5,true,now+INTERVAL '1 minute',now+INTERVAL '2 minutes' FROM(SELECT clock_timestamp() AS now)t`,
          [
            futureId,
            cameraId,
            siteId,
            futureSession,
            createHash('sha256').update(futureSecret).digest('hex'),
          ],
        );
        await assert.rejects(
          ack!(db, cameraId, futureSecret, {
            ...body,
            commandId: randomUUID(),
            workerGenerationId: futureId,
            streamSessionId: futureSession,
            configurationVersion: 2,
            bundleSha256: newerHash,
          }),
          status(409),
        );
        assert.equal(await count(), 3);
      },
    );
    await t.test('an exact old bundle is refused when its captured view is retired', async () => {
      // Separate camera keeps the future-dated fixture's immutable history intact.
      const otherCamera = randomUUID();
      await db.query(
        "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Retired view camera')",
        [otherCamera, siteId],
      );
      const current = await provisionCameraWorkerGeneration(db, otherCamera, [otherCamera], 60000);
      await db.query(
        `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
        VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
        [otherCamera, siteId, current.streamSessionId],
      );
      await db.transaction(async (manager) => {
        const camera = await manager
          .getRepository(CameraEntity)
          .findOneByOrFail({ id: otherCamera });
        await recordCameraConfigurationBundle(
          manager,
          camera,
          {
            schemaVersion: '1.0.0',
            configurationVersion: 1,
            cameraExternalId: camera.externalId,
            regions: [],
          },
          new ZoneConfigurationService(db, new SiteConfigurationService(db)),
        );
      });
      const [bundle] = await db.query(
        'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1',
        [otherCamera],
      );
      await db.query(
        'UPDATE camera_view_revision SET is_current=false,retired_at=clock_timestamp() WHERE camera_id=$1',
        [otherCamera],
      );
      await assert.rejects(
        ack!(db, otherCamera, current.secret, {
          ...body,
          commandId: randomUUID(),
          workerGenerationId: current.workerGenerationId,
          streamSessionId: current.streamSessionId,
          bundleSha256: bundle.bundle_sha256,
        }),
        status(409),
      );
      assert.equal(await count(), 3);
    });
  } finally {
    await owned.dispose();
  }
});
