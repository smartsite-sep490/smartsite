import { Injectable } from '@nestjs/common';
import type { ResolvedObservationContext } from '../../zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from '../../zones/zone-authorization.service.js';

export interface AlertCandidate {
  alertType: 'PPE_VIOLATION' | 'RESTRICTED_ZONE_INTRUSION';
  candidateSubtype:
    | 'PPE_HARD_HAT_MISSING'
    | 'PPE_SAFETY_VEST_MISSING'
    | 'ZONE_ENTRY_PROHIBITED'
    | 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE'
    | 'ZONE_ENTRY_UNAUTHORIZED';
  cameraId: string;
  streamSessionId: string;
  zoneId?: string;
  trackId: number;
  groupingKey: string;
  candidateWorkerId?: string;
  identitySimilarityScore?: number;
  identityQualityScore?: number;
  details: Record<string, unknown>;
}

export interface PersonObservation {
  type: 'PERSON';
  trackId: number;
  confidence?: number;
  boundingBox?: Record<string, unknown>;
}

export interface PpeObservation {
  type: 'PPE';
  trackId: number;
  ppeItem: 'HARD_HAT' | 'SAFETY_VEST';
  status: 'PRESENT' | 'MISSING';
  regionId: string;
  geometryVersion: number;
  confidence?: number;
  boundingBox?: Record<string, unknown>;
}

export interface ZoneEntryObservation {
  type: 'ZONE_ENTRY';
  trackId: number;
  regionId: string;
  geometryVersion: number;
  confidence?: number;
}

export interface IdentityCandidateObservation {
  type: 'IDENTITY_CANDIDATE';
  trackId: number;
  status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE';
  candidateWorkerId?: string;
  similarityScore?: number;
  qualityScore?: number;
}

export type Observation =
  PersonObservation | PpeObservation | ZoneEntryObservation | IdentityCandidateObservation;

export interface EvaluationEvent {
  streamSessionId: string;
  cameraExternalId?: string;
  observations: Observation[];
}

export type ContextLookup =
  | ResolvedObservationContext
  | readonly ResolvedObservationContext[]
  | Map<string, ResolvedObservationContext>
  | ((regionId: string, geometryVersion: number) => ResolvedObservationContext | undefined);

function getContext(
  lookup: ContextLookup,
  regionId: string,
  geometryVersion: number,
): ResolvedObservationContext | undefined {
  let ctx: ResolvedObservationContext | undefined | null;

  if (typeof lookup === 'function') {
    ctx = lookup(regionId, geometryVersion);
  } else if (lookup instanceof Map) {
    ctx = lookup.get(`${regionId}:${geometryVersion}`);
  } else if (Array.isArray(lookup)) {
    ctx = lookup.find(
      (item) => item.regionId === regionId && item.geometryVersion === geometryVersion,
    );
  } else if (lookup && typeof lookup === 'object' && 'regionId' in lookup) {
    ctx = lookup;
  }

  // Strict boundary: validate that the resolved context matches the observation's exact regionId and geometryVersion
  if (ctx && ctx.regionId === regionId && ctx.geometryVersion === geometryVersion) {
    return ctx;
  }

  return undefined;
}

export function buildGroupingKey(
  candidateSubtype: string,
  cameraId: string,
  streamSessionId: string,
  zoneId: string | undefined,
  trackId: number,
): string {
  return `${candidateSubtype}:${cameraId}:${streamSessionId}:${zoneId ?? 'none'}:${trackId}`;
}

@Injectable()
export class AlertCandidateEvaluator {
  constructor(
    private readonly zoneAuthService: ZoneAuthorizationService = new ZoneAuthorizationService(),
  ) {}

  evaluate(event: EvaluationEvent, contextLookup: ContextLookup): AlertCandidate[] {
    // 1. Map non-authoritative identity evidence by trackId
    const identityEvidenceByTrack = new Map<
      number,
      {
        candidateWorkerId?: string;
        similarityScore?: number;
        qualityScore?: number;
      }
    >();

    for (const obs of event.observations) {
      if (obs.type === 'IDENTITY_CANDIDATE') {
        if (obs.status === 'CANDIDATE' && obs.candidateWorkerId) {
          identityEvidenceByTrack.set(obs.trackId, {
            candidateWorkerId: obs.candidateWorkerId,
            similarityScore: obs.similarityScore,
            qualityScore: obs.qualityScore,
          });
        } else if (obs.qualityScore !== undefined && !identityEvidenceByTrack.has(obs.trackId)) {
          identityEvidenceByTrack.set(obs.trackId, {
            qualityScore: obs.qualityScore,
          });
        }
      }
    }

    const uncollapsedCandidates: AlertCandidate[] = [];

    // 2. Evaluate observations
    for (const obs of event.observations) {
      if (obs.type === 'PERSON' || obs.type === 'IDENTITY_CANDIDATE') {
        continue;
      }

      if (obs.type === 'PPE') {
        if (obs.status === 'PRESENT') {
          continue;
        }

        const context = getContext(contextLookup, obs.regionId, obs.geometryVersion);
        if (!context) {
          continue;
        }

        const requiredPpe = context.zone.requiredPpe ?? [];
        if (!requiredPpe.includes(obs.ppeItem)) {
          continue;
        }

        const candidateSubtype =
          obs.ppeItem === 'HARD_HAT' ? 'PPE_HARD_HAT_MISSING' : 'PPE_SAFETY_VEST_MISSING';

        const identity = identityEvidenceByTrack.get(obs.trackId);
        const groupingKey = buildGroupingKey(
          candidateSubtype,
          context.cameraId,
          event.streamSessionId,
          context.zoneId,
          obs.trackId,
        );

        uncollapsedCandidates.push({
          alertType: 'PPE_VIOLATION',
          candidateSubtype,
          cameraId: context.cameraId,
          streamSessionId: event.streamSessionId,
          zoneId: context.zoneId,
          trackId: obs.trackId,
          groupingKey,
          candidateWorkerId: identity?.candidateWorkerId,
          identitySimilarityScore: identity?.similarityScore,
          identityQualityScore: identity?.qualityScore,
          details: {
            ppeItem: obs.ppeItem,
            regionId: obs.regionId,
            geometryVersion: obs.geometryVersion,
            confidence: obs.confidence,
            boundingBox: obs.boundingBox,
          },
        });
      } else if (obs.type === 'ZONE_ENTRY') {
        const context = getContext(contextLookup, obs.regionId, obs.geometryVersion);
        if (!context) {
          continue;
        }

        const decision = this.zoneAuthService.authorizeZoneEntry(context.zone);
        if (decision.status === 'ALLOWED') {
          continue;
        }

        const candidateSubtype =
          decision.candidateSubtype ??
          (decision.status === 'DENIED'
            ? 'ZONE_ENTRY_PROHIBITED'
            : 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');

        const identity = identityEvidenceByTrack.get(obs.trackId);
        const groupingKey = buildGroupingKey(
          candidateSubtype,
          context.cameraId,
          event.streamSessionId,
          context.zoneId,
          obs.trackId,
        );

        uncollapsedCandidates.push({
          alertType: 'RESTRICTED_ZONE_INTRUSION',
          candidateSubtype,
          cameraId: context.cameraId,
          streamSessionId: event.streamSessionId,
          zoneId: context.zoneId,
          trackId: obs.trackId,
          groupingKey,
          candidateWorkerId: identity?.candidateWorkerId,
          identitySimilarityScore: identity?.similarityScore,
          identityQualityScore: identity?.qualityScore,
          details: {
            reason: decision.reason,
            regionId: obs.regionId,
            geometryVersion: obs.geometryVersion,
            confidence: obs.confidence,
          },
        });
      }
    }

    // 3. Deduplicate candidates by groupingKey within the event
    const deduplicatedByKey = new Map<string, AlertCandidate>();
    for (const candidate of uncollapsedCandidates) {
      if (!deduplicatedByKey.has(candidate.groupingKey)) {
        deduplicatedByKey.set(candidate.groupingKey, candidate);
      } else {
        const existing = deduplicatedByKey.get(candidate.groupingKey)!;
        if (!existing.candidateWorkerId && candidate.candidateWorkerId) {
          existing.candidateWorkerId = candidate.candidateWorkerId;
          existing.identitySimilarityScore = candidate.identitySimilarityScore;
          existing.identityQualityScore = candidate.identityQualityScore;
        }
      }
    }

    return Array.from(deduplicatedByKey.values());
  }
}
