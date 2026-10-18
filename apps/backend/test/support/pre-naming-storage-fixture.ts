import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
  sealMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';

/** Synthetic pre-naming64 records only; no production trust, consent or READY epoch. */
export async function seedPreNamingStorage(db: DataSource, site: string) {
  const camera = randomUUID(),
    zone = randomUUID(),
    worker = randomUUID(),
    actor = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-login-password')",
    [actor],
  );
  await db.query("INSERT INTO user_role_assignment(id,user_id,role) VALUES($1,$2,'ADMIN')", [
    randomUUID(),
    actor,
  ]);
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic Camera')",
    [camera, site],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','STANDARD','NONE')",
    [zone, site],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic Worker')",
    [worker, site],
  );
  const cases = [];
  for (const version of [MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_AUTHORITY_ARCHIVE_FORMAT_V2]) {
    const event = randomUUID(),
      request = randomUUID(),
      artifact = randomUUID(),
      assessment = randomUUID();
    const region = randomUUID(),
      session = randomUUID(),
      lease = randomUUID(),
      command = randomUUID();
    const capturedAt = '2026-10-10T00:00:00.123000Z';
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
        { type: 'ZONE_ENTRY', trackId: 7, regionId: region, geometryVersion: 1 },
      ],
      evidence: [],
    };
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
        archivedAt: capturedAt,
        baseline: {
          epochId: randomUUID(),
          capturedAt,
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
    if (sealed.status !== 'VALID') throw Error('Invalid synthetic archive');
    const commandHash = computeCanonicalPayloadHash({
      claim: { requestId: request, leaseToken: lease, headRevision: 2 },
      commandId: command,
      siteId: site,
      bindingHash: 'b'.repeat(64),
      evaluatorVersion: 'synthetic-naming/v1',
      outcome: 'ALLOWED',
      reasonCode: 'POLICY_NONE',
      provenance: 'SYNTHETIC_TEST',
      workerId: null,
      profileRevision: null,
      frameSha256: null,
      cropSha256: null,
      authorityArtifact: sealed.archive.sha256,
    });
    await db.transaction(async (m) => {
      await m.query(
        "INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,$3::uuid::text,$3::uuid,$4,$5,$6,'PROCESSED')",
        [event, computeCanonicalPayloadHash(raw), camera, session, capturedAt, JSON.stringify(raw)],
      );
      await m.query(
        `INSERT INTO mf06_assessment_request(request_id,event_id,payload_hash,person_observation_index,
        zone_observation_index,subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,
        region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash)
        VALUES($1,$2,$3,0,1,'BOUND',7,$4,$5,$5::uuid::text,$6,$7,1,$8,$9,'INITIAL_OBSERVATION_ASSESSMENT',1,$10)`,
        [
          request,
          event,
          computeCanonicalPayloadHash(raw),
          site,
          camera,
          session,
          region,
          zone,
          capturedAt,
          'b'.repeat(64),
        ],
      );
      await m.query(
        `INSERT INTO mf06_assessment_job(request_id,status,attempt_count,head_revision,lease_token,
        lease_expires_at,next_attempt_at,deadline_at) VALUES($1,'CLAIMED',1,2,$2,clock_timestamp()+interval '1 minute',
        clock_timestamp(),clock_timestamp()+interval '2 minutes')`,
        [request, lease],
      );
      await m.query(
        'INSERT INTO mf06_authority_artifact(artifact_id,request_id,sha256,body,body_hash) VALUES($1,$2,$3,$4,$3)',
        [artifact, request, sealed.archive.sha256, JSON.stringify(sealed.archive)],
      );
      await m.query(
        `INSERT INTO mf06_assessment(assessment_id,request_id,command_id,command_hash,site_id,event_id,
        binding_hash,outcome,reason_code,evaluator_version,provenance,authority_artifact_id,claim_head_revision,claim_lease_token)
        VALUES($1,$2,$3,$4,$5,$6,$7,'ALLOWED','POLICY_NONE','synthetic-naming/v1','SYNTHETIC_TEST',$8,2,$9)`,
        [assessment, request, command, commandHash, site, event, 'b'.repeat(64), artifact, lease],
      );
    });
    cases.push({ request, command, assessment, archive: sealed.archive });
  }
  const deny = {
    commandId: randomUUID(),
    actorUserId: actor,
    siteId: site,
    zoneId: zone,
    workerId: worker,
    effect: 'DENY' as const,
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: null,
  };
  const { commandId, ...request } = deny;
  const grant = randomUUID();
  await db.transaction(async (m) => {
    await m.query(
      "INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_ZONE_DENY_CREATE',$3)",
      [
        commandId,
        actor,
        computeCanonicalPayloadHash({ operation: 'MAIN_ZONE_DENY_CREATE', ...request }),
      ],
    );
    await m.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
    await m.query(
      "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY',$5,$6)",
      [grant, site, zone, worker, deny.validFrom, deny.validUntil],
    );
    await m.query(
      "INSERT INTO mf06_zone_deny_command_result(command_id,source_id,result_json,result_hash) VALUES($1,$2,mf06_zone_deny_response($2),'')",
      [commandId, grant],
    );
  });
  await db.query(
    'INSERT INTO mf06_authority_commit_witness(command_id,transaction_id) SELECT command_id,transaction_id FROM mf06_authority_command WHERE command_id=$1',
    [commandId],
  );
  const [receipt] = await db.query(
    'SELECT result_json FROM mf06_zone_deny_command_result WHERE command_id=$1',
    [commandId],
  );
  return { cases, deny, grant: receipt.result_json, site };
}
