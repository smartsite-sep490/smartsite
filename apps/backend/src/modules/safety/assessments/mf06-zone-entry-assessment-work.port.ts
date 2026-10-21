import type { DataSource, EntityManager } from 'typeorm';
import { CameraStatus, ZoneRestrictionPolicy } from '../../../database/entities/enums.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import type {
  Mf06AssessmentOutcome,
  Mf06AssessmentProvenance,
  Mf06AssessmentReasonCode,
} from '../../../database/entities/zone-entry-assessment.entity.js';
import { projectMainArchivedPermissions } from '../../zones/main-archived-permission-projection.js';
import type {
  MainAuthorityArchive,
  MainAuthorityArchiveContext,
} from '../../zones/main-authority-archive-codec.js';
import { verifySubMillisecondAuthorityBridgeInTx } from '../../zones/main-authority-capture-time.js';
import { MAIN_AUTHORITY_SNAPSHOT_TABLES } from '../../zones/main-authority-read-snapshot.js';
import type {
  MainQualifiedAuthorityPrepared,
  MainQualifiedAuthorityReader,
  MainQualifiedAuthorityResult,
} from '../../zones/main-qualified-authority.reader.js';
import type {
  Mf06AssessmentStore,
  Mf06AssessmentStoreResult,
} from './mf06-assessment-store.service.js';
import {
  Mf06RetryableWorkError,
  type Mf06AssessmentWorkPort,
} from './mf06-assessment-worker.service.js';
import type { Mf06CandidateMetadataService } from './mf06-candidate-metadata.service.js';
import type {
  Mf06ClaimContextLookup,
  Mf06ClaimContextReader,
  Mf06ClaimContextUnavailableReason,
} from './mf06-claim-context.reader.js';
import type { Mf06FacePreparation, Mf06FacePreparationResult } from './mf06-face-preparation.js';
import type { Mf06JobClaim } from './mf06-job-lease.service.js';
import {
  snapshotWorkClaim,
  snapshotWorkContext,
  snapshotWorkFace,
  type MatchedClaimContext,
} from './mf06-work-preparation.js';
import { readConsistentMf06RawEvent } from './mf06-observation-event.js';
import { inspectMf06StoredBinding, type Mf06CapturedRequest } from './mf06-request-context.js';

export const MF06_WORKPORT_EVALUATOR_VERSION = 'mf06-workport-qualified-v1';

type VerifiedRequestAndRaw = Readonly<{ request: Mf06CapturedRequest; rawCapturedAt: string }>;
type PreparedAuthorityBranch =
  | Readonly<{
      status: 'QUALIFIED';
      prepared: MainQualifiedAuthorityPrepared;
      restrictionPolicy: ZoneRestrictionPolicy;
    }>
  | Readonly<{ status: 'UNAVAILABLE'; reason: string }>;
type InternalPreparedState =
  | Readonly<{
      kind: 'CONTEXT_UNAVAILABLE';
      claim: Mf06JobClaim;
      reason: Mf06ClaimContextUnavailableReason;
    }>
  | Readonly<{
      kind: 'READY';
      claim: Mf06JobClaim;
      context: MatchedClaimContext;
      authorityContext: MainAuthorityArchiveContext;
      authority: PreparedAuthorityBranch;
      face: Mf06FacePreparationResult | null;
    }>;

function rejectAbortedDependency(signal: AbortSignal): never {
  signal.throwIfAborted();
  throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
}
const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;
const sameUuid = (left: unknown, right: unknown): boolean =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.toLowerCase() === right.toLowerCase();

const pgErrorCode = (error: unknown): string | undefined => {
  const err = error as { code?: unknown; driverError?: { code?: unknown } };
  const code = err?.driverError?.code ?? err?.code;
  return typeof code === 'string' ? code : undefined;
};

const archiveMatchesRequestScope = (
  archive: MainAuthorityArchive,
  request: Mf06CapturedRequest,
): boolean => {
  const sources = new Map(archive.payload.sources.map((s) => [s.sourceKind, s.rows]));
  const camera = (sources.get('CAMERA') ?? []).find((row) => sameUuid(row.id, request.cameraId));
  if (
    !camera ||
    !sameUuid(camera.site_id, request.siteId) ||
    camera.external_id !== request.cameraExternalId ||
    camera.status !== CameraStatus.ACTIVE
  ) {
    return false;
  }
  const region = (sources.get('REGION') ?? []).find((row) => sameUuid(row.id, request.regionId));
  return Boolean(
    region &&
    sameUuid(region.camera_id, request.cameraId) &&
    sameUuid(region.zone_id, request.zoneId) &&
    region.version === request.geometryVersion &&
    region.coordinate_space === 'NORMALIZED_0_1' &&
    region.is_active === true,
  );
};

const sameClaim = (a: Mf06JobClaim, b: Mf06JobClaim): boolean =>
  Boolean(
    a &&
    b &&
    sameUuid(a.requestId, b.requestId) &&
    sameUuid(a.leaseToken, b.leaseToken) &&
    a.headRevision === b.headRevision &&
    a.attemptCount === b.attemptCount &&
    a.leaseExpiresAt === b.leaseExpiresAt &&
    a.deadlineAt === b.deadlineAt,
  );

export class Mf06ZoneEntryAssessmentWorkPort implements Mf06AssessmentWorkPort {
  private readonly preparedHandles = new WeakMap<object, InternalPreparedState>();

  constructor(
    private readonly db: DataSource,
    private readonly contexts: Pick<Mf06ClaimContextReader, 'readForClaim'>,
    private readonly authority: Pick<
      MainQualifiedAuthorityReader,
      'prepareForEvent' | 'revalidate'
    >,
    private readonly facePreparation: Pick<Mf06FacePreparation, 'prepare'>,
    private readonly candidateMetadata: Pick<Mf06CandidateMetadataService, 'revalidate'>,
    private readonly store: Pick<Mf06AssessmentStore, 'finalizeInTransaction'>,
  ) {}

  async prepare(claim: Mf06JobClaim, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const callerClaim = snapshotWorkClaim(claim);
    let lookup: Mf06ClaimContextLookup;
    try {
      lookup = await this.contexts.readForClaim(callerClaim, signal);
    } catch (error) {
      const code = pgErrorCode(error);
      if (code && ['40001', '40P01', '55P03', '57014', '55000'].includes(code))
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      throw error;
    }
    signal.throwIfAborted();
    if (lookup.status !== 'MATCHED') {
      if (lookup.reason === 'ABORTED') rejectAbortedDependency(signal);
      return this.mintHandle({
        kind: 'CONTEXT_UNAVAILABLE',
        claim: callerClaim,
        reason: lookup.reason,
      });
    }
    const context = snapshotWorkContext(lookup);
    const authorityContext: MainAuthorityArchiveContext = Object.freeze({
      siteId: context.siteId,
      zoneId: context.request.zoneId,
      workerId: null,
      capturedAt: context.request.capturedAt,
      purpose: context.request.requestedPurpose,
    });
    const preparedAuthority: MainQualifiedAuthorityResult =
      await this.authority.prepareForEvent(authorityContext);
    signal.throwIfAborted();
    if (preparedAuthority.status !== 'QUALIFIED') {
      if (preparedAuthority.reason === 'DATABASE_UNAVAILABLE')
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      const authority = Object.freeze({
        status: 'UNAVAILABLE' as const,
        reason: preparedAuthority.reason,
      });
      return this.mintHandle({
        kind: 'READY',
        claim: context.claim,
        context,
        authorityContext,
        authority,
        face: null,
      });
    }
    if (!archiveMatchesRequestScope(preparedAuthority.archive, context.request)) {
      const authority = Object.freeze({
        status: 'UNAVAILABLE' as const,
        reason: 'AUTHORITY_SCOPE_MISMATCH',
      });
      return this.mintHandle({
        kind: 'READY',
        claim: context.claim,
        context,
        authorityContext,
        authority,
        face: null,
      });
    }
    const projection = projectMainArchivedPermissions(preparedAuthority.archive, {
      ...authorityContext,
      sha256: preparedAuthority.archive.sha256,
    });
    if (
      projection.status === 'PROJECTED' &&
      projection.sourceArchiveSha256 === preparedAuthority.archive.sha256 &&
      (projection.restrictionPolicy === ZoneRestrictionPolicy.NONE ||
        projection.restrictionPolicy === ZoneRestrictionPolicy.PROHIBITED_FOR_ALL)
    ) {
      const authority = Object.freeze({
        status: 'QUALIFIED' as const,
        prepared: preparedAuthority,
        restrictionPolicy: projection.restrictionPolicy,
      });
      return this.mintHandle({
        kind: 'READY',
        claim: context.claim,
        context,
        authorityContext,
        authority,
        face: null,
      });
    }
    if (
      projection.status === 'UNAVAILABLE' &&
      projection.reason === 'WORKER_REFERENCE_UNAVAILABLE'
    ) {
      const rawFace = await this.facePreparation.prepare(context.claim, signal);
      signal.throwIfAborted();
      if (rawFace.state === 'UNAVAILABLE' && rawFace.reason === 'ABORTED')
        rejectAbortedDependency(signal);
      const face = snapshotWorkFace(rawFace, context);
      const authority = Object.freeze({
        status: 'QUALIFIED' as const,
        prepared: preparedAuthority,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      });
      return this.mintHandle({
        kind: 'READY',
        claim: context.claim,
        context,
        authorityContext,
        authority,
        face,
      });
    }
    const authority = Object.freeze({
      status: 'UNAVAILABLE' as const,
      reason: 'AUTHORITY_PROJECTION_INVALID',
    });
    return this.mintHandle({
      kind: 'READY',
      claim: context.claim,
      context,
      authorityContext,
      authority,
      face: null,
    });
  }

  async finalize(
    manager: EntityManager,
    claim: Mf06JobClaim,
    prepared: unknown,
    signal: AbortSignal,
  ): Promise<Mf06AssessmentStoreResult> {
    signal.throwIfAborted();
    if (typeof prepared !== 'object' || prepared === null)
      return { state: 'UNAVAILABLE', reason: 'UNTRUSTED_PREPARED_HANDLE' };
    const record = this.preparedHandles.get(prepared);
    if (!record || !sameClaim(record.claim, claim))
      return { state: 'UNAVAILABLE', reason: 'UNTRUSTED_PREPARED_HANDLE' };
    const schema = this.selectedSchema();
    if (!schema) return { state: 'UNAVAILABLE', reason: 'SCHEMA_UNAVAILABLE' };
    await this.acquireSnapshotFence(manager, schema);
    signal.throwIfAborted();
    if (record.kind === 'CONTEXT_UNAVAILABLE') {
      return record.reason === 'CLAIM_NOT_ACTIVE'
        ? { state: 'STALE', reason: 'CLAIM_NOT_ACTIVE' }
        : { state: 'UNAVAILABLE', reason: record.reason };
    }
    const verified = await this.verifyRequestAndEvent(manager, record);
    signal.throwIfAborted();
    if (!verified) return { state: 'UNAVAILABLE', reason: 'INVALID_STORED_BINDING' };
    const decision = await this.resolveDecision(manager, record, verified, signal);
    signal.throwIfAborted();
    return this.store.finalizeInTransaction(manager, {
      claim: {
        requestId: record.claim.requestId,
        leaseToken: record.claim.leaseToken,
        headRevision: record.claim.headRevision,
      },
      commandId: record.claim.requestId,
      siteId: record.context.siteId,
      bindingHash: record.context.request.storedBindingHash,
      evaluatorVersion: MF06_WORKPORT_EVALUATOR_VERSION,
      ...decision,
    });
  }

  private mintHandle(state: InternalPreparedState): object {
    const token = Object.freeze({});
    this.preparedHandles.set(token, Object.freeze(state));
    return token;
  }

  private selectedSchema(): string | null {
    const schema = this.db?.driver?.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema, 'utf8') > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      return null;
    return schema;
  }

  private async acquireSnapshotFence(manager: EntityManager, schema: string): Promise<void> {
    const quoted = quoteIdentifier(schema);
    const tables = MAIN_AUTHORITY_SNAPSHOT_TABLES.map(
      (t) => `${quoted}.${quoteIdentifier(t)}`,
    ).join(',');
    try {
      await manager.query("SET LOCAL lock_timeout='1500ms'");
      await manager.query("SET LOCAL statement_timeout='5s'");
      await manager.query(`LOCK TABLE ${tables} IN SHARE MODE`);
      await manager.query("SELECT set_config('search_path',quote_ident($1),true)", [schema]);
      const [fence] = (await manager.query(
        `SELECT current_schema()=$1::text AND pg_catalog.pg_my_temp_schema()=0 AS schema_valid, current_setting('transaction_isolation')='serializable' AS isolation_valid, current_setting('transaction_read_only')='off' AS writable`,
        [schema],
      )) as { schema_valid?: boolean; isolation_valid?: boolean; writable?: boolean }[];
      if (!fence?.schema_valid || !fence?.isolation_valid || !fence?.writable)
        throw new Error('MF06_SNAPSHOT_FENCE_INVALID');
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === '40001' || code === '40P01') throw error;
      if (code && ['55P03', '57014', '55000'].includes(code))
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      throw error;
    }
  }

  private async verifyRequestAndEvent(
    manager: EntityManager,
    record: Extract<InternalPreparedState, { kind: 'READY' }>,
  ): Promise<VerifiedRequestAndRaw | null> {
    const request = await manager.getRepository(ZoneEntryAssessmentRequestEntity).findOne({
      where: { requestId: record.claim.requestId, siteId: record.context.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!request || typeof request.eventId !== 'string') return null;
    const event = await manager.getRepository(AiObservationEventEntity).findOne({
      where: { eventId: request.eventId.toLowerCase() },
      lock: { mode: 'pessimistic_read' },
    });
    if (!event) return null;
    const stored = inspectMf06StoredBinding(request, event),
      raw = readConsistentMf06RawEvent(event),
      expected = record.context.request;
    const ok =
      stored.status === 'MATCHED' &&
      raw &&
      typeof raw.capturedAt === 'string' &&
      stored.contextDigest === record.context.contextDigest &&
      stored.request.storedBindingHash === expected.storedBindingHash &&
      stored.request.siteId === record.authorityContext.siteId &&
      stored.request.zoneId === record.authorityContext.zoneId &&
      stored.request.cameraId === expected.cameraId &&
      stored.request.cameraExternalId === expected.cameraExternalId &&
      stored.request.regionId === expected.regionId &&
      stored.request.geometryVersion === expected.geometryVersion &&
      stored.request.capturedAt === record.authorityContext.capturedAt &&
      stored.request.requestedPurpose === record.authorityContext.purpose;
    if (!ok || typeof raw?.capturedAt !== 'string') return null;
    return Object.freeze({ request: stored.request, rawCapturedAt: raw.capturedAt });
  }

  private async resolveDecision(
    manager: EntityManager,
    record: Extract<InternalPreparedState, { kind: 'READY' }>,
    verified: VerifiedRequestAndRaw,
    signal: AbortSignal,
  ) {
    if (record.authority.status === 'UNAVAILABLE') {
      if (record.authority.reason === 'DATABASE_UNAVAILABLE')
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      return this.unavailableDecision('AUTHORITY_UNAVAILABLE', 'UNAVAILABLE', null);
    }
    const revalidated = await this.authority.revalidate(
      manager,
      { ...record.authorityContext, epochId: record.authority.prepared.epochId },
      record.authority.prepared,
    );
    signal.throwIfAborted();
    if (revalidated.status !== 'QUALIFIED') {
      if (
        revalidated.reason === 'CUTOVER_STATE_DRIFT' ||
        revalidated.reason === 'DATABASE_UNAVAILABLE'
      )
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      return this.unavailableDecision('AUTHORITY_UNAVAILABLE', 'UNAVAILABLE', null);
    }
    const bridgeOk = await verifySubMillisecondAuthorityBridgeInTx(
      manager,
      revalidated.archive,
      verified.rawCapturedAt,
    );
    signal.throwIfAborted();
    if (!bridgeOk || !archiveMatchesRequestScope(revalidated.archive, verified.request)) {
      return this.unavailableDecision('AUTHORITY_UNAVAILABLE', 'UNAVAILABLE', null);
    }
    const projected = projectMainArchivedPermissions(revalidated.archive, {
      ...record.authorityContext,
      sha256: revalidated.archive.sha256,
    });
    const provenance: Mf06AssessmentProvenance =
      revalidated.provenance === 'OPERATIONAL_REVIEWED' ? 'TRUSTED_SERVICE' : 'SYNTHETIC_TEST';
    if (record.authority.restrictionPolicy !== ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED) {
      if (
        projected.status !== 'PROJECTED' ||
        projected.sourceArchiveSha256 !== revalidated.archive.sha256 ||
        projected.restrictionPolicy !== record.authority.restrictionPolicy
      ) {
        return this.unavailableDecision('AUTHORITY_UNAVAILABLE', 'UNAVAILABLE', null);
      }
      const allowed = projected.restrictionPolicy === ZoneRestrictionPolicy.NONE;
      return {
        outcome: (allowed ? 'ALLOWED' : 'DENIED') as Mf06AssessmentOutcome,
        reasonCode: (allowed ? 'POLICY_NONE' : 'POLICY_PROHIBITED') as Mf06AssessmentReasonCode,
        provenance,
        workerId: null,
        profileRevision: null,
        frameSha256: null,
        cropSha256: null,
        authorityArtifact: revalidated.archive,
      };
    }
    if (projected.status !== 'UNAVAILABLE' || projected.reason !== 'WORKER_REFERENCE_UNAVAILABLE')
      return this.unavailableDecision('AUTHORITY_UNAVAILABLE', 'UNAVAILABLE', null);
    const face = record.face;
    if (!face)
      return this.unavailableDecision('IDENTITY_UNAVAILABLE', provenance, revalidated.archive);
    if (face.state === 'UNAVAILABLE') {
      if (face.reason === 'ABORTED') rejectAbortedDependency(signal);
      const reasonCode: Mf06AssessmentReasonCode =
        face.reason === 'MEDIA_UNAVAILABLE'
          ? 'MEDIA_UNAVAILABLE'
          : face.reason === 'CONTEXT_UNAVAILABLE'
            ? 'INVALID_BINDING'
            : 'IDENTITY_UNAVAILABLE';
      return this.unavailableDecision(reasonCode, provenance, revalidated.archive);
    }
    const cropCopy = { ...face.media.crop, bytes: Buffer.from(face.media.crop.bytes) };
    const metadata = await this.candidateMetadata.revalidate(
      manager,
      record.context.siteId,
      record.claim.requestId,
      { state: 'BOUND_UNATTESTED', invocation: face.media.invocation },
      cropCopy,
      face.response,
    );
    signal.throwIfAborted();
    if (metadata.state === 'UNAVAILABLE') {
      if (metadata.reason === 'ABORTED') rejectAbortedDependency(signal);
      if (metadata.reason === 'INVALID_BINDING')
        return this.unavailableDecision('INVALID_BINDING', provenance, revalidated.archive);
    }
    return this.unavailableDecision(
      'IDENTITY_UNAVAILABLE',
      provenance,
      revalidated.archive,
      face.media.crop.frameSha256,
      face.media.crop.cropSha256,
    );
  }

  private unavailableDecision(
    reasonCode: Mf06AssessmentReasonCode,
    provenance: Mf06AssessmentProvenance,
    authorityArtifact: MainAuthorityArchive | null,
    frameSha256: string | null = null,
    cropSha256: string | null = null,
  ) {
    return {
      outcome: 'UNAVAILABLE' as Mf06AssessmentOutcome,
      reasonCode,
      provenance,
      workerId: null,
      profileRevision: null,
      frameSha256,
      cropSha256,
      authorityArtifact,
    };
  }
}
