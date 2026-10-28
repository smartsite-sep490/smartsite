import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import * as e from '../../src/database/entities/index.js';
import { MAIN_AUTHORITY_SOURCES as v1 } from '../../src/common/configuration/main-authority-sources.js';
import { MAIN_AUTHORITY_V2_SOURCES as v2 } from '../../src/common/configuration/main-team-authority-sources.js';
import type { CanonicalMf06Results1794182400000 } from '../../src/database/migrations/1794182400000-CanonicalMf06Results.js';
export async function checkResults(
  db: DataSource,
  runner: QueryRunner,
  migration: CanonicalMf06Results1794182400000,
) {
  const site = randomUUID(),
    camera = randomUUID(),
    zone = randomUUID(),
    at = new Date('2026-10-28T00:00:00.123Z');
  await db
    .getRepository(e.SiteEntity)
    .insert({ id: site, code: site, name: 'Synthetic result Site' });
  await db
    .getRepository(e.CameraEntity)
    .insert({
      id: camera,
      siteId: site,
      externalId: camera,
      code: camera,
      name: 'Synthetic result Camera',
    });
  await db
    .getRepository(e.ZoneEntity)
    .insert({
      id: zone,
      siteId: site,
      code: zone,
      name: 'Synthetic result Zone',
      type: e.ZoneType.STANDARD,
      restrictionPolicy: e.ZoneRestrictionPolicy.NONE,
    });
  const reject = (fn: () => Promise<unknown>) =>
    assert.rejects(
      fn,
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
    );
  for (const [version, registry] of [
    ['V1', v1],
    ['V2', v2],
  ] as const) {
    const event = randomUUID(),
      session = randomUUID(),
      region = randomUUID(),
      request = randomUUID(),
      artifact = randomUUID(),
      assessment = randomUUID(),
      token = randomUUID(),
      command = randomUUID();
    const raw = {
      schemaVersion: '1.0.0',
      eventId: event,
      cameraExternalId: camera,
      streamSessionId: session,
      capturedAt: at.toISOString(),
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
    const hash = computeCanonicalPayloadHash(raw),
      binding = 'b'.repeat(64);
    await db
      .getRepository(e.AiObservationEventEntity)
      .insert({
        eventId: event,
        payloadHash: hash,
        cameraExternalId: camera,
        resolvedCameraId: camera,
        streamSessionId: session,
        capturedAt: at,
        rawPayload: raw,
        processingStatus: e.EventProcessingStatus.PROCESSED,
        processingNote: null,
      });
    await db.query(
      `INSERT INTO zone_entry_assessment_request(request_id,event_id,payload_hash,person_observation_index,zone_observation_index,subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash)
   VALUES($1,$2,$3,0,1,'BOUND',7,$4,$5::uuid,$5::uuid::text,$6,$7,3,$8,$9,'INITIAL_OBSERVATION_ASSESSMENT',1,$10)`,
      [request, event, hash, site, camera, session, region, zone, at, binding],
    );
    await db.query(
      `INSERT INTO zone_entry_assessment_job(request_id,status,attempt_count,head_revision,lease_token,lease_expires_at,next_attempt_at,deadline_at) VALUES($1,'CLAIMED',1,2,$2,clock_timestamp()+interval '60 seconds',clock_timestamp(),clock_timestamp()+interval '5 minutes')`,
      [request, token],
    );
    const format = 'MF06_MAIN_AUTHORITY_ARCHIVE_' + version;
    const payload = {
      version: format,
      context: {
        siteId: site,
        zoneId: zone,
        workerId: null,
        capturedAt: at.toISOString(),
        purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      },
      archivedAt: '2026-10-28T00:01:00.000Z',
      baseline: {
        epochId: randomUUID(),
        capturedAt: '2026-10-27T00:00:00.000Z',
        declaredWriterManifestHash: 'a'.repeat(64),
        sourceRegistryHash: 'b'.repeat(64),
        snapshotHash: 'c'.repeat(64),
      },
      sources: registry.map(([sourceKind, tableName, fields]) => ({
        sourceKind,
        tableName,
        fields,
        rows: [],
      })),
    };
    const sha = computeCanonicalPayloadHash(payload),
      archive = { format, sha256: sha, payload };
    const resultSql = `INSERT INTO zone_entry_assessment(assessment_id,request_id,command_id,command_hash,site_id,event_id,binding_hash,outcome,reason_code,evaluator_version,provenance,authority_artifact_id,claim_head_revision,claim_lease_token)
    VALUES($1,$2,$3,$4,$5,$6,$7,'UNAVAILABLE','AUTHORITY_UNAVAILABLE','synthetic-storage-test','SYNTHETIC_TEST',$8,$9,$10)`;
    const resultArgs = [
      assessment,
      request,
      command,
      'd'.repeat(64),
      site,
      event,
      binding,
      null,
      2,
      token,
    ];
    for (const [index, value] of [
      [4, randomUUID()],
      [6, 'e'.repeat(64)],
      [8, 1],
      [9, randomUUID()],
    ] as const) {
      const changed = [...resultArgs];
      changed[index] = value;
      await reject(() => db.query(resultSql, changed));
    }
    await reject(() =>
      db.query(
        'INSERT INTO zone_entry_authority_artifact(artifact_id,request_id,sha256,body) VALUES($1,$2,$3,$4::jsonb)',
        [artifact, request, sha, JSON.stringify(archive)],
      ),
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM zone_entry_authority_artifact WHERE artifact_id=$1',
          [artifact],
        )
      )[0].n,
      0,
    );
    await runner.startTransaction();
    try {
      await runner.query(
        "UPDATE zone_entry_assessment_job SET head_revision=3,lease_expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1",
        [request],
      );
      const expired = [...resultArgs];
      expired[8] = 3;
      await reject(() => runner.query(resultSql, expired));
    } finally {
      await runner.rollbackTransaction();
    }
    await runner.startTransaction();
    try {
      await runner.query(
        'CREATE TEMP TABLE zone_entry_assessment_job(request_id uuid) ON COMMIT DROP',
      );
      await runner.query(resultSql, resultArgs);
      const [{ name }] = await runner.query('SELECT current_schema() AS name');
      assert.equal(
        (
          await runner.query(
            `SELECT status FROM "${name}".zone_entry_assessment_job WHERE request_id=$1`,
            [request],
          )
        )[0].status,
        'SUCCEEDED',
      );
    } finally {
      await runner.rollbackTransaction();
    }
    await runner.startTransaction();
    try {
      await runner.query(
        'INSERT INTO zone_entry_authority_artifact(artifact_id,request_id,sha256,body) VALUES($1,$2,$3,$4::jsonb)',
        [artifact, request, sha, JSON.stringify(archive)],
      );
      await runner.query(
        `INSERT INTO zone_entry_assessment(assessment_id,request_id,command_id,command_hash,site_id,event_id,binding_hash,outcome,reason_code,evaluator_version,provenance,authority_artifact_id,claim_head_revision,claim_lease_token)
    VALUES($1,$2,$3,$4,$5,$6,$7,'UNAVAILABLE','AUTHORITY_UNAVAILABLE','synthetic-storage-test','SYNTHETIC_TEST',$8,2,$9)`,
        [assessment, request, command, 'd'.repeat(64), site, event, binding, artifact, token],
      );
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
    assert.deepEqual(
      (
        await db.query(
          'SELECT status,lease_token,head_revision FROM zone_entry_assessment_job WHERE request_id=$1',
          [request],
        )
      )[0],
      { status: 'SUCCEEDED', lease_token: null, head_revision: 3 },
    );
    await reject(() =>
      db.query(
        "UPDATE zone_entry_assessment SET evaluator_version='tampered' WHERE assessment_id=$1",
        [assessment],
      ),
    );
    await reject(() =>
      db.query('UPDATE zone_entry_authority_artifact SET sha256=$2 WHERE artifact_id=$1', [
        artifact,
        'e'.repeat(64),
      ]),
    );
    await reject(() =>
      db.query(
        "UPDATE zone_entry_assessment_job SET status='FAILED',head_revision=head_revision+1 WHERE request_id=$1",
        [request],
      ),
    );
  }
  await runner.startTransaction();
  try {
    await reject(() => migration.down(runner));
  } finally {
    await runner.rollbackTransaction();
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_entry_assessment'))[0].n, 2);
  console.log(
    'PASS synthetic V1/V2 result/archive, stale token/revision/lease and scope refusal, orphan rollback, temporary-shadow isolation, atomic SUCCEEDED/immutability/populated downgrade refusal',
  );
}
