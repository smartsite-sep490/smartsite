import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';

import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../src/modules/cameras/camera-configuration-bundle-reader.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import { computeMf06InitialBinding } from '../../src/modules/safety/assessments/mf06-event-admission.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { readTrackedZoneFindingIndexes } from '../../src/modules/safety/alerts/tracked-zone-finding-evidence.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  sealMainAuthorityArchive,
  type MainAuthorityArchiveContext,
  type MainAuthorityArchivePayload,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
const rejected = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 409;
before(() => isolated.initialize());
after(() => isolated.dispose());

async function fixture(
  options: {
    synthetic?: boolean;
    wrongBinding?: boolean;
    noAssessment?: boolean;
  } = {},
) {
  const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
  assert.ok(f.ppeRegionId);
  const [region] = await db.query<Array<{ zone_id: string }>>(
    'SELECT zone_id FROM camera_observation_region WHERE id=$1',
    [f.ppeRegionId],
  );
  assert.ok(region);
  const zoneId = region.zone_id;
  const eventId = randomUUID();
  const capturedAt = new Date();
  const raw = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: f.cameraId,
    streamSessionId: f.generation.streamSessionId,
    capturedAt: capturedAt.toISOString(),
    frameDimensions: { width: 120, height: 80 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId: f.ppeRegionId, geometryVersion: 1 },
    ],
    evidence: [],
  };
  const payloadHash = computeCanonicalPayloadHash(raw);
  const selected = selectZoneEntrySubject(raw, 1);
  assert.ok(selected.zoneEligible);
  assert.equal(selected.subjectBindingStatus, 'BOUND');
  const bindingHash = options.wrongBinding
    ? 'b'.repeat(64)
    : computeMf06InitialBinding(eventId, selected);

  await db.query(
    `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,
      stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,$3::uuid::text,$3::uuid,$4,$5::timestamptz,$6::jsonb,'PROCESSED')`,
    [eventId, payloadHash, f.cameraId, raw.streamSessionId, raw.capturedAt, JSON.stringify(raw)],
  );
  const requestId = randomUUID();
  await db.query(
    `INSERT INTO zone_entry_assessment_request(
    request_id,event_id,payload_hash,person_observation_index,zone_observation_index,
    subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,
    region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash)
    VALUES($1,$2,$3,0,1,'BOUND',7,$4,$5,$5::uuid::text,$6,$7,1,$8,$9,'INITIAL_OBSERVATION_ASSESSMENT',1,$10)`,
    [
      requestId,
      eventId,
      payloadHash,
      f.siteId,
      f.cameraId,
      raw.streamSessionId,
      f.ppeRegionId,
      zoneId,
      raw.capturedAt,
      bindingHash,
    ],
  );
  if (!options.noAssessment) {
    const token = randomUUID();
    await db.query(
      `INSERT INTO zone_entry_assessment_job(
      request_id,status,attempt_count,head_revision,lease_token,lease_expires_at,next_attempt_at,deadline_at)
      VALUES($1,'CLAIMED',1,2,$2,clock_timestamp()+interval '2 minutes',clock_timestamp(),clock_timestamp()+interval '5 minutes')`,
      [requestId, token],
    );
    const context: MainAuthorityArchiveContext = {
      siteId: f.siteId,
      zoneId,
      workerId: null,
      capturedAt: raw.capturedAt,
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    };
    const archive: MainAuthorityArchivePayload = {
      version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
      context,
      archivedAt: raw.capturedAt,
      baseline: {
        epochId: randomUUID(),
        capturedAt: raw.capturedAt,
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
            ? [{ id: f.siteId, access_policy_version: 1 }]
            : sourceKind === 'ZONE_POLICY'
              ? [
                  {
                    id: zoneId,
                    site_id: f.siteId,
                    restriction_policy: 'PROHIBITED_FOR_ALL',
                    required_ppe: [],
                    configuration_locked: true,
                  },
                ]
              : [],
      })),
    };
    const sealed = sealMainAuthorityArchive(archive, context);
    assert.equal(sealed.status, 'VALID');
    if (sealed.status !== 'VALID') throw Error('Synthetic archive could not be sealed');
    const result = await db.transaction('SERIALIZABLE', (manager) =>
      new Mf06AssessmentStore(db).finalizeInTransaction(manager, {
        claim: { requestId, leaseToken: token, headRevision: 2 },
        commandId: randomUUID(),
        siteId: f.siteId,
        bindingHash,
        evaluatorVersion: '1.0.0',
        outcome: 'DENIED',
        reasonCode: 'POLICY_PROHIBITED',
        provenance: options.synthetic ? 'SYNTHETIC_TEST' : 'TRUSTED_SERVICE',
        workerId: null,
        profileRevision: null,
        frameSha256: null,
        cropSha256: null,
        authorityArtifact: sealed.archive,
      }),
    );
    assert.equal(result.state, 'RECORDED');
  }
  const bundle = await db.transaction('REPEATABLE READ', (manager) =>
    readHistoricalIssuedCameraBundleInTransaction(manager, {
      ...f.context,
      siteId: f.siteId,
      cameraExternalId: f.cameraId,
    }),
  );
  assert.ok(bundle);
  return {
    siteId: f.siteId,
    cameraId: f.cameraId,
    eventId,
    payloadHash,
    personIndex: 0,
    zoneId,
    subtype: 'ZONE_ENTRY_PROHIBITED',
    bundle,
  };
}

test('Zone original evidence qualifies PERSON+ZONE_ENTRY without requiring any PPE observation', async () => {
  const input = await fixture();
  const result = await db.transaction('REPEATABLE READ', (manager) =>
    readTrackedZoneFindingIndexes(db, manager, input),
  );
  assert.deepEqual(result, [1]);
  // The frozen issuance remains the source of geometry even if later live state changes.
  for (const change of [
    { personIndex: 1 },
    { zoneId: randomUUID() },
    { payloadHash: '0'.repeat(64) },
    { subtype: 'ZONE_ENTRY_UNAUTHORIZED' },
  ]) {
    await assert.rejects(
      db.transaction('REPEATABLE READ', (manager) =>
        readTrackedZoneFindingIndexes(db, manager, { ...input, ...change }),
      ),
      rejected,
    );
  }
});

test('Zone evidence refuses missing, synthetic and mechanically mismatched assessment bindings', async () => {
  for (const options of [{ noAssessment: true }, { synthetic: true }, { wrongBinding: true }]) {
    const input = await fixture(options);
    await assert.rejects(
      db.transaction('REPEATABLE READ', (manager) =>
        readTrackedZoneFindingIndexes(db, manager, input),
      ),
      rejected,
    );
  }
});
