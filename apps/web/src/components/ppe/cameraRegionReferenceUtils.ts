import { useLayoutEffect, useMemo, useState } from 'react';
import { ApiError } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { TranslationKey } from '../../i18n/ppe-locale';
import { getEffectiveExpiryMs } from './cameraConfigurationReferenceHelpers';
import type { NormalizedPoint } from './region-polygon-geometry';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

export class LocalRegionValidationError extends Error {
  readonly errorKey: TranslationKey;

  constructor(errorKey: TranslationKey) {
    super(errorKey);
    this.name = 'LocalRegionValidationError';
    this.errorKey = errorKey;
  }
}

export interface EditingRegionScope {
  id: string;
  version: number;
  expectedConfigurationVersion: number;
  initialPoints: NormalizedPoint[];
}

export function isConfigurationReferenceScopeMatched(
  reference: CameraConfigurationReference | null | undefined,
  siteId: string,
  camera: CameraResponse | null | undefined,
): reference is CameraConfigurationReference {
  if (!reference || !camera) return false;
  return (
    reference.siteId.trim().toLowerCase() === siteId.trim().toLowerCase() &&
    reference.cameraId.trim().toLowerCase() === camera.id.trim().toLowerCase() &&
    reference.frame.cameraExternalId === camera.externalId &&
    Number.isSafeInteger(reference.configurationVersion) &&
    reference.configurationVersion >= 1
  );
}

export function isConfigurationReferenceExpiredAt(
  reference: CameraConfigurationReference | null | undefined,
  currentTimeMs: number,
): boolean {
  if (!reference) return true;
  const effectiveExpiryMs = getEffectiveExpiryMs(reference);
  return !Number.isFinite(effectiveExpiryMs) || currentTimeMs >= effectiveExpiryMs;
}

export function isSameConfigurationReference(
  a: CameraConfigurationReference | null | undefined,
  b: CameraConfigurationReference | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.siteId === b.siteId &&
    a.cameraId === b.cameraId &&
    a.configurationVersion === b.configurationVersion &&
    a.referenceExpiresAt === b.referenceExpiresAt &&
    a.frame.sessionId === b.frame.sessionId &&
    a.frame.sequenceNumber === b.frame.sequenceNumber &&
    a.frame.capturedAt === b.frame.capturedAt &&
    a.frame.imageSha256 === b.frame.imageSha256
  );
}

export function getConfigurationReferenceIdentity(
  reference: CameraConfigurationReference | null | undefined,
): string {
  if (!reference) return '';
  return [
    reference.siteId,
    reference.cameraId,
    reference.configurationVersion,
    reference.referenceExpiresAt,
    reference.frame.sessionId,
    reference.frame.sequenceNumber,
    reference.frame.capturedAt,
    reference.frame.imageSha256,
  ].join('|');
}

export function useConfigurationReferenceExpired(
  reference: CameraConfigurationReference | null | undefined,
): boolean {
  const refKey = getConfigurationReferenceIdentity(reference);
  const effectiveExpiryMs = useMemo(
    () => (reference ? getEffectiveExpiryMs(reference) : Number.NEGATIVE_INFINITY),
    [reference],
  );
  const [expiredRefKey, setExpiredRefKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!reference || !refKey || expiredRefKey === refKey) return;
    const expire = () => {
      setExpiredRefKey(refKey);
    };
    if (!Number.isFinite(effectiveExpiryMs)) return expire();
    const remainingMs = effectiveExpiryMs - Date.now();
    if (remainingMs <= 0) return expire();
    const timer = setTimeout(expire, remainingMs);

    return () => clearTimeout(timer);
  });

  if (!reference || !Number.isFinite(effectiveExpiryMs)) {
    return true;
  }
  return expiredRefKey === refKey;
}

export function getConfigurationReferenceErrorMessage(
  err: ApiError | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string | null {
  if (!err) return null;
  if (err.code === 'timeout') return t('regionSetup.reference.error.timeout');
  if (err.status === 401) return t('regionSetup.reference.error.401');
  if (err.status === 403) return t('regionSetup.reference.error.403');
  if (err.status === 404) return t('regionSetup.reference.error.404');
  if (err.status === 409) return t('regionSetup.reference.error.409');
  if (err.status === 429) return t('regionSetup.reference.error.429');
  if (err.status === 503) return t('regionSetup.reference.error.503');
  return t('regionSetup.reference.error.default');
}
