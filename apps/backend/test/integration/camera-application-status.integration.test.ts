import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { readCameraApplicationStatus } from '../../src/modules/cameras/camera-application-status.js';

type ReadStatus = (
  source: DataSource,
  siteId: string,
  cameraId: string,
  maxAgeMs: number,
) => Promise<{
  applicationState: string;
  desiredRevision: number;
  reportedRevision: number | null;
  viewValidity: string;
  lastReceiptAt: string | null;
  reasonCode: string | null;
}>;

test('application status separates desired config, worker receipts, lease and captured view', async (t) => {
  const read: ReadStatus = readCameraApplicationStatus;
  assert.equal(typeof read, 'function', 'Application status reader exists');
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      cameraId = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Status site')", [
      siteId,
    ]);
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Status camera')",
      [cameraId, siteId],
    );
    await t.test('no enrolled worker or receipt is unconfirmed and scope is exact', async () => {
      const result = await read!(db, siteId, cameraId, 1000);
      assert.equal(result.applicationState, 'UNCONFIRMED');
      assert.equal(result.reportedRevision, null);
      await assert.rejects(
        read!(db, randomUUID(), cameraId, 1000),
        (error: unknown) => (error as { getStatus: () => number }).getStatus() === 404,
      );
    });
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
    const ack = {
      commandId: randomUUID(),
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256: hash,
      viewRevision: 1,
      outcome: 'LOADED',
    };
    await t.test(
      'GET issuance alone never means loaded; matching ACK is separate from physical pose',
      async () => {
        assert.equal((await read!(db, siteId, cameraId, 1000)).applicationState, 'UNCONFIRMED');
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, ack);
        const loaded = await read!(db, siteId, cameraId, 1000);
        assert.equal(loaded.applicationState, 'LOADED');
        assert.equal(loaded.viewValidity, 'UNCONFIRMED');
        assert(!JSON.stringify(loaded).includes(generation.secret));
        assert(!('credentialSha256' in loaded));
      },
    );
    await t.test(
      'database clock rollback hides future receipt metadata and returns stale',
      async () => {
        const clockRollback = new Proxy(db, {
          get(target, key) {
            if (key === 'transaction')
              return (_isolation: unknown, work: (manager: unknown) => Promise<unknown>) =>
                target.transaction('REPEATABLE READ', (manager) =>
                  work(
                    new Proxy(manager, {
                      get(actual, property) {
                        if (property === 'query')
                          return (sql: string, ...args: unknown[]) =>
                            sql === 'SELECT clock_timestamp() AS now'
                              ? Promise.resolve([{ now: new Date('2000-01-01T00:00:00.000Z') }])
                              : actual.query(sql, ...(args as [unknown[]]));
                        const value = Reflect.get(actual, property);
                        return typeof value === 'function' ? value.bind(actual) : value;
                      },
                    }),
                  ),
                );
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const result = await read(clockRollback, siteId, cameraId, 60000);
        assert.equal(result.applicationState, 'STALE');
        assert.equal(result.reportedRevision, null);
        assert.equal(result.lastReceiptAt, null);
      },
    );
    await t.test('old receipt expires and idempotent replay does not renew freshness', async () => {
      await db.query('SELECT pg_sleep(1.1)');
      await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, ack);
      assert.equal((await read!(db, siteId, cameraId, 1000)).applicationState, 'STALE');
    });
    await t.test(
      'latest same-version rejection wins, then newer desired version stays pending',
      async () => {
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, {
          ...ack,
          commandId: randomUUID(),
          outcome: 'REJECTED',
          reasonCode: 'UNSUPPORTED_PPE',
        });
        const rejected = await read!(db, siteId, cameraId, 60000);
        assert.equal(rejected.applicationState, 'REJECTED');
        assert.equal(rejected.reasonCode, 'UNSUPPORTED_PPE');
        await issue(2);
        const pending = await read!(db, siteId, cameraId, 60000);
        assert.equal(pending.applicationState, 'PENDING');
        assert.equal(pending.desiredRevision, 2);
        assert.equal(pending.reportedRevision, 1);
      },
    );
    await t.test(
      'replacement generation cannot inherit a previous generation receipt',
      async () => {
        await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 60000);
        const result = await read(db, siteId, cameraId, 60000);
        assert.equal(result.applicationState, 'UNCONFIRMED');
        assert.equal(result.reportedRevision, null);
        assert.equal(result.lastReceiptAt, null);
      },
    );
    await t.test('retired view prevents readiness even if an old receipt was loaded', async () => {
      await db.query(
        'UPDATE camera_view_revision SET is_current=false,retired_at=clock_timestamp() WHERE camera_id=$1',
        [cameraId],
      );
      assert.equal((await read!(db, siteId, cameraId, 60000)).applicationState, 'STALE');
    });
  } finally {
    await owned.dispose();
  }
});
