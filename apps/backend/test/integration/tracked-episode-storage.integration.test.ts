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
import type { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SafetyEpisodeInboxService } from '../../src/modules/safety/alerts/safety-episode-inbox.service.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';

test('tracked episodes reuse immutable original anchors and preserve preexisting event-local history', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const migration = new TrackedSubjectStorage1795046400003();
  try {
    await owned.initialize();
    await db.transaction((m) => new WorkerEventAdmission1795046400002().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db),
      legacyEvent = randomUUID(),
      legacyEpisode = randomUUID();
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,$3::uuid::text,$3::uuid,$4,clock_timestamp(),$5,'PROCESSED')`,
      [
        legacyEvent,
        'f'.repeat(64),
        f.cameraId,
        randomUUID(),
        { schemaVersion: '1.0.0', observations: [{ type: 'PERSON', trackId: 7 }] },
      ],
    );
    await db.query(
      `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
      SELECT $1,$2,$3,event_id,0,payload_hash,captured_at,captured_at FROM ai_observation_event WHERE event_id=$4`,
      [legacyEpisode, f.siteId, f.cameraId, legacyEvent],
    );
    const [before] = await db.query(
      'SELECT row_to_json(e) AS value FROM safety_episode e WHERE id=$1',
      [legacyEpisode],
    );
    await db.transaction((m) => migration.up(m.queryRunner!));
    const [upgraded] = await db.query(
      `SELECT subject_kind,tracking_segment_id,tracking_scope_sha256,
      to_jsonb(e)-'subject_kind'-'tracking_segment_id'-'tracking_scope_sha256' AS value FROM safety_episode e WHERE id=$1`,
      [legacyEpisode],
    );
    assert.equal(upgraded.subject_kind, 'EVENT_LOCAL');
    assert.equal(upgraded.tracking_segment_id, null);
    assert.deepEqual(upgraded.value, before.value);
    await db.transaction((m) => migration.down(m.queryRunner!));
    assert.deepEqual(
      (
        await db.query('SELECT row_to_json(e) AS value FROM safety_episode e WHERE id=$1', [
          legacyEpisode,
        ])
      )[0],
      before,
    );
    await db.transaction((m) => migration.up(m.queryRunner!));
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
        async project() {
          await Promise.resolve();
        },
      },
    ); // Synthetic healthy technical admission, not a business projector.
    const segmentId = randomUUID(),
      base = f.event(),
      first = {
        ...base,
        observations: [{ type: 'PERSON', trackId: 1 }],
        continuity: {
          ...base.continuity,
          subjects: [
            { personObservationIndex: 0, segmentId, link: { kind: 'START', reason: 'INITIAL' } },
          ],
        },
      };
    const admit = async (event: typeof first) => {
      await store.store(db, event, f.context, f.generation.secret);
      assert.equal(
        (
          await admission.process(
            db,
            {
              cameraId: f.cameraId,
              generationId: f.generation.workerGenerationId,
              streamSessionId: f.generation.streamSessionId,
              frameId: event.framePartition.frameId,
            },
            f.generation.secret,
          )
        ).kind,
        'SEALED',
      );
    };
    await admit(first);
    const [{ scope_sha256: scopeHash }] = await db.query(
      'SELECT scope_sha256 FROM ai_subject_segment WHERE segment_id=$1',
      [segmentId],
    );
    const insert = (
      id: string,
      eventId: string,
      kind: string,
      segment: string | null,
      hash: string | null,
    ) =>
      db.query(
        `INSERT INTO safety_episode
      (id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at,subject_kind,tracking_segment_id,tracking_scope_sha256)
      SELECT $1,$2,$3,event_id,0,payload_hash,captured_at,captured_at,$5,$6,$7 FROM ai_observation_event WHERE event_id=$4`,
        [id, f.siteId, f.cameraId, eventId, kind, segment, hash],
      );
    await assert.rejects(insert(randomUUID(), first.eventId, 'EVENT_LOCAL', null, null));
    await assert.rejects(insert(randomUUID(), first.eventId, 'TRACKED', null, null));
    await assert.rejects(insert(randomUUID(), first.eventId, 'TRACKED', segmentId, 'b'.repeat(64)));
    const episodeId = randomUUID();
    await insert(episodeId, first.eventId, 'TRACKED', segmentId, scopeHash);

    const officerId = randomUUID();
    const recipientId = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Officer','fixture')",
      [officerId],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [randomUUID(), officerId, f.siteId],
    );
    for (const subtype of ['PPE_HARD_HAT_MISSING', 'PPE_SAFETY_VEST_MISSING']) {
      await db.query(
        `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,first_detected_at,last_detected_at)
         VALUES($1::uuid,$2,$3,'PPE_VIOLATION',$4,$1::text,now(),now())`,
        [randomUUID(), f.siteId, episodeId, subtype],
      );
    }
    await db.query(
      'INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id) VALUES($1,$2,$3,$4)',
      [recipientId, episodeId, f.siteId, officerId],
    );
    const guard = { async authenticateRequest() {} } as unknown as UserAuthGuard;
    const inbox = new SafetyEpisodeInboxService(db, guard);
    const request = {
      headers: {},
      user: {
        id: officerId,
        username: 'synthetic-officer',
        displayName: 'Synthetic Officer',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [],
      },
    };
    const page = await inbox.list(request, { recipientId, limit: '1' });
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.episode.findingCount, 2);
    assert.deepEqual(page.items[0]?.episode.subject, {
      kind: 'TRACKED',
      segmentId,
      scopeSha256: scopeHash,
    });
    assert.equal(page.items[0]?.unread, true);
    await assert.rejects(insert(randomUUID(), first.eventId, 'TRACKED', randomUUID(), scopeHash));
    await assert.rejects(insert(randomUUID(), legacyEvent, 'TRACKED', segmentId, scopeHash));
    await assert.rejects(db.query('DELETE FROM safety_episode WHERE id=$1', [episodeId]), {
      code: '23514',
    });
    await assert.rejects(
      db.query(
        "UPDATE safety_episode SET subject_kind='EVENT_LOCAL',tracking_segment_id=NULL,tracking_scope_sha256=NULL WHERE id=$1",
        [episodeId],
      ),
    );
    await assert.rejects(
      db.query(
        "UPDATE safety_episode SET subject_kind='TRACKED',tracking_segment_id=$2,tracking_scope_sha256=$3 WHERE id=$1",
        [legacyEpisode, segmentId, scopeHash],
      ),
    );
    const next = {
      ...f.event(0, 1, '1'),
      observations: first.observations,
      continuity: {
        ...first.continuity,
        subjects: [
          {
            personObservationIndex: 0,
            segmentId,
            link: {
              kind: 'CONTINUE',
              previousEventId: first.eventId,
              previousPersonObservationIndex: 0,
            },
          },
        ],
      },
    };
    await store.store(db, next, f.context, f.generation.secret);
    assert.equal(
      (
        await admission.process(
          db,
          {
            cameraId: f.cameraId,
            generationId: f.generation.workerGenerationId,
            streamSessionId: f.generation.streamSessionId,
            frameId: next.framePartition.frameId,
          },
          f.generation.secret,
        )
      ).kind,
      'SEALED',
    );
    await assert.rejects(insert(randomUUID(), next.eventId, 'TRACKED', segmentId, scopeHash), {
      code: '23505',
    });
    await assert.rejects(
      db.transaction((m) => migration.down(m.queryRunner!)),
      /history/,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 2);
  } finally {
    await owned.dispose();
  }
});
