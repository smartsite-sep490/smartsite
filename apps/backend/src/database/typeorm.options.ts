import { Mf06AssessmentRequests1791590400001 } from './migrations/1791590400001-Mf06AssessmentRequests.js';
import { Mf06MainAuthorityJournal1791590400002 } from './migrations/1791590400002-Mf06MainAuthorityJournal.js';
import { SafetyFaceProvenance1791590400003 } from './migrations/1791590400003-SafetyFaceProvenance.js';
import { Mf06ImmutableAssessments1791590400004 } from './migrations/1791590400004-Mf06ImmutableAssessments.js';
import { SafetyChecklists1792195200000 } from './migrations/1792195200000-SafetyChecklists.js';
import { Mf06TeamAuthorityHistory1792281600000 } from './migrations/1792281600000-Mf06TeamAuthorityHistory.js';
import { SingleSiteManager1791936000000 } from './migrations/1791936000000-SingleSiteManager.js';
import { TeamZonePermissions1791940000000 } from './migrations/1791940000000-TeamZonePermissions.js';
import { ContractorZoneRegrant1791940000001 } from './migrations/1791940000001-ContractorZoneRegrant.js';
import { SingleTeamZone1791940000002 } from './migrations/1791940000002-SingleTeamZone.js';
import { ShiftArchival1791763200000 } from './migrations/1791763200000-ShiftArchival.js';
import { ShiftBreak1791763200001 } from './migrations/1791763200001-ShiftBreak.js';
import { GateScheduleDenial1791849600000 } from './migrations/1791849600000-GateScheduleDenial.js';
import { ScheduleAssignmentBatches1791849600001 } from './migrations/1791849600001-ScheduleAssignmentBatches.js';
import { ScheduleChangeNotifications1791849600002 } from './migrations/1791849600002-ScheduleChangeNotifications.js';
import { SafetyHandoverNotifications1791590400000 } from './migrations/1791590400000-SafetyHandoverNotifications.js';
import { ContractorTeams1791676800004 } from './migrations/1791676800004-ContractorTeams.js';
import { Mf03AttendanceReconciliation1791676800000 } from './migrations/1791676800000-Mf03AttendanceReconciliation.js';
import { Mf03DailyOpenSessions1791676800001 } from './migrations/1791676800001-Mf03DailyOpenSessions.js';
import { OptionalPasswordChange1791676800002 } from './migrations/1791676800002-OptionalPasswordChange.js';
import { Mf03AttendanceDuplicateReview1791676800003 } from './migrations/1791676800003-AttendanceDuplicateReview.js';
import { WorkerCodeSequence1791676800000 } from './migrations/1791676800000-WorkerCodeSequence.js';
import { Mf08SafetyWorkflow1791000000000 } from './migrations/1791000000000-Mf08SafetyWorkflow.js';
import { IncidentContractorResponsibility1791504000000 } from './migrations/1791504000000-IncidentContractorResponsibility.js';
import type { DataSourceOptions } from 'typeorm';
import {
  ENTITIES,
  ContractorZoneAccessGrantEntity,
  ZoneAuthorityCommandEntity,
  ZoneAuthorityFactRevisionEntity,
  ZoneAuthorityHistoryEpochEntity,
} from './entities/index.js';

// These belong to the retired branch-only ZoneAuthorityHistory schema, not retained main.
// Keep source exports for archive tooling; never register absent tables in the release DataSource.
const LEGACY_ONLY_ENTITIES: ReadonlySet<(typeof ENTITIES)[number]> = new Set([
  ContractorZoneAccessGrantEntity,
  ZoneAuthorityCommandEntity,
  ZoneAuthorityFactRevisionEntity,
  ZoneAuthorityHistoryEpochEntity,
]);
import { QrAccess1791417600000 } from './migrations/1791417600000-QrAccess.js';
import { Mf05Mf06Foundation1789689600000 } from './migrations/1789689600000-Mf05Mf06Foundation.js';
import { CameraRegionConfiguration1790035200000 } from './migrations/1790035200000-CameraRegionConfiguration.js';
import { UserAuthentication1790121600000 } from './migrations/1790121600000-UserAuthentication.js';
import { SafetyAlertReadIndex1790467200000 } from './migrations/1790467200000-SafetyAlertReadIndex.js';
import { ScopedJwtAuthentication1790553600000 } from './migrations/1790553600000-ScopedJwtAuthentication.js';
import { Mf06ZoneAuthorization1790553600000 } from './migrations/1790553600000-Mf06ZoneAuthorization.js';
import { SafetyAlertReviews1790640000000 } from './migrations/1790640000000-SafetyAlertReviews.js';
import { WorkforceTimeScheduling1790726400000 } from './migrations/1790726400000-WorkforceTimeScheduling.js';
import { Mf07WorkforceAccessScope1790812800000 } from './migrations/1790812800000-Mf07WorkforceAccessScope.js';
import { Mf07AbsenceScheduleVersion1790899200000 } from './migrations/1790899200000-Mf07AbsenceScheduleVersion.js';
import { ScheduleVersionUnique1790985600000 } from './migrations/1790985600000-ScheduleVersionUnique.js';
import { AllowMultipleWorkerShiftsPerDay1791072000000 } from './migrations/1791072000000-AllowMultipleWorkerShiftsPerDay.js';
import { ContractorShiftAssignments1791158400000 } from './migrations/1791158400000-ContractorShiftAssignments.js';
import { SchedulingRequestReviewReasons1791244800000 } from './migrations/1791244800000-SchedulingRequestReviewReasons.js';
import { ZoneEntryTrackIdRange1790812800001 } from './migrations/1790812800001-ZoneEntryTrackIdRange.js';
import { ObservationIdentityReview1790899200000 } from './migrations/1790899200000-ObservationIdentityReview.js';
import { IdentityAccessScope1790726400000 } from './migrations/1790726400000-IdentityAccessScope.js';
import { FaceEnrollmentMetadata1790812800000 } from './migrations/1790812800000-FaceEnrollmentMetadata.js';
import { AccountFaceTemplates1790899200000 } from './migrations/1790899200000-AccountFaceTemplates.js';
import { GateAccessLogs1790985600000 } from './migrations/1790985600000-GateAccessLogs.js';
import { WorkerGatePermissions1790992800000 } from './migrations/1790992800000-WorkerGatePermissions.js';
import { Mf07SharedContractorCompatibility1791331200000 } from './migrations/1791331200000-Mf07SharedContractorCompatibility.js';
import { Mf07Notifications1791417600000 } from './migrations/1791417600000-Mf07Notifications.js';
import { ErdVisitorAccess1791504000000 } from './migrations/1791504000000-ErdVisitorAccess.js';
import { ErdGateFlow1791504000001 } from './migrations/1791504000001-ErdGateFlow.js';
import { ErdFaceConsent1791504000002 } from './migrations/1791504000002-ErdFaceConsent.js';
import { ErdZonePermissions1791504000003 } from './migrations/1791504000003-ErdZonePermissions.js';
import { ErdAccessAudit1791504000004 } from './migrations/1791504000004-ErdAccessAudit.js';
import { ErdAttendanceFlow1791504000005 } from './migrations/1791504000005-ErdAttendanceFlow.js';
import { ErdAccessPolicy1791504000006 } from './migrations/1791504000006-ErdAccessPolicy.js';
import { Mf07NotificationDeletion1791504000000 } from './migrations/1791504000000-Mf07NotificationDeletion.js';

export interface DatabaseConnectionConfig {
  DATABASE_URL: string;
  DATABASE_TIMEOUT_MS?: number;
}

export function buildTypeOrmOptions(config: DatabaseConnectionConfig): DataSourceOptions {
  const timeoutMs = config.DATABASE_TIMEOUT_MS ?? 2000;
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    synchronize: false,
    migrationsRun: false,
    connectTimeoutMS: timeoutMs,
    entities: ENTITIES.filter((entity) => !LEGACY_ONLY_ENTITIES.has(entity)),
    migrations: [
      Mf05Mf06Foundation1789689600000,
      CameraRegionConfiguration1790035200000,
      UserAuthentication1790121600000,
      SafetyAlertReadIndex1790467200000,
      ScopedJwtAuthentication1790553600000,
      Mf06ZoneAuthorization1790553600000,
      SafetyAlertReviews1790640000000,
      WorkforceTimeScheduling1790726400000,
      IdentityAccessScope1790726400000,
      Mf07WorkforceAccessScope1790812800000,
      FaceEnrollmentMetadata1790812800000,
      ZoneEntryTrackIdRange1790812800001,
      Mf07AbsenceScheduleVersion1790899200000,
      AccountFaceTemplates1790899200000,
      ObservationIdentityReview1790899200000,
      ScheduleVersionUnique1790985600000,
      GateAccessLogs1790985600000,
      WorkerGatePermissions1790992800000,
      Mf08SafetyWorkflow1791000000000,
      AllowMultipleWorkerShiftsPerDay1791072000000,
      ContractorShiftAssignments1791158400000,
      SchedulingRequestReviewReasons1791244800000,
      Mf07SharedContractorCompatibility1791331200000,
      QrAccess1791417600000,
      Mf07Notifications1791417600000,
      ErdVisitorAccess1791504000000,
      IncidentContractorResponsibility1791504000000,
      Mf07NotificationDeletion1791504000000,
      ErdGateFlow1791504000001,
      ErdFaceConsent1791504000002,
      ErdZonePermissions1791504000003,
      ErdAccessAudit1791504000004,
      ErdAttendanceFlow1791504000005,
      ErdAccessPolicy1791504000006,
      SafetyHandoverNotifications1791590400000,
      Mf06AssessmentRequests1791590400001,
      Mf06MainAuthorityJournal1791590400002,
      SafetyFaceProvenance1791590400003,
      Mf06ImmutableAssessments1791590400004,
      Mf03AttendanceReconciliation1791676800000,
      WorkerCodeSequence1791676800000,
      Mf03DailyOpenSessions1791676800001,
      OptionalPasswordChange1791676800002,
      Mf03AttendanceDuplicateReview1791676800003,
      ContractorTeams1791676800004,
      ShiftArchival1791763200000,
      ShiftBreak1791763200001,
      GateScheduleDenial1791849600000,
      ScheduleAssignmentBatches1791849600001,
      ScheduleChangeNotifications1791849600002,
      SingleSiteManager1791936000000,
      TeamZonePermissions1791940000000,
      ContractorZoneRegrant1791940000001,
      SingleTeamZone1791940000002,
      SafetyChecklists1792195200000,
      Mf06TeamAuthorityHistory1792281600000,
    ],
    logging: false,
    extra: {
      max: 5,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idleTimeoutMillis: 30000,
      application_name: 'smartsite-backend',
    },
  };
}

export function createTypeOrmOptions(databaseUrl: string, timeoutMs = 2000): DataSourceOptions {
  return buildTypeOrmOptions({
    DATABASE_URL: databaseUrl,
    DATABASE_TIMEOUT_MS: timeoutMs,
  });
}
