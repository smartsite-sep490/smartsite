import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { EntityManager } from 'typeorm';

import {
  AiObservationEventEntity,
  CameraEntity,
  EventProcessingStatus,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { parseNormalizedCapturedAt } from '../../src/common/parse-normalized-captured-at.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import {
  Mf06JobLeaseService,
  type Mf06JobClaim,
  type Mf06LeaseOptions,
} from '../../src/modules/safety/assessments/mf06-job-lease.service.js';

// -----------------------------------------------------------------------------
// Database isolation and Fixture Helpers
// -----------------------------------------------------------------------------

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;

before(async () => {
  await isolated.initialize();
});

after(() => isolated.dispose());

beforeEach(async () => {
  // Cancel any lingering non-terminal job heads respecting trigger head_revision + 1
  await db.query(`
    UPDATE zone_entry_assessment_job
    SET status = 'CANCELLED',
        lease_token = NULL,
        lease_expires_at = NULL,
        head_revision = head_revision + 1,
        updated_at = clock_timestamp()
    WHERE status IN ('PENDING', 'CLAIMED')
  `);
  const nonTerminal = (await db.query(`
    SELECT count(*)::int AS count
    FROM zone_entry_assessment_job
    WHERE status IN ('PENDING', 'CLAIMED')
  `)) as { count: number }[];
  assert.equal(nonTerminal[0]?.count, 0, 'All existing jobs must be terminal before each test');
});

interface FixtureData {
  siteId: string;
  cameraId: string;
  zoneId: string;
  eventId: string;
  requestId: string;
  bindingHash: string;
}

async function createTestFixture(
  customCapturedAt = '2026-10-10T00:00:00.123000Z',
): Promise<FixtureData> {
  const siteId = randomUUID();
  const cameraId = randomUUID();
  const zoneId = randomUUID();
  const eventId = randomUUID();
  const externalId = randomUUID();
  const session = randomUUID();
  const requestId = randomUUID();
  const bindingHash = 'b'.repeat(64);
  const payloadHash = 'a'.repeat(64);

  await db.getRepository(SiteEntity).insert({
    id: siteId,
    code: siteId,
    name: 'Synthetic Assessment Site',
  });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId,
    code: cameraId,
    name: 'Synthetic Assessment Camera',
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic Assessment Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
  });

  const capturedAt = parseNormalizedCapturedAt(customCapturedAt);
  assert.ok(capturedAt);

  const observations = [
    {
      type: 'PERSON',
      trackId: 7,
      boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
    },
    {
      type: 'ZONE_ENTRY',
      trackId: 7,
      regionId: '44444444-4444-4444-8444-444444444444',
      geometryVersion: 3,
    },
  ];

  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: externalId,
    streamSessionId: session,
    capturedAt: customCapturedAt,
    frameDimensions: { width: 640, height: 480 },
    observations,
    evidence: [],
  };

  await db.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash,
    cameraExternalId: externalId,
    resolvedCameraId: cameraId,
    streamSessionId: session,
    capturedAt,
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
  });

  await db.query(
    `INSERT INTO zone_entry_assessment_request (
      request_id, event_id, payload_hash, person_observation_index,
      zone_observation_index, subject_binding_status, track_id,
      site_id, camera_id, camera_external_id, stream_session_id,
      region_id, geometry_version, zone_id, captured_at,
      requested_purpose, request_revision, binding_hash
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, $18
    )`,
    [
      requestId,
      eventId,
      payloadHash,
      0,
      1,
      'BOUND',
      7,
      siteId,
      cameraId,
      externalId,
      session,
      '44444444-4444-4444-8444-444444444444',
      3,
      zoneId,
      capturedAt,
      'INITIAL_OBSERVATION_ASSESSMENT',
      1,
      bindingHash,
    ],
  );

  return { siteId, cameraId, zoneId, eventId, requestId, bindingHash };
}

async function insertPendingJob(
  requestId: string,
  options: {
    attemptCount?: number;
    headRevision?: number;
    nextAttemptOffsetSeconds?: number;
    deadlineOffsetSeconds?: number;
    createdOffsetSeconds?: number;
  } = {},
): Promise<void> {
  const nextOffset = options.nextAttemptOffsetSeconds ?? -1;
  const deadlineOffset = options.deadlineOffsetSeconds ?? 300;
  const createdOffset = options.createdOffsetSeconds ?? 3600;

  await db.query(
    `INSERT INTO zone_entry_assessment_job (
      request_id, status, attempt_count, head_revision,
      lease_token, lease_expires_at,
      next_attempt_at, deadline_at,
      created_at, updated_at
    ) VALUES (
      $1, 'PENDING', $2, $3,
      NULL, NULL,
      clock_timestamp() + make_interval(secs => $4),
      clock_timestamp() + make_interval(secs => $5),
      clock_timestamp() - make_interval(secs => $6),
      clock_timestamp() - make_interval(secs => $6)
    )`,
    [
      requestId,
      options.attemptCount ?? 0,
      options.headRevision ?? 1,
      nextOffset,
      deadlineOffset,
      createdOffset,
    ],
  );
}

async function insertClaimedJob(
  requestId: string,
  options: {
    leaseToken?: string;
    attemptCount?: number;
    headRevision?: number;
    leaseOffsetSeconds?: number;
    deadlineOffsetSeconds?: number;
    nextOffsetSeconds?: number;
    createdOffsetSeconds?: number;
  } = {},
): Promise<string> {
  const leaseToken = options.leaseToken ?? randomUUID();
  const leaseOffset = options.leaseOffsetSeconds ?? 60;
  const deadlineOffset = options.deadlineOffsetSeconds ?? 300;
  const nextOffset = options.nextOffsetSeconds ?? -60;
  const createdOffset = options.createdOffsetSeconds ?? 3600;

  await db.query(
    `INSERT INTO zone_entry_assessment_job (
      request_id, status, attempt_count, head_revision,
      lease_token, lease_expires_at,
      next_attempt_at, deadline_at,
      created_at, updated_at
    ) VALUES (
      $1, 'CLAIMED', $2, $3,
      $4, clock_timestamp() + make_interval(secs => $5),
      clock_timestamp() + make_interval(secs => $6),
      clock_timestamp() + make_interval(secs => $7),
      clock_timestamp() - make_interval(secs => $8),
      clock_timestamp() - make_interval(secs => $8)
    )`,
    [
      requestId,
      options.attemptCount ?? 1,
      options.headRevision ?? 2,
      leaseToken,
      leaseOffset,
      nextOffset,
      deadlineOffset,
      createdOffset,
    ],
  );

  return leaseToken;
}

// -----------------------------------------------------------------------------
// Test Suite: Mf06JobLeaseService
// -----------------------------------------------------------------------------

describe('Mf06JobLeaseService integration tests', () => {
  describe('constructor options validation', () => {
    it('accepts valid boundary options', () => {
      assert.doesNotThrow(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 1, maxAttempts: 1, retryDelaySeconds: 1 }),
      );
      assert.doesNotThrow(
        () =>
          new Mf06JobLeaseService(db, {
            leaseSeconds: 60,
            maxAttempts: 3,
            retryDelaySeconds: 1,
          }),
      );
      assert.doesNotThrow(
        () =>
          new Mf06JobLeaseService(db, {
            leaseSeconds: 300,
            maxAttempts: 10,
            retryDelaySeconds: 300,
          }),
      );
    });

    it('rejects out of bounds, non-integer, or missing options', () => {
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 0, maxAttempts: 3, retryDelaySeconds: 1 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 301, maxAttempts: 3, retryDelaySeconds: 1 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60.5, maxAttempts: 3, retryDelaySeconds: 1 }),
      );

      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 0, retryDelaySeconds: 1 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 11, retryDelaySeconds: 1 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 3.5, retryDelaySeconds: 1 }),
      );

      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 0 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 301 }),
      );
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 1.5 }),
      );

      assert.throws(() => new Mf06JobLeaseService(db, null as unknown as Mf06LeaseOptions));
      assert.throws(() => new Mf06JobLeaseService(db, {} as unknown as Mf06LeaseOptions));
      assert.throws(
        () =>
          new Mf06JobLeaseService(db, {
            leaseSeconds: Number.NaN,
            maxAttempts: 3,
            retryDelaySeconds: 1,
          }),
      );
    });
  });

  describe('claim and concurrency', () => {
    it('competing claims yield exactly one winner on a single due job', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId);

      const [claim1, claim2] = await Promise.all([service.claim(), service.claim()]);
      const winner = claim1 ?? claim2;
      const loser = claim1 ? claim2 : claim1;

      assert.ok(winner, 'One claim must succeed');
      assert.equal(loser, null, 'The other competing claim must return null');
      assert.equal(winner.requestId, fixture.requestId);
      assert.equal(winner.attemptCount, 1);
      assert.equal(winner.headRevision, 2);
      assert.ok(typeof winner.leaseToken === 'string');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'CLAIMED');
      assert.equal(job.attempt_count, 1);
      assert.equal(job.head_revision, 2);
      assert.equal(job.lease_token, winner.leaseToken);
    });

    it('skips locked row with FOR UPDATE SKIP LOCKED and claims next eligible job without blocking', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixtureA = await createTestFixture();
      const fixtureB = await createTestFixture();
      await insertPendingJob(fixtureA.requestId);
      await insertPendingJob(fixtureB.requestId);

      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1 FOR UPDATE',
          [fixtureA.requestId],
        );

        const claim = await service.claim();
        assert.ok(claim);
        assert.equal(claim.requestId, fixtureB.requestId, 'Must claim Job B skipping locked Job A');
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('reclaims expired lease with new token, incremented revision and attempt count', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      const oldToken = randomUUID();
      await insertClaimedJob(fixture.requestId, {
        leaseToken: oldToken,
        attemptCount: 1,
        headRevision: 2,
        leaseOffsetSeconds: -10,
        deadlineOffsetSeconds: 300,
      });

      const claim = await service.claim();
      assert.ok(claim);
      assert.equal(claim.requestId, fixture.requestId);
      assert.notEqual(claim.leaseToken, oldToken, 'Reclaimed job must receive a new lease token');
      assert.equal(claim.attemptCount, 2);
      assert.equal(claim.headRevision, 3);

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'CLAIMED');
      assert.equal(job.attempt_count, 2);
      assert.equal(job.head_revision, 3);
      assert.equal(job.lease_token, claim.leaseToken);
    });

    it('leaves future next_attempt_at jobs untouched when claiming', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        nextAttemptOffsetSeconds: 120,
        deadlineOffsetSeconds: 300,
      });

      const claim = await service.claim();
      assert.equal(claim, null, 'Must not claim job whose next_attempt_at is in future');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'PENDING');
      assert.equal(job.attempt_count, 0);
      assert.equal(job.head_revision, 1);
    });

    it('clamps lease expiry to deadline when remaining window is less than leaseSeconds', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        deadlineOffsetSeconds: 15,
        nextAttemptOffsetSeconds: -1,
      });

      const claim = await service.claim();
      assert.ok(claim);
      const leaseExpiryMs = new Date(claim.leaseExpiresAt).getTime();
      const deadlineMs = new Date(claim.deadlineAt).getTime();

      assert.ok(leaseExpiryMs <= deadlineMs, 'leaseExpiresAt must not exceed deadlineAt');
      assert.ok(
        Math.abs(deadlineMs - leaseExpiryMs) <= 1000,
        'leaseExpiresAt should clamp to deadlineAt',
      );
    });

    it('abort before or during claim prevents claim by transaction rollback', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId);

      const controller = new AbortController();
      controller.abort();

      let claimResult: Mf06JobClaim | null = null;
      try {
        claimResult = await service.claim(controller.signal);
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }

      assert.equal(claimResult, null, 'Pre-aborted claim must return null or throw');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'PENDING');
      assert.equal(job.attempt_count, 0);
      assert.equal(job.head_revision, 1);
    });

    it('claim reaps expired deadline and exhausted attempt jobs before claiming next due job', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });

      const fixture1 = await createTestFixture();
      await insertPendingJob(fixture1.requestId, {
        deadlineOffsetSeconds: -10,
        nextAttemptOffsetSeconds: -20,
      });

      const fixture2 = await createTestFixture();
      await insertPendingJob(fixture2.requestId, {
        attemptCount: 3,
        deadlineOffsetSeconds: 300,
        nextAttemptOffsetSeconds: -10,
      });

      const fixture3 = await createTestFixture();
      await insertPendingJob(fixture3.requestId, {
        attemptCount: 0,
        deadlineOffsetSeconds: 300,
        nextAttemptOffsetSeconds: -1,
      });

      const claim = await service.claim();
      assert.ok(claim);
      assert.equal(
        claim.requestId,
        fixture3.requestId,
        'Must skip/reap invalid jobs and claim valid job',
      );

      const [job1] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture1.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job1);
      assert.equal(job1.status, 'FAILED');
      assert.equal(job1.last_error_code, 'DEADLINE_EXCEEDED');

      const [job2] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture2.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job2);
      assert.equal(job2.status, 'FAILED');
      assert.equal(job2.last_error_code, 'ATTEMPTS_EXHAUSTED');
    });

    it('refuses to claim jobs at or above maximum usable claim revision 2147483646', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        headRevision: 2147483646,
        attemptCount: 0,
        deadlineOffsetSeconds: 300,
        nextAttemptOffsetSeconds: -1,
      });

      const claim = await service.claim();
      assert.equal(
        claim,
        null,
        'Must not claim job whose headRevision >= 2147483646 to reserve head for finalize',
      );

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.last_error_code, 'HEAD_REVISION_EXHAUSTED');
      assert.equal(job.head_revision, 2147483647);
    });

    it('allows reaping of expired or exhausted jobs at head_revision 2147483646 up to 2147483647', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        headRevision: 2147483646,
        deadlineOffsetSeconds: -10,
        nextAttemptOffsetSeconds: -60,
      });

      const expiredCount = await service.expire();
      assert.ok(expiredCount >= 1, 'Must reap expired deadline job even at revision 2147483646');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.last_error_code, 'DEADLINE_EXCEEDED');
      assert.equal(job.head_revision, 2147483647);
    });
  });

  describe('retry, fail, and cancel state transitions', () => {
    it('stale retry, fail, and cancel return STALE and leave head revision untouched', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      const activeToken = randomUUID();
      await insertClaimedJob(fixture.requestId, {
        leaseToken: activeToken,
        attemptCount: 1,
        headRevision: 2,
        leaseOffsetSeconds: 60,
        deadlineOffsetSeconds: 300,
      });

      const validClaim: Mf06JobClaim = {
        requestId: fixture.requestId,
        leaseToken: activeToken,
        headRevision: 2,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        deadlineAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const staleTokenRetry = await service.retry(
        { ...validClaim, leaseToken: randomUUID() },
        'RESOLVER_TIMEOUT',
      );
      assert.equal(staleTokenRetry, 'STALE');

      const staleHeadRetry = await service.retry(
        { ...validClaim, headRevision: 1 },
        'RESOLVER_TIMEOUT',
      );
      assert.equal(staleHeadRetry, 'STALE');

      const staleTokenFail = await service.fail(
        { ...validClaim, leaseToken: randomUUID() },
        'PROCESSING_FAILED',
      );
      assert.equal(staleTokenFail, 'STALE');

      const staleHeadCancel = await service.cancel({
        ...validClaim,
        headRevision: 99,
      });
      assert.equal(staleHeadCancel, 'STALE');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'CLAIMED');
      assert.equal(job.head_revision, 2);
      assert.equal(job.lease_token, activeToken);
      assert.equal(job.attempt_count, 1);
    });

    it('guards against malformed UUID or closed invalid error codes returning STALE without SQL failure', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      const token = randomUUID();
      await insertClaimedJob(fixture.requestId, {
        leaseToken: token,
        attemptCount: 1,
        headRevision: 2,
      });

      const validClaim: Mf06JobClaim = {
        requestId: fixture.requestId,
        leaseToken: token,
        headRevision: 2,
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        deadlineAt: new Date(Date.now() + 300_000).toISOString(),
      };

      // Closed error code validation: arbitrary string code rejected as STALE
      const arbitraryRetryRes = await service.retry(
        validClaim,
        'ARBITRARY_UNSUPPORTED_CODE' as unknown as 'RESOLVER_TIMEOUT',
      );
      assert.equal(arbitraryRetryRes, 'STALE');

      const arbitraryFailRes = await service.fail(
        validClaim,
        'UNKNOWN_FAIL_CODE' as unknown as 'PROCESSING_FAILED',
      );
      assert.equal(arbitraryFailRes, 'STALE');

      // Fake / non-existent UUIDs
      const fakeUuidClaim: Mf06JobClaim = {
        ...validClaim,
        requestId: randomUUID(), // unrecorded UUID
      };
      assert.equal(await service.retry(fakeUuidClaim, 'RESOLVER_TIMEOUT'), 'STALE');
      assert.equal(await service.fail(fakeUuidClaim, 'PROCESSING_FAILED'), 'STALE');
      assert.equal(await service.cancel(fakeUuidClaim), 'STALE');

      // Malformed non-UUID strings
      const malformedClaim: Mf06JobClaim = {
        requestId: 'invalid-string',
        leaseToken: 'bad-token',
        headRevision: -5,
        attemptCount: 1,
        leaseExpiresAt: 'invalid-date',
        deadlineAt: 'invalid-date',
      };
      assert.equal(await service.retry(malformedClaim, 'RESOLVER_TIMEOUT'), 'STALE');
      assert.equal(await service.fail(malformedClaim, 'PROCESSING_FAILED'), 'STALE');
      assert.equal(await service.cancel(malformedClaim), 'STALE');

      // Verify connection is healthy (no poisoned transaction or leaked state)
      const [probe] = (await db.query('SELECT 1 AS alive')) as Record<string, unknown>[];
      assert.ok(probe);
      assert.equal(probe.alive, 1);

      // Original job row in database remains strictly intact
      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'CLAIMED');
      assert.equal(job.head_revision, 2);
      assert.equal(job.lease_token, token);
    });

    it('transitions to FAILED on third attempt failure when maxAttempts is 3', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId);

      // Cycle 1: attempt 1
      const claim1 = await service.claim();
      assert.ok(claim1);
      assert.equal(claim1.attemptCount, 1);
      const retry1 = await service.retry(claim1, 'RESOLVER_TIMEOUT');
      assert.equal(retry1, 'RETRY');

      // Cycle 2: attempt 2
      await db.query(
        `UPDATE zone_entry_assessment_job
         SET next_attempt_at = clock_timestamp() - interval '1 second',
             head_revision = head_revision + 1,
             updated_at = clock_timestamp()
         WHERE request_id = $1`,
        [fixture.requestId],
      );
      const claim2 = await service.claim();
      assert.ok(claim2);
      assert.equal(claim2.attemptCount, 2);
      const retry2 = await service.retry(claim2, 'RESOLVER_UNAVAILABLE');
      assert.equal(retry2, 'RETRY');

      // Cycle 3: attempt 3
      await db.query(
        `UPDATE zone_entry_assessment_job
         SET next_attempt_at = clock_timestamp() - interval '1 second',
             head_revision = head_revision + 1,
             updated_at = clock_timestamp()
         WHERE request_id = $1`,
        [fixture.requestId],
      );
      const claim3 = await service.claim();
      assert.ok(claim3);
      assert.equal(claim3.attemptCount, 3);
      const retry3 = await service.retry(claim3, 'RESOLVER_TIMEOUT');
      assert.equal(retry3, 'FAILED', 'Third attempt failure must transition to FAILED');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.attempt_count, 3);
      assert.equal(job.lease_token, null);
      assert.equal(job.lease_expires_at, null);

      const claim4 = await service.claim();
      assert.equal(claim4, null);
    });

    it('fails with DEADLINE_EXCEEDED when retry delay causes next attempt to reach or exceed deadline', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 30,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        deadlineOffsetSeconds: 10,
        nextAttemptOffsetSeconds: -1,
      });

      const claim = await service.claim();
      assert.ok(claim);

      const outcome = await service.retry(claim, 'RESOLVER_TIMEOUT');
      assert.equal(outcome, 'FAILED');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.last_error_code, 'DEADLINE_EXCEEDED');
      assert.equal(job.lease_token, null);
    });

    it('permanent fail and cancel transition to terminal states with no subsequent retry or claim', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });

      // Fail transition
      const fixtureFail = await createTestFixture();
      await insertPendingJob(fixtureFail.requestId);
      const claimFail = await service.claim();
      assert.ok(claimFail);
      const failOutcome = await service.fail(claimFail, 'INVALID_CONTEXT');
      assert.equal(failOutcome, 'FAILED');

      const [failedJob] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixtureFail.requestId],
      )) as Record<string, unknown>[];
      assert.ok(failedJob);
      assert.equal(failedJob.status, 'FAILED');
      assert.equal(failedJob.last_error_code, 'INVALID_CONTEXT');
      assert.equal(failedJob.lease_token, null);

      // Cancel transition
      const fixtureCancel = await createTestFixture();
      await insertPendingJob(fixtureCancel.requestId);
      const claimCancel = await service.claim();
      assert.ok(claimCancel);
      const cancelOutcome = await service.cancel(claimCancel);
      assert.equal(cancelOutcome, 'CANCELLED');

      const [cancelledJob] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixtureCancel.requestId],
      )) as Record<string, unknown>[];
      assert.ok(cancelledJob);
      assert.equal(cancelledJob.status, 'CANCELLED');
      assert.equal(cancelledJob.lease_token, null);

      assert.equal(await service.claim(), null);
    });

    it('retry moves job back to PENDING without modifying the original deadline', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      await insertPendingJob(fixture.requestId, {
        deadlineOffsetSeconds: 240,
        nextAttemptOffsetSeconds: -1,
      });

      const [initialJob] = (await db.query(
        'SELECT deadline_at FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as { deadline_at: Date }[];

      const claim = await service.claim();
      assert.ok(claim);

      const outcome = await service.retry(claim, 'RESOLVER_TIMEOUT');
      assert.equal(outcome, 'RETRY');

      const [updatedJob] = (await db.query(
        'SELECT status, deadline_at FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as { status: string; deadline_at: Date }[];
      assert.ok(initialJob && updatedJob);
      assert.equal(updatedJob.status, 'PENDING');
      assert.equal(
        new Date(updatedJob.deadline_at).getTime(),
        new Date(initialJob.deadline_at).getTime(),
        'Deadline must not be reset on retry',
      );
    });
  });

  describe('expiration sweeps and store integration', () => {
    it('expire reaps expired deadlines bounded to 100 while leaving timely claimed jobs untouched', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });

      const expiredFixtures = await Promise.all([
        createTestFixture(),
        createTestFixture(),
        createTestFixture(),
      ]);
      for (const f of expiredFixtures) {
        await insertPendingJob(f.requestId, {
          deadlineOffsetSeconds: -10,
          nextAttemptOffsetSeconds: -60,
        });
      }

      const timelyFixture = await createTestFixture();
      const timelyToken = randomUUID();
      await insertClaimedJob(timelyFixture.requestId, {
        leaseToken: timelyToken,
        attemptCount: 1,
        headRevision: 2,
        leaseOffsetSeconds: 60,
        deadlineOffsetSeconds: 300,
      });

      const reapedCount = await service.expire();
      assert.ok(reapedCount >= 3, 'Must transition expired deadline jobs');

      for (const f of expiredFixtures) {
        const [job] = (await db.query(
          'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
          [f.requestId],
        )) as Record<string, unknown>[];
        assert.ok(job);
        assert.equal(job.status, 'FAILED');
        assert.equal(job.last_error_code, 'DEADLINE_EXCEEDED');
      }

      const [timelyJob] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [timelyFixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(timelyJob);
      assert.equal(timelyJob.status, 'CLAIMED');
      assert.equal(timelyJob.lease_token, timelyToken);
      assert.equal(timelyJob.head_revision, 2);
    });

    it('expire leaves lease-expired CLAIMED jobs untouched when deadline is in future and attempts remain', async () => {
      const service = new Mf06JobLeaseService(db, {
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 1,
      });
      const fixture = await createTestFixture();
      const token = randomUUID();
      await insertClaimedJob(fixture.requestId, {
        leaseToken: token,
        attemptCount: 1,
        headRevision: 2,
        leaseOffsetSeconds: -10,
        deadlineOffsetSeconds: 300,
      });

      const expiredCount = await service.expire();
      assert.equal(expiredCount, 0, 'Must not expire job eligible for reclaim');

      const [job] = (await db.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id = $1',
        [fixture.requestId],
      )) as Record<string, unknown>[];
      assert.ok(job);
      assert.equal(job.status, 'CLAIMED');
      assert.equal(job.head_revision, 2);
      assert.equal(job.lease_token, token);
    });
  });
});

it('abort after actual claim row selection rolls back expired sweep and leaves zero new attempts', async () => {
  const expired = await createTestFixture();
  await insertPendingJob(expired.requestId, { deadlineOffsetSeconds: -10 });
  const due = await createTestFixture();
  await insertPendingJob(due.requestId);
  const controller = new AbortController();
  let selected = false;
  const abortingDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return async (_isolation: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
        target.transaction('READ COMMITTED', (manager) =>
          work(
            new Proxy(manager, {
              get(inner, key, innerReceiver) {
                if (key !== 'query') return Reflect.get(inner, key, innerReceiver);
                return async (sql: string, parameters?: unknown[]) => {
                  const rows = await inner.query(sql, parameters);
                  if (sql.includes('LIMIT 1 FOR UPDATE SKIP LOCKED')) {
                    selected = true;
                    controller.abort();
                  }
                  return rows;
                };
              },
            }),
          ),
        );
    },
  });
  const service = new Mf06JobLeaseService(abortingDb, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  assert.equal(await service.claim(controller.signal), null);
  assert.equal(selected, true);
  const rows = (await db.query(
    'SELECT status, attempt_count, head_revision FROM zone_entry_assessment_job WHERE request_id = ANY($1::uuid[])',
    [[expired.requestId, due.requestId]],
  )) as { status: string; attempt_count: number; head_revision: number }[];
  assert.equal(rows.length, 2);
  for (const row of rows)
    assert.deepEqual(row, { status: 'PENDING', attempt_count: 0, head_revision: 1 });
});

it('expiry processes exactly one bounded batch when more than100 expired jobs exist', async () => {
  for (let index = 0; index < 102; index++) {
    const fixture = await createTestFixture();
    await insertPendingJob(fixture.requestId, { deadlineOffsetSeconds: -10 });
  }
  const service = new Mf06JobLeaseService(db, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  assert.equal(await service.expire(), 100);
  const [count] = (await db.query(
    "SELECT count(*)::integer AS total FROM zone_entry_assessment_job WHERE status='PENDING'",
  )) as { total: number }[];
  assert.ok(count);
  assert.equal(count.total, 2);
  assert.equal(await service.expire(), 2);
  assert.equal(await service.expire(), 0);
});

it('retry cannot change a lease that expires after the clock read but before the write', async () => {
  const fixture = await createTestFixture();
  const token = randomUUID();
  await insertClaimedJob(fixture.requestId, {
    leaseToken: token,
    attemptCount: 1,
    headRevision: 2,
    leaseOffsetSeconds: 0.15,
    deadlineOffsetSeconds: 300,
  });
  let delayed = false;
  const laggedDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return async (_isolation: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
        target.transaction('READ COMMITTED', (manager) =>
          work(
            new Proxy(manager, {
              get(inner, key, innerReceiver) {
                if (key !== 'query') return Reflect.get(inner, key, innerReceiver);
                return async (sql: string, parameters?: unknown[]) => {
                  const rows = await inner.query(sql, parameters);
                  if (sql === 'SELECT clock_timestamp() AS now') {
                    delayed = true;
                    await inner.query(
                      'SELECT pg_sleep(GREATEST(0, extract(epoch FROM (lease_expires_at-clock_timestamp())))::double precision + 0.02) FROM zone_entry_assessment_job WHERE request_id=$1',
                      [fixture.requestId],
                    );
                  }
                  return rows;
                };
              },
            }),
          ),
        );
    },
  });
  const service = new Mf06JobLeaseService(laggedDb, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  const claim: Mf06JobClaim = {
    requestId: fixture.requestId,
    leaseToken: token,
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '',
    deadlineAt: '',
  };
  assert.equal(await service.retry(claim, 'RESOLVER_TIMEOUT'), 'STALE');
  assert.equal(delayed, true);
  const [row] = (await db.query(
    'SELECT status,head_revision,lease_token FROM zone_entry_assessment_job WHERE request_id=$1',
    [fixture.requestId],
  )) as { status: string; head_revision: number; lease_token: string }[];
  assert.deepEqual(row, { status: 'CLAIMED', head_revision: 2, lease_token: token });
});

it('claim cannot allocate a new attempt after its deadline passes between clock read and write', async () => {
  const fixture = await createTestFixture();
  await insertPendingJob(fixture.requestId, { deadlineOffsetSeconds: 0.3 });
  let delayed = false;
  const laggedDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return async (_isolation: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
        target.transaction('READ COMMITTED', (manager) =>
          work(
            new Proxy(manager, {
              get(inner, key, innerReceiver) {
                if (key !== 'query') return Reflect.get(inner, key, innerReceiver);
                return async (sql: string, parameters?: unknown[]) => {
                  const rows = await inner.query(sql, parameters);
                  if (sql === 'SELECT clock_timestamp() AS now') {
                    delayed = true;
                    await inner.query(
                      'SELECT pg_sleep(GREATEST(0, extract(epoch FROM (deadline_at-clock_timestamp())))::double precision + 0.02) FROM zone_entry_assessment_job WHERE request_id=$1',
                      [fixture.requestId],
                    );
                  }
                  return rows;
                };
              },
            }),
          ),
        );
    },
  });
  const service = new Mf06JobLeaseService(laggedDb, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  assert.equal(await service.claim(), null);
  assert.equal(delayed, true);
  const [row] = await db.query(
    'SELECT status,head_revision,attempt_count,lease_token FROM zone_entry_assessment_job WHERE request_id=$1',
    [fixture.requestId],
  );
  assert.deepEqual(row, {
    status: 'PENDING',
    head_revision: 1,
    attempt_count: 0,
    lease_token: null,
  });
});

it('retry backoff starts at the database write instead of being consumed by a stalled clock read', async () => {
  const fixture = await createTestFixture();
  const token = randomUUID();
  await insertClaimedJob(fixture.requestId, {
    leaseToken: token,
    attemptCount: 1,
    headRevision: 2,
    leaseOffsetSeconds: 60,
    deadlineOffsetSeconds: 300,
  });
  const laggedDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return async (_isolation: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
        target.transaction('READ COMMITTED', (manager) =>
          work(
            new Proxy(manager, {
              get(inner, key, innerReceiver) {
                if (key !== 'query') return Reflect.get(inner, key, innerReceiver);
                return async (sql: string, parameters?: unknown[]) => {
                  const rows = await inner.query(sql, parameters);
                  if (sql === 'SELECT clock_timestamp() AS now')
                    await inner.query('SELECT pg_sleep(1.1)');
                  return rows;
                };
              },
            }),
          ),
        );
    },
  });
  const service = new Mf06JobLeaseService(laggedDb, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  const claim: Mf06JobClaim = {
    requestId: fixture.requestId,
    leaseToken: token,
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '',
    deadlineAt: '',
  };
  assert.equal(await service.retry(claim, 'RESOLVER_TIMEOUT'), 'RETRY');
  const [row] = await db.query(
    'SELECT next_attempt_at > clock_timestamp() AS future, extract(epoch FROM(next_attempt_at-updated_at))::double precision AS delay FROM zone_entry_assessment_job WHERE request_id=$1',
    [fixture.requestId],
  );
  assert.deepEqual(row, { future: true, delay: 1 });
});
