export interface ContractorDashboardScope {
  siteId: string;
  siteName: string;
  siteCode: string;
  contractorId: string;
  contractorName: string;
}
export interface ContractorTeamResponse {
  id: string;
  siteId: string;
  contractorId: string;
  name: string;
  description: string;
  isActive: boolean;
  version: number;
  memberCount: number;
}
export interface ContractorDashboardResponse {
  scope: ContractorDashboardScope;
  workerCount: number;
  teamCount: number;
  unassignedWorkerCount: number;
}
export interface ContractorTeamWorkerResponse {
  workerId: string;
  displayName: string;
  membershipId: string | null;
  teamId: string | null;
  teamName: string | null;
}
export interface ContractorTeamQuery {
  offset?: number;
  limit?: number;
  search?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
}
export interface ContractorTeamWorkersQuery {
  offset?: number;
  limit?: number;
  search?: string;
  teamId?: string;
  unassigned?: boolean;
}
export interface CreateContractorTeamCommand {
  requestId: string;
  name: string;
  description?: string;
}
export interface UpdateContractorTeamCommand {
  expectedVersion: number;
  name: string;
  description: string;
}
export interface ArchiveContractorTeamCommand {
  expectedVersion: number;
  reason: string;
}
export interface AssignContractorTeamCommand {
  requestId: string;
  expectedMembershipId: string | null;
  teamId: string | null;
  /** Required when transferring or removing an existing membership. */
  reason?: string;
}
