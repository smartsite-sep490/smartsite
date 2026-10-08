export interface AccessSetupResponse {
  canReviewAssignments: boolean;
  canGrantContractorZones: boolean;
  canGrantWorkerZones: boolean;
  participations: Array<{
    id: string;
    contractorId: string;
    name: string;
    validFrom: string;
    validUntil: string | null;
  }>;
  workers: Array<{ id: string; name: string; contractorId: string | null }>;
  zones: Array<{ id: string; name: string }>;
  assignments: Array<{
    id: string;
    workerId: string;
    workerName: string;
    siteContractorId: string | null;
    status: string;
    validFrom: string;
    validUntil: string | null;
    version: number;
    reviewNote: string | null;
  }>;
  contractorPermissions: Array<{
    id: string;
    siteContractorId: string;
    zoneId: string;
    validFrom: string;
    validUntil: string;
    revokedAt: string | null;
  }>;
  workerPermissions: Array<{
    id: string;
    workerAssignmentId: string;
    contractorZonePermissionId: string;
    validFrom: string;
    validUntil: string;
    revokedAt: string | null;
  }>;
}
export interface GrantContractorZoneCommand {
  requestId: string;
  siteContractorId: string;
  zoneId: string;
  validFrom: string;
  validUntil: string;
}
export interface GrantWorkerZoneCommand {
  requestId: string;
  workerAssignmentId: string;
  contractorZonePermissionId: string;
  validFrom: string;
  validUntil: string;
}
