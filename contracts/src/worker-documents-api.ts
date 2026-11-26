/** Dates are ISO calendar dates; expiry is inclusive in Asia/Ho_Chi_Minh. */
export type WorkerDocumentKind = 'SAFETY_CARD' | 'HEALTH_CERTIFICATE' | 'PERSONAL_INSURANCE';
export interface WorkerIdentityImageResponse {
  id: string;
  side: 'FRONT' | 'BACK';
  mediaType: 'image/jpeg' | 'image/png';
  originalName: string;
  uploadedAt: string;
}
export type WorkerDocumentStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type WorkerDocumentNotificationEvent =
  | 'DOCUMENT_SUBMITTED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'DOCUMENT_EXPIRING'
  | 'DOCUMENT_EXPIRED';
export interface WorkerDocumentDateCheck {
  status: 'MATCH' | 'MISMATCH' | 'UNAVAILABLE' | 'NO_REFERENCE';
  field: 'ISSUED_ON' | 'EXPIRES_ON';
  submittedDate: string | null;
  detectedDate: string | null;
}
export type WorkerDocumentAnalysisResult =
  | {
      status: 'COMPLETE';
      detectedKind: WorkerDocumentKind | 'OTHER' | null;
      issuedOn: string | null;
      expiresOn: string | null;
    }
  | { status: 'UNAVAILABLE' };

export type WorkerDocumentAiAnalysis =
  | (Extract<WorkerDocumentAnalysisResult, { status: 'COMPLETE' }> & {
      kindMismatch: boolean;
      dateCheck: WorkerDocumentDateCheck;
      startDateCheck?: WorkerDocumentDateCheck;
      validity?: 'CURRENT' | 'EXPIRED' | 'NOT_YET_VALID' | 'UNKNOWN';
    })
  | { status: 'UNAVAILABLE' }
  | { status: 'ANALYZING' };

export interface WorkerDocumentAiSummary {
  status: 'NOT_SCANNED' | 'ANALYZING' | 'ATTENTION' | 'NO_DISCREPANCY' | 'INSUFFICIENT';
  pending: number;
  complete: number;
  unresolved: number;
}

export interface SubmitWorkerDocumentsCommand {
  requestId: string;
  expectedVersion: number;
  safetyCardRequired: boolean;
  documents: Partial<Record<WorkerDocumentKind, UploadWorkerDocumentCommand>>;
}

export interface WorkerDocumentSubmissionResponse {
  requestId: string;
  version: number;
  documentIds: string[];
}

export interface WorkerIdentityUpdateCommand {
  expectedVersion: number;
  nationalId: string;
  phoneNumber: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  address: string;
}

export interface SaveWorkerOnboardingDraftCommand {
  expectedVersion: number;
  displayName: string;
  username: string;
  email: string;
  safetyCardRequired: boolean | null;
  language?: 'vi' | 'en';
  documents: Partial<Record<WorkerDocumentKind, UploadWorkerDocumentCommand>>;
}

export interface WorkerOnboardingDraft extends Omit<
  SaveWorkerOnboardingDraftCommand,
  'expectedVersion' | 'documents'
> {
  id: string;
  version: number;
  documents: Partial<
    Record<
      WorkerDocumentKind,
      UploadWorkerDocumentCommand & {
        originalName?: string;
        mediaType?: WorkerDocumentResponse['mediaType'];
      }
    >
  >;
  workerId: string | null;
  workerCode: string | null;
  workerVersion: number | null;
  canProvision: boolean;
  canSubmit: boolean;
  missingKinds: WorkerDocumentKind[];
  submissionStatus: WorkerDocumentSubmissionStatus;
}

export interface WorkerOnboardingBatchItem {
  id: string;
  version: number;
}

export interface WorkerOnboardingBatchResult {
  id: string;
  status: 'SUCCEEDED' | 'FAILED';
  workerId?: string;
  error?: { code: string; message: string };
}

export interface WorkerDocumentResponse {
  id: string;
  workerId: string;
  kind: WorkerDocumentKind;
  status: WorkerDocumentStatus;
  originalName: string;
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedAt: string;
  /** Worker/Representative proposal only; does not grant or extend approved validity. */
  submittedExpiresOn?: string | null;
  /** Examination, issue or coverage start date supplied for Safety confirmation. */
  submittedIssuedOn?: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  version: number;
  /** Advisory AI output exposed to the scoped Contractor Representative. */
  aiAnalysis?: WorkerDocumentAiAnalysis;
}
export type WorkerComplianceStatus = 'NOT_REQUIRED' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
export type WorkerDocumentSubmissionStatus = 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'REVIEWED';
export interface WorkerComplianceListQuery {
  offset?: number;
  limit?: number;
  search?: string;
  pendingOnly?: boolean;
  submissionStatus?: WorkerDocumentSubmissionStatus;
  needsSupplement?: boolean;
  contractorId?: string;
  expiringOnly?: boolean;
}
export interface WorkerComplianceResponse {
  version?: number;
  identityVersion?: number;
  safetyCardRequired?: boolean;
  draftSafetyCardRequired?: boolean | null;
  canSubmit?: boolean;
  aiSummary?: WorkerDocumentAiSummary;
  workerId: string;
  contractorId: string | null;
  displayName: string;
  externalId: string;
  nationalId: string | null;
  phoneNumber: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  address: string | null;
  identityImages: WorkerIdentityImageResponse[];
  status: WorkerComplianceStatus;
  submissionStatus: WorkerDocumentSubmissionStatus;
  needsSupplement: boolean;
  documents: WorkerDocumentResponse[];
  missingKinds: WorkerDocumentKind[];
  expiringKinds: WorkerDocumentKind[];
}
export interface ReviewWorkerDocumentCommand {
  expectedVersion: number;
  approve: boolean;
  issuedOn?: string;
  expiresOn?: string;
  reviewNote?: string;
}
export interface UploadWorkerDocumentCommand {
  submittedExpiresOn?: string;
  submittedIssuedOn?: string;
}
