import { ApiProperty } from '@nestjs/swagger';
import {
  parseObservationIdentityContextResponse,
  parseObservationIdentityDecisionPage,
  parseObservationIdentityMutationResponse,
  type ObservationIdentityContextResponse,
  type ObservationIdentityDecisionResponse,
  type ObservationIdentityMutationResponse,
  type ObservationIdentitySubjectRef,
  type Page,
} from '@smartsite/contracts/management';
import type { ObservationIdentityDecisionEntity } from '../../../database/entities/observation-identity-decision.entity.js';
import type { ObservationIdentityContext } from './observation-identity-context.service.js';
import type { ObservationIdentityDecisionResult } from './observation-identity-resolution.service.js';
import type { ObservationSubjectRef } from './observation-identity.types.js';

class PersonBoxDto {
  @ApiProperty({ minimum: 0, maximum: 1 }) x1!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) y1!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) x2!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) y2!: number;
  @ApiProperty({ enum: ['NORMALIZED_0_1'] }) coordinateSpace!: 'NORMALIZED_0_1';
}
export class ObservationIdentitySubjectRefDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ minimum: 0, maximum: 255 }) personObservationIndex!: number;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) payloadHash!: string;
  @ApiProperty({ format: 'uuid' }) cameraId!: string;
  @ApiProperty({ minLength: 1, maxLength: 128 }) cameraExternalId!: string;
  @ApiProperty({ format: 'uuid' }) streamSessionId!: string;
  @ApiProperty({ format: 'date-time' }) capturedAt!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) trackId!: number;
  @ApiProperty({ type: PersonBoxDto }) personBoundingBox!: PersonBoxDto;
}
export class ObservationIdentityManualDecisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) revision!: number;
  @ApiProperty({ enum: ['RESOLVE', 'CLEAR'] }) action!: 'RESOLVE' | 'CLEAR';
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) workerId!: string | null;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ minLength: 5, maxLength: 1000 }) reason!: string;
  @ApiProperty({ enum: ['EXACT_OBSERVATION'] }) scope!: 'EXACT_OBSERVATION';
  @ApiProperty({ enum: ['MANUAL'] }) verificationMethod!: 'MANUAL';
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class ObservationIdentityDecisionDto extends ObservationIdentityManualDecisionDto {
  @ApiProperty({ type: ObservationIdentitySubjectRefDto })
  subjectRef!: ObservationIdentitySubjectRefDto;
  @ApiProperty({ type: Number, minimum: 0, maximum: 255, nullable: true }) evidenceIndex!:
    number | null;
  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$', nullable: true }) evidenceSha256!:
    string | null;
}
export class ObservationIdentityMutationDto {
  @ApiProperty({ type: ObservationIdentityDecisionDto })
  recordedDecision!: ObservationIdentityDecisionDto;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) latestRevision!: number;
  @ApiProperty() replayed!: boolean;
}
export class ObservationIdentityDecisionPageDto {
  @ApiProperty({ type: [ObservationIdentityDecisionDto], maxItems: 100 })
  items!: ObservationIdentityDecisionDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}
export class ObservationIdentityWorkerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty({ minLength: 1, maxLength: 128 }) externalId!: string;
  @ApiProperty({ minLength: 1, maxLength: 255 }) displayName!: string;
  @ApiProperty() isActive!: boolean;
}
export class ObservationIdentityWorkerPageDto {
  @ApiProperty({ type: [ObservationIdentityWorkerDto], maxItems: 100 })
  items!: ObservationIdentityWorkerDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}
class IdentityFrameDto {
  @ApiProperty({ minimum: 0, maximum: 255 }) index!: number;
  @ApiProperty({ enum: ['FRAME'] }) kind!: 'FRAME';
  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$', nullable: true }) sha256!: string | null;
  @ApiProperty() available!: boolean;
}
class TechnicalCandidateDto {
  @ApiProperty({ enum: ['CANDIDATE', 'UNKNOWN', 'UNAVAILABLE'] }) status!: string;
  @ApiProperty({ required: false, minLength: 1, maxLength: 128 }) candidateWorkerId?: string;
  @ApiProperty({ required: false, minimum: 0, maximum: 1 }) similarityScore?: number;
  @ApiProperty({ required: false, minimum: 0, maximum: 1 }) qualityScore?: number;
}
class TechnicalIdentityDto {
  @ApiProperty({ enum: ['CANDIDATE', 'UNKNOWN', 'UNAVAILABLE', 'CONFLICTED'] }) status!: string;
  @ApiProperty({ type: [TechnicalCandidateDto], maxItems: 256 })
  candidates!: TechnicalCandidateDto[];
}
class OriginalZoneDecisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) zoneId!: string;
  @ApiProperty({ enum: ['ALLOWED', 'DENIED', 'UNAVAILABLE'] }) status!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ format: 'date-time' }) evaluatedAt!: string;
}
class OriginalZoneDecisionPageDto {
  @ApiProperty({ type: [OriginalZoneDecisionDto], maxItems: 100 })
  items!: OriginalZoneDecisionDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}
class IdentitySubjectDto {
  @ApiProperty({ minimum: 0, maximum: 255 }) personObservationIndex!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  trackId!: number | null;
  @ApiProperty({ type: ObservationIdentitySubjectRefDto, nullable: true })
  subjectRef!: ObservationIdentitySubjectRefDto | null;
  @ApiProperty({ enum: ['RAW_EVENT', 'PERSISTED_REVIEW'], nullable: true }) subjectRefSource!:
    string | null;
  @ApiProperty({ type: TechnicalIdentityDto }) technicalIdentity!: TechnicalIdentityDto;
  @ApiProperty({ type: ObservationIdentityManualDecisionDto, nullable: true })
  latestManualDecision!: ObservationIdentityManualDecisionDto | null;
  @ApiProperty({ minimum: 0, maximum: 2147483647 }) revision!: number;
  @ApiProperty() canResolve!: boolean;
  @ApiProperty({
    enum: [
      'EVENT_INCONSISTENT',
      'SUBJECT_UNAVAILABLE',
      'WORKER_READER_UNAVAILABLE',
      'FRAME_UNAVAILABLE',
      'REVISION_EXHAUSTED',
      'STATE_INCONSISTENT',
    ],
    nullable: true,
  })
  resolveBlockReason!: string | null;
  @ApiProperty() canClear!: boolean;
  @ApiProperty({
    enum: ['NO_ACTIVE_RESOLUTION', 'STATE_INCONSISTENT', 'REVISION_EXHAUSTED'],
    nullable: true,
  })
  clearBlockReason!: string | null;
  @ApiProperty({ type: OriginalZoneDecisionPageDto })
  originalZoneDecisions!: OriginalZoneDecisionPageDto;
}
export class ObservationIdentityContextDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) payloadHash!: string;
  @ApiProperty() eventConsistent!: boolean;
  @ApiProperty({ type: [IdentityFrameDto], maxItems: 256 }) frames!: IdentityFrameDto[];
  @ApiProperty({ type: [IdentitySubjectDto], maxItems: 256 }) subjects!: IdentitySubjectDto[];
}

function checked<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Invalid internal observation identity projection');
  return value;
}
function copyRef(ref: ObservationSubjectRef): ObservationIdentitySubjectRef {
  const {
    eventId,
    personObservationIndex,
    payloadHash,
    cameraId,
    cameraExternalId,
    streamSessionId,
    capturedAt,
    trackId,
  } = ref;
  const { x1, y1, x2, y2, coordinateSpace } = ref.personBoundingBox;
  return {
    eventId,
    personObservationIndex,
    payloadHash,
    cameraId,
    cameraExternalId,
    streamSessionId,
    capturedAt,
    trackId,
    personBoundingBox: { x1, y1, x2, y2, coordinateSpace },
  };
}
function decisionResponse(
  d: ObservationIdentityDecisionEntity,
  ref: ObservationSubjectRef,
): ObservationIdentityDecisionResponse {
  const {
    id,
    revision,
    action,
    workerId,
    actorUserId,
    reason,
    scope,
    verificationMethod,
    evidenceIndex,
    evidenceSha256,
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
    recordedAt: d.recordedAt.toISOString(),
    subjectRef: copyRef(ref),
    evidenceIndex,
    evidenceSha256,
  };
}
export function identityMutationResponse(
  result: ObservationIdentityDecisionResult,
): ObservationIdentityMutationResponse {
  return checked(
    parseObservationIdentityMutationResponse({
      recordedDecision: decisionResponse(result.decision, result.latestHead.subjectRef),
      latestRevision: result.latestHead.revision,
      replayed: result.replayed,
    }),
  );
}
export function identityDecisionPageResponse(
  result: { items: ObservationIdentityDecisionEntity[]; total: number },
  ref: ObservationSubjectRef | null,
): Page<ObservationIdentityDecisionResponse> {
  if (result.items.length && !ref) throw new Error('Missing internal observation identity subject');
  return checked(
    parseObservationIdentityDecisionPage({
      items: result.items.map((d) => decisionResponse(d, ref!)),
      total: result.total,
    }),
  );
}
export function identityContextResponse(
  context: ObservationIdentityContext,
): ObservationIdentityContextResponse {
  return checked(
    parseObservationIdentityContextResponse({
      ...context,
      subjects: context.subjects.map((s) => ({
        ...s,
        latestManualDecision: s.latestManualDecision
          ? {
              ...s.latestManualDecision,
              recordedAt: s.latestManualDecision.recordedAt.toISOString(),
            }
          : null,
        originalZoneDecisions: {
          ...s.originalZoneDecisions,
          items: s.originalZoneDecisions.items.map((d) => ({
            ...d,
            evaluatedAt: d.evaluatedAt.toISOString(),
          })),
        },
      })),
    }),
  );
}
