import { computeCanonicalPayloadHash, validateObservationEvent } from '@smartsite/contracts';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';

export function reviewEventIsConsistent(event: AiObservationEventEntity): boolean {
  const raw = event.rawPayload;
  if (
    !validateObservationEvent(raw).isValid ||
    computeCanonicalPayloadHash(raw) !== event.payloadHash
  )
    return false;
  const header = raw as {
    eventId: string;
    cameraExternalId: string;
    streamSessionId: string;
    capturedAt: string;
  };
  const captured = parseNormalizedCapturedAt(header.capturedAt);
  return (
    captured !== null &&
    captured.getTime() === event.capturedAt.getTime() &&
    header.eventId.toLowerCase() === event.eventId.toLowerCase() &&
    header.cameraExternalId === event.cameraExternalId &&
    header.streamSessionId.toLowerCase() === event.streamSessionId.toLowerCase() &&
    event.resolvedCameraId !== null
  );
}
