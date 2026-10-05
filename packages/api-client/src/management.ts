import type {
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
  AccountResponse,
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
  UserNotificationListResponse,
  NotificationReadResponse,
  FaceGateVerificationResponse,
  GateFacePresenceResponse,
  GateAccessLogResponse,
  EnrollmentCaptureTarget,
  WorkerGatePermissionsResponse,
  SetWorkerGatePermissionsCommand,
} from '@smartsite/contracts';
export type { SchedulingRequestStatus };

import { ApiError, parseBackendErrorEnvelope, type RequestOptions } from './index';

export type PageOptions = { offset?: number; limit?: number };
export type WorkerScheduleListOptions = PageOptions & {
  fromDate?: string;
  toDate?: string;
  workerId?: string;
  shiftId?: string;
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
  searchName?: string;
};
export type SafetyAlertListOptions = PageOptions & {
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

export class SmartSiteManagementClient {
  constructor(private readonly baseUrl: string) {}

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

  private async request<T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    credentials?: RequestCredentials,
    options?: RequestOptions,
  ): Promise<T> {
    return this.runRequest(options, async (signal) => {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(credentials ? { credentials } : {}),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 204) return undefined as T;
      let payload: unknown;
      try {
        payload = await this.readBody(() => response.json(), signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
      }
      if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('smartsite:session-expired'));
        }
        const error = parseBackendErrorEnvelope(payload, response.status);
        throw new ApiError(
          'http',
          error?.message ?? `Backend returned HTTP ${response.status}.`,
          response.status,
          error,
        );
      }
      return payload as T;
    });
  }

  private async requestFormData<T>(
    method: string,
    path: string,
    token: string,
    body: FormData,
    options?: RequestOptions,
  ): Promise<T> {
    return this.runRequest(options, async (signal) => {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
        method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal,
      });
      if (response.status === 204) return undefined as T;
      let payload: unknown;
      try {
        payload = await this.readBody(() => response.json(), signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
      }
      if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('smartsite:session-expired'));
        }
        const error = parseBackendErrorEnvelope(payload, response.status);
        throw new ApiError(
          'http',
          error?.message ?? `Backend returned HTTP ${response.status}.`,
          response.status,
          error,
        );
      }
      return payload as T;
    });
  }

  private async requestBlob(path: string, token: string, options?: RequestOptions): Promise<Blob> {
    return this.runRequest(options, async (signal) => {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
        headers: {
          Accept: 'image/jpeg',
          Authorization: `Bearer ${token}`,
        },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await this.readBody(() => response.json(), signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
        }
        const error = parseBackendErrorEnvelope(payload, response.status);
        throw new ApiError(
          'http',
          error?.message ?? `Backend returned HTTP ${response.status}.`,
          response.status,
          error,
        );
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (contentType !== 'image/jpeg') {
        throw new ApiError(
          'invalid-response',
          'Backend returned an invalid evidence type.',
          response.status,
        );
      }
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
    role: 'SAFETY_OFFICER' | 'SECURITY_OFFICER',
    page: PageOptions = {},
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
    operation: 'link' | 'assign' | 'start' | 'submit' | 'review' | 'close' | 'reopen',
    input:
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

  login(username: string, password: string, clientType: AuthClientType = 'WEB') {
    return this.request<LoginResponse>(
      'POST',
      '/auth/login',
      undefined,
      { username, password, clientType },
      clientType === 'WEB' ? 'include' : undefined,
    );
  }
  refresh(clientType: AuthClientType, refreshToken?: string) {
    return this.request<LoginResponse>(
      'POST',
      '/auth/refresh',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
    );
  }
  me(token: string) {
    return this.request<AccountResponse>('GET', '/auth/me', token);
  }
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return this.request<void>('POST', '/auth/change-password', token, {
      currentPassword,
      newPassword,
    });
  }
  logout(clientType: AuthClientType = 'WEB', refreshToken?: string) {
    return this.request<void>(
      'POST',
      '/auth/logout',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
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

  createContractor(
    token: string,
    input: { code: string; name: string },
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteId: string,
    input: { code: string; name: string },
  ): Promise<ContractorResponse>;
  createContractor(
    token: string,
    siteIdOrInput: string | { code: string; name: string },
    siteInput?: { code: string; name: string },
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
  decideWorkerSiteZoneAssignment(token: string, requestId: string, approve: boolean) {
    return this.request<WorkerSiteZoneAssignmentResponse>(
      'POST',
      `/site-zone-assignment-requests/${pathId(requestId)}/site-manager-decision`,
      token,
      { approve },
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
      code: string;
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
    input: { name: string; startsAt: string; endsAt: string; timezone: string },
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
