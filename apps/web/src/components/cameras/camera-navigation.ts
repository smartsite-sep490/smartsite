import { sanitizeSafetyQueryId } from '../safety-episodes/safetyUrlParams';

const CAMERA_ROUTE_TABS = new Set(['camera-setup', 'ppe', 'zones']);

export function isCameraRouteTab(tab: string): boolean {
  return CAMERA_ROUTE_TABS.has(tab);
}

function sanitizeCameraSelection(selection: { siteId?: string | null; cameraId?: string | null }): {
  siteId?: string;
  cameraId?: string;
} {
  const siteId = sanitizeSafetyQueryId(selection.siteId);
  if (!siteId) {
    return {};
  }
  const cameraId = sanitizeSafetyQueryId(selection.cameraId);
  return cameraId ? { siteId, cameraId } : { siteId };
}

/**
 * Carries only whitelisted `siteId` and `cameraId` query parameters across
 * camera workflow sidebar routes (`camera-setup`, `ppe`, `zones`).
 */
export function buildCameraTabTarget(
  currentPathname: string,
  currentSearch: string,
  targetTab: string,
): string {
  const normalizedTarget = targetTab.replace(/^\/+|\/+$/g, '');
  const sourceTab = currentPathname.replace(/^\/+|\/+$/g, '');
  if (!isCameraRouteTab(sourceTab) || !isCameraRouteTab(normalizedTarget)) {
    return `/${normalizedTarget}`;
  }
  const sourceParams = new URLSearchParams(currentSearch);
  const selection = sanitizeCameraSelection({
    siteId: sourceParams.get('siteId'),
    cameraId: sourceParams.get('cameraId'),
  });
  if (!selection.siteId) {
    return `/${normalizedTarget}`;
  }
  const nextParams = new URLSearchParams({ siteId: selection.siteId });
  if (selection.cameraId) {
    nextParams.set('cameraId', selection.cameraId);
  }
  return `/${normalizedTarget}?${nextParams.toString()}`;
}

/**
 * Updates URL search params for an interactive Site/Camera selection while
 * preserving unrelated route parameters unless explicitly stripped.
 */
export function buildCameraSelectionSearch(
  currentSearch: string,
  selection: { siteId?: string | null; cameraId?: string | null },
  stripKeys: readonly string[] = [],
): URLSearchParams {
  const nextParams = new URLSearchParams(currentSearch);
  for (const key of stripKeys) {
    nextParams.delete(key);
  }
  const safeSelection = sanitizeCameraSelection(selection);
  if (!safeSelection.siteId) {
    nextParams.delete('siteId');
    nextParams.delete('cameraId');
    return nextParams;
  }
  nextParams.set('siteId', safeSelection.siteId);
  if (safeSelection.cameraId) {
    nextParams.set('cameraId', safeSelection.cameraId);
  } else {
    nextParams.delete('cameraId');
  }
  return nextParams;
}
