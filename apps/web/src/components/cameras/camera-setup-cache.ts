import type { QueryClient } from '@tanstack/react-query';
import type { CameraResponse } from '@smartsite/contracts/management';

export function refreshCameraSetupCaches(
  cache: QueryClient,
  setupKey: readonly unknown[],
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  cameraId?: string,
): void {
  void cache
    .invalidateQueries({ queryKey: [...setupKey, siteId, 'cameras'] })
    .catch(() => undefined);
  void cache
    .invalidateQueries({ queryKey: [...setupKey, siteId, 'selected-camera'] })
    .catch(() => undefined);
  void cache
    .invalidateQueries({
      // Region metadata owns a separate opaque credential nonce.
      // Invalidate the exact Site/session family rather than guessing that nonce.
      predicate: ({ queryKey: qk }) =>
        qk[0] === 'ppe-monitoring' &&
        qk[1] === apiUrl &&
        qk[2] === sessionScope &&
        qk[4] === siteId &&
        (qk[5] === 'cameras-for-region' ||
          qk[5] === 'zones' ||
          (qk[5] === 'cameras' &&
            (qk.length === 6 ||
              qk[6] === 'pages' ||
              (Boolean(cameraId) && qk[6] === cameraId && qk[7] === 'regions')))),
    })
    .catch(() => undefined);
  void cache
    .invalidateQueries({
      queryKey: ['zone-admin', apiUrl, sessionScope, siteId],
    })
    .catch(() => undefined);
}

export function publishUpdatedSetupCamera(
  cache: QueryClient,
  setupKey: readonly unknown[],
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  updatedCamera: CameraResponse,
): void {
  const camerasKey = [...setupKey, siteId, 'cameras'];
  const selectedLookupKey = [...setupKey, siteId, 'selected-camera', updatedCamera.id];
  void cache.cancelQueries({ queryKey: camerasKey });
  void cache.cancelQueries({ queryKey: selectedLookupKey });
  cache.setQueriesData<{
    pages: { items: CameraResponse[]; total: number }[];
    pageParams: unknown[];
  }>({ queryKey: camerasKey }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              row.id === updatedCamera.id &&
              row.siteId === updatedCamera.siteId &&
              row.configurationVersion <= updatedCamera.configurationVersion
                ? updatedCamera
                : row,
            ),
          })),
        }
      : data,
  );
  cache.setQueriesData<CameraResponse>({ queryKey: selectedLookupKey }, (current) =>
    current &&
    current.id === updatedCamera.id &&
    current.siteId === updatedCamera.siteId &&
    current.configurationVersion <= updatedCamera.configurationVersion
      ? updatedCamera
      : current,
  );
  refreshCameraSetupCaches(cache, setupKey, apiUrl, sessionScope, siteId, updatedCamera.id);
}
