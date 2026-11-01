import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';

test('stale repeatable-read snapshots cannot commit different source route owners', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const a = db.createQueryRunner(),
    b = db.createQueryRunner();
  try {
    await owned.initialize();
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const f = await seedTrackedFrameFixture(db);
    const auth = (routeEpoch: string, fixture = f) =>
      new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
        routeEpoch,
        profileSha256: 'a'.repeat(64),
        allowedCameraIds: [fixture.cameraId],
        clockToleranceMs: 1000,
      });
    const first = await db.transaction((m) =>
      auth('00000000-0000-4000-8000-000000000001').authenticate(
        m,
        f.event(),
        f.context,
        f.generation.secret,
      ),
    );
    const second = await db.transaction((m) =>
      auth('00000000-0000-4000-8000-000000000002').authenticate(
        m,
        f.event(0, 1, '1'),
        f.context,
        f.generation.secret,
      ),
    );
    type Bound = typeof first;
    const write = (runner: typeof a, part: Bound) => {
      const p = part.payload as {
        cameraExternalId: string;
        capturedAt: string;
        framePartition: { frameId: string; sequenceNumber: string };
      };
      return runner.query(
        `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,
        processing_status,processing_note,admission_context,tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,
        tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,tracking_pending_until,tracking_transport_ack,safety_route_mode,safety_route_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED','TRACKED_RAW_STORED_NO_PROJECTION',$8,$9,$10,$11,$12,$13,0,1,'PENDING_PARTS',clock_timestamp()+interval '1 minute','{}','EPISODE_TRACKED',$14)`,
        [
          part.eventId,
          part.payloadHash,
          p.cameraExternalId,
          part.cameraId,
          part.context.streamSessionId,
          p.capturedAt,
          part.payload,
          {
            schemaVersion: '1.0.0',
            context: part.context,
            bindingHash: part.bindingHash,
            classification: part.classification,
            admittedAt: part.admittedAt,
          },
          part.scopeSha256,
          part.context.workerGenerationId,
          part.siteId,
          p.framePartition.frameId,
          p.framePartition.sequenceNumber,
          part.routeEpoch,
        ],
      );
    };
    await a.connect();
    await b.connect();
    await a.startTransaction('REPEATABLE READ');
    await b.startTransaction('REPEATABLE READ');
    await a.query('SELECT count(*) FROM ai_observation_event');
    await b.query('SELECT count(*) FROM ai_observation_event'); // Both snapshots predate the first pin.
    await write(a, first);
    await a.commitTransaction();
    await assert.rejects(
      async () => {
        await write(b, second);
        await b.commitTransaction();
      },
      (e: unknown) =>
        !!e && typeof e === 'object' && 'code' in e && ['40001', '23514'].includes(String(e.code)),
    );
    if (b.isTransactionActive) await b.rollbackTransaction();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_observation_event'))[0].n, 1);
    await b.startTransaction('READ COMMITTED');
    await assert.rejects(write(b, second), { code: '23514' });
    await b.rollbackTransaction();
    const sameOwner = await db.transaction((m) =>
      auth(first.routeEpoch).authenticate(m, f.event(0, 1, '2'), f.context, f.generation.secret),
    );
    await b.startTransaction('REPEATABLE READ');
    await write(b, sameOwner);
    await b.commitTransaction();
    assert.equal(
      (
        await db.query(
          'SELECT count(DISTINCT safety_route_epoch)::int AS n FROM ai_observation_event',
        )
      )[0].n,
      1,
    );
    const legacyWrite = (runner: typeof a, part: Bound, resolved = true) => {
      const p = part.payload as { cameraExternalId: string; capturedAt: string };
      const raw = {
        schemaVersion: '1.0.0',
        eventId: part.eventId,
        cameraExternalId: p.cameraExternalId,
        streamSessionId: part.context.streamSessionId,
        capturedAt: p.capturedAt,
        frameDimensions: { width: 120, height: 80 },
        observations: [],
        evidence: [],
      };
      return runner.query(
        `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,
      stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,$3,$4,$5,$6,$7,'SKIPPED_NO_CANDIDATE')`,
        [
          part.eventId,
          computeCanonicalPayloadHash(raw),
          p.cameraExternalId,
          resolved ? part.cameraId : null,
          part.context.streamSessionId,
          p.capturedAt,
          raw,
        ],
      );
    };
    await b.startTransaction('READ COMMITTED');
    await assert.rejects(legacyWrite(b, second), { code: '23514' });
    await b.rollbackTransaction();
    const unresolved = await db.transaction((m) =>
      auth(first.routeEpoch).authenticate(m, f.event(0, 1, '3'), f.context, f.generation.secret),
    );
    await b.startTransaction('READ COMMITTED');
    await legacyWrite(b, unresolved, false);
    await b.commitTransaction();
    await b.startTransaction('READ COMMITTED');
    await assert.rejects(
      async () => {
        await b.query('UPDATE ai_observation_event SET resolved_camera_id=$2 WHERE event_id=$1', [
          unresolved.eventId,
          f.cameraId,
        ]);
        await b.commitTransaction();
      },
      { code: '23514' },
    );
    if (b.isTransactionActive) await b.rollbackTransaction();
    assert.equal(
      (
        await db.query('SELECT resolved_camera_id FROM ai_observation_event WHERE event_id=$1', [
          unresolved.eventId,
        ])
      )[0].resolved_camera_id,
      null,
    );
    const g = await seedTrackedFrameFixture(db);
    const legacyPart = await db.transaction((m) =>
      auth(first.routeEpoch, g).authenticate(m, g.event(), g.context, g.generation.secret),
    );
    const trackedPart = await db.transaction((m) =>
      auth(first.routeEpoch, g).authenticate(m, g.event(0, 1, '1'), g.context, g.generation.secret),
    );
    await a.startTransaction('REPEATABLE READ');
    await b.startTransaction('REPEATABLE READ');
    await a.query('SELECT count(*) FROM ai_observation_event');
    await b.query('SELECT count(*) FROM ai_observation_event');
    await legacyWrite(a, legacyPart);
    await a.commitTransaction();
    await assert.rejects(
      async () => {
        await write(b, trackedPart);
        await b.commitTransaction();
      },
      (e: unknown) =>
        !!e && typeof e === 'object' && 'code' in e && ['40001', '23514'].includes(String(e.code)),
    );
    if (b.isTransactionActive) await b.rollbackTransaction();
    assert.deepEqual(
      (
        await db.query(
          'SELECT observation_route_mode AS mode,tracking_route_epoch AS epoch FROM camera_worker_generation WHERE id=$1',
          [g.generation.workerGenerationId],
        )
      )[0],
      { mode: 'LEGACY', epoch: null },
    );
  } finally {
    for (const runner of [a, b]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (!runner.isReleased) await runner.release();
    }
    await owned.dispose();
  }
});
