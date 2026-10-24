import { createHash } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import type { Mf06StoredBindingInspection } from './mf06-request-context.js';
import type { SafetySubjectCrop } from '../identity/safety-subject-cropper.js';
import {
  isSafetyFaceInvocation,
  type SafetyFaceInvocation,
} from './safety-identity-resolver.port.js';

export type Mf06FaceBinding =
  | { state: 'BOUND_UNATTESTED'; invocation: SafetyFaceInvocation }
  | { state: 'UNAVAILABLE'; reason: 'INVALID_BINDING' | 'MEDIA_MISMATCH' };

/** Mechanical binding only; no producer attestation or identity is established. */
export function bindMf06FaceInvocation(
  stored: Mf06StoredBindingInspection,
  crop: SafetySubjectCrop,
  invocationId: string,
  modelVersion: string,
): Mf06FaceBinding {
  const invalid: Mf06FaceBinding = { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' };
  const mediaMismatch: Mf06FaceBinding = { state: 'UNAVAILABLE', reason: 'MEDIA_MISMATCH' };
  if (
    stored.status !== 'MATCHED' ||
    !stored.subject ||
    stored.request.subjectBindingStatus !== 'BOUND'
  )
    return invalid;
  const { request, subject } = stored;
  const hash = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  if (!hash(stored.contextDigest) || !hash(request.storedBindingHash)) return invalid;
  // Recheck the request-to-PERSON bridge even if the caller supplies a malformed typed object.
  if (
    subject.eventId !== request.eventId ||
    subject.payloadHash !== request.payloadHash ||
    subject.cameraId !== request.cameraId ||
    subject.cameraExternalId !== request.cameraExternalId ||
    subject.streamSessionId !== request.streamSessionId ||
    parseNormalizedCapturedAt(subject.capturedAt)?.toISOString() !== request.capturedAt ||
    subject.personObservationIndex !== request.personObservationIndex ||
    subject.trackId !== request.trackId
  )
    return invalid;
  if (
    !Buffer.isBuffer(crop.bytes) ||
    crop.bytes.length === 0 ||
    !hash(crop.frameSha256) ||
    !hash(crop.cropSha256) ||
    createHash('sha256').update(crop.bytes).digest('hex') !== crop.cropSha256 ||
    crop.cropAlgorithmVersion !== 'PERSON_FLOOR_CEIL_JPEG95_444_V1'
  )
    return mediaMismatch;
  let subjectDigest: string;
  try {
    subjectDigest = computeCanonicalPayloadHash(subject);
    if (computeCanonicalPayloadHash(crop.subject) !== subjectDigest) return mediaMismatch;
  } catch {
    return mediaMismatch;
  }
  const correlated = {
    protocolVersion: 'SAFETY_MF06_FACE_V1' as const,
    purpose: 'SAFETY_MF06' as const,
    invocationId,
    requestId: request.requestId,
    eventId: request.eventId,
    payloadHash: request.payloadHash,
    siteId: request.siteId,
    cameraId: request.cameraId,
    cameraExternalId: request.cameraExternalId,
    streamSessionId: request.streamSessionId,
    capturedAt: request.capturedAt,
    originalCapturedAt: subject.capturedAt,
    personObservationIndex: request.personObservationIndex!,
    zoneObservationIndex: request.zoneObservationIndex,
    trackId: request.trackId,
    regionId: request.regionId,
    geometryVersion: request.geometryVersion,
    zoneId: request.zoneId,
    requestRevision: request.requestRevision,
    requestedPurpose: request.requestedPurpose,
    frameSha256: crop.frameSha256,
    cropSha256: crop.cropSha256,
    cropAlgorithmVersion: crop.cropAlgorithmVersion,
    modelVersion,
  };
  if (!isSafetyFaceInvocation({ ...correlated, bindingDigest: '0'.repeat(64) })) return invalid;
  const bindingDigest = computeCanonicalPayloadHash({
    algorithm: 'MF06_FACE_BINDING_V1',
    ...correlated,
    subjectDigest,
    storedContextDigest: stored.contextDigest,
    storedBindingHash: request.storedBindingHash,
  });
  const invocation = { ...correlated, bindingDigest };
  if (!isSafetyFaceInvocation(invocation)) return invalid;
  return { state: 'BOUND_UNATTESTED', invocation };
}
