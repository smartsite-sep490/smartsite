import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { RegionResponse, RegionMutationResponse } from '@smartsite/contracts';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import {
  buildCamerasPagesQueryKey,
  buildRegionsPagesQueryKey,
  classifyPaginationError,
  dedupePages,
  getNextPageOffset,
  isAuthOrScopeError,
  registerCameraRegionPanelCatalog,
  validatePage,
  type DrawingScope,
  type ZonePpeCameraRegionPanelProps,
} from './camera-region-panel-catalog';
import {
  doesRegionNeedViewRevalidation,
  isConfigurationReferenceScopeMatched,
  isConfigurationReferenceExpiredAt,
  isSameConfigurationReference,
  useConfigurationReferenceExpired,
} from './cameraRegionReferenceUtils';
import { extractRegionPolygonCoordinates, type NormalizedPoint } from './region-polygon-geometry';
import {
  useCameraConfigurationReference,
  type CameraConfigurationReference,
} from './useCameraConfigurationReference';
import { useCameraRegionMutationScope } from './useCameraRegionMutationScope';

registerCameraRegionPanelCatalog();

export function useZonePpeCameraRegionPanel({
  apiUrl,
  client: providedClient,
  token,
  sessionScope,
  credentialId,
  siteId,
  initialCameraId,
  initialRegionId,
  zones,
  onSelectCamera,
  onUnauthorized,
  internalNonce,
}: ZonePpeCameraRegionPanelProps & { internalNonce: number }) {
  registerCameraRegionPanelCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();

  const [requestedZoneId, setSelectedZoneId] = useState<string>(() => zones[0]?.id ?? '');
  const [hasManualZoneSelection, setHasManualZoneSelection] = useState(false);
  const selectedZoneId = zones.some((zone) => zone.id === requestedZoneId)
    ? requestedZoneId
    : (zones[0]?.id ?? '');

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedZoneId) ?? null,
    [zones, selectedZoneId],
  );

  const fallbackClient = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const client = providedClient ?? fallbackClient;

  const camerasInfiniteQuery = useInfiniteQuery({
    queryKey: buildCamerasPagesQueryKey(apiUrl, sessionScope, internalNonce, siteId),
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listCameras(
        token,
        siteId,
        { offset: pageParam, limit: 20 },
        { signal },
      );
      return validatePage(page, pageParam, 'camera');
    },
    getNextPageParam: getNextPageOffset,
    enabled: Boolean(token && sessionScope && siteId),
    gcTime: 0,
    retry: false,
  });

  const allFetchedCameras = useMemo(
    () => dedupePages(camerasInfiniteQuery.data?.pages, (cam) => cam.siteId === siteId),
    [camerasInfiniteQuery.data, siteId],
  );

  const activeCameras = useMemo(
    () =>
      allFetchedCameras.filter(
        (cam) => cam.siteId === siteId && cam.type === 'ZONE' && cam.status === 'ACTIVE',
      ),
    [allFetchedCameras, siteId],
  );

  const cameraError = camerasInfiniteQuery.error;
  const { isBaseError: isCameraBaseError, isTransientNextError: isTransientNextCameraError } =
    classifyPaginationError(
      cameraError,
      camerasInfiniteQuery.isFetchNextPageError,
      allFetchedCameras.length,
    );

  const visibleActiveCameras = useMemo(
    () => (isCameraBaseError ? [] : activeCameras),
    [isCameraBaseError, activeCameras],
  );

  const [requestedCameraId, setSelectedCameraId] = useState<string>(() => initialCameraId ?? '');
  const selectedCameraId = visibleActiveCameras.some((c) => c.id === requestedCameraId)
    ? requestedCameraId
    : initialCameraId
      ? ''
      : (visibleActiveCameras[0]?.id ?? '');

  const selectedCamera = useMemo(
    () => visibleActiveCameras.find((c) => c.id === selectedCameraId) ?? null,
    [visibleActiveCameras, selectedCameraId],
  );

  const { error: activeMutationScopeError, revoke: revokeMutationScope } =
    useCameraRegionMutationScope(selectedCameraId);

  const regionsPagesKey = useMemo(
    () => buildRegionsPagesQueryKey(apiUrl, sessionScope, internalNonce, siteId, selectedCameraId),
    [apiUrl, internalNonce, selectedCameraId, sessionScope, siteId],
  );

  const regionsInfiniteQuery = useInfiniteQuery({
    queryKey: regionsPagesKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listRegions(
        token,
        siteId,
        selectedCameraId,
        { offset: pageParam, limit: 20 },
        { signal },
      );
      return validatePage(page, pageParam, 'region');
    },
    getNextPageParam: getNextPageOffset,
    enabled: Boolean(
      token && sessionScope && siteId && selectedCameraId && !activeMutationScopeError,
    ),
    gcTime: 0,
    retry: false,
  });

  const allFetchedRegions = useMemo(
    () => dedupePages(regionsInfiniteQuery.data?.pages, (reg) => reg.cameraId === selectedCameraId),
    [regionsInfiniteQuery.data, selectedCameraId],
  );

  const existingLinkedRegions = useMemo(
    () =>
      allFetchedRegions.filter(
        (reg) => reg.cameraId === selectedCameraId && reg.zoneId === selectedZoneId,
      ),
    [allFetchedRegions, selectedCameraId, selectedZoneId],
  );

  const regionError = regionsInfiniteQuery.error;
  const { isBaseError: isRegionBaseError, isTransientNextError: isTransientNextRegionError } =
    classifyPaginationError(
      regionError,
      regionsInfiniteQuery.isFetchNextPageError,
      allFetchedRegions.length,
    );

  const isCamerasInitialLoading = Boolean(
    token && sessionScope && siteId && camerasInfiniteQuery.isLoading && !camerasInfiniteQuery.data,
  );
  const isRegionsInitialLoading = Boolean(
    selectedCameraId && regionsInfiniteQuery.isLoading && !regionsInfiniteQuery.data,
  );
  const cameraServerTotal = camerasInfiniteQuery.data?.pages.at(-1)?.total ?? 0;
  const regionServerTotal = regionsInfiniteQuery.data?.pages.at(-1)?.total ?? 0;

  const configReference = useCameraConfigurationReference({
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId,
    siteId,
    cameraId: selectedCameraId,
    cameraExternalId: selectedCamera?.externalId ?? '',
    enabled: Boolean(
      token &&
      sessionScope &&
      siteId &&
      !activeMutationScopeError &&
      selectedCamera &&
      selectedCamera.status === 'ACTIVE' &&
      !isCameraBaseError &&
      !isAuthOrScopeError(regionsInfiniteQuery.error),
    ),
  });

  const hasReferenceOrMutationDenial = Boolean(
    activeMutationScopeError || isAuthOrScopeError(configReference.error),
  );
  const visibleAllCameraRegions =
    isCameraBaseError || isRegionBaseError || hasReferenceOrMutationDenial ? [] : allFetchedRegions;
  const visibleLinkedRegions =
    isCameraBaseError || isRegionBaseError || hasReferenceOrMutationDenial
      ? []
      : existingLinkedRegions;

  const initialRegionTarget = useMemo(
    () =>
      initialRegionId
        ? (allFetchedRegions.find((region) => region.id === initialRegionId) ?? null)
        : null,
    [allFetchedRegions, initialRegionId],
  );
  if (
    !hasManualZoneSelection &&
    initialRegionTarget &&
    initialRegionTarget.zoneId !== requestedZoneId &&
    zones.some((zone) => zone.id === initialRegionTarget.zoneId)
  ) {
    setSelectedZoneId(initialRegionTarget.zoneId);
  }

  const has401Error = Boolean(
    activeMutationScopeError?.status === 401 ||
    [camerasInfiniteQuery.error, regionsInfiniteQuery.error, configReference.error].some(
      (err) =>
        (err instanceof ApiError && err.status === 401) ||
        Boolean(err && typeof err === 'object' && 'status' in err && err.status === 401),
    ),
  );

  useEffect(() => {
    if (has401Error) {
      onUnauthorized?.();
    }
  }, [has401Error, onUnauthorized]);

  useEffect(() => {
    if (!activeMutationScopeError || !selectedCameraId) return;
    void queryClient.cancelQueries({ queryKey: regionsPagesKey });
    queryClient.removeQueries({ queryKey: regionsPagesKey });
  }, [activeMutationScopeError, queryClient, regionsPagesKey, selectedCameraId]);

  const [drawingScope, setDrawingScope] = useState<DrawingScope | null>(null);
  const [isCandidateReviewOpen, setIsCandidateReviewOpen] = useState(false);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(null);
  const [savedRegionInfo, setSavedRegionInfo] = useState<{
    id: string;
    version: number;
    configurationVersion: number;
  } | null>(null);
  const [pendingEditIntent, setPendingEditIntent] = useState<{
    regionId: string;
    zoneId: string;
    cameraId: string;
    initialPoints: NormalizedPoint[];
  } | null>(null);

  const resetDrawingSession = () => {
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
    setPendingEditIntent(null);
  };

  const isHookReferenceScopeValid =
    !activeMutationScopeError &&
    isConfigurationReferenceScopeMatched(configReference.reference, siteId, selectedCamera);
  const isHookReferenceExpired = useConfigurationReferenceExpired(configReference.reference);
  const validHookReference =
    isHookReferenceScopeValid && !isHookReferenceExpired ? configReference.reference : null;

  const canRequestReference = Boolean(
    token &&
    !activeMutationScopeError &&
    sessionScope &&
    siteId &&
    selectedCamera &&
    selectedCamera.status === 'ACTIVE' &&
    !isCameraBaseError &&
    !isAuthOrScopeError(regionsInfiniteQuery.error) &&
    !isAuthOrScopeError(configReference.error),
  );

  const canStartDrawing = Boolean(
    canRequestReference &&
    validHookReference &&
    selectedZone &&
    validHookReference.configurationVersion === selectedCamera?.configurationVersion,
  );

  const successFeedback = savedRegionInfo
    ? t('regionSetup.feedback.saved', { id: savedRegionInfo.id, version: savedRegionInfo.version })
    : null;

  const [activeSelectionKey, setActiveSelectionKey] = useState(
    () => `${siteId}:${selectedZoneId}:${selectedCameraId}`,
  );
  const currentSelectionKey = `${siteId}:${selectedZoneId}:${selectedCameraId}`;
  if (activeSelectionKey !== currentSelectionKey) {
    setActiveSelectionKey(currentSelectionKey);
    resetDrawingSession();
  }

  const isScopeTupleMatched = (scope: DrawingScope | null): scope is DrawingScope =>
    Boolean(
      scope &&
      scope.apiUrl === apiUrl &&
      scope.token === token &&
      scope.sessionScope === sessionScope &&
      scope.credentialId === credentialId &&
      scope.internalNonce === internalNonce &&
      scope.siteId === siteId &&
      scope.cameraId === selectedCameraId &&
      scope.zoneId === selectedZoneId,
    );

  const isDrawingScopeRevoked = Boolean(
    drawingScope &&
    (!isScopeTupleMatched(drawingScope) ||
      !activeCameras.some((cam) => cam.id === drawingScope.cameraId) ||
      !zones.some((z) => z.id === drawingScope.zoneId) ||
      !isConfigurationReferenceScopeMatched(drawingScope.reference, siteId, selectedCamera) ||
      isAuthOrScopeError(configReference.error) ||
      isAuthOrScopeError(camerasInfiniteQuery.error) ||
      isAuthOrScopeError(regionsInfiniteQuery.error)),
  );

  if (requestedZoneId !== selectedZoneId) {
    setSelectedZoneId(selectedZoneId);
  }
  if (requestedCameraId !== selectedCameraId && requestedCameraId !== initialCameraId) {
    setSelectedCameraId(selectedCameraId);
  }
  if (isDrawingScopeRevoked) {
    resetDrawingSession();
  }

  const isCurrentScopeActive = isScopeTupleMatched(drawingScope);

  const handleRequestReference = () => {
    if (!canRequestReference || configReference.isLoading) return;
    setIsCandidateReviewOpen(isCurrentScopeActive);
    void configReference.request();
  };

  const handleStartDrawing = () => {
    if (!canStartDrawing || !validHookReference) return;
    if (isConfigurationReferenceExpiredAt(validHookReference, Date.now())) return;
    if (drawingScope?.editingRegion) {
      setLastSavedDraft(null);
    }
    setIsCandidateReviewOpen(false);
    setDrawingScope({
      apiUrl,
      token,
      sessionScope,
      credentialId,
      internalNonce,
      siteId,
      cameraId: selectedCameraId,
      zoneId: selectedZoneId,
      reference: validHookReference,
      editingRegion: null,
    });
    setSavedRegionInfo(null);
  };

  const openRegionEditor = (
    region: RegionResponse,
    initialPoints: NormalizedPoint[],
    reference: CameraConfigurationReference,
    targetZoneId: string,
  ) => {
    setIsCandidateReviewOpen(false);
    setPendingEditIntent(null);
    const confirmation = region.geometryConfirmation;
    const confirmedOnCurrentView =
      confirmation?.status === 'MANUALLY_CONFIRMED' &&
      confirmation.viewRevision === reference.issuedReference.viewRevision;
    const needsViewRevalidation = doesRegionNeedViewRevalidation(
      confirmation,
      reference.issuedReference.viewRevision,
    );
    setDrawingScope({
      apiUrl,
      token,
      sessionScope,
      credentialId,
      internalNonce,
      siteId,
      cameraId: selectedCameraId,
      zoneId: targetZoneId,
      reference,
      editingRegion: {
        id: region.id,
        version: region.version,
        expectedConfigurationVersion: reference.configurationVersion,
        initialPoints,
        needsViewRevalidation,
      },
    });
    setLastSavedDraft(confirmedOnCurrentView ? JSON.stringify(initialPoints) : null);
    setSavedRegionInfo(null);
  };

  const handleStartEditingRegion = (region: RegionResponse, initialPoints: NormalizedPoint[]) => {
    if (!canStartDrawing || !validHookReference || !selectedCamera) return;
    if (isConfigurationReferenceExpiredAt(validHookReference, Date.now())) return;
    openRegionEditor(region, initialPoints, validHookReference, selectedZoneId);
  };

  const handleEditSavedRegion = (region: RegionResponse, initialPoints: NormalizedPoint[]) => {
    if (!selectedCamera || isCurrentScopeActive) return;
    if (!zones.some((zone) => zone.id === region.zoneId)) return;
    const targetZoneId = region.zoneId;
    if (targetZoneId !== selectedZoneId) {
      setHasManualZoneSelection(true);
      setSelectedZoneId(targetZoneId);
      setActiveSelectionKey(`${siteId}:${targetZoneId}:${selectedCameraId}`);
    }
    if (
      canRequestReference &&
      validHookReference &&
      validHookReference.configurationVersion === selectedCamera.configurationVersion &&
      !isConfigurationReferenceExpiredAt(validHookReference, Date.now())
    ) {
      openRegionEditor(region, initialPoints, validHookReference, targetZoneId);
      return;
    }
    if (!canRequestReference || configReference.isLoading) return;
    setSavedRegionInfo(null);
    setPendingEditIntent({
      regionId: region.id,
      zoneId: targetZoneId,
      cameraId: selectedCameraId,
      initialPoints,
    });
    void configReference.request();
  };

  if (pendingEditIntent) {
    if (
      pendingEditIntent.cameraId !== selectedCameraId ||
      pendingEditIntent.zoneId !== selectedZoneId ||
      activeMutationScopeError ||
      (configReference.error && !configReference.isLoading)
    ) {
      setPendingEditIntent(null);
    } else if (
      !configReference.isLoading &&
      validHookReference &&
      selectedCamera &&
      validHookReference.configurationVersion === selectedCamera.configurationVersion
    ) {
      const latestRegion = allFetchedRegions.find((r) => r.id === pendingEditIntent.regionId);
      if (latestRegion) {
        const latestPoints =
          extractRegionPolygonCoordinates(latestRegion.polygon) ?? pendingEditIntent.initialPoints;
        openRegionEditor(latestRegion, latestPoints, validHookReference, pendingEditIntent.zoneId);
      } else {
        setPendingEditIntent(null);
      }
    }
  }

  const handleAcceptCandidateReference = (candidate: CameraConfigurationReference) => {
    if (isConfigurationReferenceExpiredAt(candidate, Date.now())) return;
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
    setDrawingScope((prev) => {
      if (!prev) return prev;
      const latestRegion = prev.editingRegion
        ? allFetchedRegions.find((r) => r.id === prev.editingRegion?.id)
        : undefined;
      const latestRegionVersion = prev.editingRegion
        ? (latestRegion?.version ?? prev.editingRegion.version)
        : null;
      return {
        ...prev,
        reference: candidate,
        editingRegion: prev.editingRegion
          ? {
              ...prev.editingRegion,
              version: latestRegionVersion ?? prev.editingRegion.version,
              expectedConfigurationVersion: candidate.configurationVersion,
              needsViewRevalidation: latestRegion
                ? doesRegionNeedViewRevalidation(
                    latestRegion.geometryConfirmation,
                    candidate.issuedReference.viewRevision,
                  )
                : prev.editingRegion.needsViewRevalidation,
            }
          : null,
      };
    });
  };

  const handleSaveSuccess = (
    data: RegionMutationResponse,
    savedDraftKey: string,
    savedPoints: NormalizedPoint[],
  ) => {
    const authoritativePoints = extractRegionPolygonCoordinates(data.region.polygon) ?? savedPoints;
    const authoritativeDraftKey = JSON.stringify(authoritativePoints);
    setLastSavedDraft(authoritativeDraftKey || savedDraftKey);
    setSavedRegionInfo({
      id: data.region.id,
      version: data.region.version,
      configurationVersion: data.configurationVersion,
    });
    setDrawingScope((prev) => {
      if (
        !isScopeTupleMatched(prev) ||
        (prev.editingRegion && prev.editingRegion.id !== data.region.id)
      ) {
        return prev;
      }
      return {
        ...prev,
        editingRegion: {
          id: data.region.id,
          version: data.region.version,
          expectedConfigurationVersion: data.configurationVersion,
          initialPoints: authoritativePoints,
          needsViewRevalidation: false,
        },
      };
    });
  };

  const handleZoneChange = (zoneId: string) => {
    setHasManualZoneSelection(true);
    setSelectedZoneId(zoneId);
    resetDrawingSession();
  };

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    resetDrawingSession();
    if (visibleActiveCameras.some((camera) => camera.id === cameraId)) {
      onSelectCamera?.(cameraId);
    }
  };

  const handleScopeRevoked = (status: number) => {
    if (!drawingScope) return;
    revokeMutationScope(status, drawingScope.cameraId);
    resetDrawingSession();
  };

  const statusCardReference =
    isCurrentScopeActive && drawingScope
      ? drawingScope.reference
      : isHookReferenceScopeValid
        ? configReference.reference
        : null;
  const isStatusCardReferenceExpired = useConfigurationReferenceExpired(statusCardReference);

  const candidateReference =
    isCurrentScopeActive &&
    drawingScope &&
    validHookReference &&
    isCandidateReviewOpen &&
    !isSameConfigurationReference(validHookReference, drawingScope.reference)
      ? validHookReference
      : null;

  return {
    client,
    selectedZoneId,
    selectedZone,
    selectedCameraId,
    selectedCamera,
    camerasInfiniteQuery,
    allFetchedCameras,
    visibleActiveCameras,
    cameraError,
    isCameraBaseError,
    isTransientNextCameraError,
    isCamerasInitialLoading,
    cameraServerTotal,
    regionsInfiniteQuery,
    allFetchedRegions,
    visibleAllCameraRegions,
    visibleLinkedRegions,
    regionError,
    isRegionBaseError,
    isTransientNextRegionError,
    isRegionsInitialLoading,
    regionServerTotal,
    activeMutationScopeError,
    configReference,
    drawingScope,
    lastSavedDraft,
    canRequestReference,
    canStartDrawing,
    pendingEditRegionId: pendingEditIntent?.regionId ?? null,
    successFeedback,
    savedRegionInfo,
    isCurrentScopeActive,
    statusCardReference,
    isStatusCardReferenceExpired,
    candidateReference,
    handleRequestReference,
    handleStartDrawing,
    handleStartEditingRegion,
    handleEditSavedRegion,
    handleAcceptCandidateReference,
    handleSaveSuccess,
    handleZoneChange,
    handleCameraChange,
    handleScopeRevoked,
    handleCancelCandidateReview: () => setIsCandidateReviewOpen(false),
    handleCloseDrawer: () => {
      setDrawingScope(null);
      setIsCandidateReviewOpen(false);
    },
  };
}
