import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { TrackedPpeInboxProjection } from '../../src/modules/safety/alerts/tracked-ppe-inbox-projection.js';

test('trusted generation transition fences old heads and pending frames atomically without inventing captures', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new WorkerEventAdmission1795046400002().up(m.queryRunner!));
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db, ['HARD_HAT']),
      other = await seedTrackedFrameFixture(db);
    await assert.rejects(
      provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000, undefined, {
        commandId: randomUUID(),
        expectedGenerationId: f.generation.workerGenerationId,
        reason: 'SOURCE_RESTART',
      }),
    );
    const legacy = await seedTrackedFrameFixture(db);
    await db.query(
      "UPDATE camera_worker_generation SET observation_route_mode='LEGACY' WHERE id=$1",
      [legacy.generation.workerGenerationId],
    );
    await assert.rejects(
      provisionCameraWorkerGeneration(db, legacy.cameraId, [legacy.cameraId], 60000, undefined, {
        commandId: randomUUID(),
        expectedGenerationId: legacy.generation.workerGenerationId,
        reason: 'SOURCE_RESTART',
      }),
    );
    await provisionCameraWorkerGeneration(db, legacy.cameraId, [legacy.cameraId], 60000);
    const officer = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic transition reader','synthetic-non-login-hash',true,false)",
      [officer],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [randomUUID(), officer, f.siteId],
    );
    const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [f.cameraId, other.cameraId],
      clockToleranceMs: 1000,
      routeEpoch: '00000000-0000-4000-8000-000000000001',
    });
    const store = new TrackedFramePrototypeStore(auth, {
      pendingTtlMs: 30000,
      maxPendingFrames: 16,
      maxPendingParts: 32,
      maxPendingPayloadBytes: 100000,
    });
    const inbox = new TrackedPpeInboxProjection(db, { maxRecipients: 8 });
    const admission = new TrackedFrameAdmission(
      auth,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 32,
      },
      {
        async project(manager, frame) {
          await inbox.projectFrame(manager, {
            siteId: frame.scope.siteId,
            cameraId: frame.scope.cameraId,
            scopeSha256: frame.scope.scopeSha256,
            coordinatorEventId: frame.coordinatorEventId,
          });
        },
      },
    );
    const person = (fixture: typeof f) => {
      const base = fixture.event();
      return {
        ...base,
        observations: [
          { type: 'PERSON', trackId: 1 },
          ...(fixture.ppeRegionId
            ? [
                {
                  type: 'PPE',
                  trackId: 1,
                  ppeItem: 'HARD_HAT',
                  status: 'MISSING',
                  regionId: fixture.ppeRegionId,
                  geometryVersion: 1,
                },
              ]
            : []),
        ],
        continuity: {
          ...base.continuity,
          subjects: [
            {
              personObservationIndex: 0,
              segmentId: randomUUID(),
              link: { kind: 'START', reason: 'INITIAL' },
            },
          ],
        },
      };
    };
    const first = person(f),
      unrelated = person(other);
    first.framePartition.partIndex = 1;
    first.framePartition.partCount = 2;
    const firstCoordinator = {
      ...first,
      eventId: randomUUID(),
      observations: [],
      framePartition: { ...first.framePartition, partIndex: 0 },
      continuity: { ...first.continuity, subjects: [] },
    };
    const process = (fixture: typeof f, frameId: string) =>
      admission.process(
        db,
        {
          cameraId: fixture.cameraId,
          generationId: fixture.generation.workerGenerationId,
          streamSessionId: fixture.generation.streamSessionId,
          frameId,
        },
        fixture.generation.secret,
      );
    await store.store(db, first, f.context, f.generation.secret);
    await store.store(db, firstCoordinator, f.context, f.generation.secret);
    assert.equal((await process(f, first.framePartition.frameId)).kind, 'SEALED');
    await store.store(db, unrelated, other.context, other.generation.secret);
    assert.equal((await process(other, unrelated.framePartition.frameId)).kind, 'SEALED');
    const pending = f.event(1, 2, '1'); // Missing part0 remains durable but unadmitted.
    await store.store(db, pending, f.context, f.generation.secret);
    const coordinator = f.event(0, 2, '2');
    await store.store(db, coordinator, f.context, f.generation.secret);
    await assert.rejects(provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000));
    await db.query(
      'UPDATE safety_episode_recipient SET seen_revision=1 WHERE recipient_user_id=$1',
      [officer],
    );
    const businessSnapshot = async () => ({
      episodes: await db.query(
        "SELECT to_jsonb(e)-'collection_state' AS value FROM safety_episode e ORDER BY id",
      ),
      alerts: await db.query('SELECT * FROM safety_alert ORDER BY id'),
      recipients: await db.query('SELECT * FROM safety_episode_recipient ORDER BY id'),
    });
    const businessBefore = await businessSnapshot();
    assert.equal(businessBefore.episodes.length, 1);
    assert.equal(businessBefore.alerts.length, 1);
    assert.equal(businessBefore.recipients[0].seen_revision, 1);
    const snapshot = () =>
      db.query(`SELECT event_id,raw_payload,payload_hash,admission_context,
      tracking_transport_ack,tracking_pending_until FROM ai_observation_event ORDER BY event_id`);
    const before = await snapshot();
    const headsBefore = await db.query('SELECT * FROM ai_subject_segment ORDER BY segment_id');
    const command = {
      commandId: randomUUID(),
      expectedGenerationId: f.generation.workerGenerationId,
      reason: 'CONFIGURATION_CHANGED' as const,
    };
    await assert.rejects(
      provisionCameraWorkerGeneration(
        db,
        f.cameraId,
        [f.cameraId],
        60000,
        async () => {
          throw new Error('Synthetic credential delivery failed');
        },
        command,
      ),
      /Synthetic credential delivery failed/,
    );
    assert.deepEqual(
      await db.query('SELECT * FROM ai_subject_segment ORDER BY segment_id'),
      headsBefore,
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await businessSnapshot(), businessBefore);
    assert.equal(
      (
        await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [pending.eventId],
        )
      )[0].state,
      'PART_STAGED',
    );
    const next = await provisionCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      60000,
      undefined,
      command,
    );
    assert.notEqual(next.streamSessionId, f.generation.streamSessionId);
    const [retired] = await db.query('SELECT * FROM ai_subject_segment WHERE segment_id=$1', [
      first.continuity.subjects[0]!.segmentId,
    ]);
    assert.equal(retired.state, 'RETIRED');
    assert.equal(retired.retirement_event_id, null);
    assert.equal(retired.retirement_provenance.commandId, command.commandId);
    assert.equal(retired.retirement_provenance.supersedingGenerationId, next.workerGenerationId);
    assert.equal(retired.head_event_id, first.eventId);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await businessSnapshot(), businessBefore);
    assert.equal(
      (await db.query('SELECT collection_state AS state FROM safety_episode'))[0].state,
      'SEALED',
    );
    const [classified] = await db.query(
      'SELECT tracking_frame_state AS state, tracking_frame_result AS result FROM ai_observation_event WHERE event_id=$1',
      [pending.eventId],
    );
    assert.equal(classified.state, 'PART_EXPIRED');
    assert.equal(classified.result, null);
    const [coordinatorResult] = await db.query(
      'SELECT tracking_frame_state AS state, tracking_frame_result AS result FROM ai_observation_event WHERE event_id=$1',
      [coordinator.eventId],
    );
    assert.equal(coordinatorResult.state, 'REVIEW_ONLY');
    assert.equal(coordinatorResult.result.reason, 'TRUSTED_SOURCE_TRANSITION');
    assert.equal(coordinatorResult.result.transition.commandId, command.commandId);
    assert.equal((await process(f, first.framePartition.frameId)).kind, 'SEALED');
    assert.deepEqual(
      await db.query('SELECT * FROM ai_subject_segment WHERE camera_id=$1', [other.cameraId]),
      headsBefore.filter((row: { camera_id: string }) => row.camera_id === other.cameraId),
    );
    await assert.rejects(
      provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000, undefined, command),
    );
    const late = {
      ...pending,
      eventId: randomUUID(),
      framePartition: { ...pending.framePartition, partIndex: 0 },
    };
    // Superseded credentials may retain late evidence for review, never promote it to LIVE.
    await store.store(db, late, f.context, f.generation.secret);
    const [lateResult] = await db.query(
      'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
      [late.eventId],
    );
    assert.equal(lateResult.state, 'REVIEW_ONLY');
    assert.equal((await process(f, late.framePartition.frameId)).kind, 'REVIEW_ONLY');
    const receiptCommandId = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, f.cameraId, next.secret, {
      commandId: receiptCommandId,
      workerGenerationId: next.workerGenerationId,
      streamSessionId: next.streamSessionId,
      configurationVersion: 1,
      bundleSha256: f.context.bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });
    const fresh = person(f);
    fresh.streamSessionId = next.streamSessionId;
    const nextContext = {
      ...f.context,
      workerGenerationId: next.workerGenerationId,
      streamSessionId: next.streamSessionId,
      receiptCommandId,
    };
    await store.store(db, fresh, nextContext, next.secret);
    assert.equal(
      (
        await admission.process(
          db,
          {
            cameraId: f.cameraId,
            generationId: next.workerGenerationId,
            streamSessionId: next.streamSessionId,
            frameId: fresh.framePartition.frameId,
          },
          next.secret,
        )
      ).kind,
      'SEALED',
    );
    assert.equal(
      (
        await db.query('SELECT state FROM ai_subject_segment WHERE segment_id=$1', [
          first.continuity.subjects[0]!.segmentId,
        ])
      )[0].state,
      'RETIRED',
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM ai_observation_event'))[0].count,
      7,
    );
    let deliveries = 0;
    const raced = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        provisionCameraWorkerGeneration(
          db,
          f.cameraId,
          [f.cameraId],
          60000,
          async () => {
            deliveries++;
          },
          {
            commandId: randomUUID(),
            expectedGenerationId: next.workerGenerationId,
            reason: 'LEASE_RENEWED',
          },
        ),
      ),
    );
    assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(raced.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(deliveries, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ai_subject_segment WHERE camera_id=$1 AND state='ACTIVE'",
          [f.cameraId],
        )
      )[0].count,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ai_subject_segment WHERE camera_id=$1 AND state='ACTIVE'",
          [other.cameraId],
        )
      )[0].count,
      1,
    );
    const winner = raced.find((result) => result.status === 'fulfilled');
    assert(winner?.status === 'fulfilled');
    // Claim the replacement as tracked, then exercise the explicit revoked-source recovery path.
    const replacement = winner.value,
      replacementReceipt = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, f.cameraId, replacement.secret, {
      commandId: replacementReceipt,
      workerGenerationId: replacement.workerGenerationId,
      streamSessionId: replacement.streamSessionId,
      configurationVersion: 1,
      bundleSha256: f.context.bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });
    const empty = f.event();
    empty.streamSessionId = replacement.streamSessionId;
    await store.store(
      db,
      empty,
      {
        ...f.context,
        workerGenerationId: replacement.workerGenerationId,
        streamSessionId: replacement.streamSessionId,
        receiptCommandId: replacementReceipt,
      },
      replacement.secret,
    );
    await revokeCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      replacement.workerGenerationId,
    );
    await assert.rejects(provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000));
    const recovered = await provisionCameraWorkerGeneration(
      db,
      f.cameraId,
      [f.cameraId],
      60000,
      undefined,
      {
        commandId: randomUUID(),
        expectedGenerationId: replacement.workerGenerationId,
        reason: 'SOURCE_RESTART',
      },
    );
    assert.notEqual(recovered.workerGenerationId, replacement.workerGenerationId);
    const [revoked] = await db.query(
      'SELECT revoked_at,superseded_at FROM camera_worker_generation WHERE id=$1',
      [replacement.workerGenerationId],
    );
    assert(revoked.revoked_at instanceof Date && revoked.superseded_at instanceof Date);
    await assert.rejects(
      provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000, undefined, {
        commandId: randomUUID(),
        expectedGenerationId: replacement.workerGenerationId,
        reason: 'SOURCE_RESTART',
      }),
    );
  } finally {
    await owned.dispose();
  }
});
