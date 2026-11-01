import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';

test('trusted scope transition retains history and serializes with head admission', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db);
    const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [f.cameraId],
      clockToleranceMs: 1000,
    });
    const store = new TrackedFramePrototypeStore(auth, {
      pendingTtlMs: 30000,
      maxPendingFrames: 16,
      maxPendingParts: 32,
      maxPendingPayloadBytes: 100000,
    });
    const admission = new TrackedFrameAdmission(
      auth,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 64,
      },
      {
        async project() {
          await Promise.resolve();
        },
      },
    ); // Explicit synthetic healthy projector.
    const segmentId = randomUUID(),
      base = f.event(1, 2);
    const first = {
      ...base,
      observations: [{ type: 'PERSON', trackId: 1 }],
      continuity: {
        ...base.continuity,
        subjects: [
          { personObservationIndex: 0, segmentId, link: { kind: 'START', reason: 'INITIAL' } },
        ],
      },
    };
    const coordinator = {
      ...first,
      eventId: randomUUID(),
      observations: [],
      framePartition: { ...first.framePartition, partIndex: 0 },
      continuity: { ...first.continuity, subjects: [] },
    };
    await store.store(db, first, f.context, f.generation.secret);
    await store.store(db, coordinator, f.context, f.generation.secret);
    await admission.process(
      db,
      {
        cameraId: f.cameraId,
        generationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
        frameId: first.framePartition.frameId,
      },
      f.generation.secret,
    );
    const pending = f.event(0, 2, '1'),
      orphan = f.event(1, 2, '2');
    await store.store(db, pending, f.context, f.generation.secret);
    await store.store(db, orphan, f.context, f.generation.secret);
    const [{ scope_sha256: oldScope }] = await db.query(
      'SELECT scope_sha256 FROM ai_subject_segment WHERE segment_id=$1',
      [segmentId],
    );
    const original = (
      await db.query(
        'SELECT raw_payload,payload_hash,tracking_transport_ack FROM ai_observation_event WHERE event_id=$1',
        [pending.eventId],
      )
    )[0];
    const generation = await provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 120000);
    const receiptCommandId = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, f.cameraId, generation.secret, {
      commandId: receiptCommandId,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256: f.context.bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });
    const context = {
      ...f.context,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      receiptCommandId,
    };
    const target = { ...f.event(), streamSessionId: generation.streamSessionId };
    await store.store(db, target, context, generation.secret);
    // Missing implementation is the initial RED; import stays inside the real PG test.
    const { TrackedScopeTransition } =
      await import('../../src/integrations/ai/tracked-scope-transition.js');
    const transition = new TrackedScopeTransition(auth, {
      maxPendingRows: 32,
      maxActiveSegments: 32,
    });
    const command = {
      commandId: randomUUID(),
      targetEventId: target.eventId,
      expectedOldScopes: [oldScope],
    };
    await assert.rejects(
      transition.apply(db, { ...command, expectedOldScopes: [] }, generation.secret),
    );
    assert.equal(
      (await db.query('SELECT state FROM ai_subject_segment WHERE segment_id=$1', [segmentId]))[0]
        .state,
      'ACTIVE',
    );
    await assert.rejects(transition.apply(db, command, f.generation.secret));
    const bounded = new TrackedScopeTransition(auth, { maxPendingRows: 1, maxActiveSegments: 32 });
    await assert.rejects(bounded.apply(db, command, generation.secret));
    // Force failure AFTER pending classification, proving the real transaction rolls it back.
    await db.query(`CREATE FUNCTION test_fail_scope_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic transition failure'; END $$`);
    await db.query(`CREATE TRIGGER test_fail_scope_retirement BEFORE UPDATE ON ai_subject_segment
      FOR EACH ROW EXECUTE FUNCTION test_fail_scope_retirement()`);
    await assert.rejects(
      transition.apply(db, command, generation.secret),
      /Synthetic transition failure/,
    );
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          pending.eventId,
        ])
      )[0].tracking_frame_state,
      'PENDING_PARTS',
    );
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          orphan.eventId,
        ])
      )[0].tracking_frame_state,
      'PART_STAGED',
    );
    await db.query('DROP TRIGGER test_fail_scope_retirement ON ai_subject_segment');
    await db.query('DROP FUNCTION test_fail_scope_retirement()');
    const key = {
      cameraId: f.cameraId,
      generationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      frameId: target.framePartition.frameId,
    };
    const [racingAdmission, result] = await Promise.all([
      admission.process(db, key, generation.secret),
      transition.apply(db, command, generation.secret),
    ]);
    assert.ok(['SEALED', 'PENDING_PREDECESSOR'].includes(racingAdmission.kind));
    assert.deepEqual(result, { retiredSegments: 1, terminalizedParts: 2 });
    const [retired] = await db.query(
      'SELECT state,head_event_id,retirement_event_id,retirement_provenance FROM ai_subject_segment WHERE segment_id=$1',
      [segmentId],
    );
    assert.equal(retired.state, 'RETIRED');
    assert.equal(retired.head_event_id, first.eventId);
    assert.equal(retired.retirement_event_id, null); // Server termination is not captured EXIT.
    assert.equal(retired.retirement_provenance.commandId, command.commandId);
    assert.equal(retired.retirement_provenance.targetEventId, target.eventId);
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          pending.eventId,
        ])
      )[0].tracking_frame_state,
      'REVIEW_ONLY',
    );
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          orphan.eventId,
        ])
      )[0].tracking_frame_state,
      'PART_EXPIRED',
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT raw_payload,payload_hash,tracking_transport_ack FROM ai_observation_event WHERE event_id=$1',
          [pending.eventId],
        )
      )[0],
      original,
    );
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          coordinator.eventId,
        ])
      )[0].tracking_frame_state,
      'SEALED',
    );
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          first.eventId,
        ])
      )[0].tracking_frame_state,
      'PART_STAGED',
    );
    const results = await Promise.all([
      admission.process(db, key, generation.secret),
      transition.apply(db, command, generation.secret),
    ]);
    assert.equal(results[0].kind, 'SEALED');
    assert.deepEqual(results[1], { retiredSegments: 0, terminalizedParts: 0 });
    await assert.rejects(
      transition.apply(db, { ...command, targetEventId: first.eventId }, f.generation.secret),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
  } finally {
    await owned.dispose();
  }
});
