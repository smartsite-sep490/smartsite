export type UserRole = 'ADMIN' | 'WORKER';

export interface AccountResponse {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: AccountResponse;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface SiteResponse {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface CameraResponse {
  id: string;
  siteId: string;
  externalId: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  configurationVersion: number;
  createdAt: string;
}

export interface ZoneResponse {
  id: string;
  siteId: string;
  code: string;
  name: string;
  type: 'STANDARD' | 'RESTRICTED' | 'HAZARDOUS';
  restrictionPolicy: 'NONE' | 'PROHIBITED_FOR_ALL' | 'AUTHORIZATION_REQUIRED';
  requiredPpe: string[];
  configurationLocked: boolean;
  createdAt: string;
}

export interface RegionResponse {
  id: string;
  cameraId: string;
  zoneId: string;
  polygon: unknown;
  coordinateSpace: 'NORMALIZED_0_1';
  version: number;
  isActive: boolean;
  createdAt: string;
}

export interface RegionMutationResponse {
  region: RegionResponse;
  configurationVersion: number;
}
