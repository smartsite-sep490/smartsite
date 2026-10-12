export interface AccessAttemptResponse {
  id: string;
  status: 'PENDING' | 'READY' | 'DENIED' | 'USED' | 'EXPIRED';
  scheduleStatus: string;
  expiresAt: string;
}
export interface ConfirmPassageCommand {
  idempotencyKey: string;
  reviewNote?: string;
  /** Explicitly confirm a distinct physical passage despite the same last direction. */
  separatePassage?: boolean;
}
export interface ManualWorkerVerificationCommand {
  requestId: string;
  workerId: string;
  direction: 'IN' | 'OUT';
  identityConfirmed: true;
  reviewNote: string;
}
export interface GateEventResponse {
  id: string;
  accessAttemptId: string;
  siteId: string;
  workerId: string | null;
  visitId: string | null;
  direction: 'IN' | 'OUT';
  occurredAt: string;
  gateName: string;
}
