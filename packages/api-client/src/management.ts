import type {
  GrantTeamZoneCommand,
  TeamZoneSetupResponse,
  ManagerOverviewResponse,
  ManagerContractorDetailResponse,
  GlobalContractorSummary,
  ContractorParticipationListResponse,
  ScheduleAssignmentInput,
  ScheduleAssignmentPreview,
  ScheduleAssignmentBatchResponse,
  CreateScheduleAssignmentCommand,
  ChangeScheduleAssignmentCommand,
  ScheduleAssignmentChangeResponse,
  ContractorDashboardScope,
  ContractorDashboardResponse,
  ContractorTeamResponse,
  ContractorTeamWorkerResponse,
  ContractorTeamQuery,
  ContractorTeamWorkersQuery,
  CreateContractorTeamCommand,
  UpdateContractorTeamCommand,
  ArchiveContractorTeamCommand,
  AssignContractorTeamCommand,
  AttendanceDaysResponse,
  AttendanceReportQuery,
  AttendanceWorkersQuery,
  AttendanceSummaryResponse,
  AttendanceWorkersResponse,
  AttendanceTimeRequestsQuery,
  AttendanceTimeRequestsResponse,
  AttendanceDayDetailResponse,
  AttendanceTimesheetResponse,
  AttendanceDaysQuery,
  AttendanceOverviewQuery,
  IgnoreDuplicateAttendanceCommand,
  AttendanceTimeRequestCommand,
  ReviewAttendanceDayCommand,
  ConfirmIncidentResponsibilityCommand,
  CorrectIncidentResponsibilityCommand,
  TransferCorrectiveActionCommand,
  SafetyContractorResponse,
  IncidentWorkerResponse,
  IncidentResponse,
  IncidentDetailResponse,
  SafetyTaskResponse,
  SafetyTaskDetailResponse,
  SafetyAssigneeResponse,
  WorkflowMutationResponse,
  CreateIncidentCommand,
  CreateSafetyTaskCommand,
  VersionCommand,
  ReasonCommand,
  LinkIncidentAlertsCommand,
  AssignCorrectiveActionCommand,
  SubmitSafetyResultCommand,
  ReviewSubmissionCommand,
  ReopenIncidentCommand,
} from '@smartsite/contracts';

import {
  parseObservationIdentityContextResponse,
  parseObservationIdentityDecisionPage,
  parseObservationIdentityMutationResponse,
  parseObservationIdentityWorkerPage,
  type ObservationIdentityContextResponse,
  type ObservationIdentityDecisionCommand,
  type ObservationIdentityMutationResponse,
  type ObservationIdentityWorkerResponse,
} from '@smartsite/contracts/management';
import type {
  CreateVisitCommand,
  VisitResponse,
  QrPassResponse,
  VisitorPassResponse,
  QrFallbackResponse,
  IssueWorkerQrCommand,
  WorkerQrVerificationCommand,
  VisitorGateCommand,
  WorkerQrVerificationResponse,
  VisitorGateEventResponse,
  VisitorQrPreviewResponse,
  ConfirmPassageCommand,
  GateEventResponse,
  AccessSetupResponse,
  GrantContractorZoneCommand,
  GrantContractorZoneDatesCommand,
  GrantWorkerZoneCommand,
  ManualWorkerVerificationCommand,
  AccessAttemptResponse,
  AttendanceOverviewResponse,
  AttendanceSessionResponse,
  RecordAttendanceCommand,
  RequestAttendanceCorrectionCommand,
  ReviewAttendanceCorrectionCommand,
  ReviewAttendanceTimeCommand,
  AccountResponse,
  CreateContractorWorkerAccountCommand,
  ContractorWorkerAccountResponse,
  ContractorWorkerAccountOptionsResponse,
  AuthClientType,
  CameraResponse,
  LoginResponse,
  Page,
  ProvisionableRoleAssignment,
  RegionMutationResponse,
  RegionResponse,
  SafetyAlertDetailResponse,
  SafetyAlertResponse,
  SafetyAlertReviewMutationResponse,
  SafetyAlertReviewTargetStatus,
  SafetyAlertStatus,
  SafetyAlertType,
  SiteResponse,
  ZoneResponse,
  WorkerResponse,
  UpdateContractorWorkerCommand,
  ContractorResponse,
  ContractorParticipationResponse,
  ContractorRepresentativeGrantResponse,
  WorkerSiteZoneAssignmentResponse,
  FaceEnrollmentSessionResponse,
  FaceEnrollmentQualityResponse,
  FaceProfileResponse,
  ZoneAccessEffect,
  ZoneAccessGrantResponse,
  ZoneEntryDecisionResponse,
  ZoneEntryDecisionStatus,
  ContractorRepresentativeAssignmentResponse,
  ShiftResponse,
  ContractorShiftAssignmentResponse,
  ScheduleVersionResponse,
  WorkerScheduleResponse,
  EligibleShiftListResponse,
  SwapCandidateListResponse,
  ShiftChangeRequestResponse,
  ShiftSwapRequestResponse,
  AbsenceRequestResponse,
  SchedulingRequestStatus,
  ShiftRequestListOptions,
  ShiftRequestListResponse,
  UserNotificationListResponse,
  NotificationReadResponse,
  NotificationDeleteReadResponse,
  NotificationDeleteResponse,
  FaceGateVerificationResponse,
  GateFacePresenceResponse,
  GateAccessLogResponse,
  EnrollmentCaptureTarget,
  WorkerGatePermissionsResponse,
  SetWorkerGatePermissionsCommand,
} from '@smartsite/contracts';
export type { SchedulingRequestStatus };

/** React Native FormData uses URI-backed files instead of browser File objects. */
export type NativeUploadFile = { uri: string; name: string; type: string };
export type UploadFile = File | NativeUploadFile;
function appendFile(form: FormData, field: string, file: Blob | NativeUploadFile, name?: string) {
  if ('uri' in file) form.append(field, file as unknown as Blob);
  else if (name) form.append(field, file, name);
  else form.append(field, file);
}

import { ApiError, parseBackendErrorEnvelope, type RequestOptions } from './errors';

export type PageOptions = { offset?: number; limit?: number };
export type WorkerScheduleListOptions = PageOptions & {
  contractorId?: string;
  fromDate?: string;
  toDate?: string;
  workerId?: string;
  teamId?: string;
  shiftId?: string;
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
  searchName?: string;
};
export type SafetyAlertListOptions = PageOptions & {
  zoneId?: string;
  cameraExternalId?: string;
  capturedFrom?: string;
  capturedUntil?: string;
  contextTeamId?: string;
  attentionOnly?: boolean;
  status?: SafetyAlertStatus;
  type?: SafetyAlertType;
};
export type ZoneEntryDecisionListOptions = PageOptions & {
  zoneId?: string;
  status?: ZoneEntryDecisionStatus;
};
type CameraMutation = { expectedConfigurationVersion: number };
const pathId = (id: string) => encodeURIComponent(id);
const MAX_TIMEOUT_MS = 2_147_483_647;
// Node clamps NaN, Infinity, negatives, and delays above 2^31-1 to 1ms.
const validTimeout = (timeoutMs: number) =>
  Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_TIMEOUT_MS;

export interface ManagementSession {
  getAccessToken(presentedToken: string): string;
  refreshAccessToken(failedToken: string): Promise<string>;
  onUnauthorized(failedToken: string): void;
  signal: AbortSignal;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 ? seconds : undefined;
}

export class SmartSiteManagementClient {
  updateTeamZone(
    token: string,
    siteId: string,
    contractorId: string,
    teamId: string,
    id: string,
    input: GrantTeamZoneCommand,
  ) {
    return this.request<{ id: string }>(
      'PATCH',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}/zones/${pathId(id)}`,
      token,
      input,
    );
  }
  teamZoneSetup(token: string, siteId: string, contractorId: string, teamId: string) {
    return this.request<TeamZoneSetupResponse>(
      'GET',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}/zones`,
      token,
    );
  }
  grantTeamZone(
    token: string,
    siteId: string,
    contractorId: string,
    teamId: string,
    input: GrantTeamZoneCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}/zones`,
      token,
      input,
    );
  }
  revokeTeamZone(token: string, siteId: string, contractorId: string, teamId: string, id: string) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}/zones/${pathId(id)}/revoke`,
      token,
    );
  }
  managerOverview(token: string, siteId: string, options?: PageOptions) {
    return this.request<ManagerOverviewResponse>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/management/overview`, options),
      token,
    );
  }
  listGlobalContractors(token: string, options?: PageOptions) {
    return this.request<Page<GlobalContractorSummary>>(
      'GET',
      this.listPath('/contractors', options),
      token,
    );
  }
  listContractorParticipations(token: string, contractorId: string, options?: PageOptions) {
    return this.request<ContractorParticipationListResponse>(
      'GET',
      this.listPath(`/contractors/${pathId(contractorId)}/participations`, options),
      token,
    );
  }

  managerContractorDetail(
    token: string,
    siteId: string,
    contractorId: string,
    query: { date: string; timezone: string },
  ) {
    return this.request<ManagerContractorDetailResponse>(
      'GET',
      this.listPath(
        `/sites/${pathId(siteId)}/management/contractors/${pathId(contractorId)}`,
        query,
      ),
      token,
    );
  }
  myContractorTeam(token: string, siteId: string) {
    return this.request<ContractorTeamWorkerResponse>(
      'GET',
      `/sites/${pathId(siteId)}/my-team`,
      token,
    );
  }
  contractorDashboardScopes(token: string) {
    return this.request<{ items: ContractorDashboardScope[] }>(
      'GET',
      '/contractor-dashboard/scopes',
      token,
    );
  }
  contractorDashboard(token: string, siteId: string, contractorId: string) {
    return this.request<ContractorDashboardResponse>(
      'GET',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/dashboard`,
      token,
    );
  }
  listContractorTeams(
    token: string,
    siteId: string,
    contractorId: string,
    options: ContractorTeamQuery = {},
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<Page<ContractorTeamResponse>>(
      'GET',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams?${query}`,
      token,
    );
  }
  contractorTeamDetail(token: string, siteId: string, contractorId: string, teamId: string) {
    return this.request<ContractorTeamResponse>(
      'GET',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}`,
      token,
    );
  }
  createContractorTeam(
    token: string,
    siteId: string,
    contractorId: string,
    input: CreateContractorTeamCommand,
  ) {
    return this.request<ContractorTeamResponse>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams`,
      token,
      input,
    );
  }
  updateContractorTeam(
    token: string,
    siteId: string,
    contractorId: string,
    teamId: string,
    input: UpdateContractorTeamCommand,
  ) {
    return this.request<ContractorTeamResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}`,
      token,
      input,
    );
  }
  archiveContractorTeam(
    token: string,
    siteId: string,
    contractorId: string,
    teamId: string,
    input: ArchiveContractorTeamCommand,
  ) {
    return this.request<ContractorTeamResponse>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/teams/${pathId(teamId)}/archive`,
      token,
      input,
    );
  }
  listContractorTeamWorkers(
    token: string,
    siteId: string,
    contractorId: string,
    options: ContractorTeamWorkersQuery = {},
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<Page<ContractorTeamWorkerResponse>>(
      'GET',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/team-workers?${query}`,
      token,
    );
  }
  assignContractorTeam(
    token: string,
    siteId: string,
    contractorId: string,
    workerId: string,
    input: AssignContractorTeamCommand,
  ) {
    return this.request<ContractorTeamWorkerResponse>(
      'PUT',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/team-workers/${pathId(workerId)}/team`,
      token,
      input,
    );
  }
  attendanceTimeRequests(token: string, siteId: string, options: AttendanceTimeRequestsQuery) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<AttendanceTimeRequestsResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-time-requests?${query}`,
      token,
    );
  }
  ignoreDuplicateAttendance(
    token: string,
    siteId: string,
    sessionId: string,
    input: IgnoreDuplicateAttendanceCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-sessions/${pathId(sessionId)}/ignore-duplicate`,
      token,
      input,
    );
  }
  attendanceOverview(token: string, siteId: string, options: AttendanceOverviewQuery = {}) {
    return this.request<AttendanceOverviewResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance${options.dayId ? `?dayId=${encodeURIComponent(options.dayId)}` : ''}`,
      token,
    );
  }
  attendanceDays(token: string, siteId: string, options: AttendanceDaysQuery = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<AttendanceDaysResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-days?${query}`,
      token,
    );
  }
  attendanceSummary(token: string, siteId: string, options: AttendanceReportQuery) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<AttendanceSummaryResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-summary?${query}`,
      token,
    );
  }
  attendanceWorkers(token: string, siteId: string, options: AttendanceWorkersQuery) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<AttendanceWorkersResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-workers?${query}`,
      token,
    );
  }
  requestAttendanceTime(token: string, siteId: string, input: AttendanceTimeRequestCommand) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-time-requests`,
      token,
      input,
    );
  }
  attendanceDayDetail(token: string, siteId: string, id: string) {
    return this.request<AttendanceDayDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-days/${pathId(id)}`,
      token,
    );
  }
  attendanceTimesheets(token: string, siteId: string, options: AttendanceDaysQuery = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value));
    return this.request<AttendanceTimesheetResponse>(
      'GET',
      `/sites/${pathId(siteId)}/attendance-timesheets?${query}`,
      token,
    );
  }
  reviewAttendanceTime(
    token: string,
    siteId: string,
    id: string,
    kind: 'OVERTIME' | 'LEAVE',
    input: ReviewAttendanceTimeCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-time-requests/${kind}/${pathId(id)}/review`,
      token,
      input,
    );
  }
  confirmAttendanceDay(
    token: string,
    siteId: string,
    id: string,
    input: ReviewAttendanceDayCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-days/${pathId(id)}/confirm`,
      token,
      input,
    );
  }
  recordAttendance(token: string, siteId: string, eventId: string, input: RecordAttendanceCommand) {
    return this.request<AttendanceSessionResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gate-events/${pathId(eventId)}/attendance`,
      token,
      input,
    );
  }
  requestAttendanceCorrection(
    token: string,
    siteId: string,
    sessionId: string,
    input: RequestAttendanceCorrectionCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-sessions/${pathId(sessionId)}/corrections`,
      token,
      input,
    );
  }
  reviewAttendanceCorrection(
    token: string,
    siteId: string,
    correctionId: string,
    input: ReviewAttendanceCorrectionCommand,
  ) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/attendance-corrections/${pathId(correctionId)}/review`,
      token,
      input,
    );
  }
  manuallyVerifyWorker(
    token: string,
    siteId: string,
    gateId: string,
    input: ManualWorkerVerificationCommand,
  ) {
    return this.request<AccessAttemptResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${encodeURIComponent(gateId)}/manual-verifications`,
      token,
      input,
    );
  }
  accessSetup(token: string, siteId: string) {
    return this.request<AccessSetupResponse>('GET', `/sites/${pathId(siteId)}/access-setup`, token);
  }
  grantContractorZone(token: string, siteId: string, input: GrantContractorZoneCommand) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/contractor-zone-permissions`,
      token,
      input,
    );
  }
  grantContractorZoneDates(token: string, siteId: string, input: GrantContractorZoneDatesCommand) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/contractor-zone-permissions/dates`,
      token,
      input,
    );
  }
  grantWorkerZone(token: string, siteId: string, input: GrantWorkerZoneCommand) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/worker-zone-permissions`,
      token,
      input,
    );
  }
  revokeZonePermission(token: string, siteId: string, id: string, kind: 'worker' | 'contractor') {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/${kind}-zone-permissions/${pathId(id)}/revoke`,
      token,
    );
  }
  confirmGatePassage(
    token: string,
    siteId: string,
    attemptId: string,
    input: ConfirmPassageCommand,
  ) {
    return this.request<GateEventResponse>(
      'POST',
      `/sites/${pathId(siteId)}/access-attempts/${pathId(attemptId)}/confirm`,
      token,
      input,
    );
  }
  constructor(
    private readonly baseUrl: string,
    private readonly session?: ManagementSession,
  ) {}
  listVisitorSites() {
    return this.request<{ items: Array<{ id: string; name: string; code: string }> }>(
      'GET',
      '/visitor-registration/sites',
    );
  }
  registerVisit(siteId: string, input: CreateVisitCommand) {
    return this.request<VisitResponse>(
      'POST',
      `/visitor-registration/sites/${pathId(siteId)}/visits`,
      undefined,
      input,
    );
  }
  getVisitorPass(visitId: string, accessKey: string) {
    return this.request<VisitorPassResponse>('POST', '/visitor-registration/pass', undefined, {
      visitId,
      accessKey,
    });
  }
  listVisits(token: string, siteId: string) {
    return this.request<{ items: VisitResponse[] }>(
      'GET',
      `/sites/${pathId(siteId)}/visits`,
      token,
    );
  }
  retryVisitorEmail(token: string, siteId: string, visitId: string) {
    return this.request<VisitResponse>(
      'POST',
      `/sites/${pathId(siteId)}/visits/${pathId(visitId)}/email`,
      token,
      {},
    );
  }
  decideVisit(
    token: string,
    siteId: string,
    visitId: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    review?: { expectedVersion?: number; reviewNote?: string },
  ) {
    return this.request<VisitResponse>(
      'POST',
      `/sites/${pathId(siteId)}/visits/${pathId(visitId)}/decision`,
      token,
      { status, ...review },
    );
  }
  issueWorkerQr(
    token: string,
    siteId: string,
    input: IssueWorkerQrCommand | string,
    options?: RequestOptions,
  ) {
    return this.request<QrPassResponse>(
      'POST',
      `/sites/${pathId(siteId)}/worker-qr`,
      token,
      typeof input === 'string' ? { fallbackSessionId: input } : input,
      undefined,
      options,
    );
  }
  openCameraQrFallback(token: string, siteId: string, gateId: string, direction: 'IN' | 'OUT') {
    return this.request<QrFallbackResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/qr-fallback`,
      token,
      { direction, reason: 'CAMERA_UNAVAILABLE' },
    );
  }
  verifyWorkerQr(
    token: string,
    siteId: string,
    gateId: string,
    input: WorkerQrVerificationCommand,
  ) {
    return this.request<WorkerQrVerificationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/qr-verifications`,
      token,
      input,
    );
  }
  verifyVisitorQr(token: string, siteId: string, gateId: string, input: VisitorGateCommand) {
    return this.request<VisitorGateEventResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/visitor-gate-events`,
      token,
      input,
    );
  }
  previewVisitorQr(token: string, siteId: string, gateId: string, qrToken: string) {
    return this.request<VisitorQrPreviewResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/visitor-qr-preview`,
      token,
      { token: qrToken },
    );
  }
  listVisitorEvents(token: string, siteId: string) {
    return this.request<{ items: VisitorGateEventResponse[] }>(
      'GET',
      `/sites/${pathId(siteId)}/visitor-gate-events`,
      token,
    );
  }

  listShiftRequests(token: string, siteId: string, options: ShiftRequestListOptions) {
    const query = new URLSearchParams({ view: options.view });
    if (options.requestType) query.set('requestType', options.requestType);
    if (options.search) query.set('search', options.search);
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return this.request<ShiftRequestListResponse>(
      'GET',
      `/sites/${pathId(siteId)}/shift-requests?${query}`,
      token,
    );
  }

  listNotifications(
    token: string,
    options: PageOptions & { readStatus?: 'ALL' | 'UNREAD' } = {},
    requestOptions?: RequestOptions,
  ): Promise<UserNotificationListResponse> {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.readStatus) query.set('readStatus', options.readStatus);
    return this.request(
      'GET',
      `/me/notifications?${query}`,
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }

  readNotification(token: string, id: string): Promise<NotificationReadResponse> {
    return this.request('PATCH', `/me/notifications/${pathId(id)}/read`, token);
  }

  readAllNotifications(token: string): Promise<{ updated: number }> {
    return this.request('PATCH', '/me/notifications/read-all', token);
  }

  deleteReadNotifications(token: string): Promise<NotificationDeleteReadResponse> {
    return this.request('DELETE', '/me/notifications/read', token);
  }

  deleteNotification(token: string, id: string): Promise<NotificationDeleteResponse> {
    return this.request('DELETE', `/me/notifications/${pathId(id)}`, token);
  }

  getShiftChangeRequest(
    token: string,
    siteId: string,
    id: string,
  ): Promise<ShiftChangeRequestResponse> {
    return this.request(
      'GET',
      `/sites/${pathId(siteId)}/shift-change-requests/${pathId(id)}`,
      token,
    );
  }

  getShiftSwapRequest(
    token: string,
    siteId: string,
    id: string,
  ): Promise<ShiftSwapRequestResponse> {
    return this.request('GET', `/sites/${pathId(siteId)}/shift-swap-requests/${pathId(id)}`, token);
  }

  private async runRequest<T>(
    options: (RequestOptions & { sessionSignal?: AbortSignal }) | undefined,
    operation: (signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    if (options?.timeoutMs !== undefined && !validTimeout(options.timeoutMs)) {
      throw new RangeError(
        'timeoutMs must be a finite positive integer no greater than 2147483647.',
      );
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const signals = [
      ...new Set(
        [options?.signal, options?.sessionSignal].filter(
          (signal): signal is AbortSignal => !!signal,
        ),
      ),
    ];
    for (const signal of signals) signal.addEventListener('abort', onAbort);
    const aborted = () => signals.some((signal) => signal.aborted);
    if (aborted()) controller.abort();
    let timedOut = false;
    const timeout =
      options?.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeoutMs);
    const signal =
      signals.length || options?.timeoutMs !== undefined ? controller.signal : undefined;
    try {
      if (aborted()) throw new ApiError('cancelled', 'Request cancelled.');
      return await operation(signal);
    } catch (error) {
      if (aborted()) throw new ApiError('cancelled', 'Request cancelled.');
      if (timedOut) throw new ApiError('timeout', 'Backend request timed out.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'Could not connect to the backend.');
    } finally {
      if (timeout) clearTimeout(timeout);
      for (const signal of signals) signal.removeEventListener('abort', onAbort);
    }
  }

  private async readBody<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return read();
    if (signal.aborted) throw new ApiError('cancelled', 'Request cancelled.');
    let onAbort: (() => void) | undefined;
    const remove = () => {
      if (!onAbort) return;
      signal.removeEventListener('abort', onAbort);
      onAbort = undefined;
    };
    try {
      return await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(new ApiError('cancelled', 'Request cancelled.'));
        signal.addEventListener('abort', onAbort);
        read().then(resolve, reject);
      });
    } finally {
      remove();
    }
  }

  private requestOptions(
    token: string | undefined,
    options?: RequestOptions,
  ): (RequestOptions & { sessionSignal?: AbortSignal }) | undefined {
    if (!token || !this.session) return options;
    return {
      ...options,
      sessionSignal: this.session.signal,
    };
  }

  private async fetchAuthenticated(
    path: string,
    token: string | undefined,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const session = token ? this.session : undefined;
    let current = session && token ? session.getAccessToken(token) : token;
    const send = (accessToken: string | undefined) =>
      this.readBody(
        () =>
          fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
            ...init,
            headers: {
              ...init.headers,
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            ...(signal ? { signal } : {}),
          }),
        signal,
      );
    const checkPasswordSession = async (response: Response): Promise<boolean> => {
      if (path !== '/auth/change-password' || response.status !== 401) return false;
      const check = await this.readBody(
        () =>
          fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${current}` },
            ...(signal ? { signal } : {}),
          }),
        signal,
      );
      if (check.ok) return true;
      if (check.status !== 401)
        throw new ApiError(
          'http',
          'Could not verify the current session.',
          check.status,
          undefined,
          retryAfter(check),
        );
      return false;
    };
    let response = await send(current);
    if (session && token) session.getAccessToken(token);
    if (response.status !== 401 || !session || !current || (await checkPasswordSession(response)))
      return response;
    try {
      current = await this.readBody(() => session.refreshAccessToken(current!), signal);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        session.onUnauthorized(current);
      throw error;
    }
    response = await send(current);
    session.getAccessToken(token!);
    if (response.status === 401 && !(await checkPasswordSession(response)))
      session.onUnauthorized(current);
    return response;
  }

  private async responseError(response: Response, signal?: AbortSignal): Promise<never> {
    let payload: unknown;
    try {
      payload = await this.readBody(() => response.json(), signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(
        'invalid-response',
        'Backend returned invalid JSON.',
        response.status,
        undefined,
        retryAfter(response),
      );
    }
    const error = parseBackendErrorEnvelope(payload, response.status);
    throw new ApiError(
      'http',
      error?.message ?? `Backend returned HTTP ${response.status}.`,
      response.status,
      error,
      retryAfter(response),
    );
  }

  private async request<T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    credentials?: RequestCredentials,
    options?: RequestOptions,
  ): Promise<T> {
    const requestOptions = this.requestOptions(
      token,
      options ?? (this.session && path.startsWith('/auth/') ? { timeoutMs: 15_000 } : undefined),
    );
    return this.runRequest(requestOptions, async (signal) => {
      const response = await this.fetchAuthenticated(
        path,
        token,
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(credentials ? { credentials } : {}),
        },
        signal,
      );
      if (!response.ok) {
        if (
          !this.session &&
          token &&
          path !== '/auth/change-password' &&
          response.status === 401 &&
          typeof window !== 'undefined'
        ) {
          window.dispatchEvent(new CustomEvent('smartsite:session-expired'));
        }
        return this.responseError(response, signal);
      }
      if (response.status === 204) return undefined as T;
      try {
        return (await this.readBody(() => response.json(), signal)) as T;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
      }
    });
  }

  private async requestFormData<T>(
    method: string,
    path: string,
    token: string,
    body: FormData,
    options?: RequestOptions,
  ): Promise<T> {
    return this.runRequest(this.requestOptions(token, options), async (signal) => {
      const response = await this.fetchAuthenticated(
        path,
        token,
        { method, headers: { Accept: 'application/json' }, body },
        signal,
      );
      if (!response.ok) {
        if (!this.session && response.status === 401 && typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('smartsite:session-expired'));
        return this.responseError(response, signal);
      }
      if (response.status === 204) return undefined as T;
      try {
        return (await this.readBody(() => response.json(), signal)) as T;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
      }
    });
  }

  private async requestBlob(
    path: string,
    token: string,
    options?: RequestOptions,
    mediaTypes: readonly string[] = ['image/jpeg'],
  ): Promise<Blob> {
    return this.runRequest(this.requestOptions(token, options), async (signal) => {
      const response = await this.fetchAuthenticated(
        path,
        token,
        { headers: { Accept: mediaTypes.join(', ') } },
        signal,
      );
      if (!response.ok) return this.responseError(response, signal);
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (!contentType || !mediaTypes.includes(contentType))
        throw new ApiError(
          'invalid-response',
          'Backend returned an invalid evidence type.',
          response.status,
        );
      return this.readBody(() => response.blob(), signal);
    });
  }

  private listPath(path: string, options: Record<string, string | number | undefined> = {}) {
    const query = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return `${path}${query.size ? `?${query}` : ''}`;
  }

  private workflowListPath(
    path: string,
    filters: PageOptions & { status?: string; assignedTo?: string } = {},
  ) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters))
      if (value !== undefined) query.set(name, String(value));
    return path + (query.size ? '?' + query : '');
  }
  listSafetyAssignees(
    token: string,
    siteId: string,
    role: 'SAFETY_OFFICER' | 'CONTRACTOR_REPRESENTATIVE',
    page: PageOptions & { contractorId?: string } = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<SafetyAssigneeResponse>>(
      'GET',
      this.workflowListPath(`/sites/${pathId(siteId)}/safety-assignees`, {
        ...page,
        role,
      } as PageOptions),
      token,
      undefined,
      undefined,
      options,
    );
  }
  listSafetyContractors(
    token: string,
    siteId: string,
    page: PageOptions = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<SafetyContractorResponse>>(
      'GET',
      this.workflowListPath(`/sites/${pathId(siteId)}/safety-contractors`, page),
      token,
      undefined,
      undefined,
      options,
    );
  }
  listIncidentWorkers(
    token: string,
    siteId: string,
    contractorId: string,
    page: PageOptions = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<IncidentWorkerResponse>>(
      'GET',
      this.workflowListPath(
        `/sites/${pathId(siteId)}/safety-contractors/${pathId(contractorId)}/workers`,
        page,
      ),
      token,
      undefined,
      undefined,
      options,
    );
  }
  listSafetyOverviewContractors(
    token: string,
    siteId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<Page<import('@smartsite/contracts').SafetyContractorResponse>>(
      'GET',
      `/sites/${pathId(siteId)}/safety-overview/contractors?${params}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyOverview(
    token: string,
    siteId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    return this.request<import('@smartsite/contracts').SafetyOverviewResponse>(
      'GET',
      this.safetyOverviewPath(siteId, query),
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyTeamOptions(
    token: string,
    siteId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<Page<import('@smartsite/contracts').SafetyTeamOption>>(
      'GET',
      `/sites/${pathId(siteId)}/safety-overview/team-options?${params}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyWeek(
    token: string,
    siteId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<import('@smartsite/contracts').SafetyWeekResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-overview/week?${params}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  listSafetyZoneTeams(
    token: string,
    siteId: string,
    zoneId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<Page<import('@smartsite/contracts').SafetyOverviewTeam>>(
      'GET',
      `/sites/${pathId(siteId)}/safety-overview/zones/${pathId(zoneId)}/teams?${params}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyTeam(
    token: string,
    siteId: string,
    id: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    options?: RequestOptions,
  ) {
    return this.request<import('@smartsite/contracts').SafetyTeamDetailResponse>(
      'GET',
      this.safetyOverviewPath(siteId, query, id),
      token,
      undefined,
      undefined,
      options,
    );
  }
  getAlertWorkContext(token: string, siteId: string, id: string, options?: RequestOptions) {
    return this.request<import('@smartsite/contracts').SafetyAlertWorkContextResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-alerts/${pathId(id)}/work-context`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  private safetyOverviewPath(
    siteId: string,
    query: import('@smartsite/contracts').SafetyOverviewQuery,
    id?: string,
  ) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== '') params.set(k, String(v));
    return `/sites/${pathId(siteId)}/safety-overview${id ? `/teams/${pathId(id)}` : ''}?${params}`;
  }
  listSafetyChecklists(
    token: string,
    siteId: string,
    filters: import('@smartsite/contracts').ChecklistListQuery = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<import('@smartsite/contracts').ChecklistResponse>>(
      'GET',
      this.workflowListPath(`/sites/${pathId(siteId)}/safety-checklists`, filters),
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyChecklist(token: string, siteId: string, id: string, options?: RequestOptions) {
    return this.request<import('@smartsite/contracts').ChecklistDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-checklists/${pathId(id)}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  createSafetyChecklist(
    token: string,
    siteId: string,
    input: import('@smartsite/contracts').CreateChecklistCommand,
    options?: RequestOptions,
  ) {
    return this.request<
      WorkflowMutationResponse<import('@smartsite/contracts').ChecklistDetailResponse>
    >('POST', `/sites/${pathId(siteId)}/safety-checklists`, token, input, undefined, options);
  }
  checklistCommand(
    token: string,
    siteId: string,
    id: string,
    operation: 'start' | 'cancel' | 'review',
    input: VersionCommand | ReasonCommand | import('@smartsite/contracts').ReviewChecklistCommand,
    options?: RequestOptions,
  ) {
    return this.request<
      WorkflowMutationResponse<import('@smartsite/contracts').ChecklistDetailResponse>
    >(
      'POST',
      `/sites/${pathId(siteId)}/safety-checklists/${pathId(id)}/${operation === 'review' ? 'reviews' : operation}`,
      token,
      input,
      undefined,
      options,
    );
  }
  submitSafetyChecklist(
    token: string,
    siteId: string,
    id: string,
    input: import('@smartsite/contracts').SubmitChecklistCommand,
    files: UploadFile[],
    options?: RequestOptions,
  ) {
    const form = new FormData();
    form.append('command', JSON.stringify(input));
    for (const file of files) appendFile(form, 'files', file);
    return this.requestFormData<
      WorkflowMutationResponse<import('@smartsite/contracts').ChecklistDetailResponse>
    >(
      'POST',
      `/sites/${pathId(siteId)}/safety-checklists/${pathId(id)}/submissions`,
      token,
      form,
      options,
    );
  }
  getChecklistEvidence(
    token: string,
    siteId: string,
    id: string,
    evidenceId: string,
    options?: RequestOptions,
  ) {
    return this.requestBlob(
      `/sites/${pathId(siteId)}/safety-checklists/${pathId(id)}/evidence/${pathId(evidenceId)}`,
      token,
      options,
      ['image/jpeg', 'image/png', 'application/pdf'],
    );
  }

  listIncidents(
    token: string,
    siteId: string,
    filters: PageOptions & { status?: string; assignedTo?: string } = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<IncidentResponse>>(
      'GET',
      this.workflowListPath(`/sites/${pathId(siteId)}/incidents`, filters),
      token,
      undefined,
      undefined,
      options,
    );
  }
  getIncident(token: string, siteId: string, id: string, options?: RequestOptions) {
    return this.request<IncidentDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/incidents/${pathId(id)}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  createIncident(
    token: string,
    siteId: string,
    input: CreateIncidentCommand,
    options?: RequestOptions,
  ) {
    return this.request<WorkflowMutationResponse<IncidentDetailResponse>>(
      'POST',
      `/sites/${pathId(siteId)}/incidents`,
      token,
      input,
      undefined,
      options,
    );
  }
  incidentCommand(
    token: string,
    siteId: string,
    id: string,
    operation:
      | 'responsibility'
      | 'correct-responsibility'
      | 'transfer'
      | 'link'
      | 'assign'
      | 'start'
      | 'submit'
      | 'review'
      | 'close'
      | 'reopen',
    input:
      | ConfirmIncidentResponsibilityCommand
      | CorrectIncidentResponsibilityCommand
      | TransferCorrectiveActionCommand
      | VersionCommand
      | ReasonCommand
      | LinkIncidentAlertsCommand
      | AssignCorrectiveActionCommand
      | SubmitSafetyResultCommand
      | ReviewSubmissionCommand
      | ReopenIncidentCommand,
    actionId?: string,
    file?: UploadFile,
    options?: RequestOptions,
  ) {
    const segment = {
      responsibility: 'responsibility',
      'correct-responsibility': 'correct-responsibility',
      transfer: 'transfer',
      link: 'alerts',
      assign: 'actions',
      start: 'start',
      submit: 'submissions',
      review: 'reviews',
      close: 'close',
      reopen: 'reopen',
    }[operation];
    const path = `/sites/${pathId(siteId)}/incidents/${pathId(id)}${actionId ? `/actions/${pathId(actionId)}` : ''}/${segment}`;
    if (operation === 'submit')
      return this.requestFormData<WorkflowMutationResponse<IncidentDetailResponse>>(
        'POST',
        path,
        token,
        this.resultForm(input, file),
        options,
      );
    return this.request<WorkflowMutationResponse<IncidentDetailResponse>>(
      'POST',
      path,
      token,
      input,
      undefined,
      options,
    );
  }
  listSafetyTasks(
    token: string,
    siteId: string,
    filters: PageOptions & { status?: string; assignedTo?: string } = {},
    options?: RequestOptions,
  ) {
    return this.request<Page<SafetyTaskResponse>>(
      'GET',
      this.workflowListPath(`/sites/${pathId(siteId)}/safety-tasks`, filters),
      token,
      undefined,
      undefined,
      options,
    );
  }
  getSafetyTask(token: string, siteId: string, id: string, options?: RequestOptions) {
    return this.request<SafetyTaskDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-tasks/${pathId(id)}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  createSafetyTask(
    token: string,
    siteId: string,
    input: CreateSafetyTaskCommand,
    options?: RequestOptions,
  ) {
    return this.request<WorkflowMutationResponse<SafetyTaskDetailResponse>>(
      'POST',
      `/sites/${pathId(siteId)}/safety-tasks`,
      token,
      input,
      undefined,
      options,
    );
  }
  safetyTaskCommand(
    token: string,
    siteId: string,
    id: string,
    operation: 'start' | 'submit' | 'verify' | 'return' | 'cancel',
    input: VersionCommand | SubmitSafetyResultCommand | ReasonCommand,
    file?: UploadFile,
    options?: RequestOptions,
  ) {
    const path = `/sites/${pathId(siteId)}/safety-tasks/${pathId(id)}/${operation === 'submit' ? 'submissions' : operation}`;
    if (operation === 'submit')
      return this.requestFormData<WorkflowMutationResponse<SafetyTaskDetailResponse>>(
        'POST',
        path,
        token,
        this.resultForm(input, file),
        options,
      );
    return this.request<WorkflowMutationResponse<SafetyTaskDetailResponse>>(
      'POST',
      path,
      token,
      input,
      undefined,
      options,
    );
  }
  private resultForm(input: VersionCommand, file?: UploadFile) {
    const form = new FormData();
    for (const [name, value] of Object.entries(input)) form.append(name, String(value));
    if (file) appendFile(form, 'file', file);
    return form;
  }
  getWorkflowEvidence(
    token: string,
    siteId: string,
    type: 'incidents' | 'safety-tasks',
    id: string,
    evidenceId: string,
    options?: RequestOptions,
  ) {
    return this.requestBlob(
      `/sites/${pathId(siteId)}/${type}/${pathId(id)}/evidence/${pathId(evidenceId)}`,
      token,
      options,
    );
  }
  getIncidentAlert(
    token: string,
    siteId: string,
    id: string,
    alertId: string,
    options?: RequestOptions,
  ) {
    return this.request<SafetyAlertDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/incidents/${pathId(id)}/alerts/${pathId(alertId)}`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  getIncidentAlertEvidence(
    token: string,
    siteId: string,
    id: string,
    alertId: string,
    eventId: string,
    index: number,
    options?: RequestOptions,
  ) {
    return this.requestBlob(
      `/sites/${pathId(siteId)}/incidents/${pathId(id)}/alerts/${pathId(alertId)}/detections/${pathId(eventId)}/evidence/${index}`,
      token,
      options,
    );
  }

  login(
    username: string,
    password: string,
    clientType: AuthClientType = 'WEB',
    options?: RequestOptions,
  ) {
    return this.request<LoginResponse>(
      'POST',
      '/auth/login',
      undefined,
      { username, password, clientType },
      clientType === 'WEB' ? 'include' : undefined,
      options,
    );
  }
  refresh(clientType: AuthClientType, refreshToken?: string, options?: RequestOptions) {
    return this.request<LoginResponse>(
      'POST',
      '/auth/refresh',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
      options,
    );
  }
  me(token: string) {
    return this.request<AccountResponse>('GET', '/auth/me', token);
  }
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return this.request<void>(
      'POST',
      '/auth/change-password',
      token,
      {
        currentPassword,
        newPassword,
      },
      'include',
    );
  }
  logout(clientType: AuthClientType = 'WEB', refreshToken?: string, options?: RequestOptions) {
    return this.request<void>(
      'POST',
      '/auth/logout',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
      options,
    );
  }

  createUser(
    token: string,
    input: {
      username: string;
      displayName: string;
      roleAssignments: ProvisionableRoleAssignment[];
      temporaryPassword: string;
    },
  ) {
    return this.request<AccountResponse>('POST', '/users', token, input);
  }
  replaceUserRoleAssignments(
    token: string,
    userId: string,
    roleAssignments: ProvisionableRoleAssignment[],
  ) {
    return this.request<AccountResponse>(
      'PUT',
      `/users/${pathId(userId)}/role-assignments`,
      token,
      { roleAssignments },
    );
  }
  createSiteRepresentative(
    token: string,
    siteId: string,
    contractorId: string,
    input: { username: string; displayName: string; temporaryPassword: string },
  ) {
    return this.request<AccountResponse>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/representative-accounts`,
      token,
      input,
    );
  }
  listSiteRepresentatives(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<AccountResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/representative-accounts`, options),
      token,
    );
  }
  listUsers(token: string, options?: PageOptions) {
    return this.request<Page<AccountResponse>>('GET', this.listPath('/users', options), token);
  }
  getUser(token: string, userId: string) {
    return this.request<AccountResponse>('GET', `/users/${pathId(userId)}`, token);
  }
  setUserActive(token: string, userId: string, isActive: boolean) {
    return this.request<AccountResponse>('PATCH', `/users/${pathId(userId)}/status`, token, {
      isActive,
    });
  }
  resetUserPassword(token: string, userId: string, temporaryPassword: string) {
    return this.request<void>('POST', `/users/${pathId(userId)}/reset-password`, token, {
      temporaryPassword,
    });
  }

  createSite(token: string, input: { code: string; name: string }) {
    return this.request<SiteResponse>('POST', '/sites', token, input);
  }
  listSites(token: string, options?: PageOptions, requestOptions?: RequestOptions) {
    return this.request<Page<SiteResponse>>(
      'GET',
      this.listPath('/sites', options),
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }
  getSite(token: string, siteId: string) {
    return this.request<SiteResponse>('GET', `/sites/${pathId(siteId)}`, token);
  }
  listSafetyAlerts(
    token: string,
    siteId: string,
    options: SafetyAlertListOptions = {},
    requestOptions?: RequestOptions,
  ) {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.status !== undefined) query.set('status', options.status);
    if (options.type !== undefined) query.set('type', options.type);
    for (const key of [
      'zoneId',
      'cameraExternalId',
      'capturedFrom',
      'capturedUntil',
      'contextTeamId',
    ] as const)
      if (options[key]) query.set(key, options[key]);
    if (options.attentionOnly !== undefined)
      query.set('attentionOnly', String(options.attentionOnly));
    const path = `/sites/${pathId(siteId)}/safety-alerts`;
    return this.request<Page<SafetyAlertResponse>>(
      'GET',
      `${path}${query.size ? `?${query}` : ''}`,
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }
  getSafetyAlert(token: string, siteId: string, alertId: string, requestOptions?: RequestOptions) {
    return this.request<SafetyAlertDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-alerts/${pathId(alertId)}`,
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }
  getSafetyAlertEvidence(
    token: string,
    siteId: string,
    alertId: string,
    eventId: string,
    evidenceIndex: number,
    options?: RequestOptions,
  ) {
    return this.requestBlob(
      `/sites/${pathId(siteId)}/safety-alerts/${pathId(alertId)}/detections/${pathId(eventId)}/evidence/${pathId(String(evidenceIndex))}`,
      token,
      options,
    );
  }
  reviewSafetyAlert(
    token: string,
    siteId: string,
    alertId: string,
    input: {
      commandId: string;
      expectedRevision: number;
      targetStatus: SafetyAlertReviewTargetStatus;
      reason: string;
    },
  ) {
    return this.request<SafetyAlertReviewMutationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/safety-alerts/${pathId(alertId)}/reviews`,
      token,
      input,
    );
  }
  renameSite(token: string, siteId: string, name: string) {
    return this.request<SiteResponse>('PATCH', `/sites/${pathId(siteId)}`, token, { name });
  }

  createWorker(token: string, siteId: string, input: { externalId: string; displayName: string }) {
    return this.request<WorkerResponse>('POST', `/sites/${pathId(siteId)}/workers`, token, input);
  }

  linkWorkerAccount(token: string, siteId: string, workerId: string, userId: string) {
    return this.request<WorkerResponse>(
      'PUT',
      `/sites/${pathId(siteId)}/workers/${pathId(workerId)}/account`,
      token,
      { userId },
    );
  }
  prepareFaceAccount(token: string, siteId: string, userId: string) {
    return this.request<WorkerResponse>(
      'POST',
      `/sites/${pathId(siteId)}/workers/for-account`,
      token,
      { userId },
    );
  }
  listWorkers(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<WorkerResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/workers`, options),
      token,
    );
  }

  updateContractorWorker(
    token: string,
    siteId: string,
    contractorId: string,
    workerId: string,
    input: UpdateContractorWorkerCommand,
  ) {
    return this.request<WorkerResponse>(
      'PUT',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/workers/${pathId(workerId)}`,
      token,
      input,
    );
  }

  createContractor(
    token: string,
    input: { code: string; name: string },
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteId: string,
    input: { code?: string; name: string },
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteIdOrInput: string | { code?: string; name: string },
    siteInput?: { code?: string; name: string },
  ) {
    const siteScoped = typeof siteIdOrInput === 'string';
    const input = siteScoped ? siteInput! : siteIdOrInput;
    const path = siteScoped ? `/sites/${pathId(siteIdOrInput)}/contractors` : '/contractors';
    return this.request<ContractorResponse>('POST', path, token, input);
  }
  createContractorParticipation(
    token: string,
    contractorId: string,
    input: { siteId: string; validFrom: string; validUntil: string | null },
  ) {
    return this.request<ContractorParticipationResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/participations`,
      token,
      input,
    );
  }
  grantContractorRepresentative(token: string, contractorId: string, userId: string) {
    return this.request<ContractorRepresentativeGrantResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/representative-grants`,
      token,
      { userId },
    );
  }
  createContractorWorker(
    token: string,
    contractorId: string,
    input: { siteId: string; externalId: string; displayName: string },
  ) {
    return this.request<WorkerResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/workers`,
      token,
      input,
    );
  }

  createContractorWorkerAccount(
    token: string,
    contractorId: string,
    input: CreateContractorWorkerAccountCommand,
  ) {
    return this.request<ContractorWorkerAccountResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/worker-accounts`,
      token,
      input,
    );
  }

  contractorWorkerAccountOptions(token: string, siteId: string) {
    return this.request<ContractorWorkerAccountOptionsResponse>(
      'GET',
      `/sites/${pathId(siteId)}/contractor-worker-account-options`,
      token,
    );
  }
  createWorkerSiteZoneAssignment(
    token: string,
    workerId: string,
    input: { siteId: string; zoneIds: string[]; validFrom: string; validUntil: string | null },
  ) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/workers/${pathId(workerId)}/site-zone-assignment-requests`,
      token,
      input,
    );
  }
  safetyReviewWorkerSiteZoneAssignment(token: string, requestId: string) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(requestId)}/safety-review`,
      token,
    );
  }
  decideWorkerSiteZoneAssignment(
    token: string,
    requestId: string,
    approve: boolean,
    review?: { expectedVersion?: number; reviewNote?: string },
  ) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(requestId)}/site-manager-decision`,
      token,
      { approve, ...review },
    );
  }
  startFaceEnrollment(token: string, workerId: string, consentVersion: string) {
    return this.request<FaceEnrollmentSessionResponse>(
      'POST',
      `/workers/${pathId(workerId)}/face-enrollments`,
      token,
      { consentVersion },
    );
  }

  revokeWorkerAssignment(
    token: string,
    assignmentId: string,
    expectedVersion: number,
    reviewNote: string,
  ) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(assignmentId)}/revoke`,
      token,
      { expectedVersion, reviewNote },
    );
  }
  confirmWorkerFaceConsent(sessionId: string, consentToken: string) {
    return this.request<FaceEnrollmentSessionResponse>(
      'POST',
      `/face-consent/${pathId(sessionId)}`,
      undefined,
      { consentToken, workerConfirmed: true },
    );
  }

  cancelFaceEnrollment(token: string, sessionId: string) {
    return this.request<FaceEnrollmentSessionResponse>(
      'POST',
      `/face-enrollments/${pathId(sessionId)}/cancel`,
      token,
    );
  }
  listVisitorZones(siteId: string) {
    return this.request<{ items: Array<{ id: string; name: string }> }>(
      'GET',
      `/visitor-registration/sites/${pathId(siteId)}/zones`,
    );
  }
  manualVisitCheckout(
    token: string,
    siteId: string,
    visitId: string,
    input: { requestId: string; representativeConfirmed: true; reviewNote: string },
  ) {
    return this.request<VisitResponse>(
      'POST',
      `/sites/${pathId(siteId)}/visits/${pathId(visitId)}/manual-checkout`,
      token,
      input,
    );
  }
  deleteWorkerFaceTemplate(token: string, workerId: string) {
    return this.request<FaceProfileResponse>(
      'POST',
      `/workers/${pathId(workerId)}/face-profile/delete-template`,
      token,
    );
  }
  verifyFaceGate(
    token: string,
    siteId: string,
    gateId: string,
    frame: Blob,
    direction: 'IN' | 'OUT',
  ) {
    const form = new FormData();
    form.append('frame', frame, 'scan-frame.jpg');
    form.append('direction', direction);
    return this.requestFormData<FaceGateVerificationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/face-verifications`,
      token,
      form,
    );
  }
  listGateAccessLogs(token: string, siteId: string, gateId: string) {
    return this.request<{ items: GateAccessLogResponse[] }>(
      'GET',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/access-logs`,
      token,
    );
  }
  observeGateFace(token: string, siteId: string, gateId: string, sessionId: string, frame: Blob) {
    const form = new FormData();
    form.append('frame', frame, 'presence.jpg');
    form.append('sessionId', sessionId);
    return this.requestFormData<GateFacePresenceResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/face-presence`,
      token,
      form,
    );
  }
  getWorkerGatePermissions(token: string, siteId: string, workerId: string) {
    return this.request<WorkerGatePermissionsResponse>(
      'GET',
      `/sites/${pathId(siteId)}/workers/${pathId(workerId)}/gate-permissions`,
      token,
    );
  }
  setWorkerGatePermissions(
    token: string,
    siteId: string,
    workerId: string,
    input: SetWorkerGatePermissionsCommand,
  ) {
    return this.request<WorkerGatePermissionsResponse>(
      'PUT',
      `/sites/${pathId(siteId)}/workers/${pathId(workerId)}/gate-permissions`,
      token,
      input,
    );
  }
  uploadFaceEnrollmentSample(token: string, sessionId: string, sample: Blob | NativeUploadFile) {
    const form = new FormData();
    appendFile(form, 'sample', sample, 'face-sample.jpg');
    return this.requestFormData<FaceEnrollmentSessionResponse>(
      'POST',
      `/face-enrollments/${pathId(sessionId)}/samples`,
      token,
      form,
    );
  }
  checkFaceEnrollmentQuality(
    token: string,
    workerId: string,
    sample: Blob | NativeUploadFile,
    target: EnrollmentCaptureTarget,
  ) {
    const form = new FormData();
    appendFile(form, 'sample', sample, 'face-quality-check.jpg');
    form.append('target', target);
    return this.requestFormData<FaceEnrollmentQualityResponse>(
      'POST',
      `/workers/${pathId(workerId)}/face-enrollment-quality`,
      token,
      form,
    );
  }
  completeFaceEnrollment(token: string, sessionId: string) {
    return this.request<FaceProfileResponse>(
      'POST',
      `/face-enrollments/${pathId(sessionId)}/complete`,
      token,
    );
  }
  getFaceProfile(token: string, workerId: string) {
    return this.request<FaceProfileResponse>(
      'GET',
      `/workers/${pathId(workerId)}/face-profile`,
      token,
    );
  }
  revokeFaceProfile(token: string, workerId: string) {
    return this.request<FaceProfileResponse>(
      'POST',
      `/workers/${pathId(workerId)}/face-profile/revoke`,
      token,
    );
  }

  createZoneAccessGrant(
    token: string,
    siteId: string,
    zoneId: string,
    input: {
      workerId: string;
      effect: ZoneAccessEffect;
      validFrom: string;
      validUntil: string | null;
    },
  ) {
    return this.request<ZoneAccessGrantResponse>(
      'POST',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants`,
      token,
      input,
    );
  }
  listZoneAccessGrants(token: string, siteId: string, zoneId: string, options?: PageOptions) {
    return this.request<Page<ZoneAccessGrantResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants`, options),
      token,
    );
  }
  revokeZoneAccessGrant(token: string, siteId: string, zoneId: string, grantId: string) {
    return this.request<ZoneAccessGrantResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants/${pathId(grantId)}/revoke`,
      token,
    );
  }
  listZoneEntryDecisions(
    token: string,
    siteId: string,
    options: ZoneEntryDecisionListOptions = {},
  ) {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.zoneId !== undefined) query.set('zoneId', options.zoneId);
    if (options.status !== undefined) query.set('status', options.status);
    const path = `/sites/${pathId(siteId)}/zone-entry-decisions`;
    return this.request<Page<ZoneEntryDecisionResponse>>(
      'GET',
      `${path}${query.size ? `?${query}` : ''}`,
      token,
    );
  }

  createCamera(
    token: string,
    siteId: string,
    input: { code: string; externalId: string; name: string },
  ) {
    return this.request<CameraResponse>('POST', `/sites/${pathId(siteId)}/cameras`, token, input);
  }
  listCameras(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<CameraResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras`, options),
      token,
    );
  }
  getCamera(token: string, siteId: string, cameraId: string) {
    return this.request<CameraResponse>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}`,
      token,
    );
  }
  renameCamera(token: string, siteId: string, cameraId: string, name: string) {
    return this.request<CameraResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}`,
      token,
      { name },
    );
  }
  setCameraStatus(
    token: string,
    siteId: string,
    cameraId: string,
    input: CameraMutation & { status: 'ACTIVE' | 'INACTIVE' },
  ) {
    return this.request<CameraResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/status`,
      token,
      input,
    );
  }

  createZone(
    token: string,
    siteId: string,
    input: {
      code?: string;
      name: string;
      type: ZoneResponse['type'];
      restrictionPolicy: ZoneResponse['restrictionPolicy'];
      requiredPpe: string[];
    },
  ) {
    return this.request<ZoneResponse>('POST', `/sites/${pathId(siteId)}/zones`, token, input);
  }
  listZones(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ZoneResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/zones`, options),
      token,
    );
  }
  getZone(token: string, siteId: string, zoneId: string) {
    return this.request<ZoneResponse>(
      'GET',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}`,
      token,
    );
  }
  renameZone(token: string, siteId: string, zoneId: string, name: string) {
    return this.request<ZoneResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}`,
      token,
      { name },
    );
  }
  updateZonePolicy(
    token: string,
    siteId: string,
    zoneId: string,
    input: {
      type: ZoneResponse['type'];
      restrictionPolicy: ZoneResponse['restrictionPolicy'];
      requiredPpe: string[];
    },
  ) {
    return this.request<ZoneResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/policy`,
      token,
      input,
    );
  }

  createRegion(
    token: string,
    siteId: string,
    cameraId: string,
    input: CameraMutation & { zoneId: string; polygon: unknown },
  ) {
    return this.request<RegionMutationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`,
      token,
      input,
    );
  }
  listRegions(token: string, siteId: string, cameraId: string, options?: PageOptions) {
    return this.request<Page<RegionResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`, options),
      token,
    );
  }
  getRegion(token: string, siteId: string, cameraId: string, regionId: string) {
    return this.request<RegionResponse>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}`,
      token,
    );
  }
  updatePolygon(
    token: string,
    siteId: string,
    cameraId: string,
    regionId: string,
    input: CameraMutation & { polygon: unknown },
  ) {
    return this.request<RegionMutationResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}/polygon`,
      token,
      input,
    );
  }
  setRegionActive(
    token: string,
    siteId: string,
    cameraId: string,
    regionId: string,
    input: CameraMutation & { isActive: boolean },
  ) {
    return this.request<RegionMutationResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}/status`,
      token,
      input,
    );
  }

  // Workforce / MF07 Endpoints
  contractorParticipationOptions(token: string, siteId: string) {
    return this.request<{
      items: Array<Pick<ContractorResponse, 'id' | 'code' | 'name' | 'isActive'>>;
    }>('GET', `/sites/${pathId(siteId)}/contractor-participation-options`, token);
  }

  listContractors(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ContractorResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/contractors`, options),
      token,
    );
  }
  listContractorRepresentativeAssignments(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ContractorRepresentativeAssignmentResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/contractor-representative-assignments`, options),
      token,
    );
  }
  assignContractorRepresentative(
    token: string,
    siteId: string,
    contractorId: string,
    input: { userId: string },
  ) {
    return this.request<{
      id: string;
      siteId: string;
      contractorId: string;
      userId: string;
      createdAt: string;
    }>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/representatives`,
      token,
      input,
    );
  }
  listCoworkers(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<WorkerResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/workers/coworkers`, options),
      token,
    );
  }
  createShift(
    token: string,
    siteId: string,
    input: Pick<
      ShiftResponse,
      'name' | 'startsAt' | 'endsAt' | 'timezone' | 'breakStartsAt' | 'breakEndsAt'
    > & {
      allowedExitMinutes?: number;
      maxExitCount?: number;
    },
  ) {
    return this.request<ShiftResponse>('POST', `/sites/${pathId(siteId)}/shifts`, token, input);
  }
  assignShiftToContractor(
    token: string,
    siteId: string,
    shiftId: string,
    input: { contractorId: string },
  ) {
    return this.request<ContractorShiftAssignmentResponse>(
      'POST',
      `/sites/${pathId(siteId)}/shifts/${pathId(shiftId)}/contractors`,
      token,
      input,
    );
  }
  listShiftContractorAssignments(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ContractorShiftAssignmentResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/shift-contractor-assignments`, options),
      token,
    );
  }
  listShifts(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ShiftResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/shifts`, options),
      token,
    );
  }
  archiveShift(token: string, siteId: string, shiftId: string) {
    return this.request<ShiftResponse>(
      'POST',
      `/sites/${pathId(siteId)}/shifts/${pathId(shiftId)}/archive`,
      token,
    );
  }
  deleteShift(token: string, siteId: string, shiftId: string) {
    return this.request<void>(
      'DELETE',
      `/sites/${pathId(siteId)}/shifts/${pathId(shiftId)}`,
      token,
    );
  }
  createScheduleVersion(
    token: string,
    siteId: string,
    input: { effectiveFrom: string; effectiveUntil?: string },
  ) {
    return this.request<ScheduleVersionResponse>(
      'POST',
      `/sites/${pathId(siteId)}/schedule-versions`,
      token,
      input,
    );
  }
  listScheduleVersions(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ScheduleVersionResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/schedule-versions`, options),
      token,
    );
  }
  createWorkerSchedule(
    token: string,
    siteId: string,
    scheduleVersionId: string,
    input: { workerId: string; shiftId: string; workDate: string; isActive?: boolean },
  ) {
    return this.request<WorkerScheduleResponse>(
      'POST',
      `/sites/${pathId(siteId)}/schedule-versions/${pathId(scheduleVersionId)}/worker-schedules`,
      token,
      input,
    );
  }
  previewScheduleAssignment(token: string, siteId: string, input: ScheduleAssignmentInput) {
    return this.request<ScheduleAssignmentPreview>(
      'POST',
      `/sites/${pathId(siteId)}/schedule-assignments/preview`,
      token,
      input,
    );
  }
  createScheduleAssignment(token: string, siteId: string, input: CreateScheduleAssignmentCommand) {
    return this.request<ScheduleAssignmentBatchResponse>(
      'POST',
      `/sites/${pathId(siteId)}/schedule-assignments`,
      token,
      input,
    );
  }
  listScheduleAssignments(
    token: string,
    siteId: string,
    contractorId: string,
    options: PageOptions = {},
  ) {
    return this.request<Page<ScheduleAssignmentBatchResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/schedule-assignments`, { ...options, contractorId }),
      token,
    );
  }
  changeScheduleAssignment(
    token: string,
    siteId: string,
    id: string,
    input: ChangeScheduleAssignmentCommand,
  ) {
    return this.request<ScheduleAssignmentChangeResponse>(
      'POST',
      `/sites/${pathId(siteId)}/schedule-assignments/${pathId(id)}/change`,
      token,
      input,
    );
  }
  listWorkerSchedules(token: string, siteId: string, options?: WorkerScheduleListOptions) {
    return this.request<Page<WorkerScheduleResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/worker-schedules`, options),
      token,
    );
  }
  listEligibleShifts(token: string, siteId: string, workerScheduleId: string) {
    return this.request<EligibleShiftListResponse>(
      'GET',
      `/sites/${pathId(siteId)}/worker-schedules/${pathId(workerScheduleId)}/eligible-shifts`,
      token,
    );
  }
  listSwapCandidates(token: string, siteId: string, workerScheduleId: string) {
    return this.request<SwapCandidateListResponse>(
      'GET',
      `/sites/${pathId(siteId)}/worker-schedules/${pathId(workerScheduleId)}/swap-candidates`,
      token,
    );
  }

  // Scheduling Workflow
  listShiftChangeRequests(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ShiftChangeRequestResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/shift-change-requests`, options),
      token,
    );
  }
  listShiftSwapRequests(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ShiftSwapRequestResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/shift-swap-requests`, options),
      token,
    );
  }
  listAbsenceRequests(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<AbsenceRequestResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/absence-requests`, options),
      token,
    );
  }

  // --- Shift Change Request Mutations ---
  createShiftChangeRequest(
    token: string,
    siteId: string,
    input: {
      workerScheduleId: string;
      toShiftId: string;
      reason: string;
    },
  ) {
    return this.request<ShiftChangeRequestResponse>(
      'POST',
      `/sites/${pathId(siteId)}/shift-change-requests`,
      token,
      input,
    );
  }
  approveShiftChangeRequest(token: string, siteId: string, requestId: string) {
    return this.request<ShiftChangeRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-change-requests/${pathId(requestId)}/approve`,
      token,
    );
  }
  rejectShiftChangeRequest(
    token: string,
    siteId: string,
    requestId: string,
    input: { reason: string },
  ) {
    return this.request<ShiftChangeRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-change-requests/${pathId(requestId)}/reject`,
      token,
      input,
    );
  }

  // --- Shift Swap Request Mutations ---
  createShiftSwapRequest(
    token: string,
    siteId: string,
    input: {
      requesterWorkerScheduleId: string;
      coworkerWorkerScheduleId: string;
      reason: string;
    },
  ) {
    return this.request<ShiftSwapRequestResponse>(
      'POST',
      `/sites/${pathId(siteId)}/shift-swap-requests`,
      token,
      input,
    );
  }
  confirmShiftSwapRequest(token: string, siteId: string, requestId: string) {
    return this.request<ShiftSwapRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-swap-requests/${pathId(requestId)}/confirm`,
      token,
    );
  }
  declineShiftSwapRequest(
    token: string,
    siteId: string,
    requestId: string,
    input: { reason: string },
  ) {
    return this.request<ShiftSwapRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-swap-requests/${pathId(requestId)}/decline`,
      token,
      input,
    );
  }
  approveShiftSwapRequest(token: string, siteId: string, requestId: string) {
    return this.request<ShiftSwapRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-swap-requests/${pathId(requestId)}/approve`,
      token,
    );
  }
  rejectShiftSwapRequest(
    token: string,
    siteId: string,
    requestId: string,
    input: { reason: string },
  ) {
    return this.request<ShiftSwapRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/shift-swap-requests/${pathId(requestId)}/reject`,
      token,
      input,
    );
  }

  // --- Absence Request Mutations ---
  createAbsenceRequest(
    token: string,
    siteId: string,
    input: {
      workerScheduleId: string;
      reason: string;
      replacementWorkerId?: string;
    },
  ) {
    return this.request<AbsenceRequestResponse>(
      'POST',
      `/sites/${pathId(siteId)}/absence-requests`,
      token,
      input,
    );
  }
  approveAbsenceRequest(token: string, siteId: string, requestId: string) {
    return this.request<AbsenceRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/absence-requests/${pathId(requestId)}/approve`,
      token,
    );
  }
  rejectAbsenceRequest(token: string, siteId: string, requestId: string) {
    return this.request<AbsenceRequestResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/absence-requests/${pathId(requestId)}/reject`,
      token,
    );
  }

  private identitySubjectsPath(siteId: string, alertId: string, eventId: string) {
    return `/sites/${pathId(siteId)}/safety-alerts/${pathId(alertId)}/detections/${pathId(eventId)}/identity-subjects`;
  }

  private sameScopeId(actual: string, expected: string) {
    return actual.toLowerCase() === expected.toLowerCase();
  }

  private matchesIdentityCommand(
    decision: ObservationIdentityMutationResponse['recordedDecision'],
    eventId: string,
    personObservationIndex: number,
    input: ObservationIdentityDecisionCommand,
  ) {
    const evidenceMatches =
      input.action === 'CLEAR'
        ? decision.action === 'CLEAR' &&
          decision.workerId === null &&
          decision.evidenceIndex === null &&
          decision.evidenceSha256 === null
        : decision.action === 'RESOLVE' &&
          decision.workerId !== null &&
          this.sameScopeId(decision.workerId, input.workerId) &&
          decision.evidenceIndex === input.evidenceIndex &&
          decision.evidenceSha256 === input.expectedEvidenceSha256;
    return (
      this.sameScopeId(decision.id, input.commandId) &&
      decision.revision === input.expectedRevision + 1 &&
      decision.reason === input.reason.trim() &&
      decision.subjectRef.payloadHash === input.expectedEventHash &&
      this.sameScopeId(decision.subjectRef.eventId, eventId) &&
      decision.subjectRef.personObservationIndex === personObservationIndex &&
      evidenceMatches
    );
  }

  private parsedIdentity<T>(value: T | undefined): T {
    if (value === undefined) {
      throw new ApiError('invalid-response', 'Backend returned an invalid identity response.');
    }
    return value;
  }

  getObservationIdentityContext(
    token: string,
    siteId: string,
    alertId: string,
    eventId: string,
    options?: RequestOptions,
  ): Promise<ObservationIdentityContextResponse> {
    return this.request<unknown>(
      'GET',
      this.identitySubjectsPath(siteId, alertId, eventId),
      token,
      undefined,
      undefined,
      options,
    ).then((payload) => {
      const context = parseObservationIdentityContextResponse(payload);
      if (!context || !this.sameScopeId(context.eventId, eventId)) {
        throw new ApiError('invalid-response', 'Backend returned an invalid identity response.');
      }
      return context;
    });
  }

  listObservationIdentityWorkers(
    token: string,
    siteId: string,
    alertId: string,
    eventId: string,
    offset: number,
    limit: number,
    options?: RequestOptions,
  ): Promise<{ items: ObservationIdentityWorkerResponse[]; total: number }> {
    return this.request<unknown>(
      'GET',
      this.listPath(`${this.identitySubjectsPath(siteId, alertId, eventId)}/workers`, {
        offset,
        limit,
      }),
      token,
      undefined,
      undefined,
      options,
    ).then((payload) => this.parsedIdentity(parseObservationIdentityWorkerPage(payload, siteId)));
  }

  listObservationIdentityDecisions(
    token: string,
    siteId: string,
    alertId: string,
    eventId: string,
    personObservationIndex: number,
    offset: number,
    limit: number,
    options?: RequestOptions,
  ): Promise<{ items: ObservationIdentityMutationResponse['recordedDecision'][]; total: number }> {
    return this.request<unknown>(
      'GET',
      this.listPath(
        `${this.identitySubjectsPath(siteId, alertId, eventId)}/${pathId(String(personObservationIndex))}/decisions`,
        { offset, limit },
      ),
      token,
      undefined,
      undefined,
      options,
    ).then((payload) => {
      const page = parseObservationIdentityDecisionPage(payload);
      if (
        !page ||
        page.items.some(
          (item) =>
            !this.sameScopeId(item.subjectRef.eventId, eventId) ||
            item.subjectRef.personObservationIndex !== personObservationIndex,
        )
      ) {
        throw new ApiError('invalid-response', 'Backend returned an invalid identity response.');
      }
      return page;
    });
  }

  decideObservationIdentity(
    token: string,
    siteId: string,
    alertId: string,
    eventId: string,
    personObservationIndex: number,
    input: ObservationIdentityDecisionCommand,
    options?: RequestOptions,
  ): Promise<ObservationIdentityMutationResponse> {
    return this.request<unknown>(
      'POST',
      `${this.identitySubjectsPath(siteId, alertId, eventId)}/${pathId(String(personObservationIndex))}/decisions`,
      token,
      input,
      undefined,
      options,
    ).then((payload) => {
      const mutation = parseObservationIdentityMutationResponse(payload);
      if (
        !mutation ||
        !this.matchesIdentityCommand(
          mutation.recordedDecision,
          eventId,
          personObservationIndex,
          input,
        )
      ) {
        throw new ApiError('invalid-response', 'Backend returned an invalid identity response.');
      }
      return mutation;
    });
  }
}
