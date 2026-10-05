import type { WorkerSiteZoneAssignmentStatus } from './identity-access-api.js';

export type UserRole =
  | 'ADMIN'
  | 'SITE_MANAGER'
  | 'CONTRACTOR_REPRESENTATIVE'
  | 'SAFETY_OFFICER'
  | 'SECURITY_OFFICER'
  | 'WORKER';
export type ProvisionableUserRole =
  'ADMIN' | 'SITE_MANAGER' | 'CONTRACTOR_REPRESENTATIVE' | 'SAFETY_OFFICER' | 'SECURITY_OFFICER';
export type AuthClientType = 'WEB' | 'MOBILE';

export * from './observation-identity-management.js';

export interface ProvisionableRoleAssignment {
  role: ProvisionableUserRole;
  siteId: string | null;
}

export interface RoleAssignmentResponse {
  role: UserRole;
  siteId: string | null;
}

export interface AccountResponse {
  id: string;
  username: string;
  displayName: string;
  roleAssignments: RoleAssignmentResponse[];
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresAt: string;
  refreshToken?: string;
  refreshTokenExpiresAt: string;
  user: AccountResponse;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface SiteResponse {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface CameraResponse {
  id: string;
  siteId: string;
  externalId: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  configurationVersion: number;
  createdAt: string;
}

export interface ZoneResponse {
  id: string;
  siteId: string;
  code: string;
  name: string;
  type: 'STANDARD' | 'RESTRICTED' | 'HAZARDOUS';
  restrictionPolicy: 'NONE' | 'PROHIBITED_FOR_ALL' | 'AUTHORIZATION_REQUIRED';
  requiredPpe: string[];
  configurationLocked: boolean;
  createdAt: string;
}

export interface RegionResponse {
  id: string;
  cameraId: string;
  zoneId: string;
  polygon: unknown;
  coordinateSpace: 'NORMALIZED_0_1';
  version: number;
  isActive: boolean;
  createdAt: string;
}

export interface RegionMutationResponse {
  region: RegionResponse;
  configurationVersion: number;
}

export type SafetyAlertType = 'PPE_VIOLATION' | 'RESTRICTED_ZONE_INTRUSION';

export type SafetyAlertStatus =
  'PENDING_REVIEW' | 'NEEDS_MORE_EVIDENCE' | 'CONFIRMED' | 'DISMISSED' | 'CLOSED';

export interface SafetyAlertResponse {
  incidentId?: string | null;
  id: string;
  siteId: string;
  zoneId: string | null;
  candidateWorkerId: string | null;
  alertType: SafetyAlertType;
  candidateSubtype: string;
  status: SafetyAlertStatus;
  firstDetectedAt: string;
  lastDetectedAt: string;
  detectionCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type SafetyAlertReviewTargetStatus = 'CONFIRMED' | 'DISMISSED' | 'NEEDS_MORE_EVIDENCE';

export interface SafetyAlertReviewResponse {
  id: string;
  alertId: string;
  siteId: string;
  actorUserId: string;
  fromStatus: SafetyAlertStatus;
  toStatus: SafetyAlertReviewTargetStatus;
  reason: string;
  alertRevision: number;
  createdAt: string;
}

export interface SafetyAlertDetectionResponse {
  eventId: string;
  cameraExternalId: string;
  capturedAt: string;
  processingStatus:
    'PROCESSED' | 'SKIPPED_CLOCK_SKEW' | 'SKIPPED_NO_CANDIDATE' | 'SKIPPED_UNKNOWN_CAMERA';
  evidence: SafetyAlertEvidenceResponse[];
}

export interface SafetyAlertEvidenceResponse {
  index: number;
  kind: 'FRAME' | 'CROP' | 'SNAPSHOT';
  trackId?: number;
  available: boolean;
}

export interface SafetyAlertDetailResponse extends SafetyAlertResponse {
  detectionsTotal: number;
  detections: SafetyAlertDetectionResponse[];
  reviewsTotal: number;
  reviews: SafetyAlertReviewResponse[];
}

export interface SafetyAlertReviewMutationResponse {
  alert: SafetyAlertResponse;
  review: SafetyAlertReviewResponse;
  replayed: boolean;
}

export interface WorkerResponse {
  id: string;
  siteId: string;
  contractorId: string | null;
  userId?: string | null;
  externalId: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
}

export interface ContractorResponse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface ContractorParticipationResponse {
  id: string;
  contractorId: string;
  siteId: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ContractorRepresentativeGrantResponse {
  id: string;
  userId: string;
  contractorId: string;
  createdAt: string;
}

export interface WorkerSiteZoneAssignmentResponse {
  id: string;
  workerId: string;
  siteId: string;
  zoneIds: string[];
  status: WorkerSiteZoneAssignmentStatus;
  validFrom: string;
  validUntil: string | null;
  requestedByUserId: string;
  safetyReviewedByUserId: string | null;
  siteManagerDecidedByUserId: string | null;
  createdAt: string;
}

export type FaceEnrollmentSessionStatus =
  'PENDING' | 'COLLECTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface FaceEnrollmentSessionResponse {
  id: string;
  workerId: string;
  consentVersion: string;
  status: FaceEnrollmentSessionStatus;
  acceptedSampleCount: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export type EnrollmentCaptureTarget = 'front' | 'left' | 'right';
export interface FaceEnrollmentQualityResponse {
  status: 'ACCEPTED' | 'QUALITY_FAILED';
  reasonCode: string;
}

export interface FaceProfileResponse {
  id: string;
  workerId: string;
  userId?: string | null;
  modelVersion: string;
  status: 'ACTIVE' | 'REVOKED' | 'NEEDS_REENROLL';
  consentVersion: string;
  consentedAt: string;
  createdAt: string;
  revokedAt: string | null;
}

export type ZoneAccessEffect = 'ALLOW' | 'DENY';

export interface ZoneAccessGrantResponse {
  id: string;
  siteId: string;
  zoneId: string;
  workerId: string;
  effect: ZoneAccessEffect;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type ZoneEntryDecisionStatus = 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';

export interface ZoneEntryDecisionResponse {
  id: string;
  eventId: string;
  siteId: string;
  zoneId: string;
  workerId: string | null;
  candidateWorkerId: string | null;
  trackId: number;
  status: ZoneEntryDecisionStatus;
  reasonCode: string;
  evaluatedAt: string;
  createdAt: string;
}
