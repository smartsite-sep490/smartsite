import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource } from 'typeorm';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06ClaimContextReader } from '../src/modules/safety/assessments/mf06-claim-context.reader.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const STREAM_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REGION_ID = '44444444-4444-4444-8444-444444444444';
const ZONE_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const LEASE_TOKEN = '88888888-8888-4888-8888-888888888888';
const OTHER_UUID = '99999999-9999-4999-8999-999999999999';
const CAPTURED_AT = '2026-10-10T01:02:03.456Z';
const LEASE_EXPIRES_AT = '2026-10-10T01:05:00.000Z';
const DEADLINE_AT = '2026-10-10T01:15:00.000Z';
const TEST_SCHEMA = 'isolated_claim_ctx_schema';

function makeFixture() {
  const rawPayload = {
    schemaVersion: '1.0.0',
    eventId: EVENT_ID,
    cameraExternalId: 'cam-gate-01',
    streamSessionId: STREAM_SESSION_ID,
    capturedAt: CAPTURED_AT,
    frameDimensions: { width: 1920, height: 1080 },
    observations: [
      {
        type: 'PERSON',
        trackId: 42,
        boundingBox: {
          x1: 0.1,
          y1: 0.2,
          x2: 0.4,
          y2: 0.8,
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
      {
        type: 'ZONE_ENTRY',
        trackId: 42,
        regionId: REGION_ID,
        geometryVersion: 3,
      },
    ],
    evidence: [],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const event: AiObservationEventEntity = {
    eventId: EVENT_ID,
    payloadHash,
    cameraExternalId: 'cam-gate-01',
    resolvedCameraId: CAMERA_ID,
    streamSessionId: STREAM_SESSION_ID,
    capturedAt: new Date(CAPTURED_AT),
    receivedAt: new Date('2026-10-10T01:02:04.000Z'),
    rawPayload,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
    createdAt: new Date('2026-10-10T01:02:04.000Z'),
  };
  const request: ZoneEntryAssessmentRequestEntity = {
    requestId: REQUEST_ID,
    eventId: EVENT_ID,
    payloadHash,
    personObservationIndex: 0,
    zoneObservationIndex: 1,
    subjectBindingStatus: 'BOUND',
    trackId: 42,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    cameraExternalId: 'cam-gate-01',
    streamSessionId: STREAM_SESSION_ID,
    regionId: REGION_ID,
    geometryVersion: 3,
    zoneId: ZONE_ID,
    capturedAt: new Date(CAPTURED_AT),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: 'b'.repeat(64),
    requestedAt: new Date('2026-10-10T01:02:05.000Z'),
  };
  const claim: Mf06JobClaim = Object.freeze({
    requestId: REQUEST_ID,
    leaseToken: LEASE_TOKEN,
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    deadlineAt: DEADLINE_AT,
  });
  const jobRow = {
    request_id: REQUEST_ID,
    status: 'CLAIMED',
    lease_token: LEASE_TOKEN,
    head_revision: 2,
    attempt_count: 1,
    lease_expires_at: new Date(LEASE_EXPIRES_AT),
    deadline_at: new Date(DEADLINE_AT),
    within_window: true,
  };
  return { event, request, claim, jobRow };
}

function makeFakeDataSource(options?: {
  schema?: unknown;
  schemaMatches?: boolean;
  tablesPresent?: boolean;
  jobRows?: unknown[] | ((pollIndex: number) => unknown[]);
  request?: ZoneEntryAssessmentRequestEntity | null;
  siteRows?: unknown[];
  event?: AiObservationEventEntity | null;
  onStep?: (step: string) => void;
}) {
  const f = makeFixture();
  const calls: string[] = [];
  let jobPollCount = 0;
  const step = (label: string) => {
    calls.push(label);
    options?.onStep?.(label);
  };
  const db = {
    driver: { schema: options && 'schema' in options ? options.schema : TEST_SCHEMA },
    async transaction(isolation: string, runInTransaction: (manager: unknown) => Promise<unknown>) {
      step(`tx:${isolation}`);
      const manager = {
        async query(sql: string, params?: unknown[]) {
          const text = sql.replace(/\s+/g, ' ').trim();
          if (text === 'SET TRANSACTION READ ONLY') {
            step('sql:read_only');
            return [];
          }
          if (text === "SET LOCAL statement_timeout='5s'") {
            step('sql:timeout');
            return [];
          }
          if (text.includes('current_schema() = $1::text')) {
            step('sql:schema_check');
            return [
              {
                schema_matches: options?.schemaMatches ?? true,
                tables_present: options?.tablesPresent ?? true,
              },
            ];
          }
          if (text.startsWith('LOCK TABLE ')) {
            step(`sql:lock:${text}`);
            return [];
          }
          if (text.includes("set_config('search_path'")) {
            step(`sql:search_path:${String(params?.[0])}`);
            return [];
          }
          if (text.includes('FROM') && text.includes('zone_entry_assessment_job')) {
            const currentPoll = jobPollCount++;
            step(`sql:job:${String(params?.[0])}:#${currentPoll}`);
            if (typeof options?.jobRows === 'function') {
              return options.jobRows(currentPoll);
            }
            return options?.jobRows ?? [f.jobRow];
          }
          if (text === 'SELECT id FROM site WHERE id = $1') {
            step(`sql:site:${String(params?.[0])}`);
            return options?.siteRows ?? [{ id: SITE_ID }];
          }
          throw new Error(`Unexpected SQL: ${text}`);
        },
        getRepository(entity: unknown) {
          if (entity === ZoneEntryAssessmentRequestEntity) {
            return {
              async findOneBy(where: { requestId: string }) {
                step(`repo:request:${where.requestId}`);
                return options && 'request' in options ? options.request : f.request;
              },
            };
          }
          if (entity === AiObservationEventEntity) {
            return {
              async findOneBy(where: { eventId: string }) {
                step(`repo:event:${where.eventId}`);
                return options && 'event' in options ? options.event : f.event;
              },
            };
          }
          throw new Error('Unexpected repository');
        },
      };
      return runInTransaction(manager);
    },
  } as unknown as DataSource;
  return { db, calls, fixture: f };
}

test('matches active CLAIMED job in REPEATABLE READ READ ONLY snapshot and derives Site from server request', async () => {
  const { db, calls } = makeFakeDataSource();
  const reader = new Mf06ClaimContextReader(db);
  const uppercaseClaim: Mf06JobClaim = {
    requestId: REQUEST_ID.toUpperCase(),
    leaseToken: LEASE_TOKEN.toUpperCase(),
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    deadlineAt: DEADLINE_AT,
  };

  const result = await reader.readForClaim(uppercaseClaim);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;

  assert.equal(result.siteId, SITE_ID);
  assert.equal(result.request.siteId, SITE_ID);
  assert.equal(result.request.requestId, REQUEST_ID);
  assert.equal(result.claim.requestId, REQUEST_ID);
  assert.equal(result.claim.leaseToken, LEASE_TOKEN);
  assert.equal(result.subject?.trackId, 42);
  assert.equal(result.frameReference, null);
  assert.match(result.contextDigest, /^[0-9a-f]{64}$/);
  assert.match(result.claimContextDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.claim), true);
  assert.equal(Object.isFrozen(result.request), true);
  assert.equal(Object.isFrozen(result.subject), true);
  assert.equal('workerId' in result, false);
  assert.equal('outcome' in result, false);
  assert.equal('authoritySnapshot' in result, false);
  assert.deepEqual(calls, [
    'tx:REPEATABLE READ',
    'sql:read_only',
    'sql:timeout',
    'sql:schema_check',
    `sql:lock:LOCK TABLE "${TEST_SCHEMA}"."site", "${TEST_SCHEMA}"."ai_observation_event", "${TEST_SCHEMA}"."zone_entry_assessment_request", "${TEST_SCHEMA}"."zone_entry_assessment_job" IN ACCESS SHARE MODE`,
    `sql:search_path:${TEST_SCHEMA}`,
    `sql:job:${REQUEST_ID}:#0`,
    `repo:request:${REQUEST_ID}`,
    `sql:site:${SITE_ID}`,
    `repo:event:${EVENT_ID}`,
    `sql:job:${REQUEST_ID}:#1`,
  ]);
});

test('projects frozen frameReference when stored v1.2 event has a single matching local FRAME URI and digest', async () => {
  const { event, request, claim } = makeFixture();
  const frameUri = `local://evidence/${STREAM_SESSION_ID}/7/${EVENT_ID}.jpg`;
  const frameSha256 = 'a'.repeat(64);
  const rawPayload = {
    ...(event.rawPayload as Record<string, unknown>),
    schemaVersion: '1.2.0',
    evidence: [{ kind: 'FRAME', uri: frameUri, sha256: frameSha256 }],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const v12Event: AiObservationEventEntity = { ...event, rawPayload, payloadHash };
  const v12Request: ZoneEntryAssessmentRequestEntity = { ...request, payloadHash };
  const { db } = makeFakeDataSource({ event: v12Event, request: v12Request });

  const result = await new Mf06ClaimContextReader(db).readForClaim(claim);
  assert.equal(result.status, 'MATCHED');
  if (result.status !== 'MATCHED') return;

  assert.deepEqual(result.frameReference, {
    eventId: EVENT_ID,
    streamSessionId: STREAM_SESSION_ID,
    sequenceNumber: 7,
    uri: frameUri,
    sha256: frameSha256,
    payloadHash,
    frameDimensions: { width: 1920, height: 1080 },
  });
  assert.equal(Object.isFrozen(result.frameReference), true);
  assert.equal(Object.isFrozen(result.frameReference?.frameDimensions), true);
});

test('rejects malformed claims, caller-injected siteId/trackId, and getter properties before opening transaction', async () => {
  const { db, calls, fixture } = makeFakeDataSource();
  const reader = new Mf06ClaimContextReader(db);

  let getterInvoked = false;
  const getterClaim = { ...fixture.claim };
  Object.defineProperty(getterClaim, 'leaseToken', {
    enumerable: true,
    get() {
      getterInvoked = true;
      return LEASE_TOKEN;
    },
  });

  const invalidCases: unknown[] = [
    null,
    { ...fixture.claim, siteId: OTHER_UUID },
    { ...fixture.claim, trackId: 999 },
    { ...fixture.claim, workerId: OTHER_UUID },
    { ...fixture.claim, requestId: 'not-a-uuid' },
    { ...fixture.claim, leaseToken: 'not-a-uuid' },
    { ...fixture.claim, headRevision: 0 },
    { ...fixture.claim, headRevision: 2147483647 },
    { ...fixture.claim, attemptCount: 0 },
    { ...fixture.claim, leaseExpiresAt: '2026-10-10T01:20:00.000Z', deadlineAt: DEADLINE_AT },
    { ...fixture.claim, leaseExpiresAt: '2026-10-10T01:05:60.000Z' },
    getterClaim,
  ];

  for (const candidate of invalidCases) {
    const res = await reader.readForClaim(candidate as Mf06JobClaim);
    assert.deepEqual(res, { status: 'UNAVAILABLE', reason: 'INVALID_CLAIM' });
  }
  assert.equal(getterInvoked, false);
  assert.equal(calls.length, 0);
});

test('rejects non-CLAIMED status, lease/revision/attempt/timestamp mismatches, and DB clock expiry before or during read', async () => {
  const { fixture } = makeFakeDataSource();
  const mismatchedRows = [
    [],
    [{ ...fixture.jobRow, status: 'PENDING' }],
    [{ ...fixture.jobRow, status: 'SUCCEEDED' }],
    [{ ...fixture.jobRow, lease_token: OTHER_UUID }],
    [{ ...fixture.jobRow, head_revision: 3 }],
    [{ ...fixture.jobRow, attempt_count: 2 }],
    [{ ...fixture.jobRow, lease_expires_at: new Date('2026-10-10T01:06:00.000Z') }],
    [{ ...fixture.jobRow, deadline_at: new Date('2026-10-10T01:16:00.000Z') }],
    [{ ...fixture.jobRow, within_window: false }],
  ];

  for (const jobRows of mismatchedRows) {
    const { db, calls } = makeFakeDataSource({ jobRows });
    const reader = new Mf06ClaimContextReader(db);
    const res = await reader.readForClaim(fixture.claim);
    assert.deepEqual(res, { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' });
    assert.equal(
      calls.some((entry) => entry.startsWith('repo:request:')),
      false,
    );
  }

  // Expiry during request/event read: initial check passes, final pre-return DB statement_timestamp check fails
  const { db: expiringDb, calls: expiringCalls } = makeFakeDataSource({
    jobRows: (pollIndex) => [{ ...fixture.jobRow, within_window: pollIndex === 0 }],
  });
  const expiredMidRead = await new Mf06ClaimContextReader(expiringDb).readForClaim(fixture.claim);
  assert.deepEqual(expiredMidRead, { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' });
  assert.equal(expiringCalls.includes(`sql:job:${REQUEST_ID}:#0`), true);
  assert.equal(expiringCalls.includes(`repo:event:${EVENT_ID}`), true);
  assert.equal(expiringCalls.includes(`sql:job:${REQUEST_ID}:#1`), true);
});

test('honors pre-aborted and midflight AbortSignal without continuing snapshot reads', async () => {
  const preAborted = new AbortController();
  preAborted.abort();
  const { db: db1, calls: calls1, fixture } = makeFakeDataSource();
  const res1 = await new Mf06ClaimContextReader(db1).readForClaim(fixture.claim, preAborted.signal);
  assert.deepEqual(res1, { status: 'UNAVAILABLE', reason: 'ABORTED' });
  assert.equal(calls1.length, 0);

  const midflight = new AbortController();
  const { db: db2, calls: calls2 } = makeFakeDataSource({
    onStep(step) {
      if (step.startsWith('sql:job:')) midflight.abort();
    },
  });
  const res2 = await new Mf06ClaimContextReader(db2).readForClaim(fixture.claim, midflight.signal);
  assert.deepEqual(res2, { status: 'UNAVAILABLE', reason: 'ABORTED' });
  assert.equal(
    calls2.some((entry) => entry.startsWith('repo:request:')),
    false,
  );
});

test('enforces selected-schema isolation, stored binding verification, and rethrows unexpected DB defects', async () => {
  const { fixture } = makeFakeDataSource();

  for (const schemaCase of [
    { schema: '' },
    { schema: 'bad\0schema' },
    { schemaMatches: false },
    { tablesPresent: false },
  ]) {
    const { db } = makeFakeDataSource(schemaCase);
    const res = await new Mf06ClaimContextReader(db).readForClaim(fixture.claim);
    assert.deepEqual(res, { status: 'UNAVAILABLE', reason: 'SCHEMA_UNAVAILABLE' });
  }

  const { db: noReqDb } = makeFakeDataSource({ request: null });
  assert.deepEqual(await new Mf06ClaimContextReader(noReqDb).readForClaim(fixture.claim), {
    status: 'UNAVAILABLE',
    reason: 'REQUEST_NOT_FOUND',
  });

  const { db: noSiteDb } = makeFakeDataSource({ siteRows: [] });
  assert.deepEqual(await new Mf06ClaimContextReader(noSiteDb).readForClaim(fixture.claim), {
    status: 'UNAVAILABLE',
    reason: 'SITE_NOT_FOUND',
  });

  const { db: noEventDb } = makeFakeDataSource({ event: null });
  assert.deepEqual(await new Mf06ClaimContextReader(noEventDb).readForClaim(fixture.claim), {
    status: 'UNAVAILABLE',
    reason: 'EVENT_NOT_FOUND',
  });

  const tamperedRequest: ZoneEntryAssessmentRequestEntity = {
    ...fixture.request,
    payloadHash: 'c'.repeat(64),
  };
  const { db: badBindingDb } = makeFakeDataSource({ request: tamperedRequest });
  assert.deepEqual(await new Mf06ClaimContextReader(badBindingDb).readForClaim(fixture.claim), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  });

  const failingDb = {
    driver: { schema: TEST_SCHEMA },
    async transaction() {
      throw new Error('driver connection lost');
    },
  } as unknown as DataSource;
  await assert.rejects(
    () => new Mf06ClaimContextReader(failingDb).readForClaim(fixture.claim),
    /driver connection lost/,
  );
});
