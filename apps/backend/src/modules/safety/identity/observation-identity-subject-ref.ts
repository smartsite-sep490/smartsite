import { isUUID } from 'class-validator';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { reviewRawEventIsConsistent } from './observation-identity-event.js';
import { selectObservationSubject } from './observation-identity-subject.js';
import type { ObservationSubjectRef } from './observation-identity.types.js';

export function projectObservationSubjectRef(value: unknown): ObservationSubjectRef | null {
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
    eventId: ref.eventId.toLowerCase(),
    personObservationIndex: ref.personObservationIndex,
    payloadHash: ref.payloadHash,
    cameraId: ref.cameraId.toLowerCase(),
    cameraExternalId: ref.cameraExternalId,
    streamSessionId: ref.streamSessionId.toLowerCase(),
    capturedAt: ref.capturedAt,
    trackId: selected.trackId,
    personBoundingBox: selected.personBoundingBox,
  };
}

/** Matches persisted identity scope without reading media or making any Worker/Zone decision. */
export function observationSubjectRefMatchesEvent(
  ref: ObservationSubjectRef,
  event: AiObservationEventEntity,
  index: number,
): boolean {
  if (
    ref.eventId !== event.eventId.toLowerCase() ||
    ref.personObservationIndex !== index ||
    ref.payloadHash !== event.payloadHash ||
    (event.resolvedCameraId !== null && ref.cameraId !== event.resolvedCameraId?.toLowerCase()) ||
    ref.cameraExternalId !== event.cameraExternalId ||
    ref.streamSessionId !== event.streamSessionId.toLowerCase() ||
    parseNormalizedCapturedAt(ref.capturedAt)?.getTime() !== event.capturedAt.getTime()
  )
    return false;
  if (!reviewRawEventIsConsistent(event)) return true;
  const selected = selectObservationSubject(event.rawPayload, index);
  if (!selected.eligible) return false;
  const expected: ObservationSubjectRef = {
    eventId: event.eventId.toLowerCase(),
    personObservationIndex: index,
    payloadHash: event.payloadHash,
    cameraId: event.resolvedCameraId?.toLowerCase() ?? ref.cameraId,
    cameraExternalId: event.cameraExternalId,
    streamSessionId: event.streamSessionId.toLowerCase(),
    capturedAt: (event.rawPayload as { capturedAt: string }).capturedAt,
    trackId: selected.trackId,
    personBoundingBox: selected.personBoundingBox,
  };
  return computeCanonicalPayloadHash(ref) === computeCanonicalPayloadHash(expected);
}
