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

test('tracked material batches project scoped inbox recipients atomically without per-frame unread resets', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES']);
    const { TrackedPpeInboxProjection } =
      await import('../../src/modules/safety/alerts/tracked-ppe-inbox-projection.js');
    const eligible: string[] = [];
    const otherSite = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic other Site')",
      [otherSite],
    );
    for (let i = 0; i < 7; i++) {
      const user = randomUUID();
      await db.query(
        `INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password)
        VALUES($1,$1::uuid::text,'Synthetic inbox recipient','not-a-login-hash',$2,$3)`,
        [user, i !== 4, i === 5],
      );
      await db.query(
        `INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)`,
        [
          randomUUID(),
          user,
          i === 2 ? null : i === 6 ? otherSite : f.siteId,
          i === 2 ? 'ADMIN' : i === 3 ? 'SITE_MANAGER' : 'SAFETY_OFFICER',
        ],
      );
      if (i < 2) eligible.push(user);
    }
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
    const projection = new TrackedPpeInboxProjection(db, { maxRecipients: 8 });
    let cap = false;
    let outcomes: Array<{ recipientOutcome: string; insertedRecipients: number }> = [];
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
          outcomes = await (
            cap ? new TrackedPpeInboxProjection(db, { maxRecipients: 1 }) : projection
          ).projectFrame(manager, {
            siteId: f.siteId,
            cameraId: f.cameraId,
            scopeSha256: frame.scope.scopeSha256,
            coordinatorEventId: frame.coordinatorEventId,
          });
        },
      },
    );
    const segmentId = randomUUID();
    const event = (sequence: string, previousEventId?: string, extra = false) => {
      const base = f.event(0, 1, sequence);
      const trackId = 100 + Number(sequence);
      return {
        ...base,
        observations: [
          { type: 'PERSON', trackId },
          ...['HARD_HAT', 'SAFETY_VEST', ...(extra ? ['GLOVES'] : [])].map((ppeItem) => ({
            type: 'PPE',
            trackId,
            ppeItem,
            status: 'MISSING',
            regionId: f.ppeRegionId!,
            geometryVersion: 1,
          })),
        ],
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
    cap = true;
    await assert.rejects(process(first), /TRACKED_PPE_INBOX_UNAVAILABLE/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
    cap = false;
    await db.query(
      `CREATE FUNCTION fail_recipient_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic recipient failure'; END $$`,
    );
    await db.query(
      `CREATE TRIGGER fail_recipient_fixture BEFORE INSERT ON safety_episode_recipient FOR EACH ROW EXECUTE FUNCTION fail_recipient_fixture()`,
    );
    await assert.rejects(process(first), /Synthetic recipient failure/);
    for (const table of [
      'ai_subject_segment',
      'safety_episode',
      'safety_alert',
      'safety_episode_recipient',
    ])
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
    assert.equal(
      (
        await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [first.eventId],
        )
      )[0].state,
      'PENDING_PARTS',
    );
    await db.query('DROP TRIGGER fail_recipient_fixture ON safety_episode_recipient');
    await db.query('DROP FUNCTION fail_recipient_fixture()');
    await process(first);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]!.recipientOutcome, 'PROJECTED');
    assert.equal(outcomes[0]!.insertedRecipients, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n, 2);
    const recipients = () =>
      db.query('SELECT * FROM safety_episode_recipient ORDER BY recipient_user_id');
    assert.deepEqual(
      (await recipients()).map((r: { recipient_user_id: string }) => r.recipient_user_id),
      eligible.sort(),
    );
    await db.query('UPDATE safety_episode_recipient SET seen_revision=1');
    const readRows = await recipients();
    const addedRecipient = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'New synthetic recipient','not-a-login-hash')",
      [addedRecipient],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [randomUUID(), addedRecipient, f.siteId],
    );
    eligible.push(addedRecipient);
    const repeat = event('1', first.eventId);
    await process(repeat);
    assert.equal(outcomes[0]!.recipientOutcome, 'UNCHANGED');
    assert.deepEqual(await recipients(), readRows);
    assert.equal(
      (await db.query('SELECT content_revision AS revision FROM safety_episode'))[0].revision,
      1,
    );
    const material = event('2', repeat.eventId, true);
    await Promise.all(Array.from({ length: 10 }, () => process(material)));
    assert.equal(
      (await db.query('SELECT content_revision AS revision FROM safety_episode'))[0].revision,
      2,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n, 3);
    const materialRows = await recipients();
    assert.equal(materialRows.length, 3);
    for (const old of readRows) {
      const current = materialRows.find(
        (r: { recipient_user_id: string }) => r.recipient_user_id === old.recipient_user_id,
      );
      assert.equal(current.seen_revision, 1);
      assert.deepEqual(current.first_delivered_at, old.first_delivered_at);
    }
    assert.equal(
      materialRows.find(
        (r: { recipient_user_id: string }) => r.recipient_user_id === addedRecipient,
      ).seen_revision,
      0,
    );
    await db.query('DELETE FROM user_role_assignment WHERE user_id=ANY($1::uuid[])', [eligible]);
    const next = event('3', material.eventId, false);
    // A distinct technical subject owns a new episode; missing findings do not dismiss the old one.
    next.continuity.subjects[0]!.link = { kind: 'START', reason: 'INITIAL' };
    next.continuity.subjects[0]!.segmentId = randomUUID();
    await process(next);
    assert.equal(outcomes[0]!.recipientOutcome, 'NO_ELIGIBLE_RECIPIENT');
    assert.equal(outcomes[0]!.insertedRecipients, 0);
    assert.deepEqual(await recipients(), materialRows);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_notification'))[0].n, 0);
  } finally {
    await owned.dispose();
  }
});
