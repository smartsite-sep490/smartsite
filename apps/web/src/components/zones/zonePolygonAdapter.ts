import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type { NormalizedPoint } from '../cameras/monitoringUtils';

export type CameraResponse = Awaited<ReturnType<SmartSiteManagementClient['getCamera']>>;
export type RegionResponse = Awaited<ReturnType<SmartSiteManagementClient['getRegion']>>;
export type RegionMutationResponse = Awaited<ReturnType<SmartSiteManagementClient['updatePolygon']>>;

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
  points: NormalizedPoint[],
): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const key = getDraftStorageKey(siteId, cameraId, regionId);
    storage.setItem(key, JSON.stringify(points));
  } catch {
    // Ignore browser storage write failures
  }
}

export function loadLocalDraft(
  siteId: string,
  cameraId: string,
  regionId: string = 'default',
): NormalizedPoint[] | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const key = getDraftStorageKey(siteId, cameraId, regionId);
    const item = storage.getItem(key);
    if (!item) return null;

    const parsed = JSON.parse(item) as unknown;
    if (Array.isArray(parsed) && parsed.length >= 3 && parsed.every(isValidCoordinatePair)) {
      return parsed.map(([x, y]) => [x, y]);
    }
  } catch {
    // Ignore storage parse errors
  }
  return null;
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
  backendPolygon,
  fallback = DEFAULT_ZONE_POLYGON,
}: {
  siteId?: string;
  cameraId?: string;
  regionId?: string;
  backendPolygon?: unknown;
  fallback?: NormalizedPoint[];
}): ResolvedPolygonState {
  if (siteId && cameraId) {
    const draft = loadLocalDraft(siteId, cameraId, regionId);
    if (draft) {
      return {
        points: draft,
        isDraft: true,
        isAuthoritative: false,
      };
    }
  }

  const authoritativePoints = backendPolygonToPoints(backendPolygon, fallback);
  return {
    points: authoritativePoints,
    isDraft: false,
    isAuthoritative: true,
  };
}
