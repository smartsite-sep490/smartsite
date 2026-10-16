import type { FaceGateVerificationResponse, GateAccessLogResponse } from './identity-access-api.js';
export interface VisitorMemberInput {
  fullName: string;
  identityNumber: string;
}
export interface VisitorMemberResponse extends VisitorMemberInput {
  id: string;
  inside: boolean;
  registeredFullName: string;
  registeredIdentityNumber: string;
}
export interface VisitorAttendanceInput extends VisitorMemberInput {
  memberId: string;
}
export interface VisitorAttendanceResponse extends VisitorAttendanceInput {
  replacedFrom?: VisitorMemberInput;
}
export interface VisitorQrPreviewResponse {
  visit: VisitResponse;
  direction: 'IN' | 'OUT';
  expiresAt: string | null;
}
export interface CreateVisitCommand {
  requestId: string;
  accessKey: string;
  visitorName: string;
  company: string;
  contact: string;
  email: string;
  language?: 'en' | 'vi';
  hostName: string;
  purpose: string;
  targetArea: string;
  groupSize: number;
  /** Required for groups of two or more, including the representative if attending. */
  members?: VisitorMemberInput[];
  gateId: string;
  validFrom: string;
  validUntil: string;
  zoneIds?: string[];
}
export interface VisitResponse {
  id: string;
  siteId: string;
  visitorName: string;
  company: string;
  contact: string;
  email?: string | null;
  emailStatus?: 'NOT_REQUESTED' | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  hostName: string;
  purpose: string;
  targetArea: string;
  groupSize: number;
  members?: VisitorMemberResponse[];
  gateId: string;
  validFrom: string;
  validUntil: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  representativeVisitorId?: string;
  siteManagerId?: string;
  version?: number;
  reviewNote?: string | null;
  zoneIds?: string[];
  presence?: 'OUTSIDE' | 'INSIDE' | 'NEEDS_REVIEW';
  enteredCount: number;
  exitedCount: number;
  createdAt: string;
  decidedByUserId: string | null;
}
export interface QrPassResponse {
  token: string;
  /** Visitor codes have no token expiry; approval and visit schedule still apply. */
  expiresAt: string | null;
  direction?: 'IN' | 'OUT';
}
export interface VisitorPassResponse {
  visit: VisitResponse;
  pass: QrPassResponse | null;
}
export interface QrFallbackResponse {
  id: string;
  siteId: string;
  gateId: string;
  direction: 'IN' | 'OUT';
  expiresAt: string;
}
export interface VerifyQrCommand {
  token: string;
  direction: 'IN' | 'OUT';
  requestId: string;
}
export interface VisitorGateCommand extends VerifyQrCommand {
  /** Legacy visits without a roster retain whole-group confirmation. */
  count?: number;
  expectedVersion?: number;
  attendees?: VisitorAttendanceInput[];
}
export interface WorkerQrVerificationResponse {
  attempt?: import('./access-flow-api.js').AccessAttemptResponse;
  authorization: 'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW';
  reasonCode: string;
  worker: NonNullable<FaceGateVerificationResponse['worker']>;
  log: GateAccessLogResponse;
}
export interface VisitorGateEventResponse {
  id: string;
  visitId: string;
  gateId: string;
  direction: 'IN' | 'OUT';
  count: number;
  createdAt: string;
  visit: VisitResponse;
  attendees?: VisitorAttendanceResponse[];
}
