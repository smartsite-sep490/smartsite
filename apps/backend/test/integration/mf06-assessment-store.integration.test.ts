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
  type MainAuthorityArchiveContext,
  type MainAuthorityArchivePayload,
  sealMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { Mf06ImmutableAssessments1791590400004 } from '../../src/database/migrations/1791590400004-Mf06ImmutableAssessments.js';
import {
  Mf06AssessmentStore,
  type Mf06AssessmentAppendInput,
} from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { Mf06CandidateMetadataService } from '../../src/modules/safety/assessments/mf06-candidate-metadata.service.js';
import { Mf06RequestContextReader } from '../../src/modules/safety/assessments/mf06-request-context.js';
import { bindMf06FaceInvocation } from '../../src/modules/safety/assessments/mf06-face-binding.js';
import { SafetyFaceProfileMetadataReader } from '../../src/modules/workforce/safety-face-profile.reader.js';
import { SafetyFaceProvenance1791590400003 } from '../../src/database/migrations/1791590400003-SafetyFaceProvenance.js';
import { createHash } from 'node:crypto';
import type { SafetySubjectCrop } from '../../src/modules/safety/identity/safety-subject-cropper.js';
import { ZoneEntryAssessmentEntity } from '../../src/database/entities/zone-entry-assessment.entity.js';
import { ZoneEntryAuthorityArtifactEntity } from '../../src/database/entities/zone-entry-authority-artifact.entity.js';

// -----------------------------------------------------------------------------
// Test Database & Harness Setup
// -----------------------------------------------------------------------------

const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;
const store = new Mf06AssessmentStore(db);

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

type TableName = 'mf06_assessment_request' | 'mf06_assessment_job';

function insert(table: TableName, row: Row) {
  const columnMap = {
    mf06_assessment_request: requestColumns,
    mf06_assessment_job: jobColumns,
  };
  const allowed = columnMap[table];
  const columns = allowed.filter((col) => Object.hasOwn(row, col));
  assert.equal(columns.length, Object.keys(row).length);
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  const values = columns.map((col) => row[col]);
  return db.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders.join(',')})`,
    values,
  );
}

async function fixture(
  observations: unknown[] = [person(), entry()],
  captured = '2026-10-10T00:00:00.123000Z',
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

function defaultInput(
  req: Row,
  leaseToken: string,
  headRevision = 2,
  overrides: Partial<Mf06AssessmentAppendInput> = {},
): Mf06AssessmentAppendInput {
  return {
    claim: {
      requestId: req.request_id as string,
      leaseToken,
      headRevision,
    },
    commandId: randomUUID(),
    siteId: req.site_id as string,
    bindingHash: req.binding_hash as string,
    evaluatorVersion: '1.0.0',
    outcome: 'UNAVAILABLE',
    reasonCode: 'SERVICE_DISABLED',
    provenance: 'UNAVAILABLE',
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: null,
    ...overrides,
  };
}

function buildValidPolicy15Sources(
  siteId: string,
  zoneId: string,
): MainAuthorityArchivePayload['sources'] {
  return MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => {
    let rows: Record<string, unknown>[];
    switch (sourceKind) {
      case 'SITE':
        rows = [{ id: siteId, access_policy_version: 1 }];
        break;
      case 'ZONE_POLICY':
        rows = [
          {
            id: zoneId,
            site_id: siteId,
            restriction_policy: 'NONE',
            required_ppe: [],
            configuration_locked: false,
          },
        ];
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

function sealedPolicyInput(req: Row, token: string, siteId: string, zoneId: string) {
  const context: MainAuthorityArchiveContext = {
    siteId,
    zoneId,
    workerId: null,
    capturedAt: '2026-10-10T00:00:00.123000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  };
  const payload: MainAuthorityArchivePayload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context,
    archivedAt: '2026-10-10T00:00:00.200000Z',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-10-10T00:00:00.000000Z',
      declaredWriterManifestHash: '0'.repeat(64),
      sourceRegistryHash: '1'.repeat(64),
      snapshotHash: '2'.repeat(64),
    },
    sources: buildValidPolicy15Sources(siteId, zoneId),
  };
  const sealed = sealMainAuthorityArchive(payload, context);
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw new Error('Synthetic archive fixture invalid');
  return defaultInput(req, token, 2, {
    outcome: 'ALLOWED',
    reasonCode: 'POLICY_NONE',
    provenance: 'SYNTHETIC_TEST',
    authorityArtifact: sealed.archive,
  });
}

// -----------------------------------------------------------------------------
// Test Suite: MF06 Assessment Store Service Integration
// -----------------------------------------------------------------------------

test('1. finalize appends first assessment, returns RECORDED with DB server clock, and transitions job to SUCCEEDED', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2, attempt_count: 1 }),
  );

  const input = defaultInput(req, token, 2);
  const res = await store.finalize(input);

  assert.equal(res.state, 'RECORDED');
  assert.ok('assessment' in res && res.assessment);
  const a = res.assessment;

  assert.match(a.assessmentId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(a.requestId, req.request_id);
  assert.equal(a.commandId, input.commandId);
  assert.match(a.commandHash, /^[0-9a-f]{64}$/);
  assert.equal(a.siteId, f.siteId);
  assert.equal(a.eventId, f.eventId);
  assert.equal(a.bindingHash, req.binding_hash);
  assert.equal(a.cameraId, f.cameraId);
  assert.equal(a.zoneId, f.zoneId);
  assert.equal(a.purpose, 'INITIAL_OBSERVATION_ASSESSMENT');
  assert.equal(a.evaluatorVersion, '1.0.0');
  assert.equal(a.outcome, 'UNAVAILABLE');
  assert.equal(a.reasonCode, 'SERVICE_DISABLED');
  assert.equal(a.provenance, 'UNAVAILABLE');
  assert.equal(a.workerId, null);
  assert.equal(a.profileRevision, null);
  assert.equal(a.frameSha256, null);
  assert.equal(a.cropSha256, null);
  assert.equal(a.authorityArtifact, null);

  const assessedTime = Date.parse(a.assessedAt);
  assert.ok(Number.isFinite(assessedTime));
  assert.ok(
    Math.abs(Date.now() - assessedTime) < 60_000,
    'assessedAt must reflect recent server clock',
  );

  const assessRows = (await db.query('SELECT * FROM mf06_assessment WHERE request_id = $1', [
    req.request_id,
  ])) as Row[];
  assert.ok(assessRows[0]);
  assert.equal(assessRows[0].assessment_id, a.assessmentId);
  assert.equal(assessRows[0].command_id, input.commandId);
  assert.equal(assessRows[0].outcome, 'UNAVAILABLE');
  assert.equal(assessRows[0].reason_code, 'SERVICE_DISABLED');

  const jobRows = (await db.query(
    'SELECT status, head_revision, lease_token, lease_expires_at, attempt_count FROM mf06_assessment_job WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(jobRows[0]);
  assert.equal(jobRows[0].status, 'SUCCEEDED');
  assert.equal(jobRows[0].head_revision, 3);
  assert.equal(jobRows[0].lease_token, null);
  assert.equal(jobRows[0].lease_expires_at, null);
  assert.equal(jobRows[0].attempt_count, 1);
});

test('2. same command and body returns REPLAY even after job SUCCEEDED; changed body returns CONFLICT with single DB row', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const input = defaultInput(req, token, 2);
  const res1 = await store.finalize(input);
  assert.equal(res1.state, 'RECORDED');
  assert.ok('assessment' in res1 && res1.assessment);

  // Replay with identical command and payload after job has completed
  const resReplay = await store.finalize(input);
  assert.equal(resReplay.state, 'REPLAY');
  assert.ok('assessment' in resReplay && resReplay.assessment);
  assert.equal(resReplay.assessment.assessmentId, res1.assessment.assessmentId);
  assert.equal(resReplay.assessment.commandHash, res1.assessment.commandHash);

  // Attempt same command with altered body
  const changedInput: Mf06AssessmentAppendInput = {
    ...input,
    reasonCode: 'ABORTED',
  };
  const resConflict = await store.finalize(changedInput);
  assert.equal(resConflict.state, 'CONFLICT');

  const countRows = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(countRows[0]);
  assert.equal(countRows[0].count, 1, 'Only one assessment row may exist');
});

test('3. distinct command on already-completed request yields STALE or CONFLICT without appending', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const res1 = await store.finalize(defaultInput(req, token, 2));
  assert.equal(res1.state, 'RECORDED');

  const distinctCommandInput = defaultInput(req, randomUUID(), 2);
  const res2 = await store.finalize(distinctCommandInput);
  assert.ok(
    res2.state === 'STALE' || res2.state === 'CONFLICT',
    `Expected STALE or CONFLICT but received ${res2.state}`,
  );

  const countRows = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(countRows[0]);
  assert.equal(countRows[0].count, 1, 'Must not append second assessment row');
});

test('4. mismatched site, binding hash, lease token, or head revision returns STALE or UNAVAILABLE without DB append', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  // Wrong siteId
  const resSite = await store.finalize(defaultInput(req, token, 2, { siteId: randomUUID() }));
  assert.ok(
    resSite.state === 'STALE' || resSite.state === 'UNAVAILABLE',
    `Expected STALE or UNAVAILABLE for wrong site but got ${resSite.state}`,
  );

  // Wrong bindingHash
  const resHash = await store.finalize(
    defaultInput(req, token, 2, { bindingHash: 'f'.repeat(64) }),
  );
  assert.ok(
    resHash.state === 'STALE' || resHash.state === 'UNAVAILABLE',
    `Expected STALE or UNAVAILABLE for wrong hash but got ${resHash.state}`,
  );

  // Wrong leaseToken
  const resToken = await store.finalize(defaultInput(req, randomUUID(), 2));
  assert.ok(
    resToken.state === 'STALE' || resToken.state === 'UNAVAILABLE',
    `Expected STALE or UNAVAILABLE for wrong lease token but got ${resToken.state}`,
  );

  // Wrong headRevision
  const resRev = await store.finalize(defaultInput(req, token, 99));
  assert.ok(
    resRev.state === 'STALE' || resRev.state === 'UNAVAILABLE',
    `Expected STALE or UNAVAILABLE for wrong head revision but got ${resRev.state}`,
  );

  const countRows = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(countRows[0]);
  assert.equal(countRows[0].count, 0, 'No row should be written on stale/mismatched claim');

  const jobRows = (await db.query(
    'SELECT status, head_revision FROM mf06_assessment_job WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(jobRows[0]);
  assert.equal(jobRows[0].status, 'CLAIMED');
  assert.equal(jobRows[0].head_revision, 2);
});

test('5. replay query retrieves recorded assessment when scoped correctly and returns null for mismatched site or command', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const input = defaultInput(req, token, 2);
  const res = await store.finalize(input);
  assert.equal(res.state, 'RECORDED');
  assert.ok('assessment' in res && res.assessment);

  // Matching replay query
  const found = await store.replay(req.request_id as string, input.commandId, f.siteId);
  assert.ok(found);
  assert.equal(found.assessmentId, res.assessment.assessmentId);
  assert.equal(found.commandId, input.commandId);
  assert.equal(found.siteId, f.siteId);
  assert.equal(found.requestId, req.request_id);

  // Wrong siteId
  const wrongSite = await store.replay(req.request_id as string, input.commandId, randomUUID());
  assert.equal(wrongSite, null);

  // Wrong commandId
  const wrongCmd = await store.replay(req.request_id as string, randomUUID(), f.siteId);
  assert.equal(wrongCmd, null);

  // Nonexistent requestId
  const nonexistent = await store.replay(randomUUID(), input.commandId, f.siteId);
  assert.equal(nonexistent, null);
});

test('6. concurrent finalize with identical body resolves to one RECORDED and one REPLAY; concurrent with changed body yields one CONFLICT', async () => {
  // Part A: Identical command and body executed concurrently
  const f1 = await fixture();
  const req1 = f1.request();
  await insert('mf06_assessment_request', req1);
  const token1 = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req1.request_id, { lease_token: token1, head_revision: 2 }),
  );

  const inputSame = defaultInput(req1, token1, 2);
  const [resA, resB] = await Promise.all([store.finalize(inputSame), store.finalize(inputSame)]);

  const statesA = [resA.state, resB.state].sort();
  assert.deepEqual(
    statesA,
    ['RECORDED', 'REPLAY'],
    'Identical concurrent calls must resolve to exactly one RECORDED and one REPLAY',
  );
  assert.ok('assessment' in resA && resA.assessment);
  assert.ok('assessment' in resB && resB.assessment);
  assert.equal(resA.assessment.assessmentId, resB.assessment.assessmentId);

  const countRows1 = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req1.request_id],
  )) as Row[];
  assert.ok(countRows1[0]);
  assert.equal(countRows1[0].count, 1);

  // Part B: Same command with different bodies executed concurrently
  const f2 = await fixture();
  const req2 = f2.request();
  await insert('mf06_assessment_request', req2);
  const token2 = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req2.request_id, { lease_token: token2, head_revision: 2 }),
  );

  const sharedCmd = randomUUID();
  const inputDiff1 = defaultInput(req2, token2, 2, {
    commandId: sharedCmd,
    reasonCode: 'SERVICE_DISABLED',
  });
  const inputDiff2 = defaultInput(req2, token2, 2, {
    commandId: sharedCmd,
    reasonCode: 'ABORTED',
  });

  const [resC, resD] = await Promise.all([store.finalize(inputDiff1), store.finalize(inputDiff2)]);

  const statesB = [resC.state, resD.state].sort();
  assert.deepEqual(
    statesB,
    ['CONFLICT', 'RECORDED'],
    'Divergent concurrent calls with same command must produce one RECORDED and one CONFLICT',
  );

  const countRows2 = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req2.request_id],
  )) as Row[];
  assert.ok(countRows2[0]);
  assert.equal(countRows2[0].count, 1);
});

test('7. policy-only assessment with sealed MainAuthorityArchive appends atomically, links artifact, and supports replay', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const sources = buildValidPolicy15Sources(f.siteId, f.zoneId);
  const payload: MainAuthorityArchivePayload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context: {
      siteId: f.siteId,
      zoneId: f.zoneId,
      workerId: null,
      capturedAt: '2026-10-10T00:00:00.123000Z',
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    },
    archivedAt: '2026-10-10T00:00:00.200000Z',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-10-10T00:00:00.000000Z',
      declaredWriterManifestHash: '0'.repeat(64),
      sourceRegistryHash: '1'.repeat(64),
      snapshotHash: '2'.repeat(64),
    },
    sources,
  };

  const context: MainAuthorityArchiveContext = {
    siteId: f.siteId,
    zoneId: f.zoneId,
    workerId: null,
    capturedAt: '2026-10-10T00:00:00.123000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  };

  const sealed = sealMainAuthorityArchive(payload, context);
  assert.equal(sealed.status, 'VALID');
  assert.ok('archive' in sealed && sealed.archive);
  const archive = sealed.archive;

  const input = defaultInput(req, token, 2, {
    outcome: 'ALLOWED',
    reasonCode: 'POLICY_NONE',
    provenance: 'TRUSTED_SERVICE',
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: archive,
  });

  const res = await store.finalize(input);
  assert.equal(res.state, 'RECORDED');
  assert.ok('assessment' in res && res.assessment);
  assert.equal(res.assessment.outcome, 'ALLOWED');
  assert.equal(res.assessment.reasonCode, 'POLICY_NONE');
  assert.equal(res.assessment.provenance, 'TRUSTED_SERVICE');
  assert.equal(res.assessment.workerId, null);
  assert.ok(res.assessment.authorityArtifact);
  assert.equal(res.assessment.authorityArtifact.sha256, archive.sha256);

  const artRows = (await db.query('SELECT * FROM mf06_authority_artifact WHERE request_id = $1', [
    req.request_id,
  ])) as Row[];
  assert.ok(artRows[0]);
  assert.equal(artRows[0].sha256, archive.sha256);

  const assessRows = (await db.query(
    'SELECT authority_artifact_id FROM mf06_assessment WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(assessRows[0]);
  assert.equal(assessRows[0].authority_artifact_id, artRows[0].artifact_id);

  const replayed = await store.replay(req.request_id as string, input.commandId, f.siteId);
  assert.ok(replayed);
  assert.ok(replayed.authorityArtifact);
  assert.equal(replayed.authorityArtifact.sha256, archive.sha256);
  assert.equal(replayed.authorityArtifact.format, MAIN_AUTHORITY_ARCHIVE_FORMAT);
});

test('8. replay retains historical request and camera scope even after live camera deactivation or zone mutation', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  const input = defaultInput(req, token, 2);
  const res = await store.finalize(input);
  assert.equal(res.state, 'RECORDED');
  assert.ok('assessment' in res && res.assessment);

  // Live entities updated after recording
  await db.getRepository(CameraEntity).update(f.cameraId, {
    status: CameraStatus.INACTIVE,
    externalId: 'MUTATED_EXTERNAL_CAM_ID',
    name: 'Mutated Camera Name',
  });
  await db.getRepository(ZoneEntity).update(f.zoneId, {
    name: 'Mutated Zone Name',
  });

  const replayed = await store.replay(req.request_id as string, input.commandId, f.siteId);
  assert.ok(replayed);
  assert.equal(replayed.cameraId, f.cameraId);
  assert.equal(replayed.zoneId, f.zoneId);
  assert.equal(replayed.siteId, f.siteId);
  assert.equal(replayed.purpose, 'INITIAL_OBSERVATION_ASSESSMENT');
  assert.equal(replayed.outcome, 'UNAVAILABLE');
  assert.equal(replayed.reasonCode, 'SERVICE_DISABLED');
});

test('nested getters and inherited input fields are refused without invoking caller hooks', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  let hooks = 0;
  const original = sealedPolicyInput(req, token, f.siteId, f.zoneId);
  assert.ok(original.authorityArtifact);
  const artifact = { ...original.authorityArtifact };
  Object.defineProperty(artifact, 'sha256', {
    enumerable: true,
    get() {
      hooks++;
      return original.authorityArtifact?.sha256;
    },
  });
  const nested = await store.finalize({ ...original, authorityArtifact: artifact });
  assert.equal(nested.state, 'UNAVAILABLE');
  assert.equal(hooks, 0, 'Private inputs may not execute nested accessors');
  const inherited = Object.assign(
    Object.create({ evaluatorVersion: 'inherited' }),
    original,
  ) as Mf06AssessmentAppendInput;
  const inheritedResult = await store.finalize(inherited);
  assert.equal(inheritedResult.state, 'UNAVAILABLE');
  const rows = (await db.query(
    'SELECT count(*)::int AS n FROM mf06_assessment WHERE request_id=$1',
    [req.request_id],
  )) as Row[];
  assert.ok(rows[0]);
  assert.equal(rows[0].n, 0);
});

test('archive is snapshotted before first database await; caller mutation cannot change the recorded command', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const input = structuredClone(sealedPolicyInput(req, token, f.siteId, f.zoneId));
  const saved = structuredClone(input);
  let unblock: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const original = db.createQueryRunner.bind(db);
  db.createQueryRunner = (...args) => {
    const runner = original(...args);
    const connect = runner.connect.bind(runner);
    runner.connect = async () => {
      await barrier;
      return connect();
    };
    return runner;
  };
  try {
    const pending = store.finalize(input);
    assert.ok(input.authorityArtifact);
    (input.authorityArtifact.payload.context as { zoneId: string }).zoneId = randomUUID();
    input.reasonCode = 'ABORTED';
    input.claim.headRevision = 99;
    unblock();
    const result = await pending;
    assert.equal(result.state, 'RECORDED');
    if (!('assessment' in result)) throw new Error('Original command was not recorded');
    assert.equal(result.assessment.reasonCode, saved.reasonCode);
    assert.deepEqual(result.assessment.authorityArtifact, saved.authorityArtifact);
    const replayed = await store.finalize(saved);
    assert.equal(replayed.state, 'REPLAY');
  } finally {
    unblock();
    db.createQueryRunner = original;
  }
});

test('replay refuses resealed archive corruption with captured time different from the immutable request', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const input = sealedPolicyInput(req, token, f.siteId, f.zoneId);
  const first = await store.finalize(input);
  assert.equal(first.state, 'RECORDED');
  assert.ok(input.authorityArtifact);
  const body = structuredClone(input.authorityArtifact);
  (body.payload.context as { capturedAt: string }).capturedAt = '2026-10-10T00:00:00.123001Z';
  const hash = computeCanonicalPayloadHash(body.payload);
  const corrupt = { ...body, sha256: hash };
  // Simulate privileged storage corruption in this disposable fixture schema only.
  await db.query(
    'ALTER TABLE mf06_authority_artifact DISABLE TRIGGER trg_mf06_b2_artifact_immutable',
  );
  try {
    await db.query(
      `UPDATE mf06_authority_artifact SET body=$2::jsonb,sha256=$3,
      body_hash=encode(sha256(convert_to(($2::jsonb)::text,'UTF8')),'hex') WHERE request_id=$1`,
      [req.request_id, JSON.stringify(corrupt), hash],
    );
  } finally {
    await db.query(
      'ALTER TABLE mf06_authority_artifact ENABLE TRIGGER trg_mf06_b2_artifact_immutable',
    );
  }
  assert.equal(await store.replay(req.request_id as string, input.commandId, f.siteId), null);
  const resubmitted = await store.finalize(input);
  assert.equal(resubmitted.state, 'UNAVAILABLE');
});

test('9. invalid input (empty version, malformed hash, illegal outcome/reason pair) prevents DB write and returns UNAVAILABLE', async () => {
  const f = await fixture();
  const req = f.request();
  await insert('mf06_assessment_request', req);
  const token = randomUUID();
  await insert(
    'mf06_assessment_job',
    job(req.request_id, { lease_token: token, head_revision: 2 }),
  );

  // Empty evaluatorVersion
  const res1 = await store.finalize(defaultInput(req, token, 2, { evaluatorVersion: '' }));
  assert.ok(
    res1.state === 'UNAVAILABLE' || res1.state === 'CONFLICT',
    `Expected UNAVAILABLE or CONFLICT for empty version but got ${res1.state}`,
  );

  // Malformed bindingHash
  const res2 = await store.finalize(
    defaultInput(req, token, 2, { bindingHash: 'not-a-hex-digest' }),
  );
  assert.ok(
    res2.state === 'UNAVAILABLE' || res2.state === 'CONFLICT',
    `Expected UNAVAILABLE or CONFLICT for malformed hash but got ${res2.state}`,
  );

  // Illegal outcome / reasonCode pair
  const res3 = await store.finalize(
    defaultInput(req, token, 2, { outcome: 'ALLOWED', reasonCode: 'UNAUTHORIZED' }),
  );
  assert.ok(
    res3.state === 'UNAVAILABLE' || res3.state === 'CONFLICT',
    `Expected UNAVAILABLE or CONFLICT for illegal pair but got ${res3.state}`,
  );

  // AUTHORIZED outcome missing required identity/media bindings
  const res4 = await store.finalize(
    defaultInput(req, token, 2, { outcome: 'ALLOWED', reasonCode: 'AUTHORIZED' }),
  );
  assert.ok(
    res4.state === 'UNAVAILABLE' || res4.state === 'CONFLICT',
    `Expected UNAVAILABLE or CONFLICT for AUTHORIZED missing worker bindings but got ${res4.state}`,
  );

  const countRows = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_assessment WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(countRows[0]);
  assert.equal(countRows[0].count, 0, 'No assessment may be written for invalid inputs');

  const artCount = (await db.query(
    'SELECT count(*)::int AS count FROM mf06_authority_artifact WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(artCount[0]);
  assert.equal(artCount[0].count, 0, 'No artifact may be written for invalid inputs');

  const jobRows = (await db.query(
    'SELECT status, head_revision FROM mf06_assessment_job WHERE request_id = $1',
    [req.request_id],
  )) as Row[];
  assert.ok(jobRows[0]);
  assert.equal(jobRows[0].status, 'CLAIMED');
  assert.equal(jobRows[0].head_revision, 2);
});

test('caller finalization refuses absent/weak transactions without appending or changing the job', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const input = defaultInput(req, token);
  assert.deepEqual(await store.finalizeInTransaction(db.manager, input), {
    state: 'UNAVAILABLE',
    reason: 'SERIALIZABLE_TRANSACTION_REQUIRED',
  });
  await db.transaction('READ COMMITTED', async (manager) => {
    assert.deepEqual(await store.finalizeInTransaction(manager, input), {
      state: 'UNAVAILABLE',
      reason: 'SERIALIZABLE_TRANSACTION_REQUIRED',
    });
  });
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM mf06_assessment WHERE request_id=$1', [
        req.request_id,
      ])
    )[0].n,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT status FROM mf06_assessment_job WHERE request_id=$1', [req.request_id])
    )[0].status,
    'CLAIMED',
  );
});

test('caller rollback undoes authority archive, assessment and successful job head together', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const input = sealedPolicyInput(req, token, f.siteId, f.zoneId);
  await assert.rejects(
    db.transaction('SERIALIZABLE', async (manager) => {
      const result = await store.finalizeInTransaction(manager, input);
      assert.equal(result.state, 'RECORDED');
      assert.equal(
        (
          await manager.query('SELECT status FROM mf06_assessment_job WHERE request_id=$1', [
            req.request_id,
          ])
        )[0].status,
        'SUCCEEDED',
      );
      throw new Error('SYNTHETIC_CALLER_ABORT_AFTER_APPEND');
    }),
    /SYNTHETIC_CALLER_ABORT_AFTER_APPEND/,
  );
  for (const table of ['mf06_assessment', 'mf06_authority_artifact']) {
    assert.equal(
      (
        await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE request_id=$1`, [
          req.request_id,
        ])
      )[0].n,
      0,
    );
  }
  assert.equal(
    (
      await db.query('SELECT status,head_revision FROM mf06_assessment_job WHERE request_id=$1', [
        req.request_id,
      ])
    )[0].status,
    'CLAIMED',
  );
  const retry = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, input),
  );
  assert.equal(retry.state, 'RECORDED');
});

test('same caller manager records default-disabled B1 result without invoking any profile/identity service', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  let profileCalls = 0;
  const candidates = new Mf06CandidateMetadataService({
    async findCurrentForSafety() {
      profileCalls++;
      throw new Error('No profile read while disabled');
    },
  });
  const result = await db.transaction('SERIALIZABLE', async (manager) => {
    const disabled = await candidates.revalidate(
      manager,
      f.siteId,
      String(req.request_id),
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
      {} as Parameters<Mf06CandidateMetadataService['revalidate']>[4],
      null,
    );
    assert.deepEqual(disabled, { state: 'UNAVAILABLE', reason: 'SERVICE_DISABLED' });
    return store.finalizeInTransaction(manager, defaultInput(req, token));
  });
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') return;
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.reasonCode, 'SERVICE_DISABLED');
  assert.equal(result.assessment.workerId, null);
  assert.equal(profileCalls, 0);
});

test('caller transaction preserves original replay, body conflict and stale ownership without nested transactions', async () => {
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const input = defaultInput(req, token);
  const recorded = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, input),
  );
  assert.equal(recorded.state, 'RECORDED');
  const replayed = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, input),
  );
  assert.equal(replayed.state, 'REPLAY');
  if (recorded.state !== 'RECORDED' || replayed.state !== 'REPLAY') return;
  assert.deepEqual(replayed.assessment, recorded.assessment);
  const changed = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, { ...input, evaluatorVersion: 'changed-body' }),
  );
  assert.equal(changed.state, 'CONFLICT');
  const next = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, { ...input, commandId: randomUUID() }),
  );
  assert.equal(next.state, 'STALE');
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM mf06_assessment WHERE request_id=$1', [
        req.request_id,
      ])
    )[0].n,
    1,
  );
});

// Actual profile/consent tables in the file-owned test schema. This fixture is
// explicitly synthetic and never invokes a Face service or establishes identity.
let profileFixtureInstalled = false;
async function candidateFixture() {
  if (!profileFixtureInstalled) {
    const runner = db.createQueryRunner();
    try {
      await runner.startTransaction();
      if (!(await runner.hasColumn('face_profile', 'consent_method'))) {
        await runner.query(`ALTER TABLE face_profile ADD COLUMN consent_method varchar(50) NOT NULL DEFAULT 'LEGACY_UNVERIFIED', ADD COLUMN deleted_at timestamptz;
          ALTER TABLE face_profile DROP CONSTRAINT chk_face_profile_database_template,
          ADD CONSTRAINT chk_face_profile_database_template CHECK(status <> 'ACTIVE' OR (encrypted_template IS NOT NULL AND length(encrypted_template) BETWEEN 100 AND 32768));`);
      }
      await new SafetyFaceProvenance1791590400003().up(runner);
      await runner.commitTransaction();
      profileFixtureInstalled = true;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
  const f = await fixture();
  const req: Row = { ...f.request(), payload_hash: computeCanonicalPayloadHash(f.raw) };
  // Source event is still unreferenced here. Establish canonical fixture bytes
  // before inserting the immutable request; never repair a historical request.
  await db.query('UPDATE ai_observation_event SET payload_hash=$2 WHERE event_id=$1', [
    f.eventId,
    req.payload_hash,
  ]);
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const actorId = randomUUID(),
    workerId = randomUUID(),
    profileId = randomUUID();
  const profileReferenceHash = randomUUID().replaceAll('-', '').repeat(2);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic context actor','not-runtime-password')",
    [actorId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic context worker')",
    [workerId, f.siteId],
  );
  await db.query(
    `INSERT INTO face_profile(id,worker_id,user_id,encrypted_template,profile_reference_hash,model_version,status,consent_version,consented_at,created_by_user_id,consent_method)
    VALUES($1,$2,NULL,$3,$4,'synthetic-context-v1','ACTIVE','fixture-enrollment-v1',statement_timestamp(),$5,'SUPERVISED_WORKER_CONFIRMATION')`,
    [profileId, workerId, 'x'.repeat(128), profileReferenceHash, actorId],
  );
  const profileRevision: string = (
    await db.query('SELECT safety_revision FROM face_profile WHERE id=$1', [profileId])
  )[0].safety_revision;
  const consentId = randomUUID();
  await db.query(
    `INSERT INTO safety_face_consent(id,profile_id,profile_revision,purpose,consent_version,consent_method,consented_at,source_record_id,source_record_hash,recorded_by_user_id)
    VALUES($1,$2,$3,'SAFETY_MF06','synthetic-consent-v1','SUPERVISED_WORKER_CONFIRMATION',statement_timestamp(),$4,$5,$6)`,
    [consentId, profileId, profileRevision, randomUUID(), 'd'.repeat(64), actorId],
  );
  const context = await new Mf06RequestContextReader(db).load(f.siteId, String(req.request_id));
  assert.equal(context.status, 'MATCHED');
  if (context.status !== 'MATCHED' || !context.subject)
    throw new Error('Synthetic context unavailable');
  const bytes = Buffer.from('SYNTHETIC_CROP_BYTES_NOT_A_REAL_IMAGE_OR_FACE_RESULT');
  const crop: SafetySubjectCrop = {
    bytes,
    frameSha256: 'f'.repeat(64),
    cropSha256: createHash('sha256').update(bytes).digest('hex'),
    subject: context.subject,
    rectangle: { left: 64, top: 48, width: 192, height: 384 },
    cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
  };
  const prepared = bindMf06FaceInvocation(context, crop, randomUUID(), 'synthetic-context-v1');
  assert.equal(prepared.state, 'BOUND_UNATTESTED');
  if (prepared.state !== 'BOUND_UNATTESTED') throw new Error('Synthetic binding unavailable');
  const response = {
    ...prepared.invocation,
    state: 'CANDIDATE',
    provenance: 'SYNTHETIC_TEST',
    profileReferenceHash,
    profileRevision,
  };
  const candidates = new Mf06CandidateMetadataService(
    new SafetyFaceProfileMetadataReader(),
    'SYNTHETIC_TEST',
  );
  return {
    f,
    req,
    token,
    actorId,
    workerId,
    profileId,
    profileRevision,
    consentId,
    crop,
    prepared,
    response,
    candidates,
  };
}

test('real profile revalidation and append share one SERIALIZABLE transaction without treating eligible metadata as identity', async () => {
  const c = await candidateFixture();
  const result = await db.transaction('SERIALIZABLE', async (manager) => {
    const metadata = await c.candidates.revalidate(
      manager,
      c.f.siteId,
      String(c.req.request_id),
      c.prepared,
      c.crop,
      c.response,
    );
    assert.equal(metadata.state, 'ELIGIBLE_PROFILE_METADATA');
    if (metadata.state !== 'ELIGIBLE_PROFILE_METADATA')
      throw new Error('Synthetic profile unavailable');
    assert.equal(metadata.workerId, c.workerId);
    assert.equal(metadata.identityEstablished, false);
    assert.equal(metadata.authorityEstablished, false);
    return store.finalizeInTransaction(
      manager,
      defaultInput(c.req, c.token, 2, {
        reasonCode: 'IDENTITY_UNAVAILABLE',
        provenance: 'SYNTHETIC_TEST',
      }),
    );
  });
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') return;
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.reasonCode, 'IDENTITY_UNAVAILABLE');
  assert.equal(result.assessment.workerId, null);
});

test('consent revoked after preparation is unavailable inside final append transaction; no positive Worker outcome', async () => {
  const c = await candidateFixture();
  await db.query(
    `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
    VALUES($1,statement_timestamp(),$2,$3,$4)`,
    [c.consentId, randomUUID(), 'd'.repeat(64), c.actorId],
  );
  const result = await db.transaction('SERIALIZABLE', async (manager) => {
    const metadata = await c.candidates.revalidate(
      manager,
      c.f.siteId,
      String(c.req.request_id),
      c.prepared,
      c.crop,
      c.response,
    );
    assert.deepEqual(metadata, { state: 'UNAVAILABLE', reason: 'PROFILE_UNAVAILABLE' });
    return store.finalizeInTransaction(
      manager,
      defaultInput(c.req, c.token, 2, { reasonCode: 'PROFILE_REVOKED' }),
    );
  });
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') return;
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.workerId, null);
});

test('optional profile-table error is recovered by B1 savepoint and allows unavailable append in the same real transaction', async () => {
  const c = await candidateFixture();
  const result = await db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query(
      'ALTER TABLE safety_face_consent RENAME TO fixture_hidden_safety_face_consent',
    );
    const metadata = await c.candidates.revalidate(
      manager,
      c.f.siteId,
      String(c.req.request_id),
      c.prepared,
      c.crop,
      c.response,
    );
    assert.deepEqual(metadata, { state: 'UNAVAILABLE', reason: 'PROFILE_UNAVAILABLE' });
    await manager.query(
      'ALTER TABLE fixture_hidden_safety_face_consent RENAME TO safety_face_consent',
    );
    return store.finalizeInTransaction(
      manager,
      defaultInput(c.req, c.token, 2, { reasonCode: 'IDENTITY_UNAVAILABLE' }),
    );
  });
  assert.equal(result.state, 'RECORDED');
});

test('registered metadata reads actual candidate tables while default artifact query omits raw body', async () => {
  assert.ok(db.hasMetadata(ZoneEntryAssessmentEntity));
  assert.ok(db.hasMetadata(ZoneEntryAuthorityArtifactEntity));
  const f = await fixture();
  const req = f.request();
  const token = randomUUID();
  await insert('mf06_assessment_request', req);
  await insert('mf06_assessment_job', job(req.request_id, { lease_token: token }));
  const result = await store.finalize(sealedPolicyInput(req, token, f.siteId, f.zoneId));
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') return;
  const assessment = await db
    .getRepository(ZoneEntryAssessmentEntity)
    .findOneByOrFail({ assessmentId: result.assessment.assessmentId });
  assert.equal(assessment.commandId, result.assessment.commandId);
  assert.equal(assessment.requestId, req.request_id);
  assert.equal(assessment.outcome, 'ALLOWED');
  assert.ok(assessment.assessedAt instanceof Date);
  assert.ok(assessment.authorityArtifactId);
  const artifact = await db
    .getRepository(ZoneEntryAuthorityArtifactEntity)
    .findOneByOrFail({ artifactId: assessment.authorityArtifactId });
  assert.equal(artifact.sha256, result.assessment.authorityArtifact?.sha256);
  assert.equal(artifact.body, undefined);
  assert.match(artifact.bodyHash, /^[0-9a-f]{64}$/);
  assert.ok(artifact.storedAt instanceof Date);
  const explicit = await db
    .getRepository(ZoneEntryAuthorityArtifactEntity)
    .createQueryBuilder('artifact')
    .addSelect('artifact.body')
    .where('artifact.artifactId=:id', { id: artifact.artifactId })
    .getOneOrFail();
  assert.deepEqual(explicit.body, result.assessment.authorityArtifact);
});
