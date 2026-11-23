import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { loadAllPages } from '../workforce/load-all-pages';
import { FocusedCameraMedia } from '../ppe/FocusedCameraMedia';
import { useManagementClient } from '../../features/auth/auth-session';
import { authErrorMessage } from '../../features/auth/auth-errors';
import { localizedError, localizeMessage, userErrorMessage } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { localizedLabel, localizedDetectionLabel } from '../../i18n/labels';
import { useTranslation } from 'react-i18next';
import { useRealtimePreview } from '../cameras/useRealtimePreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import { useCameraApplicationStatus } from '../cameras/useCameraApplicationStatus';
import React, { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import './zone-monitor-catalog';
import {
  buildRegionPresentationList,
  buildZoneLookupMap,
  resolveZoneWorkerOperationalStatus,
  type ZonePolicyKind,
} from './zone-monitor-model';
import { Link, useInRouterContext, useSearchParams } from 'react-router-dom';
import { buildCameraSelectionSearch } from '../cameras/camera-navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import {
  IconX,
  IconAlertTriangle,
  IconClock,
  IconPlay,
  IconPause,
  IconVolume,
  IconMaximize,
  IconGrid,
  IconKey,
  IconCheck,
} from '../icons';
import {
  getZoneVideoTestDetections,
  loadAiVideoTimeline,
  type AiVideoTimeline,
  type VideoTestTimeline,
} from '../cameras/videoTestFixture';
import {
  buildAiWebSocketUrl,
  getEffectiveDetections,
  getPrimaryZoneDetection,
  getZoneEventRowKey,
  mapContainerPointToVideoNormalized,
  mapVideoNormalizedToContainerNormalized,
  exportZoneBrowserDraft,
  formatClockTime,
  resolveCameraAndWorkArea,
  filterZoneEvents,
  type NormalizedPoint,
  type Size2D,
} from '../cameras/monitoringUtils';
import {
  DEFAULT_ZONE_POLYGON,
  backendPolygonToPoints,
  clearLocalDraft,
  formatConflictMessage,
  isConflictError,
  isMutationScopeActive,
  planMutationCompletion,
  preparePolygonSave,
  resolveActivePolygon,
  saveLocalDraft,
  type ActiveScope,
  type RegionMutationResponse,
  type SavePolygonMutationVariables,
} from './zonePolygonAdapter';

interface ZoneReviewItem {
  id: string;
  rowKey: string;
  trackId: number;
  person: string;
  zone: string;
  camera: string;
  regionId?: string;
  unknownTrack?: boolean;
  identity: string;
  authorization: string;
  result: string;
  active: boolean;
  time: string;
}

export interface RestrictedZoneViewProps {
  linkedSiteId?: string;
  linkedCameraId?: string;
  authenticatedSession?: Pick<LoginResponse, 'accessToken' | 'user'>;
  onSignOut?: () => void;
  apiUrl?: string;
  onNavigate?: (
    tab: 'incidents',
    context?: {
      alertType?: 'RESTRICTED_ZONE_INTRUSION';
      siteId?: string;
      alertId?: string;
    },
  ) => void;
}

function RouterZoneSelectionBridge({
  children,
}: {
  children: (syncSelection: (siteId: string, cameraId?: string) => void) => React.ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const syncSelection = useCallback(
    (siteId: string, cameraId?: string) => {
      const nextParams = buildCameraSelectionSearch(searchParams.toString(), {
        siteId,
        cameraId,
      });
      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );
  return <>{children(syncSelection)}</>;
}

export function RestrictedZoneView(props: RestrictedZoneViewProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return (
      <RouterZoneSelectionBridge>
        {(onSyncUrlSelection) => (
          <RestrictedZoneViewInner {...props} onSyncUrlSelection={onSyncUrlSelection} />
        )}
      </RouterZoneSelectionBridge>
    );
  }
  return <RestrictedZoneViewInner {...props} />;
}

function RestrictedZoneViewInner({
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000',
  onNavigate,
  authenticatedSession,
  linkedSiteId,
  linkedCameraId,
  onSignOut,
  onSyncUrlSelection,
}: RestrictedZoneViewProps & {
  onSyncUrlSelection?: (siteId: string, cameraId?: string) => void;
}) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);

  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);

  const [localSession, setSession] = useState<LoginResponse | null>(null);
  const session = authenticatedSession ?? localSession;
  const externalSession = authenticatedSession !== undefined;
  // Application navigation must never fall back to the standalone replay fixture.
  const linkedMonitoring = externalSession;
  const canRead =
    !externalSession ||
    Boolean(
      session?.user.isActive &&
      !session.user.mustChangePassword &&
      session.user.roleAssignments.some(
        ({ role, siteId }) => siteId !== null && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(role),
      ),
    );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [requestedSiteId, setRequestedSiteId] = useState(
    linkedMonitoring ? (linkedSiteId ?? '') : '',
  );
  const [requestedCameraId, setRequestedCameraId] = useState(
    linkedMonitoring ? (linkedCameraId ?? '') : '',
  );
  const [requestedRegionId, setRequestedRegionId] = useState('');
  const nextLinkedSiteId = linkedMonitoring ? (linkedSiteId ?? '') : '';
  const nextLinkedCameraId = linkedMonitoring ? (linkedCameraId ?? '') : '';
  const [prevLinkedProps, setPrevLinkedProps] = useState({
    siteId: nextLinkedSiteId,
    cameraId: nextLinkedCameraId,
  });
  if (
    prevLinkedProps.siteId !== nextLinkedSiteId ||
    prevLinkedProps.cameraId !== nextLinkedCameraId
  ) {
    setPrevLinkedProps({ siteId: nextLinkedSiteId, cameraId: nextLinkedCameraId });
    if (prevLinkedProps.siteId !== nextLinkedSiteId) {
      setRequestedSiteId(nextLinkedSiteId);
      setRequestedCameraId(nextLinkedCameraId);
      setRequestedRegionId('');
    } else if (nextLinkedCameraId !== requestedCameraId) {
      setRequestedCameraId(nextLinkedCameraId);
      setRequestedRegionId('');
    }
  }
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [staleDraftInfo, setStaleDraftInfo] = useState<{ version: number } | null>(null);

  const activeScopeRef = useRef<ActiveScope>({
    userId: null,
    siteId: '',
    cameraId: '',
    regionId: '',
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const zoneWorkspaceRef = useRef<HTMLDivElement>(null);
  const inRouter = useInRouterContext();
  const [isZoneFullscreen, setIsZoneFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => {
      if (typeof document !== 'undefined' && zoneWorkspaceRef.current) {
        setIsZoneFullscreen(document.fullscreenElement === zoneWorkspaceRef.current);
      }
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleZoneFullscreen = async () => {
    const el = zoneWorkspaceRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el && typeof document.exitFullscreen === 'function') {
        await document.exitFullscreen();
        setIsZoneFullscreen(false);
      } else if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen();
        setIsZoneFullscreen(true);
      } else {
        setIsZoneFullscreen((prev) => !prev);
      }
    } catch {
      setIsZoneFullscreen((prev) => !prev);
    }
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<ZoneReviewItem | null>(null);
  const [videoTimeline, setVideoTimeline] = useState<VideoTestTimeline>({
    currentTime: 0,
    duration: 0,
  });
  const [aiTimeline, setAiTimeline] = useState<AiVideoTimeline | null>(null);
  const [zonePolygon, setZonePolygon] = useState<NormalizedPoint[]>(() => {
    const resolved = resolveActivePolygon({
      siteId: 'demo-site',
      cameraId: 'camera-04',
      cameraConfigurationVersion: 0,
      fallback: DEFAULT_ZONE_POLYGON,
    });
    return resolved.points;
  });
  const [isEditingZone, setIsEditingZone] = useState(false);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStatusMessage = useCallback(() => {
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    setSaveStatusMessage(null);
  }, []);

  const showStatusMessage = useCallback((message: string, durationMs = 4000) => {
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
    }
    setSaveStatusMessage(message);
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      setSaveStatusMessage(null);
    }, durationMs);
  }, []);

  const clearTransientFeedback = useCallback(() => {
    clearStatusMessage();
    setConflictMessage(null);
  }, [clearStatusMessage]);

  useEffect(() => clearStatusMessage, [clearStatusMessage]);
  const [clockTime, setClockTime] = useState<string>(() => formatClockTime());
  const [activeFilterWorker, setActiveFilterWorker] = useState<number | null>(null);
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'ACTIVE_ONLY'>('ALL');
  const activeZonePoint = useRef<number | null>(null);

  const [containerSize, setContainerSize] = useState<Size2D>({ width: 829, height: 466 });
  const [fixtureNaturalSize, setVideoNaturalSize] = useState<Size2D>({ width: 1920, height: 1080 });

  const rawUrl = import.meta.env.VITE_AI_WS_URL;
  const aiWsToken =
    import.meta.env.VITE_AI_BACKEND_SERVICE_TOKEN ??
    import.meta.env.VITE_AI_WS_TOKEN ??
    import.meta.env.VITE_AI_SERVICE_TOKEN ??
    '';

  const wsConfig = useMemo(() => {
    return buildAiWebSocketUrl(rawUrl, aiWsToken);
  }, [rawUrl, aiWsToken]);

  const {
    preview,
    connected: socketConnected,
    error: socketRuntimeError,
  } = useRealtimePreview(linkedMonitoring ? null : wsConfig.url);
  const liveZoneDetections = preview?.frame.zoneDetections ?? null;
  const videoNaturalSize = useMemo(
    () =>
      preview ? { width: preview.frame.width, height: preview.frame.height } : fixtureNaturalSize,
    [preview, fixtureNaturalSize],
  );
  const socketError = wsConfig.error ?? socketRuntimeError;

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(formatClockTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Track container dimensions for accurate object-cover polygon mapping
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const fallbackDetections = useMemo(
    () => getZoneVideoTestDetections(videoTimeline, aiTimeline),
    [videoTimeline, aiTimeline],
  );

  const { detections: zoneDetections, isLive } = getEffectiveDetections(
    liveZoneDetections,
    fallbackDetections,
  );

  // Bug 2: Prioritize first active intrusion track, then fallback to index 0
  const testDetection = useMemo(() => {
    return getPrimaryZoneDetection(zoneDetections);
  }, [zoneDetections]);

  const activeZoneDetections = useMemo(() => {
    return zoneDetections.filter((detection) => detection.active);
  }, [zoneDetections]);

  // Map zone polygon from video space to container space for SVG display under object-cover
  const displayPolygon = useMemo(() => {
    return zonePolygon.map((pt) =>
      mapVideoNormalizedToContainerNormalized(pt, containerSize, videoNaturalSize),
    );
  }, [zonePolygon, containerSize, videoNaturalSize]);

  // Bug 6: Coordinate mapping via actual video content area
  const updateZonePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointIndex = activeZonePoint.current;
    if (pointIndex === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const containerX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const containerY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    const videoPoint = mapContainerPointToVideoNormalized(
      [containerX, containerY],
      { width: rect.width, height: rect.height },
      videoNaturalSize,
    );

    setZonePolygon((previous) =>
      previous.map((point, index) => (index === pointIndex ? videoPoint : point)),
    );
  };

  const removeSessionQueries = useCallback(
    (userId: string) => {
      queryClient.removeQueries({ queryKey: ['zone-admin', apiUrl, userId] });
    },
    [apiUrl, queryClient],
  );

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      const isAssignedSiteManager = result.user.roleAssignments.some(
        ({ role, siteId }) => role === 'SITE_MANAGER' && siteId !== null,
      );
      if (!isAssignedSiteManager) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error(tSafety('zoneMonitor.standalone.roleRequired'));
      }
      if (result.user.mustChangePassword) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error(
          tr('restricted_zone_view.change_the_temporary_password_before_managing_camera_zones'),
        );
      }
      if (generation !== lifecycleGeneration.current) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error(tr('restricted_zone_view.the_sign_in_request_was_cancelled'));
      }
      activeSession.current = { token: result.accessToken, userId: result.user.id };
      setSession(result);
      setPassword('');
      setLoginError(null);
    },
    onError: (err) => {
      setLoginError(err instanceof ApiError ? authErrorMessage(err) : userErrorMessage(err));
    },
  });

  useEffect(() => {
    if (authenticatedSession)
      activeSession.current = {
        token: authenticatedSession.accessToken,
        userId: authenticatedSession.user.id,
      };
  }, [authenticatedSession]);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (!current) return;
      removeSessionQueries(current.userId);
      if (!externalSession) void client.logout('WEB').catch(() => undefined);
    };
  }, [client, removeSessionQueries, externalSession]);

  const handleLogout = () => {
    if (externalSession) {
      onSignOut?.();
      return;
    }
    const current = activeSession.current;
    activeSession.current = null;
    activeScopeRef.current = { userId: null, siteId: '', cameraId: '', regionId: '' };
    clearTransientFeedback();
    if (current) removeSessionQueries(current.userId);
    login.reset();
    setSession(null);
    setRequestedSiteId('');
    setRequestedCameraId('');
    setRequestedRegionId('');
    setIsDraftMode(false);
    setStaleDraftInfo(null);
    if (current) void client.logout('WEB').catch(() => undefined);
  };

  const apiToken = session?.accessToken ?? '';
  const sessionScope = session?.user.id ?? '';

  const sites = useQuery({
    queryKey: ['zone-admin', apiUrl, sessionScope, 'sites'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(apiToken, options, { signal }), signal),
    enabled: !!canRead && apiToken.length > 0,
  });

  const scopedSites =
    sites.data?.items.filter((site) =>
      session?.user.roleAssignments.some(
        (r) => r.siteId === site.id && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(r.role),
      ),
    ) ?? [];
  const selectedSiteId =
    (!linkedMonitoring || sites.isSuccess) &&
    scopedSites.some((site) => site.id === requestedSiteId)
      ? requestedSiteId
      : linkedMonitoring && requestedSiteId === linkedSiteId
        ? ''
        : (scopedSites[0]?.id ?? '');
  const canConfigure =
    !session ||
    session.user.roleAssignments.some(
      (r) => r.role === 'SITE_MANAGER' && r.siteId === selectedSiteId,
    );

  const cameras = useQuery({
    queryKey: ['zone-admin', apiUrl, sessionScope, selectedSiteId, 'cameras'],
    queryFn: async () => {
      const page = await client.listCameras(apiToken, selectedSiteId, { limit: 100 });
      return { ...page, items: page.items.filter((camera) => camera.type !== 'GATE') };
    },
    enabled: !!canRead && apiToken.length > 0 && selectedSiteId.length > 0,
  });

  const scopedCameras = linkedMonitoring
    ? (cameras.isSuccess ? cameras.data.items : []).filter(
        (camera) => camera.siteId === selectedSiteId && camera.status === 'ACTIVE',
      )
    : (cameras.data?.items ?? []);
  const selectedCameraId = scopedCameras.some((cam) => cam.id === requestedCameraId)
    ? requestedCameraId
    : linkedMonitoring && requestedCameraId === linkedCameraId
      ? ''
      : (scopedCameras[0]?.id ?? '');

  const selectedCamera = useMemo(
    () => cameras.data?.items.find((c) => c.id === selectedCameraId),
    [cameras.data?.items, selectedCameraId],
  );

  const regions = useQuery({
    queryKey: ['zone-admin', apiUrl, sessionScope, selectedSiteId, selectedCameraId, 'regions'],
    queryFn: () => client.listRegions(apiToken, selectedSiteId, selectedCameraId, { limit: 100 }),
    enabled:
      !!canRead && apiToken.length > 0 && selectedSiteId.length > 0 && selectedCameraId.length > 0,
  });

  const activeRegions = useMemo(
    () => regions.data?.items.filter((r) => r.isActive) ?? [],
    [regions.data?.items],
  );

  const selectableRegions = useMemo(
    () => (activeRegions.length > 0 ? activeRegions : (regions.data?.items ?? [])),
    [activeRegions, regions.data?.items],
  );

  const selectedRegionId = selectableRegions.some((r) => r.id === requestedRegionId)
    ? requestedRegionId
    : (selectableRegions[0]?.id ?? '');

  const selectedRegion = useMemo(
    () => selectableRegions.find((r) => r.id === selectedRegionId),
    [selectableRegions, selectedRegionId],
  );

  const aiWorkPaused = import.meta.env.VITE_AI_WORK_PAUSED === 'true';

  const siteZones = useQuery({
    queryKey: ['zone-admin', apiUrl, sessionScope, selectedSiteId, 'zones'],
    queryFn: ({ signal }) =>
      loadAllPages(
        (options) => client.listZones(apiToken, selectedSiteId, options, { signal }),
        signal,
      ),
    enabled:
      !!canRead &&
      apiToken.length > 0 &&
      selectedSiteId.length > 0 &&
      typeof client.listZones === 'function',
    retry: false,
  });

  const zonesById = useMemo(
    () => buildZoneLookupMap(siteZones.isSuccess ? siteZones.data.items : undefined),
    [siteZones.isSuccess, siteZones.data],
  );

  const regionPresentations = useMemo(
    () => buildRegionPresentationList(selectableRegions, zonesById),
    [selectableRegions, zonesById],
  );

  const selectedRegionPresentation = useMemo(
    () => regionPresentations.find((entry) => entry.region.id === selectedRegionId) ?? null,
    [regionPresentations, selectedRegionId],
  );

  const handleApplicationStatusUnauthorized = useCallback(() => {
    if (externalSession) {
      onSignOut?.();
    }
  }, [externalSession, onSignOut]);

  const applicationStatusContext =
    selectedCamera && selectedSiteId && apiToken
      ? {
          setupKey: ['zone-admin', apiUrl, sessionScope],
          token: apiToken,
          siteId: selectedSiteId,
          client,
          enabled: Boolean(
            linkedMonitoring && canRead && typeof client.getCameraApplicationStatus === 'function',
          ),
          onUnauthorized: handleApplicationStatusUnauthorized,
        }
      : undefined;

  const cameraApplicationStatus = useCameraApplicationStatus(
    selectedCamera ?? { id: '', siteId: selectedSiteId, configurationVersion: 0 },
    applicationStatusContext,
  );

  const workerOperationalStatus = resolveZoneWorkerOperationalStatus(
    cameraApplicationStatus,
    aiWorkPaused,
  );

  useEffect(() => {
    activeScopeRef.current = {
      userId: session?.user.id ?? null,
      siteId: selectedSiteId,
      cameraId: selectedCameraId,
      regionId: selectedRegionId,
    };
  }, [session?.user.id, selectedSiteId, selectedCameraId, selectedRegionId]);

  const currentScopeKey = session
    ? `${selectedSiteId}:${selectedCameraId}:${selectedRegion?.id ?? 'none'}:v${selectedRegion?.version ?? 0}:c${selectedCamera?.configurationVersion ?? 0}`
    : 'fallback-camera-04';
  const currentIdentityScopeKey = session
    ? `${session.user.id}:${selectedSiteId}:${selectedCameraId}:${selectedRegion?.id ?? 'none'}`
    : 'fallback-camera-04';

  const [prevScopeKey, setPrevScopeKey] = useState(currentScopeKey);
  const [prevIdentityScopeKey, setPrevIdentityScopeKey] = useState(currentIdentityScopeKey);

  if (prevScopeKey !== currentScopeKey) {
    setPrevScopeKey(currentScopeKey);
    if (prevIdentityScopeKey !== currentIdentityScopeKey) {
      setPrevIdentityScopeKey(currentIdentityScopeKey);
      setConflictMessage(null);
      setSaveStatusMessage(null);
    }
    const resolved = resolveActivePolygon({
      siteId: selectedSiteId || undefined,
      cameraId: selectedCameraId || undefined,
      regionId: selectedRegion?.id,
      cameraConfigurationVersion: selectedCamera?.configurationVersion,
      backendPolygon: selectedRegion?.polygon,
      fallback: DEFAULT_ZONE_POLYGON,
    });
    setZonePolygon(resolved.points);
    setIsDraftMode(resolved.isDraft);
    setStaleDraftInfo(
      resolved.staleDraftVersion !== null ? { version: resolved.staleDraftVersion } : null,
    );
    setIsEditingZone(false);
  }

  const savePolygonMutation = useMutation<
    RegionMutationResponse,
    unknown,
    SavePolygonMutationVariables
  >({
    mutationFn: async (vars: SavePolygonMutationVariables) => {
      const token = vars.token || activeSession.current?.token;
      if (!token || !activeSession.current || activeSession.current.userId !== vars.userId) {
        throw new Error(tSafety('zoneMonitor.standalone.signInBeforeSave'));
      }
      const payload = preparePolygonSave(
        { configurationVersion: vars.expectedConfigurationVersion },
        vars.points,
      );
      return client.updatePolygon(token, vars.siteId, vars.cameraId, vars.regionId, payload);
    },
    onSuccess: async (mutationResult, vars) => {
      const plan = planMutationCompletion(apiUrl, vars);

      // Always clear the draft and invalidate queries for the saved scope
      clearLocalDraft(
        plan.draftScopeToClear.siteId,
        plan.draftScopeToClear.cameraId,
        plan.draftScopeToClear.regionId,
      );
      await queryClient.invalidateQueries({ queryKey: plan.invalidateSiteCamerasKey });
      await queryClient.invalidateQueries({ queryKey: plan.invalidateCameraRegionsKey });

      // Invalidation is asynchronous. Re-evaluate the live scope after every
      // await so a completion from camera A cannot modify camera B's UI.
      if (isMutationScopeActive(activeScopeRef.current, vars)) {
        setConflictMessage(null);
        setStaleDraftInfo(null);
        setIsDraftMode(false);
        setIsEditingZone(false);
        showStatusMessage(
          tr('messages.f08e5d419230', {
            value1: vars.cameraLabel,
            value2: mutationResult.configurationVersion,
          }),
          5000,
        );
      }
    },
    onError: async (error, vars) => {
      const plan = planMutationCompletion(apiUrl, vars);

      if (isConflictError(error)) {
        await queryClient.invalidateQueries({ queryKey: plan.invalidateSiteCamerasKey });
        await queryClient.invalidateQueries({ queryKey: plan.invalidateCameraRegionsKey });
      }

      if (isMutationScopeActive(activeScopeRef.current, vars)) {
        if (isConflictError(error)) {
          setConflictMessage(formatConflictMessage(vars.cameraLabel));
        } else {
          showStatusMessage(userErrorMessage(error), 5000);
        }
      }
    },
  });

  const handleSaveToBackend = () => {
    if (!canConfigure) return;
    if (!session || !apiToken) return;
    if (!selectedSiteId || !selectedCamera || !selectedRegion) return;
    const vars: SavePolygonMutationVariables = {
      userId: session.user.id,
      token: apiToken,
      siteId: selectedSiteId,
      cameraId: selectedCamera.id,
      regionId: selectedRegion.id,
      cameraLabel: selectedCamera.code || selectedCamera.name || 'camera',
      expectedConfigurationVersion: selectedCamera.configurationVersion,
      points: zonePolygon,
    };
    savePolygonMutation.mutate(vars);
  };

  const saveDraft = () => {
    if (session) {
      if (!selectedSiteId || !selectedCameraId || !selectedCamera || !selectedRegion) {
        showStatusMessage(
          tr('restricted_zone_view.wait_for_a_site_camera_and_region_before_saving_a_local_draft'),
        );
        return;
      }
      saveLocalDraft(
        selectedSiteId,
        selectedCameraId,
        selectedRegion.id,
        selectedCamera.configurationVersion,
        zonePolygon,
      );
      setIsDraftMode(true);
      setStaleDraftInfo(null);
      showStatusMessage(
        tr('messages.9b05f9ea0d7a', {
          value1: selectedCamera.code,
          value2: selectedCamera.configurationVersion,
        }),
      );
    } else {
      saveLocalDraft('demo-site', 'camera-04', 'default', 0, zonePolygon);
      setIsDraftMode(true);
      setStaleDraftInfo(null);
      showStatusMessage(tr('restricted_zone_view.saved_to_browser_local_storage_camera_04_draft'));
    }
    setIsEditingZone(false);
  };

  const resetToAuthoritative = () => {
    if (session && selectedSiteId && selectedCameraId && selectedRegion) {
      clearLocalDraft(selectedSiteId, selectedCameraId, selectedRegion.id);
      const authoritative = backendPolygonToPoints(selectedRegion.polygon, DEFAULT_ZONE_POLYGON);
      setZonePolygon(authoritative);
      setIsDraftMode(false);
      setConflictMessage(null);
      setStaleDraftInfo(null);
      showStatusMessage(tr('restricted_zone_view.restored_authoritative_server_polygon'));
    } else {
      clearLocalDraft('demo-site', 'camera-04', 'default');
      setZonePolygon(DEFAULT_ZONE_POLYGON);
      setIsDraftMode(false);
      setStaleDraftInfo(null);
      showStatusMessage(tr('restricted_zone_view.reset_to_default_region'));
    }
  };

  const activeCameraContext = useMemo(() => {
    if (preview) {
      return resolveCameraAndWorkArea(
        preview.frame.cameraExternalId,
        testDetection?.regionId,
        t('monitoring_utils.chua_co_ma_camera'),
      );
    }
    if (selectedCamera) {
      const regionLabel = selectedRegionPresentation
        ? `${
            selectedRegionPresentation.zoneName ?? tSafety('zoneMonitor.region.zoneUnavailable')
          } · ${tSafety(selectedRegionPresentation.policyLabelKey)} · ${tSafety(
            'zoneMonitor.region.tag',
            {
              ordinal: selectedRegionPresentation.ordinalInZone,
              version: selectedRegionPresentation.region.version,
            },
          )}`
        : t('common.restricted_zone');
      return {
        camera: `${selectedCamera.code} · ${selectedCamera.name}`,
        workArea: regionLabel,
      };
    }
    const rawCamera = testDetection?.cameraExternalId || aiTimeline?.cameraExternalId;
    return resolveCameraAndWorkArea(rawCamera, testDetection?.regionId, 'CAM-04');
  }, [preview, selectedCamera, selectedRegionPresentation, testDetection, aiTimeline, t, tSafety]);

  const exportZone = () => {
    const cameraLabel = selectedCamera ? selectedCamera.code : activeCameraContext.camera;
    const draft = exportZoneBrowserDraft(zonePolygon, cameraLabel);
    const blobUrl = URL.createObjectURL(new Blob([draft.content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = draft.filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
    showStatusMessage(
      tr('messages.b32fcd975931', { value1: draft.filename, value2: draft.label }),
      5000,
    );
  };

  useEffect(() => {
    if (linkedMonitoring) return;
    let cancelled = false;
    void loadAiVideoTimeline('/assets/zone-ai.timeline.json')
      .then((timeline) => {
        if (!cancelled) setAiTimeline(timeline);
      })
      .catch(() => {
        if (!cancelled) setAiTimeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [linkedMonitoring]);

  const updateVideoTimeline = (video: HTMLVideoElement) => {
    setVideoTimeline({ currentTime: video.currentTime, duration: video.duration });
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  // Bug 5: Key zone = eventId + trackId
  const events: ZoneReviewItem[] = useMemo(() => {
    return (aiTimeline?.entries ?? [])
      .flatMap((entry) =>
        entry.event.observations
          .filter((observation) => observation.type === 'ZONE_ENTRY')
          .map((observation) => {
            const context = resolveCameraAndWorkArea(
              entry.event.cameraExternalId,
              observation.regionId,
              'CAM-04',
            );
            return {
              id: entry.event.eventId,
              rowKey: getZoneEventRowKey(entry.event.eventId, observation.trackId),
              trackId: observation.trackId,
              time: `${Math.floor(entry.videoTimeSeconds / 60)
                .toString()
                .padStart(2, '0')}:${Math.floor(entry.videoTimeSeconds % 60)
                .toString()
                .padStart(2, '0')}`,
              person: t('messages.2c6bb8488230', { value1: observation.trackId }),
              zone: context.workArea,
              camera: context.camera,
              regionId: observation.regionId,
              identity: t('common.unknown'),
              authorization: t('common.backend_evaluation_required'),
              result: t('common.technical_entry'),
              active: true,
            };
          }),
      )
      .slice(-20)
      .reverse();
  }, [aiTimeline, t]);

  // Truly filters the loaded Zone events list
  const displayedEvents = useMemo(() => {
    return filterZoneEvents(events, {
      workerTrackId: activeFilterWorker,
      activeOnly: zoneFilter === 'ACTIVE_ONLY',
    });
  }, [events, activeFilterWorker, zoneFilter]);

  const openReviewFromDetection = () => {
    if (!testDetection) return;
    const context = resolveCameraAndWorkArea(
      testDetection.cameraExternalId || aiTimeline?.cameraExternalId,
      testDetection.regionId,
      tr('common.cam_04'),
    );
    setSelectedIncident({
      id: testDetection.eventId,
      rowKey: `${testDetection.eventId}-${testDetection.trackId ?? 0}`,
      trackId: testDetection.trackId ?? 0,
      person:
        testDetection.trackId !== null
          ? tr('messages.2c6bb8488230', { value1: testDetection.trackId })
          : tr('common.unknown_person'),
      zone: context.workArea,
      camera: context.camera,
      regionId: testDetection.regionId,
      unknownTrack: testDetection.trackId === null,
      identity: tr('common.unknown'),
      authorization: tr('common.backend_evaluation_required'),
      result: testDetection.active
        ? tr('common.zone_entry_observation_f1b9fa')
        : tr('common.scanning_video_e63c77'),
      active: testDetection.active,
      time: isLive ? clockTime : testDetection.timecode,
    });
  };

  const selectedSite = sites.data?.items.find((s) => s.id === selectedSiteId);
  const canAccessCameraSetup = Boolean(
    session?.user.roleAssignments.some(
      ({ role, siteId: rSiteId }) =>
        role === 'SITE_MANAGER' && (selectedSiteId ? rSiteId === selectedSiteId : rSiteId !== null),
    ),
  );
  const canViewSafetyRecords = Boolean(
    selectedSiteId &&
    session?.user.roleAssignments.some(
      ({ role, siteId: rSiteId }) => role === 'SAFETY_OFFICER' && rSiteId === selectedSiteId,
    ),
  );
  const activeRoleLabelKey = session?.user.roleAssignments.some(
    ({ role, siteId: rSiteId }) =>
      role === 'SITE_MANAGER' && (!selectedSiteId || rSiteId === selectedSiteId),
  )
    ? 'accounts.role.SITE_MANAGER'
    : 'accounts.role.SAFETY_OFFICER';
  const cameraSetupParams = new URLSearchParams();
  if (selectedSiteId) cameraSetupParams.set('siteId', selectedSiteId);
  if (selectedCameraId) cameraSetupParams.set('cameraId', selectedCameraId);
  const cameraSetupHref =
    cameraSetupParams.size > 0 ? `/camera-setup?${cameraSetupParams}` : '/camera-setup';
  const editPolygonParams = new URLSearchParams(cameraSetupParams);
  editPolygonParams.set('action', 'regions');
  if (selectedRegionId) editPolygonParams.set('regionId', selectedRegionId);
  const editPolygonHref = `/camera-setup?${editPolygonParams}`;

  if (linkedMonitoring) {
    const setupButtonClass = isZoneFullscreen
      ? 'inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white sm:whitespace-nowrap hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
      : 'inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 sm:whitespace-nowrap hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
    const selectControlClass = isZoneFullscreen
      ? 'h-10 min-h-10 flex-1 min-w-0 max-w-full truncate rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-normal text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50'
      : 'h-10 min-h-10 flex-1 min-w-0 max-w-full truncate rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-normal text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500';
    const selectLabelClass = isZoneFullscreen
      ? 'flex w-full sm:w-auto sm:flex-[1_1_12rem] lg:max-w-[16rem] flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 text-sm font-semibold text-slate-200'
      : 'flex w-full sm:w-auto sm:flex-[1_1_12rem] lg:max-w-[16rem] flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 text-sm font-semibold text-slate-700';
    const regionSelectLabelClass = isZoneFullscreen
      ? 'flex w-full sm:w-auto sm:flex-[1.5_1_16rem] lg:max-w-[26rem] flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 text-sm font-semibold text-slate-200'
      : 'flex w-full sm:w-auto sm:flex-[1.5_1_16rem] lg:max-w-[26rem] flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 text-sm font-semibold text-slate-700';
    const policyBadgeClass = (kind: ZonePolicyKind) => {
      if (kind === 'PROHIBITED') {
        return isZoneFullscreen
          ? 'border-rose-400/35 bg-rose-500/15 text-rose-200'
          : 'border-rose-200 bg-rose-50 text-rose-800';
      }
      if (kind === 'AUTHORIZATION_REQUIRED') {
        return isZoneFullscreen
          ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
          : 'border-amber-200 bg-amber-50 text-amber-900';
      }
      return isZoneFullscreen
        ? 'border-white/20 bg-white/10 text-slate-200'
        : 'border-slate-200 bg-slate-100 text-slate-700';
    };
    const workerToneStyle = (() => {
      switch (workerOperationalStatus.tone) {
        case 'emerald':
          return {
            dot: 'bg-emerald-600',
            pill: isZoneFullscreen
              ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900',
          };
        case 'amber':
          return {
            dot: 'bg-amber-500',
            pill: isZoneFullscreen
              ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
              : 'border-amber-200 bg-amber-50 text-amber-950',
          };
        case 'rose':
          return {
            dot: 'bg-rose-600',
            pill: isZoneFullscreen
              ? 'border-rose-400/35 bg-rose-500/15 text-rose-200'
              : 'border-rose-200 bg-rose-50 text-rose-900',
          };
        default:
          return {
            dot: isZoneFullscreen ? 'bg-slate-400' : 'bg-slate-400',
            pill: isZoneFullscreen
              ? 'border-white/20 bg-white/10 text-slate-200'
              : 'border-slate-200 bg-slate-100 text-slate-700',
          };
      }
    })();

    return (
      <div
        ref={zoneWorkspaceRef}
        data-testid="restricted-zone-fullwidth-workspace"
        data-monitor-fullscreen={isZoneFullscreen ? 'true' : undefined}
        className={
          isZoneFullscreen
            ? 'min-h-screen w-full min-w-0 space-y-3 bg-slate-950 p-3 sm:p-4 text-white overflow-y-auto'
            : 'w-full min-w-0 space-y-3 pb-0 text-slate-900'
        }
      >
        {!canRead ? (
          <p
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-950"
          >
            {tr('auth.error.forbidden')}
          </p>
        ) : (
          <>
            <header
              className={
                isZoneFullscreen
                  ? 'flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between rounded-xl border border-white/15 bg-slate-900 px-4 py-2.5 text-white'
                  : 'flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between'
              }
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1
                    className={`text-2xl sm:text-[1.75rem] font-bold tracking-tight ${
                      isZoneFullscreen ? 'text-white' : 'text-slate-950'
                    }`}
                  >
                    {tr('common.restricted_zone_monitoring')}
                  </h1>
                  {session &&
                    (() => {
                      const roleLabel = tr(activeRoleLabelKey);
                      const displayName = session.user.displayName;
                      const nameIncludesRole = displayName
                        .toLowerCase()
                        .includes(roleLabel.toLowerCase());
                      return (
                        <span
                          className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-xs font-medium ${
                            isZoneFullscreen
                              ? 'border-white/20 bg-white/10 text-slate-200'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span>{displayName}</span>
                          {!nameIncludesRole && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{roleLabel}</span>
                            </>
                          )}
                        </span>
                      );
                    })()}
                </div>
                <p className={`text-sm ${isZoneFullscreen ? 'text-slate-300' : 'text-slate-600'}`}>
                  {tSafety('zoneMonitor.header.subtitle')}
                </p>
              </div>

              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                {canAccessCameraSetup &&
                  selectedCameraId &&
                  (inRouter ? (
                    <Link
                      to={editPolygonHref}
                      data-testid="zones-edit-polygon-link"
                      className={setupButtonClass}
                    >
                      {tSafety('zoneMonitor.toolbar.editPolygon')}
                    </Link>
                  ) : (
                    <a
                      href={editPolygonHref}
                      data-testid="zones-edit-polygon-link"
                      className={setupButtonClass}
                    >
                      {tSafety('zoneMonitor.toolbar.editPolygon')}
                    </a>
                  ))}
                {canAccessCameraSetup &&
                  (inRouter ? (
                    <Link to={cameraSetupHref} className={setupButtonClass}>
                      {tr('shell.cameraSetup')}
                    </Link>
                  ) : (
                    <a href={cameraSetupHref} className={setupButtonClass}>
                      {tr('shell.cameraSetup')}
                    </a>
                  ))}
                {onNavigate && canViewSafetyRecords && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('incidents', {
                        alertType: 'RESTRICTED_ZONE_INTRUSION',
                        siteId: selectedSiteId || undefined,
                      })
                    }
                    className={`inline-flex min-h-10 max-w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold sm:whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      isZoneFullscreen
                        ? 'bg-white text-slate-950 hover:bg-slate-100 focus-visible:outline-white'
                        : 'bg-[#0F172A] text-white hover:bg-slate-800 focus-visible:outline-slate-900'
                    }`}
                  >
                    {tr('shell.incidents')}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="zones-fullscreen-toggle"
                  aria-pressed={isZoneFullscreen}
                  onClick={() => void toggleZoneFullscreen()}
                  className={`inline-flex min-h-10 max-w-full items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium sm:whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    isZoneFullscreen
                      ? 'border-white/25 bg-white/15 text-white hover:bg-white/25 focus-visible:outline-white'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-900'
                  }`}
                >
                  <IconMaximize className="h-4 w-4 shrink-0" />
                  <span>{tr('common.fullscreen')}</span>
                </button>
              </div>
            </header>

            <section
              aria-label={tr('common.restricted_zone_monitoring')}
              className={
                isZoneFullscreen
                  ? 'min-w-0 space-y-2.5 rounded-xl border border-white/15 bg-slate-900 px-3.5 py-2.5 text-white'
                  : 'min-w-0 space-y-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-2xs'
              }
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <label className={selectLabelClass}>
                  <span className="shrink-0">{tr('common.site_fa7955')}</span>
                  <SmartNativeSelect
                    value={selectedSiteId}
                    onChange={(e) => {
                      const nextSiteId = e.target.value;
                      activeScopeRef.current = {
                        userId: session?.user.id ?? null,
                        siteId: nextSiteId,
                        cameraId: '',
                        regionId: '',
                      };
                      clearTransientFeedback();
                      setRequestedSiteId(nextSiteId);
                      setRequestedCameraId('');
                      setRequestedRegionId('');
                      if (linkedMonitoring) {
                        onSyncUrlSelection?.(nextSiteId);
                      }
                    }}
                    disabled={sites.isPending || !scopedSites.length}
                    className={selectControlClass}
                  >
                    {!selectedSiteId && <option value="">{tr('common.unavailable')}</option>}
                    {scopedSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.code} · {site.name}
                      </option>
                    ))}
                  </SmartNativeSelect>
                </label>

                <label className={selectLabelClass}>
                  <span className="shrink-0">{tr('common.camera')}</span>
                  <SmartNativeSelect
                    value={selectedCameraId}
                    onChange={(e) => {
                      const nextCamId = e.target.value;
                      activeScopeRef.current = {
                        userId: session?.user.id ?? null,
                        siteId: selectedSiteId,
                        cameraId: nextCamId,
                        regionId: '',
                      };
                      clearTransientFeedback();
                      setRequestedCameraId(nextCamId);
                      setRequestedRegionId('');
                      if (linkedMonitoring) {
                        onSyncUrlSelection?.(selectedSiteId, nextCamId);
                      }
                    }}
                    disabled={cameras.isPending || !scopedCameras.length}
                    className={selectControlClass}
                  >
                    {!selectedCameraId && <option value="">{tr('common.select_camera')}</option>}
                    {scopedCameras.map((camera) => (
                      <option key={camera.id} value={camera.id}>
                        {camera.code ? `${camera.code} · ${camera.name}` : camera.name}
                      </option>
                    ))}
                  </SmartNativeSelect>
                </label>

                <label className={regionSelectLabelClass}>
                  <span className="shrink-0">{tr('common.region_zone')}</span>
                  <SmartNativeSelect
                    value={selectedRegionId}
                    onChange={(e) => {
                      const nextRegId = e.target.value;
                      activeScopeRef.current = {
                        userId: session?.user.id ?? null,
                        siteId: selectedSiteId,
                        cameraId: selectedCameraId,
                        regionId: nextRegId,
                      };
                      clearTransientFeedback();
                      setRequestedRegionId(nextRegId);
                    }}
                    disabled={regions.isPending || regionPresentations.length === 0}
                    className={selectControlClass}
                  >
                    {regionPresentations.length === 0 && (
                      <option value="">{tr('common.no_resolved_zone')}</option>
                    )}
                    {regionPresentations.map((entry) => (
                      <option key={entry.region.id} value={entry.region.id}>
                        {tSafety(
                          entry.region.isActive
                            ? 'zoneMonitor.region.option'
                            : 'zoneMonitor.region.optionInactive',
                          {
                            zone: entry.zoneName ?? tSafety('zoneMonitor.region.zoneUnavailable'),
                            policy: tSafety(entry.policyLabelKey),
                            ordinal: entry.ordinalInZone,
                            version: entry.region.version,
                          },
                        )}
                      </option>
                    ))}
                  </SmartNativeSelect>
                </label>
              </div>

              {(selectedRegionPresentation ||
                selectedCamera ||
                (!regions.isPending && regionPresentations.length === 0)) && (
                <div
                  className={`flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-2 ${
                    isZoneFullscreen ? 'border-white/10' : 'border-slate-100'
                  }`}
                >
                  <div
                    data-testid="zone-monitor-selected-region-context"
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm"
                  >
                    {selectedRegionPresentation ? (
                      <>
                        <span
                          className={`min-w-0 max-w-full font-semibold break-words [overflow-wrap:anywhere] ${
                            selectedRegionPresentation.zoneName
                              ? isZoneFullscreen
                                ? 'text-white'
                                : 'text-slate-900'
                              : isZoneFullscreen
                                ? 'text-slate-300'
                                : 'text-slate-600'
                          }`}
                        >
                          {selectedRegionPresentation.zoneName ??
                            tSafety('zoneMonitor.region.zoneUnavailable')}
                        </span>
                        <span
                          data-testid="zone-monitor-selected-policy"
                          data-policy-kind={selectedRegionPresentation.policyKind}
                          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${policyBadgeClass(
                            selectedRegionPresentation.policyKind,
                          )}`}
                        >
                          {tSafety(selectedRegionPresentation.policyLabelKey)}
                        </span>
                        <span
                          className={`font-mono text-xs font-medium tabular-nums ${
                            isZoneFullscreen ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {tSafety('zoneMonitor.region.tag', {
                            ordinal: selectedRegionPresentation.ordinalInZone,
                            version: selectedRegionPresentation.region.version,
                          })}
                          {!selectedRegionPresentation.region.isActive
                            ? ` · ${tSafety('zoneMonitor.inspectorRail.regionInactive')}`
                            : ''}
                        </span>
                      </>
                    ) : !regions.isPending && selectedCamera ? (
                      <span
                        className={`text-xs font-medium ${
                          isZoneFullscreen ? 'text-slate-300' : 'text-slate-600'
                        }`}
                      >
                        {tSafety('zoneMonitor.region.noneConfigured')}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ml-auto">
                    {selectedCamera && (
                      <>
                        <span
                          data-testid="zone-monitor-saved-config"
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${
                            isZoneFullscreen
                              ? 'border-white/20 bg-white/10 text-slate-200'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                          }`}
                        >
                          {tSafety('zoneMonitor.status.savedConfig', {
                            version: selectedCamera.configurationVersion,
                          })}
                        </span>
                        {aiWorkPaused && (
                          <span
                            data-testid="zone-monitor-ai-paused"
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                              isZoneFullscreen
                                ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
                                : 'border-amber-200 bg-amber-50 text-amber-950'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                            />
                            <span>{tSafety('zoneMonitor.status.aiPaused')}</span>
                          </span>
                        )}
                        <span
                          data-testid="zone-monitor-worker-status"
                          data-worker-state={workerOperationalStatus.state}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${workerToneStyle.pill}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${workerToneStyle.dot}`}
                          />
                          <span>
                            {tSafety(workerOperationalStatus.labelKey, {
                              version:
                                workerOperationalStatus.reportedRevision ??
                                selectedCamera.configurationVersion,
                            })}
                          </span>
                        </span>
                      </>
                    )}
                    <details className="relative text-xs">
                      <summary
                        className={`inline-flex min-h-8 cursor-pointer items-center rounded-lg border px-2.5 py-1 text-xs font-medium select-none focus-visible:outline-2 focus-visible:outline-offset-2 ${
                          isZoneFullscreen
                            ? 'border-white/20 bg-white/10 text-slate-200 hover:bg-white/20 focus-visible:outline-white'
                            : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-900'
                        }`}
                      >
                        {tSafety('zoneMonitor.toolbar.boundarySummary')}
                      </summary>
                      <p
                        className={`mt-2 max-w-md rounded-lg border p-3 text-xs leading-relaxed sm:absolute sm:right-0 sm:z-20 sm:w-80 sm:shadow-lg ${
                          isZoneFullscreen
                            ? 'border-slate-700 bg-slate-900 text-slate-200'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {tSafety('zoneMonitor.inspectorRail.aiBoundaryNote')}
                      </p>
                    </details>
                  </div>
                </div>
              )}
            </section>

            <div className="min-w-0">
              {session && selectedCamera ? (
                <FocusedCameraMedia
                  key={JSON.stringify([sessionScope, selectedSiteId, selectedCameraId])}
                  apiUrl={apiUrl}
                  client={client}
                  token={apiToken}
                  sessionScope={sessionScope}
                  siteId={selectedSiteId}
                  siteCode={selectedSite?.code}
                  siteName={selectedSite?.name}
                  camera={selectedCamera}
                  observationMode="zone"
                  aiPaused={import.meta.env.VITE_AI_WORK_PAUSED === 'true'}
                />
              ) : session && !sites.isPending && (!selectedSiteId || !cameras.isPending) ? (
                <p
                  role="status"
                  className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
                >
                  {tr('errors.cameraUnavailable')}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Admin Session & Backend Camera/Region Configuration Bar */}
      {!canRead ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          {tr('auth.error.forbidden')}
        </p>
      ) : !session ? (
        <div className="rounded-xl border border-[#EAEAEA] bg-white p-4 ">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-[#F66B17]">
                  <IconKey className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-bold text-[#2F3437]">
                  {tSafety('zoneMonitor.standalone.title')}
                </h2>
              </div>
              <p className="mt-1 text-xs text-[#6B6B6B] max-w-xl">
                {tSafety('zoneMonitor.standalone.signInHint')}
              </p>
            </div>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                login.mutate();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                required
                type="text"
                autoComplete="username"
                placeholder={tSafety('zoneMonitor.standalone.usernameLabel')}
                aria-label={tSafety('zoneMonitor.standalone.usernameLabel')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-lg border border-[#EAEAEA] px-2.5 py-1.5 text-xs text-[#2F3437] placeholder:text-[#6B6B6B] focus:border-[#F66B17] focus:ring-1 focus:ring-[#F66B17] outline-none"
              />
              <input
                required
                type="password"
                autoComplete="current-password"
                placeholder={tr('common.password')}
                aria-label={tr('common.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-[#EAEAEA] px-2.5 py-1.5 text-xs text-[#2F3437] placeholder:text-[#6B6B6B] focus:border-[#F66B17] focus:ring-1 focus:ring-[#F66B17] outline-none"
              />
              <button
                type="submit"
                disabled={login.isPending}
                className="rounded-lg bg-[#111111] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#333333] disabled:opacity-60 cursor-pointer transition-colors"
              >
                {login.isPending
                  ? tr('common.signing_in')
                  : tSafety('zoneMonitor.standalone.signInButton')}
              </button>
            </form>
          </div>
          {loginError && (
            <p role="alert" className="mt-2 text-xs text-red-600 font-medium">
              {localizedError(loginError ?? undefined)}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[#EAEAEA] bg-white p-4  space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EAEAEA]">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <IconCheck className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    {tSafety('zoneMonitor.standalone.sessionActive')}
                  </span>
                  <span className="text-xs font-semibold text-[#2F3437]">
                    · {session.user.displayName} ({session.user.username})
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6B6B]">
                  {tSafety('zoneMonitor.standalone.sessionNote')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1 text-xs font-semibold text-[#2F3437] hover:bg-[#FBFBFA] transition-colors cursor-pointer"
            >
              {tr('common.sign_out')}
            </button>
          </div>

          {/* Selectors Grid: Site, Camera, Region, Version */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B6B6B] mb-1">
                {tr('common.site_fa7955')}
              </label>
              <SmartNativeSelect
                value={selectedSiteId}
                onChange={(e) => {
                  const siteId = e.target.value;
                  activeScopeRef.current = {
                    userId: session.user.id,
                    siteId,
                    cameraId: '',
                    regionId: '',
                  };
                  clearTransientFeedback();
                  setRequestedSiteId(siteId);
                  setRequestedCameraId('');
                  setRequestedRegionId('');
                }}
                disabled={sites.isPending || !scopedSites.length}
                className="w-full rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2F3437] outline-none focus:border-[#F66B17]"
              >
                {!selectedSiteId && <option value="">{tr('common.unavailable')}</option>}
                {scopedSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </SmartNativeSelect>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B6B6B] mb-1">
                {tr('common.camera')}
              </label>
              <SmartNativeSelect
                value={selectedCameraId}
                onChange={(e) => {
                  const cameraId = e.target.value;
                  activeScopeRef.current = {
                    userId: session.user.id,
                    siteId: selectedSiteId,
                    cameraId,
                    regionId: '',
                  };
                  clearTransientFeedback();
                  setRequestedCameraId(cameraId);
                  setRequestedRegionId('');
                }}
                disabled={cameras.isPending || !cameras.data?.items.length}
                className="w-full rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2F3437] outline-none focus:border-[#F66B17]"
              >
                {!selectedCameraId && <option value="">{tr('common.select_camera')}</option>}
                {scopedCameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.code} · {camera.name} (v{camera.configurationVersion})
                  </option>
                ))}
              </SmartNativeSelect>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B6B6B] mb-1">
                {tr('common.region_zone')}
              </label>
              <SmartNativeSelect
                value={selectedRegionId}
                onChange={(e) => {
                  const regionId = e.target.value;
                  activeScopeRef.current = {
                    userId: session.user.id,
                    siteId: selectedSiteId,
                    cameraId: selectedCameraId,
                    regionId,
                  };
                  clearTransientFeedback();
                  setRequestedRegionId(regionId);
                }}
                disabled={regions.isPending || regionPresentations.length === 0}
                className="w-full rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2F3437] outline-none focus:border-[#F66B17]"
              >
                {regionPresentations.map((entry) => (
                  <option key={entry.region.id} value={entry.region.id}>
                    {tSafety(
                      entry.region.isActive
                        ? 'zoneMonitor.region.option'
                        : 'zoneMonitor.region.optionInactive',
                      {
                        zone: entry.zoneName ?? tSafety('zoneMonitor.region.zoneUnavailable'),
                        policy: tSafety(entry.policyLabelKey),
                        ordinal: entry.ordinalInZone,
                        version: entry.region.version,
                      },
                    )}
                  </option>
                ))}
              </SmartNativeSelect>
            </div>

            <div className="flex items-center gap-2 pt-1 sm:pt-0">
              {isDraftMode ? (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  {tr('common.unsaved_local_draft')}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold tabular-nums bg-slate-100 text-slate-700 border border-slate-200">
                  {tSafety('zoneMonitor.status.savedConfig', {
                    version: selectedCamera?.configurationVersion ?? 0,
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stale Draft Warning Banner */}
      {staleDraftInfo && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 "
        >
          <div className="flex items-start gap-3">
            <IconAlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800">
                {tr('restricted_zone_view.outdated_local_draft_detected')}
              </h4>
              <p className="mt-0.5 text-xs text-amber-700">
                {tr(
                  'restricted_zone_view.an_unsaved_local_draft_created_against_camera_configuration_version_vvalue_was_det',
                  {
                    value1: staleDraftInfo.version,
                    value2: selectedCamera?.configurationVersion ?? 0,
                  },
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (selectedSiteId && selectedCameraId) {
                clearLocalDraft(selectedSiteId, selectedCameraId, selectedRegion?.id);
              }
              setStaleDraftInfo(null);
            }}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800 whitespace-nowrap cursor-pointer transition-colors "
          >
            {tr('common.discard_stale_draft')}
          </button>
        </div>
      )}

      {/* HTTP 409 Conflict Banner */}
      {conflictMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 "
        >
          <div className="flex items-start gap-3">
            <IconAlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-red-800">
                {tr('restricted_zone_view.configuration_version_conflict_http_409')}
              </h4>
              <p className="mt-0.5 text-xs text-red-700">{localizeMessage(conflictMessage)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetToAuthoritative}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-800 whitespace-nowrap cursor-pointer transition-colors "
          >
            {tr('common.load_server_version')}
          </button>
        </div>
      )}

      {linkedMonitoring ? (
        session && canRead && selectedCamera ? (
          <FocusedCameraMedia
            key={JSON.stringify([sessionScope, selectedSiteId, selectedCameraId])}
            apiUrl={apiUrl}
            client={client}
            token={apiToken}
            sessionScope={sessionScope}
            siteId={selectedSiteId}
            camera={selectedCamera}
            observationMode="zone"
            aiPaused={import.meta.env.VITE_AI_WORK_PAUSED === 'true'}
          />
        ) : session && canRead && !sites.isPending && (!selectedSiteId || !cameras.isPending) ? (
          <p role="status">{tr('errors.cameraUnavailable')}</p>
        ) : null
      ) : (
        <>
          {/* Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,355px)] gap-4 items-start mt-4">
            {/* Left: Camera Video Feed */}
            <div
              ref={containerRef}
              className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none"
            >
              {/* Local MF05 test fixture driven by the video timeline. */}
              <div className="absolute inset-0">
                <video
                  ref={videoRef}
                  src="/assets/hazard_restricted_zone_test.mp4"
                  poster="/assets/crane-camera-view.png"
                  autoPlay
                  muted={isMuted}
                  loop
                  playsInline
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    updateVideoTimeline(video);
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                      setVideoNaturalSize({ width: video.videoWidth, height: video.videoHeight });
                    }
                  }}
                  onTimeUpdate={(event) => updateVideoTimeline(event.currentTarget)}
                  aria-label={tr('common.restricted_zone_test_video')}
                  className={`w-full h-full object-cover ${preview ? 'hidden' : ''}`}
                />

                {preview && <RealtimePreviewCanvas preview={preview} mode="zone" />}

                {/* AI Status Badge */}
                <div
                  className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm ${
                    testDetection?.active
                      ? 'bg-[#DF2225]/90 text-white'
                      : 'bg-slate-900/75 text-white/80'
                  }`}
                >
                  {isLive
                    ? tr('common.mf05_ai_realtime')
                    : aiTimeline
                      ? tr('common.mf05_ai_pipeline')
                      : tr('restricted_zone_view.mf05_ai_output_required')}{' '}
                  ·{' '}
                  {testDetection
                    ? testDetection.active
                      ? tr('common.zone_entry')
                      : tr('labels.SCANNING')
                    : tr('common.no_targets')}{' '}
                  · {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
                </div>

                {/* Horizontal scanning line */}
                <div className="absolute top-[52%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

                {/* Manually adjustable restricted-zone polygon mapped through video content area */}
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  onPointerMove={
                    isEditingZone &&
                    (!preview || selectedCamera?.externalId === preview.frame.cameraExternalId)
                      ? updateZonePoint
                      : undefined
                  }
                  onPointerUp={() => {
                    activeZonePoint.current = null;
                  }}
                  aria-label={tr('common.restricted_zone_editor')}
                  style={{
                    visibility:
                      isLive &&
                      (!isEditingZone ||
                        selectedCamera?.externalId !== preview?.frame.cameraExternalId)
                        ? 'hidden'
                        : 'visible',
                  }}
                >
                  <polygon
                    points={displayPolygon.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="#DF2225"
                    fillOpacity={testDetection?.active ? 0.16 : 0.08}
                    stroke="#DF2225"
                    strokeWidth="0.006"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                  <text
                    x={(displayPolygon[0]?.[0] ?? 0.63) + 0.012}
                    y={(displayPolygon[0]?.[1] ?? 0.2) + 0.035}
                    fill="white"
                    fontSize="0.025"
                    fontWeight="800"
                    letterSpacing="0.06em"
                    style={{ textTransform: 'uppercase' }}
                    pointerEvents="none"
                  >
                    {tr('common.no_entry_zone')}
                  </text>
                  {isEditingZone &&
                    displayPolygon.map(([x, y], index) => (
                      <circle
                        key={`zone-point-${index}`}
                        cx={x}
                        cy={y}
                        r="0.018"
                        fill="#F66B17"
                        stroke="white"
                        strokeWidth="0.006"
                        onPointerDown={(event) => {
                          activeZonePoint.current = index;
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerUp={() => {
                          activeZonePoint.current = null;
                        }}
                        style={{ cursor: 'grab', pointerEvents: 'all' }}
                      />
                    ))}
                </svg>

                {canConfigure && (
                  <div className="absolute left-4 bottom-16 z-20 flex flex-col gap-1.5 items-start">
                    <div className="flex items-center gap-2">
                      {!isEditingZone ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setIsEditingZone(true)}
                            disabled={
                              isLive &&
                              selectedCamera?.externalId !== preview?.frame.cameraExternalId
                            }
                            title={
                              isLive
                                ? tr(
                                    'restricted_zone_view.select_the_matching_backend_camera_before_editing_this_preview',
                                  )
                                : tr('common.edit_zone_draft')
                            }
                            className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950 cursor-pointer"
                          >
                            {tr('common.edit_zone_8924f0')}
                          </button>
                          {isDraftMode && (
                            <span className="rounded bg-amber-500/90 px-2 py-1 text-[9px] font-bold text-white backdrop-blur-sm ">
                              {tr('common.unsaved_draft')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          {session && selectedCamera && selectedRegion ? (
                            <button
                              onClick={handleSaveToBackend}
                              disabled={savePolygonMutation.isPending}
                              className="rounded bg-emerald-600 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                            >
                              {savePolygonMutation.isPending
                                ? tr('common.saving_to_backend')
                                : tr('common.save_to_backend')}
                            </button>
                          ) : null}
                          <button
                            onClick={saveDraft}
                            className="rounded bg-amber-600 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-amber-700 cursor-pointer"
                          >
                            {tr('common.save_local_draft')}
                          </button>
                          <button
                            onClick={resetToAuthoritative}
                            className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950 cursor-pointer"
                          >
                            {session && selectedRegion
                              ? tr('common.reset_to_server')
                              : tr('labels.RESET')}
                          </button>
                          <button
                            onClick={exportZone}
                            className="rounded bg-[#F66B17] px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-[#E05A0B] cursor-pointer"
                          >
                            {tr('common.export_draft_json')}
                          </button>
                        </>
                      )}
                    </div>
                    {saveStatusMessage && (
                      <div className="rounded bg-black/75 px-2.5 py-1 text-[10px] font-medium text-amber-200 backdrop-blur-sm border border-amber-500/30">
                        {localizeMessage(saveStatusMessage)}
                      </div>
                    )}
                  </div>
                )}

                {/* Render one bounding box per active zone-entry track */}
                {!isLive &&
                  activeZoneDetections.map((detection) =>
                    detection.boundingBox ? (
                      <div
                        key={`${detection.eventId}-${detection.trackId}`}
                        className="absolute border-[1.6px] border-[#DF2225] pointer-events-none transition-all duration-300"
                        style={{
                          left: `${detection.boundingBox.x1 * 100}%`,
                          top: `${detection.boundingBox.y1 * 100}%`,
                          width: `${(detection.boundingBox.x2 - detection.boundingBox.x1) * 100}%`,
                          height: `${(detection.boundingBox.y2 - detection.boundingBox.y1) * 100}%`,
                        }}
                      >
                        <div className="absolute -top-[18px] left-[-1.6px] px-1.5 py-0.5 bg-[#DF2225] text-white text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow-sm">
                          {tr('ppe_monitoring_view.value_track_value', {
                            value1: localizedDetectionLabel(detection.label),
                            value2: detection.trackId,
                          })}
                        </div>
                      </div>
                    ) : null,
                  )}

                {/* Empty live frame indicator */}
                {isLive && zoneDetections.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded text-white/90 text-xs font-semibold">
                      {tr('restricted_zone_view.live_feed_connected_no_restricted_zone_intrusions')}
                    </div>
                  </div>
                )}
              </div>

              {/* Top Header Overlay */}
              <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white">
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">
                    {activeCameraContext.camera}
                  </span>
                  <span className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md">
                    {activeCameraContext.workArea}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 backdrop-blur-sm">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isLive && socketConnected
                        ? 'bg-[#DF2225] animate-ping'
                        : socketError
                          ? 'bg-amber-400'
                          : 'bg-slate-400'
                    }`}
                  />
                  <span className="font-mono text-[10px] font-bold text-white tracking-wider">
                    {isLive && socketConnected
                      ? tr('common.live_value', { value1: clockTime })
                      : socketError
                        ? tr('common.offline_socket_error')
                        : tr('common.timeline_value', {
                            value1: testDetection?.timecode ?? '00:00',
                          })}
                  </span>
                </div>
              </div>

              {/* Socket error message banner if present */}
              {socketError && (
                <div className="relative z-10 px-5 py-1.5 bg-amber-900/80 text-amber-200 text-xs flex items-center gap-2 backdrop-blur-sm">
                  <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                  <span className="truncate">
                    {tr('common.ai_websocket_value', { value1: socketError })}
                  </span>
                </div>
              )}

              {/* Bottom Camera Controls Bar Overlay */}
              <div className="relative z-10 px-5 py-3 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlayback}
                    disabled={isLive}
                    className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                    aria-label={
                      isPlaying ? tr('common.pause_playback') : tr('common.resume_playback')
                    }
                    title={
                      isLive
                        ? tr('ppe_monitoring_view.playback_controls_apply_to_timeline_replay_only')
                        : isPlaying
                          ? tr('common.pause')
                          : tr('common.play')
                    }
                  >
                    {isPlaying ? (
                      <IconPause className="w-4 h-4" />
                    ) : (
                      <IconPlay className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMuted}
                    disabled={isLive}
                    className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                    aria-label={isMuted ? tr('common.unmute_audio') : tr('common.mute_audio')}
                    title={
                      isLive
                        ? tr('ppe_monitoring_view.realtime_preview_has_no_audio')
                        : tr('common.sound')
                    }
                  >
                    <IconVolume className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled
                    className="p-1.5 rounded text-white/40 cursor-not-allowed"
                    title={tr(
                      'ppe_monitoring_view.multi_camera_grid_view_is_currently_unavailable',
                    )}
                    aria-label={tr('common.grid_view_unavailable')}
                  >
                    <IconGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void videoRef.current?.requestFullscreen()}
                    className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer"
                    title={tr('common.fullscreen')}
                    aria-label={tr('common.enter_fullscreen')}
                  >
                    <IconMaximize className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Sidebar Verification Card (355px) */}
            <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] flex flex-col justify-between h-[600px] xl:h-[466px] overflow-y-auto min-w-0">
              <div className="p-6 space-y-6">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 min-w-0">
                  <span className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest">
                    {tr('common.detection_details')}
                  </span>
                  <span className="max-w-full break-all font-mono text-[11px] font-semibold text-[#6B6B6B]">
                    {testDetection?.eventId ?? tr('common.no_detection')}
                  </span>
                </div>

                {/* 2-Column Metadata Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.identity')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                      {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                        ? tr('ppe_monitoring_view.unknown_not_identified')
                        : tr('common.no_person_detected')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.track_id')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                      {zoneDetections
                        .filter((detection) => detection.trackId !== null)
                        .map((detection) =>
                          tr('messages.2c6bb8488230', { value1: detection.trackId }),
                        )
                        .join(', ') || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.camera')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                      {activeCameraContext.camera}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.zone')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1 truncate">
                      {activeCameraContext.workArea}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.detected')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                      {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                      {tr('common.detection_confidence')}
                    </p>
                    <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                      {testDetection?.confidence === null || testDetection?.confidence === undefined
                        ? '—'
                        : `${Math.round(testDetection.confidence * 100)}%`}
                    </p>
                  </div>
                </div>

                <div className="h-px bg-[#F7F6F3] w-full" />

                {/* Verification Heading */}
                <div>
                  <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-4">
                    {tr('common.verification')}
                  </p>

                  {/* Verification items */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-[#FBFBFA]">
                      <div className="flex flex-col gap-0.5">
                        <p className="font-semibold text-[#2F3437] text-xs">
                          {tr('common.identity')}
                        </p>
                        <p className="text-[11px] text-[#6B6B6B]">
                          {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                            ? tr('ppe_monitoring_view.unknown_not_identified')
                            : tr('common.no_person_detected')}
                        </p>
                      </div>
                      <IconClock className="w-5 h-5 text-[#A3A09C]" />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-[#FBFBFA]">
                      <div className="flex flex-col gap-0.5">
                        <p className="font-semibold text-[#2F3437] text-xs">
                          {tr('common.site_assignment_1c7828')}
                        </p>
                        <p className="text-[11px] text-[#6B6B6B]">{tr('common.not_evaluated')}</p>
                      </div>
                      <IconClock className="w-5 h-5 text-[#A3A09C]" />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-[#FBFBFA]">
                      <div className="flex flex-col gap-0.5">
                        <p className="font-semibold text-[#2F3437] text-xs">
                          {tr('common.zone_permission')}
                        </p>
                        <p className="text-[11px] text-[#6B6B6B]">
                          {tr('common.backend_evaluation_required')}
                        </p>
                      </div>
                      <IconClock className="w-5 h-5 text-[#A3A09C]" />
                    </div>

                    <div className="flex items-center justify-between px-2 pt-2 pb-1 text-xs text-[#6B6B6B]">
                      <span>{tr('common.permission_validity')}</span>
                      <span className="font-bold text-slate-300">—</span>
                    </div>
                  </div>
                </div>

                {/* Result Alert Box */}
                <div className="pt-1">
                  <div
                    className={`border-l-[3px] pl-3 ${
                      testDetection?.active ? 'border-red-500' : 'border-[#EAEAEA]'
                    }`}
                  >
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">
                      {tr('common.result')}
                    </p>
                    <div
                      className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                        testDetection?.active ? 'text-red-500' : 'text-[#6B6B6B]'
                      }`}
                    >
                      {testDetection?.active && <IconAlertTriangle className="w-3.5 h-3.5" />}
                      <span>
                        {testDetection?.active
                          ? tr('common.zone_entry_observation')
                          : zoneDetections.length === 0
                            ? tr('ppe_monitoring_view.clear_no_targets')
                            : tr('common.scanning_video')}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      {testDetection?.active
                        ? tr(
                            'restricted_zone_view.technical_zone_entry_observation_backend_decides_authorization_and_violation',
                          )
                        : isLive
                          ? tr('ppe_monitoring_view.streaming_live_inference_from_ai_websocket')
                          : tr(
                              'restricted_zone_view.generate_zone_ai_timeline_json_then_play_the_matching_video',
                            )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-6 pt-0 space-y-2">
                <button
                  onClick={openReviewFromDetection}
                  disabled={!testDetection?.active}
                  className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm shadow-sm transition-colors cursor-pointer ${
                    testDetection?.active
                      ? 'bg-[#F66B17] hover:bg-[#E05A0B] text-white'
                      : 'bg-[#F7F6F3] text-[#A3A09C] cursor-not-allowed'
                  }`}
                >
                  {tr('common.review_incident')}
                </button>
                <button
                  onClick={() => {
                    if (testDetection?.trackId !== null && testDetection?.trackId !== undefined) {
                      setActiveFilterWorker((prev) =>
                        prev === testDetection.trackId ? null : testDetection.trackId,
                      );
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-white border border-[#EAEAEA] text-[#2F3437] font-semibold text-sm hover:bg-[#FBFBFA] transition-colors cursor-pointer"
                >
                  {activeFilterWorker !== null
                    ? tr('ppe_monitoring_view.clear_worker_filter_value', {
                        value1: activeFilterWorker,
                      })
                    : testDetection?.trackId !== null && testDetection?.trackId !== undefined
                      ? tr('ppe_monitoring_view.filter_by_worker_track_value', {
                          value1: testDetection.trackId,
                        })
                      : tr('ppe_monitoring_view.view_worker_no_target')}
                </button>
              </div>
            </div>
          </div>

          {/* Live AI Observations status or Replay Observations Table */}
          {isLive ? (
            <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] p-6 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#DF2225] animate-ping" />
                    <h3 className="text-sm font-bold text-[#2F3437] uppercase tracking-wider">
                      {tr('restricted_zone_view.live_zone_observations_active')}
                    </h3>
                  </div>
                  <p className="text-xs text-[#6B6B6B] max-w-2xl leading-relaxed">
                    {tr(
                      'restricted_zone_view.technical_zone_entry_detections_are_rendered_directly_on_the_live_camera_feed_abov',
                    )}
                  </p>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('incidents', { alertType: 'RESTRICTED_ZONE_INTRUSION' })
                    }
                    className="self-start sm:self-auto px-3.5 py-2 rounded-lg border border-red-300 bg-red-50 text-[#DF2225] hover:bg-red-100 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    {tr('ppe_monitoring_view.view_in_safety_alerts')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#2F3437]">
                    {tr('common.zone_replay_observations')}
                  </h3>
                  <p className="text-xs text-[#6B6B6B] mt-1">
                    {tr(
                      'ppe_monitoring_view.observations_from_the_sample_video_timeline_live_safety_alerts_are_available_in_sa',
                      {
                        value1:
                          activeFilterWorker !== null &&
                          tr('messages.becfe40eedac', { value1: activeFilterWorker }),
                      },
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate('incidents', { alertType: 'RESTRICTED_ZONE_INTRUSION' })
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-red-300 bg-red-50 text-[#DF2225] hover:bg-red-100 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {tr('ppe_monitoring_view.view_in_safety_alerts')}
                    </button>
                  )}
                  <button
                    onClick={() => setZoneFilter('ALL')}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      zoneFilter === 'ALL'
                        ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                        : 'border-[#EAEAEA] bg-white text-[#6B6B6B] hover:bg-[#FBFBFA]'
                    }`}
                  >
                    {tr('common.all_events_value', { value1: events.length })}
                  </button>
                  <button
                    onClick={() => setZoneFilter('ACTIVE_ONLY')}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      zoneFilter === 'ACTIVE_ONLY'
                        ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                        : 'border-[#EAEAEA] bg-white text-[#6B6B6B] hover:bg-[#FBFBFA]'
                    }`}
                  >
                    {tr('common.zone_entries_value', {
                      value1: events.filter(
                        (e) =>
                          e.result.toLowerCase().includes('entry') ||
                          e.result.toLowerCase().includes('violation'),
                      ).length,
                    })}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#EAEAEA] text-[#6B6B6B] font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">{tr('common.time')}</th>
                      <th className="py-3 px-3">{tr('common.person_worker')}</th>
                      <th className="py-3 px-3">{tr('common.zone')}</th>
                      <th className="py-3 px-3">{tr('common.camera')}</th>
                      <th className="py-3 px-3">{tr('common.identity')}</th>
                      <th className="py-3 px-3">{tr('common.authorization')}</th>
                      <th className="py-3 px-3">{tr('common.result_6e7d50')}</th>
                      <th className="py-3 px-3 text-right">{tr('common.action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEAEA]">
                    {displayedEvents.map((evt) => (
                      <tr key={evt.rowKey} className="hover:bg-[#FBFBFA] transition-colors group">
                        <td className="py-3 px-3 font-mono text-[#6B6B6B] text-xs">{evt.time}</td>
                        <td className="py-3 px-3 font-semibold text-[#2F3437]">{evt.person}</td>
                        <td className="py-3 px-3 text-[#6B6B6B]">{evt.zone}</td>
                        <td className="py-3 px-3 font-mono text-[#6B6B6B] text-xs">{evt.camera}</td>
                        <td className="py-3 px-3 text-[#6B6B6B]">{evt.identity}</td>
                        <td className="py-3 px-3 text-[#6B6B6B]">
                          {localizedLabel(evt.authorization)}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              evt.result === 'Violation'
                                ? 'bg-red-50 text-red-600'
                                : evt.result === 'Access Valid'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : 'bg-amber-50 text-amber-600'
                            }`}
                          >
                            {localizedLabel(evt.result)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => setSelectedIncident(evt)}
                            className="px-3 py-1 rounded text-xs font-semibold transition-colors bg-[#F7F6F3] text-[#2F3437] hover:bg-slate-200"
                          >
                            {tr('common.review')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {displayedEvents.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-[#6B6B6B] text-xs">
                          {tr('restricted_zone_view.no_zone_events_match_the_selected_criteria')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Incident Review Modal with Bound Data */}
          {selectedIncident && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                      {selectedIncident.id}
                    </span>
                    <h3 className="font-bold text-[#2F3437]">{tr('common.review_action')}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedIncident(null)}
                    aria-label={tr('common.close_review_dialog')}
                    className="text-[#6B6B6B] hover:text-[#2F3437] cursor-pointer"
                  >
                    <IconX className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 text-sm text-[#6B6B6B]">
                  <p>
                    {tr('restricted_zone_view.you_are_reviewing_a_restricted_zone_intrusion_at')}{' '}
                    <strong className="text-[#2F3437]">
                      {
                        resolveCameraAndWorkArea(selectedIncident.camera, selectedIncident.regionId)
                          .workArea
                      }{' '}
                      ({selectedIncident.camera})
                    </strong>
                    {tr('restricted_zone_view.ai_detected_worker')}{' '}
                    <strong className="text-[#2F3437]">
                      {selectedIncident.unknownTrack
                        ? tr('common.unknown_person')
                        : tr('messages.2c6bb8488230', { value1: selectedIncident.trackId })}
                    </strong>{' '}
                    {tr('common.with_status')}{' '}
                    <strong className="text-[#2F3437]">
                      {localizeMessage(localizedLabel(selectedIncident.authorization))}
                    </strong>
                    .
                  </p>

                  <div className="p-3 bg-[#FBFBFA] border border-[#EAEAEA] rounded-lg space-y-1">
                    <p className="font-bold text-[#2F3437] text-xs uppercase tracking-wider">
                      {tr('common.technical_evidence_preview')}
                    </p>
                    <p className="text-[#6B6B6B] text-xs leading-relaxed">
                      {tr(
                        'restricted_zone_view.ai_zone_detections_are_preliminary_observations_to_inspect_session_scoped_evidence',
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  {onNavigate ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIncident(null);
                        onNavigate('incidents', { alertType: 'RESTRICTED_ZONE_INTRUSION' });
                      }}
                      className="py-2 px-4 rounded-lg bg-[#DF2225] hover:bg-[#B8191C] text-white font-bold text-sm shadow transition-colors cursor-pointer text-center"
                    >
                      {tr('ppe_monitoring_view.review_in_safety_alerts')}
                    </button>
                  ) : (
                    <button
                      disabled
                      title={tr('ppe_monitoring_view.safety_alerts_navigation_not_configured')}
                      className="py-2 px-4 rounded-lg bg-[#DF2225]/60 text-white font-bold text-sm cursor-not-allowed shadow transition-colors text-center"
                    >
                      {tr('common.review_in_alerts')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedIncident(null)}
                    className="py-2 px-4 rounded-lg bg-[#F7F6F3] hover:bg-slate-200 text-[#2F3437] font-bold text-sm transition-colors cursor-pointer text-center"
                  >
                    {tr('common.dismiss_preview')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
