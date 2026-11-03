import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';

import {
  AiObservationEventEntity,
  CameraEntity,
  EventProcessingStatus,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;

before(async () => {
  await isolated.initialize();
});

after(() => isolated.dispose());

test('claim targets the owned permanent schema instead of a same-session pg_temp.zone_entry_assessment_job shadow table', async () => {
  const schema = db.driver.schema;
  assert.ok(typeof schema === 'string' && /^isolated_test_[a-f0-9]{32}$/.test(schema));
  const quotedSchema = `"${schema}"`;

  const siteId = randomUUID();
  const cameraId = randomUUID();
  const zoneId = randomUUID();
  const eventId = randomUUID();
  const session = randomUUID();
  const regionId = randomUUID();
  const permanentRequestId = randomUUID();
  const shadowRequestId = randomUUID();
  const captured = '2026-10-10T00:00:00.123Z';

  await db.getRepository(SiteEntity).insert({
    id: siteId,
    code: siteId,
    name: 'Lease Schema Site',
  });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Lease Schema Camera',
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Lease Schema Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
  });

  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: cameraId,
    streamSessionId: session,
    capturedAt: captured,
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 3 },
    ],
    evidence: [],
  };
  const payloadHash = computeCanonicalPayloadHash(raw);

  await db.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash,
    cameraExternalId: cameraId,
    resolvedCameraId: cameraId,
    streamSessionId: session,
    capturedAt: new Date(captured),
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
  });

  await db.query(
    `INSERT INTO ${quotedSchema}.zone_entry_assessment_request (
      request_id, event_id, payload_hash, person_observation_index,
      zone_observation_index, subject_binding_status, track_id,
      site_id, camera_id, camera_external_id, stream_session_id,
      region_id, geometry_version, zone_id, captured_at,
      requested_purpose, request_revision, binding_hash
    ) VALUES (
      $1, $2, $3, 0,
      1, 'BOUND', 7,
      $4, $5::uuid, $5::uuid::text, $6,
      $7, 3, $8, $9,
      'INITIAL_OBSERVATION_ASSESSMENT', 1, $10
    )`,
    [
      permanentRequestId,
      eventId,
      payloadHash,
      siteId,
      cameraId,
      session,
      regionId,
      zoneId,
      new Date(captured),
      'b'.repeat(64),
    ],
  );

  await db.query(
    `INSERT INTO ${quotedSchema}.zone_entry_assessment_job (
      request_id, status, attempt_count, head_revision,
      lease_token, lease_expires_at,
      next_attempt_at, deadline_at,
      created_at, updated_at
    ) VALUES (
      $1, 'PENDING', 0, 1,
      NULL, NULL,
      clock_timestamp() - interval '1 second',
      clock_timestamp() + interval '300 seconds',
      clock_timestamp() - interval '60 seconds',
      clock_timestamp() - interval '60 seconds'
    )`,
    [permanentRequestId],
  );

  await db.query(
    `CREATE TEMP TABLE zone_entry_assessment_job (
      LIKE ${quotedSchema}.zone_entry_assessment_job INCLUDING DEFAULTS INCLUDING CONSTRAINTS
    )`,
  );
  await db.query(
    `INSERT INTO pg_temp.zone_entry_assessment_job (
      request_id, status, attempt_count, head_revision,
      lease_token, lease_expires_at,
      next_attempt_at, deadline_at,
      created_at, updated_at
    ) VALUES (
      $1, 'PENDING', 0, 1,
      NULL, NULL,
      clock_timestamp() - interval '5 seconds',
      clock_timestamp() + interval '300 seconds',
      clock_timestamp() - interval '120 seconds',
      clock_timestamp() - interval '120 seconds'
    )`,
    [shadowRequestId],
  );

  const service = new Mf06JobLeaseService(db, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  const claim = await service.claim();

  assert.ok(claim, 'Expected claim() to acquire the due permanent job');
  assert.equal(claim.requestId, permanentRequestId);
  assert.equal(claim.attemptCount, 1);
  assert.equal(claim.headRevision, 2);

  const [permanentRow] = await db.query(
    `SELECT status, attempt_count, head_revision::int AS head_revision, lease_token
     FROM ${quotedSchema}.zone_entry_assessment_job
     WHERE request_id = $1`,
    [permanentRequestId],
  );
  assert.deepEqual(permanentRow, {
    status: 'CLAIMED',
    attempt_count: 1,
    head_revision: 2,
    lease_token: claim.leaseToken,
  });

  const [shadowRow] = await db.query(
    `SELECT status, attempt_count, head_revision::int AS head_revision, lease_token
     FROM pg_temp.zone_entry_assessment_job
     WHERE request_id = $1`,
    [shadowRequestId],
  );
  assert.deepEqual(shadowRow, {
    status: 'PENDING',
    attempt_count: 0,
    head_revision: 1,
    lease_token: null,
  });
});
