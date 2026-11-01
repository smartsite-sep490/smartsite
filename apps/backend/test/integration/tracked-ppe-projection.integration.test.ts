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
import { TrackedScopeTransition } from '../../src/integrations/ai/tracked-scope-transition.js';

test('three affected people among ten yield three episodes, original findings and one material revision per subject batch', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES']);
    assert.ok(f.ppeRegionId);
    const { TrackedPpeEpisodeProjection } =
      await import('../../src/modules/safety/alerts/tracked-ppe-episode-projection.js');
    const projection = new TrackedPpeEpisodeProjection(db);
    const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [f.cameraId],
      clockToleranceMs: 1000,
      routeEpoch: '00000000-0000-4000-8000-000000000001',
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
        maxSegmentRows: 32,
      },
      {
        async project(manager, frame) {
          await projection.projectFrame(manager, {
            siteId: f.siteId,
            cameraId: f.cameraId,
            scopeSha256: frame.scope.scopeSha256,
            coordinatorEventId: frame.coordinatorEventId,
          });
        },
      },
    );
    const segments = Array.from({ length: 10 }, () => randomUUID());
    const event = (sequence: string, previousEventId?: string, extra = false) => {
      const base = f.event(0, 1, sequence);
      const offset = Number(sequence) * 100; // Numeric tracker labels are not the continuity identity.
      const missing = (trackId: number, ppeItem: string) => ({
        type: 'PPE',
        trackId: trackId + offset,
        ppeItem,
        status: 'MISSING',
        regionId: f.ppeRegionId!,
        geometryVersion: 1,
      });
      return {
        ...base,
        observations: [
          ...segments.map((_id, i) => ({ type: 'PERSON', trackId: i + 1 + offset })),
          missing(1, 'HARD_HAT'),
          missing(1, 'SAFETY_VEST'),
          missing(2, 'HARD_HAT'),
          missing(3, 'GLOVES'),
          ...(extra ? [missing(1, 'GLOVES')] : []),
        ],
        continuity: {
          ...base.continuity,
          subjects: segments.map((segmentId, i) => ({
            personObservationIndex: i,
            segmentId,
            link: previousEventId
              ? { kind: 'CONTINUE', previousEventId, previousPersonObservationIndex: i }
              : { kind: 'START', reason: 'INITIAL' },
          })),
        },
      };
    };
    const process = async (e: { framePartition: { frameId: string } }) => {
      await store.store(db, e, f.context, f.generation.secret);
      return admission.process(
        db,
        {
          cameraId: f.cameraId,
          generationId: f.generation.workerGenerationId,
          streamSessionId: f.generation.streamSessionId,
          frameId: e.framePartition.frameId,
        },
        f.generation.secret,
      );
    };
    const first = event('0');
    await db.query(`CREATE FUNCTION test_fail_tracked_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic mapping failure'; END $$`);
    await db.query(`CREATE TRIGGER test_fail_tracked_mapping BEFORE INSERT ON alert_detection_mapping
      FOR EACH ROW EXECUTE FUNCTION test_fail_tracked_mapping()`);
    await assert.rejects(process(first), /Synthetic mapping failure/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n, 0);
    assert.equal(
      (
        await db.query('SELECT tracking_frame_state FROM ai_observation_event WHERE event_id=$1', [
          first.eventId,
        ])
      )[0].tracking_frame_state,
      'PENDING_PARTS',
    );
    await db.query('DROP TRIGGER test_fail_tracked_mapping ON alert_detection_mapping');
    await db.query('DROP FUNCTION test_fail_tracked_mapping()');
    assert.equal((await process(first)).kind, 'SEALED');
    assert.deepEqual(
      (
        await db.query(
          'SELECT safety_route_mode AS mode,safety_route_epoch AS epoch FROM ai_observation_event WHERE event_id=$1',
          [first.eventId],
        )
      )[0],
      { mode: 'EPISODE_TRACKED', epoch: '00000000-0000-4000-8000-000000000001' },
    );
    const otherAuth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [f.cameraId],
      clockToleranceMs: 1000,
      routeEpoch: '00000000-0000-4000-8000-000000000002',
    });
    const otherStore = new TrackedFramePrototypeStore(otherAuth, {
      pendingTtlMs: 30000,
      maxPendingFrames: 16,
      maxPendingParts: 32,
      maxPendingPayloadBytes: 100000,
    });
    await assert.rejects(otherStore.store(db, first, f.context, f.generation.secret));
    await assert.rejects(
      otherStore.store(db, event('7', first.eventId), f.context, f.generation.secret),
    );
    const otherAdmission = new TrackedFrameAdmission(
      otherAuth,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 32,
      },
      {
        async project() {
          throw new Error('Wrong route must not reach projection');
        },
      },
    );
    await assert.rejects(
      otherAdmission.process(
        db,
        {
          cameraId: f.cameraId,
          generationId: f.generation.workerGenerationId,
          streamSessionId: f.generation.streamSessionId,
          frameId: first.framePartition.frameId,
        },
        f.generation.secret,
      ),
    );
    await assert.rejects(
      db.query("UPDATE ai_observation_event SET safety_route_mode='LEGACY' WHERE event_id=$1", [
        first.eventId,
      ]),
      { code: '23514' },
    );
    const rejectedRaw = event('7', first.eventId);
    await assert.rejects(
      db.query(
        `INSERT INTO ai_observation_event SELECT (jsonb_populate_record(NULL::ai_observation_event,
      to_jsonb(e)||jsonb_build_object('event_id',$2::uuid,'raw_payload',$3::jsonb,'tracking_frame_id',$4::uuid,'tracking_source_sequence',7,
      'safety_route_epoch','00000000-0000-4000-8000-000000000002'))).* FROM ai_observation_event e WHERE event_id=$1`,
        [
          first.eventId,
          rejectedRaw.eventId,
          JSON.stringify(rejectedRaw),
          rejectedRaw.framePartition.frameId,
        ],
      ),
      /Tracked source route epoch is immutable/,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n, 10);
    const summaries = () =>
      db.query(`SELECT e.tracking_segment_id AS segment,e.content_revision AS revision,count(a.id)::int AS findings
      FROM safety_episode e LEFT JOIN safety_alert a ON a.episode_id=e.id GROUP BY e.id ORDER BY e.tracking_segment_id`);
    const initial = await summaries();
    assert.equal(initial.length, 3);
    assert.equal(initial.find((r: { segment: string }) => r.segment === segments[0]).findings, 2);
    assert.ok(initial.every((r: { revision: number }) => r.revision === 1));
    const originalKeys = await db.query('SELECT id,grouping_key FROM safety_alert ORDER BY id');
    const repeat = event('1', first.eventId);
    assert.equal((await process(repeat)).kind, 'SEALED');
    assert.deepEqual(await summaries(), initial);
    assert.deepEqual(
      await db.query('SELECT id,grouping_key FROM safety_alert ORDER BY id'),
      originalKeys,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM alert_detection_mapping'))[0].n,
      8,
    );
    const contributors = await db.query(
      'SELECT event_id,person_observation_index FROM alert_detection_mapping ORDER BY event_id,person_observation_index',
    );
    assert.ok(
      contributors.every(
        (r: { event_id: string; person_observation_index: number }) =>
          [first.eventId, repeat.eventId].includes(r.event_id) && r.person_observation_index < 3,
      ),
    );
    const extra = event('2', repeat.eventId, true);
    assert.equal((await process(extra)).kind, 'SEALED');
    const updated = await summaries();
    assert.equal(updated.find((r: { segment: string }) => r.segment === segments[0]).revision, 2);
    assert.equal(updated.find((r: { segment: string }) => r.segment === segments[0]).findings, 3);
    assert.ok(
      updated
        .filter((r: { segment: string }) => r.segment !== segments[0])
        .every((r: { revision: number }) => r.revision === 1),
    );
    const before = await db.query(
      'SELECT * FROM alert_detection_mapping ORDER BY alert_id,event_id',
    );
    assert.equal((await process(extra)).kind, 'SEALED');
    assert.deepEqual(
      await db.query('SELECT * FROM alert_detection_mapping ORDER BY alert_id,event_id'),
      before,
    );
    const moved = event('3', extra.eventId, true);
    for (const o of moved.observations) if ('regionId' in o) o.regionId = f.ppeRegionIds[1]!;
    assert.equal((await process(moved)).kind, 'SEALED');
    const afterMove = await summaries();
    assert.ok(
      afterMove.every(
        (r: { segment: string; revision: number }) =>
          r.revision === (r.segment === segments[0] ? 3 : 2),
      ),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n, 5);
    const split = event('4', moved.eventId, true);
    const common = { ...split.framePartition, partCount: 2 };
    const part0 = {
      ...split,
      framePartition: { ...common, partIndex: 0 },
      observations: split.observations.filter((o) => !('ppeItem' in o) || o.ppeItem === 'HARD_HAT'),
    };
    const part1 = {
      ...split,
      eventId: randomUUID(),
      framePartition: { ...common, partIndex: 1 },
      observations: split.observations.filter((o) => !('ppeItem' in o) || o.ppeItem !== 'HARD_HAT'),
    };
    for (const o of part1.observations) if ('regionId' in o) o.regionId = f.ppeRegionIds[1]!;
    await store.store(db, part1, f.context, f.generation.secret); // Reverse original part arrival.
    assert.equal((await process(part0)).kind, 'SEALED');
    const splitMappings = await db.query(
      `SELECT a.candidate_subtype,m.event_id,m.person_observation_index
      FROM alert_detection_mapping m JOIN safety_alert a ON a.id=m.alert_id WHERE m.event_id=ANY($1::uuid[])`,
      [[part0.eventId, part1.eventId]],
    );
    assert.equal(splitMappings.length, 5);
    assert.ok(
      splitMappings.every(
        (r: { candidate_subtype: string; event_id: string }) =>
          r.event_id ===
          (r.candidate_subtype === 'PPE_HARD_HAT_MISSING' ? part0.eventId : part1.eventId),
      ),
    );
    const final = await summaries();
    assert.ok(
      final.every(
        (r: { segment: string; revision: number }) =>
          r.revision === (r.segment === segments[0] ? 4 : r.segment === segments[1] ? 3 : 2),
      ),
    );
    const alertsBeforeClose = await db.query('SELECT * FROM safety_alert ORDER BY id');
    const episodeSnapshot = () =>
      db.query(`SELECT tracking_segment_id AS segment,content_revision AS revision,last_observed_at,collection_state AS state
      FROM safety_episode ORDER BY tracking_segment_id`);
    const beforeClose = await episodeSnapshot();
    const observationSnapshot = (
      rows: Array<{ segment: string; revision: number; last_observed_at: Date }>,
    ) =>
      rows.map((r) => ({
        segment: r.segment,
        revision: r.revision,
        last_observed_at: r.last_observed_at,
      }));
    const empty = f.event(0, 1, '5');
    assert.equal((await process(empty)).kind, 'SEALED');
    assert.deepEqual(await episodeSnapshot(), beforeClose); // Empty alone never resolves safety work.
    const retirementBase = f.event(0, 1, '6');
    const retirement = {
      ...retirementBase,
      continuity: {
        ...retirementBase.continuity,
        retiredSegments: [{ segmentId: segments[0]!, reason: 'LOST_TRACK' }],
      },
    };
    assert.equal((await process(retirement)).kind, 'SEALED');
    const afterRetire = await episodeSnapshot();
    assert.equal(
      afterRetire.find((r: { segment: string }) => r.segment === segments[0]).state,
      'SEALED',
    );
    assert.ok(
      afterRetire
        .filter((r: { segment: string }) => r.segment !== segments[0])
        .every((r: { state: string }) => r.state === 'COLLECTING'),
    );
    assert.deepEqual(observationSnapshot(afterRetire), observationSnapshot(beforeClose));
    const generation = await provisionCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 120000),
      receiptCommandId = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, f.cameraId, generation.secret, {
      commandId: receiptCommandId,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256: f.context.bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });
    const nextContext = {
      ...f.context,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      receiptCommandId,
    };
    const target = { ...f.event(), streamSessionId: generation.streamSessionId };
    await otherStore.store(db, target, nextContext, generation.secret);
    const [{ scope_sha256: oldScope }] = await db.query(
      'SELECT scope_sha256 FROM ai_subject_segment WHERE segment_id=$1',
      [segments[1]],
    );
    await new TrackedScopeTransition(otherAuth, {
      maxPendingRows: 32,
      maxActiveSegments: 32,
    }).apply(
      db,
      { commandId: randomUUID(), targetEventId: target.eventId, expectedOldScopes: [oldScope] },
      generation.secret,
    );
    const afterFence = await episodeSnapshot();
    assert.ok(afterFence.every((r: { state: string }) => r.state === 'SEALED'));
    assert.deepEqual(observationSnapshot(afterFence), observationSnapshot(beforeClose));
    assert.deepEqual(await db.query('SELECT * FROM safety_alert ORDER BY id'), alertsBeforeClose);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM safety_episode_recipient'))[0].n,
      0,
    );
    await assert.rejects(
      db.transaction((m) =>
        projection.projectFrame(m, {
          siteId: randomUUID(),
          cameraId: f.cameraId,
          scopeSha256: 'a'.repeat(64),
          coordinatorEventId: first.eventId,
        }),
      ),
    );
  } finally {
    await owned.dispose();
  }
});
