import {
  computeCanonicalPayloadHash,
  validateEightFamilyObservationEvent,
  validateObservationEvent,
  validatePartitionedObservationEvent,
} from '@smartsite/contracts';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';

/** Internal callers pass descriptor-safe JSON snapshots, never resolver or browser objects. */
export function validateMf06ObservationEvent(raw: unknown) {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === '1.4.0') {
    return validatePartitionedObservationEvent(raw);
  }
  return raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === '1.3.0'
    ? validateEightFamilyObservationEvent(raw)
    : validateObservationEvent(raw);
}

/** MF06's explicit admission does not change the separately owned MF08 evidence reader. */
export function readConsistentMf06RawEvent(
  event: AiObservationEventEntity,
): Record<string, unknown> | null {
  try {
    const field = Object.getOwnPropertyDescriptor(event, 'rawPayload');
    if (!field || !field.enumerable || !('value' in field)) return null;
    const raw = snapshotMf06Json(field.value) as Record<string, unknown>;
    if (
      !validateMf06ObservationEvent(raw).isValid ||
      computeCanonicalPayloadHash(raw) !== event.payloadHash
    )
      return null;
    const captured = parseNormalizedCapturedAt(raw.capturedAt as string);
    if (
      !captured ||
      captured.getTime() !== event.capturedAt.getTime() ||
      (raw.eventId as string).toLowerCase() !== event.eventId.toLowerCase() ||
      raw.cameraExternalId !== event.cameraExternalId ||
      (raw.streamSessionId as string).toLowerCase() !== event.streamSessionId.toLowerCase()
    )
      return null;
    return raw;
  } catch {
    return null;
  }
}
