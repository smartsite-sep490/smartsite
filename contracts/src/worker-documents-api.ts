/** Dates are ISO calendar dates; expiry is inclusive in Asia/Ho_Chi_Minh. */
export type WorkerDocumentKind = 'SAFETY_CARD' | 'HEALTH_CERTIFICATE' | 'PERSONAL_INSURANCE';
export interface DocumentImageQuality {
  status: 'ACCEPTED' | 'RETAKE' | 'UNAVAILABLE';
  reason:
    | 'IMAGE_ACCEPTED'
    | 'IMAGE_BLURRY'
    | 'IMAGE_TOO_SMALL'
    | 'IMAGE_EXPOSURE'
    | 'IMAGE_INVALID'
    | 'PDF_TOO_MANY_PAGES'
    | 'OCR_ENGINE_UNAVAILABLE';
}
export interface WorkerIdentityImageResponse {
  id: string;
  side: 'FRONT' | 'BACK';
  mediaType: 'image/jpeg' | 'image/png';
  originalName: string;
  uploadedAt: string;
  identityCheck?: WorkerDocumentIdentityCheck;
}
export type WorkerDocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type WorkerDocumentNotificationEvent =
  | 'DOCUMENT_SUBMITTED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'DOCUMENT_EXPIRING'
  | 'DOCUMENT_EXPIRED';
export interface DocumentOcrResult {
  status: 'READ' | 'UNREADABLE' | 'UNAVAILABLE';
  issuedOn: string | null;
  expiresOn: string | null;
  /** Optional for compatibility with an OCR service deployed before ID extraction. */
  nationalIds?: string[];
  /** Technical hints only. A Safety Officer confirms dates against the original. */
  warnings: string[];
}
export interface WorkerDocumentIdentityCheck {
  status: 'MATCH' | 'MISMATCH' | 'NOT_DETECTED' | 'UNAVAILABLE' | 'NO_REFERENCE';
  detectedNationalIds: string[];
}
export interface WorkerDocumentDateCheck {
  status: 'MATCH' | 'MISMATCH' | 'UNAVAILABLE' | 'NO_REFERENCE';
  field: 'ISSUED_ON' | 'EXPIRES_ON';
  submittedDate: string | null;
  detectedDate: string | null;
}
export interface WorkerDocumentCheckResponse {
  quality: DocumentImageQuality;
  ocr: DocumentOcrResult | null;
  dateCheck: WorkerDocumentDateCheck;
}
export interface WorkerDocumentResponse {
  id: string;
  workerId: string;
  kind: WorkerDocumentKind;
  status: WorkerDocumentStatus;
  originalName: string;
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
  ocr: DocumentOcrResult;
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedAt: string;
  /** Worker/Representative proposal only; does not grant or extend approved validity. */
  submittedExpiresOn?: string | null;
  /** Health certificate issue/examination date supplied for Safety confirmation. */
  submittedIssuedOn?: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  version: number;
  /** Advisory only: never blocks submission or Safety approval. */
  identityCheck?: WorkerDocumentIdentityCheck;
  /** Technical comparison only; Safety still confirms the original and approved dates. */
  dateCheck?: WorkerDocumentDateCheck;
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
}
export interface WorkerComplianceResponse {
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
  reviewNote: string;
}
export interface UploadWorkerDocumentCommand {
  submittedExpiresOn?: string;
  submittedIssuedOn?: string;
}
export interface UpdateWorkerDocumentExpiryCommand {
  expectedVersion: number;
  submittedExpiresOn?: string | null;
  submittedIssuedOn?: string | null;
}
