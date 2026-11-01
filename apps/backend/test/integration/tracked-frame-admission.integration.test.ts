import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import {
  TrackedFrameAdmission,
  type TrackedProjectionPort,
} from '../../src/integrations/ai/tracked-frame-admission.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';

test('unregistered frame admission atomically seals technical heads and the supplied projection port', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const make = (cameraId: string, projector: TrackedProjectionPort) => {
      const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
        profileSha256: 'a'.repeat(64),
        allowedCameraIds: [cameraId],
        clockToleranceMs: 1000,
        routeEpoch: '00000000-0000-4000-8000-000000000001',
      });
      return {
        store: new TrackedFramePrototypeStore(auth, {
          pendingTtlMs: 30000,
          maxPendingFrames: 16,
          maxPendingParts: 32,
          maxPendingPayloadBytes: 100000,
        }),
        admission: new TrackedFrameAdmission(
          auth,
          {
            firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
            maxCaptureGapMs: 10000,
            maxSourceSequenceGap: '1',
            maxSegmentRows: 64,
          },
          projector,
        ),
      };
    };
    type Fixture = Awaited<ReturnType<typeof seedTrackedFrameFixture>>;
    const person = (f: Fixture, sequence: string, segmentId: string, previousEventId?: string) => {
      const base = f.event(0, 1, sequence);
      return {
        ...base,
        observations: [{ type: 'PERSON', trackId: 1 }],
        continuity: {
          ...base.continuity,
          subjects: [
            {
              personObservationIndex: 0,
              segmentId,
              link: previousEventId
                ? { kind: 'CONTINUE', previousEventId, previousPersonObservationIndex: 0 }
                : { kind: 'START', reason: 'INITIAL' },
            },
          ],
        },
      };
    };
    const key = (f: Fixture, frameId: string) => ({
      cameraId: f.cameraId,
      generationId: f.generation.workerGenerationId,
      streamSessionId: f.generation.streamSessionId,
      frameId,
    });
    const noBusinessFindings: TrackedProjectionPort = {
      async project() {
        await Promise.resolve();
      },
    };
    await t.test(
      'healthy head uses original PERSON, exact raw capture, and duplicate seal never projects twice',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          segment = randomUUID(),
          event = person(f, '0', segment);
        event.capturedAt = event.capturedAt.replace('Z', '000001Z'); // Valid six additional fractional digits, retained raw.
        event.framePartition.partIndex = 1;
        event.framePartition.partCount = 2;
        const coordinator = {
          ...event,
          eventId: randomUUID(),
          framePartition: { ...event.framePartition, partIndex: 0 },
          observations: [],
          continuity: { ...event.continuity, subjects: [] },
        };
        let calls = 0;
        const service = make(f.cameraId, {
          async project(_m, frame) {
            calls++;
            assert.equal(frame.plan.subjects[0]?.subject.eventId, event.eventId);
          },
        });
        await service.store.store(db, event, f.context, f.generation.secret);
        await service.store.store(db, coordinator, f.context, f.generation.secret);
        const result = await service.admission.process(
          db,
          key(f, event.framePartition.frameId),
          f.generation.secret,
        );
        assert.equal(result.kind, 'SEALED');
        const [head] = await db.query(
          'SELECT head_event_id,head_person_observation_index FROM ai_subject_segment WHERE segment_id=$1',
          [segment],
        );
        assert.equal(head.head_event_id, event.eventId);
        assert.equal(head.head_person_observation_index, 0);
        assert.equal(
          (
            await service.admission.process(
              db,
              key(f, event.framePartition.frameId),
              f.generation.secret,
            )
          ).kind,
          'SEALED',
        );
        assert.equal(calls, 1);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
      },
    );
    await t.test(
      'projection failure rolls back raw seal, head and a projection SQL write together',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          segment = randomUUID(),
          event = person(f, '0', segment);
        const service = make(f.cameraId, {
          async project(manager) {
            await manager.query(
              "UPDATE ai_observation_event SET processing_note='SYNTHETIC_PROJECTOR_WRITE' WHERE event_id=$1",
              [event.eventId],
            );
            throw new Error('Injected projection failure');
          },
        });
        await service.store.store(db, event, f.context, f.generation.secret);
        await assert.rejects(
          service.admission.process(db, key(f, event.framePartition.frameId), f.generation.secret),
          /Injected projection failure/,
        );
        const [raw] = await db.query(
          'SELECT tracking_frame_state,processing_note FROM ai_observation_event WHERE event_id=$1',
          [event.eventId],
        );
        assert.equal(raw.tracking_frame_state, 'PENDING_PARTS');
        assert.equal(raw.processing_note, 'TRACKED_RAW_STORED_NO_PROJECTION');
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM ai_subject_segment WHERE segment_id=$1',
              [segment],
            )
          )[0].n,
          0,
        );
        assert.equal(
          (
            await make(f.cameraId, noBusinessFindings).admission.process(
              db,
              key(f, event.framePartition.frameId),
              f.generation.secret,
            )
          ).kind,
          'SEALED',
        );
      },
    );
    await t.test(
      'out-of-order predecessor recovers from durable raw without transport retry; stale head fork cannot advance',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          segment = randomUUID(),
          first = person(f, '0', segment),
          next = person(f, '1', segment, first.eventId);
        const service = make(f.cameraId, noBusinessFindings);
        await service.store.store(db, first, f.context, f.generation.secret);
        await service.store.store(db, next, f.context, f.generation.secret);
        assert.equal(
          (
            await service.admission.process(
              db,
              key(f, next.framePartition.frameId),
              f.generation.secret,
            )
          ).kind,
          'PENDING_PREDECESSOR',
        );
        await service.admission.process(
          db,
          key(f, first.framePartition.frameId),
          f.generation.secret,
        );
        const recovered = make(f.cameraId, noBusinessFindings);
        assert.equal(
          (
            await recovered.admission.process(
              db,
              key(f, next.framePartition.frameId),
              f.generation.secret,
            )
          ).kind,
          'SEALED',
        );
        const fork = person(f, '2', segment, first.eventId);
        await service.store.store(db, fork, f.context, f.generation.secret);
        const rejected = await service.admission.process(
          db,
          key(f, fork.framePartition.frameId),
          f.generation.secret,
        );
        assert.equal(rejected.kind, 'REVIEW_ONLY');
        assert.equal(
          (
            await db.query('SELECT head_event_id FROM ai_subject_segment WHERE segment_id=$1', [
              segment,
            ])
          )[0].head_event_id,
          next.eventId,
        );
      },
    );
    await t.test(
      'empty is not absence retirement; explicit retirement is permanent and orphan retirement invents no PERSON',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          segment = randomUUID(),
          first = person(f, '0', segment),
          service = make(f.cameraId, noBusinessFindings);
        await service.store.store(db, first, f.context, f.generation.secret);
        await service.admission.process(
          db,
          key(f, first.framePartition.frameId),
          f.generation.secret,
        );
        const empty = f.event(0, 1, '1');
        await service.store.store(db, empty, f.context, f.generation.secret);
        await service.admission.process(
          db,
          key(f, empty.framePartition.frameId),
          f.generation.secret,
        );
        assert.equal(
          (await db.query('SELECT state FROM ai_subject_segment WHERE segment_id=$1', [segment]))[0]
            .state,
          'ACTIVE',
        );
        const retired = {
          ...f.event(0, 1, '2'),
          continuity: {
            ...empty.continuity,
            retiredSegments: [{ segmentId: segment, reason: 'LOST_TRACK' }],
          },
        };
        await service.store.store(db, retired, f.context, f.generation.secret);
        await service.admission.process(
          db,
          key(f, retired.framePartition.frameId),
          f.generation.secret,
        );
        const resurrect = person(f, '3', segment);
        await service.store.store(db, resurrect, f.context, f.generation.secret);
        assert.equal(
          (
            await service.admission.process(
              db,
              key(f, resurrect.framePartition.frameId),
              f.generation.secret,
            )
          ).kind,
          'REVIEW_ONLY',
        );
        const g = await seedTrackedFrameFixture(db),
          orphan = randomUUID(),
          e = {
            ...g.event(),
            continuity: {
              ...g.event().continuity,
              retiredSegments: [{ segmentId: orphan, reason: 'LOST_TRACK' }],
            },
          },
          orphanService = make(g.cameraId, noBusinessFindings);
        await orphanService.store.store(db, e, g.context, g.generation.secret);
        await orphanService.admission.process(
          db,
          key(g, e.framePartition.frameId),
          g.generation.secret,
        );
        const [tombstone] = await db.query(
          'SELECT state,first_event_id,head_event_id FROM ai_subject_segment WHERE segment_id=$1',
          [orphan],
        );
        assert.deepEqual(tombstone, {
          state: 'RETIRED',
          first_event_id: null,
          head_event_id: null,
        });
      },
    );
    await t.test(
      'new generation does not reopen scope or silently retire old heads before trusted transition fencing',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          service = make(f.cameraId, noBusinessFindings),
          first = person(f, '0', randomUUID());
        await service.store.store(db, first, f.context, f.generation.secret);
        await service.admission.process(
          db,
          key(f, first.framePartition.frameId),
          f.generation.secret,
        );
        const generation = await provisionCameraWorkerGeneration(
            db,
            f.cameraId,
            [f.cameraId],
            120000,
          ),
          receiptCommandId = randomUUID();
        await recordCameraConfigurationAcknowledgement(db, f.cameraId, generation.secret, {
          commandId: receiptCommandId,
          workerGenerationId: generation.workerGenerationId,
          streamSessionId: generation.streamSessionId,
          configurationVersion: f.context.configurationVersion,
          bundleSha256: f.context.bundleSha256,
          viewRevision: f.context.viewRevision,
          outcome: 'LOADED',
        });
        const context = {
          ...f.context,
          workerGenerationId: generation.workerGenerationId,
          streamSessionId: generation.streamSessionId,
          receiptCommandId,
        };
        const event = {
          ...person(f, '0', randomUUID()),
          streamSessionId: generation.streamSessionId,
        };
        await service.store.store(db, event, context, generation.secret);
        assert.equal(
          (
            await service.admission.process(
              db,
              {
                ...key(f, event.framePartition.frameId),
                generationId: generation.workerGenerationId,
                streamSessionId: generation.streamSessionId,
              },
              generation.secret,
            )
          ).kind,
          'PENDING_PREDECESSOR',
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM ai_subject_segment WHERE camera_id=$1 AND state='ACTIVE'",
              [f.cameraId],
            )
          )[0].n,
          1,
        );
      },
    );
    await t.test(
      'captured retirement before the last original head is review-only and cannot terminate it',
      async () => {
        const f = await seedTrackedFrameFixture(db),
          segment = randomUUID(),
          first = person(f, '0', segment),
          service = make(f.cameraId, noBusinessFindings);
        await service.store.store(db, first, f.context, f.generation.secret);
        await service.admission.process(
          db,
          key(f, first.framePartition.frameId),
          f.generation.secret,
        );
        const empty = f.event(0, 1, '1');
        const rewind = {
          ...empty,
          capturedAt: new Date(Date.parse(first.capturedAt) - 1).toISOString(),
          continuity: {
            ...empty.continuity,
            retiredSegments: [{ segmentId: segment, reason: 'LOST_TRACK' }],
          },
        };
        await service.store.store(db, rewind, f.context, f.generation.secret);
        const result = await service.admission.process(
          db,
          key(f, rewind.framePartition.frameId),
          f.generation.secret,
        );
        assert.equal(result.kind, 'REVIEW_ONLY');
        assert.equal('reason' in result ? result.reason : null, 'CAPTURE_REWIND');
        const [head] = await db.query(
          'SELECT state,head_event_id,retired_at FROM ai_subject_segment WHERE segment_id=$1',
          [segment],
        );
        assert.deepEqual(head, { state: 'ACTIVE', head_event_id: first.eventId, retired_at: null });
      },
    );
  } finally {
    await owned.dispose();
  }
});
