import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '@smartsite/api-client';

/** Lives inside the panel's existing token/session/Site keyed boundary. */
export function useCameraRegionMutationScope(selectedCameraId: string) {
  const [accountError, setAccountError] = useState<ApiError | null>(null);
  const [unavailableCameraIds, setUnavailableCameraIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const error = useMemo(() => {
    if (accountError) return accountError;
    return selectedCameraId && unavailableCameraIds.has(selectedCameraId)
      ? new ApiError('http', 'Camera configuration scope revoked.', 404)
      : null;
  }, [accountError, selectedCameraId, unavailableCameraIds]);
  const revoke = useCallback((status: number, cameraId: string) => {
    if (status === 401 || status === 403) {
      setAccountError(new ApiError('http', 'Camera configuration scope revoked.', status));
    } else if (status === 404 && cameraId) {
      setUnavailableCameraIds((previous) => {
        if (previous.has(cameraId)) return previous;
        const next = new Set(previous);
        next.add(cameraId);
        return next;
      });
    }
  }, []);
  return { error, revoke };
}
