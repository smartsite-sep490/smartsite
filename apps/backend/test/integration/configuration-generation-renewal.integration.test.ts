import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { renewCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { DataSource } from 'typeorm';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';

test('configuration renewal binds accepted bundle and owner under the Camera lock', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const fixture = async () => {
      const f = await seedTrackedFrameFixture(db);
      const condition = {
        configurationVersion: f.context.configurationVersion,
        viewRevision: f.context.viewRevision,
        bundleSha256: f.context.bundleSha256,
        streamSessionId: f.generation.streamSessionId,
      };
      const rows = () =>
        db.query(
          'SELECT id,is_current,superseded_at FROM camera_worker_generation WHERE camera_id=$1 ORDER BY id',
          [f.cameraId],
        );
      const renew = (expected: unknown, deliver?: () => Promise<void>) =>
        Reflect.apply(renewCameraWorkerGeneration, undefined, [
          db,
          f.cameraId,
          [f.cameraId],
          60000,
          deliver,
          f.generation.workerGenerationId,
          randomUUID(),
          expected,
        ]);
      return { ...f, condition, rows, renew };
    };
    await t.test(
      'stale version, hash, view and foreign session cannot issue or deliver',
      async () => {
        for (const changed of [
          { configurationVersion: 2 },
          { bundleSha256: 'b'.repeat(64) },
          { viewRevision: 2 },
          { streamSessionId: randomUUID() },
        ]) {
          const f = await fixture(),
            before = await f.rows();
          let deliveries = 0;
          await assert.rejects(
            f.renew({ ...f.condition, ...changed }, async () => {
              deliveries++;
            }),
            (e) => e instanceof PublicHttpException && e.getStatus() === 409,
          );
          assert.equal(deliveries, 0);
          assert.deepEqual(await f.rows(), before);
        }
      },
    );
    await t.test(
      'accepted exact bundle renews owner without retiring view or changing configuration',
      async () => {
        const f = await fixture();
        const before = await db.query(
          'SELECT c.configuration_version,v.revision,v.is_current FROM camera c JOIN camera_view_revision v ON v.camera_id=c.id WHERE c.id=$1',
          [f.cameraId],
        );
        const next = await f.renew(f.condition);
        assert.notEqual(next.workerGenerationId, f.generation.workerGenerationId);
        assert.notEqual(next.streamSessionId, f.generation.streamSessionId);
        assert.deepEqual(
          await db.query(
            'SELECT c.configuration_version,v.revision,v.is_current FROM camera c JOIN camera_view_revision v ON v.camera_id=c.id WHERE c.id=$1',
            [f.cameraId],
          ),
          before,
        );
      },
    );
    await t.test('save holding the Camera lock wins over a queued stale renewal', async () => {
      const f = await fixture(),
        before = await f.rows(),
        writer = db.createQueryRunner();
      await writer.connect();
      await writer.startTransaction();
      const options = db.options;
      if (options.type !== 'postgres') throw Error('PostgreSQL fixture required');
      const applicationName = 'configuration-renewal-' + randomUUID();
      const queued = new DataSource({
        ...options,
        extra: { ...options.extra, application_name: applicationName },
      });
      await queued.initialize();
      try {
        await writer.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [f.cameraId]);
        const renewal = Reflect.apply(renewCameraWorkerGeneration, undefined, [
          queued,
          f.cameraId,
          [f.cameraId],
          60000,
          undefined,
          f.generation.workerGenerationId,
          randomUUID(),
          f.condition,
        ]);
        const rejected = assert.rejects(
          renewal,
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        void rejected.catch(() => {});
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          waiting = (
            await db.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
              [applicationName],
            )
          )[0].waiting;
          if (waiting) break;
          await delay(10);
        }
        assert.equal(waiting, true, 'Renewal must actually wait behind the configuration writer');
        await writer.commitTransaction();
        await rejected;
        assert.deepEqual(await f.rows(), before);
      } finally {
        if (writer.isTransactionActive) await writer.rollbackTransaction();
        await writer.release();
        await queued.destroy();
      }
    });
    await t.test('delivery failure rolls back the validated renewal', async () => {
      const f = await fixture(),
        before = await f.rows();
      await assert.rejects(
        f.renew(f.condition, async () => {
          throw Error('Synthetic delivery failed');
        }),
        /Synthetic delivery failed/,
      );
      assert.deepEqual(await f.rows(), before);
    });
    await t.test('input is frozen before awaiting issuance', async () => {
      const f = await fixture(),
        expected = { ...f.condition };
      const renewing = f.renew(expected);
      expected.bundleSha256 = 'b'.repeat(64);
      assert.ok((await renewing).workerGenerationId);
    });
    await t.test(
      'tracked configuration transition retains raw evidence, confirmed geometry and view',
      async () => {
        await db.transaction((m) => new WorkerEventAdmission1795046400002().up(m.queryRunner!));
        await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
        const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
        const event = f.event(0, 2);
        const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
          profileSha256: 'a'.repeat(64),
          allowedCameraIds: [f.cameraId],
          clockToleranceMs: 1000,
          routeEpoch: '00000000-0000-4000-8000-000000000001',
        });
        const store = new TrackedFramePrototypeStore(auth, {
          pendingTtlMs: 30000,
          maxPendingFrames: 8,
          maxPendingParts: 16,
          maxPendingPayloadBytes: 100000,
        });
        await store.store(db, event, f.context, f.generation.secret);
        const geometry = () =>
          db.query(
            'SELECT to_jsonb(r) AS region,to_jsonb(g) AS geometry FROM camera_observation_region r JOIN camera_region_geometry_revision g ON g.region_id=r.id WHERE r.camera_id=$1 ORDER BY r.id,g.geometry_version',
            [f.cameraId],
          );
        const before = await geometry();
        assert.equal(before.length, 2);
        await renewCameraWorkerGeneration(
          db,
          f.cameraId,
          [f.cameraId],
          60000,
          undefined,
          f.generation.workerGenerationId,
          randomUUID(),
          {
            configurationVersion: 1,
            viewRevision: 1,
            bundleSha256: f.context.bundleSha256,
            streamSessionId: f.generation.streamSessionId,
          },
        );
        const [stored] = await db.query(
          'SELECT raw_payload,tracking_frame_state,tracking_frame_result FROM ai_observation_event WHERE event_id=$1',
          [event.eventId],
        );
        assert.deepEqual(stored.raw_payload, event);
        assert.equal(stored.tracking_frame_state, 'REVIEW_ONLY');
        assert.equal(stored.tracking_frame_result.transition.reason, 'CONFIGURATION_CHANGED');
        assert.deepEqual(await geometry(), before);
        assert.deepEqual(
          await db.query(
            'SELECT revision,is_current FROM camera_view_revision WHERE camera_id=$1',
            [f.cameraId],
          ),
          [{ revision: '1', is_current: true }],
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
