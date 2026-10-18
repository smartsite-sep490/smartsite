import assert from 'node:assert/strict';

// Reviewed Root 8a797a2 registry; keep this independent of production options.
const release61 = [
  'Mf05Mf06Foundation1789689600000',
  'CameraRegionConfiguration1790035200000',
  'UserAuthentication1790121600000',
  'SafetyAlertReadIndex1790467200000',
  'Mf06ZoneAuthorization1790553600000',
  'ScopedJwtAuthentication1790553600000',
  'SafetyAlertReviews1790640000000',
  'IdentityAccessScope1790726400000',
  'WorkforceTimeScheduling1790726400000',
  'FaceEnrollmentMetadata1790812800000',
  'Mf07WorkforceAccessScope1790812800000',
  'ZoneEntryTrackIdRange1790812800001',
  'AccountFaceTemplates1790899200000',
  'Mf07AbsenceScheduleVersion1790899200000',
  'ObservationIdentityReview1790899200000',
  'GateAccessLogs1790985600000',
  'ScheduleVersionUnique1790985600000',
  'WorkerGatePermissions1790992800000',
  'Mf08SafetyWorkflow1791000000000',
  'AllowMultipleWorkerShiftsPerDay1791072000000',
  'ContractorShiftAssignments1791158400000',
  'SchedulingRequestReviewReasons1791244800000',
  'Mf07SharedContractorCompatibility1791331200000',
  'Mf07Notifications1791417600000',
  'QrAccess1791417600000',
  'ErdVisitorAccess1791504000000',
  'IncidentContractorResponsibility1791504000000',
  'Mf07NotificationDeletion1791504000000',
  'ErdGateFlow1791504000001',
  'ErdFaceConsent1791504000002',
  'ErdZonePermissions1791504000003',
  'ErdAccessAudit1791504000004',
  'ErdAttendanceFlow1791504000005',
  'ErdAccessPolicy1791504000006',
  'SafetyHandoverNotifications1791590400000',
  'Mf06AssessmentRequests1791590400001',
  'Mf06MainAuthorityJournal1791590400002',
  'SafetyFaceProvenance1791590400003',
  'Mf06ImmutableAssessments1791590400004',
  'Mf03AttendanceReconciliation1791676800000',
  'WorkerCodeSequence1791676800000',
  'Mf03DailyOpenSessions1791676800001',
  'OptionalPasswordChange1791676800002',
  'Mf03AttendanceDuplicateReview1791676800003',
  'ContractorTeams1791676800004',
  'ShiftArchival1791763200000',
  'ShiftBreak1791763200001',
  'GateScheduleDenial1791849600000',
  'ScheduleAssignmentBatches1791849600001',
  'ScheduleChangeNotifications1791849600002',
  'SingleSiteManager1791936000000',
  'TeamZonePermissions1791940000000',
  'ContractorZoneRegrant1791940000001',
  'SingleTeamZone1791940000002',
  'AttendanceAbsence1792022400000',
  'VisitorRoster1792022400000',
  'SiteManagerReviewNotifications1792108800000',
  'SafetyChecklists1792195200000',
  'ShiftExitGracePeriod1792281600000',
  'AttendanceExitNotifications1792281600001',
  'PreserveManagerNotificationHistory1792368000000',
];

export function reviewedReleaseMigrationNames(migrations: unknown): string[] {
  assert(Array.isArray(migrations), 'Explicit release migration registrations required');
  const names = migrations.map((migration: unknown) => {
    assert(migration && (typeof migration === 'function' || typeof migration === 'object'));
    const name =
      typeof migration === 'function'
        ? migration.name
        : 'name' in migration
          ? migration.name
          : migration.constructor.name;
    assert(typeof name === 'string');
    return name;
  });
  const workerQr = 'WorkerQrShortCodes1792454400000';
  // Main eb56d14 adds QR; Main585cc263 adds exactly the four document migrations.
  const documents = [
    'WorkerDocuments1792540800000',
    'WorkerDocumentIdentityChecks1792627200000',
    'WorkerDocumentSubmittedExpiry1792713600000',
    'WorkerHealthIssueDate1792800000000',
  ];
  const expected = names.includes(documents[0]!)
    ? [...release61, workerQr, ...documents]
    : names.includes(workerQr)
      ? [...release61, workerQr]
      : release61;
  assert.deepEqual(names, expected, 'Exact reviewed release migration names and order');
  return names;
}
