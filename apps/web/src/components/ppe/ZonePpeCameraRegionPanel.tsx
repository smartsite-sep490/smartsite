import React, { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, RegionMutationResponse } from '@smartsite/contracts';
import { IconCamera, IconAlertTriangle, IconCheck, IconX } from '../icons';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import { CameraRegionReferenceStatusCard } from './CameraRegionReferenceControls';
import {
  isConfigurationReferenceScopeMatched,
  isConfigurationReferenceExpiredAt,
  isSameConfigurationReference,
  useConfigurationReferenceExpired,
  type EditingRegionScope,
} from './cameraRegionReferenceUtils';
import { extractRegionPolygonCoordinates, type NormalizedPoint } from './region-polygon-geometry';
import {
  useCameraConfigurationReference,
  type CameraConfigurationReference,
} from './useCameraConfigurationReference';
import { ZonePpeCameraRegionDrawer } from './ZonePpeCameraRegionDrawer';
import { useCameraRegionMutationScope } from './useCameraRegionMutationScope';

export interface ZonePpeCameraRegionPanelProps {
  embedded?: boolean;
  apiUrl: string;
  client?: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  initialCameraId?: string;
  zones: ZoneResponse[];
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
  onClose?: () => void;
}

function isAuthOrScopeError(err: unknown): boolean {
  if (err instanceof ApiError && typeof err.status === 'number') {
    return [401, 403, 404].includes(err.status);
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === 'number' && [401, 403, 404].includes(status);
  }
  return false;
}

function getSafePublicErrorMessage(
  err: unknown,
  entity: 'camera' | 'region',
  t: (key: TranslationKey) => string,
): string {
  let status: number | null = null;
  if (err instanceof ApiError && typeof err.status === 'number') {
    status = err.status;
  } else if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number') status = s;
  }

  if (status === 401) {
    return t('regionSetup.error.401');
  }
  if (status === 403) {
    return entity === 'camera'
      ? t('regionSetup.camera.error.403')
      : t('regionSetup.region.error.403');
  }
  if (status === 404) {
    return entity === 'camera'
      ? t('regionSetup.camera.error.404')
      : t('regionSetup.region.error.404');
  }
  return entity === 'camera'
    ? t('regionSetup.camera.error.default')
    : t('regionSetup.region.error.default');
}

const tokenNonces = new WeakMap<QueryClient, { token: string; nonce: number }>();
let nextTokenNonce = 1;
function getOpaqueTokenNonce(client: QueryClient, token: string): number {
  if (!token) {
    tokenNonces.delete(client);
    return 0;
  }
  const previous = tokenNonces.get(client);
  if (previous?.token === token) return previous.nonce;
  const nonce = nextTokenNonce++;
  tokenNonces.set(client, { token, nonce });
  return nonce;
}

interface DrawingScope {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  cameraId: string;
  zoneId: string;
  reference: CameraConfigurationReference;
  editingRegion: EditingRegionScope | null;
}

export function ZonePpeCameraRegionPanel(props: ZonePpeCameraRegionPanelProps) {
  const queries = useQueryClient();
  const internalNonce = useMemo(
    () => getOpaqueTokenNonce(queries, props.token),
    [queries, props.token],
  );
  return (
    <ZonePpeCameraRegionPanelContent
      key={JSON.stringify([
        props.apiUrl,
        props.sessionScope,
        props.siteId,
        props.credentialId,
        internalNonce,
        props.initialCameraId ?? '',
      ])}
      {...props}
      internalNonce={internalNonce}
      zones={props.zones.filter((zone) => zone.siteId === props.siteId)}
    />
  );
}

function ZonePpeCameraRegionPanelContent({
  embedded = false,
  apiUrl,
  client: providedClient,
  token,
  sessionScope,
  credentialId,
  siteId,
  initialCameraId,
  zones,
  onDraftStateChange,
  onClose,
  internalNonce,
}: ZonePpeCameraRegionPanelProps & { internalNonce: number }) {
  const { t } = useLocale();

  // 1. Zone Selection (default to first zone if available)
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

  // 2. Active Cameras on Site - Explicit Accumulative Pagination
  const camerasInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'ppe-monitoring',
      apiUrl,
      sessionScope,
      internalNonce,
      siteId,
      'cameras-for-region',
      'pages',
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listCameras(
        token,
        siteId,
        { offset: pageParam, limit: 20 },
        { signal },
      );
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length > 20
      ) {
        throw new Error('Malformed camera page');
      }
      if (page.items.length === 0 && pageParam < page.total) {
        throw new Error('Non-progressing camera page');
      }
      return page;
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.items.length;
      return lastPage.items.length > 0 && nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(token && sessionScope && siteId),
    gcTime: 0,
    retry: false,
  });

  const allFetchedCameras = useMemo(() => {
    if (!camerasInfiniteQuery.data?.pages) return [];
    const seen = new Set<string>();
    const list: CameraResponse[] = [];
    for (const page of camerasInfiniteQuery.data.pages) {
      for (const cam of page.items) {
        if (cam && cam.siteId === siteId && cam.id && !seen.has(cam.id)) {
          seen.add(cam.id);
          list.push(cam);
        }
      }
    }
    return list;
  }, [camerasInfiniteQuery.data, siteId]);

  const activeCameras = useMemo(() => {
    return allFetchedCameras.filter((cam) => cam.siteId === siteId && cam.status === 'ACTIVE');
  }, [allFetchedCameras, siteId]);

  const cameraError = camerasInfiniteQuery.error;
  const isCameraHard = isAuthOrScopeError(cameraError);
  const isCameraBaseError = Boolean(
    cameraError &&
    (isCameraHard || !camerasInfiniteQuery.isFetchNextPageError || allFetchedCameras.length === 0),
  );
  const isTransientNextCameraError = Boolean(
    cameraError &&
    !isCameraHard &&
    camerasInfiniteQuery.isFetchNextPageError &&
    allFetchedCameras.length > 0,
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

  // 3. Existing Linked Regions Query for Selected Camera - Explicit Accumulative Pagination
  const regionsInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'ppe-monitoring',
      apiUrl,
      sessionScope,
      internalNonce,
      siteId,
      'cameras',
      selectedCameraId,
      'regions',
      'pages',
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listRegions(
        token,
        siteId,
        selectedCameraId,
        { offset: pageParam, limit: 20 },
        { signal },
      );
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length > 20
      ) {
        throw new Error('Malformed region page');
      }
      if (page.items.length === 0 && pageParam < page.total) {
        throw new Error('Non-progressing region page');
      }
      return page;
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.items.length;
      return lastPage.items.length > 0 && nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(token && sessionScope && siteId && selectedCameraId),
    gcTime: 0,
    retry: false,
  });

  const allFetchedRegions = useMemo(() => {
    if (!regionsInfiniteQuery.data?.pages) return [];
    const seen = new Set<string>();
    const list: RegionResponse[] = [];
    for (const page of regionsInfiniteQuery.data.pages) {
      for (const reg of page.items) {
        if (reg && reg.cameraId === selectedCameraId && reg.id && !seen.has(reg.id)) {
          seen.add(reg.id);
          list.push(reg);
        }
      }
    }
    return list;
  }, [regionsInfiniteQuery.data, selectedCameraId]);

  const existingLinkedRegions = useMemo(() => {
    return allFetchedRegions.filter(
      (reg) => reg.cameraId === selectedCameraId && reg.zoneId === selectedZoneId,
    );
  }, [allFetchedRegions, selectedCameraId, selectedZoneId]);

  const regionError = regionsInfiniteQuery.error;
  const isRegionHard = isAuthOrScopeError(regionError);
  const isRegionBaseError = Boolean(
    regionError &&
    (isRegionHard || !regionsInfiniteQuery.isFetchNextPageError || allFetchedRegions.length === 0),
  );
  const isTransientNextRegionError = Boolean(
    regionError &&
    !isRegionHard &&
    regionsInfiniteQuery.isFetchNextPageError &&
    allFetchedRegions.length > 0,
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

  // 4. Explicit Scoped Camera Configuration Reference
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

  // 5. Drawing State bound to complete captured scope
  const [drawingScope, setDrawingScope] = useState<DrawingScope | null>(null);
  const [isCandidateReviewOpen, setIsCandidateReviewOpen] = useState(false);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(null);
  const [savedRegionInfo, setSavedRegionInfo] = useState<{
    id: string;
    version: number;
  } | null>(null);

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
    ? t('regionSetup.feedback.saved', {
        id: savedRegionInfo.id,
        version: savedRegionInfo.version,
      })
    : null;

  const [activeSelectionKey, setActiveSelectionKey] = useState(
    () => `${siteId}:${selectedZoneId}:${selectedCameraId}`,
  );
  const currentSelectionKey = `${siteId}:${selectedZoneId}:${selectedCameraId}`;
  if (activeSelectionKey !== currentSelectionKey) {
    setActiveSelectionKey(currentSelectionKey);
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  }

  const isDrawingScopeRevoked = Boolean(
    drawingScope &&
    (drawingScope.siteId !== siteId ||
      drawingScope.cameraId !== selectedCameraId ||
      drawingScope.zoneId !== selectedZoneId ||
      drawingScope.sessionScope !== sessionScope ||
      drawingScope.token !== token ||
      drawingScope.credentialId !== credentialId ||
      drawingScope.internalNonce !== internalNonce ||
      drawingScope.apiUrl !== apiUrl ||
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
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  }

  const isCurrentScopeActive = Boolean(
    drawingScope &&
    drawingScope.apiUrl === apiUrl &&
    drawingScope.token === token &&
    drawingScope.sessionScope === sessionScope &&
    drawingScope.credentialId === credentialId &&
    drawingScope.internalNonce === internalNonce &&
    drawingScope.siteId === siteId &&
    drawingScope.cameraId === selectedCameraId &&
    drawingScope.zoneId === selectedZoneId,
  );

  const handleRequestReference = () => {
    if (!canRequestReference || configReference.isLoading) return;
    if (isCurrentScopeActive) {
      setIsCandidateReviewOpen(true);
    } else {
      setIsCandidateReviewOpen(false);
    }
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

  const handleStartEditingRegion = useCallback(
    (region: RegionResponse, initialPoints: NormalizedPoint[]) => {
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
    },
    [
      canStartDrawing,
      validHookReference,
      selectedCamera,
      apiUrl,
      token,
      sessionScope,
      credentialId,
      internalNonce,
      siteId,
      selectedCameraId,
      selectedZoneId,
    ],
  );

  const handleAcceptCandidateReference = (candidate: CameraConfigurationReference) => {
    if (isConfigurationReferenceExpiredAt(candidate, Date.now())) return;
    setIsCandidateReviewOpen(false);
    setDrawingScope((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reference: candidate,
        editingRegion: prev.editingRegion
          ? {
              ...prev.editingRegion,
              expectedConfigurationVersion: candidate.configurationVersion,
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
    setLastSavedDraft(savedDraftKey);
    setSavedRegionInfo({
      id: data.region.id,
      version: data.region.version,
    });
    setDrawingScope((prev) => {
      if (
        !prev ||
        (prev.editingRegion && prev.editingRegion.id !== data.region.id) ||
        prev.apiUrl !== apiUrl ||
        prev.token !== token ||
        prev.sessionScope !== sessionScope ||
        prev.credentialId !== credentialId ||
        prev.internalNonce !== internalNonce ||
        prev.siteId !== siteId ||
        prev.cameraId !== selectedCameraId ||
        prev.zoneId !== selectedZoneId
      ) {
        return prev;
      }
      return {
        ...prev,
        reference: {
          ...prev.reference,
          configurationVersion: data.configurationVersion,
        },
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
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  };

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    setDrawingScope(null);
    setIsCandidateReviewOpen(false);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
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

  return (
    <div
      role={embedded ? undefined : 'region'}
      aria-label={embedded ? undefined : t('regionSetup.sectionAria')}
      className={
        embedded
          ? 'space-y-5 min-w-0'
          : 'rounded-2xl border border-slate-200/80 bg-white p-6 space-y-5 min-w-0 w-full max-w-full shadow-sm'
      }
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900 flex-shrink-0">
              <IconCamera className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {t('regionSetup.title')}
              </h3>
              <p className="text-xs text-slate-500 truncate mt-0.5">{t('regionSetup.subtitle')}</p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('regionSetup.closeAria')}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Success Notice with Visible Region ID and Version */}
      {successFeedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2 min-w-0 w-full"
        >
          <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="break-words">{successFeedback}</span>
        </div>
      )}

      {/* Selectors: Zone and Camera */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 w-full max-w-full">
        <div className="min-w-0 w-full space-y-1.5">
          <label htmlFor="select-zone-link" className="block text-xs font-semibold text-slate-700">
            {t('regionSetup.field.selectZone')}
          </label>
          <select
            id="select-zone-link"
            aria-label={t('regionSetup.field.selectZone')}
            value={selectedZoneId}
            onChange={(e) => handleZoneChange(e.target.value)}
            disabled={zones.length === 0}
            className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 truncate"
          >
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.code} · {zone.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 w-full space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-w-0">
            <label
              htmlFor="select-camera-link"
              className="block text-xs font-semibold text-slate-700"
            >
              {t('regionSetup.field.selectCamera')}
            </label>
            {!isCameraBaseError && allFetchedCameras.length > 0 && (
              <span className="text-[11px] text-slate-500 font-normal">
                {t('regionSetup.camera.countSummary', {
                  active: visibleActiveCameras.length,
                  loaded: allFetchedCameras.length,
                  total: cameraServerTotal,
                })}
              </span>
            )}
          </div>

          <select
            id="select-camera-link"
            aria-label={t('regionSetup.field.selectCamera')}
            value={selectedCameraId}
            onChange={(e) => handleCameraChange(e.target.value)}
            disabled={visibleActiveCameras.length === 0}
            className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 truncate"
          >
            {!selectedCameraId && <option value="">{t('regionSetup.field.selectCamera')}</option>}
            {visibleActiveCameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.code} · {camera.name}
              </option>
            ))}
          </select>

          {isCamerasInitialLoading && (
            <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
              {t('regionSetup.camera.loading')}
            </div>
          )}

          {cameraError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
            >
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{getSafePublicErrorMessage(cameraError, 'camera', t)}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {isCameraBaseError && (
              <button
                type="button"
                onClick={() => {
                  if (camerasInfiniteQuery.isFetching) return;
                  camerasInfiniteQuery.refetch({ cancelRefetch: false });
                }}
                disabled={camerasInfiniteQuery.isFetching}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
              >
                {camerasInfiniteQuery.isFetching
                  ? t('regionSetup.camera.retrying')
                  : t('regionSetup.camera.retryInitial')}
              </button>
            )}

            {isTransientNextCameraError && (
              <button
                type="button"
                onClick={() => {
                  if (camerasInfiniteQuery.isFetching) return;
                  camerasInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                }}
                disabled={camerasInfiniteQuery.isFetching}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              >
                {camerasInfiniteQuery.isFetching
                  ? t('regionSetup.camera.retryingMore')
                  : t('regionSetup.camera.retryNextPage')}
              </button>
            )}

            {!isCameraBaseError &&
              !isTransientNextCameraError &&
              camerasInfiniteQuery.hasNextPage && (
                <button
                  type="button"
                  onClick={() => {
                    if (camerasInfiniteQuery.isFetching) return;
                    camerasInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                  }}
                  disabled={camerasInfiniteQuery.isFetching}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {camerasInfiniteQuery.isFetching
                    ? t('regionSetup.camera.loadingMore')
                    : t('regionSetup.camera.loadMore')}
                </button>
              )}
          </div>
        </div>
      </div>

      {/* Explicit Configuration Reference Card & Drawing Trigger */}
      <div className="space-y-3">
        {activeMutationScopeError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {t(
              activeMutationScopeError.status === 401
                ? 'regionSetup.error.401'
                : activeMutationScopeError.status === 403
                  ? 'regionSetup.error.403'
                  : 'regionSetup.reference.error.404',
            )}
          </p>
        )}
        <CameraRegionReferenceStatusCard
          reference={statusCardReference}
          isExpired={isStatusCardReferenceExpired}
          isLoading={configReference.isLoading}
          error={configReference.error}
          canRequest={canRequestReference}
          isDrawingActive={isCurrentScopeActive}
          onRequestReference={handleRequestReference}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleStartDrawing}
            disabled={!canStartDrawing || isCurrentScopeActive}
            className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {isCurrentScopeActive
              ? t('regionSetup.action.drawingActive')
              : t('regionSetup.action.startDrawing')}
          </button>

          {!isCurrentScopeActive && (
            <span className="text-xs text-slate-500">
              {t('regionSetup.action.startDrawingHint')}
            </span>
          )}
        </div>

        {/* Remount inner drawing/mutation component keyed by opaque scope ID */}
        {isCurrentScopeActive && drawingScope && selectedCamera && selectedZone && (
          <ZonePpeCameraRegionDrawer
            key={`${apiUrl}:${sessionScope}:${internalNonce}:${siteId}:${selectedCameraId}:${selectedZoneId}:${drawingScope.editingRegion?.id ?? 'new'}`}
            apiUrl={apiUrl}
            client={client}
            token={token}
            sessionScope={sessionScope}
            credentialId={credentialId}
            internalNonce={internalNonce}
            siteId={siteId}
            selectedCamera={selectedCamera}
            selectedZone={selectedZone}
            frozenReference={drawingScope.reference}
            candidateReference={candidateReference}
            editingRegion={drawingScope.editingRegion}
            lastSavedDraft={lastSavedDraft}
            onAcceptCandidateReference={handleAcceptCandidateReference}
            onScopeRevoked={(status) => {
              revokeMutationScope(status, drawingScope.cameraId);
              setDrawingScope(null);
              setIsCandidateReviewOpen(false);
              setLastSavedDraft(null);
              setSavedRegionInfo(null);
            }}
            onCancelCandidateReview={() => setIsCandidateReviewOpen(false)}
            onSaveSuccess={handleSaveSuccess}
            onDraftStateChange={onDraftStateChange}
            onClose={() => {
              setDrawingScope(null);
              setIsCandidateReviewOpen(false);
            }}
          />
        )}
      </div>

      {/* Existing Linked Regions for Chosen Camera & Zone */}
      <div className="border-t border-slate-200/80 pt-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-w-0">
          <span className="text-xs font-bold text-slate-800">{t('regionSetup.list.heading')}</span>
          {!isCameraBaseError &&
            !isRegionBaseError &&
            Boolean(selectedCameraId) &&
            allFetchedRegions.length > 0 && (
              <span className="text-[11px] text-slate-500 font-normal">
                {t('regionSetup.list.countSummary', {
                  linked: visibleLinkedRegions.length,
                  loaded: allFetchedRegions.length,
                  total: regionServerTotal,
                })}
              </span>
            )}
        </div>

        {isRegionsInitialLoading && (
          <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
            {t('regionSetup.list.loading')}
          </div>
        )}

        {regionError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{getSafePublicErrorMessage(regionError, 'region', t)}</span>
          </div>
        )}

        {isRegionBaseError && (
          <div className="py-1">
            <button
              type="button"
              onClick={() => {
                if (regionsInfiniteQuery.isFetching) return;
                regionsInfiniteQuery.refetch({ cancelRefetch: false });
              }}
              disabled={regionsInfiniteQuery.isFetching}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
            >
              {regionsInfiniteQuery.isFetching
                ? t('regionSetup.list.retrying')
                : t('regionSetup.list.retryInitial')}
            </button>
          </div>
        )}

        {!isRegionsInitialLoading &&
          !isRegionBaseError &&
          Boolean(selectedCameraId) &&
          visibleLinkedRegions.length === 0 && (
            <>
              {regionsInfiniteQuery.hasNextPage ? (
                <div className="text-xs text-slate-500 italic py-1">
                  {t('regionSetup.list.emptyHasMore')}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-1">
                  {t('regionSetup.list.empty')}
                </div>
              )}
            </>
          )}

        {!selectedCameraId && !isCameraBaseError && !camerasInfiniteQuery.isLoading && (
          <div className="text-xs text-slate-500 italic py-1">
            {t('regionSetup.list.noCameraSelected')}
          </div>
        )}

        {visibleLinkedRegions.length > 0 && (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
            {visibleLinkedRegions.map((region) => {
              const editablePoints = extractRegionPolygonCoordinates(region.polygon);
              return (
                <div
                  key={region.id}
                  className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs min-w-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0 flex-1">
                    <span className="font-bold text-slate-900 break-all select-all font-mono text-[11px]">
                      {region.id}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600 shrink-0">
                      {t('regionSetup.list.versionStatus', {
                        version: region.version,
                        status: region.isActive
                          ? t('regionSetup.list.statusActive')
                          : t('regionSetup.list.statusInactive'),
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {editablePoints && (
                      <button
                        type="button"
                        onClick={() => handleStartEditingRegion(region, editablePoints)}
                        disabled={!canStartDrawing || isCurrentScopeActive}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
                      >
                        {t('regionSetup.list.editGeometry')}
                      </button>
                    )}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 shrink-0">
                      {region.coordinateSpace}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {isTransientNextRegionError && (
            <button
              type="button"
              onClick={() => {
                if (regionsInfiniteQuery.isFetching) return;
                regionsInfiniteQuery.fetchNextPage({ cancelRefetch: false });
              }}
              disabled={regionsInfiniteQuery.isFetching}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
            >
              {regionsInfiniteQuery.isFetching
                ? t('regionSetup.list.retryingMore')
                : t('regionSetup.list.retryNextPage')}
            </button>
          )}

          {!isRegionBaseError &&
            !isTransientNextRegionError &&
            regionsInfiniteQuery.hasNextPage && (
              <button
                type="button"
                onClick={() => {
                  if (regionsInfiniteQuery.isFetching) return;
                  regionsInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                }}
                disabled={regionsInfiniteQuery.isFetching}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {regionsInfiniteQuery.isFetching
                  ? t('regionSetup.list.loadingMore')
                  : t('regionSetup.list.loadMore')}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
