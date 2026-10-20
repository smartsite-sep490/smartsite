import { useManagementClient } from '../../features/auth/auth-session';
import { useZoneApplicationSession } from './useZoneApplicationSession';
import { localizedError, localizeMessage } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { presentZoneLabel, presentZoneMessage } from './zonePresentation';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/ppe-locale';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useZoneMetadataPages } from './useZoneMetadataPages';
import { ZoneMetadataPaging } from './ZoneMetadataPaging';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import { useAuth } from '../../features/auth/auth-session';
import { PpeDialog } from '../ppe/PpeDialog';
import '../cameras/camera-setup-catalog';
import { Mf06ZoneAssessmentPanel } from '../ppe/Mf06ZoneAssessmentPanel';

import { IconAlertTriangle, IconClock, IconMaximize, IconGrid, IconKey, IconCheck } from '../icons';
import {
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
  clearLocalDraft,
  resolveActivePolygon,
  saveLocalDraft,
  type ActiveScope,
} from './zonePolygonAdapter';

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return true;
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    return true;
  }
  return false;
}

interface ZoneReviewItem {
  id: string;
  rowKey: string;
  trackId: number;
  person: string;
  zone: string;
  camera: string;
  identity: string;
  authorization: string;
  result: string;
  time: string;
}

export interface RestrictedZoneViewProps {
  authenticatedSession?: Pick<LoginResponse, 'accessToken' | 'user'>;
  onSignOut?: () => void;
  apiUrl?: string;
  initialSelection?: { siteId?: string; cameraId?: string };
  onOpenSetup?: (context?: { siteId: string; cameraId?: string }) => void;
  onNavigate?: (
    tab: 'incidents',
    context?: {
      alertType?: 'RESTRICTED_ZONE_INTRUSION';
      siteId?: string;
      alertId?: string;
    },
  ) => void;
  sharedSession?: SharedSession | null;
}

let nextMetadataCredential = 0;
const allocateMetadataCredential = () => ++nextMetadataCredential;

export function RestrictedZoneView({
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000',
  initialSelection,
  onOpenSetup,
  onNavigate,
  sharedSession: providedSharedSession,
  authenticatedSession,
  onSignOut,
}: RestrictedZoneViewProps) {
  const { t: localize } = useTranslation();
  const sharedSession = useZoneApplicationSession(
    providedSharedSession,
    authenticatedSession,
    onSignOut,
  );
  const { t } = useLocale();
  const isAiWorkPaused =
    import.meta.env.VITE_AI_WORK_PAUSED === 'true' || import.meta.env.VITE_AI_WORK_PAUSED === true;

  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const auth = useAuth();
  const triggerSessionExpired = auth?.triggerSessionExpired;
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);

  const [session, setSession] = useState<LoginResponse | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const expiredScopeRef = useRef<string | null>(null);
  const [rejectedCredential, setRejectedCredential] = useState<number | null>(null);

  const [requestedSiteId, setRequestedSiteId] = useState(initialSelection?.siteId ?? '');
  const [requestedCameraId, setRequestedCameraId] = useState(initialSelection?.cameraId ?? '');
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
  const [selectedIncident, setSelectedIncident] = useState<ZoneReviewItem | null>(null);
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

  const isControlled = sharedSession !== undefined;
  const isShared = isControlled && sharedSession !== null;
  const apiToken = isControlled ? (sharedSession?.accessToken ?? '') : (session?.accessToken ?? '');
  const sessionScope = isControlled
    ? (sharedSession?.sessionScope ?? '')
    : (session?.user.id ?? '');
  const effectiveUser = isControlled ? (sharedSession?.user ?? null) : (session?.user ?? null);
  const roleScopeKey =
    effectiveUser?.roleAssignments
      .map(({ role, siteId }) => `${role}:${siteId ?? 'global'}`)
      .sort()
      .join('|') ?? '';
  const [metadataIdentity, setMetadataIdentity] = useState(() => ({
    token: apiToken,
    userId: effectiveUser?.id,
    apiUrl,
    roleScopeKey,
    id: allocateMetadataCredential(),
  }));
  let metadataCredential = metadataIdentity.id;
  if (
    metadataIdentity.token !== apiToken ||
    metadataIdentity.userId !== effectiveUser?.id ||
    metadataIdentity.apiUrl !== apiUrl ||
    metadataIdentity.roleScopeKey !== roleScopeKey
  ) {
    if (metadataIdentity.token || metadataIdentity.userId || metadataIdentity.apiUrl !== apiUrl) {
      setRequestedSiteId('');
      setRequestedCameraId('');
    }
    metadataCredential = allocateMetadataCredential();
    setMetadataIdentity({
      token: apiToken,
      userId: effectiveUser?.id,
      apiUrl,
      roleScopeKey,
      id: metadataCredential,
    });
  }
  const credentialRef = useRef({ token: apiToken, id: metadataCredential });
  useLayoutEffect(() => {
    credentialRef.current = { token: apiToken, id: metadataCredential };
  }, [apiToken, metadataCredential]);
  const previousMetadataRef = useRef({
    apiUrl,
    sessionScope,
    id: metadataCredential,
  });
  useEffect(() => {
    const previous = previousMetadataRef.current;
    if (previous.id !== metadataCredential) {
      const predicate = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'zone-admin' && query.queryKey.at(-1) === previous.id;
      void queryClient.cancelQueries({ predicate });
      queryClient.removeQueries({ predicate });

      const oldCredentialKey = `${previous.sessionScope}:${previous.id}`;
      const historyPredicate = (query: { queryKey: readonly unknown[] }) =>
        (query.queryKey[0] === 'mf06-assessments' || query.queryKey[0] === 'mf06-requests') &&
        query.queryKey[1] === previous.apiUrl &&
        query.queryKey[4] === oldCredentialKey;
      void queryClient.cancelQueries({ predicate: historyPredicate });
      queryClient.removeQueries({ predicate: historyPredicate });

      clearTransientFeedback();
      setIsEditingZone(false);
    }
    previousMetadataRef.current = { apiUrl, sessionScope, id: metadataCredential };
  }, [apiUrl, sessionScope, metadataCredential, queryClient, clearTransientFeedback]);

  const isGlobalAdmin = useMemo(() => {
    if (!effectiveUser) return false;
    return effectiveUser.roleAssignments.some(
      ({ role, siteId }) => role === 'ADMIN' && siteId === null,
    );
  }, [effectiveUser]);

  const isSafetyOfficer = useMemo(() => {
    if (!effectiveUser) return false;
    return effectiveUser.roleAssignments.some(
      ({ role }) => role === 'SAFETY_OFFICER' || role === 'ADMIN',
    );
  }, [effectiveUser]);

  const canViewZone =
    (isGlobalAdmin || isSafetyOfficer) && rejectedCredential !== metadataCredential;

  const assignedSiteIds = useMemo(() => {
    if (!effectiveUser || isGlobalAdmin) return null;
    const ids = new Set<string>();
    for (const assignment of effectiveUser.roleAssignments) {
      if (assignment.role === 'SAFETY_OFFICER' || assignment.role === 'ADMIN') {
        if (assignment.siteId) {
          ids.add(assignment.siteId);
        }
      }
    }
    return ids;
  }, [effectiveUser, isGlobalAdmin]);

  const removeSessionQueries = useCallback(
    (scope: string) => {
      void queryClient.cancelQueries({ queryKey: ['zone-admin', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['zone-admin', apiUrl, scope] });
      const historyScopePrefix = `${scope}:`;
      const historyPredicate = (query: { queryKey: readonly unknown[] }) =>
        (query.queryKey[0] === 'mf06-assessments' || query.queryKey[0] === 'mf06-requests') &&
        query.queryKey[1] === apiUrl &&
        typeof query.queryKey[4] === 'string' &&
        query.queryKey[4].startsWith(historyScopePrefix);

      void queryClient.cancelQueries({ predicate: historyPredicate });
      queryClient.removeQueries({ predicate: historyPredicate });
    },
    [apiUrl, queryClient],
  );

  const prevScopeRef = useRef(sessionScope);
  useEffect(() => {
    if (prevScopeRef.current && prevScopeRef.current !== sessionScope) {
      removeSessionQueries(prevScopeRef.current);
      setRequestedSiteId('');
      setRequestedCameraId('');

      setIsDraftMode(false);
      setStaleDraftInfo(null);
      clearTransientFeedback();
      setZonePolygon(DEFAULT_ZONE_POLYGON);
      expiredScopeRef.current = null;
    }
    prevScopeRef.current = sessionScope;
  }, [sessionScope, removeSessionQueries, clearTransientFeedback]);

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      const allowed = result.user.roleAssignments.some(
        ({ role, siteId }) => role === 'ADMIN' && siteId === null,
      );
      if (!allowed) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error(tr('restricted_zone_view.a_global_admin_role_is_required'));
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
      setSessionExpiredMessage(null);
    },
    onError: (err) => {
      setLoginError(err instanceof Error ? err.message : tr('common.sign_in_failed'));
    },
  });

  const sessionScopeRef = useRef(sessionScope);
  useEffect(() => {
    sessionScopeRef.current = sessionScope;
  }, [sessionScope]);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (isControlled) {
        if (sessionScopeRef.current) {
          removeSessionQueries(sessionScopeRef.current);
        }
      } else {
        if (current) {
          removeSessionQueries(current.userId);
          void client.logout('WEB').catch(() => undefined);
        }
      }
    };
  }, [client, isControlled, removeSessionQueries]);

  const handleLogout = useCallback(() => {
    if (isShared) {
      if (sessionScope) removeSessionQueries(sessionScope);
      sharedSession?.onSignOut?.();
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

    setIsDraftMode(false);
    setStaleDraftInfo(null);
    if (current) void client.logout('WEB').catch(() => undefined);
  }, [
    isShared,
    sessionScope,
    removeSessionQueries,
    sharedSession,
    clearTransientFeedback,
    login,
    client,
  ]);

  const sites = useZoneMetadataPages({
    queryKey: ['zone-admin', apiUrl, sessionScope, 'sites', 'pages', metadataCredential],
    read: (offset, signal) =>
      client.listSites(apiToken, offset ? { offset, limit: 100 } : { limit: 100 }, { signal }),
    enabled: canViewZone && apiToken.length > 0 && sessionScope.length > 0,
  });

  const availableSites = useMemo(() => {
    const items = sites.data?.items ?? [];
    if (!assignedSiteIds) return items;
    return items.filter((site) => assignedSiteIds.has(site.id));
  }, [sites.data?.items, assignedSiteIds]);

  const holdLinkedSite = Boolean(
    initialSelection?.siteId && initialSelection.siteId === requestedSiteId,
  );

  const selectedSiteId = availableSites.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : holdLinkedSite
      ? ''
      : (availableSites[0]?.id ?? '');

  const cameras = useZoneMetadataPages({
    queryKey: [
      'zone-admin',
      apiUrl,
      sessionScope,
      selectedSiteId,
      'cameras',
      'pages',
      metadataCredential,
    ],
    read: (offset, signal) =>
      client.listPreviewCameras(
        apiToken,
        selectedSiteId,
        offset ? { offset, limit: 100 } : { limit: 100 },
        { signal },
      ),
    enabled:
      canViewZone && apiToken.length > 0 && sessionScope.length > 0 && selectedSiteId.length > 0,
  });

  const scopedCameras = useMemo(
    () => (cameras.data?.items ?? []).filter((cam) => cam.siteId === selectedSiteId),
    [cameras.data?.items, selectedSiteId],
  );

  const holdLinkedCamera = Boolean(
    initialSelection?.cameraId && initialSelection.cameraId === requestedCameraId,
  );

  const selectedCameraId = scopedCameras.some((cam) => cam.id === requestedCameraId)
    ? requestedCameraId
    : holdLinkedCamera
      ? ''
      : (scopedCameras[0]?.id ?? '');

  const selectedCamera = useMemo(
    () => scopedCameras.find((c) => c.id === selectedCameraId),
    [scopedCameras, selectedCameraId],
  );

  const scopedPreview = useScopedCameraPreview({
    apiUrl,
    client,
    token: apiToken,
    sessionScope,
    siteId: selectedSiteId,
    cameraId: selectedCameraId,
    enabled: Boolean(
      !isAiWorkPaused &&
      canViewZone &&
      apiToken &&
      sessionScope &&
      selectedSiteId &&
      selectedCameraId,
    ),
  });

  const preview = isAiWorkPaused ? null : scopedPreview.preview;
  const socketError = isAiWorkPaused ? null : scopedPreview.error;
  const isLive =
    !isAiWorkPaused && (scopedPreview.status === 'LIVE' || scopedPreview.status === 'REPLAY');
  const zoneDetections = useMemo(() => preview?.frame.zoneDetections ?? [], [preview]);
  const videoNaturalSize = useMemo(
    () =>
      preview
        ? { width: preview.frame.width, height: preview.frame.height }
        : { width: 1920, height: 1080 },
    [preview],
  );

  const producerSessionId = preview?.frame.sessionId ?? 'none';
  const producerCameraExternalId = preview?.frame.cameraExternalId ?? 'none';

  // Render-time bounded review scope identity without raw tokens
  const currentReviewScopeKey = `${metadataCredential}:${sessionScope}:${selectedSiteId}:${selectedCameraId}:${scopedPreview.sourceKind ?? 'none'}:${scopedPreview.status}:${producerSessionId}:${producerCameraExternalId}`;
  const [prevReviewScopeKey, setPrevReviewScopeKey] = useState(currentReviewScopeKey);

  if (prevReviewScopeKey !== currentReviewScopeKey) {
    setPrevReviewScopeKey(currentReviewScopeKey);
    if (selectedIncident !== null) {
      setSelectedIncident(null);
    }
  }

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

  // Bug 2: Prioritize first active intrusion track, then fallback to index 0
  const testDetection = useMemo(() => {
    return getPrimaryZoneDetection(zoneDetections);
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

  useLayoutEffect(() => {
    activeScopeRef.current = {
      userId: effectiveUser?.id ?? null,
      sessionScope,
      siteId: selectedSiteId,
      cameraId: selectedCameraId,
      regionId: '',
    };
  }, [effectiveUser?.id, sessionScope, selectedSiteId, selectedCameraId]);

  const currentScopeKey = effectiveUser
    ? `${sessionScope}:${metadataCredential}:${selectedSiteId}:${selectedCameraId}:c${selectedCamera?.configurationVersion ?? 0}`
    : 'fallback-camera-04';
  const currentIdentityScopeKey = effectiveUser
    ? `${effectiveUser.id}:${sessionScope}:${metadataCredential}:${selectedSiteId}:${selectedCameraId}`
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
      cameraConfigurationVersion: selectedCamera?.configurationVersion,
      fallback: DEFAULT_ZONE_POLYGON,
    });
    setZonePolygon(resolved.points);
    setIsDraftMode(resolved.isDraft);
    setStaleDraftInfo(
      resolved.staleDraftVersion !== null ? { version: resolved.staleDraftVersion } : null,
    );
    setIsEditingZone(false);
  }

  const canEditGeometry = !isAiWorkPaused && !isControlled && !effectiveUser;
  const canOpenSetup =
    isGlobalAdmin ||
    Boolean(
      effectiveUser?.roleAssignments.some(
        (role) => role.role === 'SITE_MANAGER' && role.siteId === selectedSiteId,
      ),
    );
  const setupParams = new URLSearchParams(selectedSiteId ? { siteId: selectedSiteId } : {});
  if (selectedCamera?.siteId === selectedSiteId) setupParams.set('cameraId', selectedCamera.id);

  const saveDraft = () => {
    if (effectiveUser || isControlled || isAiWorkPaused) return;
    saveLocalDraft('demo-site', 'camera-04', 'default', 0, zonePolygon);
    setIsDraftMode(true);
    showStatusMessage(tr('restricted_zone_view.saved_to_browser_local_storage_camera_04_draft'));
    setIsEditingZone(false);
  };
  const resetToAuthoritative = () => {
    if (effectiveUser || isControlled) return;
    clearLocalDraft('demo-site', 'camera-04', 'default');
    setZonePolygon(DEFAULT_ZONE_POLYGON);
    setIsDraftMode(false);
    setStaleDraftInfo(null);
  };

  const activeCameraContext = useMemo(() => {
    if (preview) {
      return resolveCameraAndWorkArea(
        preview.frame.cameraExternalId,
        testDetection?.regionId,
        selectedCamera?.code || localize('monitoring_utils.chua_co_ma_camera'),
      );
    }
    if (selectedCamera) {
      const regionLabel = localize('common.restricted_zone');
      return {
        camera: `${selectedCamera.code} · ${selectedCamera.name}`,
        workArea: regionLabel,
      };
    }
    return {
      camera: 'No Camera Selected',
      workArea: 'Restricted Zone',
    };
  }, [preview, selectedCamera, testDetection, localize]);

  const exportZone = () => {
    if (effectiveUser || isControlled || isAiWorkPaused) return;
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

  // Bug 5: Key zone = eventId + trackId
  const events: ZoneReviewItem[] = useMemo(() => {
    if (!preview) return [];
    const timeStr = scopedPreview.capturedAt
      ? formatClockTime(new Date(scopedPreview.capturedAt))
      : clockTime;

    return (preview.frame.zoneDetections ?? [])
      .filter((det) => det.active)
      .map((det) => {
        const context = resolveCameraAndWorkArea(
          preview.frame.cameraExternalId,
          det.regionId,
          selectedCamera?.code || localize('common.cam_04'),
        );
        return {
          id: det.eventId || `SNAPSHOT-${det.trackId ?? 0}`,
          rowKey: getZoneEventRowKey(det.eventId || 'SNAP', det.trackId ?? 0),
          trackId: det.trackId ?? 0,
          time: timeStr,
          person:
            det.trackId !== null && det.trackId !== undefined
              ? localize('messages.2c6bb8488230', { value1: det.trackId })
              : localize('common.unknown_person'),
          zone: context.workArea,
          camera: context.camera,
          identity: localize('common.unknown'),
          authorization: 'Backend evaluation required',
          result: 'Technical entry',
        };
      });
  }, [preview, scopedPreview.capturedAt, clockTime, selectedCamera?.code, localize]);

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
      preview?.frame.cameraExternalId || selectedCamera?.externalId,
      testDetection.regionId,
      selectedCamera?.code || tr('common.cam_04'),
    );
    setSelectedIncident({
      id: testDetection.eventId || `SNAPSHOT-${testDetection.trackId ?? 0}`,
      rowKey: `${testDetection.eventId || 'SNAP'}-${testDetection.trackId ?? 0}`,
      trackId: testDetection.trackId ?? 0,
      person:
        testDetection.trackId !== null && testDetection.trackId !== undefined
          ? tr('messages.2c6bb8488230', { value1: testDetection.trackId })
          : tr('common.unknown_person'),
      zone: context.workArea,
      camera: context.camera,
      identity: tr('common.unknown'),
      authorization: 'Backend evaluation required',
      result: testDetection.active
        ? tr('common.zone_entry_observation_f1b9fa')
        : 'Scanning Snapshot',
      time: isLive ? clockTime : (testDetection.timecode ?? '00:00'),
    });
  };

  const auth401Error = useMemo(() => {
    if (!sessionScope) return null;
    if (isUnauthorizedError(sites.error)) return sites.error;
    if (isUnauthorizedError(cameras.error)) return cameras.error;
    if (scopedPreview.errorStatus === 401 && Boolean(sessionScope && selectedCameraId)) {
      return new ApiError('http', scopedPreview.error || 'Camera preview session expired', 401);
    }

    return null;
  }, [
    sessionScope,
    sites.error,
    cameras.error,
    scopedPreview.errorStatus,
    scopedPreview.error,
    selectedCameraId,
  ]);

  useEffect(() => {
    if (!auth401Error || !sessionScope) return;
    const expiryKey = `${sessionScope}:${metadataCredential}`;
    if (expiredScopeRef.current === expiryKey) return;
    expiredScopeRef.current = expiryKey;
    const generation = lifecycleGeneration.current;

    queueMicrotask(() => {
      // A new credential or unmount can overtake the deferred notification.
      if (
        lifecycleGeneration.current !== generation ||
        credentialRef.current.id !== metadataCredential ||
        credentialRef.current.token !== apiToken
      )
        return;
      setRejectedCredential(metadataCredential);
      removeSessionQueries(sessionScope);
      if (isControlled) {
        triggerSessionExpired?.(sessionScope);
        sharedSession?.onSignOut?.();
      } else {
        setSessionExpiredMessage('Your session is no longer valid. Sign in again.');
        handleLogout();
      }
    });
  }, [
    auth401Error,
    sessionScope,
    metadataCredential,
    apiToken,
    isControlled,
    sharedSession,
    removeSessionQueries,
    triggerSessionExpired,
    handleLogout,
  ]);

  const handleHistoryUnauthorized = useCallback(() => {
    const currentScope = sessionScopeRef.current;
    const currentActiveSite = activeScopeRef.current.siteId;
    if (!sessionScope || sessionScope !== currentScope) return;
    if (!selectedSiteId || selectedSiteId !== currentActiveSite) return;

    const expiryKey = `${sessionScope}:${metadataCredential}`;
    if (expiredScopeRef.current === expiryKey) return;
    const generation = lifecycleGeneration.current;
    const currentCredential = metadataCredential;
    const currentToken = apiToken;
    const capturedSiteId = selectedSiteId;
    const capturedScope = sessionScope;

    queueMicrotask(() => {
      if (
        lifecycleGeneration.current !== generation ||
        credentialRef.current.id !== currentCredential ||
        credentialRef.current.token !== currentToken ||
        sessionScopeRef.current !== capturedScope ||
        activeScopeRef.current.siteId !== capturedSiteId
      ) {
        return;
      }
      // Share the existing metadata expiry gate; an overtaken notification must not reserve it.
      if (expiredScopeRef.current === expiryKey) return;
      expiredScopeRef.current = expiryKey;
      setRejectedCredential(currentCredential);
      removeSessionQueries(capturedScope);
      if (isControlled) {
        triggerSessionExpired?.(capturedScope);
        sharedSession?.onSignOut?.();
      } else {
        setSessionExpiredMessage('Your session is no longer valid. Sign in again.');
        handleLogout();
      }
    });
  }, [
    sessionScope,
    selectedSiteId,
    metadataCredential,
    apiToken,
    isControlled,
    sharedSession,
    removeSessionQueries,
    triggerSessionExpired,
    handleLogout,
  ]);

  const isSiteMetadataSettled = Boolean(
    canViewZone &&
    apiToken &&
    sessionScope &&
    !sites.isPending &&
    !sites.error &&
    !auth401Error &&
    selectedSiteId,
  );

  if (
    isControlled &&
    (sharedSession === null || auth401Error || rejectedCredential === metadataCredential)
  ) {
    return (
      <div className="space-y-6 max-w-[1202px] mx-auto text-slate-900 pb-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            {t('cameraMonitoring.codeMf06')}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {t('ppe.sessionExpired.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t('restrictedZone.sessionExpired.description')}
          </p>
        </div>
      </div>
    );
  }

  if (isShared && !canViewZone) {
    const managerSiteIds = Array.from(
      new Set(
        effectiveUser?.roleAssignments
          .filter(
            (assignment) =>
              assignment.role === 'SITE_MANAGER' &&
              typeof assignment.siteId === 'string' &&
              assignment.siteId.trim().length > 0,
          )
          .map((assignment) => assignment.siteId!.trim()) ?? [],
      ),
    );
    const canHandoffToCameraSetup =
      Boolean(onOpenSetup) &&
      rejectedCredential !== metadataCredential &&
      Boolean(effectiveUser) &&
      !effectiveUser?.mustChangePassword &&
      managerSiteIds.length > 0;
    const handoffSiteId =
      initialSelection?.siteId && managerSiteIds.includes(initialSelection.siteId)
        ? initialSelection.siteId
        : managerSiteIds.length === 1
          ? managerSiteIds[0]
          : undefined;

    return (
      <div className="space-y-6 max-w-[1202px] mx-auto text-slate-900 pb-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            {t('cameraMonitoring.codeMf06')}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {t('restrictedZone.accessRestricted.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t('restrictedZone.accessRestricted.description')}
          </p>
          {canHandoffToCameraSetup && onOpenSetup && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() =>
                  handoffSiteId
                    ? onOpenSetup({
                        siteId: handoffSiteId,
                        ...(initialSelection?.siteId === handoffSiteId && initialSelection.cameraId
                          ? { cameraId: initialSelection.cameraId }
                          : {}),
                      })
                    : onOpenSetup()
                }
                className="rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-2xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {tr('cameraSetup.title', { ns: 'safety' })}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1202px] mx-auto text-slate-900 pb-10">
      {/* AI Work Paused Notice Banner */}
      {isAiWorkPaused && (
        <div
          role="status"
          data-testid="ai-work-paused-banner"
          className="rounded-2xl border border-amber-300/90 bg-amber-50/90 p-4 text-amber-900 flex items-start gap-3 shadow-xs"
        >
          <IconAlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              {t('ppe.pausedBanner.title')}
            </h2>
            <p className="mt-0.5 text-xs text-amber-800">{t('ppe.pausedBanner.description')}</p>
          </div>
        </div>
      )}

      {/* Admin Session & Backend Camera/Region Configuration Bar */}
      {!effectiveUser || (!isControlled && auth401Error) ? (
        isControlled ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <IconAlertTriangle className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-bold text-slate-900">{t('ppe.sessionExpired.title')}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {t('restrictedZone.sessionExpired.description')}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
                    <IconKey className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-bold text-slate-900">
                    {tr('common.backend_camera_configuration')}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-600 max-w-xl">
                  {tr(
                    'restricted_zone_view.sign_in_as_a_global_admin_to_load_camera_regions_and_save_authoritative_polygons_t',
                  )}
                </p>
              </div>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  setSessionExpiredMessage(null);
                  login.mutate();
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  required
                  type="text"
                  autoComplete="username"
                  placeholder={tr('common.admin_username')}
                  aria-label={tr('common.admin_username')}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setSessionExpiredMessage(null);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none"
                />
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  placeholder={tr('common.password')}
                  aria-label={tr('common.password')}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSessionExpiredMessage(null);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none"
                />
                <button
                  type="submit"
                  disabled={login.isPending}
                  className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60 cursor-pointer transition-colors"
                >
                  {login.isPending
                    ? tr('common.signing_in')
                    : tr('restricted_zone_view.sign_in_as_admin')}
                </button>
              </form>
            </div>
            {sessionExpiredMessage && !loginError && (
              <p role="alert" className="mt-2 text-xs text-red-600 font-medium">
                {presentZoneMessage(sessionExpiredMessage, t)}
              </p>
            )}
            {loginError && (
              <p role="alert" className="mt-2 text-xs text-red-600 font-medium">
                {localizedError(loginError ?? undefined)}
              </p>
            )}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-xl ${
                  isGlobalAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                <IconCheck className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isGlobalAdmin ? 'text-emerald-700' : 'text-blue-700'
                    }`}
                  >
                    {isGlobalAdmin
                      ? tr('common.admin_session_active')
                      : t('restrictedZone.session.safetyOfficerActive')}
                  </span>
                  <span className="text-xs font-semibold text-slate-900">
                    · {effectiveUser.displayName} ({effectiveUser.username || effectiveUser.id})
                  </span>
                </div>
                <p className="text-[11px] text-slate-600">
                  {isGlobalAdmin
                    ? t('restrictedZone.scope.readOnlyValue')
                    : t('restrictedZone.session.safetyOfficerDesc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              {tr('common.sign_out')}
            </button>
          </div>

          {/* Selectors Grid: Site and Camera with Setup/Read-Only Action Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
            <div>
              <label
                htmlFor="zone-site-select"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                {tr('common.site_fa7955')}
              </label>
              <select
                id="zone-site-select"
                value={selectedSiteId}
                onChange={(e) => {
                  const siteId = e.target.value;
                  activeScopeRef.current = {
                    userId: effectiveUser.id,
                    siteId,
                    cameraId: '',
                    regionId: '',
                  };
                  clearTransientFeedback();
                  setRequestedSiteId(siteId);
                  setRequestedCameraId('');
                }}
                disabled={sites.isPending || !availableSites.length}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-slate-900"
              >
                {!selectedSiteId && availableSites.length > 0 && (
                  <option value="">{tr('cameraSetup.chooseSite', { ns: 'safety' })}</option>
                )}
                {availableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </select>
              <ZoneMetadataPaging query={sites} kind="sites" />
            </div>

            <div>
              <label
                htmlFor="zone-camera-select"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                {tr('common.camera')}
              </label>
              <select
                id="zone-camera-select"
                value={selectedCameraId}
                onChange={(e) => {
                  const cameraId = e.target.value;
                  activeScopeRef.current = {
                    userId: effectiveUser.id,
                    siteId: selectedSiteId,
                    cameraId,
                    regionId: '',
                  };
                  clearTransientFeedback();
                  setRequestedCameraId(cameraId);
                }}
                disabled={cameras.isPending || !scopedCameras.length}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-2xs outline-none focus:border-slate-900"
              >
                {!selectedCameraId && scopedCameras.length > 0 && (
                  <option value="">{tr('cameraSetup.chooseCamera', { ns: 'safety' })}</option>
                )}
                {scopedCameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.code} · {camera.name} (v{camera.configurationVersion})
                  </option>
                ))}
              </select>
              <ZoneMetadataPaging query={cameras} kind="cameras" />
            </div>

            {((holdLinkedSite && !selectedSiteId && !sites.isPending && !sites.error) ||
              (holdLinkedCamera &&
                selectedSiteId &&
                !selectedCameraId &&
                !cameras.isPending &&
                !cameras.error)) && (
              <p role="status" className="sm:col-span-2 text-xs text-slate-600">
                {tr('cameraSetup.linkedSelection', { ns: 'safety' })}
              </p>
            )}

            <div className="sm:col-span-2 flex flex-wrap items-center gap-2.5 pt-1">
              {canOpenSetup && selectedSiteId && (
                <a
                  href={`/camera-setup?${setupParams.toString()}`}
                  onClick={(event) => {
                    if (
                      !onOpenSetup ||
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onOpenSetup({
                      siteId: selectedSiteId,
                      cameraId: setupParams.get('cameraId') ?? undefined,
                    });
                  }}
                  className="rounded-xl border border-slate-900 bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {tr('cameraSetup.title', { ns: 'safety' })}
                </a>
              )}
              <span className="rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                {t('restrictedZone.scope.readOnlyValue')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stale Draft Warning Banner */}
      {!effectiveUser && staleDraftInfo && (
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
                clearLocalDraft(selectedSiteId, selectedCameraId);
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
      {!effectiveUser && conflictMessage && (
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

      {/* Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,355px)] gap-4 items-start mt-4">
        {/* Left: Camera Video Feed */}
        <div
          ref={containerRef}
          className="relative bg-slate-950 rounded-2xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none"
        >
          <div className="absolute inset-0">
            {isAiWorkPaused ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#041D2E] text-slate-300 p-6 text-center select-none">
                <IconAlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
                <p className="text-xs font-bold text-slate-100">{t('ppe.viewport.pausedTitle')}</p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-md">
                  {t('ppe.viewport.pausedDesc')}
                </p>
              </div>
            ) : preview ? (
              <RealtimePreviewCanvas preview={preview} mode="zone" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#041D2E] text-slate-400 p-6 text-center select-none">
                {scopedPreview.status === 'CONNECTING' ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-semibold text-slate-300">
                      {t('restrictedZone.viewport.connectingTitle')}
                    </p>
                  </div>
                ) : socketError ? (
                  <div className="flex flex-col items-center gap-2 max-w-sm">
                    <IconAlertTriangle className="w-8 h-8 text-amber-500" />
                    <p className="text-xs font-bold text-slate-200">
                      {t('ppe.viewport.snapshotUnavailableTitle')}
                    </p>
                    <p className="text-[11px] text-slate-400">{socketError}</p>
                  </div>
                ) : !selectedCameraId ? (
                  <p className="text-xs text-slate-400">
                    {t('restrictedZone.viewport.noCameraSelected')}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    {t('ppe.viewport.snapshotUnavailableTitle')}
                  </p>
                )}
              </div>
            )}

            {/* AI Status Badge */}
            <div
              title={
                isAiWorkPaused
                  ? t('ppe.badge.aiPaused')
                  : scopedPreview.status === 'LIVE'
                    ? t('restrictedZone.badge.liveSnapshot1s')
                    : scopedPreview.status === 'REPLAY'
                      ? t('restrictedZone.badge.replaySnapshot1s')
                      : scopedPreview.status === 'UNAVAILABLE'
                        ? t('restrictedZone.badge.snapshotUnavailable')
                        : t('restrictedZone.badge.cameraOffline')
              }
              className={`absolute top-14 left-1/2 -translate-x-1/2 max-w-[85%] truncate px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm z-20 pointer-events-none text-center ${
                testDetection?.active
                  ? 'bg-[#DF2225]/90 text-white'
                  : 'bg-slate-900/75 text-white/80'
              }`}
            >
              {isAiWorkPaused
                ? t('ppe.badge.aiPaused')
                : scopedPreview.status === 'LIVE'
                  ? t('restrictedZone.badge.liveSnapshot1s')
                  : scopedPreview.status === 'REPLAY'
                    ? t('restrictedZone.badge.replaySnapshot1s')
                    : scopedPreview.status === 'UNAVAILABLE'
                      ? t('restrictedZone.badge.snapshotUnavailable')
                      : t('restrictedZone.badge.cameraOffline')}{' '}
              ·{' '}
              {testDetection
                ? testDetection.active
                  ? t('restrictedZone.badge.zoneEntry')
                  : t('restrictedZone.badge.scanning')
                : t('ppe.badge.resultNoTargets')}{' '}
              · {isLive ? clockTime : '--:--'}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[52%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* Manually adjustable restricted-zone polygon mapped through video content area */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              onPointerMove={canEditGeometry ? updateZonePoint : undefined}
              onPointerUp={() => {
                activeZonePoint.current = null;
              }}
              aria-label={tr('common.restricted_zone_editor')}
              style={{
                visibility:
                  effectiveUser || isControlled || isAiWorkPaused
                    ? 'hidden'
                    : isEditingZone && canEditGeometry
                      ? 'visible'
                      : preview
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
                canEditGeometry &&
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

            <div className="absolute left-4 bottom-16 z-20 flex flex-col gap-1.5 items-start">
              <div className="flex items-center gap-2">
                {effectiveUser ? (
                  <span className="rounded bg-slate-900/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-slate-300 backdrop-blur-sm border border-slate-700">
                    {t('restrictedZone.scope.readOnlyValue')}
                  </span>
                ) : !isEditingZone ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditingZone(true)}
                      disabled={isAiWorkPaused || (effectiveUser ? !canEditGeometry : false)}
                      title={
                        effectiveUser && !canEditGeometry
                          ? scopedPreview.status !== 'LIVE'
                            ? t('restrictedZone.controls.editDisabledNotLive')
                            : t('restrictedZone.controls.editDisabledMismatch')
                          : tr('common.edit_zone_draft')
                      }
                      className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <button
                      onClick={saveDraft}
                      disabled={effectiveUser ? !canEditGeometry : false}
                      className="rounded bg-amber-600 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-amber-700 disabled:opacity-60 cursor-pointer"
                    >
                      {tr('common.save_local_draft')}
                    </button>
                    <button
                      onClick={resetToAuthoritative}
                      className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950 cursor-pointer"
                    >
                      {t('restrictedZone.controls.resetBtn')}
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
                  {presentZoneMessage(saveStatusMessage, t)}
                </div>
              )}
            </div>

            {/* Empty live frame indicator */}
            {isLive && zoneDetections.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded text-white/90 text-xs font-semibold text-center max-w-md">
                  {scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                    ? t('restrictedZone.viewport.emptyFrameReplay')
                    : t('restrictedZone.viewport.emptyFrameLive')}
                </div>
              </div>
            )}
          </div>

          {/* Top Header Overlay */}
          <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white pointer-events-none">
            <div className="flex flex-col gap-0.5 max-w-[70%] sm:max-w-[75%] min-w-0 pr-2">
              <span
                title={activeCameraContext.camera}
                className="font-bold text-sm tracking-wide text-white drop-shadow-md truncate"
              >
                {activeCameraContext.camera}
              </span>
              <span
                title={activeCameraContext.workArea}
                className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md truncate"
              >
                {activeCameraContext.workArea}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 backdrop-blur-sm flex-shrink-0">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isAiWorkPaused
                    ? 'bg-amber-400'
                    : scopedPreview.status === 'LIVE'
                      ? 'bg-[#DF2225] animate-ping'
                      : scopedPreview.status === 'REPLAY'
                        ? 'bg-blue-400'
                        : socketError
                          ? 'bg-amber-400'
                          : 'bg-slate-400'
                }`}
              />
              <span className="font-mono text-[10px] font-bold text-white tracking-wider">
                {isAiWorkPaused
                  ? t('ppe.header.status.paused')
                  : scopedPreview.status === 'LIVE'
                    ? t('restrictedZone.headerOverlay.liveSnapshotTime', { time: clockTime })
                    : scopedPreview.status === 'REPLAY'
                      ? t('restrictedZone.headerOverlay.replaySnapshotTime', { time: clockTime })
                      : socketError
                        ? t('restrictedZone.headerOverlay.snapshotUnavailable')
                        : t('restrictedZone.headerOverlay.offline')}
              </span>
            </div>
          </div>

          {/* Snapshot error message banner if present */}
          {socketError && (
            <div className="relative z-10 px-5 py-1.5 bg-amber-900/80 text-amber-200 text-xs flex items-center justify-between gap-2 backdrop-blur-sm">
              <div className="flex items-center gap-2 truncate">
                <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                <span className="truncate">
                  {t('restrictedZone.errorBanner.cameraSnapshotPrefix', { error: socketError })}
                </span>
              </div>
              <button
                type="button"
                onClick={scopedPreview.retry}
                className="text-[10px] font-bold underline hover:text-white cursor-pointer flex-shrink-0"
              >
                {t('mf06.detail.retry')}
              </button>
            </div>
          )}

          {/* Bottom Camera Controls Bar Overlay */}
          <div className="relative z-10 px-5 py-3 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-white/70 font-medium">
                {isAiWorkPaused
                  ? t('ppe.toolbar.captionPaused')
                  : scopedPreview.status === 'LIVE'
                    ? t('restrictedZone.toolbar.liveSnapshot1s')
                    : scopedPreview.status === 'REPLAY'
                      ? t('restrictedZone.toolbar.replaySnapshot1s')
                      : t('restrictedZone.toolbar.cameraOffline')}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled
                className="p-1.5 rounded text-white/40 cursor-not-allowed"
                title={tr('ppe_monitoring_view.multi_camera_grid_view_is_currently_unavailable')}
                aria-label={tr('common.grid_view_unavailable')}
              >
                <IconGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void containerRef.current?.requestFullscreen()}
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
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 flex flex-col h-[600px] xl:h-[466px] min-w-0 overflow-hidden">
          <div className="flex-1 p-4 sm:p-5 space-y-4 overflow-y-auto min-h-0">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 min-w-0">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                {tr('common.detection_details')}
              </span>
              <span className="max-w-full break-all font-mono text-[11px] font-semibold text-slate-600">
                {testDetection?.eventId ?? tr('common.no_detection')}
              </span>
            </div>

            {/* 2-Column Metadata Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.identity')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                    ? tr('ppe_monitoring_view.unknown_not_identified')
                    : tr('common.no_person_detected')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.track_id')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {zoneDetections
                    .filter((detection) => detection.trackId !== null)
                    .map((detection) => tr('messages.2c6bb8488230', { value1: detection.trackId }))
                    .join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.camera')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {activeCameraContext.camera}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.zone')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1 truncate">
                  {activeCameraContext.workArea}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.detected')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tr('common.detection_confidence')}
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection?.confidence === null || testDetection?.confidence === undefined
                    ? '—'
                    : `${Math.round(testDetection.confidence * 100)}%`}
                </p>
              </div>
            </div>

            <div className="h-px bg-slate-100 w-full" />

            {/* Verification Heading */}
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">
                {tr('common.verification')}
              </p>

              {/* Verification items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 bg-slate-50/80">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">{tr('common.identity')}</p>
                    <p className="text-[11px] text-slate-600">
                      {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                        ? tr('ppe_monitoring_view.unknown_not_identified')
                        : tr('common.no_person_detected')}
                    </p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 bg-slate-50/80">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">
                      {tr('common.site_assignment_1c7828')}
                    </p>
                    <p className="text-[11px] text-slate-600">{tr('common.not_evaluated')}</p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 bg-slate-50/80">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">
                      {tr('common.zone_permission')}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      {tr('common.backend_evaluation_required')}
                    </p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between px-2 pt-2 pb-1 text-xs text-slate-600">
                  <span>{tr('common.permission_validity')}</span>
                  <span className="font-bold text-slate-300">—</span>
                </div>
              </div>
            </div>

            {/* Result Alert Box */}
            <div className="pt-1">
              <div
                className={`rounded-xl border border-l-[3px] p-3 ${
                  testDetection?.active
                    ? 'border-red-200 border-l-red-500 bg-red-50/60'
                    : 'border-slate-200/80 border-l-slate-400 bg-slate-50/80'
                }`}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">
                  {tr('common.result')}
                </p>
                <div
                  className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                    testDetection?.active ? 'text-red-600' : 'text-slate-800'
                  }`}
                >
                  {testDetection?.active && <IconAlertTriangle className="w-3.5 h-3.5" />}
                  <span>
                    {testDetection?.active
                      ? tr('common.zone_entry_observation')
                      : zoneDetections.length === 0
                        ? tr('ppe_monitoring_view.clear_no_targets')
                        : t('ppe.result.scanningSnapshot')}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {testDetection?.active
                    ? tr(
                        'restricted_zone_view.technical_zone_entry_observation_backend_decides_authorization_and_violation',
                      )
                    : isLive
                      ? scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                        ? t('ppe.result.descStreamingReplay')
                        : t('ppe.result.descStreamingLive')
                      : t('ppe.result.descSnapshotOffline')}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-4 pt-3 border-t border-slate-200/80 bg-slate-50/70 space-y-2 flex-shrink-0">
            <button
              onClick={openReviewFromDetection}
              disabled={!testDetection?.active}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs shadow-2xs transition-colors cursor-pointer ${
                testDetection?.active
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
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
              className="w-full py-2.5 px-4 rounded-xl bg-white border border-slate-200 text-slate-800 font-bold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
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
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                      ? 'bg-amber-500'
                      : 'bg-[#DF2225] animate-ping'
                  }`}
                />
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                    ? t('restrictedZone.observations.replayHeading')
                    : tr('restricted_zone_view.live_zone_observations_active')}
                </h3>
              </div>
              <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                {scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                  ? t('restrictedZone.observations.replayDesc')
                  : tr(
                      'restricted_zone_view.technical_zone_entry_detections_are_rendered_directly_on_the_live_camera_feed_abov',
                    )}
              </p>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() =>
                  onNavigate('incidents', {
                    alertType: 'RESTRICTED_ZONE_INTRUSION',
                    ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                  })
                }
                className="self-start sm:self-auto px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
              >
                {tr('ppe_monitoring_view.view_in_safety_alerts')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {tr('common.zone_replay_observations')}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                {t('restrictedZone.table.subtitle')}
                {activeFilterWorker !== null &&
                  tr('messages.becfe40eedac', { value1: activeFilterWorker })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() =>
                    onNavigate('incidents', {
                      alertType: 'RESTRICTED_ZONE_INTRUSION',
                      ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                    })
                  }
                  className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                >
                  {tr('ppe_monitoring_view.view_in_safety_alerts')}
                </button>
              )}
              <button
                onClick={() => setZoneFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                  zoneFilter === 'ALL'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tr('common.all_events_value', { value1: events.length })}
              </button>
              <button
                onClick={() => setZoneFilter('ACTIVE_ONLY')}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                  zoneFilter === 'ACTIVE_ONLY'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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
                <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
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
              <tbody className="divide-y divide-slate-100">
                {displayedEvents.map((evt) => (
                  <tr key={evt.rowKey} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3 px-3 font-mono text-slate-600 text-xs">{evt.time}</td>
                    <td className="py-3 px-3 font-semibold text-slate-900">
                      {localizeMessage(evt.person)}
                    </td>
                    <td className="py-3 px-3 text-slate-600">{evt.zone}</td>
                    <td className="py-3 px-3 font-mono text-slate-600 text-xs">{evt.camera}</td>
                    <td className="py-3 px-3 text-slate-600">{localizedLabel(evt.identity)}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {presentZoneLabel(evt.authorization, t)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          evt.result === 'Violation'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : evt.result === 'Access Valid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {presentZoneLabel(evt.result, t)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => setSelectedIncident(evt)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold transition-colors bg-slate-50 text-slate-800 hover:bg-slate-100"
                      >
                        {tr('common.review')}
                      </button>
                    </td>
                  </tr>
                ))}
                {displayedEvents.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500 text-xs">
                      {tr('restricted_zone_view.no_zone_events_match_the_selected_criteria')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical MF06 Zone Assessments and Request Status */}
      {isSiteMetadataSettled && (
        <Mf06ZoneAssessmentPanel
          token={apiToken}
          siteId={selectedSiteId}
          credentialId={`${sessionScope}:${metadataCredential}`}
          apiUrl={apiUrl}
          client={client}
          onUnauthorized={handleHistoryUnauthorized}
        />
      )}

      {/* Incident Review Modal with Bound Data */}
      <PpeDialog
        open={Boolean(selectedIncident)}
        onClose={() => setSelectedIncident(null)}
        title={tr('common.review_action')}
      >
        {selectedIncident && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                {selectedIncident.id}
              </span>
              <span className="text-xs font-medium text-slate-600">
                {t('restrictedZone.reviewModal.previewBadge')}
              </span>
            </div>

            <div className="space-y-4 text-sm text-slate-600">
              <p>
                {tr('restricted_zone_view.you_are_reviewing_a_technical_observation_at')}{' '}
                <strong className="text-slate-900">
                  {selectedIncident.zone} ({selectedIncident.camera})
                </strong>
                {tr('restricted_zone_view.ai_reported_a_track_candidate')}{' '}
                <strong className="text-slate-900">
                  {localizeMessage(selectedIncident.person)}
                </strong>{' '}
                {tr('common.with_status')}{' '}
                <strong className="text-slate-900">
                  {presentZoneLabel(selectedIncident.authorization, t)}
                </strong>
                .
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  {tr('common.technical_evidence_preview')}
                </p>
                <p className="text-slate-600 text-xs leading-relaxed">
                  {tr(
                    'restricted_zone_view.ai_zone_detections_are_preliminary_observations_to_inspect_session_scoped_evidence',
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200/80">
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
              >
                {tr('common.dismiss_preview')}
              </button>
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIncident(null);
                    onNavigate('incidents', {
                      alertType: 'RESTRICTED_ZONE_INTRUSION',
                      ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                    });
                  }}
                  className="px-4 py-2 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                >
                  {tr('ppe_monitoring_view.review_in_safety_alerts')}
                </button>
              ) : (
                <button
                  disabled
                  title={tr('ppe_monitoring_view.safety_alerts_navigation_not_configured')}
                  className="px-4 py-2 rounded-lg bg-[#0F172A]/60 text-white text-xs font-semibold cursor-not-allowed shadow-xs transition-colors"
                >
                  {tr('common.review_in_alerts')}
                </button>
              )}
            </div>
          </div>
        )}
      </PpeDialog>
    </div>
  );
}
