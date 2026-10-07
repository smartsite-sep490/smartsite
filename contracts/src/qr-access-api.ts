import type { FaceGateVerificationResponse, GateAccessLogResponse } from './identity-access-api.js';
export interface CreateVisitCommand {
  requestId: string;
  accessKey: string;
  visitorName: string;
  company: string;
  contact: string;
  hostName: string;
  purpose: string;
  targetArea: string;
  groupSize: number;
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
  hostName: string;
  purpose: string;
  targetArea: string;
  groupSize: number;
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
  expiresAt: string;
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
  /** Legacy clients may send the complete approved headcount; partial groups are rejected. */
  count?: number;
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
}
