import type { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { z } from 'zod';
import { snapshotMf06Json as snapshot } from './mf06-json-snapshot.js';
import type {
  Mf06AssessmentOutcome,
  Mf06AssessmentReasonCode,
  Mf06AssessmentProvenance,
} from '../../../database/entities/zone-entry-assessment.entity.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMATS,
  decodeStoredMainAuthorityArchive,
  type MainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from '../../zones/main-authority-archive-codec.js';

export interface Mf06AssessmentAppendInput {
  claim: { requestId: string; leaseToken: string; headRevision: number };
  commandId: string;
  siteId: string;
  bindingHash: string;
  evaluatorVersion: string;
  outcome: Mf06AssessmentOutcome;
  reasonCode: Mf06AssessmentReasonCode;
  provenance: Mf06AssessmentProvenance;
  workerId: string | null;
  profileRevision: string | null;
  frameSha256: string | null;
  cropSha256: string | null;
  authorityArtifact: MainAuthorityArchive | null;
}
export type Mf06RecordedAssessment = Readonly<{
  assessmentId: string;
  requestId: string;
  commandId: string;
  commandHash: string;
  siteId: string;
  eventId: string;
  bindingHash: string;
  capturedAt: string;
  assessedAt: string;
  cameraId: string;
  zoneId: string;
  purpose: string;
  evaluatorVersion: string;
  outcome: Mf06AssessmentAppendInput['outcome'];
  reasonCode: Mf06AssessmentAppendInput['reasonCode'];
  provenance: Mf06AssessmentAppendInput['provenance'];
  workerId: string | null;
  profileRevision: string | null;
  frameSha256: string | null;
  cropSha256: string | null;
  authorityArtifact: MainAuthorityArchive | null;
}>;
export type Mf06AssessmentStoreResult =
  | { state: 'RECORDED' | 'REPLAY'; assessment: Mf06RecordedAssessment }
  | { state: 'STALE' | 'CONFLICT' | 'UNAVAILABLE'; reason: string };

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z
  .string()
  .regex(uuidPattern)
  .transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const inputSchema = z.strictObject({
  claim: z.strictObject({
    requestId: uuid,
    leaseToken: uuid,
    headRevision: z.number().int().min(1).max(2147483646),
  }),
  commandId: uuid,
  siteId: uuid,
  bindingHash: hash,
  evaluatorVersion: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => value === value.trim()),
  outcome: z.enum(['ALLOWED', 'DENIED', 'UNAVAILABLE']),
  reasonCode: z.enum([
    'INVALID_BINDING',
    'IDENTITY_UNAVAILABLE',
    'MEDIA_UNAVAILABLE',
    'PROFILE_REVOKED',
    'AUTHORITY_UNAVAILABLE',
    'SERVICE_DISABLED',
    'ABORTED',
    'POLICY_NONE',
    'POLICY_PROHIBITED',
    'AUTHORIZED',
    'UNAUTHORIZED',
  ]),
  provenance: z.enum(['UNAVAILABLE', 'SYNTHETIC_TEST', 'TRUSTED_SERVICE']),
  workerId: uuid.nullable(),
  profileRevision: uuid.nullable(),
  frameSha256: hash.nullable(),
  cropSha256: hash.nullable(),
  authorityArtifact: z
    .strictObject({
      format: z.enum(MAIN_AUTHORITY_ARCHIVE_FORMATS),
      sha256: hash,
      payload: z.unknown(),
    })
    .nullable(),
});
const reasonMatrix: Record<Mf06AssessmentAppendInput['outcome'], readonly string[]> = {
  ALLOWED: ['POLICY_NONE', 'AUTHORIZED'],
  DENIED: ['POLICY_PROHIBITED', 'UNAUTHORIZED'],
  UNAVAILABLE: [
    'INVALID_BINDING',
    'IDENTITY_UNAVAILABLE',
    'MEDIA_UNAVAILABLE',
    'PROFILE_REVOKED',
    'AUTHORITY_UNAVAILABLE',
    'SERVICE_DISABLED',
    'ABORTED',
  ],
};

function record(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function prepare(value: unknown): Mf06AssessmentAppendInput | null {
  try {
    const parsed = inputSchema.safeParse(snapshot(value));
    if (!parsed.success) return null;
    const input = parsed.data;
    if (!reasonMatrix[input.outcome].includes(input.reasonCode)) return null;
    if (input.outcome !== 'UNAVAILABLE' && input.authorityArtifact === null) return null;
    if (
      ['AUTHORIZED', 'UNAUTHORIZED'].includes(input.reasonCode) &&
      (!input.workerId ||
        !input.profileRevision ||
        !input.frameSha256 ||
        !input.cropSha256 ||
        input.provenance === 'UNAVAILABLE')
    )
      return null;
    let authorityArtifact: MainAuthorityArchive | null = null;
    if (input.authorityArtifact) {
      const payload = input.authorityArtifact.payload;
      if (!record(payload) || !record(payload.context)) return null;
      const decoded = decodeStoredMainAuthorityArchive(input.authorityArtifact, {
        ...payload.context,
        sha256: input.authorityArtifact.sha256,
      } as MainAuthorityArchiveContext & { sha256: string });
      if (decoded.status !== 'VALID') return null;
      authorityArtifact = decoded.archive;
    }
    return { ...input, authorityArtifact };
  } catch {
    return null;
  }
}
function commandHash(input: Mf06AssessmentAppendInput): string {
  return computeCanonicalPayloadHash({
    ...input,
    authorityArtifact: input.authorityArtifact?.sha256 ?? null,
  });
}
const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
// Internal authority binding only; retain legacy captured_at in public records.
const authorityTimestamp = timestamp(
  `COALESCE((to_jsonb(r)->>'authority_captured_at')::timestamptz,r.captured_at)`,
);
// Fixed SQL identifiers only. One statement reads original request and immutable artifact together.
const assessmentSelect = (schema: string) => `SELECT a.*, r.camera_id,r.zone_id,r.requested_purpose,
  ${timestamp('r.captured_at')} AS captured_at, ${timestamp('a.assessed_at')} AS assessed_at,
  ${authorityTimestamp} AS authority_captured_at,
  art.body AS artifact_body,art.sha256 AS artifact_sha256,
  (art.body_hash=encode(sha256(convert_to(art.body::text,'UTF8')),'hex')) AS artifact_body_intact
  FROM ${schema}.zone_entry_assessment a JOIN ${schema}.zone_entry_assessment_request r ON r.request_id=a.request_id
    AND r.site_id=a.site_id AND r.event_id=a.event_id AND r.binding_hash=a.binding_hash
  LEFT JOIN ${schema}.zone_entry_authority_artifact art ON art.artifact_id=a.authority_artifact_id AND art.request_id=a.request_id`;
function mapRecord(row: Row): Mf06RecordedAssessment | null {
  let authorityArtifact: MainAuthorityArchive | null = null;
  if (row.authority_artifact_id !== null) {
    if (
      !row.artifact_body ||
      row.artifact_body_intact !== true ||
      typeof row.artifact_sha256 !== 'string'
    )
      return null;
    const decoded = decodeStoredMainAuthorityArchive(row.artifact_body, {
      siteId: String(row.site_id),
      zoneId: String(row.zone_id),
      workerId: row.worker_id === null ? null : String(row.worker_id),
      capturedAt: String(row.authority_captured_at),
      purpose: row.requested_purpose as MainAuthorityArchiveContext['purpose'],
      sha256: row.artifact_sha256,
    });
    if (decoded.status !== 'VALID') return null;
    authorityArtifact = decoded.archive;
  }
  const stored: Mf06RecordedAssessment = {
    assessmentId: String(row.assessment_id),
    requestId: String(row.request_id),
    commandId: String(row.command_id),
    commandHash: String(row.command_hash),
    siteId: String(row.site_id),
    eventId: String(row.event_id),
    bindingHash: String(row.binding_hash),
    capturedAt: String(row.captured_at),
    assessedAt: String(row.assessed_at),
    cameraId: String(row.camera_id),
    zoneId: String(row.zone_id),
    purpose: String(row.requested_purpose),
    evaluatorVersion: String(row.evaluator_version),
    outcome: row.outcome as Mf06AssessmentAppendInput['outcome'],
    reasonCode: row.reason_code as Mf06AssessmentAppendInput['reasonCode'],
    provenance: row.provenance as Mf06AssessmentAppendInput['provenance'],
    workerId: row.worker_id === null ? null : String(row.worker_id),
    profileRevision: row.profile_revision === null ? null : String(row.profile_revision),
    frameSha256: row.frame_sha256 === null ? null : String(row.frame_sha256),
    cropSha256: row.crop_sha256 === null ? null : String(row.crop_sha256),
    authorityArtifact,
  };
  const input = prepare({
    claim: {
      requestId: stored.requestId,
      leaseToken: row.claim_lease_token,
      headRevision: row.claim_head_revision,
    },
    commandId: stored.commandId,
    siteId: stored.siteId,
    bindingHash: stored.bindingHash,
    evaluatorVersion: stored.evaluatorVersion,
    outcome: stored.outcome,
    reasonCode: stored.reasonCode,
    provenance: stored.provenance,
    workerId: stored.workerId,
    profileRevision: stored.profileRevision,
    frameSha256: stored.frameSha256,
    cropSha256: stored.cropSha256,
    authorityArtifact,
  });
  return input && commandHash(input) === stored.commandHash ? stored : null;
}
function errorCode(error: unknown): string | null {
  return record(error) && typeof error.code === 'string' ? error.code : null;
}

/** Private persistence, not an evaluator or public trust boundary. No provider/worker registration. */
export class Mf06AssessmentStore {
  constructor(private readonly db: DataSource) {}

  private schema(): string {
    const schema = this.db.driver?.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema, 'utf8') > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      throw new Error('MF06_SCHEMA_UNAVAILABLE');
    return `"${schema.replaceAll('"', '""')}"`;
  }

  /** Private validated record read on the caller's scoped snapshot, never a public entity. */
  async readRecordedInTransaction(
    manager: EntityManager,
    siteId: string,
    assessmentId: string,
  ): Promise<Mf06RecordedAssessment | null> {
    if (
      manager?.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased ||
      ![siteId, assessmentId].every((value) => typeof value === 'string' && uuidPattern.test(value))
    )
      return null;
    const rows = (await manager.query(
      `${assessmentSelect(this.schema())} WHERE a.site_id=$1 AND a.assessment_id=$2 AND a.provenance<>'SYNTHETIC_TEST'`,
      [siteId.toLowerCase(), assessmentId.toLowerCase()],
    )) as Row[];
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  /**
   * Compose caller-owned context/profile locks and append on the SAME manager.
   * The result is provisional until the caller commits. Do not swallow errors:
   * the caller owns rollback and retries of the entire transaction, not just append.
   * This persistence primitive does not establish identity or evaluate authority.
   */
  async finalizeInTransaction(
    manager: EntityManager,
    value: Mf06AssessmentAppendInput,
  ): Promise<Mf06AssessmentStoreResult> {
    const input = prepare(value);
    if (!input) return { state: 'UNAVAILABLE', reason: 'INVALID_INPUT' };
    if (
      manager?.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased
    )
      return { state: 'UNAVAILABLE', reason: 'SERIALIZABLE_TRANSACTION_REQUIRED' };
    const settings = (await manager.query('SHOW transaction_isolation')) as {
      transaction_isolation: string;
    }[];
    if (settings[0]?.transaction_isolation !== 'serializable')
      return { state: 'UNAVAILABLE', reason: 'SERIALIZABLE_TRANSACTION_REQUIRED' };
    return this.append(manager, input, commandHash(input));
  }

  async finalize(value: Mf06AssessmentAppendInput): Promise<Mf06AssessmentStoreResult> {
    const input = prepare(value); // Complete snapshot/closed validation before the first await.
    if (!input) return { state: 'UNAVAILABLE', reason: 'INVALID_INPUT' };
    const digest = commandHash(input);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction('SERIALIZABLE', (manager) =>
          this.append(manager, input, digest),
        );
      } catch (error) {
        const code = errorCode(error);
        if (code === '40001' || code === '40P01') {
          if (attempt < 2) continue;
          return { state: 'UNAVAILABLE', reason: 'TRANSACTION_RETRY_EXHAUSTED' };
        }
        if (code === '23505')
          return { state: 'CONFLICT', reason: 'COMMAND_OR_REQUEST_ALREADY_RECORDED' };
        if (code === '23514') return { state: 'STALE', reason: 'APPEND_PRECONDITION_REJECTED' };
        if (code === '23503') return { state: 'UNAVAILABLE', reason: 'REQUEST_SCOPE_UNAVAILABLE' };
        throw error; // Unexpected infrastructure errors are not silently accepted or exposed as reason text.
      }
    }
    return { state: 'UNAVAILABLE', reason: 'TRANSACTION_RETRY_EXHAUSTED' };
  }
  private async append(
    manager: EntityManager,
    input: Mf06AssessmentAppendInput,
    digest: string,
  ): Promise<Mf06AssessmentStoreResult> {
    // Deferred triggers run at COMMIT: retain the owned path until transaction end.
    await manager.query("SELECT set_config('search_path',$1,true)", [
      `${this.schema()},pg_catalog,pg_temp`,
    ]);
    const requests = (await manager.query(
      `SELECT r.*,${timestamp('r.captured_at')} AS captured_at,${authorityTimestamp} AS authority_captured_at
      FROM ${this.schema()}.zone_entry_assessment_request r WHERE request_id=$1 AND site_id=$2 FOR SHARE`,
      [input.claim.requestId, input.siteId],
    )) as Row[];
    const request = requests[0];
    if (!request) return { state: 'UNAVAILABLE', reason: 'REQUEST_NOT_FOUND_IN_SCOPE' };
    if (request.binding_hash !== input.bindingHash)
      return { state: 'STALE', reason: 'BINDING_HASH_MISMATCH' };
    const existing = (await manager.query(
      `${assessmentSelect(this.schema())} WHERE a.request_id=$1 AND a.site_id=$2`,
      [input.claim.requestId, input.siteId],
    )) as Row[];
    const previous = existing[0];
    if (previous) {
      if (previous.command_id !== input.commandId)
        return { state: 'STALE', reason: 'REQUEST_ALREADY_ASSESSED' };
      if (previous.command_hash !== digest)
        return { state: 'CONFLICT', reason: 'COMMAND_BODY_MISMATCH' };
      const assessment = mapRecord(previous);
      return assessment
        ? { state: 'REPLAY', assessment }
        : { state: 'UNAVAILABLE', reason: 'STORED_RECORD_INVALID' };
    }
    const heads = (await manager.query(
      `SELECT *,clock_timestamp()<lease_expires_at AND clock_timestamp()<deadline_at AS timely
      FROM ${this.schema()}.zone_entry_assessment_job WHERE request_id=$1 FOR UPDATE`,
      [input.claim.requestId],
    )) as Row[];
    const head = heads[0];
    if (
      !head ||
      head.status !== 'CLAIMED' ||
      head.lease_token !== input.claim.leaseToken ||
      head.head_revision !== input.claim.headRevision ||
      head.timely !== true
    )
      return { state: 'STALE', reason: 'LEASE_OR_REVISION_STALE' };
    let artifactId: string | null = null;
    if (input.authorityArtifact) {
      const decoded = decodeStoredMainAuthorityArchive(input.authorityArtifact, {
        siteId: String(request.site_id),
        zoneId: String(request.zone_id),
        workerId: input.workerId,
        capturedAt: String(request.authority_captured_at),
        purpose: request.requested_purpose as MainAuthorityArchiveContext['purpose'],
        sha256: input.authorityArtifact.sha256,
      });
      if (decoded.status !== 'VALID')
        return { state: 'UNAVAILABLE', reason: 'ARCHIVE_REQUEST_BINDING_INVALID' };
      artifactId = randomUUID();
      await manager.query(
        `INSERT INTO ${this.schema()}.zone_entry_authority_artifact(artifact_id,request_id,sha256,body) VALUES($1,$2,$3,$4::jsonb)`,
        [
          artifactId,
          input.claim.requestId,
          decoded.archive.sha256,
          JSON.stringify(decoded.archive),
        ],
      );
    }
    await manager.query(
      `INSERT INTO ${this.schema()}.zone_entry_assessment(assessment_id,request_id,command_id,command_hash,site_id,event_id,binding_hash,
      outcome,reason_code,evaluator_version,provenance,worker_id,profile_revision,frame_sha256,crop_sha256,authority_artifact_id,claim_head_revision,claim_lease_token)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        input.claim.requestId,
        input.commandId,
        digest,
        input.siteId,
        request.event_id,
        input.bindingHash,
        input.outcome,
        input.reasonCode,
        input.evaluatorVersion,
        input.provenance,
        input.workerId,
        input.profileRevision,
        input.frameSha256,
        input.cropSha256,
        artifactId,
        input.claim.headRevision,
        input.claim.leaseToken,
      ],
    );
    const rows = (await manager.query(
      `${assessmentSelect(this.schema())} WHERE a.request_id=$1 AND a.site_id=$2`,
      [input.claim.requestId, input.siteId],
    )) as Row[];
    const assessment = rows[0] && mapRecord(rows[0]);
    if (!assessment) throw new Error('Recorded assessment failed private integrity validation');
    return { state: 'RECORDED', assessment };
  }
  async replay(
    requestId: string,
    commandId: string,
    siteId: string,
  ): Promise<Mf06RecordedAssessment | null> {
    if (
      ![requestId, commandId, siteId].every(
        (value) => typeof value === 'string' && uuidPattern.test(value),
      )
    )
      return null;
    const rows = (await this.db.query(
      `${assessmentSelect(this.schema())} WHERE a.request_id=$1 AND a.command_id=$2 AND a.site_id=$3`,
      [requestId, commandId, siteId],
    )) as Row[];
    return rows[0] ? mapRecord(rows[0]) : null;
  }
}
