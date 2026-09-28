import type {
  AccountResponse,
  AuthClientType,
  CameraResponse,
  LoginResponse,
  Page,
  ProvisionableRoleAssignment,
  RegionMutationResponse,
  RegionResponse,
  SafetyAlertDetailResponse,
  SafetyAlertResponse,
  SafetyAlertStatus,
  SafetyAlertType,
  SiteResponse,
  ZoneResponse,
  WorkerResponse,
  ZoneAccessEffect,
  ZoneAccessGrantResponse,
  ZoneEntryDecisionResponse,
  ZoneEntryDecisionStatus,
} from '@smartsite/contracts';
import { ApiError, parseBackendErrorEnvelope } from './index';

type PageOptions = { offset?: number; limit?: number };
export type SafetyAlertListOptions = PageOptions & {
  status?: SafetyAlertStatus;
  type?: SafetyAlertType;
};
export type ZoneEntryDecisionListOptions = PageOptions & {
  zoneId?: string;
  status?: ZoneEntryDecisionStatus;
};
type CameraMutation = { expectedConfigurationVersion: number };
const pathId = (id: string) => encodeURIComponent(id);

export class SmartSiteManagementClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    credentials?: RequestCredentials,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(credentials ? { credentials } : {}),
      });
    } catch {
      throw new ApiError('network', 'Could not connect to the backend.');
    }
    if (response.status === 204) return undefined as T;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
    }
    if (!response.ok) {
      const error = parseBackendErrorEnvelope(payload, response.status);
      throw new ApiError(
        'http',
        error?.message ?? `Backend returned HTTP ${response.status}.`,
        response.status,
        error,
      );
    }
    return payload as T;
  }

  private listPath(path: string, options: PageOptions = {}) {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return `${path}${query.size ? `?${query}` : ''}`;
  }

  login(username: string, password: string, clientType: AuthClientType = 'WEB') {
    return this.request<LoginResponse>(
      'POST',
      '/auth/login',
      undefined,
      { username, password, clientType },
      clientType === 'WEB' ? 'include' : undefined,
    );
  }
  refresh(clientType: AuthClientType, refreshToken?: string) {
    return this.request<LoginResponse>(
      'POST',
      '/auth/refresh',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
    );
  }
  me(token: string) {
    return this.request<AccountResponse>('GET', '/auth/me', token);
  }
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return this.request<void>('POST', '/auth/change-password', token, {
      currentPassword,
      newPassword,
    });
  }
  logout(clientType: AuthClientType = 'WEB', refreshToken?: string) {
    return this.request<void>(
      'POST',
      '/auth/logout',
      undefined,
      { clientType, ...(refreshToken ? { refreshToken } : {}) },
      clientType === 'WEB' ? 'include' : undefined,
    );
  }

  createUser(
    token: string,
    input: {
      username: string;
      displayName: string;
      roleAssignments: ProvisionableRoleAssignment[];
      temporaryPassword: string;
    },
  ) {
    return this.request<AccountResponse>('POST', '/users', token, input);
  }
  replaceUserRoleAssignments(
    token: string,
    userId: string,
    roleAssignments: ProvisionableRoleAssignment[],
  ) {
    return this.request<AccountResponse>(
      'PUT',
      `/users/${pathId(userId)}/role-assignments`,
      token,
      { roleAssignments },
    );
  }
  listUsers(token: string, options?: PageOptions) {
    return this.request<Page<AccountResponse>>('GET', this.listPath('/users', options), token);
  }
  getUser(token: string, userId: string) {
    return this.request<AccountResponse>('GET', `/users/${pathId(userId)}`, token);
  }
  setUserActive(token: string, userId: string, isActive: boolean) {
    return this.request<AccountResponse>('PATCH', `/users/${pathId(userId)}/status`, token, {
      isActive,
    });
  }
  resetUserPassword(token: string, userId: string, temporaryPassword: string) {
    return this.request<void>('POST', `/users/${pathId(userId)}/reset-password`, token, {
      temporaryPassword,
    });
  }

  createSite(token: string, input: { code: string; name: string }) {
    return this.request<SiteResponse>('POST', '/sites', token, input);
  }
  listSites(token: string, options?: PageOptions) {
    return this.request<Page<SiteResponse>>('GET', this.listPath('/sites', options), token);
  }
  getSite(token: string, siteId: string) {
    return this.request<SiteResponse>('GET', `/sites/${pathId(siteId)}`, token);
  }
  listSafetyAlerts(token: string, siteId: string, options: SafetyAlertListOptions = {}) {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.status !== undefined) query.set('status', options.status);
    if (options.type !== undefined) query.set('type', options.type);
    const path = `/sites/${pathId(siteId)}/safety-alerts`;
    return this.request<Page<SafetyAlertResponse>>(
      'GET',
      `${path}${query.size ? `?${query}` : ''}`,
      token,
    );
  }
  getSafetyAlert(token: string, siteId: string, alertId: string) {
    return this.request<SafetyAlertDetailResponse>(
      'GET',
      `/sites/${pathId(siteId)}/safety-alerts/${pathId(alertId)}`,
      token,
    );
  }
  renameSite(token: string, siteId: string, name: string) {
    return this.request<SiteResponse>('PATCH', `/sites/${pathId(siteId)}`, token, { name });
  }

  createWorker(token: string, siteId: string, input: { externalId: string; displayName: string }) {
    return this.request<WorkerResponse>('POST', `/sites/${pathId(siteId)}/workers`, token, input);
  }
  listWorkers(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<WorkerResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/workers`, options),
      token,
    );
  }

  createZoneAccessGrant(
    token: string,
    siteId: string,
    zoneId: string,
    input: {
      workerId: string;
      effect: ZoneAccessEffect;
      validFrom: string;
      validUntil: string | null;
    },
  ) {
    return this.request<ZoneAccessGrantResponse>(
      'POST',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants`,
      token,
      input,
    );
  }
  listZoneAccessGrants(token: string, siteId: string, zoneId: string, options?: PageOptions) {
    return this.request<Page<ZoneAccessGrantResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants`, options),
      token,
    );
  }
  revokeZoneAccessGrant(token: string, siteId: string, zoneId: string, grantId: string) {
    return this.request<ZoneAccessGrantResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/access-grants/${pathId(grantId)}/revoke`,
      token,
    );
  }
  listZoneEntryDecisions(
    token: string,
    siteId: string,
    options: ZoneEntryDecisionListOptions = {},
  ) {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.zoneId !== undefined) query.set('zoneId', options.zoneId);
    if (options.status !== undefined) query.set('status', options.status);
    const path = `/sites/${pathId(siteId)}/zone-entry-decisions`;
    return this.request<Page<ZoneEntryDecisionResponse>>(
      'GET',
      `${path}${query.size ? `?${query}` : ''}`,
      token,
    );
  }

  createCamera(
    token: string,
    siteId: string,
    input: { code: string; externalId: string; name: string },
  ) {
    return this.request<CameraResponse>('POST', `/sites/${pathId(siteId)}/cameras`, token, input);
  }
  listCameras(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<CameraResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras`, options),
      token,
    );
  }
  getCamera(token: string, siteId: string, cameraId: string) {
    return this.request<CameraResponse>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}`,
      token,
    );
  }
  renameCamera(token: string, siteId: string, cameraId: string, name: string) {
    return this.request<CameraResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}`,
      token,
      { name },
    );
  }
  setCameraStatus(
    token: string,
    siteId: string,
    cameraId: string,
    input: CameraMutation & { status: 'ACTIVE' | 'INACTIVE' },
  ) {
    return this.request<CameraResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/status`,
      token,
      input,
    );
  }

  createZone(
    token: string,
    siteId: string,
    input: {
      code: string;
      name: string;
      type: ZoneResponse['type'];
      restrictionPolicy: ZoneResponse['restrictionPolicy'];
      requiredPpe: string[];
    },
  ) {
    return this.request<ZoneResponse>('POST', `/sites/${pathId(siteId)}/zones`, token, input);
  }
  listZones(token: string, siteId: string, options?: PageOptions) {
    return this.request<Page<ZoneResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/zones`, options),
      token,
    );
  }
  getZone(token: string, siteId: string, zoneId: string) {
    return this.request<ZoneResponse>(
      'GET',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}`,
      token,
    );
  }
  renameZone(token: string, siteId: string, zoneId: string, name: string) {
    return this.request<ZoneResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}`,
      token,
      { name },
    );
  }
  updateZonePolicy(
    token: string,
    siteId: string,
    zoneId: string,
    input: {
      type: ZoneResponse['type'];
      restrictionPolicy: ZoneResponse['restrictionPolicy'];
      requiredPpe: string[];
    },
  ) {
    return this.request<ZoneResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/zones/${pathId(zoneId)}/policy`,
      token,
      input,
    );
  }

  createRegion(
    token: string,
    siteId: string,
    cameraId: string,
    input: CameraMutation & { zoneId: string; polygon: unknown },
  ) {
    return this.request<RegionMutationResponse>(
      'POST',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`,
      token,
      input,
    );
  }
  listRegions(token: string, siteId: string, cameraId: string, options?: PageOptions) {
    return this.request<Page<RegionResponse>>(
      'GET',
      this.listPath(`/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions`, options),
      token,
    );
  }
  getRegion(token: string, siteId: string, cameraId: string, regionId: string) {
    return this.request<RegionResponse>(
      'GET',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}`,
      token,
    );
  }
  updatePolygon(
    token: string,
    siteId: string,
    cameraId: string,
    regionId: string,
    input: CameraMutation & { polygon: unknown },
  ) {
    return this.request<RegionMutationResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}/polygon`,
      token,
      input,
    );
  }
  setRegionActive(
    token: string,
    siteId: string,
    cameraId: string,
    regionId: string,
    input: CameraMutation & { isActive: boolean },
  ) {
    return this.request<RegionMutationResponse>(
      'PATCH',
      `/sites/${pathId(siteId)}/cameras/${pathId(cameraId)}/regions/${pathId(regionId)}/status`,
      token,
      input,
    );
  }
}
