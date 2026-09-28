export type UserRole = 'ADMIN' | 'WORKER';

export interface AccountResponse {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
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
  createdAt: string;
}

export interface SafetyAlertDetectionResponse {
  eventId: string;
  cameraExternalId: string;
  capturedAt: string;
  processingStatus:
    'PROCESSED' | 'SKIPPED_CLOCK_SKEW' | 'SKIPPED_NO_CANDIDATE' | 'SKIPPED_UNKNOWN_CAMERA';
}

export interface SafetyAlertDetailResponse extends SafetyAlertResponse {
  detectionsTotal: number;
  detections: SafetyAlertDetectionResponse[];
}

export interface WorkerResponse {
  id: string;
  siteId: string;
  externalId: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
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
