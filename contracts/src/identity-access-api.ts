/**
 * Shared vocabulary for the face-first gate flow. These types deliberately
 * carry technical evidence and the Backend's final access outcome separately.
 */
export type FaceVerificationTechnicalOutcome =
  'MATCHED' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'QUALITY_FAILED' | 'AI_UNAVAILABLE';

export type GateAuthorizationOutcome = 'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW';

export type FaceProfileStatus = 'ACTIVE' | 'REVOKED' | 'NEEDS_REENROLL' | 'DELETED';

export type WorkerSiteZoneAssignmentStatus =
  'PENDING' | 'SAFETY_REVIEWED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVOKED' | 'EXPIRED';

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
  | 'GATE_MISMATCH'
  | 'VALID_ASSIGNMENT'
  | 'EXIT_RECORD_ONLY';

export interface FaceGateDecisionResponse {
  technicalOutcome: FaceVerificationTechnicalOutcome;
  authorization: GateAuthorizationOutcome;
  reasonCode: FaceGateReasonCode;
  /** QR is a fallback for an inconclusive face scan, never an authorization bypass. */
  qrFallbackAllowed: boolean;
}

export interface FaceGateVerificationResponse {
  attempt?: import('./access-flow-api.js').AccessAttemptResponse;
  fallback?: import('./qr-access-api.js').QrFallbackResponse;
  decision: FaceGateDecisionResponse;
  log?: GateAccessLogResponse;
  worker?: {
    id: string;
    userId: string | null;
    username: string;
    externalId: string;
    displayName: string;
    contractorName: string;
    assignmentStatus: string;
  };
}

export interface GateAccessLogResponse {
  method?: 'FACE' | 'QR';
  id: string;
  createdAt: string;
  gateId: string;
  direction: 'IN' | 'OUT';
  workerId: string | null;
  userId: string | null;
  workerName: string | null;
  workerExternalId: string | null;
  contractorName: string | null;
  username: string | null;
  decision: { authorization: GateAuthorizationOutcome; reasonCode: string };
}
export interface GateFacePresenceResponse {
  state: 'NEW_FACE' | 'SAME_FACE' | 'WAITING' | 'QUALITY_FAILED' | 'AI_UNAVAILABLE';
  reasonCode: string;
}
