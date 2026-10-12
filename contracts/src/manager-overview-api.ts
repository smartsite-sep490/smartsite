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
  teams: { id: string; name: string; workerCount: number }[];
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
