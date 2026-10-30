import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import { ZoneRestrictionPolicy } from '../../../database/entities/enums.js';
import type {
  Mf06AssessmentOutcome,
  Mf06AssessmentReasonCode,
} from '../../../database/entities/zone-entry-assessment.entity.js';
import {
  decodeStoredMainAuthorityArchive,
  parseMainAuthorityInstant,
  type MainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from '../../zones/main-authority-archive-codec.js';
import type {
  MainQualifiedAuthorityReader,
  MainQualifiedAuthorityResult,
  MainQualifiedAuthorityPrepared,
} from '../../zones/main-qualified-authority.reader.js';
import {
  Mf06RetryableWorkError,
  type Mf06AssessmentWorkPort,
} from './mf06-assessment-worker.service.js';
import type {
  Mf06AssessmentStore,
  Mf06AssessmentStoreResult,
} from './mf06-assessment-store.service.js';
import type {
  Mf06ClaimContextLookup,
  Mf06ClaimContextReader,
} from './mf06-claim-context.reader.js';
import type { Mf06JobClaim } from './mf06-job-lease.service.js';

interface Prepared {
  contextDigest: string;
  claimContextDigest: string;
  context: MainAuthorityArchiveContext;
  authority: MainQualifiedAuthorityResult;
  commandId: string;
}

/** Bound initial policy-only composition. AUTHORIZATION_REQUIRED still needs verified identity. */
export class Mf06BoundPolicyAssessmentWorkPort implements Mf06AssessmentWorkPort {
  readonly finalizationScope = 'AUTHORITY_SNAPSHOT' as const;
  private readonly prepared = new WeakMap<object, Prepared | null>();

  constructor(
    private readonly claims: Pick<Mf06ClaimContextReader, 'readForClaim' | 'revalidateForClaim'>,
    private readonly authority: Pick<
      MainQualifiedAuthorityReader,
      'prepareForEvent' | 'revalidate'
    >,
    private readonly store: Pick<Mf06AssessmentStore, 'finalizeInTransaction'>,
    private readonly environment: BackendEnvironment['NODE_ENV'],
  ) {
    if (!['development', 'test', 'production'].includes(environment))
      throw new Error('MF06_INVALID_WORK_ENVIRONMENT');
  }

  async prepare(claim: Mf06JobClaim, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const current = await this.claims.readForClaim(claim, signal);
    signal.throwIfAborted();
    const context = this.context(current);
    const handle = Object.freeze({ kind: 'MF06_BOUND_POLICY_WORK' });
    if (current.status !== 'MATCHED' || !context) {
      this.prepared.set(handle, null);
      return handle;
    }
    const authority = await this.authority.prepareForEvent(context, signal);
    signal.throwIfAborted();
    this.retryDatabase(authority);
    this.prepared.set(handle, {
      contextDigest: current.contextDigest,
      claimContextDigest: current.claimContextDigest,
      context: Object.freeze(context),
      authority,
      commandId: randomUUID(),
    });
    return handle;
  }

  async finalize(
    manager: EntityManager,
    claim: Mf06JobClaim,
    handle: unknown,
    signal: AbortSignal,
  ): Promise<Mf06AssessmentStoreResult> {
    signal.throwIfAborted();
    const saved = typeof handle === 'object' && handle !== null ? this.prepared.get(handle) : null;
    if (!saved) return { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' };
    const current = await this.claims.revalidateForClaim(manager, claim, signal);
    signal.throwIfAborted();
    if (current.status !== 'MATCHED')
      return {
        state: current.reason === 'CLAIM_NOT_ACTIVE' ? 'STALE' : 'UNAVAILABLE',
        reason: current.reason,
      };
    if (
      !this.context(current) ||
      current.contextDigest !== saved.contextDigest ||
      current.claimContextDigest !== saved.claimContextDigest
    )
      return { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' };

    let outcome: Mf06AssessmentOutcome = 'UNAVAILABLE';
    let reasonCode: Mf06AssessmentReasonCode = 'AUTHORITY_UNAVAILABLE';
    let artifact: MainAuthorityArchive | null = null;
    const candidate = saved.authority;
    if (candidate.status === 'QUALIFIED' && this.permitted(candidate)) {
      const checked = await this.authority.revalidate(
        manager,
        { ...saved.context, epochId: candidate.epochId },
        candidate,
      );
      signal.throwIfAborted();
      this.retryDatabase(checked);
      // Preserve the reader's attested prepared object, never substitute a copied archive handle.
      if (checked === candidate && this.permitted(candidate)) {
        const decoded = decodeStoredMainAuthorityArchive(candidate.archive, {
          ...saved.context,
          sha256: candidate.archive.sha256,
        });
        if (decoded.status === 'VALID') {
          const zone = decoded.archive.payload.sources
            .find((s) => s.sourceKind === 'ZONE_POLICY')
            ?.rows.find(
              (r) =>
                (r.id as string).toLowerCase() === saved.context.zoneId &&
                (r.site_id as string).toLowerCase() === saved.context.siteId,
            );
          switch (zone?.restriction_policy) {
            case ZoneRestrictionPolicy.NONE:
              outcome = 'ALLOWED';
              reasonCode = 'POLICY_NONE';
              artifact = decoded.archive;
              break;
            case ZoneRestrictionPolicy.PROHIBITED_FOR_ALL:
              outcome = 'DENIED';
              reasonCode = 'POLICY_PROHIBITED';
              artifact = decoded.archive;
              break;
            case ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED:
              reasonCode = 'IDENTITY_UNAVAILABLE';
              artifact = decoded.archive;
              break;
          }
        }
      }
    }
    signal.throwIfAborted();
    return this.store.finalizeInTransaction(manager, {
      claim: {
        requestId: claim.requestId,
        leaseToken: claim.leaseToken,
        headRevision: claim.headRevision,
      },
      commandId: saved.commandId,
      siteId: current.siteId,
      bindingHash: current.request.storedBindingHash,
      evaluatorVersion: 'MF06_BOUND_POLICY_V1',
      outcome,
      reasonCode,
      provenance:
        artifact && candidate.status === 'QUALIFIED' && candidate.provenance === 'SYNTHETIC_TEST'
          ? 'SYNTHETIC_TEST'
          : 'UNAVAILABLE',
      workerId: null,
      profileRevision: null,
      frameSha256: null,
      cropSha256: null,
      authorityArtifact: artifact,
    });
  }

  private context(current: Mf06ClaimContextLookup): MainAuthorityArchiveContext | null {
    if (
      current.status !== 'MATCHED' ||
      current.request.requestedPurpose !== 'INITIAL_OBSERVATION_ASSESSMENT' ||
      current.request.executionAdmission?.classification !== 'LIVE' ||
      current.request.subjectBindingStatus !== 'BOUND' ||
      !current.subject ||
      current.siteId !== current.request.siteId
    )
      return null;
    const stored = parseMainAuthorityInstant(current.request.capturedAt);
    const original = parseMainAuthorityInstant(current.subject.capturedAt);
    if (stored === null || original === null || stored !== original) return null;
    return {
      siteId: current.siteId,
      zoneId: current.request.zoneId,
      workerId: null,
      capturedAt: current.request.capturedAt,
      purpose: current.request.requestedPurpose,
    };
  }

  private permitted(value: MainQualifiedAuthorityPrepared): boolean {
    return (
      (value.provenance === 'OPERATIONAL_REVIEWED' &&
        value.operationalAuthorityCoverageEstablished === true &&
        value.syntheticCutoverMechanicsVerified === false) ||
      (this.environment === 'test' &&
        value.provenance === 'SYNTHETIC_TEST' &&
        value.syntheticCutoverMechanicsVerified === true &&
        value.operationalAuthorityCoverageEstablished === false)
    );
  }

  private retryDatabase(value: MainQualifiedAuthorityResult): void {
    if (value.status === 'UNAVAILABLE' && value.reason === 'DATABASE_UNAVAILABLE')
      throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
  }
}
