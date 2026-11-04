import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { useManagementClient } from '../../features/auth/auth-session';
import { deriveZonePpeCapabilities, getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import { buildCameraSetupTourSteps } from '../safety/safetyTaskTourModel';
import { publishUpdatedSetupCamera, refreshCameraSetupCaches } from './camera-setup-cache';
import type { CameraSetupOpenHandler, CameraSetupOpenKind } from './CameraSetupWorkflow';
import { setupErrorStatus, useSetupCatalog } from './useSetupCatalog';

export function useCameraSetupWorkspace(apiUrl: string, session: SharedSession) {
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{
    kind: CameraSetupOpenKind;
    siteId: string;
    cameraId?: string;
  } | null>(null);
  const [selectedRegionCamera, setSelectedRegionCamera] = useState<{
    siteId: string;
    cameraId: string;
  } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const signedOut = useRef(false);
  const mounted = useRef(true);
  const activeLookupAbortRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    };
  }, []);

  const credentialId = getOpaqueTokenNonce(cache, session.accessToken);
  const key = [
    'camera-setup',
    apiUrl,
    session.sessionScope,
    session.user.id,
    credentialId,
    session.user.roleAssignments,
  ];

  const sites = useSetupCatalog<SiteResponse>([...key, 'sites'], !revoked, (offset, signal) =>
    client.listSites(session.accessToken, { offset, limit: 20 }, { signal }),
  );
  const requestedSite = params.get('siteId');
  const site = requestedSite ? sites.rows.find((row) => row.id === requestedSite) : sites.rows[0];
  const capabilities = deriveZonePpeCapabilities(session.user, site?.id);
  const canReadZones =
    !revoked &&
    session.user.roleAssignments.some(({ role, siteId }) => role === 'ADMIN' && siteId === null);
  const canReadCameras = session.user.roleAssignments.some(
    ({ role, siteId }) =>
      (role === 'ADMIN' && siteId === null) ||
      (siteId === site?.id && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(role)),
  );

  const cameras = useSetupCatalog<CameraResponse>(
    [...key, site?.id, 'cameras'],
    Boolean(site && canReadCameras && !revoked),
    (offset, signal) =>
      client.listCameras(session.accessToken, site!.id, { offset, limit: 20 }, { signal }),
  );
  const rows = cameras.rows.filter((row) => row.siteId === site?.id);
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const canAccessTourZones = canManageCameras || capabilities.canManageZones || canReadZones;
  const hasTourCameraContext = Boolean(
    site && canReadCameras && !cameras.baseError && rows.length > 0,
  );
  const setupTourSteps = useMemo(
    () =>
      buildCameraSetupTourSteps({
        canManageCameras,
        canAccessZones: canAccessTourZones,
        hasCameraContext: hasTourCameraContext,
      }),
    [canManageCameras, canAccessTourZones, hasTourCameraContext],
  );

  const selectedCamera = rows.find((row) => row.id === dialog?.cameraId);
  const dialogScope = useRef({ dialog, siteId: site?.id });
  useLayoutEffect(() => {
    dialogScope.current = { dialog, siteId: site?.id };
  }, [dialog, site?.id]);

  const isCurrentDialog = () =>
    mounted.current &&
    dialogScope.current.dialog === dialog &&
    dialogScope.current.siteId === site?.id;

  const requestedCameraId = params.get('cameraId');
  const loadedReturnCamera =
    !revoked && !sites.baseError && !cameras.baseError && requestedCameraId
      ? rows.find((row) => row.id === requestedCameraId)
      : undefined;
  const explicitDialogCameraId =
    site &&
    !revoked &&
    !sites.baseError &&
    !cameras.baseError &&
    canReadCameras &&
    canManageCameras &&
    selectedRegionCamera?.siteId === site.id &&
    selectedRegionCamera.cameraId === requestedCameraId
      ? selectedRegionCamera.cameraId
      : null;
  const shouldFetchSelectedCamera = Boolean(site && explicitDialogCameraId && !loadedReturnCamera);

  useLayoutEffect(() => {
    if (!shouldFetchSelectedCamera) {
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    }
    return () => {
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    };
  }, [shouldFetchSelectedCamera, site?.id, explicitDialogCameraId]);

  const selectedCameraQuery = useQuery({
    queryKey: [...key, site?.id, 'selected-camera', explicitDialogCameraId],
    enabled: shouldFetchSelectedCamera,
    queryFn: async ({ signal }) => {
      activeLookupAbortRef.current?.abort();
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
      activeLookupAbortRef.current = controller;
      try {
        const camera = await client.getCamera(
          session.accessToken,
          site!.id,
          explicitDialogCameraId!,
          { signal: controller.signal },
        );
        controller.signal.throwIfAborted();
        if (
          !camera ||
          camera.id !== explicitDialogCameraId ||
          camera.siteId !== site!.id ||
          camera.status !== 'ACTIVE'
        ) {
          throw new Error('Invalid selected camera metadata');
        }
        return camera;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
    retry: false,
    gcTime: 0,
  });

  const selectedCameraStatus = setupErrorStatus(selectedCameraQuery.error);
  const verifiedDialogCamera =
    shouldFetchSelectedCamera &&
    selectedCameraQuery.isSuccess &&
    !selectedCameraQuery.isFetching &&
    !selectedCameraQuery.isError &&
    selectedCameraQuery.data?.id === explicitDialogCameraId &&
    selectedCameraQuery.data.siteId === site?.id &&
    selectedCameraQuery.data.status === 'ACTIVE'
      ? selectedCameraQuery.data
      : undefined;

  const returnParams = new URLSearchParams(site ? { siteId: site.id } : {});
  const returnCamera =
    !revoked && !sites.baseError && !cameras.baseError
      ? explicitDialogCameraId && loadedReturnCamera?.status === 'INACTIVE'
        ? undefined
        : (loadedReturnCamera ?? verifiedDialogCamera)
      : undefined;
  if (returnCamera) returnParams.set('cameraId', returnCamera.id);

  const canOpenMonitoring = session.user.roleAssignments.some(
    (role) =>
      (role.role === 'ADMIN' && role.siteId === null) ||
      (role.role === 'SAFETY_OFFICER' && role.siteId === site?.id),
  );

  const activeDialog =
    dialog &&
    !revoked &&
    site?.id === dialog?.siteId &&
    (dialog.kind === 'register'
      ? canManageCameras
      : dialog.kind === 'manage'
        ? Boolean(selectedCamera && canManageCameras)
        : dialog.kind === 'regions'
          ? canManageCameras
          : canReadZones || capabilities.canManageZones)
      ? dialog
      : null;

  if (dialog && !activeDialog) setDialog(null);
  if (!revoked && (sites.status === 401 || cameras.status === 401 || selectedCameraStatus === 401))
    setRevoked(true);

  useEffect(() => {
    if (!revoked) return;
    if (!signedOut.current) {
      signedOut.current = true;
      session.onSignOut?.();
    }
  }, [revoked, session]);

  const refreshCameras = (cameraId?: string) => {
    if (!site) return;
    refreshCameraSetupCaches(cache, key, apiUrl, session.sessionScope, site.id, cameraId);
  };

  const unauthorized = () => {
    if (!isCurrentDialog()) return;
    setRevoked(true);
    if (!signedOut.current) {
      signedOut.current = true;
      session.onSignOut?.();
    }
  };

  const syncActiveRegionCameraParam = (cameraId?: string, allowUnloaded = false) => {
    if (!site || !canManageCameras || !cameraId) {
      return;
    }
    const loadedRow = rows.find((row) => row.id === cameraId);
    if (loadedRow ? loadedRow.status !== 'ACTIVE' : !allowUnloaded) {
      return;
    }
    setSelectedRegionCamera({ siteId: site.id, cameraId });
    const nextParams = new URLSearchParams(params);
    nextParams.set('siteId', site.id);
    nextParams.set('cameraId', cameraId);
    setParams(nextParams, { replace: true });
  };

  const open: CameraSetupOpenHandler = (kind, cameraId, trigger) => {
    if (!site) return;
    if (kind === 'regions') {
      syncActiveRegionCameraParam(cameraId, false);
    }
    if (trigger?.isConnected && !trigger.disabled && document.activeElement !== trigger) {
      trigger.focus();
    }
    setDialog({ kind, siteId: site.id, cameraId });
  };

  const close = () => setDialog(null);

  const selectSite = (nextSiteId: string) => {
    close();
    setSelectedRegionCamera(null);
    setParams({ siteId: nextSiteId });
  };

  const handleStatusUnauthorized = (targetSiteId: string) => {
    if (mounted.current && dialogScope.current.siteId === targetSiteId) {
      setRevoked(true);
    }
  };

  const publishCameraUpdate = (targetSiteId: string, updatedCamera: CameraResponse) => {
    publishUpdatedSetupCamera(
      cache,
      key,
      apiUrl,
      session.sessionScope,
      targetSiteId,
      updatedCamera,
    );
  };

  const common = {
    client,
    apiUrl,
    token: session.accessToken,
    sessionScope: session.sessionScope,
    credentialId,
    siteId: site?.id ?? '',
    siteName: site?.name ?? '',
    tourUserId: session.user.id,
    canManageCamera: capabilities.canManageRegions,
    onClose: () => {
      if (isCurrentDialog()) close();
    },
    onUnauthorized: unauthorized,
  };

  const isSessionRevoked =
    revoked || sites.status === 401 || cameras.status === 401 || selectedCameraStatus === 401;
  const tourScopeKey = `${apiUrl}:${session.sessionScope}:${credentialId}:${site?.id ?? 'none'}:${canManageCameras ? 'manage' : canReadZones ? 'read' : 'limited'}`;
  const isTourAuthorized =
    !revoked &&
    !sites.baseError &&
    !sites.settledEmpty &&
    sites.status !== 401 &&
    cameras.status !== 401 &&
    selectedCameraStatus !== 401;

  return {
    client,
    key,
    params,
    sites,
    cameras,
    requestedSite,
    site,
    rows,
    capabilities,
    canReadZones,
    canReadCameras,
    canManageCameras,
    canOpenMonitoring,
    setupTourSteps,
    tourScopeKey,
    isTourAuthorized,
    returnParams,
    activeDialog,
    selectedCamera,
    revoked,
    isSessionRevoked,
    common,
    isCurrentDialog,
    open,
    close,
    selectSite,
    refreshCameras,
    publishCameraUpdate,
    syncActiveRegionCameraParam,
    handleStatusUnauthorized,
  };
}
