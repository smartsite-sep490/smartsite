export interface ManagerContractorSummary {
  id: string;
  code: string;
  name: string;
  teamCount: number;
  workerCount: number;
}
export interface ManagerOverviewResponse {
  site: { id: string; code: string; name: string };
  contractorCount: number;
  zoneCount: number;
  teamCount: number;
  workerCount: number;
  contractors: { items: ManagerContractorSummary[]; total: number };
}
export interface ManagerContractorDetailResponse extends ManagerContractorSummary {
  date: string;
  timezone: string;
  teams: {
    id: string;
    name: string;
    workerCount: number;
    /** Unrevoked team grants overlapping the selected local day. Optional for older servers. */
    zoneAssignments?: ManagerTeamZoneAssignment[];
  }[];
  zones: { id: string; name: string; code: string; validFrom: string; validUntil: string }[];
  scheduledTeams: {
    id: string;
    name: string;
    workerCount: number;
    shifts: { id: string; name: string; startsAt: string; endsAt: string; timezone: string }[];
  }[];
  scheduledWorkerCount: number;
  scheduledWorkersWithoutTeam: number;
}

export interface ManagerTeamZoneAssignment {
  id: string;
  zoneId: string;
  name: string;
  code: string;
  validFrom: string;
  validUntil: string;
}

export interface GlobalContractorSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ContractorParticipationListResponse {
  contractor: GlobalContractorSummary;
  items: {
    id: string;
    site: { id: string; code: string; name: string };
    validFrom: string;
    validUntil: string | null;
    isActive: boolean;
    status: 'ACTIVE' | 'INACTIVE' | 'FUTURE' | 'EXPIRED';
  }[];
  /** Counts participation intervals, not distinct Sites. */
  total: number;
}
