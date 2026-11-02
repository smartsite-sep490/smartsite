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
import { AiObservationEventEntity } from '../../src/database/entities/ai-observation-event.entity.js';
import { loadMf06EventAdmission } from '../../src/modules/safety/assessments/mf06-event-admission.js';

test('MF06 reads only complete sealed LIVE originals including a nonzero part, without requiring a current segment head', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
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
    const frameId = randomUUID();
    const first = f.event(0, 2, '0', frameId);
    const second = {
      ...f.event(1, 2, '0', frameId),
      capturedAt: first.capturedAt,
      observations: [
        {
          type: 'PERSON',
          trackId: 1,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
        },
        { type: 'ZONE_ENTRY', trackId: 1, regionId: f.ppeRegionId!, geometryVersion: 1 },
      ],
      continuity: {
        ...first.continuity,
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: randomUUID(),
            link: { kind: 'START', reason: 'INITIAL' },
          },
        ],
      },
    };
    const read = (eventId = second.eventId, siteId = f.siteId) =>
      db.transaction(async (m) => {
        const event = await m.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId });
        return loadMf06EventAdmission(m, event, siteId);
      });
    await store.store(db, second, f.context, f.generation.secret);
    assert.equal(await read(), undefined, 'isolated staged part must not become eligible');
    await store.store(db, first, f.context, f.generation.secret);
    assert.equal(await read(), undefined, 'complete but unsealed frame remains unavailable');
    const admission = new TrackedFrameAdmission(
      auth,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 32,
      },
      { async project() {} },
    );
    await admission.process(
      db,
      {
        cameraId: f.cameraId,
        generationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
        frameId,
      },
      f.generation.secret,
    );
    assert.ok(await read(), 'sealed nonzero original must remain available to MF06');
    const next = {
      ...f.event(0, 1, '1'),
      observations: second.observations,
      continuity: {
        ...second.continuity,
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: second.continuity.subjects[0]!.segmentId,
            link: {
              kind: 'CONTINUE',
              previousEventId: second.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
      },
    };
    await store.store(db, next, f.context, f.generation.secret);
    await admission.process(
      db,
      {
        cameraId: f.cameraId,
        generationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
        frameId: next.framePartition.frameId,
      },
      f.generation.secret,
    );
    assert.ok(await read(), 'historical assessment must not depend on current segment state');
    assert.equal(await read(second.eventId, randomUUID()), undefined, 'Site mismatch fails closed');
    await assert.rejects(
      db.query(
        "UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY' WHERE event_id=$1",
        [first.eventId],
      ),
      /immutable/,
    );
    assert.ok(await read(), 'failed terminal rewrite leaves the sealed original intact');
    const review = {
      ...f.event(0, 1, '2'),
      capturedAt: new Date(Date.now() - 10000).toISOString(),
    };
    await store.store(db, review, f.context, f.generation.secret);
    const outcome = await admission.process(
      db,
      {
        cameraId: f.cameraId,
        generationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
        frameId: review.framePartition.frameId,
      },
      f.generation.secret,
    );
    assert.equal(outcome.kind, 'REVIEW_ONLY');
    assert.equal(await read(review.eventId), undefined, 'review-only source never qualifies');
  } finally {
    await owned.dispose();
  }
});
