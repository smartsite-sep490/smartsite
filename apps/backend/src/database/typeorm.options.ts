import { databaseSchemaSchema } from '../config/environment.js';
import { PpeAlertNotifications1792886400000 } from './migrations/1792886400000-PpeAlertNotifications.js';
import { ExpandedPpeNotificationKinds1793145600000 } from './migrations/1793145600000-ExpandedPpeNotificationKinds.js';
import { AuthorizationHistoryCutover1793232000000 } from './migrations/1793232000000-AuthorizationHistoryCutover.js';
import { ZoneAlertNotifications1793318400000 } from './migrations/1793318400000-ZoneAlertNotifications.js';
import { AlertDetectionSubject1793404800000 } from './migrations/1793404800000-AlertDetectionSubject.js';
import { CameraConfigurationReferences1793491200000 } from './migrations/1793491200000-CameraConfigurationReferences.js';
import { CameraRegionGeometryRevisions1793577600000 } from './migrations/1793577600000-CameraRegionGeometryRevisions.js';
import { PrepareNotificationCompatibility1792010000000 } from './migrations/1792010000000-PrepareNotificationCompatibility.js';
import { Mf06TeamAuthorityHistory1792281600000 } from './migrations/1792281600000-Mf06TeamAuthorityHistory.js';
import { CompleteNotificationCompatibility1792368000001 } from './migrations/1792368000001-CompleteNotificationCompatibility.js';
import { ZoneEntryPhysicalStorage1792454400000 } from './migrations/1792454400000-ZoneEntryPhysicalStorage.js';
import { WorkerQrShortCodes1792454400000 } from './migrations/1792454400000-WorkerQrShortCodes.js';
import { WorkerDocumentIdentityChecks1792627200000 } from './migrations/1792627200000-WorkerDocumentIdentityChecks.js';
import { WorkerDocumentSubmittedExpiry1792713600000 } from './migrations/1792713600000-WorkerDocumentSubmittedExpiry.js';
import { WorkerHealthIssueDate1792800000000 } from './migrations/1792800000000-WorkerHealthIssueDate.js';
import { PreserveManagerNotificationHistory1792368000000 } from './migrations/1792368000000-PreserveManagerNotificationHistory.js';
import { SiteManagerReviewNotifications1792108800000 } from './migrations/1792108800000-SiteManagerReviewNotifications.js';
import { VisitorRoster1792022400000 } from './migrations/1792022400000-VisitorRoster.js';
import { Mf06AssessmentRequests1791590400001 } from './migrations/1791590400001-Mf06AssessmentRequests.js';
import { Mf06MainAuthorityJournal1791590400002 } from './migrations/1791590400002-Mf06MainAuthorityJournal.js';
import { SafetyFaceProvenance1791590400003 } from './migrations/1791590400003-SafetyFaceProvenance.js';
import { Mf06ImmutableAssessments1791590400004 } from './migrations/1791590400004-Mf06ImmutableAssessments.js';
import { ShiftExitGracePeriod1792281600000 } from './migrations/1792281600000-ShiftExitGracePeriod.js';
import { AttendanceExitNotifications1792281600001 } from './migrations/1792281600001-AttendanceExitNotifications.js';
import { SafetyChecklists1792195200000 } from './migrations/1792195200000-SafetyChecklists.js';
import { SingleSiteManager1791936000000 } from './migrations/1791936000000-SingleSiteManager.js';
import { AttendanceAbsence1792022400000 } from './migrations/1792022400000-AttendanceAbsence.js';
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
  DATABASE_SCHEMA?: string;
  DATABASE_TIMEOUT_MS?: number;
}

export function buildTypeOrmOptions(config: DatabaseConnectionConfig): DataSourceOptions {
  const timeoutMs = config.DATABASE_TIMEOUT_MS ?? 2000;
  const schema = databaseSchemaSchema.optional().parse(config.DATABASE_SCHEMA);
  if (schema !== undefined && new URL(config.DATABASE_URL).searchParams.has('options'))
    throw new Error('DATABASE_SCHEMA cannot be combined with URL options');
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    ...(schema === undefined ? {} : { schema }),
    synchronize: false,
    migrationsRun: false,
    connectTimeoutMS: timeoutMs,
    // PostgreSQL supplies gen_random_uuid(); connection startup must not install
    // extensions just because a read-only projection contains a generated UUID.
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    entities: ENTITIES.filter((entity) => !LEGACY_ONLY_ENTITIES.has(entity)),
    migrations: [
      Mf05Mf06Foundation1789689600000,
      CameraRegionConfiguration1790035200000,
      UserAuthentication1790121600000,
      SafetyAlertReadIndex1790467200000,
      Mf06ZoneAuthorization1790553600000,
      ScopedJwtAuthentication1790553600000,
      SafetyAlertReviews1790640000000,
      IdentityAccessScope1790726400000,
      WorkforceTimeScheduling1790726400000,
      FaceEnrollmentMetadata1790812800000,
      Mf07WorkforceAccessScope1790812800000,
      ZoneEntryTrackIdRange1790812800001,
      AccountFaceTemplates1790899200000,
      Mf07AbsenceScheduleVersion1790899200000,
      ObservationIdentityReview1790899200000,
      GateAccessLogs1790985600000,
      ScheduleVersionUnique1790985600000,
      WorkerGatePermissions1790992800000,
      Mf08SafetyWorkflow1791000000000,
      AllowMultipleWorkerShiftsPerDay1791072000000,
      ContractorShiftAssignments1791158400000,
      SchedulingRequestReviewReasons1791244800000,
      Mf07SharedContractorCompatibility1791331200000,
      Mf07Notifications1791417600000,
      QrAccess1791417600000,
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
      AttendanceAbsence1792022400000,
      VisitorRoster1792022400000,
      SiteManagerReviewNotifications1792108800000,
      SafetyChecklists1792195200000,
      ShiftExitGracePeriod1792281600000,
      AttendanceExitNotifications1792281600001,
      PreserveManagerNotificationHistory1792368000000,
      WorkerQrShortCodes1792454400000,
      WorkerDocuments1792540800000,
      WorkerDocumentIdentityChecks1792627200000,
      WorkerDocumentSubmittedExpiry1792713600000,
      WorkerHealthIssueDate1792800000000,
      PrepareNotificationCompatibility1792010000000,
      Mf06TeamAuthorityHistory1792281600000,
      CompleteNotificationCompatibility1792368000001,
      ZoneEntryPhysicalStorage1792454400000,
      PpeAlertNotifications1792886400000,
      ExpandedPpeNotificationKinds1793145600000,
      AuthorizationHistoryCutover1793232000000,
      ZoneAlertNotifications1793318400000,
      AlertDetectionSubject1793404800000,
      CameraConfigurationReferences1793491200000,
      CameraRegionGeometryRevisions1793577600000,
    ],
    logging: false,
    extra: {
      ...(schema === undefined ? {} : { options: `-c search_path=${schema}` }),
      max: 5,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idleTimeoutMillis: 30000,
      application_name: 'smartsite-backend',
    },
  };
}

export function createTypeOrmOptions(
  databaseUrl: string,
  timeoutMs = 2000,
  schema?: string,
): DataSourceOptions {
  return buildTypeOrmOptions({
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: schema,
    DATABASE_TIMEOUT_MS: timeoutMs,
  });
}
import { WorkerDocuments1792540800000 } from './migrations/1792540800000-WorkerDocuments.js';
