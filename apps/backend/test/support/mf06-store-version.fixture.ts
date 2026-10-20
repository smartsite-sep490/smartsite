import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource } from 'typeorm';
import {
  AiObservationEventEntity,
  CameraEntity,
  EventProcessingStatus,
  SiteEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { sealMainAuthorityArchive } from '../../src/modules/zones/main-authority-archive-codec.js';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { MAIN_TEAM_AUTHORITY_SOURCES } from '../../src/modules/zones/main-team-authority-archive.js';
import type { Mf06AssessmentAppendInput } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';

export async function storeVersionFixture(
  db: DataSource,
  version: 'V1' | 'V2',
  eventVersion: '1.0.0' | '1.2.0' = '1.0.0',
) {
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID();
  const eventId = randomUUID(),
    requestId = randomUUID(),
    session = randomUUID(),
    leaseToken = randomUUID();
  const captured = '2026-10-10T00:00:00.123Z';
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic format site' });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Synthetic format camera',
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic format zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
  });
  const raw = {
    eventId,
    schemaVersion: eventVersion,
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
      { type: 'ZONE_ENTRY', trackId: 7, regionId: randomUUID(), geometryVersion: 3 },
    ],
    evidence:
      eventVersion === '1.2.0'
        ? [
            {
              kind: 'FRAME',
              uri: `local://evidence/${session}/7/${eventId}.jpg`,
              sha256: 'a'.repeat(64),
            },
          ]
        : [],
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
  const subject = selectZoneEntrySubject(raw, 1);
  assert(subject.zoneEligible);
  const insert = async (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    assert(['zone_entry_assessment_request', 'zone_entry_assessment_job'].includes(table));
    assert(columns.every((column) => /^[a-z_]+$/.test(column)));
    await db.query(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(row),
    );
  };
  await insert('zone_entry_assessment_request', {
    request_id: requestId,
    event_id: eventId,
    payload_hash: payloadHash,
    person_observation_index: subject.personObservationIndex,
    zone_observation_index: 1,
    subject_binding_status: subject.subjectBindingStatus,
    track_id: subject.trackId,
    site_id: siteId,
    camera_id: cameraId,
    camera_external_id: cameraId,
    stream_session_id: session,
    region_id: subject.regionId,
    geometry_version: subject.geometryVersion,
    zone_id: zoneId,
    captured_at: new Date(captured),
    requested_purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    request_revision: 1,
    binding_hash: 'b'.repeat(64),
  });
  await insert('zone_entry_assessment_job', {
    request_id: requestId,
    status: 'CLAIMED',
    attempt_count: 1,
    head_revision: 2,
    lease_token: leaseToken,
    lease_expires_at: new Date(Date.now() + 120_000),
    next_attempt_at: new Date(),
    deadline_at: new Date(Date.now() + 300_000),
    created_at: new Date(),
    updated_at: new Date(),
  });
  const format =
    version === 'V1' ? 'MF06_MAIN_AUTHORITY_ARCHIVE_V1' : 'MF06_MAIN_AUTHORITY_ARCHIVE_V2';
  const context = {
    siteId,
    zoneId,
    workerId: null,
    capturedAt: captured,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
  };
  const sources = (version === 'V1' ? MAIN_AUTHORITY_SOURCES : MAIN_TEAM_AUTHORITY_SOURCES).map(
    ([sourceKind, tableName, fields]) => ({
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
                  restriction_policy: 'NONE',
                  required_ppe: [],
                  configuration_locked: false,
                },
              ]
            : [],
    }),
  );
  const sealed = sealMainAuthorityArchive(
    {
      version: format,
      context,
      archivedAt: '2026-10-10T00:00:01.000000Z',
      baseline: {
        epochId: randomUUID(),
        capturedAt: '2026-10-10T00:00:00.000000Z',
        declaredWriterManifestHash: '0'.repeat(64),
        sourceRegistryHash: '1'.repeat(64),
        snapshotHash: '2'.repeat(64),
      },
      sources,
    },
    context,
  );
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid format fixture');
  const input: Mf06AssessmentAppendInput = {
    claim: { requestId, leaseToken, headRevision: 2 },
    commandId: randomUUID(),
    siteId,
    bindingHash: 'b'.repeat(64),
    evaluatorVersion: 'SYNTHETIC_FORMAT_FIXTURE',
    outcome: 'UNAVAILABLE',
    reasonCode: 'AUTHORITY_UNAVAILABLE',
    provenance: 'SYNTHETIC_TEST',
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: sealed.archive,
  };
  return { input, requestId, archive: sealed.archive };
}
