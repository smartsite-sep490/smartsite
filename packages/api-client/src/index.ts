import {
  ApiError,
  parseBackendErrorEnvelope,
  type BackendErrorEnvelope,
  type RequestOptions,
} from './errors';
export * from './errors';
export type BackendHealth = { status: 'ok'; service: 'smartsite-backend' };
export type {
  AttendanceReportQuery,
  AttendanceWorkersQuery,
  AttendanceReportStatus,
  AttendanceReportMetrics,
  AttendanceReportDay,
  AttendanceWorkerReport,
  AttendanceWorkersResponse,
  AttendanceSummaryResponse,
} from '@smartsite/contracts';
export { SmartSiteManagementClient } from './management';
export type { ManagementSession } from './management';
export type { NativeUploadFile, UploadFile } from './management';
export type { SafetyAlertListOptions, ZoneEntryDecisionListOptions } from './management';
export type {
  ObservationIdentityContextResponse,
  ObservationIdentityDecisionCommand,
  ObservationIdentityDecisionResponse,
  ObservationIdentityMutationResponse,
  ObservationIdentityWorkerResponse,
} from '@smartsite/contracts/management';
export type {
  AccountResponse,
  CreateContractorWorkerAccountCommand,
  ContractorWorkerAccountResponse,
  ContractorWorkerAccountOptionsResponse,
  WorkerProfileSnapshot,
  UpdateContractorWorkerCommand,
  LoginResponse,
  Page,
  SafetyAlertDetailResponse,
  SafetyAlertDetectionResponse,
  SafetyAlertResponse,
  SafetyAlertStatus,
  SafetyAlertReviewTargetStatus,
  SafetyAlertReviewResponse,
  SafetyAlertReviewMutationResponse,
  SafetyAlertType,
  SiteResponse,
  WorkerResponse,
  ContractorResponse,
  ContractorParticipationResponse,
  ContractorRepresentativeGrantResponse,
  WorkerSiteZoneAssignmentResponse,
  WorkerSiteZoneAssignmentStatus,
  FaceEnrollmentSessionResponse,
  FaceEnrollmentSessionStatus,
  FaceProfileResponse,
  ZoneResponse,
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
  PpeAlertNotificationEvent,
  PpeAlertNotificationMetadata,
  SafetyAlertNotificationTarget,
  UserNotificationResponse,
  UserNotificationListResponse,
  NotificationReadResponse,
  NotificationDeleteReadResponse,
  NotificationDeleteResponse,
  ShiftChangeRequestResponse,
  ShiftSwapRequestResponse,
  ShiftRequestListOptions,
  ShiftRequestListResponse,
  ShiftRequestResponse,
  AbsenceRequestResponse,
} from '@smartsite/contracts';
/** baseUrl is the backend origin (or reverse-proxy prefix), without /api/v1. */
export async function getBackendHealth(
  baseUrl: string,
  { signal, timeoutMs = 8_000 }: RequestOptions = {},
): Promise<BackendHealth> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/health/live`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      let backendError: BackendErrorEnvelope | undefined;
      try {
        backendError = parseBackendErrorEnvelope(JSON.parse(body), response.status);
      } catch {
        // A proxy or upstream may return HTML or malformed JSON; never surface it to callers.
      }
      throw new ApiError(
        'http',
        backendError?.message ?? `Backend returned HTTP ${response.status}.`,
        response.status,
        backendError,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ApiError('invalid-response', 'Backend returned an invalid health response.');
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      !('status' in data) ||
      data.status !== 'ok' ||
      !('service' in data) ||
      data.service !== 'smartsite-backend'
    ) {
      throw new ApiError('invalid-response', 'Backend returned an invalid health response.');
    }
    return { status: 'ok', service: 'smartsite-backend' };
  } catch (error) {
    if (signal?.aborted) throw new ApiError('cancelled', 'Request cancelled.');
    if (timedOut) throw new ApiError('timeout', 'Backend request timed out.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', 'Could not connect to the backend.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
export type * from '@smartsite/contracts';
export { healthCertificateExpiry, isWorkerDocumentDate } from '@smartsite/contracts/worker-document-dates';
export type {
  WorkerDocumentKind,
  WorkerDocumentStatus,
  DocumentOcrResult,
  WorkerDocumentResponse,
  WorkerComplianceStatus,
  WorkerComplianceResponse,
  ReviewWorkerDocumentCommand,
} from '@smartsite/contracts';
export type { DocumentImageQuality, WorkerIdentityImageResponse } from '@smartsite/contracts';
