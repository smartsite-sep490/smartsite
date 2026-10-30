import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import type { ObservationSubjectRef } from '../identity/observation-identity.types.js';
import type { Mf06JobClaim } from './mf06-job-lease.service.js';
import { inspectMf06StoredBinding, type Mf06CapturedRequest } from './mf06-request-context.js';
import { selectMf06FrameReference, type Mf06FrameReference } from './mf06-frame-reference.js';
import { loadMf06RequestAdmission } from './mf06-event-admission.js';

export type Mf06ClaimContextUnavailableReason =
  | 'INVALID_CLAIM'
  | 'TRANSACTION_REQUIRED'
  | 'ABORTED'
  | 'SCHEMA_UNAVAILABLE'
  | 'CLAIM_NOT_ACTIVE'
  | 'SITE_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'INVALID_STORED_BINDING';

export type Mf06ClaimContextLookup =
  | Readonly<{ status: 'UNAVAILABLE'; reason: Mf06ClaimContextUnavailableReason }>
  | Readonly<{
      status: 'MATCHED';
      claim: Mf06JobClaim;
      siteId: string;
      request: Mf06CapturedRequest;
      contextDigest: string;
      claimContextDigest: string;
      subject: ObservationSubjectRef | null;
      frameReference: Mf06FrameReference | null;
    }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CLAIM_HEAD_REVISION = 2147483646;
const MAX_PG_INT32 = 2147483647;
const CLAIM_KEYS = [
  'requestId',
  'leaseToken',
  'headRevision',
  'attemptCount',
  'leaseExpiresAt',
  'deadlineAt',
] as const;
const REQUIRED_TABLES = [
  'site',
  'ai_observation_event',
  'zone_entry_assessment_request',
  'zone_entry_assessment_job',
] as const;

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const unavailable = (reason: Mf06ClaimContextUnavailableReason): Mf06ClaimContextLookup =>
  Object.freeze({ status: 'UNAVAILABLE', reason });

const isPlainDataRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    const desc = descriptors[key];
    if (
      !desc ||
      !('value' in desc) ||
      desc.get !== undefined ||
      desc.set !== undefined ||
      desc.enumerable !== true
    ) {
      return false;
    }
  }
  return true;
};

const parseCanonicalClaimTimestamp = (value: unknown): Date | null => {
  if (typeof value !== 'string' || /T\d{2}:\d{2}:60/.test(value)) return null;
  return parseNormalizedCapturedAt(value);
};

const parseDbTimestamp = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'string') return parseCanonicalClaimTimestamp(value);
  return null;
};

type ValidatedClaim = Readonly<{
  claim: Mf06JobClaim;
  leaseExpiresTimeMs: number;
  deadlineTimeMs: number;
}>;

const validateClaimInput = (input: unknown): ValidatedClaim | null => {
  if (!isPlainDataRecord(input)) return null;
  const keys = Object.keys(input);
  if (
    keys.length !== CLAIM_KEYS.length ||
    !CLAIM_KEYS.every((requiredKey) => Object.hasOwn(input, requiredKey))
  ) {
    return null;
  }

  const requestId = input.requestId;
  const leaseToken = input.leaseToken;
  const headRevision = input.headRevision;
  const attemptCount = input.attemptCount;
  const leaseExpiresDate = parseCanonicalClaimTimestamp(input.leaseExpiresAt);
  const deadlineDate = parseCanonicalClaimTimestamp(input.deadlineAt);

  if (
    typeof requestId !== 'string' ||
    !UUID_RE.test(requestId) ||
    typeof leaseToken !== 'string' ||
    !UUID_RE.test(leaseToken) ||
    typeof headRevision !== 'number' ||
    !Number.isSafeInteger(headRevision) ||
    headRevision < 1 ||
    headRevision > MAX_CLAIM_HEAD_REVISION ||
    typeof attemptCount !== 'number' ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1 ||
    attemptCount > MAX_PG_INT32 ||
    !leaseExpiresDate ||
    !deadlineDate
  ) {
    return null;
  }

  const leaseExpiresTimeMs = leaseExpiresDate.getTime();
  const deadlineTimeMs = deadlineDate.getTime();
  if (leaseExpiresTimeMs > deadlineTimeMs) return null;

  return {
    claim: Object.freeze({
      requestId: requestId.toLowerCase(),
      leaseToken: leaseToken.toLowerCase(),
      headRevision,
      attemptCount,
      leaseExpiresAt: leaseExpiresDate.toISOString(),
      deadlineAt: deadlineDate.toISOString(),
    }),
    leaseExpiresTimeMs,
    deadlineTimeMs,
  };
};

type JobHeadRow = {
  request_id?: unknown;
  status?: unknown;
  lease_token?: unknown;
  head_revision?: unknown;
  attempt_count?: unknown;
  lease_expires_at?: unknown;
  deadline_at?: unknown;
  within_window?: unknown;
};

/**
 * Private claim-to-request/event binding primitive.
 * Validates an active CLAIMED MF06 job head and immutable request/event context
 * inside a single REPEATABLE READ READ ONLY snapshot without external I/O.
 * Mechanical context only: does not establish media, identity, consent, or authority.
 */
export class Mf06ClaimContextReader {
  constructor(private readonly db: DataSource) {}

  async readForClaim(claim: Mf06JobClaim, signal?: AbortSignal): Promise<Mf06ClaimContextLookup> {
    return this.read(claim, signal);
  }

  /** Caller acquires the authority fence first; preserve its transaction and search path. */
  async revalidateForClaim(
    manager: EntityManager,
    claim: Mf06JobClaim,
    signal?: AbortSignal,
  ): Promise<Mf06ClaimContextLookup> {
    if (
      manager?.connection !== this.db ||
      manager.queryRunner?.isTransactionActive !== true ||
      manager.queryRunner.isReleased !== false
    )
      return unavailable('TRANSACTION_REQUIRED');
    return this.read(claim, signal, manager);
  }

  private async read(
    claim: Mf06JobClaim,
    signal?: AbortSignal,
    finalizationManager?: EntityManager,
  ): Promise<Mf06ClaimContextLookup> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      return unavailable('INVALID_CLAIM');
    }
    if (signal?.aborted) {
      return unavailable('ABORTED');
    }

    const validated = validateClaimInput(claim);
    if (!validated) {
      return unavailable('INVALID_CLAIM');
    }

    const selectedSchema = (this.db?.driver as { schema?: unknown } | undefined)?.schema;
    if (
      typeof selectedSchema !== 'string' ||
      selectedSchema.length === 0 ||
      selectedSchema.includes('\0')
    ) {
      return unavailable('SCHEMA_UNAVAILABLE');
    }

    const { claim: normalizedClaim, leaseExpiresTimeMs, deadlineTimeMs } = validated;

    const read = async (manager: EntityManager): Promise<Mf06ClaimContextLookup> => {
      if (signal?.aborted) return unavailable('ABORTED');

      if (finalizationManager) {
        const [scope] = await manager.query(
          `SELECT current_schema()=$1::text AND pg_catalog.pg_my_temp_schema()=0
            AND current_setting('search_path')=quote_ident($1::text)
            AND current_setting('transaction_isolation')='serializable'
            AND current_setting('transaction_read_only')='off' AS transaction_valid`,
          [selectedSchema],
        );
        if (signal?.aborted) return unavailable('ABORTED');
        if (scope?.transaction_valid !== true) return unavailable('TRANSACTION_REQUIRED');
      } else {
        await manager.query('SET TRANSACTION READ ONLY');
        if (signal?.aborted) return unavailable('ABORTED');

        await manager.query("SET LOCAL statement_timeout='5s'");
        if (signal?.aborted) return unavailable('ABORTED');

        const schemaCheck = (await manager.query(
          `SELECT current_schema() = $1::text AS schema_matches,
                bool_and(to_regclass(format('%I.%I', $1::text, names.name)) IS NOT NULL) AS tables_present
         FROM unnest($2::text[]) AS names(name)`,
          [selectedSchema, REQUIRED_TABLES],
        )) as { schema_matches?: boolean; tables_present?: boolean }[];
        if (signal?.aborted) return unavailable('ABORTED');
        if (!schemaCheck[0]?.schema_matches || !schemaCheck[0]?.tables_present) {
          return unavailable('SCHEMA_UNAVAILABLE');
        }

        await manager.query(
          `LOCK TABLE ${REQUIRED_TABLES.map((table) => `${quoteIdentifier(selectedSchema)}.${quoteIdentifier(table)}`).join(', ')} IN ACCESS SHARE MODE`,
        );
        if (signal?.aborted) return unavailable('ABORTED');

        await manager.query(
          `SELECT set_config('search_path', quote_ident($1) || ', pg_temp', true)`,
          [selectedSchema],
        );
        if (signal?.aborted) return unavailable('ABORTED');
      }
      const verifyActiveJobHead = async (): Promise<boolean> => {
        const jobRows = (await manager.query(
          `SELECT request_id,
                  status,
                  lease_token,
                  head_revision,
                  attempt_count,
                  lease_expires_at,
                  deadline_at,
                  (statement_timestamp() < lease_expires_at AND statement_timestamp() < deadline_at) AS within_window
           FROM ${quoteIdentifier(selectedSchema)}."zone_entry_assessment_job"
           WHERE request_id = $1`,
          [normalizedClaim.requestId],
        )) as JobHeadRow[];
        const job = Array.isArray(jobRows) && jobRows.length === 1 ? jobRows[0] : undefined;
        const dbLeaseExpires = parseDbTimestamp(job?.lease_expires_at);
        const dbDeadline = parseDbTimestamp(job?.deadline_at);
        const dbHeadRevision = Number(job?.head_revision);
        const dbAttemptCount = Number(job?.attempt_count);

        return Boolean(
          job &&
          typeof job.request_id === 'string' &&
          job.request_id.toLowerCase() === normalizedClaim.requestId &&
          job.status === 'CLAIMED' &&
          typeof job.lease_token === 'string' &&
          job.lease_token.toLowerCase() === normalizedClaim.leaseToken &&
          Number.isSafeInteger(dbHeadRevision) &&
          dbHeadRevision === normalizedClaim.headRevision &&
          Number.isSafeInteger(dbAttemptCount) &&
          dbAttemptCount === normalizedClaim.attemptCount &&
          dbLeaseExpires &&
          dbLeaseExpires.getTime() === leaseExpiresTimeMs &&
          dbDeadline &&
          dbDeadline.getTime() === deadlineTimeMs &&
          job.within_window === true,
        );
      };

      const initiallyActive = await verifyActiveJobHead();
      if (signal?.aborted) return unavailable('ABORTED');
      if (!initiallyActive) {
        return unavailable('CLAIM_NOT_ACTIVE');
      }

      const request = await manager
        .getRepository(ZoneEntryAssessmentRequestEntity)
        .findOneBy({ requestId: normalizedClaim.requestId });
      if (signal?.aborted) return unavailable('ABORTED');
      if (!request) return unavailable('REQUEST_NOT_FOUND');

      if (typeof request.siteId !== 'string' || !UUID_RE.test(request.siteId)) {
        return unavailable('INVALID_STORED_BINDING');
      }
      const derivedSiteId = request.siteId.toLowerCase();

      const sites = (await manager.query('SELECT id FROM site WHERE id = $1', [derivedSiteId])) as {
        id?: unknown;
      }[];
      if (signal?.aborted) return unavailable('ABORTED');
      if (
        !Array.isArray(sites) ||
        sites.length !== 1 ||
        typeof sites[0]?.id !== 'string' ||
        sites[0].id.toLowerCase() !== derivedSiteId
      ) {
        return unavailable('SITE_NOT_FOUND');
      }

      if (typeof request.eventId !== 'string' || !UUID_RE.test(request.eventId)) {
        return unavailable('INVALID_STORED_BINDING');
      }
      const event = await manager
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: request.eventId.toLowerCase() });
      if (signal?.aborted) return unavailable('ABORTED');
      if (!event) return unavailable('EVENT_NOT_FOUND');
      if (!(await loadMf06RequestAdmission(manager, event, request)))
        return unavailable('INVALID_STORED_BINDING');

      const inspected = inspectMf06StoredBinding(request, event);
      if (inspected.status !== 'MATCHED') {
        return unavailable(inspected.reason);
      }
      if (
        inspected.request.requestId !== normalizedClaim.requestId ||
        inspected.request.siteId !== derivedSiteId
      ) {
        return unavailable('INVALID_STORED_BINDING');
      }

      const claimContextDigest = computeCanonicalPayloadHash({
        schemaVersion: '1.0.0',
        kind: 'MF06_CLAIM_CONTEXT',
        claim: normalizedClaim,
        contextDigest: inspected.contextDigest,
      });

      const frameReference = selectMf06FrameReference(event.rawPayload, inspected.request);
      const stillActiveBeforeReturn = await verifyActiveJobHead();
      if (signal?.aborted) return unavailable('ABORTED');
      if (!stillActiveBeforeReturn) {
        return unavailable('CLAIM_NOT_ACTIVE');
      }

      return Object.freeze({
        status: 'MATCHED',
        claim: normalizedClaim,
        siteId: derivedSiteId,
        request: inspected.request,
        contextDigest: inspected.contextDigest,
        claimContextDigest,
        subject: inspected.subject,
        frameReference,
      });
    };
    return finalizationManager
      ? read(finalizationManager)
      : this.db.transaction('REPEATABLE READ', read);
  }
}
