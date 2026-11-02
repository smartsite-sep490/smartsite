import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { isTransientDatabaseFailure } from '../../../common/database-errors.js';
import { Mf06RetryableWorkError } from './mf06-assessment-worker.service.js';
import { bindMf06FaceInvocation } from './mf06-face-binding.js';
import type { SafetyFaceCandidateReader } from '../../workforce/safety-face-candidate.reader.js';
import type {
  Mf06ClaimContextLookup,
  Mf06ClaimContextReader,
} from './mf06-claim-context.reader.js';
import type { Mf06JobClaim } from './mf06-job-lease.service.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import { prepareMf06FaceMedia, type Mf06PreparedFaceMedia } from './mf06-media-preparation.js';
import {
  inspectSafetyFaceResponse,
  type SafetyIdentityResolverPort,
} from './safety-identity-resolver.port.js';

type MatchedContext = Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }>;
type BoundMedia = Extract<Mf06PreparedFaceMedia, { state: 'BOUND_UNATTESTED' }>;
type FailureReason =
  | 'ABORTED'
  | 'CONTEXT_UNAVAILABLE'
  | 'MEDIA_UNAVAILABLE'
  | 'CANDIDATES_UNAVAILABLE'
  | 'IDENTITY_UNAVAILABLE'
  | 'PREPARATION_FAILED';
export type Mf06FacePreparationResult =
  | { state: 'PREPARED_UNATTESTED'; context: MatchedContext; media: BoundMedia; response: unknown }
  | { state: 'UNAVAILABLE'; reason: FailureReason };

/** Outside final database locks; a correlated Face candidate is not verified identity or authority. */
export class Mf06FacePreparation {
  constructor(
    private readonly contexts: Pick<Mf06ClaimContextReader, 'readForClaim'>,
    private readonly candidates: Pick<SafetyFaceCandidateReader, 'readForSafety'>,
    private readonly resolver: SafetyIdentityResolverPort,
    private readonly evidenceRoot: string,
    private readonly modelVersion: string,
  ) {}

  async prepare(claim: Mf06JobClaim, signal: AbortSignal): Promise<Mf06FacePreparationResult> {
    const unavailable = (reason: FailureReason): Mf06FacePreparationResult => ({
      state: 'UNAVAILABLE',
      reason,
    });
    let readingDatabase = false;
    try {
      if (signal.aborted) return unavailable('ABORTED');
      readingDatabase = true;
      const rawContext = await this.contexts.readForClaim(claim, signal);
      readingDatabase = false;
      const context = snapshotMf06Json(rawContext) as Mf06ClaimContextLookup;
      if (signal.aborted) return unavailable('ABORTED');
      if (context.status !== 'MATCHED') return unavailable('CONTEXT_UNAVAILABLE');
      let media = await prepareMf06FaceMedia(
        context,
        this.evidenceRoot,
        context.request.requestId,
        this.modelVersion,
        signal,
      );
      if (signal.aborted) return unavailable('ABORTED');
      if (media.state !== 'BOUND_UNATTESTED') return unavailable('MEDIA_UNAVAILABLE');
      readingDatabase = true;
      const rawLookup = await this.candidates.readForSafety(
        context.siteId,
        this.modelVersion,
        signal,
      );
      readingDatabase = false;
      const lookup = snapshotMf06Json(rawLookup) as Awaited<
        ReturnType<SafetyFaceCandidateReader['readForSafety']>
      >;
      if (signal.aborted) return unavailable('ABORTED');
      if (
        lookup.status !== 'AVAILABLE' ||
        !lookup.candidates.length ||
        lookup.candidates.length > 32
      )
        return unavailable('CANDIDATES_UNAVAILABLE');
      const invocationBytes = Buffer.from(
        computeCanonicalPayloadHash({
          algorithm: 'MF06_FACE_INVOCATION_V1',
          invocation: media.invocation,
          candidates: lookup.candidates,
        }).slice(0, 32),
        'hex',
      );
      // UUIDv8 identifies identical resolver input across leases; full binding SHA remains mandatory.
      invocationBytes[6] = (invocationBytes[6]! & 0x0f) | 0x80;
      invocationBytes[8] = (invocationBytes[8]! & 0x3f) | 0x80;
      const hex = invocationBytes.toString('hex');
      const invocationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const rebound = bindMf06FaceInvocation(context, media.crop, invocationId, this.modelVersion);
      if (rebound.state !== 'BOUND_UNATTESTED') return unavailable('MEDIA_UNAVAILABLE');
      media = { ...rebound, crop: media.crop };
      const response = snapshotMf06Json(
        await this.resolver.resolve(
          {
            invocation: { ...media.invocation },
            cropBytes: Buffer.from(media.crop.bytes),
            candidates: lookup.candidates.map((candidate) => ({ ...candidate })),
          },
          signal,
        ),
      );
      if (signal.aborted) return unavailable('ABORTED');
      const inspected = inspectSafetyFaceResponse(media.invocation, response, 'TRUSTED_SERVICE');
      if (
        inspected.state !== 'CANDIDATE_REFERENCE' ||
        !lookup.candidates.some(
          (candidate) =>
            candidate.profileReferenceHash === inspected.profileReferenceHash &&
            candidate.profileRevision === inspected.profileRevision,
        )
      )
        return unavailable('IDENTITY_UNAVAILABLE');
      return { state: 'PREPARED_UNATTESTED', context, media, response };
    } catch (error) {
      if (!signal.aborted && error instanceof Mf06RetryableWorkError) throw error;
      if (!signal.aborted && readingDatabase && isTransientDatabaseFailure(error))
        throw new Mf06RetryableWorkError('DATABASE_UNAVAILABLE');
      return unavailable(signal.aborted ? 'ABORTED' : 'PREPARATION_FAILED');
    }
  }
}
