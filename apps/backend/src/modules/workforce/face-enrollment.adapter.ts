import { HttpStatus, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

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
}

export interface FaceEnrollmentAdapter {
  submitSample(input: FaceEnrollmentSampleInput): Promise<FaceEnrollmentSampleResult>;
  completeEnrollment(sessionId: string): Promise<FaceEnrollmentCompletion>;
}

interface SampleResponse {
  acceptedSampleCount: number;
}

interface CompletionResponse {
  status: string;
  modelVersion?: string;
  profileReference?: string;
}

/**
 * Transport-only adapter. JPEGs are held only for the outgoing request and
 * are never placed in a log, database entity, or retry queue.
 */
@Injectable()
export class HttpFaceEnrollmentAdapter implements FaceEnrollmentAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs = 8_000,
  ) {}

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
    if (
      !isCompletionResponse(response) ||
      response.status !== 'ENROLLED' ||
      !response.modelVersion ||
      !response.profileReference
    )
      this.unavailable();
    return {
      modelVersion: response.modelVersion,
      profileReference: response.profileReference,
    };
  }

  private async request(path: string, jpeg?: Buffer): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          accept: 'application/json',
          ...(jpeg ? { 'content-type': 'image/jpeg' } : {}),
        },
        ...(jpeg ? { body: new Uint8Array(jpeg) } : {}),
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

function isSampleResponse(value: unknown): value is SampleResponse {
  return isRecord(value) && Number.isSafeInteger(value.acceptedSampleCount);
}

function isCompletionResponse(value: unknown): value is CompletionResponse {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    (value.modelVersion === undefined || typeof value.modelVersion === 'string') &&
    (value.profileReference === undefined || typeof value.profileReference === 'string')
  );
}

/**
 * The default preserves the fail-closed boundary until the reviewed AI
 * identity contract is vendored and a model/enrollment store is configured.
 */
@Injectable()
export class UnavailableFaceEnrollmentAdapter implements FaceEnrollmentAdapter {
  async submitSample(_input: FaceEnrollmentSampleInput): Promise<FaceEnrollmentSampleResult> {
    throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Face verification is temporarily unavailable',
    });
  }

  async completeEnrollment(_sessionId: string): Promise<FaceEnrollmentCompletion> {
    throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Face verification is temporarily unavailable',
    });
  }
}
