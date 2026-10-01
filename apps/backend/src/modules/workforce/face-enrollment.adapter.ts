import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { EnrollmentCaptureTarget } from '@smartsite/contracts';

export interface FaceEnrollmentSampleInput {
  sessionId: string;
  sampleIndex: number;
  jpeg: Buffer;
}

export interface FaceEnrollmentSampleResult {
  acceptedSampleCount: number;
}

export interface FaceEnrollmentCompletion {
  profileReference: string;
  modelVersion: string;
  encryptedTemplate: string;
}

export interface FaceSampleQuality {
  status: 'ACCEPTED' | 'QUALITY_FAILED' | 'AI_UNAVAILABLE';
  reasonCode?: string;
}

export interface FaceEnrollmentAdapter {
  assessSampleQuality(jpeg: Buffer, target?: EnrollmentCaptureTarget): Promise<FaceSampleQuality>;
  submitSample(input: FaceEnrollmentSampleInput): Promise<FaceEnrollmentSampleResult>;
  completeEnrollment(sessionId: string): Promise<FaceEnrollmentCompletion>;
}

export interface FaceVerificationInput {
  verificationId: string;
  jpeg: Buffer;
  templates?: Array<{ profileReferenceHash: string; encryptedTemplate: string }>;
  enrollmentTarget?: EnrollmentCaptureTarget;
}

export interface FaceVerificationEvidence {
  reasonCode?: string;
  status: 'MATCHED' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'QUALITY_FAILED' | 'AI_UNAVAILABLE';
  modelVersion?: string;
  candidateProfileReference?: string;
  scoreBand?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface FaceVerificationAdapter {
  verify(input: FaceVerificationInput): Promise<FaceVerificationEvidence>;
}

interface SampleResponse {
  acceptedSampleCount: number;
}

interface CompletionResponse {
  status: string;
  modelVersion?: string | null;
  profileReference?: string | null;
  reasonCode?: string;
  encryptedTemplate?: string | null;
}

interface VerificationResponse {
  reasonCode?: string;
  status: FaceVerificationEvidence['status'];
  modelVersion?: string | null;
  candidateProfileReference?: string | null;
  scoreBand?: FaceVerificationEvidence['scoreBand'] | null;
}

/**
 * Transport-only adapter. JPEGs are held only for the outgoing request and
 * are never placed in a log, database entity, or retry queue.
 */
@Injectable()
export class HttpFaceEnrollmentAdapter implements FaceEnrollmentAdapter, FaceVerificationAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs = 8_000,
  ) {}

  async assessSampleQuality(
    jpeg: Buffer,
    target: EnrollmentCaptureTarget = 'front',
  ): Promise<FaceSampleQuality> {
    const evidence = await this.verify({
      verificationId: randomUUID(),
      jpeg,
      templates: [],
      enrollmentTarget: target,
    });
    if (evidence.status === 'QUALITY_FAILED')
      return { status: 'QUALITY_FAILED', reasonCode: safeQualityReason(evidence.reasonCode) };
    if (evidence.status === 'AI_UNAVAILABLE')
      return { status: 'AI_UNAVAILABLE', reasonCode: 'FACE_MODEL_UNAVAILABLE' };
    if (evidence.status === 'UNKNOWN' && evidence.reasonCode === 'FACE_QUALITY_ACCEPTED')
      return { status: 'ACCEPTED', reasonCode: 'FACE_QUALITY_ACCEPTED' };
    return { status: 'AI_UNAVAILABLE', reasonCode: 'FACE_QUALITY_CHECK_UNSUPPORTED' };
  }

  async submitSample(input: FaceEnrollmentSampleInput): Promise<FaceEnrollmentSampleResult> {
    const response = await this.request(
      `/v1/identity/enrollments/${encodeURIComponent(input.sessionId)}/samples/${input.sampleIndex}`,
      input.jpeg,
    );
    if (!isSampleResponse(response)) this.unavailable();
    return response;
  }

  async completeEnrollment(sessionId: string): Promise<FaceEnrollmentCompletion> {
    const response = await this.request(
      `/v1/identity/enrollments/${encodeURIComponent(sessionId)}/complete`,
    );
    if (!isCompletionResponse(response)) this.unavailable();
    if (response.status === 'QUALITY_FAILED') {
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message:
          'Face samples did not contain one clear face. Re-capture with one face centered, well lit, and unobstructed.',
      });
    }
    if (response.status === 'AI_UNAVAILABLE') this.unavailable();
    if (
      response.status !== 'ENROLLED' ||
      !response.modelVersion ||
      !response.profileReference ||
      typeof response.encryptedTemplate !== 'string' ||
      !/^[A-Za-z0-9_-]{100,32766}={0,2}$/.test(response.encryptedTemplate)
    )
      this.unavailable();
    return {
      modelVersion: response.modelVersion,
      profileReference: response.profileReference,
      encryptedTemplate: response.encryptedTemplate,
    };
  }

  async verify(input: FaceVerificationInput): Promise<FaceVerificationEvidence> {
    try {
      const response = await this.request(
        `/v1/identity/verifications/${encodeURIComponent(input.verificationId)}`,
        input.jpeg,
        input.templates === undefined
          ? undefined
          : {
              jpegBase64: input.jpeg.toString('base64'),
              templates: input.templates,
              ...(input.enrollmentTarget ? { enrollmentTarget: input.enrollmentTarget } : {}),
            },
      );
      if (!isVerificationResponse(response)) return { status: 'AI_UNAVAILABLE' };
      if (
        response.status === 'MATCHED' &&
        (!response.modelVersion || !response.candidateProfileReference || !response.scoreBand)
      )
        return { status: 'AI_UNAVAILABLE' };
      return {
        status: response.status,
        ...(response.reasonCode ? { reasonCode: safeQualityReason(response.reasonCode) } : {}),
        ...(response.modelVersion ? { modelVersion: response.modelVersion } : {}),
        ...(response.candidateProfileReference
          ? { candidateProfileReference: response.candidateProfileReference }
          : {}),
        ...(response.scoreBand ? { scoreBand: response.scoreBand } : {}),
      };
    } catch {
      return { status: 'AI_UNAVAILABLE' };
    }
  }

  private async request(path: string, jpeg?: Buffer, json?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          accept: 'application/json',
          ...(json
            ? { 'content-type': 'application/json' }
            : jpeg
              ? { 'content-type': 'image/jpeg' }
              : {}),
        },
        ...(json ? { body: JSON.stringify(json) } : jpeg ? { body: new Uint8Array(jpeg) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) this.unavailable();
      return (await response.json()) as unknown;
    } catch {
      this.unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private unavailable(): never {
    throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Face verification is temporarily unavailable',
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const QUALITY_REASONS = new Set([
  'FACE_QUALITY_ACCEPTED',
  'FACE_IMAGE_INVALID',
  'FACE_NOT_FOUND',
  'FACE_MULTIPLE_FOUND',
  'FACE_LANDMARKS_UNAVAILABLE',
  'FACE_NOT_CLEAR',
  'FACE_CLIPPED',
  'FACE_TOO_SMALL',
  'FACE_TOO_CLOSE',
  'FACE_NOT_CENTERED',
  'FACE_TOO_DARK',
  'FACE_TOO_BRIGHT',
  'FACE_BLURRY',
  'FACE_HEAD_TILTED',
  'FACE_TURN_TOO_FAR',
  'FACE_POSE_FRONT_REQUIRED',
  'FACE_POSE_LEFT_REQUIRED',
  'FACE_POSE_RIGHT_REQUIRED',
]);
function safeQualityReason(value: unknown): string {
  return typeof value === 'string' && QUALITY_REASONS.has(value)
    ? value
    : 'FACE_QUALITY_INSUFFICIENT';
}

function isSampleResponse(value: unknown): value is SampleResponse {
  return isRecord(value) && Number.isSafeInteger(value.acceptedSampleCount);
}

function isCompletionResponse(value: unknown): value is CompletionResponse {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    (value.modelVersion === undefined ||
      value.modelVersion === null ||
      typeof value.modelVersion === 'string') &&
    (value.profileReference === undefined ||
      value.profileReference === null ||
      typeof value.profileReference === 'string') &&
    (value.reasonCode === undefined || typeof value.reasonCode === 'string')
  );
}

function isVerificationResponse(value: unknown): value is VerificationResponse {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    ['MATCHED', 'UNKNOWN', 'LOW_CONFIDENCE', 'QUALITY_FAILED', 'AI_UNAVAILABLE'].includes(
      value.status,
    ) &&
    (value.modelVersion === undefined ||
      value.modelVersion === null ||
      typeof value.modelVersion === 'string') &&
    (value.candidateProfileReference === undefined ||
      value.candidateProfileReference === null ||
      typeof value.candidateProfileReference === 'string') &&
    (value.scoreBand === undefined ||
      value.scoreBand === null ||
      value.scoreBand === 'LOW' ||
      value.scoreBand === 'MEDIUM' ||
      value.scoreBand === 'HIGH')
  );
}

/**
 * The default preserves the fail-closed boundary until the reviewed AI
 * identity contract is vendored and a model/enrollment store is configured.
 */
@Injectable()
export class UnavailableFaceEnrollmentAdapter
  implements FaceEnrollmentAdapter, FaceVerificationAdapter
{
  async assessSampleQuality(): Promise<FaceSampleQuality> {
    return { status: 'AI_UNAVAILABLE', reasonCode: 'FACE_MODEL_NOT_CONFIGURED' };
  }

  async submitSample(): Promise<FaceEnrollmentSampleResult> {
    throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Face verification is temporarily unavailable',
    });
  }

  async completeEnrollment(): Promise<FaceEnrollmentCompletion> {
    throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Face verification is temporarily unavailable',
    });
  }

  async verify(): Promise<FaceVerificationEvidence> {
    return { status: 'AI_UNAVAILABLE' };
  }
}
