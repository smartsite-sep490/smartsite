import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
  sealMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';

const isolated = createIsolatedTestDatabase({ canonical: true }),
  db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

for (const version of [MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_AUTHORITY_ARCHIVE_FORMAT_V2]) {
  test(`canonical ${version} artifact finalizes and replays immutable synthetic record`, async () => {
    const site = randomUUID(),
      camera = randomUUID(),
      zone = randomUUID(),
      event = randomUUID(),
      session = randomUUID(),
      region = randomUUID(),
      request = randomUUID(),
      token = randomUUID();
    const capturedAt = '2026-10-10T00:00:00.123000Z';
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic archive Site')",
      [site],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic archive Camera')",
      [camera, site],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic archive Zone','STANDARD','NONE')",
      [zone, site],
    );
    const raw = {
      eventId: event,
      schemaVersion: '1.0.0',
      cameraExternalId: camera,
      streamSessionId: session,
      capturedAt,
      frameDimensions: { width: 640, height: 480 },
      observations: [
        {
          type: 'PERSON',
          trackId: 7,
          boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
        },
        { type: 'ZONE_ENTRY', trackId: 7, regionId: region, geometryVersion: 3 },
      ],
      evidence: [],
    };
    await db.query(
      "INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED')",
      [event, 'a'.repeat(64), camera, camera, session, capturedAt, JSON.stringify(raw)],
    );
    await db.query(
      `INSERT INTO zone_entry_assessment_request(request_id,event_id,payload_hash,person_observation_index,zone_observation_index,subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash)
      VALUES($1,$2,$3,0,1,'BOUND',7,$4,$5,$5::uuid::text,$6,$7,3,$8,$9,'INITIAL_OBSERVATION_ASSESSMENT',1,$10)`,
      [
        request,
        event,
        'a'.repeat(64),
        site,
        camera,
        session,
        region,
        zone,
        capturedAt,
        'b'.repeat(64),
      ],
    );
    await db.query(
      `INSERT INTO zone_entry_assessment_job(request_id,status,attempt_count,head_revision,lease_token,lease_expires_at,next_attempt_at,deadline_at)
      VALUES($1,'CLAIMED',1,2,$2,clock_timestamp()+interval '1 minute',clock_timestamp(),clock_timestamp()+interval '2 minutes')`,
      [request, token],
    );
    const context = {
      siteId: site,
      zoneId: zone,
      workerId: null,
      capturedAt,
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
    };
    const sources =
      version === MAIN_AUTHORITY_ARCHIVE_FORMAT
        ? MAIN_AUTHORITY_SOURCES
        : MAIN_AUTHORITY_V2_SOURCES;
    const sealed = sealMainAuthorityArchive(
      {
        version,
        context,
        archivedAt: '2026-10-10T00:00:01.000000Z',
        baseline: {
          epochId: randomUUID(),
          capturedAt: '2026-10-10T00:00:00.000000Z',
          declaredWriterManifestHash: '0'.repeat(64),
          sourceRegistryHash: '1'.repeat(64),
          snapshotHash: '2'.repeat(64),
        },
        sources: sources.map(([sourceKind, tableName, fields]) => ({
          sourceKind,
          tableName,
          fields,
          rows:
            sourceKind === 'SITE'
              ? [{ id: site, access_policy_version: 1 }]
              : sourceKind === 'ZONE_POLICY'
                ? [
                    {
                      id: zone,
                      site_id: site,
                      restriction_policy: 'NONE',
                      required_ppe: [],
                      configuration_locked: false,
                    },
                  ]
                : [],
        })),
      },
      context,
    );
    assert.equal(sealed.status, 'VALID');
    if (sealed.status !== 'VALID') throw Error('Invalid private fixture');
    const store = new Mf06AssessmentStore(db),
      command = randomUUID();
    const input = {
      claim: { requestId: request, leaseToken: token, headRevision: 2 },
      commandId: command,
      siteId: site,
      bindingHash: 'b'.repeat(64),
      evaluatorVersion: 'team-archive-regression',
      outcome: 'ALLOWED' as const,
      reasonCode: 'POLICY_NONE' as const,
      provenance: 'SYNTHETIC_TEST' as const,
      workerId: null,
      profileRevision: null,
      frameSha256: null,
      cropSha256: null,
      authorityArtifact: sealed.archive,
    };
    const first = await store.finalize(input);
    assert.equal(first.state, 'RECORDED', JSON.stringify(first));
    if (first.state !== 'RECORDED') throw Error('Expected private record');
    assert.equal(first.assessment.provenance, 'SYNTHETIC_TEST');
    assert.deepEqual(first.assessment.authorityArtifact, sealed.archive);
    assert.deepEqual(await store.replay(request, command, site), first.assessment);
    const retry = await store.finalize(input);
    assert.equal(retry.state, 'REPLAY');
    if (retry.state === 'REPLAY') assert.deepEqual(retry.assessment, first.assessment);
    assert.equal(await store.replay(request, command, randomUUID()), null);
    const [counts] = await db.query(
      'SELECT (SELECT count(*)::int FROM zone_entry_authority_artifact WHERE request_id=$1) AS artifacts,(SELECT count(*)::int FROM zone_entry_assessment WHERE request_id=$1) AS assessments',
      [request],
    );
    assert.deepEqual(counts, { artifacts: 1, assessments: 1 });
    await assert.rejects(
      db.query('UPDATE zone_entry_authority_artifact SET body=body WHERE request_id=$1', [request]),
      (error: unknown) => (error as { code: string }).code === '23514',
    );
  });
}
