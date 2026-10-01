/**
 * Shared vocabulary for the face-first gate flow. These types deliberately
 * carry technical evidence and the Backend's final access outcome separately.
 */
export type FaceVerificationTechnicalOutcome =
  'MATCHED' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'QUALITY_FAILED' | 'AI_UNAVAILABLE';

export type GateAuthorizationOutcome = 'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW';

export type FaceProfileStatus = 'ACTIVE' | 'REVOKED' | 'NEEDS_REENROLL';

export type WorkerSiteZoneAssignmentStatus =
  'PENDING' | 'SAFETY_REVIEWED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type FaceGateReasonCode =
  | 'MATCH_CONFIRMED'
  | 'UNKNOWN_FACE'
  | 'FACE_CONFIDENCE_LOW'
  | 'FACE_QUALITY_FAILED'
  | 'FACE_SERVICE_UNAVAILABLE'
  | 'AUTHORIZATION_UNAVAILABLE'
  | 'AUTHORIZATION_DATA_UNAVAILABLE'
  | 'WORKER_INACTIVE'
  | 'CONTRACTOR_INACTIVE'
  | 'CONTRACTOR_SITE_PARTICIPATION_INVALID'
  | 'FACE_PROFILE_REVOKED'
  | 'FACE_PROFILE_REENROLL_REQUIRED'
  | 'ASSIGNMENT_MISSING'
  | 'ASSIGNMENT_NOT_APPROVED'
  | 'ASSIGNMENT_EXPIRED'
  | 'SITE_MISMATCH'
  | 'VALID_ASSIGNMENT';

export interface FaceGateDecisionResponse {
  technicalOutcome: FaceVerificationTechnicalOutcome;
  authorization: GateAuthorizationOutcome;
  reasonCode: FaceGateReasonCode;
  /** QR is a fallback for an inconclusive face scan, never an authorization bypass. */
  qrFallbackAllowed: boolean;
}

export interface FaceGateVerificationResponse {
  decision: FaceGateDecisionResponse;
  worker?: {
    id: string;
    userId: string;
    username: string;
    externalId: string;
    displayName: string;
    contractorName: string;
    assignmentStatus: string;
  };
}
