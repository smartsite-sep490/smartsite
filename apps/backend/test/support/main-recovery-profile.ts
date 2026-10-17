import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { DataSource, MigrationInterface } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { Mf06AssessmentRequests1791590400001 } from '../../src/database/migrations/1791590400001-Mf06AssessmentRequests.js';
import { Mf06ImmutableAssessments1791590400004 } from '../../src/database/migrations/1791590400004-Mf06ImmutableAssessments.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  decodeStoredMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';

const baseline = '2e98619ac94be775ef43f4cb3076f00a59b88df1';
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

// Exact negative boundary: approved MAIN35 + Safety0001/0004 is not current MAIN61.
export const MAIN37_MISSING_MAIN61_MIGRATIONS = [
  'Mf06MainAuthorityJournal1791590400002',
  'SafetyFaceProvenance1791590400003',
  'Mf03AttendanceReconciliation1791676800000',
  'WorkerCodeSequence1791676800000',
  'Mf03DailyOpenSessions1791676800001',
  'OptionalPasswordChange1791676800002',
  'Mf03AttendanceDuplicateReview1791676800003',
  'ContractorTeams1791676800004',
  'ShiftArchival1791763200000',
  'ShiftBreak1791763200001',
  'GateScheduleDenial1791849600000',
  'ScheduleAssignmentBatches1791849600001',
  'ScheduleChangeNotifications1791849600002',
  'SingleSiteManager1791936000000',
  'TeamZonePermissions1791940000000',
  'ContractorZoneRegrant1791940000001',
  'SingleTeamZone1791940000002',
  'AttendanceAbsence1792022400000',
  'VisitorRoster1792022400000',
  'SiteManagerReviewNotifications1792108800000',
  'SafetyChecklists1792195200000',
  'ShiftExitGracePeriod1792281600000',
  'AttendanceExitNotifications1792281600001',
  'PreserveManagerNotificationHistory1792368000000',
];

/** Test-only approved MAIN snapshot. Never register these migrations in production options. */
export async function loadMainRecoveryMigrations(repository: string, snapshot: string) {
  assert(isAbsolute(repository) && isAbsolute(snapshot));
  const original = (path: string) =>
    execFileSync('git', ['show', `${baseline}:${path}`], {
      cwd: repository,
      windowsHide: true,
      maxBuffer: 2_097_152,
    });
  const options = original('apps/backend/src/database/typeorm.options.ts').toString();
  const imports = new Map(
    [...options.matchAll(/import \{ (\w+) \} from '\.\/migrations\/([\w-]+)\.js';/g)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );
  const names = options
    .match(/migrations: \[([\s\S]*?)\]/)?.[1]
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  assert.equal(names?.length, 35, 'Exact approved MAIN registry');
  const migrations: (new () => MigrationInterface)[] = [];
  for (const name of names!) {
    const file = imports.get(name);
    assert.ok(file && /^[\w-]+$/.test(file));
    const source = original(`apps/backend/src/database/migrations/${file}.ts`);
    assert.equal(digest(readFileSync(join(snapshot, `${file}.ts`))), digest(source));
    const expected = ts.transpileModule(source.toString(), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const modulePath = join(snapshot, `${file}.mjs`);
    assert.equal(readFileSync(modulePath, 'utf8'), expected, 'Pinned compiled migration bytes');
    const migration = (await import(pathToFileURL(modulePath).href))[name];
    assert.equal(typeof migration?.prototype?.up, 'function');
    assert.equal(typeof migration?.prototype?.down, 'function');
    migrations.push(migration);
  }
  return [
    ...migrations,
    Mf06AssessmentRequests1791590400001,
    Mf06ImmutableAssessments1791590400004,
  ];
}

/** Synthetic storage fixture only: no Face/AI service, authority activation or human acceptance. */
export async function seedCompletedRecoveryAssessment(
  db: DataSource,
  context: { siteId: string; zoneId: string; cameraId: string; regionId: string; eventId: string },
  historical = false,
) {
  // Explicit frozen MAIN37 storage; never infer a fallback from missing current tables.
  const tables = historical
    ? {
        request: 'mf06_assessment_request',
        job: 'mf06_assessment_job',
        assessment: 'mf06_assessment',
        artifact: 'mf06_authority_artifact',
      }
    : {
        request: 'zone_entry_assessment_request',
        job: 'zone_entry_assessment_job',
        assessment: 'zone_entry_assessment',
        artifact: 'zone_entry_authority_artifact',
      };
  const requestId = randomUUID(),
    artifactId = randomUUID(),
    assessmentId = randomUUID();
  const commandId = randomUUID(),
    lease = randomUUID(),
    binding = 'b'.repeat(64);
  await db.transaction(async (manager) => {
    const [event] = await manager.query(
      `SELECT payload_hash,camera_external_id,stream_session_id,
              to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_at
       FROM ai_observation_event WHERE event_id=$1`,
      [context.eventId],
    );
    assert.ok(event);
    await manager.query(
      `INSERT INTO ${tables.request}
       (request_id,event_id,payload_hash,person_observation_index,zone_observation_index,
        subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,
        region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash)
       VALUES($1,$2,$3,0,2,'BOUND',7,$4,$5,$6,$7,$8,1,$9,$10,'INITIAL_OBSERVATION_ASSESSMENT',1,$11)`,
      [
        requestId,
        context.eventId,
        event.payload_hash,
        context.siteId,
        context.cameraId,
        event.camera_external_id,
        event.stream_session_id,
        context.regionId,
        context.zoneId,
        event.captured_at,
        binding,
      ],
    );
    await manager.query(
      `INSERT INTO ${tables.job}
       (request_id,status,attempt_count,head_revision,lease_token,lease_expires_at,next_attempt_at,deadline_at)
       VALUES($1,'CLAIMED',1,2,$2,clock_timestamp()+interval '2 minutes',clock_timestamp(),clock_timestamp()+interval '5 minutes')`,
      [requestId, lease],
    );
    const sources = [];
    for (const [sourceKind, tableName, fields] of MAIN_AUTHORITY_SOURCES) {
      // Identifiers come only from the fixed code-owned public field mask.
      assert(/^[a-z_]+$/.test(tableName) && fields.every((field) => /^[a-z_]+$/.test(field)));
      // PostgreSQL JSON preserves timestamp precision and bounded version numbers.
      const projection: { row: Record<string, unknown> }[] = await manager.query(
        `SELECT to_jsonb(r) AS row FROM (SELECT ${fields.map((field) => `"${field}"`).join(',')}
          FROM "${tableName}") r`,
      );
      sources.push({ sourceKind, tableName, fields, rows: projection.map(({ row }) => row) });
    }
    const payload = {
      version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
      context: {
        siteId: context.siteId,
        zoneId: context.zoneId,
        workerId: null,
        capturedAt: event.captured_at,
        purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
      },
      archivedAt: new Date().toISOString(),
      baseline: {
        epochId: randomUUID(),
        capturedAt: event.captured_at,
        declaredWriterManifestHash: '0'.repeat(64),
        sourceRegistryHash: '1'.repeat(64),
        snapshotHash: '2'.repeat(64),
      },
      sources,
    };
    const sha256 = computeCanonicalPayloadHash(payload);
    const archive = JSON.parse(
      JSON.stringify({ format: MAIN_AUTHORITY_ARCHIVE_FORMAT, sha256, payload }),
    );
    const checked = decodeStoredMainAuthorityArchive(archive, { ...payload.context, sha256 });
    assert.equal(
      checked.status,
      'VALID',
      checked.status === 'UNAVAILABLE' ? checked.reason : undefined,
    );
    const commandHash = computeCanonicalPayloadHash({
      claim: { requestId, leaseToken: lease, headRevision: 2 },
      commandId,
      siteId: context.siteId,
      bindingHash: binding,
      outcome: 'UNAVAILABLE',
      reasonCode: 'AUTHORITY_UNAVAILABLE',
      evaluatorVersion: 'synthetic-recovery/v1',
      provenance: 'SYNTHETIC_TEST',
      workerId: null,
      profileRevision: null,
      frameSha256: null,
      cropSha256: null,
      authorityArtifact: sha256,
    });
    await manager.query(
      `INSERT INTO ${tables.artifact}(artifact_id,request_id,sha256,body,body_hash) VALUES($1,$2,$3,$4::jsonb,$3)`,
      [artifactId, requestId, sha256, JSON.stringify(archive)],
    );
    await manager.query(
      `INSERT INTO ${tables.assessment}
       (assessment_id,request_id,command_id,command_hash,site_id,event_id,binding_hash,outcome,
        reason_code,evaluator_version,provenance,authority_artifact_id,claim_head_revision,claim_lease_token)
       VALUES($1,$2,$3,$4,$5,$6,$7,'UNAVAILABLE','AUTHORITY_UNAVAILABLE',
              'synthetic-recovery/v1','SYNTHETIC_TEST',$8,2,$9)`,
      [
        assessmentId,
        requestId,
        commandId,
        commandHash,
        context.siteId,
        context.eventId,
        binding,
        artifactId,
        lease,
      ],
    );
    const [job] = await manager.query(
      `SELECT status,head_revision,lease_token,lease_expires_at FROM ${tables.job} WHERE request_id=$1`,
      [requestId],
    );
    assert.deepEqual(job, {
      status: 'SUCCEEDED',
      head_revision: 3,
      lease_token: null,
      lease_expires_at: null,
    });
  });
  return { requestId, artifactId, assessmentId, commandId };
}
