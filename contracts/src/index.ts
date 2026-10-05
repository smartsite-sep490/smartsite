export const CONTRACTS_VERSION = '1.0.0';
export type {
  CreateVisitCommand,
  VisitResponse,
  QrPassResponse,
  VisitorPassResponse,
  QrFallbackResponse,
  VerifyQrCommand,
  VisitorGateCommand,
  WorkerQrVerificationResponse,
  VisitorGateEventResponse,
} from './qr-access-api.js';

export * from './observation-identity-management.js';

export { canonicalizeJson, computeCanonicalPayloadHash } from './hashing/canonical-hash.js';

export { validateGeometries } from './validation/geometry-validator.js';

export type { ValidationIssue } from './validation/geometry-validator.js';

export { validateObservationEvent } from './validation/schema-validator.js';

export { validateCameraRegionConfiguration } from './validation/schema-validator.js';

export type { ValidationResult } from './validation/schema-validator.js';
export { SITE_GATES } from './gate-permissions-api.js';
export type {
  WorkerGatePermissionResponse,
  WorkerGatePermissionsResponse,
  SetWorkerGatePermissionsCommand,
} from './gate-permissions-api.js';

export {
  MAX_CAMERA_REGION_PAYLOAD_BYTES,
  parseCameraRegionConfigurationPayload,
} from './validation/camera-region-configuration-validator.js';

export type { CameraRegionConfigurationValidationResult } from './validation/camera-region-configuration-validator.js';

export type {
  CameraObservationRegionConfiguration,
  CameraRegionConfiguration,
  NormalizedCoordinate,
} from './camera-region-configuration.js';

export type {
  GateFacePresenceResponse,
  FaceGateDecisionResponse,
  FaceGateVerificationResponse,
  GateAccessLogResponse,
  FaceGateReasonCode,
  FaceProfileStatus,
  FaceVerificationTechnicalOutcome,
  GateAuthorizationOutcome,
  WorkerSiteZoneAssignmentStatus,
} from './identity-access-api.js';

export type {
  AccountResponse,
  AuthClientType,
  LoginResponse,
  ProvisionableRoleAssignment,
  ProvisionableUserRole,
  RoleAssignmentResponse,
  UserRole,
  Page,
  SiteResponse,
  CameraResponse,
  ZoneResponse,
  RegionResponse,
  RegionMutationResponse,
  SafetyAlertType,
  SafetyAlertStatus,
  SafetyAlertResponse,
  SafetyAlertDetectionResponse,
  SafetyAlertEvidenceResponse,
  SafetyAlertDetailResponse,
  SafetyAlertReviewTargetStatus,
  SafetyAlertReviewResponse,
  SafetyAlertReviewMutationResponse,
  WorkerResponse,
  ContractorResponse,
  ContractorParticipationResponse,
  ContractorRepresentativeGrantResponse,
  WorkerSiteZoneAssignmentResponse,
  FaceEnrollmentSessionResponse,
  FaceEnrollmentSessionStatus,
  FaceEnrollmentQualityResponse,
  EnrollmentCaptureTarget,
  FaceProfileResponse,
  ZoneAccessEffect,
  ZoneAccessGrantResponse,
  ZoneEntryDecisionStatus,
  ZoneEntryDecisionResponse,
  ContractorRepresentativeAssignmentResponse,
  ShiftResponse,
  ContractorShiftAssignmentResponse,
  ScheduleVersionResponse,
  WorkerScheduleResponse,
  EligibleShiftResponse,
  EligibleShiftListResponse,
  SwapCandidateShiftResponse,
  SwapCandidateResponse,
  SwapCandidateListResponse,
  SchedulingRequestStatus,
  SchedulingNotificationEvent,
  SchedulingNotificationTarget,
  UserNotificationResponse,
  UserNotificationListResponse,
  NotificationReadResponse,
  ShiftChangeRequestResponse,
  ShiftSwapRequestResponse,
  AbsenceRequestResponse,
} from './management-api.js';
export * from './safety-workflow-api.js';
