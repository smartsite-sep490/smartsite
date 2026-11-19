export type GateStatus = 'ACTIVE' | 'INACTIVE';
export interface GateResponse {
  id: string;
  siteId: string;
  code: string;
  name: string;
  status: GateStatus;
}
export interface GatePageResponse {
  items: GateResponse[];
  total: number;
}
export interface CreateGateCommand {
  /** Omit to generate a code on the Backend; explicit codes remain compatible with older clients. */
  code?: string;
  name: string;
}
export interface UpdateGateCommand {
  name?: string;
  status?: GateStatus;
}
export interface GateSourceResponse {
  id: string;
  gateId: string;
  siteId: string;
  code: string;
  name: string;
}
export interface PublicGateResponse {
  id: string;
  code: string;
  name: string;
}
