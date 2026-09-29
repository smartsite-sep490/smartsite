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
