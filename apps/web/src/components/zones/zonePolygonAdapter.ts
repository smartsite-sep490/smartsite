import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type { NormalizedPoint } from '../cameras/monitoringUtils';

export type CameraResponse = Awaited<ReturnType<SmartSiteManagementClient['getCamera']>>;
export type RegionResponse = Awaited<ReturnType<SmartSiteManagementClient['getRegion']>>;
export type RegionMutationResponse = Awaited<
  ReturnType<SmartSiteManagementClient['updatePolygon']>
>;

export const DEFAULT_ZONE_POLYGON: NormalizedPoint[] = [
  [0.63, 0.2],
  [0.98, 0.2],
  [0.98, 0.9],
  [0.63, 0.9],
];

export interface ApiPolygonPayload {
  coordinates: [number, number][];
}

export interface PreparePolygonSaveResult {
  expectedConfigurationVersion: number;
  polygon: ApiPolygonPayload;
}

export interface ResolvedPolygonState {
  points: NormalizedPoint[];
  isDraft: boolean;
  isAuthoritative: boolean;
  staleDraftVersion: number | null;
}

export interface ScopedZoneDraft {
  baseConfigurationVersion: number;
  points: NormalizedPoint[];
  savedAt: string;
}

export interface LoadLocalDraftResult {
  status: 'valid' | 'stale' | 'none';
  points: NormalizedPoint[] | null;
  baseConfigurationVersion: number | null;
  staleVersion?: number;
}

export interface ResolveActivePolygonOptions {
  siteId?: string;
  cameraId?: string;
  regionId?: string;
  cameraConfigurationVersion?: number;
  backendPolygon?: unknown;
  fallback?: NormalizedPoint[];
}

export interface SavePolygonMutationVariables {
  userId: string;
  sessionScope?: string;
  token?: string;
  siteId: string;
  cameraId: string;
  regionId: string;
  cameraLabel: string;
  expectedConfigurationVersion: number;
  points: NormalizedPoint[];
}

export interface ActiveScope {
  userId: string | null;
  sessionScope?: string;
  siteId: string;
  cameraId: string;
  regionId: string;
}

export interface MutationCallbackPlan {
  invalidateSiteCamerasKey: [string, string, string, string, string];
  invalidateCameraRegionsKey: [string, string, string, string, string, string];
  draftScopeToClear: { siteId: string; cameraId: string; regionId: string };
}

function isValidCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

export function backendPolygonToPoints(
  polygon: unknown,
  fallback: NormalizedPoint[] = DEFAULT_ZONE_POLYGON,
): NormalizedPoint[] {
  if (!polygon || typeof polygon !== 'object') {
    return fallback;
  }

  const rawCoords =
    'coordinates' in polygon && Array.isArray((polygon as { coordinates: unknown }).coordinates)
      ? (polygon as { coordinates: unknown[] }).coordinates
      : Array.isArray(polygon)
        ? polygon
        : null;

  if (!rawCoords || rawCoords.length < 3) {
    return fallback;
  }

  const parsedPoints: NormalizedPoint[] = [];
  for (const item of rawCoords) {
    if (!isValidCoordinatePair(item)) {
      return fallback;
    }
    parsedPoints.push([item[0], item[1]]);
  }

  return parsedPoints;
}

export function pointsToApiPolygon(points: NormalizedPoint[]): ApiPolygonPayload {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('A polygon must have at least 3 vertices.');
  }

  const coordinates: [number, number][] = points.map(([x, y]) => [
    Math.min(1, Math.max(0, x)),
    Math.min(1, Math.max(0, y)),
  ]);

  return { coordinates };
}

export function preparePolygonSave(
  camera: Pick<CameraResponse, 'configurationVersion'>,
  points: NormalizedPoint[],
): PreparePolygonSaveResult {
  return {
    expectedConfigurationVersion: camera.configurationVersion,
    polygon: pointsToApiPolygon(points),
  };
}

export function handleSaveSuccess(
  currentCamera: CameraResponse,
  mutationResult: RegionMutationResponse,
): { updatedCamera: CameraResponse; updatedRegion: RegionResponse } {
  return {
    updatedCamera: {
      ...currentCamera,
      configurationVersion: mutationResult.configurationVersion,
    },
    updatedRegion: mutationResult.region,
  };
}

export function isConflictError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export function formatConflictMessage(cameraExternalId?: string): string {
  const cameraLabel = cameraExternalId ? `Camera ${cameraExternalId}` : 'The selected camera';
  return `Configuration conflict: ${cameraLabel} was modified by another operator or process. The latest server configuration has been reloaded.`;
}

export function getDraftStorageKey(
  siteId: string,
  cameraId: string,
  regionId: string = 'default',
): string {
  return `smartsite.restricted-zone.draft:${siteId}:${cameraId}:${regionId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Ignore access errors
  }
  return null;
}

export function saveLocalDraft(
  siteId: string,
  cameraId: string,
  regionId: string = 'default',
  baseConfigurationVersion: number,
  points: NormalizedPoint[],
): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const key = getDraftStorageKey(siteId, cameraId, regionId);
    const draft: ScopedZoneDraft = {
      baseConfigurationVersion,
      points,
      savedAt: new Date().toISOString(),
    };
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // Ignore browser storage write failures
  }
}

export function loadLocalDraft(
  siteId: string,
  cameraId: string,
  regionId: string = 'default',
  currentConfigurationVersion?: number,
): LoadLocalDraftResult {
  const emptyResult: LoadLocalDraftResult = {
    status: 'none',
    points: null,
    baseConfigurationVersion: null,
  };

  try {
    const storage = getStorage();
    if (!storage) return emptyResult;
    const key = getDraftStorageKey(siteId, cameraId, regionId);
    const item = storage.getItem(key);
    if (!item) return emptyResult;

    let parsed: unknown;
    try {
      parsed = JSON.parse(item);
    } catch {
      // Malformed JSON: reject and clean up
      storage.removeItem(key);
      return emptyResult;
    }

    // Migration-safe parsing:
    // Reject legacy unversioned array format: [[x, y], ...]
    if (Array.isArray(parsed)) {
      storage.removeItem(key);
      return emptyResult;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('baseConfigurationVersion' in parsed) ||
      !('points' in parsed)
    ) {
      storage.removeItem(key);
      return emptyResult;
    }

    const rawVersion = (parsed as { baseConfigurationVersion: unknown }).baseConfigurationVersion;
    const rawPoints = (parsed as { points: unknown }).points;

    if (
      typeof rawVersion !== 'number' ||
      !Number.isInteger(rawVersion) ||
      rawVersion < 0 ||
      !Array.isArray(rawPoints) ||
      rawPoints.length < 3 ||
      !rawPoints.every(isValidCoordinatePair)
    ) {
      // Corrupted / malformed record: reject and clean up
      storage.removeItem(key);
      return emptyResult;
    }

    const version = rawVersion;
    const points: NormalizedPoint[] = rawPoints.map(([x, y]) => [x, y]);

    // Check remote version change if currentConfigurationVersion provided
    if (currentConfigurationVersion !== undefined && version !== currentConfigurationVersion) {
      return {
        status: 'stale',
        points: null,
        baseConfigurationVersion: version,
        staleVersion: version,
      };
    }

    return {
      status: 'valid',
      points,
      baseConfigurationVersion: version,
    };
  } catch {
    return emptyResult;
  }
}

export function clearLocalDraft(
  siteId: string,
  cameraId: string,
  regionId: string = 'default',
): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const key = getDraftStorageKey(siteId, cameraId, regionId);
    storage.removeItem(key);
  } catch {
    // Ignore browser storage removal failures
  }
}

export function resolveActivePolygon({
  siteId,
  cameraId,
  regionId,
  cameraConfigurationVersion,
  backendPolygon,
  fallback = DEFAULT_ZONE_POLYGON,
}: ResolveActivePolygonOptions): ResolvedPolygonState {
  if (siteId && cameraId) {
    const draftResult = loadLocalDraft(siteId, cameraId, regionId, cameraConfigurationVersion);
    if (draftResult.status === 'valid' && draftResult.points) {
      return {
        points: draftResult.points,
        isDraft: true,
        isAuthoritative: false,
        staleDraftVersion: null,
      };
    }
    if (draftResult.status === 'stale') {
      // Remote version changed: load authoritative server polygon, never silently apply stale draft!
      const authoritativePoints = backendPolygonToPoints(backendPolygon, fallback);
      return {
        points: authoritativePoints,
        isDraft: false,
        isAuthoritative: true,
        staleDraftVersion: draftResult.staleVersion ?? null,
      };
    }
  }

  const authoritativePoints = backendPolygonToPoints(backendPolygon, fallback);
  return {
    points: authoritativePoints,
    isDraft: false,
    isAuthoritative: true,
    staleDraftVersion: null,
  };
}

export function isMutationScopeActive(
  activeScope: ActiveScope | null | undefined,
  variables: SavePolygonMutationVariables,
): boolean {
  if (!activeScope || !activeScope.userId) return false;
  if (variables.sessionScope) {
    if (!activeScope.sessionScope || activeScope.sessionScope !== variables.sessionScope) {
      return false;
    }
  }
  return (
    activeScope.userId === variables.userId &&
    activeScope.siteId === variables.siteId &&
    activeScope.cameraId === variables.cameraId &&
    activeScope.regionId === variables.regionId
  );
}

export function planMutationCompletion(
  apiUrl: string,
  variables: SavePolygonMutationVariables,
): MutationCallbackPlan {
  const scopeKey = variables.sessionScope || variables.userId;
  return {
    invalidateSiteCamerasKey: ['zone-admin', apiUrl, scopeKey, variables.siteId, 'cameras'],
    invalidateCameraRegionsKey: [
      'zone-admin',
      apiUrl,
      scopeKey,
      variables.siteId,
      variables.cameraId,
      'regions',
    ],
    draftScopeToClear: {
      siteId: variables.siteId,
      cameraId: variables.cameraId,
      regionId: variables.regionId,
    },
  };
}
