import { captureSessionScopes, dispatchSessionExpired } from './session-expiry';
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
  VerifyQrCommand,
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
  Mf06AssessmentPage,
  Mf06AssessmentResponse,
  Mf06RequestStatusPage,
  Mf06RequestStatusResponse,
} from '@smartsite/contracts';
import {
  parseMf06AssessmentPage,
  parseMf06AssessmentResponse,
  parseMf06RequestStatusPage,
  parseMf06RequestStatusResponse,
} from '@smartsite/contracts/mf06-assessments';
import {
  parseCameraPreviewResponse,
  type CameraPreviewResponse,
} from '@smartsite/contracts/camera-preview';
export type { SchedulingRequestStatus };
import type { CameraMediaFrame } from '@smartsite/contracts/camera-preview';
import {
  processCameraMediaNdjsonStream,
  type CameraVideoStreamOptions,
} from './camera-media-stream';

import { ApiError, parseBackendErrorEnvelope, type RequestOptions } from './errors';
import { parseCameraObservationZones } from '@smartsite/contracts/camera-observation-zones';
import type { CameraConfigurationImageResponse } from '@smartsite/contracts/camera-configuration-image';
import {
  discardAbortedResponse,
  MAX_CONFIGURATION_IMAGE_RESPONSE_BYTES,
  parseScopedCameraConfigurationImage,
  readBoundedResponseJson,
} from './bounded-json';
import { parseMf05DemoStatus, type Mf05DemoStatus } from './mf05-demo';
export type { CameraConfigurationImageResponse };

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

export const MAX_RECORDED_VIDEO_BYTES = 2_000_000;
// Match the Backend's existing local evidence bound; this is not a model/data limit.
const MAX_EVIDENCE_JPEG_BYTES = 1_048_576;
const MAX_CHECKLIST_EVIDENCE_BYTES = 5_242_880;

export interface RecordedCameraVideoOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  expectedCameraExternalId?: string;
}
type CameraMutation = { expectedConfigurationVersion: number };
const pathId = (id: string) => encodeURIComponent(id);
const MAX_TIMEOUT_MS = 2_147_483_647;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const AUTH_SESSION_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me']);
// Node clamps NaN, Infinity, negatives, and delays above 2^31-1 to 1ms.
const validTimeout = (timeoutMs: number) =>
  Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_TIMEOUT_MS;

export interface ManagementSession {
  getAccessToken(presentedToken: string): string;
  refreshAccessToken(failedToken: string): Promise<string>;
  onUnauthorized(failedToken: string): void;
  signal: AbortSignal;
}

function retryAfter(response: Response, clampMaxSeconds?: number): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  if (clampMaxSeconds !== undefined) return Math.min(seconds, clampMaxSeconds);
  return seconds <= 86400 ? seconds : undefined;
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
  grantContractorZoneDates(token: string, siteId: string, input: GrantContractorZoneDatesCommand) {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/contractor-zone-permissions/dates`,
      token,
      input,
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
    return this.request<{
      items: Array<{ id: string; name: string; code: string }>;
    }>('GET', '/visitor-registration/sites');
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
  issueWorkerQr(token: string, siteId: string, fallbackSessionId: string) {
    return this.request<QrPassResponse>('POST', `/sites/${pathId(siteId)}/worker-qr`, token, {
      fallbackSessionId,
    });
  }
  openCameraQrFallback(token: string, siteId: string, gateId: string, direction: 'IN' | 'OUT') {
    return this.request<QrFallbackResponse>(
      'POST',
      `/sites/${pathId(siteId)}/gates/${pathId(gateId)}/qr-fallback`,
      token,
      { direction, reason: 'CAMERA_UNAVAILABLE' },
    );
  }
  verifyWorkerQr(token: string, siteId: string, gateId: string, input: VerifyQrCommand) {
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

  getMf05DemoStatus(
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ): Promise<Mf05DemoStatus> {
    return this.request<unknown>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/mf05-demo`,
      token,
      undefined,
      undefined,
      options,
    ).then((payload) => {
      const parsed = parseMf05DemoStatus(payload, siteId, cameraId);
      if (!parsed)
        throw new ApiError('invalid-response', 'Backend returned invalid MF05 operator status.');
      return parsed;
    });
  }

  applyMf05DemoRegion(
    token: string,
    siteId: string,
    cameraId: string,
    input: { regionId: string; expectedConfigurationVersion: number },
    options?: RequestOptions,
  ): Promise<Mf05DemoStatus> {
    return this.request<unknown>(
      'POST',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/mf05-demo/apply`,
      token,
      input,
      undefined,
      options,
    ).then((payload) => {
      const parsed = parseMf05DemoStatus(payload, siteId, cameraId);
      if (
        !parsed ||
        parsed.selectedRegionId !== input.regionId ||
        parsed.configurationVersion !== input.expectedConfigurationVersion
      )
        throw new ApiError('invalid-response', 'Backend returned invalid MF05 apply scope.');
      return parsed;
    });
  }

  private async runRequest<T>(
    options: RequestOptions | undefined,
    operation: (signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    if (options?.timeoutMs !== undefined && !validTimeout(options.timeoutMs)) {
      throw new RangeError(
        'timeoutMs must be a finite positive integer no greater than 2147483647.',
      );
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort);
    if (options?.signal?.aborted) controller.abort();
    let timedOut = false;
    const timeout =
      options?.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeoutMs);
    const signal =
      options?.signal || options?.timeoutMs !== undefined ? controller.signal : undefined;
    try {
      if (options?.signal?.aborted) throw new ApiError('cancelled', 'Request cancelled.');
      return await operation(signal);
    } catch (error) {
      if (options?.signal?.aborted) throw new ApiError('cancelled', 'Request cancelled.');
      if (timedOut) throw new ApiError('timeout', 'Backend request timed out.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'Could not connect to the backend.');
    } finally {
      if (timeout) clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async readBody<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return read();
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    let onAbort: (() => void) | undefined;
    const remove = () => {
      if (!onAbort) return;
      signal.removeEventListener('abort', onAbort);
      onAbort = undefined;
    };
    try {
      return await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
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
  ): RequestOptions | undefined {
    if (!token || !this.session) return options;
    return {
      ...options,
      signal: options?.signal
        ? AbortSignal.any([options.signal, this.session.signal])
        : this.session.signal,
    };
  }

  private async fetchAuthenticated(
    path: string,
    token: string | undefined,
    init: RequestInit,
    signal?: AbortSignal,
    discardOnAbort = false,
  ): Promise<Response> {
    const session = token ? this.session : undefined;
    let current = session && token ? session.getAccessToken(token) : token;
    const send = (accessToken: string | undefined) =>
      this.readBody(() => {
        if (session && (!accessToken || !accessToken.trim()))
          throw new ApiError('invalid-response', 'Session returned an invalid access token.');
        const pending = fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
          ...init,
          headers: {
            ...init.headers,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          ...(signal ? { signal } : {}),
        });
        if (discardOnAbort) {
          void pending.then(
            (response) => discardAbortedResponse(response, signal),
            () => {},
          );
        }
        return pending;
      }, signal);
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
      try {
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
      } finally {
        // This probe needs only the status; never leave its unused body open.
        void check.body?.cancel().catch(() => undefined);
      }
    };
    let response = await send(current);
    if (session && token) session.getAccessToken(token);
    if (response.status !== 401 || !session || !current || (await checkPasswordSession(response)))
      return response;
    // The rejected transport is no longer used after a refresh. Release it before
    // opening another response, including long-lived media connections.
    void response.body?.cancel().catch(() => undefined);
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

  private async responseError(
    response: Response,
    signal?: AbortSignal,
    requireJson = false,
    maxResponseBytes?: number,
    clampRetryAfterSeconds?: number,
  ): Promise<never> {
    let payload: unknown;
    try {
      payload =
        maxResponseBytes !== undefined
          ? await readBoundedResponseJson(
              response,
              maxResponseBytes,
              (read, s) => this.readBody(read, s),
              signal,
            )
          : await this.readBody(() => response.json(), signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requireJson) {
        throw new ApiError(
          'invalid-response',
          'Backend returned invalid JSON.',
          response.status,
          undefined,
          retryAfter(response, clampRetryAfterSeconds),
        );
      }
    }
    // Auth hooks handle their own request ordering. Protected requests use
    // captured scopes; an HTTP error does not require a valid JSON envelope.
    const error = parseBackendErrorEnvelope(payload, response.status);
    throw new ApiError(
      'http',
      error?.message ?? `Backend returned HTTP ${response.status}.`,
      response.status,
      error,
      retryAfter(response, clampRetryAfterSeconds),
    );
  }

  private async request<T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    credentials?: RequestCredentials,
    options?: RequestOptions,
    transport?: { cache: 'no-store'; redirect: 'error' },
    maxResponseBytes?: number,
  ): Promise<T> {
    const defaultTimeoutMs =
      AUTH_SESSION_PATHS.has(path) && (credentials === 'include' || path === '/auth/me')
        ? AUTH_REQUEST_TIMEOUT_MS
        : this.session && path.startsWith('/auth/')
          ? 15_000
          : undefined;
    const requestOptions = this.requestOptions(
      token,
      defaultTimeoutMs !== undefined
        ? { ...options, timeoutMs: options?.timeoutMs ?? defaultTimeoutMs }
        : options,
    );
    const sessionScopes = captureSessionScopes(token);
    return this.runRequest(requestOptions, async (signal) => {
      // Race headers as well as the body; some fetch adapters ignore abort.
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
          ...(AUTH_SESSION_PATHS.has(path) ? { cache: 'no-store' as const } : {}),
          ...(transport ? { cache: transport.cache, redirect: transport.redirect } : {}),
        },
        signal,
        maxResponseBytes !== undefined,
      );
      if (response.status === 204) return undefined as T;
      if (!response.ok) {
        if (
          response.status === 401 &&
          !AUTH_SESSION_PATHS.has(path) &&
          path !== '/auth/change-password' &&
          sessionScopes.length > 0
        ) {
          dispatchSessionExpired(sessionScopes);
        }
        return this.responseError(
          response,
          signal,
          false,
          maxResponseBytes,
          maxResponseBytes !== undefined || transport !== undefined ? 60 : undefined,
        );
      }
      try {
        return (
          maxResponseBytes !== undefined
            ? await readBoundedResponseJson(
                response,
                maxResponseBytes,
                (read, s) => this.readBody(read, s),
                signal,
              )
            : await this.readBody(() => response.json(), signal)
        ) as T;
      } catch (error) {
        if (signal?.aborted || error instanceof ApiError) throw error;
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
    const sessionScopes = captureSessionScopes(token);
    return this.runRequest(this.requestOptions(token, options), async (signal) => {
      const response = await this.fetchAuthenticated(
        path,
        token,
        { method, headers: { Accept: 'application/json' }, body },
        signal,
      );
      if (response.status === 204) return undefined as T;
      if (!response.ok) {
        if (response.status === 401 && sessionScopes.length > 0)
          dispatchSessionExpired(sessionScopes);
        return this.responseError(response, signal);
      }
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
    maxBytes: number = MAX_EVIDENCE_JPEG_BYTES,
  ): Promise<Blob> {
    const sessionScopes = captureSessionScopes(token);
    return this.runRequest(
      this.requestOptions(token, { ...options, timeoutMs: options?.timeoutMs ?? 5000 }),
      async (signal) => {
        const response = await this.fetchAuthenticated(
          path,
          token,
          {
            headers: {
              Accept: mediaTypes.join(', '),
            },
            cache: 'no-store',
            redirect: 'error',
          },
          signal,
        );
        if (!response.ok) {
          if (response.status === 401 && sessionScopes.length > 0)
            dispatchSessionExpired(sessionScopes);
          return this.responseError(response, signal, true);
        }
        const cancelUnreadBody = () => {
          // Cancellation must not delay reporting a limit/type failure.
          try {
            void response.body?.cancel().catch(() => undefined);
          } catch {
            // The body may already be locked by an adapter.
          }
        };
        const contentType = response.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (!contentType || !mediaTypes.includes(contentType)) {
          cancelUnreadBody();
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid evidence type.',
            response.status,
          );
        }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          cancelUnreadBody();
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid evidence size.',
            response.status,
          );
        }

        let blob: Blob;
        if (response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          let size = 0;
          try {
            while (true) {
              const row = await this.readBody(() => reader.read(), signal);
              if (row.done) break;
              size += row.value.byteLength;
              if (size > maxBytes) {
                throw new ApiError(
                  'invalid-response',
                  'Backend returned an invalid evidence size.',
                  response.status,
                );
              }
              chunks.push(new Uint8Array(row.value));
            }
            blob = new Blob(chunks, { type: contentType });
          } finally {
            try {
              void reader.cancel().catch(() => undefined);
            } catch {
              // Preserve the original read or validation failure.
            }
            reader.releaseLock();
          }
        } else {
          // Some native fetch adapters expose only blob(); their bound is checked
          // after buffering, while browser streams are capped incrementally above.
          const rawBlob = await this.readBody(() => response.blob(), signal);
          blob =
            rawBlob.type === contentType ? rawBlob : new Blob([rawBlob], { type: contentType });
        }
        const minBytes = contentType === 'image/jpeg' ? 4 : 1;
        if (blob.size < minBytes || blob.size > maxBytes) {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid evidence size.',
            response.status,
          );
        }
        if (contentType === 'image/jpeg') {
          const bytes = new Uint8Array(await this.readBody(() => blob.arrayBuffer(), signal));
          if (
            bytes[0] !== 0xff ||
            bytes[1] !== 0xd8 ||
            bytes[bytes.length - 2] !== 0xff ||
            bytes[bytes.length - 1] !== 0xd9
          ) {
            throw new ApiError(
              'invalid-response',
              'Backend returned invalid evidence image bytes.',
              response.status,
            );
          }
        }
        return blob;
      },
    );
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

  async getCameraObservationZones(
    token: string,
    siteId: string,
    cameraId: string,
    paging: PageOptions = {},
    options?: RequestOptions,
  ) {
    const offset = paging.offset ?? 0;
    const limit = paging.limit ?? 20;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApiError('invalid-response', 'Invalid camera observation page request.');
    const query = new URLSearchParams();
    if (paging.offset !== undefined) query.set('offset', String(paging.offset));
    if (paging.limit !== undefined) query.set('limit', String(paging.limit));
    const result = await this.request<unknown>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/observation-zones${query.size ? `?${query}` : ''}`,
      token,
      undefined,
      undefined,
      { ...options, timeoutMs: options?.timeoutMs ?? 5000 },
      { cache: 'no-store', redirect: 'error' },
    );
    try {
      const context = parseCameraObservationZones(result);
      if (
        context.siteId.toLowerCase() !== siteId.toLowerCase() ||
        context.cameraId.toLowerCase() !== cameraId.toLowerCase() ||
        context.items.length !== Math.min(limit, Math.max(0, context.total - offset))
      )
        throw new Error('Scope mismatch');
      return context;
    } catch {
      throw new ApiError(
        'invalid-response',
        'Backend returned invalid camera observation context.',
      );
    }
  }
  async getCameraConfigurationImage(
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ): Promise<CameraConfigurationImageResponse> {
    const result = await this.request<unknown>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/configuration-image`,
      token,
      undefined,
      undefined,
      { ...options, timeoutMs: options?.timeoutMs ?? 3000 },
      { cache: 'no-store', redirect: 'error' },
      MAX_CONFIGURATION_IMAGE_RESPONSE_BYTES,
    );
    return parseScopedCameraConfigurationImage(result, siteId, cameraId);
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
    files: File[],
    options?: RequestOptions,
  ) {
    const form = new FormData();
    form.set('command', JSON.stringify(input));
    for (const file of files) form.append('files', file);
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
      MAX_CHECKLIST_EVIDENCE_BYTES,
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
    file?: File,
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
    file?: File,
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
  private resultForm(input: VersionCommand, file?: File) {
    const form = new FormData();
    for (const [name, value] of Object.entries(input)) form.set(name, String(value));
    if (file) form.set('file', file);
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
  me(token: string, options?: RequestOptions) {
    return this.request<AccountResponse>('GET', '/auth/me', token, undefined, undefined, options);
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

  createWorker(
    token: string,
    siteId: string,
    input: {
      externalId: string;
      displayName: string;
      contractorId?: string;
      userId?: string;
    },
    options?: RequestOptions,
  ): Promise<WorkerResponse> {
    return this.request<WorkerResponse>(
      'POST',
      `/sites/${pathId(siteId)}/workers`,
      token,
      input,
      undefined,
      options,
    );
  }

  linkWorkerAccount(
    token: string,
    siteId: string,
    workerId: string,
    userId: string,
    options?: RequestOptions,
  ): Promise<WorkerResponse> {
    return this.request<WorkerResponse>(
      'PUT',
      `/sites/${pathId(siteId)}/workers/${pathId(workerId)}/account`,
      token,
      { userId },
      undefined,
      options,
    );
  }
  prepareFaceAccount(
    token: string,
    siteId: string,
    userId: string,
    options?: RequestOptions,
  ): Promise<WorkerResponse> {
    return this.request<WorkerResponse>(
      'POST',
      `/sites/${pathId(siteId)}/workers/for-account`,
      token,
      { userId },
      undefined,
      options,
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
    options?: RequestOptions,
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteId: string,
    input: { code?: string; name: string },
    options?: RequestOptions,
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteIdOrInput: string | { code: string; name: string },
    inputOrOptions?: { code?: string; name: string } | RequestOptions,
    maybeOptions?: RequestOptions,
  ): Promise<ContractorResponse> {
    if (typeof siteIdOrInput === 'string') {
      if (!inputOrOptions || !('name' in inputOrOptions)) {
        throw new ApiError('invalid-response', 'Site-scoped contractor creation requires name.');
      }
      return this.request<ContractorResponse>(
        'POST',
        `/sites/${pathId(siteIdOrInput)}/contractors`,
        token,
        inputOrOptions,
        undefined,
        maybeOptions,
      );
    }
    const options = inputOrOptions && !('name' in inputOrOptions) ? inputOrOptions : undefined;
    return this.request<ContractorResponse>(
      'POST',
      '/contractors',
      token,
      siteIdOrInput,
      undefined,
      options,
    );
  }
  createContractorParticipation(
    token: string,
    contractorId: string,
    input: { siteId: string; validFrom: string; validUntil: string | null },
    options?: RequestOptions,
  ) {
    return this.request<ContractorParticipationResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/participations`,
      token,
      input,
      undefined,
      options,
    );
  }
  grantContractorRepresentative(
    token: string,
    contractorId: string,
    userId: string,
    options?: RequestOptions,
  ): Promise<ContractorRepresentativeGrantResponse> {
    return this.request<ContractorRepresentativeGrantResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/representative-grants`,
      token,
      { userId },
      undefined,
      options,
    );
  }
  createContractorWorker(
    token: string,
    contractorId: string,
    input: { siteId: string; externalId: string; displayName: string },
    options?: RequestOptions,
  ): Promise<WorkerResponse> {
    return this.request<WorkerResponse>(
      'POST',
      `/contractors/${pathId(contractorId)}/workers`,
      token,
      input,
      undefined,
      options,
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
    input: {
      siteId: string;
      zoneIds: string[];
      validFrom: string;
      validUntil: string | null;
    },
    options?: RequestOptions,
  ) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/workers/${pathId(workerId)}/site-zone-assignment-requests`,
      token,
      input,
      undefined,
      options,
    );
  }
  safetyReviewWorkerSiteZoneAssignment(token: string, requestId: string, options?: RequestOptions) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(requestId)}/safety-review`,
      token,
      undefined,
      undefined,
      options,
    );
  }
  decideWorkerSiteZoneAssignment(
    token: string,
    requestId: string,
    approve: boolean,
    review?: { expectedVersion?: number; reviewNote?: string },
    options?: RequestOptions,
  ) {
    const body: {
      approve: boolean;
      expectedVersion?: number;
      reviewNote?: string;
    } = {
      approve,
      ...(review?.expectedVersion !== undefined ? { expectedVersion: review.expectedVersion } : {}),
      ...(review?.reviewNote !== undefined ? { reviewNote: review.reviewNote } : {}),
    };
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(requestId)}/site-manager-decision`,
      token,
      body,
      undefined,
      options,
    );
  }
  revokeWorkerAssignment(
    token: string,
    assignmentId: string,
    expectedVersion: number,
    reviewNote: string,
    options?: RequestOptions,
  ): Promise<WorkerSiteZoneAssignmentResponse> {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(assignmentId)}/revoke`,
      token,
      { expectedVersion, reviewNote },
      undefined,
      options,
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
    input: {
      requestId: string;
      representativeConfirmed: true;
      reviewNote: string;
    },
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
  uploadFaceEnrollmentSample(token: string, sessionId: string, sample: Blob) {
    const form = new FormData();
    form.append('sample', sample, 'face-sample.jpg');
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
    sample: Blob,
    target: EnrollmentCaptureTarget,
  ) {
    const form = new FormData();
    form.append('sample', sample, 'face-quality-check.jpg');
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

  accessSetup(
    token: string,
    siteId: string,
    options?: RequestOptions,
  ): Promise<AccessSetupResponse> {
    return this.request<AccessSetupResponse>(
      'GET',
      `/sites/${pathId(siteId)}/access-setup`,
      token,
      undefined,
      undefined,
      options,
    );
  }

  grantContractorZone(
    token: string,
    siteId: string,
    input: GrantContractorZoneCommand,
    options?: RequestOptions,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/contractor-zone-permissions`,
      token,
      input,
      undefined,
      options,
    );
  }

  grantWorkerZone(
    token: string,
    siteId: string,
    input: GrantWorkerZoneCommand,
    options?: RequestOptions,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/worker-zone-permissions`,
      token,
      input,
      undefined,
      options,
    );
  }

  revokeZonePermission(
    token: string,
    siteId: string,
    id: string,
    kind: 'worker' | 'contractor',
    options?: RequestOptions,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'POST',
      `/sites/${pathId(siteId)}/access-setup/${kind}-zone-permissions/${pathId(id)}/revoke`,
      token,
      undefined,
      undefined,
      options,
    );
  }

  createCamera(
    token: string,
    siteId: string,
    input: { code: string; externalId: string; name: string },
  ) {
    return this.request<CameraResponse>('POST', `/sites/${pathId(siteId)}/cameras`, token, input);
  }
  listCameras(
    token: string,
    siteId: string,
    options?: PageOptions,
    requestOptions?: RequestOptions,
  ) {
    return this.request<Page<CameraResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras`, options),
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }
  getCamera(token: string, siteId: string, cameraId: string, requestOptions?: RequestOptions) {
    return this.request<CameraResponse>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}`,
      token,
      undefined,
      undefined,
      requestOptions,
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

  listPreviewCameras(
    token: string,
    siteId: string,
    options?: PageOptions,
    requestOptions?: RequestOptions,
  ) {
    return this.request<Page<CameraResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/preview-cameras`, options),
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }

  async getCameraPreview(
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ): Promise<CameraPreviewResponse> {
    const timeoutMs = options?.timeoutMs !== undefined ? options.timeoutMs : 3000;
    const payload = await this.request<unknown>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/preview`,
      token,
      undefined,
      undefined,
      { ...options, timeoutMs },
    );
    try {
      return parseCameraPreviewResponse(payload);
    } catch (error) {
      throw new ApiError(
        'invalid-response',
        error instanceof Error ? error.message : 'Invalid camera preview response from backend.',
      );
    }
  }

  /**
   * Connects to the authenticated NDJSON raw video stream for a single selected LIVE camera.
   * Transports credentials via Authorization header only (no query string leaks).
   */
  async streamCameraVideo(
    token: string,
    siteId: string,
    cameraId: string,
    onFrame: (frame: CameraMediaFrame) => void,
    options?: CameraVideoStreamOptions,
  ): Promise<void> {
    const sessionScopes = captureSessionScopes(token);
    const path = `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/video-stream`;
    const callerSignal = this.requestOptions(token, options)?.signal;

    // Initial connection timeout: only bounds the time to receive response headers,
    // ensuring a timeout does not terminate a healthy long-running stream.
    const timeoutMs = options?.timeoutMs ?? 5000;
    const connectionController = new AbortController();
    let isConnected = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!isConnected) {
          connectionController.abort();
        }
      }, timeoutMs);
    }

    const abortHandler = () => {
      connectionController.abort();
    };
    if (callerSignal) {
      if (callerSignal.aborted) {
        connectionController.abort();
      } else {
        callerSignal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    let response: Response;
    try {
      response = await this.fetchAuthenticated(
        path,
        token,
        {
          method: 'GET',
          headers: {
            Accept: 'application/x-ndjson',
          },
          cache: 'no-store',
          redirect: 'error',
        },
        connectionController.signal,
        true,
      );
      isConnected = true;
    } catch (error) {
      if (callerSignal?.aborted) {
        throw new ApiError('cancelled', 'Camera video stream request cancelled.');
      }
      if (connectionController.signal.aborted && !callerSignal?.aborted) {
        throw new ApiError(
          'timeout',
          `Initial connection to video stream timed out after ${timeoutMs}ms.`,
        );
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        'network',
        error instanceof Error ? error.message : 'Could not connect to backend video stream.',
      );
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (callerSignal) {
        callerSignal.removeEventListener('abort', abortHandler);
      }
    }

    if (callerSignal?.aborted)
      throw new ApiError('cancelled', 'Camera video stream request cancelled.');
    if (connectionController.signal.aborted)
      throw new ApiError(
        'timeout',
        `Initial connection to video stream timed out after ${timeoutMs}ms.`,
      );
    if (!this.session && response.status === 401 && sessionScopes.length > 0)
      dispatchSessionExpired(sessionScopes);
    if (!response.ok) {
      // Healthy streams have no body deadline. Error bodies are finite JSON,
      // bounded separately, and remain cancellable after headers arrive.
      return this.runRequest(
        { signal: callerSignal, ...(timeoutMs > 0 ? { timeoutMs } : {}) },
        (signal) => this.responseError(response, signal, false, 16_000, 60),
      );
    }

    // Verify response content-type is application/x-ndjson
    const contentType =
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (contentType !== 'application/x-ndjson') {
      await response.body?.cancel().catch(() => undefined);
      throw new ApiError(
        'invalid-response',
        `Expected application/x-ndjson stream response, received: '${contentType}'.`,
      );
    }

    if (!response.body) {
      throw new ApiError(
        'invalid-response',
        'Backend returned an empty response body for video stream.',
      );
    }

    await processCameraMediaNdjsonStream(
      response.body,
      (frame) => {
        if (!callerSignal?.aborted) onFrame(frame);
      },
      { ...options, signal: callerSignal },
    );
    if (callerSignal?.aborted)
      throw new ApiError('cancelled', 'Camera video stream request cancelled.');
  }

  /**
   * Fetches an authenticated MP4 recorded video blob for the selected camera.
   * Transports credentials via Authorization header only (no query string token leaks).
   * Enforces 5s default timeout, cache: no-store, redirect: error, video/mp4 MIME check,
   * maximum 2,000,000 bytes bound, and validates x-camera-external-id if expectedCameraExternalId is provided.
   */
  async readRecordedCameraVideo(
    token: string,
    siteId: string,
    cameraId: string,
    options?: RecordedCameraVideoOptions,
  ): Promise<Blob> {
    const sessionScopes = captureSessionScopes(token);
    const path = `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/recorded-video`;
    const callerSignal = this.requestOptions(token, options)?.signal;
    const timeoutMs = options?.timeoutMs ?? 5000;
    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    const timer = timeoutMs > 0 ? setTimeout(abortHandler, timeoutMs) : null;
    let response: Response | null = null;
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', abortHandler, { once: true });
    const readBounded = async (maximum: number): Promise<Uint8Array<ArrayBuffer>[]> => {
      if (!response?.body)
        throw new ApiError('invalid-response', 'Recorded video response body is missing.');
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Recorded read aborted'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        if (controller.signal.aborted) throw new Error('Recorded read aborted');
        while (true) {
          const row = await Promise.race([reader.read(), aborted]);
          if (row.done) break;
          size += row.value.byteLength;
          if (size > maximum)
            throw new ApiError('invalid-response', 'Recorded video body exceeds maximum limit.');
          chunks.push(new Uint8Array(row.value));
        }
        return chunks;
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    };
    try {
      if (controller.signal.aborted) throw new Error('Recorded request aborted');
      response = await this.fetchAuthenticated(
        path,
        token,
        {
          method: 'GET',
          headers: { Accept: 'video/mp4' },
          cache: 'no-store',
          redirect: 'error',
        },
        controller.signal,
        true,
      );
      if (controller.signal.aborted) throw new Error('Recorded request aborted');
      if (!this.session && response.status === 401 && sessionScopes.length > 0)
        dispatchSessionExpired(sessionScopes);
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const retryAfterSeconds =
          retry && /^\d+$/.test(retry) ? Math.min(Number(retry), 60) : undefined;
        let payload: unknown;
        try {
          const chunks = await readBounded(16000);
          payload = JSON.parse(await new Blob(chunks).text());
        } catch {
          payload = undefined;
        }
        const backendError = parseBackendErrorEnvelope(payload, response.status);
        throw new ApiError(
          'http',
          backendError?.message ?? `Backend returned HTTP ${response.status} for recorded video.`,
          response.status,
          backendError,
          retryAfterSeconds,
        );
      }
      if (
        response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'video/mp4'
      )
        throw new ApiError('invalid-response', 'Expected video/mp4 response.');
      if (
        options?.expectedCameraExternalId &&
        response.headers.get('x-camera-external-id') !== options.expectedCameraExternalId
      )
        throw new ApiError(
          'invalid-response',
          'Recorded video camera external ID is missing or mismatched.',
        );
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RECORDED_VIDEO_BYTES))
        throw new ApiError(
          'invalid-response',
          'Recorded video content length exceeds maximum limit.',
        );
      const chunks = await readBounded(MAX_RECORDED_VIDEO_BYTES);
      if (controller.signal.aborted) throw new Error('Recorded read aborted');
      return new Blob(chunks, { type: 'video/mp4' });
    } catch (error) {
      if (callerSignal?.aborted)
        throw new ApiError('cancelled', 'Recorded camera video request cancelled.');
      if (controller.signal.aborted)
        throw new ApiError('timeout', `Recorded video request timed out after ${timeoutMs}ms.`);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'network',
        error instanceof Error ? error.message : 'Could not fetch recorded video.',
      );
    } finally {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortHandler);
      await response?.body?.cancel().catch(() => undefined);
    }
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
  listZones(token: string, siteId: string, options?: PageOptions, requestOptions?: RequestOptions) {
    return this.request<Page<ZoneResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/zones`, options),
      token,
      undefined,
      undefined,
      requestOptions,
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
    requestOptions?: RequestOptions,
  ) {
    return this.request<RegionMutationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`,
      token,
      input,
      undefined,
      requestOptions,
    );
  }
  listRegions(
    token: string,
    siteId: string,
    cameraId: string,
    options?: PageOptions,
    requestOptions?: RequestOptions,
  ) {
    return this.request<Page<RegionResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`, options),
      token,
      undefined,
      undefined,
      requestOptions,
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
    requestOptions?: RequestOptions,
  ) {
    return this.request<RegionMutationResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}/polygon`,
      token,
      input,
      undefined,
      requestOptions,
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
  listContractorRepresentativeAssignments(
    token: string,
    siteId: string,
    options?: PageOptions,
    requestOptions?: RequestOptions,
  ): Promise<Page<ContractorRepresentativeAssignmentResponse>> {
    return this.request<Page<ContractorRepresentativeAssignmentResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/contractor-representative-assignments`, options),
      token,
      undefined,
      undefined,
      requestOptions,
    );
  }
  assignContractorRepresentative(
    token: string,
    siteId: string,
    contractorId: string,
    input: { userId: string },
    options?: RequestOptions,
  ): Promise<ContractorRepresentativeAssignmentResponse> {
    return this.request<ContractorRepresentativeAssignmentResponse>(
      'POST',
      `/sites/${pathId(siteId)}/contractors/${pathId(contractorId)}/representatives`,
      token,
      input,
      undefined,
      options,
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
    input: {
      workerId: string;
      shiftId: string;
      workDate: string;
      isActive?: boolean;
    },
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
      this.listPath(`/sites/${pathId(siteId)}/schedule-assignments`, {
        ...options,
        contractorId,
      }),
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
  ): Promise<{
    items: ObservationIdentityMutationResponse['recordedDecision'][];
    total: number;
  }> {
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

  listMf06Assessments(
    token: string,
    siteId: string,
    pageOptions?: PageOptions,
    requestOptions?: RequestOptions,
  ): Promise<Mf06AssessmentPage> {
    const offset = pageOptions?.offset ?? 0;
    const limit = pageOptions?.limit ?? 20;
    const path = this.listPath(`/sites/${pathId(siteId)}/mf06-assessments`, {
      offset,
      limit,
    });
    return this.request<unknown>('GET', path, token, undefined, undefined, requestOptions).then(
      (payload) => {
        let page: Mf06AssessmentPage;
        try {
          page = parseMf06AssessmentPage(payload);
        } catch {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 assessment page.',
          );
        }
        if (
          page.offset !== offset ||
          page.limit !== limit ||
          page.items.some((item) => !this.sameScopeId(item.siteId, siteId))
        ) {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 assessment page.',
          );
        }
        return page;
      },
    );
  }

  getMf06Assessment(
    token: string,
    siteId: string,
    assessmentId: string,
    requestOptions?: RequestOptions,
  ): Promise<Mf06AssessmentResponse> {
    const path = `/sites/${pathId(siteId)}/mf06-assessments/${pathId(assessmentId)}`;
    return this.request<unknown>('GET', path, token, undefined, undefined, requestOptions).then(
      (payload) => {
        let assessment: Mf06AssessmentResponse;
        try {
          assessment = parseMf06AssessmentResponse(payload);
        } catch {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 assessment response.',
          );
        }
        if (
          !this.sameScopeId(assessment.siteId, siteId) ||
          !this.sameScopeId(assessment.assessmentId, assessmentId)
        ) {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 assessment response.',
          );
        }
        return assessment;
      },
    );
  }

  listMf06RequestStatuses(
    token: string,
    siteId: string,
    options?: PageOptions,
    requestOptions?: RequestOptions,
  ): Promise<Mf06RequestStatusPage> {
    const offset = typeof options?.offset === 'number' ? options.offset : 0;
    const limit = typeof options?.limit === 'number' ? options.limit : 20;
    const path = this.listPath(`/sites/${pathId(siteId)}/mf06-assessment-requests`, {
      offset,
      limit,
    });
    return this.request<unknown>('GET', path, token, undefined, undefined, requestOptions).then(
      (payload) => {
        let page: Mf06RequestStatusPage;
        try {
          page = parseMf06RequestStatusPage(payload);
        } catch {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 request status page.',
          );
        }
        if (
          page.offset !== offset ||
          page.limit !== limit ||
          page.items.some((item) => !this.sameScopeId(item.siteId, siteId))
        ) {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 request status page.',
          );
        }
        return page;
      },
    );
  }

  getMf06RequestStatus(
    token: string,
    siteId: string,
    requestId: string,
    requestOptions?: RequestOptions,
  ): Promise<Mf06RequestStatusResponse> {
    const path = `/sites/${pathId(siteId)}/mf06-assessment-requests/${pathId(requestId)}`;
    return this.request<unknown>('GET', path, token, undefined, undefined, requestOptions).then(
      (payload) => {
        let status: Mf06RequestStatusResponse;
        try {
          status = parseMf06RequestStatusResponse(payload);
        } catch {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 request status response.',
          );
        }
        if (
          !this.sameScopeId(status.siteId, siteId) ||
          !this.sameScopeId(status.requestId, requestId)
        ) {
          throw new ApiError(
            'invalid-response',
            'Backend returned an invalid MF06 request status response.',
          );
        }
        return status;
      },
    );
  }
}

export async function readRecordedCameraVideo(
  token: string,
  siteId: string,
  cameraId: string,
  options?: RecordedCameraVideoOptions,
  client?: SmartSiteManagementClient,
): Promise<Blob> {
  const managementClient = client ?? new SmartSiteManagementClient('http://localhost:3000');
  return managementClient.readRecordedCameraVideo(token, siteId, cameraId, options);
}
