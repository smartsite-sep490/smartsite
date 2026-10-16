import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';
import { projectObservationSubjectRef } from './observation-identity-subject-ref.js';
import type { ObservationSubjectRef } from './observation-identity.types.js';

export interface SafetySubjectFrame {
  bytes: Buffer;
  sha256: string;
  width: number;
  height: number;
}

/** Explicit resource policy; these limits do not establish Face calibration. */
export interface SafetySubjectCropLimits {
  maxFrameBytes: number;
  maxFramePixels: number;
  maxCropBytes: number;
}

export interface SafetySubjectCrop {
  bytes: Buffer;
  frameSha256: string;
  cropSha256: string;
  subject: ObservationSubjectRef;
  rectangle: { left: number; top: number; width: number; height: number };
  cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1';
}

type CropRejection =
  | 'LIMITS_INVALID'
  | 'RESOURCE_LIMIT'
  | 'SUBJECT_INVALID'
  | 'FRAME_INVALID'
  | 'FRAME_DIGEST_MISMATCH'
  | 'FRAME_DIMENSIONS_MISMATCH'
  | 'FRAME_ORIENTATION_UNSUPPORTED';

class SafetySubjectCropError extends Error {
  constructor(readonly code: CropRejection) {
    super(`Safety subject frame rejected: ${code}`);
    this.name = 'SafetySubjectCropError';
  }
}

function reject(code: CropRejection): never {
  throw new SafetySubjectCropError(code);
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Mechanical crop only. Caller must bind the supplied frame digest and subject to
 * the original scoped event through the approved evidence/provenance boundary.
 * A Face inside this crop is not proof that it belongs to the selected PERSON.
 * No model, Worker resolution, authorization, storage or network side effect.
 */
export async function cropSafetySubjectFrame(
  frame: SafetySubjectFrame,
  subject: ObservationSubjectRef,
  limits: SafetySubjectCropLimits,
): Promise<SafetySubjectCrop> {
  const { maxFrameBytes, maxFramePixels, maxCropBytes } = limits;
  if (![maxFrameBytes, maxFramePixels, maxCropBytes].every(positiveInteger))
    reject('LIMITS_INVALID');
  const ref = projectObservationSubjectRef(subject);
  if (!ref || !parseNormalizedCapturedAt(ref.capturedAt)) reject('SUBJECT_INVALID');
  const { width, height } = frame;
  if (!positiveInteger(width) || !positiveInteger(height)) reject('FRAME_INVALID');
  if (!Number.isSafeInteger(width * height) || width * height > maxFramePixels)
    reject('RESOURCE_LIMIT');
  if (!Buffer.isBuffer(frame.bytes) || frame.bytes.length === 0) reject('FRAME_INVALID');
  if (frame.bytes.length > maxFrameBytes) reject('RESOURCE_LIMIT');
  if (typeof frame.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(frame.sha256))
    reject('FRAME_INVALID');

  // Snapshot caller-owned bytes/ref before the first asynchronous decode.
  const bytes = Buffer.from(frame.bytes);
  const frameSha256 = frame.sha256;
  if (sha256(bytes) !== frameSha256) reject('FRAME_DIGEST_MISMATCH');
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    reject('FRAME_INVALID');

  const { x1, y1, x2, y2 } = ref.personBoundingBox;
  const left = Math.floor(x1 * width),
    top = Math.floor(y1 * height);
  const rectangle = {
    left,
    top,
    width: Math.ceil(x2 * width) - left,
    height: Math.ceil(y2 * height) - top,
  };
  try {
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: maxFramePixels,
      autoOrient: false,
    });
    const metadata = await image.metadata();
    if (metadata.format !== 'jpeg' || (metadata.pages ?? 1) !== 1) reject('FRAME_INVALID');
    if (metadata.width !== width || metadata.height !== height) reject('FRAME_DIMENSIONS_MISMATCH');
    if (metadata.orientation !== undefined && metadata.orientation !== 1)
      reject('FRAME_ORIENTATION_UNSUPPORTED');
    const { data, info } = await image
      .extract(rectangle)
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer({ resolveWithObject: true });
    if (data.length > maxCropBytes) reject('RESOURCE_LIMIT');
    if (
      info.format !== 'jpeg' ||
      info.width !== rectangle.width ||
      info.height !== rectangle.height
    )
      reject('FRAME_INVALID');
    return {
      bytes: data,
      frameSha256,
      cropSha256: sha256(data),
      subject: ref,
      rectangle,
      cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
    };
  } catch (error) {
    if (error instanceof SafetySubjectCropError) throw error;
    // Decoder errors can contain internal paths/details. Never attach them as a cause.
    reject('FRAME_INVALID');
  }
}
