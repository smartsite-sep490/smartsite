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
/** Inclusive local calendar dates; Backend converts and bounds the permission to participation. */
export interface GrantContractorZoneDatesCommand {
  requestId: string;
  siteContractorId: string;
  zoneId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}
export interface GrantWorkerZoneCommand {
  requestId: string;
  workerAssignmentId: string;
  contractorZonePermissionId: string;
  validFrom: string;
  validUntil: string;
}
