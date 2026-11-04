import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
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
  isConfigurationReferenceScopeMatched,
  isConfigurationReferenceExpiredAt,
  isSameConfigurationReference,
  useConfigurationReferenceExpired,
} from './cameraRegionReferenceUtils';
import type { NormalizedPoint } from './region-polygon-geometry';
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
  zones,
  onSelectCamera,
  internalNonce,
}: ZonePpeCameraRegionPanelProps & { internalNonce: number }) {
  registerCameraRegionPanelCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);

  const [requestedZoneId, setSelectedZoneId] = useState<string>(() => zones[0]?.id ?? '');
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
    () => allFetchedCameras.filter((cam) => cam.siteId === siteId && cam.status === 'ACTIVE'),
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

  const regionsInfiniteQuery = useInfiniteQuery({
    queryKey: buildRegionsPagesQueryKey(
      apiUrl,
      sessionScope,
      internalNonce,
      siteId,
      selectedCameraId,
    ),
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
    enabled: Boolean(token && sessionScope && siteId && selectedCameraId),
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

  const visibleLinkedRegions = isCameraBaseError || isRegionBaseError ? [] : existingLinkedRegions;
  const isCamerasInitialLoading = Boolean(
    token && sessionScope && siteId && camerasInfiniteQuery.isLoading && !camerasInfiniteQuery.data,
  );
  const isRegionsInitialLoading = Boolean(
    selectedCameraId && regionsInfiniteQuery.isLoading && !regionsInfiniteQuery.data,
  );
  const cameraServerTotal = camerasInfiniteQuery.data?.pages.at(-1)?.total ?? 0;
  const regionServerTotal = regionsInfiniteQuery.data?.pages.at(-1)?.total ?? 0;

  const { error: activeMutationScopeError, revoke: revokeMutationScope } =
    useCameraRegionMutationScope(selectedCameraId);

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

  const [drawingScope, setDrawingScope] = useState<DrawingScope | null>(null);
  const [isCandidateReviewOpen, setIsCandidateReviewOpen] = useState(false);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(null);
  const [savedRegionInfo, setSavedRegionInfo] = useState<{ id: string; version: number } | null>(
    null,
  );

  const resetDrawingSession = () => {
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
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

  const handleStartEditingRegion = (region: RegionResponse, initialPoints: NormalizedPoint[]) => {
    if (!canStartDrawing || !validHookReference || !selectedCamera) return;
    if (isConfigurationReferenceExpiredAt(validHookReference, Date.now())) return;
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
      editingRegion: {
        id: region.id,
        version: region.version,
        expectedConfigurationVersion: validHookReference.configurationVersion,
        initialPoints,
      },
    });
    setLastSavedDraft(JSON.stringify(initialPoints));
    setSavedRegionInfo(null);
  };

  const handleAcceptCandidateReference = (candidate: CameraConfigurationReference) => {
    if (isConfigurationReferenceExpiredAt(candidate, Date.now())) return;
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setDrawingScope((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            reference: candidate,
            editingRegion: prev.editingRegion
              ? {
                  ...prev.editingRegion,
                  expectedConfigurationVersion: candidate.configurationVersion,
                }
              : null,
          },
    );
  };

  const handleSaveSuccess = (
    data: RegionMutationResponse,
    savedDraftKey: string,
    savedPoints: NormalizedPoint[],
  ) => {
    setLastSavedDraft(savedDraftKey);
    setSavedRegionInfo({ id: data.region.id, version: data.region.version });
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
          initialPoints: savedPoints,
        },
      };
    });
  };

  const handleZoneChange = (zoneId: string) => {
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
    successFeedback,
    isCurrentScopeActive,
    statusCardReference,
    isStatusCardReferenceExpired,
    candidateReference,
    handleRequestReference,
    handleStartDrawing,
    handleStartEditingRegion,
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
