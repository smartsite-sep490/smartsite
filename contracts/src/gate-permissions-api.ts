/** Fixed local gate catalog shared by configuration and Gate Desk. */
export const SITE_GATES = [
  { id: 'gate-north-01', name: 'Gate 1 — Main North Entrance' },
  { id: 'gate-west-02', name: 'Gate 2 — West Turnstile' },
  { id: 'gate-logistics-03', name: 'Gate 3 — Logistics & Vehicles' },
] as const;

export interface WorkerGatePermissionResponse {
  id: string;
  gateId: string;
  validFrom: string;
  validUntil: string | null;
}
export interface WorkerGatePermissionsResponse {
  workerId: string;
  items: WorkerGatePermissionResponse[];
}
export interface SetWorkerGatePermissionsCommand {
  gateIds: string[];
  /** Compare-and-set token: all unrevoked IDs returned by the latest read. */
  expectedPermissionIds: string[];
}
