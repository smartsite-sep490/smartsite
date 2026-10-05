import {
  IncidentEntity,
  CorrectiveActionEntity,
  CorrectiveActionSubmissionEntity,
  SafetyTaskEntity,
  SafetyEvidenceEntity,
  SafetyWorkflowAuditEntity,
} from './safety-workflow.entity.js';
import { SiteEntity } from './site.entity.js';
import { CameraEntity } from './camera.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { CameraObservationRegionEntity } from './camera-observation-region.entity.js';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';
import { AlertDetectionMappingEntity } from './alert-detection-mapping.entity.js';
import { UserEntity } from './user.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { UserRoleAssignmentEntity } from './user-role-assignment.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ZoneAccessGrantEntity } from './zone-access-grant.entity.js';
import { ZoneEntryDecisionEntity } from './zone-entry-decision.entity.js';
import { SafetyAlertReviewEntity } from './safety-alert-review.entity.js';
import { ObservationIdentityResolutionEntity } from './observation-identity-resolution.entity.js';
import { ObservationIdentityDecisionEntity } from './observation-identity-decision.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { ContractorSiteParticipationEntity } from './contractor-site-participation.entity.js';
import { ContractorRepresentativeGrantEntity } from './contractor-representative-grant.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';
import { FaceProfileEntity } from './face-profile.entity.js';
import { FaceEnrollmentSessionEntity } from './face-enrollment-session.entity.js';
import { GateAccessLogEntity } from './gate-access-log.entity.js';
import { WorkerGatePermissionEntity } from './worker-gate-permission.entity.js';

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
export * from './worker.entity.js';
export * from './zone-access-grant.entity.js';
export * from './zone-entry-decision.entity.js';
export * from './safety-alert-review.entity.js';
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

export * from './safety-workflow.entity.js';
export const ENTITIES = [
  IncidentEntity,
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
  WorkerEntity,
  ZoneAccessGrantEntity,
  ZoneEntryDecisionEntity,
  SafetyAlertReviewEntity,
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
] as const;
