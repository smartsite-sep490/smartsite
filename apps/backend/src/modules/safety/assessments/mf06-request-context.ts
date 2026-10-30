import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { DataSource } from 'typeorm';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../../../database/entities/enums.js';
import type { ObservationSubjectRef } from '../identity/observation-identity.types.js';
import { readConsistentMf06RawEvent } from './mf06-observation-event.js';
import { selectZoneEntrySubject } from '../identity/observation-identity-subject.js';

/** Internal immutable projection. It is not a public DTO or an approved resolver wire contract. */
export type Mf06CapturedRequest = Readonly<
  Omit<ZoneEntryAssessmentRequestEntity, 'capturedAt' | 'requestedAt' | 'bindingHash'> & {
    capturedAt: string;
    requestedAt: string;
    storedBindingHash: string;
  }
>;

export type Mf06StoredBindingInspection =
  | {
      status: 'UNAVAILABLE';
      reason: 'INVALID_STORED_BINDING' | 'REQUEST_NOT_FOUND' | 'EVENT_NOT_FOUND';
    }
  | {
      status: 'MATCHED';
      request: Mf06CapturedRequest;
      contextDigest: string;
      subject: ObservationSubjectRef | null;
    };

const validUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());
const record = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sameUuid = (left: unknown, right: unknown): boolean =>
  validUuid(left) && validUuid(right) && left.toLowerCase() === right.toLowerCase();

/**
 * Mechanical consistency only. Site/Zone/captured camera provenance comes from the
 * immutable server-owned request and its insertion guards, not a current registry.
 * MATCHED establishes neither Worker identity, media provenance nor Zone authority.
 * The opaque stored binding hash is carried unchanged, never certified by this reader.
 */
export function inspectMf06StoredBinding(
  request: ZoneEntryAssessmentRequestEntity,
  event: AiObservationEventEntity,
): Mf06StoredBindingInspection {
  const invalid: Mf06StoredBindingInspection = {
    status: 'UNAVAILABLE',
    reason: 'INVALID_STORED_BINDING',
  };
  if (
    !record(request) ||
    !record(event) ||
    ![
      request.requestId,
      request.eventId,
      request.siteId,
      request.cameraId,
      request.streamSessionId,
      request.regionId,
      request.zoneId,
    ].every(validUuid) ||
    !validHash(request.payloadHash) ||
    !validHash(request.bindingHash) ||
    !validDate(request.capturedAt) ||
    !validDate(request.requestedAt) ||
    !validDate(event.capturedAt) ||
    !Number.isSafeInteger(request.requestRevision) ||
    request.requestRevision < 1 ||
    request.requestRevision > 2147483647 ||
    !['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW'].includes(
      request.requestedPurpose,
    ) ||
    !sameUuid(request.eventId, event.eventId) ||
    request.payloadHash !== event.payloadHash ||
    request.cameraExternalId !== event.cameraExternalId ||
    !sameUuid(request.streamSessionId, event.streamSessionId) ||
    request.capturedAt.getTime() !== event.capturedAt.getTime() ||
    // Explicit NULL is the FK's historical camera-deletion state; undefined is invalid.
    (event.resolvedCameraId !== null && !sameUuid(request.cameraId, event.resolvedCameraId)) ||
    ![EventProcessingStatus.PROCESSED, EventProcessingStatus.SKIPPED_NO_CANDIDATE].includes(
      event.processingStatus,
    )
  )
    return invalid;
  const raw = readConsistentMf06RawEvent(event);
  if (!raw) return invalid;
  const selected = selectZoneEntrySubject(raw, request.zoneObservationIndex);
  if (
    !selected.zoneEligible ||
    selected.trackId !== request.trackId ||
    !sameUuid(selected.regionId, request.regionId) ||
    selected.geometryVersion !== request.geometryVersion ||
    selected.personObservationIndex !== request.personObservationIndex ||
    selected.subjectBindingStatus !== request.subjectBindingStatus
  )
    return invalid;
  const captured: Mf06CapturedRequest = Object.freeze({
    requestId: request.requestId.toLowerCase(),
    eventId: request.eventId.toLowerCase(),
    payloadHash: request.payloadHash,
    personObservationIndex: selected.personObservationIndex,
    zoneObservationIndex: selected.zoneObservationIndex,
    subjectBindingStatus: selected.subjectBindingStatus,
    trackId: selected.trackId,
    siteId: request.siteId.toLowerCase(),
    cameraId: request.cameraId.toLowerCase(),
    cameraExternalId: request.cameraExternalId,
    streamSessionId: request.streamSessionId.toLowerCase(),
    regionId: request.regionId.toLowerCase(),
    geometryVersion: selected.geometryVersion,
    zoneId: request.zoneId.toLowerCase(),
    capturedAt: request.capturedAt.toISOString(),
    requestedPurpose: request.requestedPurpose,
    requestRevision: request.requestRevision,
    storedBindingHash: request.bindingHash,
    requestedAt: request.requestedAt.toISOString(),
  });
  const rawCapturedAt = raw.capturedAt as string;
  const subject: ObservationSubjectRef | null =
    selected.subjectBindingStatus === 'BOUND'
      ? Object.freeze({
          eventId: captured.eventId,
          personObservationIndex: selected.personObservationIndex,
          payloadHash: captured.payloadHash,
          cameraId: captured.cameraId,
          cameraExternalId: captured.cameraExternalId,
          streamSessionId: captured.streamSessionId,
          capturedAt: rawCapturedAt,
          trackId: selected.trackId,
          personBoundingBox: Object.freeze({ ...selected.personBoundingBox }),
        })
      : null;
  return Object.freeze({
    status: 'MATCHED',
    request: captured,
    subject,
    contextDigest: computeCanonicalPayloadHash({
      algorithm: 'MF06_STORED_REQUEST_CONTEXT_V1',
      request: captured,
      subject,
    }),
  });
}

/** Feature-internal, read-only. Caller must separately authorize access; no resolver/worker is registered here. */
export class Mf06RequestContextReader {
  constructor(private readonly dataSource: DataSource) {}
  async load(siteId: string, requestId: string): Promise<Mf06StoredBindingInspection> {
    if (!validUuid(siteId) || !validUuid(requestId))
      return { status: 'UNAVAILABLE', reason: 'INVALID_STORED_BINDING' };
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const request = await manager
        .getRepository(ZoneEntryAssessmentRequestEntity)
        .findOneBy({ requestId: requestId.toLowerCase(), siteId: siteId.toLowerCase() });
      if (
        !request ||
        !sameUuid(request.requestId, requestId) ||
        !sameUuid(request.siteId, siteId)
      ) {
        return { status: 'UNAVAILABLE', reason: 'REQUEST_NOT_FOUND' };
      }
      const event = await manager
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: request.eventId });
      if (!event) return { status: 'UNAVAILABLE', reason: 'EVENT_NOT_FOUND' };
      return inspectMf06StoredBinding(request, event);
    });
  }
}
