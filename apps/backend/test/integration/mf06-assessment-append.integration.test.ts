import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraStatus,
  EventProcessingStatus,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { parseNormalizedCapturedAt } from '../../src/common/parse-normalized-captured-at.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  type MainAuthorityArchivePayload,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { Mf06ImmutableAssessments1791590400004 } from '../../src/database/migrations/1791590400004-Mf06ImmutableAssessments.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

// -----------------------------------------------------------------------------
// Test Database & Harness Setup
// -----------------------------------------------------------------------------

const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;

before(async () => {
  await isolated.initialize();
  const runner = db.createQueryRunner();
  try {
    await new Mf06ImmutableAssessments1791590400004().up(runner);
  } finally {
    await runner.release();
  }
});

after(() => isolated.dispose());

type Row = Record<string, unknown>;
type Query = (sql: string, parameters?: unknown[]) => Promise<unknown>;
const query: Query = (sql, parameters) => db.query(sql, parameters);

const box = { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
const person = (trackId = 7, boundingBox: unknown = box) => ({
  type: 'PERSON',
  trackId,
  boundingBox,
});
const regionId = '44444444-4444-4444-8444-444444444444';
const entry = (trackId = 7) => ({ type: 'ZONE_ENTRY', trackId, regionId, geometryVersion: 3 });

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

const assessmentColumns = [
  'assessment_id',
  'request_id',
  'command_id',
  'command_hash',
  'site_id',
  'event_id',
  'binding_hash',
  'outcome',
  'reason_code',
  'evaluator_version',
  'provenance',
  'worker_id',
  'profile_revision',
  'frame_sha256',
  'crop_sha256',
  'authority_artifact_id',
  'claim_head_revision',
  'claim_lease_token',
  'assessed_at',
];

const artifactColumns = ['artifact_id', 'request_id', 'sha256', 'body', 'stored_at'];

type TableName =
  'mf06_assessment_request' | 'mf06_assessment_job' | 'mf06_assessment' | 'mf06_authority_artifact';

function insert(table: TableName, row: Row, execute = query) {
  const columnMap: Record<TableName, string[]> = {
    mf06_assessment_request: requestColumns,
    mf06_assessment_job: jobColumns,
    mf06_assessment: assessmentColumns,
    mf06_authority_artifact: artifactColumns,
  };
  const allowed = columnMap[table];
  const columns = allowed.filter((col) => Object.hasOwn(row, col));
  assert.equal(columns.length, Object.keys(row).length);
  const placeholders = columns.map((col, idx) =>
    table === 'mf06_authority_artifact' && col === 'body' ? `$${idx + 1}::jsonb` : `$${idx + 1}`,
  );
  const values = columns.map((col) =>
    table === 'mf06_authority_artifact' && col === 'body' && typeof row[col] === 'object'
      ? JSON.stringify(row[col])
      : row[col],
  );
  return execute(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders.join(',')})`,
    values,
  );
}

async function rejectsSql(action: Promise<unknown>, code = '23514') {
  await assert.rejects(action, (error: unknown) => {
    const errCode = (error as { code?: string }).code;
    assert.equal(errCode, code, `Expected SQL error code ${code} but got ${errCode}`);
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
    .insert({ id: siteId, code: siteId, name: 'Synthetic Assessment Site' });
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
  return { siteId, cameraId, zoneId, eventId, raw, request };
}

function job(requestId: unknown, overrides: Partial<Row> = {}): Row {
  const created = new Date('2026-10-10T00:00:00Z');
  return {
    request_id: requestId,
    status: 'CLAIMED',
    attempt_count: 1,
    head_revision: 2,
    lease_token: randomUUID(),
    lease_expires_at: new Date(Date.now() + 120_000),
    next_attempt_at: created,
    deadline_at: new Date(Date.now() + 300_000),
    last_error_code: null,
    created_at: created,
    updated_at: created,
    ...overrides,
  };
}

function buildValid15Sources(
  siteId: string,
  zoneId: string,
  workerId: string | null = null,
): MainAuthorityArchivePayload['sources'] {
  const contractorId = randomUUID();
  return MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => {
    let rows: Record<string, unknown>[] = [];
    switch (sourceKind) {
      case 'SITE':
        rows = [{ id: siteId, access_policy_version: 1 }];
        break;
      case 'ZONE_POLICY':
        rows = [
          {
            id: zoneId,
            site_id: siteId,
            restriction_policy: 'AUTHORIZATION_REQUIRED',
            required_ppe: [],
            configuration_locked: false,
          },
        ];
        break;
      case 'WORKER':
        if (workerId !== null) {
          rows = [
            {
              id: workerId,
              site_id: siteId,
              contractor_id: contractorId,
              user_id: null,
              is_active: true,
            },
          ];
        }
        break;
      default:
        rows = [];
        break;
    }
    return {
      sourceKind,
      tableName,
      fields,
      rows,
    };
  });
}

interface ArtifactFixture {
  row: Row;
  payload: MainAuthorityArchivePayload;
  envelope: {
    format: typeof MAIN_AUTHORITY_ARCHIVE_FORMAT;
    sha256: string;
    payload: MainAuthorityArchivePayload;
  };
}

function artifact(
  requestId: string,
  siteId: string,
  zoneId: string,
  workerId: string | null = null,
  overrides: Partial<Row> = {},
): ArtifactFixture {
  const artifactId = randomUUID();
  const sources = buildValid15Sources(siteId, zoneId, workerId);
  const payload: MainAuthorityArchivePayload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context: {
      siteId,
      zoneId,
      workerId,
      capturedAt: '2026-10-10T00:00:00.123000+00:00',
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    },
    archivedAt: '2026-10-10T00:00:00.200000+00:00',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-10-10T00:00:00.000000+00:00',
      declaredWriterManifestHash: '0'.repeat(64),
      sourceRegistryHash: '1'.repeat(64),
      snapshotHash: '2'.repeat(64),
    },
    sources,
  };
  const sha256 = computeCanonicalPayloadHash(payload);
  const envelope = {
    format: MAIN_AUTHORITY_ARCHIVE_FORMAT as typeof MAIN_AUTHORITY_ARCHIVE_FORMAT,
    sha256,
    payload,
  };
  const row: Row = {
    artifact_id: artifactId,
    request_id: requestId,
    sha256,
    body: envelope,
    ...overrides,
  };
  return { row, payload, envelope };
}

function assessment(
  requestId: string,
  siteId: string,
  eventId: string,
  bindingHash: string,
  leaseToken: string,
  headRevision = 2,
  overrides: Partial<Row> = {},
): Row {
  return {
    assessment_id: randomUUID(),
    request_id: requestId,
    command_id: randomUUID(),
    command_hash: 'c'.repeat(64),
    site_id: siteId,
    event_id: eventId,
    binding_hash: bindingHash,
    outcome: 'UNAVAILABLE',
    reason_code: 'IDENTITY_UNAVAILABLE',
    evaluator_version: '1.0.0',
    provenance: 'UNAVAILABLE',
    worker_id: null,
    profile_revision: null,
    frame_sha256: null,
    crop_sha256: null,
    authority_artifact_id: null,
    claim_head_revision: headRevision,
    claim_lease_token: leaseToken,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Test Suite: MF06 Immutable Assessment Append & Job Finalization
// -----------------------------------------------------------------------------

test('1. B2 migration creates mf06_assessment and mf06_authority_artifact with zero rows and proper keys', async () => {
  const tblAssess = (await db.query("SELECT to_regclass('mf06_assessment') AS tbl")) as Row[];
  assert.ok(tblAssess[0]);
  assert.ok(tblAssess[0].tbl);

  const tblArtifact = (await db.query(
    "SELECT to_regclass('mf06_authority_artifact') AS tbl",
  )) as Row[];
  assert.ok(tblArtifact[0]);
  assert.ok(tblArtifact[0].tbl);

  const cntAssess = (await db.query('SELECT count(*)::int AS count FROM mf06_assessment')) as Row[];
  assert.ok(cntAssess[0]);
  assert.equal(cntAssess[0].count, 0);

  const cntArtifact = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_authority_artifact',
  )) as Row[];
  assert.ok(cntArtifact[0]);
  assert.equal(cntArtifact[0].count, 0);

  const fks = (await db.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
      AND tc.table_name IN ('mf06_assessment', 'mf06_authority_artifact')
  `)) as Row[];

  assert.ok(
    fks.some(
      (fk) =>
        fk.table_name === 'mf06_assessment' &&
        fk.column_name === 'request_id' &&
        fk.foreign_table_name === 'mf06_assessment_request',
    ),
    'mf06_assessment must have FK referencing mf06_assessment_request(request_id)',
  );
  assert.ok(
    fks.some(
      (fk) =>
        fk.table_name === 'mf06_authority_artifact' &&
        fk.column_name === 'request_id' &&
        fk.foreign_table_name === 'mf06_assessment_request',
    ),
    'mf06_authority_artifact must have FK referencing mf06_assessment_request(request_id)',
  );
});

test('2. UNAVAILABLE assessment without artifact successfully appends and atomically transitions job to SUCCEEDED', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  const j = job(req.request_id, { lease_token: token, head_revision: 2, attempt_count: 1 });
  await insert('mf06_assessment_job', j);

  const assess = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    token,
    2,
  );
  await insert('mf06_assessment', assess);

  const storedRows = (await db.query('SELECT * FROM mf06_assessment WHERE assessment_id=$1', [
    assess.assessment_id,
  ])) as Row[];
  assert.ok(storedRows[0]);
  assert.equal(storedRows[0].outcome, 'UNAVAILABLE');
  assert.equal(storedRows[0].reason_code, 'IDENTITY_UNAVAILABLE');
  assert.equal(storedRows[0].provenance, 'UNAVAILABLE');
  assert.equal(storedRows[0].worker_id, null);
  assert.equal(storedRows[0].authority_artifact_id, null);
  assert.ok(storedRows[0].assessed_at, 'assessed_at must be populated by DB clock default');

  const jobAfterRows = (await db.query('SELECT * FROM mf06_assessment_job WHERE request_id=$1', [
    req.request_id,
  ])) as Row[];
  assert.ok(jobAfterRows[0]);
  assert.equal(jobAfterRows[0].status, 'SUCCEEDED');
  assert.equal(jobAfterRows[0].head_revision, 3);
  assert.equal(jobAfterRows[0].lease_token, null);
  assert.equal(jobAfterRows[0].lease_expires_at, null);
  assert.equal(
    jobAfterRows[0].attempt_count,
    1,
    'attempt_count must remain unchanged on CAS SUCCEEDED',
  );
});

test('3. AUTHORIZED assessment with valid authority artifact atomically appends and CAS transitions job', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  const j = job(req.request_id, { lease_token: token, head_revision: 2, attempt_count: 2 });
  await insert('mf06_assessment_job', j);

  const workerId = randomUUID();
  const art = artifact(req.request_id as string, f.siteId, f.zoneId, workerId);
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();

    await insert('mf06_authority_artifact', art.row, (sql, p) => runner.query(sql, p));
    const assess = assessment(
      req.request_id as string,
      f.siteId,
      f.eventId,
      req.binding_hash as string,
      token,
      2,
      {
        outcome: 'ALLOWED',
        reason_code: 'AUTHORIZED',
        provenance: 'TRUSTED_SERVICE',
        worker_id: workerId,
        profile_revision: randomUUID(),
        frame_sha256: 'd'.repeat(64),
        crop_sha256: 'e'.repeat(64),
        authority_artifact_id: art.row.artifact_id,
      },
    );
    await insert('mf06_assessment', assess, (sql, p) => runner.query(sql, p));

    await runner.commitTransaction();

    const storedArtRows = (await db.query(
      'SELECT * FROM mf06_authority_artifact WHERE artifact_id=$1',
      [art.row.artifact_id],
    )) as Row[];
    assert.ok(storedArtRows[0]);
    assert.equal(storedArtRows[0].sha256, art.row.sha256);

    const storedAssessRows = (await db.query(
      'SELECT * FROM mf06_assessment WHERE assessment_id=$1',
      [assess.assessment_id],
    )) as Row[];
    assert.ok(storedAssessRows[0]);
    assert.equal(storedAssessRows[0].outcome, 'ALLOWED');
    assert.equal(storedAssessRows[0].reason_code, 'AUTHORIZED');
    assert.equal(storedAssessRows[0].authority_artifact_id, art.row.artifact_id);

    const jobAfterRows = (await db.query('SELECT * FROM mf06_assessment_job WHERE request_id=$1', [
      req.request_id,
    ])) as Row[];
    assert.ok(jobAfterRows[0]);
    assert.equal(jobAfterRows[0].status, 'SUCCEEDED');
    assert.equal(jobAfterRows[0].head_revision, 3);
    assert.equal(jobAfterRows[0].lease_token, null);
    assert.equal(jobAfterRows[0].attempt_count, 2);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('4. scope mismatch (site_id, event_id, binding_hash) rejects insert with 23514 and preserves job CLAIMED', async () => {
  const fA = await fixture();
  const reqA = fA.request();
  await insert('mf06_assessment_request', reqA);
  const token = randomUUID();
  await insert('mf06_assessment_job', job(reqA.request_id, { lease_token: token }));

  const fB = await fixture();
  const reqB = fB.request();
  await insert('mf06_assessment_request', reqB);

  const base = assessment(
    reqA.request_id as string,
    fA.siteId,
    fA.eventId,
    reqA.binding_hash as string,
    token,
    2,
  );

  // Mismatched site_id
  await rejectsSql(
    insert('mf06_assessment', {
      ...base,
      assessment_id: randomUUID(),
      command_id: randomUUID(),
      site_id: fB.siteId,
    }),
  );
  // Mismatched event_id
  await rejectsSql(
    insert('mf06_assessment', {
      ...base,
      assessment_id: randomUUID(),
      command_id: randomUUID(),
      event_id: fB.eventId,
    }),
  );
  // Mismatched binding_hash
  await rejectsSql(
    insert('mf06_assessment', {
      ...base,
      assessment_id: randomUUID(),
      command_id: randomUUID(),
      binding_hash: 'f'.repeat(64),
    }),
  );

  const jobStateRows = (await db.query(
    'SELECT status, head_revision, lease_token FROM mf06_assessment_job WHERE request_id=$1',
    [reqA.request_id],
  )) as Row[];
  assert.ok(jobStateRows[0]);
  assert.equal(jobStateRows[0].status, 'CLAIMED');
  assert.equal(jobStateRows[0].head_revision, 2);
  assert.equal(jobStateRows[0].lease_token, token);

  const assessCountRows = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id=$1',
    [reqA.request_id],
  )) as Row[];
  assert.ok(assessCountRows[0]);
  assert.equal(assessCountRows[0].count, 0);
});

test('5. outcome and reason_code matrix strictly enforces allowed pairs and rejects cross-combinations', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));

  const base = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    token,
    2,
  );

  const invalidPairs: [string, string][] = [
    ['ALLOWED', 'POLICY_PROHIBITED'],
    ['ALLOWED', 'UNAUTHORIZED'],
    ['ALLOWED', 'INVALID_BINDING'],
    ['ALLOWED', 'IDENTITY_UNAVAILABLE'],
    ['DENIED', 'POLICY_NONE'],
    ['DENIED', 'AUTHORIZED'],
    ['DENIED', 'MEDIA_UNAVAILABLE'],
    ['DENIED', 'PROFILE_REVOKED'],
    ['UNAVAILABLE', 'POLICY_NONE'],
    ['UNAVAILABLE', 'POLICY_PROHIBITED'],
    ['UNAVAILABLE', 'AUTHORIZED'],
    ['UNAVAILABLE', 'UNAUTHORIZED'],
  ];

  for (const [outcome, reason_code] of invalidPairs) {
    await rejectsSql(
      insert('mf06_assessment', {
        ...base,
        assessment_id: randomUUID(),
        command_id: randomUUID(),
        outcome,
        reason_code,
      }),
    );
  }

  const unavailableReasons = [
    'INVALID_BINDING',
    'IDENTITY_UNAVAILABLE',
    'MEDIA_UNAVAILABLE',
    'PROFILE_REVOKED',
    'AUTHORITY_UNAVAILABLE',
    'SERVICE_DISABLED',
    'ABORTED',
  ];
  for (const reason_code of unavailableReasons) {
    const fSub = await fixture();
    const rSub = fSub.request();
    await insert('mf06_assessment_request', rSub);
    const tok = randomUUID();
    await insert('mf06_assessment_job', job(rSub.request_id, { lease_token: tok }));
    await insert(
      'mf06_assessment',
      assessment(
        rSub.request_id as string,
        fSub.siteId,
        fSub.eventId,
        rSub.binding_hash as string,
        tok,
        2,
        {
          outcome: 'UNAVAILABLE',
          reason_code,
        },
      ),
    );
  }
});

test('6. identity-dependent rows reject each missing field against an existing valid artifact, with a valid rollback control', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));

  const workerId = randomUUID();
  const art = artifact(req.request_id as string, f.siteId, f.zoneId, workerId);
  const basePositive = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    token,
    2,
    {
      outcome: 'ALLOWED',
      reason_code: 'AUTHORIZED',
      provenance: 'TRUSTED_SERVICE',
      worker_id: workerId,
      profile_revision: randomUUID(),
      frame_sha256: 'a'.repeat(64),
      crop_sha256: 'b'.repeat(64),
      authority_artifact_id: art.row.artifact_id,
    },
  );

  const missingFields: Partial<Row>[] = [
    { worker_id: null },
    { profile_revision: null },
    { frame_sha256: null },
    { crop_sha256: null },
    { authority_artifact_id: null },
    { provenance: 'UNAVAILABLE' },
  ];

  for (const [outcome, reason_code] of [
    ['ALLOWED', 'AUTHORIZED'],
    ['DENIED', 'UNAUTHORIZED'],
  ]) {
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const execute: Query = (sql, params) => runner.query(sql, params);
      await insert('mf06_authority_artifact', art.row, execute);
      await runner.query('SAVEPOINT valid_control');
      await insert('mf06_assessment', { ...basePositive, outcome, reason_code }, execute);
      const completed = (await runner.query(
        'SELECT status FROM mf06_assessment_job WHERE request_id=$1',
        [req.request_id],
      )) as Row[];
      assert.ok(completed[0]);
      assert.equal(completed[0].status, 'SUCCEEDED');
      await runner.query('ROLLBACK TO SAVEPOINT valid_control');
      for (const patch of missingFields) {
        await runner.query('SAVEPOINT invalid_field');
        await rejectsSql(
          insert('mf06_assessment', { ...basePositive, outcome, reason_code, ...patch }, execute),
        );
        await runner.query('ROLLBACK TO SAVEPOINT invalid_field');
      }
      await runner.rollbackTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
});

test('7. artifact binds the canonical SHA reference, scope, envelope, and deferred attachment', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);

  const art = artifact(req.request_id as string, f.siteId, f.zoneId);

  // Mismatched sha256
  await rejectsSql(
    insert('mf06_authority_artifact', {
      ...art.row,
      artifact_id: randomUUID(),
      sha256: '0'.repeat(64),
      body: { ...art.envelope, sha256: '0'.repeat(64) },
    }),
  );

  // Mismatched context.siteId in payload body inside envelope
  const otherSite = randomUUID();
  const mismatchedPayload: MainAuthorityArchivePayload = {
    ...art.payload,
    context: { ...art.payload.context, siteId: otherSite },
  };
  const mismatchedSha256 = computeCanonicalPayloadHash(mismatchedPayload);
  const mismatchedEnvelope = {
    format: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    sha256: mismatchedSha256,
    payload: mismatchedPayload,
  };
  await rejectsSql(
    insert('mf06_authority_artifact', {
      ...art.row,
      artifact_id: randomUUID(),
      sha256: mismatchedSha256,
      body: mismatchedEnvelope,
    }),
  );

  // Deferred orphan artifact guard: inserting artifact without assessment referencing it rolls back at commit
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    const orphanArt = artifact(req.request_id as string, f.siteId, f.zoneId);
    await insert('mf06_authority_artifact', orphanArt.row, (sql, p) => runner.query(sql, p));
    await rejectsSql(runner.commitTransaction(), '23514');
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }

  // Insert valid artifact and associate with assessment to test immutability
  const validRunner = db.createQueryRunner();
  try {
    await validRunner.connect();
    await validRunner.startTransaction();
    const token = randomUUID();
    await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }), (sql, p) =>
      validRunner.query(sql, p),
    );
    await insert('mf06_authority_artifact', art.row, (sql, p) => validRunner.query(sql, p));
    const assess = assessment(
      req.request_id as string,
      f.siteId,
      f.eventId,
      req.binding_hash as string,
      token,
      2,
      {
        authority_artifact_id: art.row.artifact_id,
      },
    );
    await insert('mf06_assessment', assess, (sql, p) => validRunner.query(sql, p));
    await validRunner.commitTransaction();

    await rejectsSql(
      db.query('UPDATE mf06_authority_artifact SET sha256=$1 WHERE artifact_id=$2', [
        '9'.repeat(64),
        art.row.artifact_id,
      ]),
    );
    await rejectsSql(
      db.query('DELETE FROM mf06_authority_artifact WHERE artifact_id=$1', [art.row.artifact_id]),
    );
    await rejectsSql(db.query('TRUNCATE mf06_assessment,mf06_authority_artifact'));
  } finally {
    if (validRunner.isTransactionActive) await validRunner.rollbackTransaction();
    await validRunner.release();
  }
});

test('8. finalize insert validates job status CLAIMED, matching lease token/revision, and clock before deadline/lease', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);

  // Job is PENDING (start head 1)
  const pendingJob = job(req.request_id, {
    status: 'PENDING',
    head_revision: 1,
    lease_token: null,
    lease_expires_at: null,
  });
  await insert('mf06_assessment_job', pendingJob);
  const assess = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    randomUUID(),
    1,
  );
  await rejectsSql(insert('mf06_assessment', assess));

  // Update job from PENDING to CLAIMED with tokenA and increment head to 2
  const tokenA = randomUUID();
  const claimExpires = new Date(Date.now() + 60_000);
  await db.query(
    "UPDATE mf06_assessment_job SET status='CLAIMED', head_revision=2, lease_token=$2, lease_expires_at=$3 WHERE request_id=$1",
    [req.request_id, tokenA, claimExpires],
  );

  // Mismatched token
  await rejectsSql(
    insert('mf06_assessment', {
      ...assess,
      claim_lease_token: randomUUID(),
      claim_head_revision: 2,
    }),
  );

  // Mismatched revision
  await rejectsSql(
    insert('mf06_assessment', { ...assess, claim_lease_token: tokenA, claim_head_revision: 3 }),
  );

  // Lease expired: increment head from 2 to 3, and set lease_expires_at in past
  await db.query(
    "UPDATE mf06_assessment_job SET head_revision=3, lease_expires_at=statement_timestamp() - interval '10 seconds' WHERE request_id=$1",
    [req.request_id],
  );
  await rejectsSql(
    insert('mf06_assessment', { ...assess, claim_lease_token: tokenA, claim_head_revision: 3 }),
  );

  // Deadline expired: use separate historical fixture with valid relative times
  const pastCaptured = '2020-01-01T00:00:00.000Z';
  const fPast = await fixture(undefined, pastCaptured);
  const reqPast = fPast.request();
  await insert('mf06_assessment_request', reqPast);

  const pastCreated = new Date('2020-01-01T00:00:01Z');
  const pastDeadline = new Date('2020-01-01T00:01:00Z');
  const pastLeaseExpires = new Date('2020-01-01T00:00:30Z');
  const pastToken = randomUUID();

  await insert(
    'mf06_assessment_job',
    job(reqPast.request_id, {
      status: 'CLAIMED',
      head_revision: 1,
      lease_token: pastToken,
      lease_expires_at: pastLeaseExpires,
      created_at: pastCreated,
      updated_at: pastCreated,
      deadline_at: pastDeadline,
    }),
  );

  const assessPast = assessment(
    reqPast.request_id as string,
    fPast.siteId,
    fPast.eventId,
    reqPast.binding_hash as string,
    pastToken,
    1,
  );
  await rejectsSql(insert('mf06_assessment', assessPast));
});

test('9. concurrent writers attempting append on same claim lease produce exactly one winner and one rolled-back loser', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const runnerA = db.createQueryRunner();
  const runnerB = db.createQueryRunner();
  try {
    await runnerA.connect();
    await runnerB.connect();
    await runnerA.startTransaction();
    await runnerB.startTransaction();

    const assessA = assessment(
      req.request_id as string,
      f.siteId,
      f.eventId,
      req.binding_hash as string,
      token,
      2,
      {
        command_id: randomUUID(),
      },
    );
    const assessB = assessment(
      req.request_id as string,
      f.siteId,
      f.eventId,
      req.binding_hash as string,
      token,
      2,
      {
        command_id: randomUUID(),
      },
    );

    const results = await Promise.allSettled([
      (async () => {
        await insert('mf06_assessment', assessA, (sql, p) => runnerA.query(sql, p));
        await runnerA.commitTransaction();
      })(),
      (async () => {
        await insert('mf06_assessment', assessB, (sql, p) => runnerB.query(sql, p));
        await runnerB.commitTransaction();
      })(),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Exactly one concurrent writer must succeed');
    assert.equal(rejected.length, 1, 'Exactly one concurrent writer must fail');

    const totalRows = (await db.query(
      'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id=$1',
      [req.request_id],
    )) as Row[];
    assert.ok(totalRows[0]);
    assert.equal(totalRows[0].count, 1, 'Only one assessment row was committed');

    const jobStateRows = (await db.query(
      'SELECT status, head_revision, lease_token FROM mf06_assessment_job WHERE request_id=$1',
      [req.request_id],
    )) as Row[];
    assert.ok(jobStateRows[0]);
    assert.equal(jobStateRows[0].status, 'SUCCEEDED');
    assert.equal(jobStateRows[0].head_revision, 3);
    assert.equal(jobStateRows[0].lease_token, null);
  } finally {
    if (runnerA.isTransactionActive) await runnerA.rollbackTransaction();
    if (runnerB.isTransactionActive) await runnerB.rollbackTransaction();
    await runnerA.release();
    await runnerB.release();
  }
});

test('10. assessment rows are append-only; updates, deletes, and subsequent job modifications are rejected', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );
  const assess = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    token,
    2,
  );
  await insert('mf06_assessment', assess);

  await rejectsSql(
    db.query("UPDATE mf06_assessment SET evaluator_version='2.0.0' WHERE assessment_id=$1", [
      assess.assessment_id,
    ]),
  );
  await rejectsSql(
    db.query('DELETE FROM mf06_assessment WHERE assessment_id=$1', [assess.assessment_id]),
  );
  await rejectsSql(db.query('TRUNCATE mf06_assessment'));

  await rejectsSql(
    db.query("UPDATE mf06_assessment_job SET status='PENDING' WHERE request_id=$1", [
      req.request_id,
    ]),
  );
  await rejectsSql(
    db.query('UPDATE mf06_assessment_job SET head_revision=head_revision+1 WHERE request_id=$1', [
      req.request_id,
    ]),
  );
  await rejectsSql(
    db.query('DELETE FROM mf06_assessment_job WHERE request_id=$1', [req.request_id]),
  );
});

test('11. unique constraints prevent duplicate assessments per request and duplicate command IDs', async () => {
  const fA = await fixture();
  const reqA = fA.request();
  await insert('mf06_assessment_request', reqA);
  const tokenA = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(reqA.request_id, { lease_token: tokenA, head_revision: 2 }),
  );
  const cmdA = randomUUID();
  const assessA = assessment(
    reqA.request_id as string,
    fA.siteId,
    fA.eventId,
    reqA.binding_hash as string,
    tokenA,
    2,
    {
      command_id: cmdA,
    },
  );
  await insert('mf06_assessment', assessA);

  // Attempt second assessment for same request (job is SUCCEEDED, rejected 23514 by guard before unique)
  await rejectsSql(
    insert('mf06_assessment', {
      ...assessA,
      assessment_id: randomUUID(),
      command_id: randomUUID(),
    }),
    '23514',
  );

  // Attempt assessment for request B with duplicate command_id (job B is CLAIMED, fails unique index 23505)
  const fB = await fixture();
  const reqB = fB.request();
  await insert('mf06_assessment_request', reqB);
  const tokenB = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(reqB.request_id, { lease_token: tokenB, head_revision: 2 }),
  );
  await rejectsSql(
    insert(
      'mf06_assessment',
      assessment(
        reqB.request_id as string,
        fB.siteId,
        fB.eventId,
        reqB.binding_hash as string,
        tokenB,
        2,
        {
          command_id: cmdA,
        },
      ),
    ),
    '23505',
  );
});

test('12. live camera deactivation or zone policy update does not mutate historical assessment record', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );
  const assess = assessment(
    req.request_id as string,
    f.siteId,
    f.eventId,
    req.binding_hash as string,
    token,
    2,
  );
  await insert('mf06_assessment', assess);

  await db.getRepository(CameraEntity).update(f.cameraId, {
    status: CameraStatus.INACTIVE,
    externalId: 'CAM-MUTATED',
  });
  await db.getRepository(ZoneEntity).update(f.zoneId, {
    name: 'Renamed Zone',
  });

  const storedAssessRows = (await db.query('SELECT * FROM mf06_assessment WHERE assessment_id=$1', [
    assess.assessment_id,
  ])) as Row[];
  assert.ok(storedAssessRows[0]);
  assert.equal(storedAssessRows[0].site_id, f.siteId);
  assert.equal(storedAssessRows[0].event_id, f.eventId);
  assert.equal(storedAssessRows[0].binding_hash, req.binding_hash);

  const storedReqRows = (await db.query(
    'SELECT * FROM mf06_assessment_request WHERE request_id=$1',
    [req.request_id],
  )) as Row[];
  assert.ok(storedReqRows[0]);
  assert.equal(storedReqRows[0].camera_external_id, f.raw.cameraExternalId);
  assert.equal(storedReqRows[0].site_id, f.siteId);
});

test('archive rejects null declarations immediately, rather than relying on an orphan commit failure', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const art = artifact(req.request_id as string, f.siteId, f.zoneId);
  const mutations: Array<(body: Record<string, unknown>) => void> = [
    ...[
      'epochId',
      'capturedAt',
      'declaredWriterManifestHash',
      'sourceRegistryHash',
      'snapshotHash',
    ].map((key) => (body: Record<string, unknown>) => {
      ((body.payload as Row).baseline as Row)[key] = null;
    }),
    (body) => {
      (body.payload as Row).archivedAt = null;
    },
    (body) => {
      ((body.payload as Row).context as Row).workerId = 1;
    },
    (body) => {
      ((body.payload as Row).context as Row).capturedAt = null;
    },
  ];
  for (const mutate of mutations) {
    const body = structuredClone(art.envelope) as unknown as Row;
    mutate(body);
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      await rejectsSql(
        insert(
          'mf06_authority_artifact',
          { ...art.row, artifact_id: randomUUID(), body },
          (sql, params) => runner.query(sql, params),
        ),
      );
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
});

test('rollback discards assessment, attached archive, and finalization head together', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const art = artifact(req.request_id as string, f.siteId, f.zoneId);
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    const execute: Query = (sql, params) => runner.query(sql, params);
    await insert('mf06_authority_artifact', art.row, execute);
    await insert(
      'mf06_assessment',
      assessment(
        req.request_id as string,
        f.siteId,
        f.eventId,
        req.binding_hash as string,
        token,
        2,
        { authority_artifact_id: art.row.artifact_id },
      ),
      execute,
    );
    const inside = (await runner.query(
      'SELECT status FROM mf06_assessment_job WHERE request_id=$1',
      [req.request_id],
    )) as Row[];
    assert.ok(inside[0]);
    assert.equal(inside[0].status, 'SUCCEEDED');
    await runner.rollbackTransaction();
    const rows = (await db.query(
      `SELECT status, head_revision, lease_token,
      (SELECT count(*)::int FROM mf06_assessment WHERE request_id=$1) AS assessments,
      (SELECT count(*)::int FROM mf06_authority_artifact WHERE request_id=$1) AS artifacts
      FROM mf06_assessment_job WHERE request_id=$1`,
      [req.request_id],
    )) as Row[];
    assert.ok(rows[0]);
    assert.deepEqual(rows[0], {
      status: 'CLAIMED',
      head_revision: 2,
      lease_token: token,
      assessments: 0,
      artifacts: 0,
    });
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('lease expiring after the BEFORE guard rejects the AFTER CAS and rolls back the append', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  // Test-only trigger ordered after the production BEFORE guard, limited to this request.
  await db.query(`CREATE FUNCTION mf06_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.request_id='${req.request_id}'::uuid THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$;
    CREATE TRIGGER zz_test_delay BEFORE INSERT ON mf06_assessment FOR EACH ROW EXECUTE FUNCTION mf06_test_delay()`);
  try {
    await db.query(
      "UPDATE mf06_assessment_job SET lease_expires_at=clock_timestamp()+interval '250 milliseconds',head_revision=3 WHERE request_id=$1",
      [req.request_id],
    );
    await assert.rejects(
      insert(
        'mf06_assessment',
        assessment(
          req.request_id as string,
          f.siteId,
          f.eventId,
          req.binding_hash as string,
          token,
          3,
        ),
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, '23514');
        assert.match((error as Error).message, /lease expired during append/);
        return true;
      },
    );
    const rows = (await db.query(
      `SELECT status,head_revision,lease_token,
      (SELECT count(*)::int FROM mf06_assessment WHERE request_id=$1) AS assessments
      FROM mf06_assessment_job WHERE request_id=$1`,
      [req.request_id],
    )) as Row[];
    assert.ok(rows[0]);
    assert.deepEqual(rows[0], {
      status: 'CLAIMED',
      head_revision: 3,
      lease_token: token,
      assessments: 0,
    });
  } finally {
    await db.query(
      'DROP TRIGGER zz_test_delay ON mf06_assessment; DROP FUNCTION mf06_test_delay()',
    );
  }
});

test('13. migration down atomically refuses when populated, and cleanly drops tables and triggers when empty', async (t) => {
  const runner = db.createQueryRunner();
  try {
    await rejectsSql(new Mf06ImmutableAssessments1791590400004().down(runner), '23514');
    const tblAssess = (await db.query("SELECT to_regclass('mf06_assessment') AS tbl")) as Row[];
    assert.ok(tblAssess[0]);
    assert.ok(tblAssess[0].tbl);

    const tblArtifact = (await db.query(
      "SELECT to_regclass('mf06_authority_artifact') AS tbl",
    )) as Row[];
    assert.ok(tblArtifact[0]);
    assert.ok(tblArtifact[0].tbl);
  } finally {
    await runner.release();
  }

  const upgrade = createIsolatedTestDatabase({ legacy: true });
  t.after(() => upgrade.dispose());
  await upgrade.initialize();
  const upgradeRunner = upgrade.dataSource.createQueryRunner();
  try {
    const migration = new Mf06ImmutableAssessments1791590400004();
    await migration.up(upgradeRunner);
    const tblAssessUp = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_assessment') AS tbl",
    )) as Row[];
    assert.ok(tblAssessUp[0]);
    assert.ok(tblAssessUp[0].tbl);

    const tblArtifactUp = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_authority_artifact') AS tbl",
    )) as Row[];
    assert.ok(tblArtifactUp[0]);
    assert.ok(tblArtifactUp[0].tbl);

    await migration.down(upgradeRunner);
    const tblAssessDown = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_assessment') AS tbl",
    )) as Row[];
    assert.ok(tblAssessDown[0]);
    assert.equal(tblAssessDown[0].tbl, null);

    const tblArtifactDown = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_authority_artifact') AS tbl",
    )) as Row[];
    assert.ok(tblArtifactDown[0]);
    assert.equal(tblArtifactDown[0].tbl, null);

    const procs = (await upgrade.dataSource.query(`
      SELECT proname FROM pg_proc
      JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = current_schema()
        AND proname LIKE 'mf06_%'
        AND proname NOT IN (
          'mf06_request_person_box_valid',
          'mf06_request_insert_guard',
          'mf06_request_immutable_guard',
          'mf06_storage_truncate_guard',
          'mf06_request_parent_guard',
          'mf06_job_head_guard'
        )
    `)) as Row[];
    assert.equal(procs.length, 0, 'Candidate migration functions must be cleanly dropped on down');

    await migration.up(upgradeRunner);
    const tblAssessReup = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_assessment') AS tbl",
    )) as Row[];
    assert.ok(tblAssessReup[0]);
    assert.ok(tblAssessReup[0].tbl);

    const tblArtifactReup = (await upgrade.dataSource.query(
      "SELECT to_regclass('mf06_authority_artifact') AS tbl",
    )) as Row[];
    assert.ok(tblArtifactReup[0]);
    assert.ok(tblArtifactReup[0].tbl);
  } finally {
    await upgradeRunner.release();
  }
});
