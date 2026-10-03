import type {
  FaceGateDecisionResponse,
  FaceGateReasonCode,
  FaceVerificationTechnicalOutcome,
  GateAuthorizationOutcome,
} from '@smartsite/contracts';

export interface FaceGatePolicyInput {
  technicalOutcome: FaceVerificationTechnicalOutcome;
  authorization?: Extract<GateAuthorizationOutcome, 'ALLOWED' | 'DENIED'>;
  reasonCode?: FaceGateReasonCode;
}

const FALLBACK_REASONS: Record<
  Exclude<FaceVerificationTechnicalOutcome, 'MATCHED'>,
  FaceGateReasonCode
> = {
  UNKNOWN: 'UNKNOWN_FACE',
  LOW_CONFIDENCE: 'FACE_CONFIDENCE_LOW',
  QUALITY_FAILED: 'FACE_QUALITY_FAILED',
  AI_UNAVAILABLE: 'FACE_SERVICE_UNAVAILABLE',
};

/**
 * Resolves the client-visible next step without ever turning an AI match into
 * access permission. The caller must supply the outcome of Backend scope and
 * assignment authorization for a successful face match.
 */
export function decideFaceGate(input: FaceGatePolicyInput): FaceGateDecisionResponse {
  if (input.technicalOutcome !== 'MATCHED') {
    return {
      technicalOutcome: input.technicalOutcome,
      authorization: 'MANUAL_REVIEW',
      reasonCode: FALLBACK_REASONS[input.technicalOutcome],
      qrFallbackAllowed: true,
    };
  }

  if (!input.authorization) {
    return {
      technicalOutcome: 'MATCHED',
      authorization: 'MANUAL_REVIEW',
      reasonCode: 'AUTHORIZATION_UNAVAILABLE',
      qrFallbackAllowed: false,
    };
  }

  return {
    technicalOutcome: 'MATCHED',
    authorization: input.authorization,
    reasonCode: input.reasonCode ?? 'MATCH_CONFIRMED',
    qrFallbackAllowed: false,
  };
}
