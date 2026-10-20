import { randomUUID } from 'node:crypto';
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
    try {
      if (signal.aborted) return unavailable('ABORTED');
      const context = snapshotMf06Json(
        await this.contexts.readForClaim(claim, signal),
      ) as Mf06ClaimContextLookup;
      if (signal.aborted) return unavailable('ABORTED');
      if (context.status !== 'MATCHED') return unavailable('CONTEXT_UNAVAILABLE');
      const media = await prepareMf06FaceMedia(
        context,
        this.evidenceRoot,
        randomUUID(),
        this.modelVersion,
        signal,
      );
      if (signal.aborted) return unavailable('ABORTED');
      if (media.state !== 'BOUND_UNATTESTED') return unavailable('MEDIA_UNAVAILABLE');
      const lookup = snapshotMf06Json(
        await this.candidates.readForSafety(context.siteId, this.modelVersion, signal),
      ) as Awaited<ReturnType<SafetyFaceCandidateReader['readForSafety']>>;
      if (signal.aborted) return unavailable('ABORTED');
      if (
        lookup.status !== 'AVAILABLE' ||
        !lookup.candidates.length ||
        lookup.candidates.length > 32
      )
        return unavailable('CANDIDATES_UNAVAILABLE');
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
    } catch {
      return unavailable(signal.aborted ? 'ABORTED' : 'PREPARATION_FAILED');
    }
  }
}
