import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../src/config/environment.js';
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
import { TrackedSafetyProjection } from '../../src/modules/safety/alerts/tracked-safety-projection.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06EnqueueService } from '../../src/modules/safety/assessments/mf06-enqueue.service.js';
import { AiObservationEventEntity } from '../../src/database/entities/ai-observation-event.entity.js';

type Frame = Parameters<TrackedProjectionPort['project']>[1];
test('mixed sealed frame atomically projects PPE and original MF06 work, preserves media and retries without duplicates', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
    const recipient = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic mixed frame recipient','not-a-login-hash',true,false)",
      [recipient],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [randomUUID(), recipient, f.siteId],
    );
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
    const config = new ConfigService<BackendEnvironment, true>({
      MF06_ENQUEUE_ENABLED: true,
      MF06_ENQUEUE_MAX_OUTSTANDING: 1,
    });
    const queue = new Mf06IngestionEnqueueService(db, config);
    const projection = new TrackedSafetyProjection(db, config, { maxRecipients: 8 });
    let failAfterProjection = true;
    let capturedFrame: Frame | undefined;
    const admission = new TrackedFrameAdmission(
      auth,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 32,
      },
      {
        async project(m, frame) {
          capturedFrame = frame;
          await projection.project(m, frame);
          await assert.rejects(queue.enqueueSealedFrame(m, { ...frame }), /unavailable/i);
          if (failAfterProjection) throw new Error('TEST_AFTER_PROJECTIONS');
        },
      },
    );
    const first = f.event(0, 2, '0');
    const segmentId = randomUUID();
    const second = {
      ...f.event(1, 2, '0', first.framePartition.frameId),
      capturedAt: first.capturedAt,
      observations: [
        { type: 'PERSON', trackId: 2 },
        {
          type: 'PERSON',
          trackId: 1,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          type: 'PPE',
          trackId: 1,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId: f.ppeRegionId!,
          geometryVersion: 1,
        },
        { type: 'ZONE_ENTRY', trackId: 1, regionId: f.ppeRegionId!, geometryVersion: 1 },
      ],
      evidence: [
        {
          kind: 'FRAME',
          uri: `local://evidence/${f.generation.streamSessionId}/0/SECOND.jpg`,
          sha256: 'b'.repeat(64),
        },
      ],
      continuity: {
        ...first.continuity,
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: randomUUID(),
            link: { kind: 'START', reason: 'INITIAL' },
          },
          { personObservationIndex: 1, segmentId, link: { kind: 'START', reason: 'INITIAL' } },
        ],
      },
    };
    second.evidence[0]!.uri = second.evidence[0]!.uri.replace('SECOND', second.eventId);
    await store.store(db, second, f.context, f.generation.secret);
    await store.store(db, first, f.context, f.generation.secret);
    await db.transaction(async (m) => {
      const original = await m
        .getRepository(AiObservationEventEntity)
        .findOneByOrFail({ eventId: second.eventId });
      assert.deepEqual(
        await new Mf06EnqueueService(db).enqueueFresh(m, original),
        [],
        'staging cannot manufacture a fresh insert receipt',
      );
    });
    const key = {
      cameraId: f.cameraId,
      generationId: f.generation.workerGenerationId,
      streamSessionId: f.generation.streamSessionId,
      frameId: first.framePartition.frameId,
    };
    await assert.rejects(admission.process(db, key, f.generation.secret), /TEST_AFTER_PROJECTIONS/);
    for (const table of [
      'ai_subject_segment',
      'safety_episode',
      'safety_episode_recipient',
      'zone_entry_assessment_request',
      'zone_entry_assessment_job',
    ]) {
      assert.equal(
        Number((await db.query(`SELECT count(*) AS total FROM ${table}`))[0].total),
        0,
        `${table} must roll back`,
      );
    }
    assert.equal(
      (
        await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [first.eventId],
        )
      )[0].state,
      'PENDING_PARTS',
    );
    failAfterProjection = false;
    assert.equal((await admission.process(db, key, f.generation.secret)).kind, 'SEALED');
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS total FROM zone_entry_assessment_request'))[0].total,
      ),
      1,
      'one original ZONE_ENTRY must enqueue one assessment',
    );
    const [request] = await db.query(
      'SELECT event_id,person_observation_index,zone_observation_index FROM zone_entry_assessment_request',
    );
    assert.deepEqual(request, {
      event_id: second.eventId,
      person_observation_index: 1,
      zone_observation_index: 3,
    });
    const [episode] = await db.query('SELECT tracking_segment_id FROM safety_episode');
    assert.equal(episode.tracking_segment_id, segmentId);
    assert.equal(
      Number(
        (
          await db.query(
            'SELECT count(*) AS total FROM safety_episode_recipient WHERE recipient_user_id=$1',
            [recipient],
          )
        )[0].total,
      ),
      1,
      'actual composition must persist the scoped episode inbox recipient',
    );
    assert.equal((await admission.process(db, key, f.generation.secret)).kind, 'SEALED');
    assert.equal(
      Number((await db.query('SELECT count(*) AS total FROM zone_entry_assessment_job'))[0].total),
      1,
    );
    await assert.rejects(
      db.transaction((m) => queue.enqueueSealedFrame(m, capturedFrame!)),
      /unavailable|projection/i,
    );
    const lease = new Mf06JobLeaseService(db, {
      leaseSeconds: 60,
      maxAttempts: 3,
      retryDelaySeconds: 1,
    });
    const claim = await lease.claim();
    assert.ok(claim);
    const loaded = await new Mf06ClaimContextReader(db).readForClaim(claim);
    assert.equal(loaded.status, 'MATCHED');
    if (loaded.status === 'MATCHED') {
      assert.equal(loaded.subject?.personObservationIndex, 1);
      assert.equal(loaded.frameReference?.eventId, second.eventId);
      assert.equal(loaded.frameReference?.framePartition?.partIndex, 1);
      assert.equal(loaded.frameReference?.sequenceNumber, '0');
    }
    const next = {
      ...f.event(0, 1, '1'),
      observations: second.observations,
      continuity: {
        ...second.continuity,
        subjects: second.continuity.subjects.map((subject) => ({
          ...subject,
          link: {
            kind: 'CONTINUE',
            previousEventId: second.eventId,
            previousPersonObservationIndex: subject.personObservationIndex,
          },
        })),
      },
    };
    await store.store(db, next, f.context, f.generation.secret);
    await assert.rejects(
      admission.process(db, { ...key, frameId: next.framePartition.frameId }, f.generation.secret),
      /temporarily unavailable/i,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS total FROM zone_entry_assessment_job'))[0].total),
      1,
      'capacity failure retains only original job',
    );
    assert.equal(
      (
        await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [next.eventId],
        )
      )[0].state,
      'PENDING_PARTS',
    );
    assert.equal(
      (
        await db.query('SELECT head_event_id FROM ai_subject_segment WHERE segment_id=$1', [
          segmentId,
        ])
      )[0].head_event_id,
      second.eventId,
      'capacity failure rolls back head advance',
    );
  } finally {
    await owned.dispose();
  }
});
