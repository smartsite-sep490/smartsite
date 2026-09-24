import type {
  AccountResponse,
  CameraResponse,
  LoginResponse,
  Page,
  RegionMutationResponse,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts';
import { ApiError, parseBackendErrorEnvelope } from './index';

type PageOptions = { offset?: number; limit?: number };
type CameraMutation = { expectedConfigurationVersion: number };
const pathId = (id: string) => encodeURIComponent(id);

export class SmartSiteManagementClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
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

  login(username: string, password: string) {
    return this.request<LoginResponse>('POST', '/auth/login', undefined, { username, password });
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
  logout(token: string) {
    return this.request<void>('POST', '/auth/logout', token);
  }

  createUser(
    token: string,
    input: {
      username: string;
      displayName: string;
      role: 'ADMIN' | 'WORKER';
      temporaryPassword: string;
    },
  ) {
    return this.request<AccountResponse>('POST', '/users', token, input);
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
  renameSite(token: string, siteId: string, name: string) {
    return this.request<SiteResponse>('PATCH', `/sites/${pathId(siteId)}`, token, { name });
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
