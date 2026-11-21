import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { MAIN_AUTHORITY_SOURCES } from '../src/common/configuration/main-authority-sources.js';
import {
  Mf06AssessmentStore,
  type Mf06AssessmentAppendInput,
} from '../src/modules/safety/assessments/mf06-assessment-store.service.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  sealMainAuthorityArchive,
  type MainAuthorityArchiveContext,
  type MainAuthorityArchivePayload,
} from '../src/modules/zones/main-authority-archive-codec.js';

type Row = Record<string, unknown>;
function readFixture(millisecondArchive = false) {
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    eventId = randomUUID();
  const summary = '2026-11-21T11:42:08.123000Z';
  const raw = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: 'synthetic-camera',
    streamSessionId: randomUUID(),
    capturedAt: '2026-11-21T11:42:08.123962+00:00',
    frameDimensions: { width: 120, height: 80 },
    evidence: [],
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId: randomUUID(), geometryVersion: 1 },
    ],
  };
  const context: MainAuthorityArchiveContext = {
    siteId,
    zoneId,
    workerId: null,
    capturedAt: millisecondArchive ? summary : raw.capturedAt,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  };
  const payload: MainAuthorityArchivePayload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context,
    archivedAt: '2026-11-21T11:42:09.000000Z',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-11-21T11:42:08.000000Z',
      declaredWriterManifestHash: '0'.repeat(64),
      sourceRegistryHash: '1'.repeat(64),
      snapshotHash: '2'.repeat(64),
    },
    sources: MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => ({
      sourceKind,
      tableName,
      fields,
      rows:
        sourceKind === 'SITE'
          ? [{ id: siteId, access_policy_version: 1 }]
          : sourceKind === 'ZONE_POLICY'
            ? [
                {
                  id: zoneId,
                  site_id: siteId,
                  restriction_policy: 'PROHIBITED_FOR_ALL',
                  required_ppe: [],
                  configuration_locked: true,
                },
              ]
            : [],
    })),
  };
  const sealed = sealMainAuthorityArchive(payload, context);
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid synthetic archive');
  const input: Mf06AssessmentAppendInput = {
    claim: { requestId: randomUUID(), leaseToken: randomUUID(), headRevision: 2 },
    commandId: randomUUID(),
    siteId,
    bindingHash: 'a'.repeat(64),
    evaluatorVersion: '1.0.0',
    outcome: 'DENIED',
    reasonCode: 'POLICY_PROHIBITED',
    provenance: 'TRUSTED_SERVICE',
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: sealed.archive,
  };
  const assessmentId = randomUUID();
  const row: Row = {
    assessment_id: assessmentId,
    request_id: input.claim.requestId,
    command_id: input.commandId,
    command_hash: computeCanonicalPayloadHash({
      ...input,
      authorityArtifact: sealed.archive.sha256,
    }),
    claim_lease_token: input.claim.leaseToken,
    claim_head_revision: input.claim.headRevision,
    site_id: siteId,
    event_id: eventId,
    binding_hash: input.bindingHash,
    camera_id: randomUUID(),
    zone_id: zoneId,
    requested_purpose: context.purpose,
    captured_at: summary,
    assessed_at: payload.archivedAt,
    evaluator_version: input.evaluatorVersion,
    outcome: input.outcome,
    reason_code: input.reasonCode,
    provenance: input.provenance,
    worker_id: null,
    profile_revision: null,
    frame_sha256: null,
    crop_sha256: null,
    authority_artifact_id: randomUUID(),
    artifact_body: sealed.archive,
    artifact_sha256: sealed.archive.sha256,
    artifact_body_intact: true,
    original_raw_payload: raw,
    original_payload_hash: computeCanonicalPayloadHash(raw),
    original_captured_at: summary,
  };
  // Exercise only the public persisted-row reader boundary. These rows represent legacy
  // precision loss; they are never inserted through or substituted for current DB guards.
  const db = { driver: { schema: 'synthetic_read_boundary' } } as unknown as DataSource;
  const read = (changes: Row = {}) => {
    const manager = {
      connection: db,
      queryRunner: { isTransactionActive: true, isReleased: false },
      query: async () => [{ ...row, ...changes }],
    } as unknown as EntityManager;
    return new Mf06AssessmentStore(db).readRecordedInTransaction(manager, siteId, assessmentId);
  };
  return { read, raw, summary };
}

test('stored assessment recovers exact hash-bound microseconds from a legacy millisecond read row', async () => {
  const f = readFixture();
  const record = await f.read();
  assert.ok(record);
  assert.equal(record.capturedAt, '2026-11-21T11:42:08.123962Z');
  assert.equal(record.authorityArtifact?.payload.context.capturedAt, f.raw.capturedAt);
  for (const change of [
    { captured_at: '2026-11-21T11:42:08.123111Z' },
    { original_payload_hash: '0'.repeat(64) },
    { original_raw_payload: { ...f.raw, eventId: randomUUID() } },
    { original_raw_payload: { ...f.raw, observations: [] } },
    { original_captured_at: '2026-11-21T11:42:08.123111Z' },
  ])
    assert.equal(await f.read(change), null);
});

test('a valid millisecond archive preserves its original context regardless of optional raw metadata', async () => {
  const f = readFixture(true);
  const record = await f.read({
    original_raw_payload: null,
    original_payload_hash: '0'.repeat(64),
  });
  assert.ok(record);
  assert.equal(record.capturedAt, f.summary);
  assert.equal(record.authorityArtifact?.payload.context.capturedAt, f.summary);
});
