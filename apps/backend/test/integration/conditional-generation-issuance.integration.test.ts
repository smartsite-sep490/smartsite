import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';

const conflict = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 409;

test('conditional issuance serializes current ownership and revocation without bypassing tracked transitions', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass(format('%I.ai_subject_segment',current_schema())) AS tracked",
        )
      )[0].tracked,
      null,
    );
    const seed = async () => {
      const site = randomUUID(),
        camera = randomUUID();
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic conditional Site')",
        [site],
      );
      await db.query(
        "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic conditional camera')",
        [camera, site],
      );
      return camera;
    };
    const camera = await seed(),
      other = await seed();
    const initial = await provisionCameraWorkerGeneration(db, camera, [camera], 1000);
    const unrelated = await provisionCameraWorkerGeneration(db, other, [other], 60000);
    await delay(Math.max(0, Date.parse(initial.expiresAt) - Date.now() + 100));
    assert.equal(
      (
        await db.query(
          'SELECT expires_at<=clock_timestamp() AS expired FROM camera_worker_generation WHERE id=$1',
          [initial.workerGenerationId],
        )
      )[0].expired,
      true,
    );
    const current = await provisionCameraWorkerGeneration(
      db,
      camera,
      [camera],
      60000,
      undefined,
      undefined,
      initial.workerGenerationId,
    );
    assert.notEqual(current.streamSessionId, initial.streamSessionId);
    const snapshot = () =>
      db.query(
        'SELECT id,is_current,issued_at,expires_at,superseded_at,revoked_at FROM camera_worker_generation ORDER BY id',
      );
    const before = await snapshot();
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        camera,
        [camera],
        60000,
        async () => {
          throw new Error('Synthetic delivery failure');
        },
        undefined,
        current.workerGenerationId,
      ),
      /Synthetic delivery failure/,
    );
    assert.deepEqual(await snapshot(), before);
    for (const [target, expected] of [
      [camera, initial.workerGenerationId],
      [other, current.workerGenerationId],
    ])
      await assert.rejects(
        provisionCameraWorkerGeneration(
          db,
          target!,
          [target!],
          60000,
          undefined,
          undefined,
          expected,
        ),
        conflict,
      );
    assert.deepEqual(await snapshot(), before);
    await db.query("UPDATE camera SET status='INACTIVE' WHERE id=$1", [other]);
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        other,
        [other],
        60000,
        undefined,
        undefined,
        unrelated.workerGenerationId,
      ),
      conflict,
    );
    await revokeCameraWorkerGeneration(db, camera, [camera], current.workerGenerationId);
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        camera,
        [camera],
        60000,
        undefined,
        undefined,
        current.workerGenerationId,
      ),
      conflict,
    );
    const manual = await provisionCameraWorkerGeneration(db, camera, [camera], 60000);
    let deliveries = 0;
    const races = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        provisionCameraWorkerGeneration(
          db,
          camera,
          [camera],
          60000,
          async () => {
            deliveries++;
          },
          undefined,
          manual.workerGenerationId,
        ),
      ),
    );
    assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(races.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(deliveries, 1);

    await db.transaction((m) => new WorkerEventAdmission1795046400002().up(m.queryRunner!));
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db);
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
    await store.store(db, f.event(), f.context, f.generation.secret);
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        f.cameraId,
        [f.cameraId],
        60000,
        undefined,
        undefined,
        f.generation.workerGenerationId,
      ),
      conflict,
    );
    const transition = {
      commandId: randomUUID(),
      expectedGenerationId: f.generation.workerGenerationId,
      reason: 'SOURCE_RESTART' as const,
    };
    await revokeCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      f.generation.workerGenerationId,
    );
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        f.cameraId,
        [f.cameraId],
        60000,
        undefined,
        transition,
        f.generation.workerGenerationId,
      ),
      conflict,
    );
    // Explicit trusted manual recovery stays distinct from automatic renewal.
    const recovered = await provisionCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      60000,
      undefined,
      transition,
    );
    const retried = await provisionCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      60000,
      undefined,
      undefined,
      recovered.workerGenerationId,
    );
    const receiptCommandId = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, f.cameraId, retried.secret, {
      commandId: receiptCommandId,
      workerGenerationId: retried.workerGenerationId,
      streamSessionId: retried.streamSessionId,
      configurationVersion: 1,
      bundleSha256: f.context.bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });
    const event = f.event();
    event.streamSessionId = retried.streamSessionId;
    await store.store(
      db,
      event,
      {
        ...f.context,
        receiptCommandId,
        workerGenerationId: retried.workerGenerationId,
        streamSessionId: retried.streamSessionId,
      },
      retried.secret,
    );
    const active = await provisionCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      60000,
      undefined,
      { ...transition, commandId: randomUUID(), expectedGenerationId: retried.workerGenerationId },
      retried.workerGenerationId,
    );

    // Observe actual Camera lock contention, then commit revocation before the waiter can check ownership.
    const locker = db.createQueryRunner();
    let pending: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    try {
      await locker.connect();
      await locker.startTransaction();
      await locker.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [f.cameraId]);
      pending = provisionCameraWorkerGeneration(
        db,
        f.cameraId,
        [f.cameraId],
        60000,
        undefined,
        undefined,
        active.workerGenerationId,
      ).then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        waiting =
          (
            await db.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
              ['%' + db.driver.schema + '%camera%'],
            )
          )[0].n > 0;
        if (!waiting) await delay(10);
      }
      assert(waiting, 'Expected issuer to wait on the owned Camera transaction lock');
      await locker.query(
        'UPDATE camera_worker_generation SET is_current=false,revoked_at=clock_timestamp() WHERE id=$1',
        [active.workerGenerationId],
      );
      await locker.commitTransaction();
      const result = await pending;
      assert(!result.ok);
      assert(conflict(result.error));
    } finally {
      if (locker.isTransactionActive) await locker.rollbackTransaction();
      await locker.release();
      await pending;
    }
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
          [f.cameraId],
        )
      )[0].n,
      0,
    );
  } finally {
    await owned.dispose();
  }
});
