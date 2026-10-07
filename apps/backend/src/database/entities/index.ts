import {
  IncidentEntity,
  IncidentWorkerEntity,
  CorrectiveActionEntity,
  CorrectiveActionSubmissionEntity,
  SafetyTaskEntity,
  SafetyEvidenceEntity,
  SafetyWorkflowAuditEntity,
} from './safety-workflow.entity.js';
import { SiteEntity } from './site.entity.js';
import { AccessAttemptEntity, GateEventEntity } from './access-flow.entity.js';
import { AccessAuditEntity } from './access-audit.entity.js';
import {
  AttendanceEventEntity,
  AttendanceSessionEntity,
  AttendanceCorrectionEntity,
} from './attendance-flow.entity.js';
export * from './attendance-flow.entity.js';
export * from './access-audit.entity.js';
import {
  ContractorZonePermissionEntity,
  WorkerZonePermissionEntity,
} from './zone-permission.entity.js';
export * from './zone-permission.entity.js';
export * from './access-flow.entity.js';
import {
  VisitorVisitEntity,
  QrFallbackSessionEntity,
  QrCredentialEntity,
  VisitorGateEventEntity,
  VisitorEntity,
  VisitZoneEntity,
} from './qr-access.entity.js';
export * from './qr-access.entity.js';
import { CameraEntity } from './camera.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { CameraObservationRegionEntity } from './camera-observation-region.entity.js';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';
import { AlertDetectionMappingEntity } from './alert-detection-mapping.entity.js';
import { UserEntity } from './user.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { UserRoleAssignmentEntity } from './user-role-assignment.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { ContractorRepresentativeAssignmentEntity } from './contractor-representative-assignment.entity.js';
import { ContractorShiftAssignmentEntity } from './contractor-shift-assignment.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ZoneAccessGrantEntity } from './zone-access-grant.entity.js';
import { ZoneEntryDecisionEntity } from './zone-entry-decision.entity.js';
import { SafetyAlertReviewEntity } from './safety-alert-review.entity.js';
import { ShiftEntity } from './shift.entity.js';
import { ScheduleVersionEntity } from './schedule-version.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';
import { AttendancePairEntity } from './attendance-pair.entity.js';
import { AttendanceAnomalyEntity } from './attendance-anomaly.entity.js';
import { AttendanceCorrectionRequestEntity } from './attendance-correction-request.entity.js';
import { TimesheetEntity } from './timesheet.entity.js';
import { ShiftChangeRequestEntity } from './shift-change-request.entity.js';
import { ShiftSwapRequestEntity } from './shift-swap-request.entity.js';
import { AbsenceRequestEntity } from './absence-request.entity.js';
import { ObservationIdentityResolutionEntity } from './observation-identity-resolution.entity.js';
import { ObservationIdentityDecisionEntity } from './observation-identity-decision.entity.js';
import { ContractorSiteParticipationEntity } from './contractor-site-participation.entity.js';
import { ContractorRepresentativeGrantEntity } from './contractor-representative-grant.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';
import { FaceProfileEntity } from './face-profile.entity.js';
import { FaceEnrollmentSessionEntity } from './face-enrollment-session.entity.js';
import { GateAccessLogEntity } from './gate-access-log.entity.js';
import { WorkerGatePermissionEntity } from './worker-gate-permission.entity.js';
import { UserNotificationEntity } from './user-notification.entity.js';

export * from './enums.js';
export * from './numeric.transformer.js';
export * from './site.entity.js';
export * from './camera.entity.js';
export * from './zone.entity.js';
export * from './camera-observation-region.entity.js';
export * from './ai-observation-event.entity.js';
export * from './safety-alert.entity.js';
export * from './alert-detection-mapping.entity.js';
export * from './user.entity.js';
export * from './auth-session.entity.js';
export * from './user-role-assignment.entity.js';
export * from './contractor.entity.js';
export * from './contractor-representative-assignment.entity.js';
export * from './contractor-shift-assignment.entity.js';
export * from './worker.entity.js';
export * from './zone-access-grant.entity.js';
export * from './zone-entry-decision.entity.js';
export * from './safety-alert-review.entity.js';
export * from './shift.entity.js';
export * from './schedule-version.entity.js';
export * from './worker-schedule.entity.js';
export * from './attendance-pair.entity.js';
export * from './attendance-anomaly.entity.js';
export * from './attendance-correction-request.entity.js';
export * from './timesheet.entity.js';
export * from './shift-change-request.entity.js';
export * from './shift-swap-request.entity.js';
export * from './absence-request.entity.js';
export * from './observation-identity-resolution.entity.js';
export * from './observation-identity-decision.entity.js';
export * from './contractor.entity.js';
export * from './contractor-site-participation.entity.js';
export * from './contractor-representative-grant.entity.js';
export * from './worker-site-zone-assignment.entity.js';
export * from './face-profile.entity.js';
export * from './face-enrollment-session.entity.js';
export * from './gate-access-log.entity.js';
export * from './worker-gate-permission.entity.js';
export * from './user-notification.entity.js';

export * from './safety-workflow.entity.js';
export const ENTITIES = [
  AttendanceEventEntity,
  AttendanceSessionEntity,
  AttendanceCorrectionEntity,
  AccessAuditEntity,
  ContractorZonePermissionEntity,
  WorkerZonePermissionEntity,
  AccessAttemptEntity,
  GateEventEntity,
  VisitorEntity,
  VisitZoneEntity,
  VisitorVisitEntity,
  QrFallbackSessionEntity,
  QrCredentialEntity,
  VisitorGateEventEntity,
  IncidentEntity,
  IncidentWorkerEntity,
  CorrectiveActionEntity,
  CorrectiveActionSubmissionEntity,
  SafetyTaskEntity,
  SafetyEvidenceEntity,
  SafetyWorkflowAuditEntity,
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  AiObservationEventEntity,
  SafetyAlertEntity,
  AlertDetectionMappingEntity,
  UserEntity,
  AuthSessionEntity,
  UserRoleAssignmentEntity,
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorShiftAssignmentEntity,
  WorkerEntity,
  ZoneAccessGrantEntity,
  ZoneEntryDecisionEntity,
  SafetyAlertReviewEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
  AttendancePairEntity,
  AttendanceAnomalyEntity,
  AttendanceCorrectionRequestEntity,
  TimesheetEntity,
  ShiftChangeRequestEntity,
  ShiftSwapRequestEntity,
  AbsenceRequestEntity,
  ObservationIdentityResolutionEntity,
  ObservationIdentityDecisionEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeGrantEntity,
  WorkerSiteZoneAssignmentEntity,
  FaceProfileEntity,
  FaceEnrollmentSessionEntity,
  GateAccessLogEntity,
  WorkerGatePermissionEntity,
  UserNotificationEntity,
] as const;
