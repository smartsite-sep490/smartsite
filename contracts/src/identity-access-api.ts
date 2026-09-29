/**
 * Shared vocabulary for the face-first gate flow. These types deliberately
 * carry technical evidence and the Backend's final access outcome separately.
 */
export type FaceVerificationTechnicalOutcome =
  | 'MATCHED'
  | 'UNKNOWN'
  | 'LOW_CONFIDENCE'
  | 'QUALITY_FAILED'
  | 'AI_UNAVAILABLE';

export type GateAuthorizationOutcome = 'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW';

export type FaceGateReasonCode =
  | 'MATCH_CONFIRMED'
  | 'UNKNOWN_FACE'
  | 'FACE_CONFIDENCE_LOW'
  | 'FACE_QUALITY_FAILED'
  | 'FACE_SERVICE_UNAVAILABLE'
  | 'AUTHORIZATION_UNAVAILABLE'
  | 'WORKER_INACTIVE'
  | 'CONTRACTOR_INACTIVE'
  | 'ASSIGNMENT_MISSING'
  | 'ASSIGNMENT_EXPIRED'
  | 'SITE_MISMATCH';

export interface FaceGateDecisionResponse {
  technicalOutcome: FaceVerificationTechnicalOutcome;
  authorization: GateAuthorizationOutcome;
  reasonCode: FaceGateReasonCode;
  /** QR is a fallback for an inconclusive face scan, never an authorization bypass. */
  qrFallbackAllowed: boolean;
}
