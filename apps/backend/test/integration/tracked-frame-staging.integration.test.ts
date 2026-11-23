import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  computeCanonicalPayloadHash,
  computeWorkerEventBindingHash,
  type WorkerEventDeliveryContext,
} from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { expireTrackedPending } from '../../src/integrations/ai/tracked-pending-expiry.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { revokeCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
const status = (expected: number) => (e: unknown) =>
  e instanceof PublicHttpException && e.getStatus() === expected;

test('prototype raw multipart staging remains separate from admitted frame/episode delivery', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new WorkerEventAdmission1795046400002().up(m.queryRunner!));
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const store = (cameraId: string, limits = {}) =>
      new TrackedFramePrototypeStore(
        new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
          profileSha256: 'a'.repeat(64),
          allowedCameraIds: [cameraId],
          clockToleranceMs: 1000,
          routeEpoch: '00000000-0000-4000-8000-000000000001',
        }),
        {
          pendingTtlMs: 30000,
          maxPendingFrames: 8,
          maxPendingParts: 16,
          maxPendingPayloadBytes: 100000,
          ...limits,
        },
      );
    await t.test(
      'reverse parts/new receipt and ten concurrent exact retries retain original deadline/ACK without projection',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          intake = store(f.cameraId),
          a = f.event(1, 2);
        a.eventId = a.eventId.toUpperCase();
        a.streamSessionId = a.streamSessionId.toUpperCase();
        const first = await intake.store(db, a, f.context, f.generation.secret);
        const [before] = await db.query(
          'SELECT tracking_pending_until,raw_payload,admission_context FROM ai_observation_event WHERE event_id=$1',
          [a.eventId],
        );
        for (const sql of [
          'UPDATE ai_observation_event SET admission_context=NULL WHERE event_id=$1',
          'UPDATE ai_observation_event SET admission_context=\'{"tampered":true}\'::jsonb WHERE event_id=$1',
        ])
          await assert.rejects(db.query(sql, [a.eventId]), { code: '23514' });
        const context = await f.refreshReceipt();
        const b = {
          ...a,
          eventId: randomUUID(),
          framePartition: { ...a.framePartition, partIndex: 0 },
        };
        const second = await intake.store(db, b, context, f.generation.secret);
        assert.equal(first.receipt.kind, 'RAW_STORED');
        assert.equal(second.duplicate, false);
        const retries = await Promise.all(
          Array.from({ length: 10 }, () => intake.store(db, a, f.context, f.generation.secret)),
        );
        assert.ok(retries.every((r) => r.duplicate));
        for (const retry of retries) assert.deepEqual(retry.receipt, first.receipt);
        assert.deepEqual(
          (
            await db.query(
              'SELECT tracking_pending_until,raw_payload,admission_context FROM ai_observation_event WHERE event_id=$1',
              [a.eventId],
            )
          )[0],
          before,
        );
        assert.equal(
          (
            await db.query(
              'SELECT tracking_pending_until FROM ai_observation_event WHERE event_id=$1',
              [b.eventId],
            )
          )[0].tracking_pending_until.getTime(),
          before.tracking_pending_until.getTime(),
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM ai_observation_event WHERE resolved_camera_id=$1',
              [f.cameraId],
            )
          )[0].n,
          2,
        );
        assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n, 0);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
      },
    );
    await t.test(
      'disjoint nonzero frame collision and new binding for an existing event are rejected without poisoning stored rows',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          intake = store(f.cameraId),
          a = f.event(1, 3);
        await intake.store(db, a, f.context, f.generation.secret);
        const forgedFrame = {
          ...a,
          eventId: randomUUID(),
          framePartition: { ...a.framePartition, frameId: randomUUID(), partIndex: 2 },
        };
        await assert.rejects(
          intake.store(db, forgedFrame, f.context, f.generation.secret),
          status(409),
        );
        await assert.rejects(
          intake.store(db, a, await f.refreshReceipt(), f.generation.secret),
          status(409),
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM ai_observation_event WHERE resolved_camera_id=$1',
              [f.cameraId],
            )
          )[0].n,
          1,
        );
      },
    );
    await t.test(
      'pending frame/part/payload caps reject new rows while exact retries remain idempotent',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          intake = store(f.cameraId, { maxPendingFrames: 1, maxPendingParts: 4 });
        const a = f.event(0, 2);
        await intake.store(db, a, f.context, f.generation.secret);
        await assert.rejects(
          intake.store(db, f.event(0, 1, '1'), f.context, f.generation.secret),
          status(503),
        );
        assert.equal((await intake.store(db, a, f.context, f.generation.secret)).duplicate, true);
        const secondPart = {
          ...a,
          eventId: randomUUID(),
          framePartition: { ...a.framePartition, partIndex: 1 },
        };
        await assert.rejects(
          store(f.cameraId, { maxPendingFrames: 8, maxPendingParts: 1 }).store(
            db,
            secondPart,
            f.context,
            f.generation.secret,
          ),
          status(503),
        );
        const g = await seedTrackedFrameFixture(db);
        await assert.rejects(
          store(g.cameraId, { maxPendingPayloadBytes: 1 }).store(
            db,
            g.event(),
            g.context,
            g.generation.secret,
          ),
          status(503),
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM ai_observation_event WHERE resolved_camera_id=$1',
              [g.cameraId],
            )
          )[0].n,
          0,
        );
      },
    );
    await t.test(
      'late part zero after persisted orphan deadline cannot reopen pending or fabricate a seal',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          intake = store(f.cameraId, { pendingTtlMs: 10 }),
          a = f.event(1, 2);
        const first = await intake.store(db, a, f.context, f.generation.secret);
        await db.query('SELECT pg_sleep(0.03)'); // Test-only wait, not an operational timeout recommendation.
        const b = {
          ...a,
          eventId: randomUUID(),
          framePartition: { ...a.framePartition, partIndex: 0 },
        };
        await store(f.cameraId).store(db, b, f.context, f.generation.secret); // Fresh service instance uses persisted deadline.
        const rows = await db.query(
          'SELECT tracking_part_index,tracking_frame_state,tracking_frame_result FROM ai_observation_event WHERE resolved_camera_id=$1 ORDER BY tracking_part_index',
          [f.cameraId],
        );
        assert.equal(rows[0].tracking_frame_state, 'REVIEW_ONLY');
        assert.equal(rows[0].tracking_frame_result.reason, 'PARTS_EXPIRED');
        assert.equal(rows[1].tracking_frame_state, 'PART_EXPIRED');
        assert.deepEqual(
          (await intake.store(db, a, f.context, f.generation.secret)).receipt,
          first.receipt,
        );
      },
    );
    await t.test(
      'bounded concurrent deadline recovery expires orphan/predecessor work without a retry or a fabricated coordinator',
      async () => {
        const orphan = await seedTrackedFrameFixture(db),
          predecessor = await seedTrackedFrameFixture(db),
          sealed = await seedTrackedFrameFixture(db);
        const a = orphan.event(1, 2),
          b = predecessor.event(),
          c = sealed.event(0, 1, '18446744073709551614');
        await store(orphan.cameraId, { pendingTtlMs: 10 }).store(
          db,
          a,
          orphan.context,
          orphan.generation.secret,
        );
        await store(predecessor.cameraId, { pendingTtlMs: 10 }).store(
          db,
          b,
          predecessor.context,
          predecessor.generation.secret,
        );
        await db.query(
          "UPDATE ai_observation_event SET tracking_frame_state='PENDING_PREDECESSOR' WHERE event_id=$1",
          [b.eventId],
        );
        await store(sealed.cameraId, { pendingTtlMs: 10 }).store(
          db,
          c,
          sealed.context,
          sealed.generation.secret,
        );
        // Synthetic terminal SQL fixture tests recovery exclusion, not frame/subject admission.
        await db.query(
          "UPDATE ai_observation_event SET tracking_frame_state='SEALED',tracking_frame_result='{\"fixture\":true}' WHERE event_id=$1",
          [c.eventId],
        );
        await db.query('SELECT pg_sleep(0.03)');
        const cameras = [orphan.cameraId, predecessor.cameraId, sealed.cameraId];
        const results = await Promise.all([
          expireTrackedPending(db, cameras, 8),
          expireTrackedPending(db, cameras, 8),
        ]);
        assert.equal(
          results.reduce((n, r) => n + r.expiredFrames, 0),
          2,
        );
        assert.equal(
          results.reduce((n, r) => n + r.expiredParts, 0),
          1,
        );
        assert.equal(
          (
            await db.query(
              'SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1',
              [a.eventId],
            )
          )[0].tracking_frame_state,
          'PART_EXPIRED',
        );
        const [coordinator] = await db.query(
          'SELECT tracking_frame_state,tracking_frame_result FROM ai_observation_event WHERE event_id=$1',
          [b.eventId],
        );
        assert.equal(coordinator.tracking_frame_state, 'REVIEW_ONLY');
        assert.equal(coordinator.tracking_frame_result.reason, 'PREDECESSOR_EXPIRED');
        assert.equal(
          (
            await db.query(
              'SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1',
              [c.eventId],
            )
          )[0].tracking_frame_state,
          'SEALED',
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM ai_observation_event WHERE resolved_camera_id=$1 AND tracking_part_index=0',
              [orphan.cameraId],
            )
          )[0].n,
          0,
        );
        assert.equal((await expireTrackedPending(db, cameras, 8)).expiredFrames, 0);
        const later = sealed.event(0, 1, '18446744073709551615');
        await store(sealed.cameraId).store(db, later, sealed.context, sealed.generation.secret);
        assert.equal(
          (
            await db.query(
              'SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1',
              [later.eventId],
            )
          )[0].tracking_frame_state,
          'PENDING_PARTS',
        );
        const late = sealed.event(0, 1, '18446744073709551613');
        await store(sealed.cameraId).store(db, late, sealed.context, sealed.generation.secret);
        assert.equal(
          (
            await db.query(
              'SELECT tracking_frame_result FROM ai_observation_event WHERE event_id=$1',
              [late.eventId],
            )
          )[0].tracking_frame_result.reason,
          'LATE_SOURCE_SEQUENCE',
        );
      },
    );
    await t.test(
      'recheckStored preserves originally LIVE part when original receipt ages past 60s but newer same-binding LOADED ACK is fresh',
      async () => {
        const f = await seedTrackedFrameFixture(db);
        const routeEpoch = '00000000-0000-4000-8000-000000000001';
        const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
          profileSha256: 'a'.repeat(64),
          allowedCameraIds: [f.cameraId],
          clockToleranceMs: 1000,
          routeEpoch,
        });
        const oldReceiptId = randomUUID();
        await db.query(
          `INSERT INTO camera_configuration_application_receipt
            (command_id,camera_id,site_id,worker_generation_id,stream_session_id,
             configuration_version,view_revision,bundle_sha256,outcome,payload_sha256,received_at)
           VALUES($1,$2,$3,$4,$5,1,1,$6,'LOADED',$7,clock_timestamp() - INTERVAL '65 seconds')`,
          [
            oldReceiptId,
            f.cameraId,
            f.siteId,
            f.generation.workerGenerationId,
            f.generation.streamSessionId,
            f.context.bundleSha256,
            'd'.repeat(64),
          ],
        );
        await f.refreshReceipt();
        const oldContext: WorkerEventDeliveryContext = {
          ...f.context,
          schemaVersion: '1.0.0',
          sourceKind: 'LIVE',
          receiptCommandId: oldReceiptId,
        };
        const liveEvent = f.event(0, 1, '0');
        const payloadHash = computeCanonicalPayloadHash(liveEvent);
        const bindingHash = computeWorkerEventBindingHash(payloadHash, oldContext);
        const reference = await db.transaction((m) =>
          auth.authenticate(m, liveEvent, f.context, f.generation.secret),
        );
        await db.query(
          `INSERT INTO ai_observation_event
            (event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,
             processing_status,processing_note,admission_context,tracking_scope_sha256,tracking_generation_id,
             tracking_site_id,tracking_frame_id,tracking_source_sequence,tracking_part_index,tracking_part_count,
             tracking_frame_state,tracking_pending_until,tracking_transport_ack,tracking_frame_result,
             safety_route_mode,safety_route_epoch)
           VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED','TRACKED_RAW_STORED_NO_PROJECTION',$8,$9,$10,$11,$12,0,0,1,
             'PENDING_PREDECESSOR',clock_timestamp() + INTERVAL '30 seconds',$13,NULL,'EPISODE_TRACKED',$14)`,
          [
            liveEvent.eventId,
            payloadHash,
            liveEvent.cameraExternalId,
            f.cameraId,
            f.generation.streamSessionId,
            new Date(liveEvent.capturedAt),
            JSON.stringify(liveEvent),
            JSON.stringify({
              schemaVersion: '1.0.0',
              context: oldContext,
              bindingHash,
              classification: 'LIVE',
              admittedAt: new Date(Date.now() - 20_000).toISOString(),
            }),
            reference.scopeSha256,
            f.generation.workerGenerationId,
            f.siteId,
            liveEvent.framePartition.frameId,
            JSON.stringify({
              kind: 'RAW_STORED',
              eventId: liveEvent.eventId,
              payloadHash,
              bindingHash,
            }),
            routeEpoch,
          ],
        );

        const recheckedLive = await db.transaction((m) =>
          auth.recheckStored(m, liveEvent, oldContext, liveEvent.eventId),
        );
        assert.equal(recheckedLive.classification, 'LIVE');

        // Ordinary ingress with aged receipt remains REVIEW_ONLY even with newer ACK.
        const ordinaryIngress = await db.transaction((m) =>
          auth.authenticate(
            m,
            { ...liveEvent, eventId: randomUUID() },
            oldContext,
            f.generation.secret,
          ),
        );
        assert.equal(ordinaryIngress.classification, 'REVIEW_ONLY');

        // Originally REVIEW_ONLY stored row cannot be promoted to LIVE by newer ACK.
        const reviewEvent = f.event(0, 1, '1');
        await store(f.cameraId).store(db, reviewEvent, oldContext, f.generation.secret);
        const recheckedReview = await db.transaction((m) =>
          auth.recheckStored(m, reviewEvent, oldContext, reviewEvent.eventId),
        );
        assert.equal(recheckedReview.classification, 'REVIEW_ONLY');

        // Revoked generation fails closed with 401.
        await revokeCameraWorkerGeneration(
          db,
          f.cameraId,
          [f.cameraId],
          f.generation.workerGenerationId,
        );
        await assert.rejects(
          db.transaction((m) => auth.recheckStored(m, liveEvent, oldContext, liveEvent.eventId)),
          status(401),
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
