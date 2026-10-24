import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  AiObservationEventEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import type { Mf06ClaimContextLookup } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { bindMf06FaceInvocation } from '../../src/modules/safety/assessments/mf06-face-binding.js';
import type { Mf06FacePreparationResult } from '../../src/modules/safety/assessments/mf06-face-preparation.js';
import type { Mf06JobClaim } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { selectZoneEntrySubject } from '../../src/modules/safety/identity/observation-identity-subject.js';
import type { SafetySubjectCrop } from '../../src/modules/safety/identity/safety-subject-cropper.js';
import { MAIN_AUTHORITY_SNAPSHOT_TABLES } from '../../src/modules/zones/main-authority-read-snapshot.js';
import { createQualifiedAuthorityFixture } from './qualified-authority-fixture.js';

/**
 * Target placement in T: `apps/backend/test/support/mf06-workport-fixture.ts`
 * (sibling to `qualified-authority-fixture.ts` and `mf06-store-version.fixture.ts`).
 */

export const WORKPORT_SYNTHETIC_REGION_VERSION = 3;

export interface SeedWorkPortJobOptions {
  readonly siteId: string;
  readonly zoneId: string;
  readonly cameraId: string;
  readonly cameraExternalId?: string;
  readonly regionId: string;
  readonly geometryVersion?: number;
  readonly capturedAt: string;
  readonly eventVersion?: '1.0.0' | '1.2.0' | '1.3.0';
  readonly frameSha256?: string;
  readonly bindingHash?: string;
  readonly requestedPurpose?: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';
}

export interface SeededWorkPortJob {
  readonly requestId: string;
  readonly eventId: string;
  readonly streamSessionId: string;
  readonly frameSha256: string;
  readonly bindingHash: string;
  readonly claim: Mf06JobClaim;
}

export async function createWorkPortAuthorityFixture() {
  const fx = await createQualifiedAuthorityFixture();
  try {
    const zoneNoneId = randomUUID();
    const zoneProhibitedId = randomUUID();
    const cameraId = randomUUID();
    const regionAuthId = randomUUID();
    const regionNoneId = randomUUID();
    const regionProhibitedId = randomUUID();

    // Seed existing Site/Zone/Camera/Region rows BEFORE cutover.activate(request, null).
    await fx.db.getRepository(ZoneEntity).insert([
      {
        id: zoneNoneId,
        siteId: fx.siteId,
        code: zoneNoneId,
        name: 'Synthetic WorkPort None Zone',
        type: ZoneType.STANDARD,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
      },
      {
        id: zoneProhibitedId,
        siteId: fx.siteId,
        code: zoneProhibitedId,
        name: 'Synthetic WorkPort Prohibited Zone',
        type: ZoneType.STANDARD,
        restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      },
    ]);

    await fx.db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId: fx.siteId,
      externalId: cameraId,
      code: cameraId,
      name: 'Synthetic WorkPort Camera',
      status: CameraStatus.ACTIVE,
    });

    const polygon = [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.9],
    ];
    await fx.db.getRepository(CameraObservationRegionEntity).insert([
      {
        id: regionAuthId,
        cameraId,
        zoneId: fx.zoneId,
        polygon,
        coordinateSpace: 'NORMALIZED_0_1',
        version: WORKPORT_SYNTHETIC_REGION_VERSION,
        isActive: true,
      },
      {
        id: regionNoneId,
        cameraId,
        zoneId: zoneNoneId,
        polygon,
        coordinateSpace: 'NORMALIZED_0_1',
        version: WORKPORT_SYNTHETIC_REGION_VERSION,
        isActive: true,
      },
      {
        id: regionProhibitedId,
        cameraId,
        zoneId: zoneProhibitedId,
        polygon,
        coordinateSpace: 'NORMALIZED_0_1',
        version: WORKPORT_SYNTHETIC_REGION_VERSION,
        isActive: true,
      },
    ]);

    const cutoverReceipt = await fx.cutover.activate(fx.request as never, null);
    assert.equal(cutoverReceipt.commitStatus, 'COMMITTED');
    assert.equal(cutoverReceipt.witnessConfirmed, true);

    // Ensure event capturedAt is strictly AFTER baseline activation AND <= current clock_timestamp().
    const [clockRow] = (await fx.db.query(
      `SELECT pg_sleep(0.015),
              to_char(date_trunc('milliseconds', clock_timestamp()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS captured_at`,
    )) as { captured_at: string }[];
    assert.ok(clockRow);
    const capturedAt = clockRow.captured_at;

    return {
      ...fx,
      epochId: cutoverReceipt.epochId,
      baselineCapturedAt: cutoverReceipt.capturedAt,
      capturedAt,
      zoneAuthId: fx.zoneId,
      zoneNoneId,
      zoneProhibitedId,
      cameraId,
      regionAuthId,
      regionNoneId,
      regionProhibitedId,
    };
  } catch (error) {
    await fx.dispose();
    throw error;
  }
}

export async function seedWorkPortJobClaim(
  db: DataSource,
  options: SeedWorkPortJobOptions,
): Promise<SeededWorkPortJob> {
  const eventId = randomUUID();
  const requestId = randomUUID();
  const session = randomUUID();
  const leaseToken = randomUUID();
  const eventVersion = options.eventVersion ?? '1.3.0';
  const cameraExternalId = options.cameraExternalId ?? options.cameraId;
  const geometryVersion = options.geometryVersion ?? WORKPORT_SYNTHETIC_REGION_VERSION;
  const frameSha256 = options.frameSha256 ?? 'a'.repeat(64);
  const bindingHash = options.bindingHash ?? 'b'.repeat(64);

  const raw = {
    eventId,
    schemaVersion: eventVersion,
    cameraExternalId,
    streamSessionId: session,
    capturedAt: options.capturedAt,
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      {
        type: 'ZONE_ENTRY',
        trackId: 7,
        regionId: options.regionId,
        geometryVersion,
      },
    ],
    evidence:
      eventVersion === '1.2.0' || eventVersion === '1.3.0'
        ? [
            {
              kind: 'FRAME',
              uri: `local://evidence/${session}/7/${eventId}.jpg`,
              sha256: frameSha256,
            },
          ]
        : [],
  };

  const payloadHash = computeCanonicalPayloadHash(raw);
  await db.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash,
    cameraExternalId,
    resolvedCameraId: options.cameraId,
    streamSessionId: session,
    capturedAt: new Date(options.capturedAt),
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
  });

  const subject = selectZoneEntrySubject(raw, 1);
  assert(subject.zoneEligible);

  const insert = async (
    table: 'zone_entry_assessment_request' | 'zone_entry_assessment_job',
    row: Record<string, unknown>,
  ) => {
    const columns = Object.keys(row);
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
    site_id: options.siteId,
    camera_id: options.cameraId,
    camera_external_id: cameraExternalId,
    stream_session_id: session,
    region_id: subject.regionId,
    geometry_version: subject.geometryVersion,
    zone_id: options.zoneId,
    captured_at: new Date(options.capturedAt),
    requested_purpose: options.requestedPurpose ?? 'INITIAL_OBSERVATION_ASSESSMENT',
    request_revision: 1,
    binding_hash: bindingHash,
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

  const [jobRow] = (await db.query(
    'SELECT status, attempt_count, head_revision, lease_token, lease_expires_at, deadline_at FROM zone_entry_assessment_job WHERE request_id = $1',
    [requestId],
  )) as {
    status: string;
    attempt_count: number;
    head_revision: number;
    lease_token: string;
    lease_expires_at: Date;
    deadline_at: Date;
  }[];
  assert.ok(jobRow);

  const claim: Mf06JobClaim = Object.freeze({
    requestId,
    leaseToken: jobRow.lease_token,
    headRevision: Number(jobRow.head_revision),
    attemptCount: Number(jobRow.attempt_count),
    leaseExpiresAt: jobRow.lease_expires_at.toISOString(),
    deadlineAt: jobRow.deadline_at.toISOString(),
  });

  return { requestId, eventId, streamSessionId: session, frameSha256, bindingHash, claim };
}

export async function rotateJobLeaseInDb(db: DataSource, requestId: string): Promise<Mf06JobClaim> {
  const newLeaseToken = randomUUID();
  await db.query(
    `UPDATE zone_entry_assessment_job
       SET lease_token=$2,head_revision=head_revision+1,attempt_count=attempt_count+1,
           lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
     WHERE request_id=$1`,
    [requestId, newLeaseToken],
  );
  const [updated] = await db.query(
    'SELECT request_id,lease_token,head_revision,attempt_count,lease_expires_at,deadline_at FROM zone_entry_assessment_job WHERE request_id=$1',
    [requestId],
  );
  assert.ok(updated);
  return Object.freeze({
    requestId: updated.request_id,
    leaseToken: updated.lease_token,
    headRevision: Number(updated.head_revision),
    attemptCount: Number(updated.attempt_count),
    leaseExpiresAt: updated.lease_expires_at.toISOString(),
    deadlineAt: updated.deadline_at.toISOString(),
  });
}
export function buildCorrelatedFacePreparationResult(
  matched: Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }>,
  callerMutableCropBytes: Buffer,
  frameSha256: string,
  profileRevision: string,
  profileReferenceHash: string = 'c'.repeat(64),
  modelVersion: string = 'synthetic-face-v1',
): {
  faceResult: Mf06FacePreparationResult;
  callerMutableResponse: Record<string, unknown>;
  cropSha256: string;
} {
  assert(matched.subject, 'Expected BOUND subject on matched claim context');
  const cropSha256 = createHash('sha256').update(callerMutableCropBytes).digest('hex');
  const crop: SafetySubjectCrop = {
    bytes: callerMutableCropBytes,
    frameSha256,
    cropSha256,
    subject: matched.subject,
    rectangle: { left: 64, top: 96, width: 192, height: 336 },
    cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
  };
  const bound = bindMf06FaceInvocation(
    {
      status: 'MATCHED',
      request: matched.request,
      subject: matched.subject,
      contextDigest: matched.contextDigest,
    },
    crop,
    randomUUID(),
    modelVersion,
  );
  assert.equal(bound.state, 'BOUND_UNATTESTED');
  if (bound.state !== 'BOUND_UNATTESTED')
    throw new Error('Expected BOUND_UNATTESTED face invocation');

  const callerMutableResponse: Record<string, unknown> = {
    ...bound.invocation,
    state: 'CANDIDATE',
    provenance: 'SYNTHETIC_TEST',
    profileReferenceHash,
    profileRevision,
  };

  return {
    cropSha256,
    callerMutableResponse,
    faceResult: {
      state: 'PREPARED_UNATTESTED',
      context: matched,
      media: {
        state: 'BOUND_UNATTESTED',
        invocation: bound.invocation,
        crop,
      },
      response: callerMutableResponse,
    },
  };
}

export async function assertExactSnapshotTablesShareLocked(
  manager: EntityManager,
  schema: string,
): Promise<void> {
  const [row] = (await manager.query(
    `SELECT current_schema() = $1::text AND pg_catalog.pg_my_temp_schema() = 0 AS schema_only,
            current_setting('transaction_isolation') = 'serializable' AS is_serializable,
            current_setting('transaction_read_only') = 'off' AS is_writable,
            bool_and(
              EXISTS(
                SELECT 1
                FROM pg_locks l
                JOIN pg_class c ON c.oid = l.relation
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE l.pid = pg_backend_pid()
                  AND l.granted = true
                  AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
                  AND n.nspname = $1::text
                  AND c.relname = expected.relname
              )
            ) AS all_exact_tables_locked
       FROM unnest($2::text[]) AS expected(relname)`,
    [schema, [...MAIN_AUTHORITY_SNAPSHOT_TABLES]],
  )) as {
    schema_only?: boolean;
    is_serializable?: boolean;
    is_writable?: boolean;
    all_exact_tables_locked?: boolean;
  }[];
  assert.equal(row?.schema_only, true, 'Expected schema-only search_path with no pg_temp');
  assert.equal(row?.is_serializable, true, 'Expected SERIALIZABLE transaction isolation');
  assert.equal(row?.is_writable, true, 'Expected writable transaction');
  assert.equal(
    row?.all_exact_tables_locked,
    true,
    'Expected all 20 exact MAIN_AUTHORITY_SNAPSHOT_TABLES to hold granted ShareLock in schema',
  );
}
