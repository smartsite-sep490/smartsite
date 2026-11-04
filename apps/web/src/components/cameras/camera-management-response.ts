import { ApiError } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { CameraManagementCopyKey } from './camera-management-copy';

export function validCreatedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parseRenameCameraResponse(
  value: unknown,
  expected: {
    id: string;
    siteId: string;
    code: string;
    externalId: string;
    currentVersion: number;
  },
  requestedName: string,
): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    row.name !== requestedName ||
    (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) < expected.currentVersion ||
    (row.configurationVersion ?? 0) < 1 ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

export function parseSetStatusCameraResponse(
  value: unknown,
  expected: {
    id: string;
    siteId: string;
    code: string;
    externalId: string;
    currentVersion: number;
    targetStatus: 'ACTIVE' | 'INACTIVE';
  },
): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    row.status !== expected.targetStatus ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) <= expected.currentVersion ||
    (row.configurationVersion ?? 0) < 1 ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

export function parseRefreshCameraResponse(
  value: unknown,
  expected: CameraResponse,
): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) < expected.configurationVersion ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

export function validateCameraNameKey(name: string): CameraManagementCopyKey | null {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 255 || /[\p{Cc}\p{Cs}]/u.test(trimmed)) {
    return 'cameraSetup.register.validation.name';
  }
  return null;
}

export function publicManagementErrorKey(error: unknown): CameraManagementCopyKey {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'cameraSetup.manage.error.401';
    if (error.status === 403) return 'cameraSetup.manage.error.403';
    if (error.status === 404) return 'cameraSetup.manage.error.404';
    if (error.status === 400) return 'cameraSetup.manage.error.400';
    if (error.status === 409) return 'cameraSetup.manage.error.409';
    if (error.status === 429) return 'cameraSetup.manage.error.429';
  }
  return 'cameraSetup.manage.error.default';
}
