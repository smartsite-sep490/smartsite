import { z } from 'zod';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';

/** Safety-specific boundary. A candidate reference is never a verified Worker. */
export interface SafetyFaceInvocation {
  protocolVersion: 'SAFETY_MF06_FACE_V1';
  purpose: 'SAFETY_MF06';
  invocationId: string;
  bindingDigest: string;
  requestId: string;
  eventId: string;
  payloadHash: string;
  siteId: string;
  cameraId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  originalCapturedAt: string;
  personObservationIndex: number;
  zoneObservationIndex: number;
  trackId: number;
  regionId: string;
  geometryVersion: number;
  zoneId: string;
  requestRevision: number;
  requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';
  frameSha256: string;
  cropSha256: string;
  cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1';
  modelVersion: string;
}

export type SafetyFaceResponseInspection =
  | {
      state: 'UNAVAILABLE';
      reason:
        | 'INVALID_RESPONSE'
        | 'CORRELATION_MISMATCH'
        | 'IDENTITY_UNAVAILABLE'
        | 'SERVICE_DISABLED'
        | 'ABORTED';
    }
  | {
      state: 'CANDIDATE_REFERENCE';
      profileReferenceHash: string;
      profileRevision: string;
      provenance: 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE';
    };

export interface SafetyFaceCandidateTemplate {
  readonly profileReferenceHash: string;
  readonly profileRevision: string;
  readonly encryptedTemplate: string;
}
export interface SafetyFaceResolveInput {
  readonly invocation: SafetyFaceInvocation;
  readonly cropBytes: Buffer;
  readonly candidates: readonly SafetyFaceCandidateTemplate[];
}

export interface SafetyIdentityResolverPort {
  /** Transport data must pass inspectSafetyFaceResponse before any metadata lookup. */
  resolve(input: SafetyFaceResolveInput, signal: AbortSignal): Promise<unknown>;
}

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const version = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value);
const correlationShape = {
  protocolVersion: z.literal('SAFETY_MF06_FACE_V1'),
  purpose: z.literal('SAFETY_MF06'),
  invocationId: z.uuid(),
  bindingDigest: hash,
  requestId: z.uuid(),
  eventId: z.uuid(),
  payloadHash: hash,
  siteId: z.uuid(),
  cameraId: z.uuid(),
  cameraExternalId: z.string().min(1).max(128),
  streamSessionId: z.uuid(),
  capturedAt: z.iso.datetime({ precision: 3 }),
  originalCapturedAt: z
    .string()
    .max(64)
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/)
    .refine((value) => parseNormalizedCapturedAt(value) !== null),
  personObservationIndex: z.number().int().min(0).max(255),
  zoneObservationIndex: z.number().int().min(0).max(255),
  trackId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  regionId: z.uuid(),
  geometryVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  zoneId: z.uuid(),
  requestRevision: z.number().int().min(1).max(2147483647),
  requestedPurpose: z.enum(['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW']),
  frameSha256: hash,
  cropSha256: hash,
  cropAlgorithmVersion: z.literal('PERSON_FLOOR_CEIL_JPEG95_444_V1'),
  modelVersion: version,
};
const invocationSchema = z
  .strictObject(correlationShape)
  .refine((value) => value.personObservationIndex !== value.zoneObservationIndex)
  .refine(
    (value) =>
      parseNormalizedCapturedAt(value.originalCapturedAt)?.toISOString() === value.capturedAt,
  );
export function isSafetyFaceInvocation(value: unknown): value is SafetyFaceInvocation {
  return invocationSchema.safeParse(value).success;
}
const provenance = z.enum(['SYNTHETIC_TEST', 'TRUSTED_SERVICE']);
const responseSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...correlationShape,
    state: z.literal('CANDIDATE'),
    provenance,
    profileReferenceHash: hash,
    profileRevision: z.uuid(),
  }),
  z.strictObject({
    ...correlationShape,
    state: z.literal('UNAVAILABLE'),
    provenance,
    reason: z.enum(['NO_MATCH', 'UNSUPPORTED', 'SERVICE_UNAVAILABLE', 'ABORTED']),
  }),
]);

export function inspectSafetyFaceResponse(
  input: SafetyFaceInvocation,
  response: unknown,
  channel: 'DISABLED' | 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE',
): SafetyFaceResponseInspection {
  if (channel === 'DISABLED') return { state: 'UNAVAILABLE', reason: 'SERVICE_DISABLED' };
  const expected = invocationSchema.safeParse(input);
  const actual = responseSchema.safeParse(response);
  if (!expected.success || !actual.success || actual.data.provenance !== channel)
    return { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' };
  // Exact original scope and invocation correlation, not only the provider's digest echo.
  for (const key of Object.keys(correlationShape) as (keyof SafetyFaceInvocation)[])
    if (actual.data[key] !== expected.data[key])
      return { state: 'UNAVAILABLE', reason: 'CORRELATION_MISMATCH' };
  if (actual.data.state === 'UNAVAILABLE')
    return { state: 'UNAVAILABLE', reason: 'IDENTITY_UNAVAILABLE' };
  return {
    state: 'CANDIDATE_REFERENCE',
    profileReferenceHash: actual.data.profileReferenceHash,
    profileRevision: actual.data.profileRevision,
    provenance: actual.data.provenance,
  };
}

/** No configuration, HTTP, model, Gate or camera fallback. */
export class UnavailableSafetyIdentityResolver implements SafetyIdentityResolverPort {
  async resolve(
    _input: SafetyFaceResolveInput,
    signal: AbortSignal,
  ): Promise<SafetyFaceResponseInspection> {
    return { state: 'UNAVAILABLE', reason: signal.aborted ? 'ABORTED' : 'SERVICE_DISABLED' };
  }
}
