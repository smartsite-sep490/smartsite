import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { ObservationIdentityDecisionEntity } from '../../../database/entities/observation-identity-decision.entity.js';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import {
  ZoneAccessManagementService,
  type OriginalZoneDecisionSummary,
} from '../../zones/zone-access-management.service.js';
import { SafetyAlertEvidenceService } from '../alerts/safety-alert-evidence.service.js';
import { ObservationIdentityResolutionService } from './observation-identity-resolution.service.js';
import { reviewEventIsConsistent } from './observation-identity-event.js';
import { selectObservationSubject } from './observation-identity-subject.js';
import type { ObservationSubjectRef } from './observation-identity.types.js';
import type { WorkerReferenceReader } from './worker-reference.port.js';

interface TechnicalIdentityCandidate {
  status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE';
  candidateWorkerId?: string;
  similarityScore?: number;
  qualityScore?: number;
}
type ManualDecisionSummary = Pick<
  ObservationIdentityDecisionEntity,
  | 'id'
  | 'revision'
  | 'action'
  | 'workerId'
  | 'actorUserId'
  | 'reason'
  | 'scope'
  | 'verificationMethod'
  | 'recordedAt'
>;
type ResolveBlockReason =
  | 'EVENT_INCONSISTENT'
  | 'SUBJECT_UNAVAILABLE'
  | 'WORKER_READER_UNAVAILABLE'
  | 'FRAME_UNAVAILABLE'
  | 'REVISION_EXHAUSTED'
  | 'STATE_INCONSISTENT'
  | null;
export interface ObservationIdentityContext {
  eventId: string;
  payloadHash: string;
  eventConsistent: boolean;
  frames: { index: number; kind: 'FRAME'; sha256: string | null; available: boolean }[];
  subjects: {
    personObservationIndex: number;
    trackId: number | null;
    subjectRef: ObservationSubjectRef | null;
    subjectRefSource: 'RAW_EVENT' | 'PERSISTED_REVIEW' | null;
    technicalIdentity: {
      status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFLICTED';
      candidates: TechnicalIdentityCandidate[];
    };
    latestManualDecision: ManualDecisionSummary | null;
    revision: number;
    canResolve: boolean;
    resolveBlockReason: ResolveBlockReason;
    canClear: boolean;
    clearBlockReason: 'NO_ACTIVE_RESOLUTION' | 'STATE_INCONSISTENT' | 'REVISION_EXHAUSTED' | null;
    originalZoneDecisions: { items: OriginalZoneDecisionSummary[]; total: number };
  }[];
}

@Injectable()
export class ObservationIdentityContextService {
  constructor(
    private readonly resolutions: ObservationIdentityResolutionService,
    private readonly evidence: SafetyAlertEvidenceService,
    private readonly zones: ZoneAccessManagementService,
    private readonly workers?: WorkerReferenceReader,
  ) {}

  async get(siteId: string, alertId: string, eventId: string): Promise<ObservationIdentityContext> {
    const site = uuid(siteId).toLowerCase(),
      alert = uuid(alertId).toLowerCase(),
      eventIdValue = uuid(eventId).toLowerCase();
    const { event, heads } = await this.resolutions.readContextRecords(site, alert, eventIdValue);
    const consistent = reviewEventIsConsistent(event);
    const raw = event.rawPayload as {
      observations?: Record<string, unknown>[];
      capturedAt?: string;
    };
    const observations = consistent ? raw.observations! : [];
    const frames: ObservationIdentityContext['frames'] = [];
    if (consistent) {
      for (const descriptor of this.evidence.summarize(event.rawPayload, event.eventId)) {
        if (descriptor.kind !== 'FRAME') continue;
        let sha256: string | null = null;
        if (descriptor.available) {
          try {
            sha256 = (
              await this.evidence.readFrameForIdentityReview(
                site,
                alert,
                eventIdValue,
                String(descriptor.index),
                event.payloadHash,
              )
            ).sha256;
          } catch (error) {
            if (!(error instanceof PublicHttpException)) throw error;
          }
        }
        frames.push({ index: descriptor.index, kind: 'FRAME', sha256, available: sha256 !== null });
      }
    }
    const byIndex = new Map(heads.map((record) => [record.head.personObservationIndex, record]));
    const indices = new Set(
      observations.flatMap((observation, index) => (observation.type === 'PERSON' ? [index] : [])),
    );
    for (const index of byIndex.keys()) indices.add(index);
    const subjects: ObservationIdentityContext['subjects'] = [];
    for (const index of [...indices].sort((a, b) => a - b)) {
      const record = byIndex.get(index),
        head = record?.head,
        decision = record?.decision ?? null;
      const persistedRef = head ? this.projectPersistedRef(head.subjectRef) : null;
      const selection = selectObservationSubject(consistent ? event.rawPayload : null, index);
      const ref =
        consistent && selection.eligible
          ? this.ref(event, index, selection.trackId, selection.personBoundingBox)
          : persistedRef;
      const snapshotValid =
        !!head &&
        head.siteId === site &&
        head.eventId === eventIdValue &&
        head.payloadHash === event.payloadHash &&
        !!persistedRef &&
        persistedRef.payloadHash === head.payloadHash &&
        persistedRef.personObservationIndex === index &&
        persistedRef.eventId === eventIdValue &&
        !!decision &&
        decision.id === head.currentDecisionId &&
        decision.revision === head.revision &&
        decision.resolutionId === head.id &&
        decision.siteId === site;
      const revision = head?.revision ?? 0;
      const resolveBlockReason: ResolveBlockReason =
        head && !snapshotValid
          ? 'STATE_INCONSISTENT'
          : !consistent
            ? 'EVENT_INCONSISTENT'
            : !selection.eligible
              ? 'SUBJECT_UNAVAILABLE'
              : revision === 2147483647
                ? 'REVISION_EXHAUSTED'
                : !this.workers
                  ? 'WORKER_READER_UNAVAILABLE'
                  : !frames.some((frame) => frame.available)
                    ? 'FRAME_UNAVAILABLE'
                    : null;
      const clearBlockReason: ObservationIdentityContext['subjects'][number]['clearBlockReason'] =
        head && !snapshotValid
          ? 'STATE_INCONSISTENT'
          : revision === 2147483647
            ? 'REVISION_EXHAUSTED'
            : decision?.action !== 'RESOLVE'
              ? 'NO_ACTIVE_RESOLUTION'
              : null;
      const trackId = selection.eligible ? selection.trackId : (ref?.trackId ?? null);
      subjects.push({
        personObservationIndex: index,
        trackId,
        subjectRef: ref,
        subjectRefSource:
          consistent && selection.eligible ? 'RAW_EVENT' : ref ? 'PERSISTED_REVIEW' : null,
        technicalIdentity: this.technicalIdentity(
          observations,
          trackId,
          consistent && selection.eligible,
        ),
        latestManualDecision: decision && snapshotValid ? this.summary(decision) : null,
        revision,
        canResolve: resolveBlockReason === null,
        resolveBlockReason,
        canClear: clearBlockReason === null,
        clearBlockReason,
        originalZoneDecisions:
          trackId === null
            ? { items: [], total: 0 }
            : await this.zones.listObservationDecisions(site, eventIdValue, trackId, 0, 100),
      });
    }
    return {
      eventId: eventIdValue,
      payloadHash: event.payloadHash,
      eventConsistent: consistent,
      frames,
      subjects,
    };
  }

  private summary(d: ObservationIdentityDecisionEntity): ManualDecisionSummary {
    const {
      id,
      revision,
      action,
      workerId,
      actorUserId,
      reason,
      scope,
      verificationMethod,
      recordedAt,
    } = d;
    return {
      id,
      revision,
      action,
      workerId,
      actorUserId,
      reason,
      scope,
      verificationMethod,
      recordedAt,
    };
  }

  private projectPersistedRef(value: unknown): ObservationSubjectRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ref = value as ObservationSubjectRef;
    if (
      typeof ref.eventId !== 'string' ||
      !isUUID(ref.eventId) ||
      typeof ref.cameraId !== 'string' ||
      !isUUID(ref.cameraId) ||
      typeof ref.streamSessionId !== 'string' ||
      !isUUID(ref.streamSessionId) ||
      typeof ref.payloadHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(ref.payloadHash) ||
      !Number.isInteger(ref.personObservationIndex) ||
      ref.personObservationIndex < 0 ||
      ref.personObservationIndex > 255 ||
      typeof ref.cameraExternalId !== 'string' ||
      ref.cameraExternalId.length < 1 ||
      ref.cameraExternalId.length > 128 ||
      ref.cameraExternalId.includes('\u0000') ||
      typeof ref.capturedAt !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt](?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(
        ref.capturedAt,
      ) ||
      !ref.personBoundingBox ||
      typeof ref.personBoundingBox !== 'object'
    )
      return null;
    const { x1, y1, x2, y2, coordinateSpace } = ref.personBoundingBox;
    const selected = selectObservationSubject(
      {
        observations: [
          {
            type: 'PERSON',
            trackId: ref.trackId,
            boundingBox: { x1, y1, x2, y2, coordinateSpace },
          },
        ],
      },
      0,
    );
    if (!selected.eligible) return null;
    return {
      eventId: ref.eventId,
      personObservationIndex: ref.personObservationIndex,
      payloadHash: ref.payloadHash,
      cameraId: ref.cameraId,
      cameraExternalId: ref.cameraExternalId,
      streamSessionId: ref.streamSessionId,
      capturedAt: ref.capturedAt,
      trackId: selected.trackId,
      personBoundingBox: selected.personBoundingBox,
    };
  }
  private ref(
    event: AiObservationEventEntity,
    index: number,
    trackId: number,
    box: ObservationSubjectRef['personBoundingBox'],
  ): ObservationSubjectRef {
    return {
      eventId: event.eventId,
      personObservationIndex: index,
      payloadHash: event.payloadHash,
      cameraId: event.resolvedCameraId!,
      cameraExternalId: event.cameraExternalId,
      streamSessionId: event.streamSessionId,
      capturedAt: (event.rawPayload as { capturedAt: string }).capturedAt,
      trackId,
      personBoundingBox: box,
    };
  }
  private technicalIdentity(
    observations: Record<string, unknown>[],
    trackId: number | null,
    eligible: boolean,
  ): ObservationIdentityContext['subjects'][number]['technicalIdentity'] {
    if (!eligible) return { status: 'UNAVAILABLE', candidates: [] };
    const candidates = observations
      .filter((o) => o.type === 'IDENTITY_CANDIDATE' && o.trackId === trackId)
      .map((o) => ({
        status: o.status as TechnicalIdentityCandidate['status'],
        ...(o.status === 'CANDIDATE'
          ? {
              candidateWorkerId: o.candidateWorkerId as string,
              similarityScore: o.similarityScore as number,
            }
          : {}),
        ...(o.qualityScore === undefined ? {} : { qualityScore: o.qualityScore as number }),
      }));
    const keys = new Set(candidates.map((c) => `${c.status}:${c.candidateWorkerId ?? ''}`));
    return {
      status: keys.size > 1 ? 'CONFLICTED' : (candidates[0]?.status ?? 'UNKNOWN'),
      candidates,
    };
  }
}
