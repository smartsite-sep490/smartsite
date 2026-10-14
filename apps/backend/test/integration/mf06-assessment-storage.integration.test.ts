import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import {
  AiObservationEventEntity,
  CameraEntity,
  EventProcessingStatus,
  Mf06AssessmentRequestEntity,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { Mf06AssessmentRequests1791590400001 } from '../../src/database/migrations/1791590400001-Mf06AssessmentRequests.js';
import { parseNormalizedCapturedAt } from '../../src/common/parse-normalized-captured-at.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());
const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
const person = (trackId = 7, boundingBox: unknown = box) => ({
  type: 'PERSON',
  trackId,
  boundingBox,
});
const regionId = '44444444-4444-4444-8444-444444444444';
const entry = (trackId = 7) => ({ type: 'ZONE_ENTRY', trackId, regionId, geometryVersion: 3 });
type Row = Record<string, unknown>;
type Query = (sql: string, parameters?: unknown[]) => Promise<unknown>;
const query: Query = (sql, parameters) => db.query(sql, parameters);
const requestColumns = [
  'request_id',
  'event_id',
  'payload_hash',
  'person_observation_index',
  'zone_observation_index',
  'subject_binding_status',
  'track_id',
  'site_id',
  'camera_id',
  'camera_external_id',
  'stream_session_id',
  'region_id',
  'geometry_version',
  'zone_id',
  'captured_at',
  'requested_purpose',
  'request_revision',
  'binding_hash',
  'requested_at',
];
const jobColumns = [
  'request_id',
  'status',
  'attempt_count',
  'head_revision',
  'lease_token',
  'lease_expires_at',
  'next_attempt_at',
  'deadline_at',
  'last_error_code',
  'created_at',
  'updated_at',
];
function insert(
  table: 'mf06_assessment_request' | 'mf06_assessment_job',
  row: Row,
  execute = query,
) {
  // Only test-owned whitelisted identifiers; values always remain parameterized.
  const columns = (table === 'mf06_assessment_request' ? requestColumns : jobColumns).filter(
    (column) => Object.hasOwn(row, column),
  );
  assert.equal(columns.length, Object.keys(row).length);
  return execute(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
    columns.map((column) => row[column]),
  );
}
async function rejectsSql(action: Promise<unknown>, code = '23514') {
  await assert.rejects(action, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}
async function fixture(
  observations: unknown[] = [person(), entry()],
  captured = '2026-10-10T00:00:00.123Z',
) {
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    eventId = randomUUID(),
    externalId = randomUUID(),
    session = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic storage Site' });
  await db
    .getRepository(CameraEntity)
    .insert({ id: cameraId, siteId, externalId, code: cameraId, name: 'Synthetic storage Camera' });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic storage Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
  });
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: externalId,
    streamSessionId: session,
    capturedAt: captured,
    frameDimensions: { width: 640, height: 480 },
    observations,
    evidence: [],
  };
  const capturedAt = parseNormalizedCapturedAt(captured);
  assert.ok(capturedAt);
  await db.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash: 'a'.repeat(64),
    cameraExternalId: externalId,
    resolvedCameraId: cameraId,
    streamSessionId: session,
    capturedAt,
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
  });
  function request(
    zoneIndex = observations.findIndex((value) => (value as Row)?.type === 'ZONE_ENTRY'),
  ): Row {
    const selected = selectZoneEntrySubject(raw, zoneIndex);
    assert.ok(selected.zoneEligible);
    return {
      request_id: randomUUID(),
      event_id: eventId,
      payload_hash: 'a'.repeat(64),
      person_observation_index: selected.personObservationIndex,
      zone_observation_index: zoneIndex,
      subject_binding_status: selected.subjectBindingStatus,
      track_id: selected.trackId,
      site_id: siteId,
      camera_id: cameraId,
      camera_external_id: externalId,
      stream_session_id: session,
      region_id: selected.regionId,
      geometry_version: selected.geometryVersion,
      zone_id: zoneId,
      captured_at: capturedAt,
      requested_purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      request_revision: 1,
      binding_hash: 'b'.repeat(64),
    };
  }
  return { siteId, cameraId, eventId, raw, request };
}
function job(requestId: unknown): Row {
  const created = new Date('2026-10-10T00:00:00Z');
  return {
    request_id: requestId,
    status: 'PENDING',
    attempt_count: 0,
    head_revision: 1,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: created,
    deadline_at: new Date('2026-10-10T00:01:00Z'),
    last_error_code: null,
    created_at: created,
    updated_at: created,
  };
}

test('MF06 storage registers no worker, backfill or identity assertion', async () => {
  assert.equal(await db.getRepository(Mf06AssessmentRequestEntity).count(), 0);
  assert.equal(await db.getRepository('Mf06AssessmentJobEntity').count(), 0);
  assert.equal(db.options.synchronize, false);
  assert.equal(db.options.migrationsRun, false);
  assert.ok(
    db
      .getMetadata(Mf06AssessmentRequestEntity)
      .foreignKeys.every(
        (fk) =>
          !['camera', 'camera_observation_region', 'worker', 'account_face_template'].includes(
            fk.referencedTablePath,
          ),
      ),
  );
});
test('DB subject binding matches selector for missing, ambiguous and unusable boxes', async () => {
  for (const observations of [
    [person(), entry()],
    [person(8), entry()],
    [person(), entry(), person()],
    [person(7, null), entry()],
    [person(7, { ...box, extra: 1 }), entry()],
    [person(7, { ...box, x2: 0.1 }), entry()],
    [person(7, { ...box, x1: '0.1' }), entry()],
    [person(7, { ...box, x1: -0.1 }), entry()],
    [{ type: 'PERSON', trackId: 7 }, entry()],
    [{ type: 'PPE', trackId: 7 }, { type: 'IDENTITY_CANDIDATE', trackId: 7 }, entry()],
  ]) {
    const f = await fixture(observations),
      row = f.request();
    await insert('mf06_assessment_request', row);
    const stored = await db
      .getRepository(Mf06AssessmentRequestEntity)
      .findOneByOrFail({ requestId: row.request_id as string });
    assert.equal(stored.subjectBindingStatus, row.subject_binding_status);
    assert.equal(stored.personObservationIndex, row.person_observation_index);
    assert.equal(stored.trackId, 7);
    assert.equal(stored.geometryVersion, 3);
    await rejectsSql(
      insert('mf06_assessment_request', {
        ...row,
        request_id: randomUUID(),
        subject_binding_status:
          row.subject_binding_status === 'BOUND' ? 'PERSON_NOT_FOUND' : 'BOUND',
      }),
    );
  }
});
test('request time matches ingestion precision, offsets and leap-second normalization', async () => {
  for (const captured of [
    '2026-10-10T00:00:00.999999999Z',
    '2026-10-10T00:00:00.123456789012Z',
    '2026-10-10T07:00:00.1+07:00',
    '2026-10-10t00:00:00.12z',
    '2016-12-31T23:59:60.999999999Z',
    '2026-10-10T23:00:00+23:00',
    '2026-10-10T00:00:00.000000001-23:59',
  ]) {
    const f = await fixture(undefined, captured);
    await insert('mf06_assessment_request', f.request());
  }
});
test('request metadata, indices, scope, bounds and null consistency fail closed', async () => {
  const f = await fixture(),
    row = f.request();
  const invalid: Row[] = [
    { event_id: randomUUID(), code: '23503' },
    { payload_hash: 'c'.repeat(64) },
    { camera_id: randomUUID() },
    { camera_external_id: 'wrong' },
    { stream_session_id: randomUUID() },
    { captured_at: new Date('2026-10-09T00:00:00Z') },
    { zone_observation_index: 0 },
    { zone_observation_index: -1 },
    { zone_observation_index: 256 },
    { person_observation_index: null },
    { track_id: '9007199254740992' },
    { geometry_version: 0 },
    { geometry_version: 4 },
    { region_id: randomUUID() },
    { binding_hash: 'A'.repeat(64) },
    { requested_purpose: 'LIVE_ACCESS' },
    { request_revision: 0 },
    { requested_at: 'infinity' },
    { site_id: randomUUID(), code: '23503' },
    { zone_id: randomUUID(), code: '23503' },
  ];
  for (const { code, ...patch } of invalid)
    await rejectsSql(
      insert('mf06_assessment_request', { ...row, ...patch }),
      code as string | undefined,
    );
  const other = await fixture();
  await rejectsSql(insert('mf06_assessment_request', { ...row, site_id: other.siteId }), '23503');
  for (const status of ['SKIPPED_CLOCK_SKEW', 'SKIPPED_UNKNOWN_CAMERA']) {
    await db.query('UPDATE ai_observation_event SET processing_status=$1 WHERE event_id=$2', [
      status,
      f.eventId,
    ]);
    await rejectsSql(insert('mf06_assessment_request', row));
  }
  await db.query(
    "UPDATE ai_observation_event SET processing_status='SKIPPED_NO_CANDIDATE' WHERE event_id=$1",
    [f.eventId],
  );
  await insert('mf06_assessment_request', row);
  const unresolved = await fixture();
  await db.query('UPDATE ai_observation_event SET resolved_camera_id=NULL WHERE event_id=$1', [
    unresolved.eventId,
  ]);
  await rejectsSql(insert('mf06_assessment_request', unresolved.request()));
});
test('malformed raw JSON cannot exploit missing fields or SQL NULL', async () => {
  const f = await fixture(),
    row = f.request();
  for (const payload of [
    null,
    {},
    { ...f.raw, eventId: null },
    { ...f.raw, capturedAt: 'infinity' },
    { ...f.raw, capturedAt: '2026-10-10T07:00:00+0700' },
    { ...f.raw, observations: null },
    { ...f.raw, observations: [person(), { ...entry(), regionId: null }] },
    { ...f.raw, observations: [person(), { ...entry(), geometryVersion: '3' }] },
    { ...f.raw, observations: [person(), { ...entry(), trackId: 7.5 }] },
    { ...f.raw, observations: [person(), entry(), { type: 'UNKNOWN', trackId: 7 }] },
    { ...f.raw, observations: Array.from({ length: 257 }, () => person()) },
  ]) {
    await db.query('UPDATE ai_observation_event SET raw_payload=$1::jsonb WHERE event_id=$2', [
      JSON.stringify(payload),
      f.eventId,
    ]);
    await rejectsSql(insert('mf06_assessment_request', row));
  }
});
test('null subject uniqueness and region/purpose/revision separation hold', async () => {
  for (const observations of [[entry()], [person(), entry(), person()]]) {
    const f = await fixture(observations),
      row = f.request();
    await insert('mf06_assessment_request', row);
    await rejectsSql(
      insert('mf06_assessment_request', { ...row, request_id: randomUUID() }),
      '23505',
    );
  }
  const f = await fixture([
    person(),
    entry(),
    { ...entry(), regionId: randomUUID(), geometryVersion: 9 },
  ]);
  for (const row of [
    f.request(1),
    f.request(2),
    { ...f.request(1), requested_purpose: 'RETROSPECTIVE_REVIEW' },
    { ...f.request(1), request_revision: 2 },
  ])
    await insert('mf06_assessment_request', row);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM mf06_assessment_request WHERE event_id=$1',
        [f.eventId],
      )
    )[0].count,
    4,
  );
});
test('two PERSON/Zone bindings cannot cross-assign original indices or Tracks', async () => {
  const f = await fixture([person(7), person(8, { ...box, x1: 0.6, x2: 0.9 }), entry(7), entry(8)]);
  for (const [zoneIndex, personIndex, trackId] of [
    [2, 0, 7],
    [3, 1, 8],
  ]) {
    const row = f.request(zoneIndex);
    await rejectsSql(
      insert('mf06_assessment_request', {
        ...row,
        person_observation_index: personIndex === 0 ? 1 : 0,
      }),
    );
    await rejectsSql(
      insert('mf06_assessment_request', { ...row, track_id: trackId === 7 ? 8 : 7 }),
    );
    await insert('mf06_assessment_request', row);
    const stored = await db
      .getRepository(Mf06AssessmentRequestEntity)
      .findOneByOrFail({ requestId: row.request_id as string });
    assert.equal(stored.personObservationIndex, personIndex);
    assert.equal(stored.trackId, trackId);
  }
});
test('request and source evidence resist mutation/purge; historical Camera survives deletion', async () => {
  const f = await fixture(),
    row = f.request();
  await insert('mf06_assessment_request', row);
  await rejectsSql(
    db.query('UPDATE mf06_assessment_request SET binding_hash=binding_hash WHERE request_id=$1', [
      row.request_id,
    ]),
  );
  await rejectsSql(
    db.query('DELETE FROM mf06_assessment_request WHERE request_id=$1', [row.request_id]),
  );
  await rejectsSql(db.query('TRUNCATE mf06_assessment_job, mf06_assessment_request'));
  await rejectsSql(
    db.query('DELETE FROM ai_observation_event WHERE event_id=$1', [f.eventId]),
    '23001',
  );
  for (const [column, value] of [
    ['payload_hash', 'c'.repeat(64)],
    ['raw_payload', '{}'],
    ['camera_external_id', 'wrong'],
    ['stream_session_id', randomUUID()],
    ['captured_at', '2026-10-09T00:00:00Z'],
    ['event_id', randomUUID()],
  ])
    await rejectsSql(
      db.query(`UPDATE ai_observation_event SET ${column}=$1 WHERE event_id=$2`, [
        value,
        f.eventId,
      ]),
    );
  const nextSite = await fixture();
  await db.getRepository(CameraEntity).update(f.cameraId, { siteId: nextSite.siteId });
  assert.equal(
    (
      await db
        .getRepository(Mf06AssessmentRequestEntity)
        .findOneByOrFail({ requestId: row.request_id as string })
    ).siteId,
    f.siteId,
  );
  await db.getRepository(CameraEntity).delete(f.cameraId);
  assert.equal(
    (await db.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId: f.eventId }))
      .resolvedCameraId,
    null,
  );
  const stored = await db
    .getRepository(Mf06AssessmentRequestEntity)
    .findOneByOrFail({ requestId: row.request_id as string });
  assert.equal(stored.cameraId, f.cameraId);
  assert.equal(stored.siteId, f.siteId);
  await db.query(
    "UPDATE ai_observation_event SET processing_status='SKIPPED_NO_CANDIDATE',processing_note='Synthetic operational update' WHERE event_id=$1",
    [f.eventId],
  );
  assert.equal(
    (await db.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId: f.eventId }))
      .processingNote,
    'Synthetic operational update',
  );
  const legacy = await fixture();
  await db.query('UPDATE ai_observation_event SET raw_payload=$1 WHERE event_id=$2', [
    { legacy: true },
    legacy.eventId,
  ]);
  assert.equal(
    await db.getRepository(Mf06AssessmentRequestEntity).countBy({ eventId: legacy.eventId }),
    0,
  );
});
test('job constraints reject orphans, duplicate heads, stale leases, nonfinite time and free-text errors', async () => {
  await rejectsSql(insert('mf06_assessment_job', job(randomUUID())), '23503');
  const f = await fixture(),
    row = f.request();
  await insert('mf06_assessment_request', row);
  const head = job(row.request_id);
  for (const patch of [
    { status: 'CLAIMED' },
    { status: 'CLAIMED', lease_token: randomUUID() },
    { status: 'SUCCEEDED', lease_token: randomUUID(), lease_expires_at: head.deadline_at },
    { status: 'CLAIMED', lease_token: randomUUID(), lease_expires_at: 'infinity' },
    {
      status: 'CLAIMED',
      lease_token: randomUUID(),
      lease_expires_at: new Date('2026-10-10T00:02:00Z'),
    },
    { status: 'OTHER' },
    { attempt_count: -1 },
    { head_revision: 0 },
    { next_attempt_at: 'infinity' },
    { updated_at: '-infinity' },
    { deadline_at: head.created_at },
    { last_error_code: '' },
    { last_error_code: 'database url: secret' },
    { last_error_code: ' PADDED' },
  ])
    await rejectsSql(insert('mf06_assessment_job', { ...head, ...patch }));
  await insert('mf06_assessment_job', head);
  await rejectsSql(insert('mf06_assessment_job', head), '23505');
  await rejectsSql(
    db.query('DELETE FROM mf06_assessment_job WHERE request_id=$1', [row.request_id]),
  );
  await rejectsSql(db.query('TRUNCATE mf06_assessment_job'));
  for (const assignment of [
    'head_revision=head_revision',
    'head_revision=head_revision+2',
    'head_revision=head_revision+1,attempt_count=-1',
    "head_revision=head_revision+1,created_at=created_at+interval '1 second'",
    `head_revision=head_revision+1,request_id='${randomUUID()}'`,
  ])
    await rejectsSql(
      db.query(`UPDATE mf06_assessment_job SET ${assignment} WHERE request_id=$1`, [
        row.request_id,
      ]),
    );
});
test('lease/revision CAS blocks stale completion and clamps near-deadline claim', async () => {
  const f = await fixture(),
    row = f.request(),
    head = job(row.request_id),
    token = randomUUID();
  await insert('mf06_assessment_request', row);
  await insert('mf06_assessment_job', head);
  const now = new Date('2026-10-10T00:00:59Z');
  const claimed = await db.query(
    `UPDATE mf06_assessment_job SET status='CLAIMED',attempt_count=attempt_count+1,head_revision=head_revision+1,lease_token=$2,lease_expires_at=LEAST($3::timestamptz+interval '10 seconds',deadline_at),updated_at=$3 WHERE request_id=$1 AND status='PENDING' AND head_revision=1 AND deadline_at>$3 RETURNING *`,
    [row.request_id, token, now],
  );
  assert.equal(claimed[0].length, 1);
  assert.equal(claimed[0][0].lease_expires_at.toISOString(), '2026-10-10T00:01:00.000Z');
  const stale = await db.query(
    `UPDATE mf06_assessment_job SET status='SUCCEEDED',head_revision=head_revision+1,lease_token=NULL,lease_expires_at=NULL WHERE request_id=$1 AND lease_token=$2 AND head_revision=2 RETURNING *`,
    [row.request_id, randomUUID()],
  );
  assert.equal(stale[0].length, 0);
  await db.query(
    `UPDATE mf06_assessment_job SET status='PENDING',head_revision=3,lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE request_id=$1 AND lease_token=$3 AND head_revision=2`,
    [row.request_id, now, token],
  );
  await rejectsSql(
    db.query('UPDATE mf06_assessment_job SET head_revision=4,attempt_count=0 WHERE request_id=$1', [
      row.request_id,
    ]),
  );
  const expired = await db.query(
    `UPDATE mf06_assessment_job SET status='CLAIMED',head_revision=4,lease_token=$2,lease_expires_at=deadline_at WHERE request_id=$1 AND status='PENDING' AND deadline_at>$3 RETURNING *`,
    [row.request_id, randomUUID(), head.deadline_at],
  );
  assert.equal(expired[0].length, 0);
  await db.query(
    `UPDATE mf06_assessment_job SET status='SUCCEEDED',head_revision=4,attempt_count=3,last_error_code=NULL,updated_at=$2 WHERE request_id=$1 AND head_revision=3`,
    [row.request_id, head.deadline_at],
  );
  await rejectsSql(
    db.query('UPDATE mf06_assessment_job SET head_revision=5,attempt_count=2 WHERE request_id=$1', [
      row.request_id,
    ]),
  );
});
test('concurrent null logical-key requests have exactly one winner', async () => {
  const f = await fixture([entry()]),
    row = f.request();
  const results = await Promise.allSettled([
    insert('mf06_assessment_request', row),
    insert('mf06_assessment_request', { ...row, request_id: randomUUID() }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.equal(rejected.reason.code, '23505');
});
test('expired lease reclaim changes token/revision and rejects the old claimant', async () => {
  const f = await fixture(),
    row = f.request(),
    oldToken = randomUUID(),
    nextToken = randomUUID();
  await insert('mf06_assessment_request', row);
  await insert('mf06_assessment_job', {
    ...job(row.request_id),
    status: 'CLAIMED',
    attempt_count: 1,
    head_revision: 2,
    lease_token: oldToken,
    lease_expires_at: new Date('2026-10-10T00:00:20Z'),
  });
  const reclaimed = await db.query(
    `UPDATE mf06_assessment_job SET lease_token=$2,lease_expires_at=$3,head_revision=3,attempt_count=2,updated_at=$4 WHERE request_id=$1 AND status='CLAIMED' AND head_revision=2 AND lease_expires_at<=$4 AND deadline_at>$4 RETURNING *`,
    [row.request_id, nextToken, new Date('2026-10-10T00:00:40Z'), new Date('2026-10-10T00:00:21Z')],
  );
  assert.equal(reclaimed[0].length, 1);
  const completion = `UPDATE mf06_assessment_job SET status='SUCCEEDED',head_revision=head_revision+1,lease_token=NULL,lease_expires_at=NULL,updated_at=$4 WHERE request_id=$1 AND status='CLAIMED' AND lease_token=$2 AND head_revision=$3 AND lease_expires_at>$4 AND deadline_at>$4 RETURNING *`;
  assert.equal(
    (await db.query(completion, [row.request_id, oldToken, 2, new Date('2026-10-10T00:00:22Z')]))[0]
      .length,
    0,
  );
  assert.equal(
    (
      await db.query(completion, [row.request_id, nextToken, 3, new Date('2026-10-10T00:00:41Z')])
    )[0].length,
    0,
  );
  assert.equal(
    (
      await db.query(completion, [row.request_id, nextToken, 3, new Date('2026-10-10T00:00:22Z')])
    )[0].length,
    1,
  );
});
test('two concurrent SQL claimants cannot own the same pending head', async () => {
  const f = await fixture(),
    row = f.request();
  await insert('mf06_assessment_request', row);
  await insert('mf06_assessment_job', job(row.request_id));
  const claim = (token: string) =>
    db.query(
      `UPDATE mf06_assessment_job SET status='CLAIMED',head_revision=2,attempt_count=1,lease_token=$2,lease_expires_at=$3 WHERE request_id=$1 AND status='PENDING' AND head_revision=1 AND deadline_at>$4 RETURNING *`,
      [row.request_id, token, new Date('2026-10-10T00:00:20Z'), new Date('2026-10-10T00:00:01Z')],
    );
  const claims = await Promise.all([claim(randomUUID()), claim(randomUUID())]);
  assert.deepEqual(claims.map((result) => result[0].length).sort(), [0, 1]);
});
test('safe integer transformers retain maximum Track/geometry and reject lossy values', async () => {
  const f = await fixture([
    person(Number.MAX_SAFE_INTEGER),
    { ...entry(Number.MAX_SAFE_INTEGER), geometryVersion: Number.MAX_SAFE_INTEGER },
  ]);
  const row = f.request();
  await insert('mf06_assessment_request', row);
  const stored = await db
    .getRepository(Mf06AssessmentRequestEntity)
    .findOneByOrFail({ requestId: row.request_id as string });
  assert.equal(stored.trackId, Number.MAX_SAFE_INTEGER);
  assert.equal(stored.geometryVersion, Number.MAX_SAFE_INTEGER);
  const metadata = db.getMetadata(Mf06AssessmentRequestEntity);
  for (const name of ['trackId', 'geometryVersion']) {
    const transformer = metadata.findColumnWithPropertyName(name)?.transformer;
    assert.ok(transformer && !Array.isArray(transformer));
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.1, -1, NaN, Infinity])
      assert.throws(() => transformer.to(value), RangeError);
    for (const value of ['9007199254740992', '01', '-1', '1.5'])
      assert.throws(() => transformer.from(value), RangeError);
  }
});
async function waitingForLock(pid: number) {
  const deadline = performance.now() + 1200;
  while (performance.now() < deadline) {
    if (
      (await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]))[0]
        ?.wait_event_type === 'Lock'
    )
      return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected owned transaction to wait on parent row lock');
}
for (const isolation of ['READ COMMITTED', 'SERIALIZABLE'] as const) {
  for (const first of ['request', 'parent'] as const) {
    test(`parent/request race stays consistent: ${isolation}, ${first} first`, async () => {
      const f = await fixture(),
        row = f.request(),
        a = db.createQueryRunner(),
        b = db.createQueryRunner();
      let pending: Promise<unknown> | undefined;
      try {
        await a.connect();
        await b.connect();
        await a.startTransaction(isolation);
        await b.startTransaction(isolation);
        const pid = (await b.query('SELECT pg_backend_pid() AS pid'))[0].pid;
        const change = (runner: QueryRunner) =>
          runner.query('UPDATE ai_observation_event SET payload_hash=$1 WHERE event_id=$2', [
            'c'.repeat(64),
            f.eventId,
          ]);
        if (first === 'request') {
          await insert('mf06_assessment_request', row, (sql, parameters) =>
            a.query(sql, parameters),
          );
          pending = rejectsSql(change(b), isolation === 'SERIALIZABLE' ? '40001' : '23514');
        } else {
          await change(a);
          pending = rejectsSql(
            insert('mf06_assessment_request', row, (sql, parameters) => b.query(sql, parameters)),
            isolation === 'SERIALIZABLE' ? '40001' : '23514',
          );
        }
        // Observe early failure immediately; the awaited assertion still reports it.
        void pending.catch(() => undefined);
        await waitingForLock(pid);
        await a.commitTransaction();
        await pending;
        const state = await db.query(
          'SELECT payload_hash,(SELECT count(*)::int FROM mf06_assessment_request WHERE event_id=$1) AS requests FROM ai_observation_event WHERE event_id=$1',
          [f.eventId],
        );
        assert.equal(
          state[0].payload_hash,
          first === 'request' ? row.payload_hash : 'c'.repeat(64),
        );
        assert.equal(state[0].requests, first === 'request' ? 1 : 0);
      } finally {
        try {
          if (a.isTransactionActive) await a.rollbackTransaction();
          await pending;
        } finally {
          try {
            if (b.isTransactionActive) await b.rollbackTransaction();
          } finally {
            try {
              await b.release();
            } finally {
              await a.release();
            }
          }
        }
      }
    });
  }
}
test('populated down is atomic and preserves parent immutability', async () => {
  const f = await fixture(),
    row = f.request(),
    runner = db.createQueryRunner();
  await insert('mf06_assessment_request', row);
  try {
    await rejectsSql(new Mf06AssessmentRequests1791590400001().down(runner));
    assert.ok((await db.query("SELECT to_regclass('mf06_assessment_job') AS job"))[0].job);
    await rejectsSql(
      db.query('UPDATE ai_observation_event SET payload_hash=$1 WHERE event_id=$2', [
        'c'.repeat(64),
        f.eventId,
      ]),
    );
  } finally {
    await runner.release();
  }
});
test('upgrade never backfills; empty down/up preserves earlier tables and legacy event', async (t) => {
  const upgrade = createIsolatedTestDatabase({ legacy: true });
  t.after(() => upgrade.dispose());
  const migrations = db.options.migrations;
  assert.ok(Array.isArray(migrations));
  upgrade.dataSource.setOptions({
    migrations: migrations.filter((migration) => migration !== Mf06AssessmentRequests1791590400001),
  });
  await upgrade.initialize();
  const previous = upgrade.dataSource,
    eventId = randomUUID();
  await previous.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash: 'a'.repeat(64),
    cameraExternalId: 'legacy-test',
    resolvedCameraId: null,
    streamSessionId: randomUUID(),
    capturedAt: new Date('2026-10-10T00:00:00Z'),
    rawPayload: { legacy: true },
    processingStatus: EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA,
    processingNote: null,
  });
  const tablesBefore = await previous.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name',
  );
  const zoneConstraintsBefore = await previous.query(
    "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='zone'::regclass ORDER BY conname",
  );
  const migration = new Mf06AssessmentRequests1791590400001(),
    runner = previous.createQueryRunner();
  try {
    await migration.up(runner);
    assert.equal(await previous.getRepository(Mf06AssessmentRequestEntity).count(), 0);
    await previous.query('TRUNCATE mf06_assessment_job, mf06_assessment_request');
    await migration.down(runner);
    assert.deepEqual(
      await previous.query(
        "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='zone'::regclass ORDER BY conname",
      ),
      zoneConstraintsBefore,
    );
    assert.deepEqual(
      await previous.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name',
      ),
      tablesBefore,
    );
    assert.deepEqual(
      (await previous.getRepository(AiObservationEventEntity).findOneByOrFail({ eventId }))
        .rawPayload,
      { legacy: true },
    );
    await migration.up(runner);
  } finally {
    await runner.release();
  }
});
test('request/job metadata has zero schema drift after migration', async () => {
  const { upQueries } = await db.driver.createSchemaBuilder().log();
  assert.deepEqual(
    upQueries.map((query) => query.query),
    [],
  );
});
