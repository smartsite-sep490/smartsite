import type { PpeItem } from '@smartsite/contracts/ppe-items';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import { useScopedCameraMedia } from '../cameras/useScopedCameraMedia';
import { RawCameraMediaCanvas } from '../cameras/RawCameraMediaCanvas';
import { useScopedRecordedVideo } from '../cameras/useScopedRecordedVideo';
import {
  POSITIVE_PPE_OBJECT_CLASSES,
  NEGATIVE_PPE_OBJECT_CLASSES,
} from '../cameras/realtimePreview';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type SiteResponse,
  ApiError,
} from '@smartsite/api-client';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconGrid,
  IconShield,
  IconEye,
  IconCamera,
} from '../icons';
import { ZonePpeSetupDialog } from './ZonePpeSetupDialog';
import { deriveZonePpeCapabilities } from './zone-ppe-scope';
import { CameraRegistrationDialog } from '../cameras/CameraRegistrationDialog';
import { CameraManagementDialog } from '../cameras/CameraManagementDialog';
import { PpeDialog } from './PpeDialog';
import { Mf05DemoControlPanel } from './Mf05DemoControlPanel';
import { FourSourceWall, type ScopedWallSnapshot } from './FourSourceWall';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';

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

function getSafePublicMetadataErrorMessage(
  err: unknown,
  entity: 'site' | 'camera',
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
    return t('ppe.error.metadata401');
  }
  if (status === 403) {
    return t('ppe.error.metadata403');
  }
  if (status === 404) {
    return entity === 'site' ? t('ppe.error.site404') : t('ppe.error.camera404');
  }
  return entity === 'site' ? t('ppe.error.siteLoadFailed') : t('ppe.error.cameraLoadFailed');
}

export type DisplayPreset = 'FULL_EIGHT' | 'GROUND' | 'EYE_FACE' | 'HEIGHT';

const DISPLAY_PRESET_CONFIG: Record<
  DisplayPreset,
  {
    id: DisplayPreset;
    label: string;
    shortLabel: string;
    labelKey: TranslationKey;
    shortLabelKey: TranslationKey;
    descriptionKey: TranslationKey;
    classes: readonly string[];
    description: string;
  }
> = {
  FULL_EIGHT: {
    id: 'FULL_EIGHT',
    label: 'Full eight',
    shortLabel: 'Full 8',
    labelKey: 'ppe.preset.FULL_EIGHT.label',
    shortLabelKey: 'ppe.preset.FULL_EIGHT.shortLabel',
    descriptionKey: 'ppe.preset.FULL_EIGHT.description',
    classes: POSITIVE_PPE_OBJECT_CLASSES,
    description: 'All 8 positive PPE object families',
  },
  GROUND: {
    id: 'GROUND',
    label: 'Ground (Helmet/Vest/Gloves/Boots)',
    shortLabel: 'Ground',
    labelKey: 'ppe.preset.GROUND.label',
    shortLabelKey: 'ppe.preset.GROUND.shortLabel',
    descriptionKey: 'ppe.preset.GROUND.description',
    classes: ['Hardhat', 'Safety Vest', 'Gloves', 'Boots'],
    description: 'Helmet, Vest, Gloves, Boots',
  },
  EYE_FACE: {
    id: 'EYE_FACE',
    label: 'Eye/face (Goggles/Mask)',
    shortLabel: 'Eye/face',
    labelKey: 'ppe.preset.EYE_FACE.label',
    shortLabelKey: 'ppe.preset.EYE_FACE.shortLabel',
    descriptionKey: 'ppe.preset.EYE_FACE.description',
    classes: ['Goggles', 'Mask'],
    description: 'Goggles, Mask',
  },
  HEIGHT: {
    id: 'HEIGHT',
    label: 'Height (Harness/Hook)',
    shortLabel: 'Height',
    labelKey: 'ppe.preset.HEIGHT.label',
    shortLabelKey: 'ppe.preset.HEIGHT.shortLabel',
    descriptionKey: 'ppe.preset.HEIGHT.description',
    classes: ['fullbody-Harness', 'Lanyard-Hook'],
    description: 'Harness, Hook',
  },
};

function getDefaultDisplayPresetForCamera(
  camera?: { id?: string; code?: string; externalId?: string } | null,
): DisplayPreset {
  if (!camera) return 'FULL_EIGHT';
  const identifiers = [camera.externalId, camera.code, camera.id]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());

  for (const id of identifiers) {
    if (id.includes('tapo-core5-live')) return 'GROUND';
    if (id.includes('laptop-webcam-live')) return 'EYE_FACE';
    if (id.includes('core5-recorded-demo')) return 'HEIGHT';
    if (id.includes('helmet-vest-recorded-demo')) return 'GROUND';
  }
  return 'FULL_EIGHT';
}

/**
 * Known LIVE demo camera source external IDs for MF05 bounded deployment.
 *
 * NOTE: CameraResponse currently does NOT contain a camera sourceKind field.
 * Raw video mode activation must not depend on inference availability or flap
 * on expired AI preview snapshots. Until the backend management API introduces
 * explicit camera media source metadata, live streaming is bounded to the two
 * verified live hardware capture sources (Tapo C200 live RTSP, Laptop webcam live).
 * Recorded demo feeds (core5-recorded-demo, helmet-vest-recorded-demo) are strictly REPLAY
 * and must not activate raw live streaming. Display name inference is strictly prohibited.
 */
const KNOWN_LIVE_CAMERA_EXTERNAL_IDS = new Set<string>(['tapo-core5-live', 'laptop-webcam-live']);

function isLiveCameraSource(externalId: string | null | undefined): boolean {
  if (!externalId) return false;
  return KNOWN_LIVE_CAMERA_EXTERNAL_IDS.has(externalId.trim().toLowerCase());
}

/**
 * Known RECORDED demo camera source external IDs for MF05 bounded deployment.
 *
 * NOTE: CameraResponse currently does NOT contain a camera sourceKind field.
 * Native recorded video playback is bounded to the two verified replay demo feeds:
 * - core5-recorded-demo (core 5 items test sequence)
 * - helmet-vest-recorded-demo (ground PPE test sequence)
 * Other cameras must remain strictly on AI evidence snapshots. Display name inference
 * is strictly prohibited.
 */
const KNOWN_RECORDED_CAMERA_EXTERNAL_IDS = new Set<string>([
  'core5-recorded-demo',
  'helmet-vest-recorded-demo',
]);

function isRecordedCameraSource(externalId: string | null | undefined): boolean {
  if (!externalId) return false;
  return KNOWN_RECORDED_CAMERA_EXTERNAL_IDS.has(externalId.trim().toLowerCase());
}
import {
  getPpeItemDisplayState,
  getPpeResultState,
  isConfirmedPpeDetection,
  getPpeEventRowKey,
  formatClockTime,
  resolveCameraAndWorkArea,
  filterPpeEvents,
  formatPpeItemLabel,
} from '../cameras/monitoringUtils';
import { useAuth, useManagementClient } from '../../features/auth/auth-session';
import type { SharedSession } from '../../types/shared-session';
import { translate as tr } from '../../i18n/runtime';
import '../cameras/camera-setup-catalog';

const authIdentities = new WeakMap<QueryClient, { token: string | null; id: number }>();
let nextScopeId = 0;

function getCredentialId(queryClient: QueryClient, token: string | null | undefined): number {
  if (!token) return 0;
  const current = authIdentities.get(queryClient);
  if (current && current.token === token) return current.id;
  const id = ++nextScopeId;
  authIdentities.set(queryClient, { token, id });
  return id;
}

function formatCapturedFrameTime(capturedAt: string | null | undefined): string {
  if (typeof capturedAt !== 'string') return '—';
  const trimmed = capturedAt.trim();
  const fields =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(
      trimmed,
    );
  if (!fields) return '—';
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = fields;
  const year = Number(yearText),
    month = Number(monthText),
    day = Number(dayText);
  const hour = Number(hourText),
    minute = Number(minuteText),
    second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  // Date parsing can roll February 30 or 24:00 into a different instant; never relabel that as source evidence time.
  if (!daysInMonth || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59)
    return '—';
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatClockTime(parsed);
}

export interface PpeReviewItem {
  id: string;
  rowKey: string;
  trackId: number | null;
  ppeItem?: PpeItem;
  worker: string;
  camera: string;
  workArea: string;
  issue: string;
  rawIssue?: string;
  cameraFallbackKey?: TranslationKey;
  workAreaFallbackKey?: TranslationKey;
  statusKey?: TranslationKey;
  confidence: string;
  status: string;
  time: string;
}

interface ScopedReview {
  item: PpeReviewItem;
  scope: {
    apiUrl: string;
    credentialId: number;
    sessionScope: string;
    siteId: string;
    cameraId: string;
  };
}

export interface PpeMonitoringViewProps {
  initialSelection?: { siteId?: string; cameraId?: string };
  onOpenSetup?: (context: { siteId: string; cameraId?: string }) => void;
  apiUrl?: string;
  sharedSession?: SharedSession | null;
  onNavigate?: (
    tab: 'incidents',
    context?: {
      alertType?: 'PPE_VIOLATION';
      siteId?: string;
      alertId?: string;
    },
  ) => void;
}

const CORE_PPE_ITEMS: PpeItem[] = ['HARD_HAT', 'SAFETY_VEST'];
const EXPANDED_PPE_ITEMS: PpeItem[] = ['GLOVES', 'BOOTS', 'GOGGLES'];

export function PpeMonitoringView({
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000',
  sharedSession,
  onNavigate,
  onOpenSetup,
  initialSelection,
}: PpeMonitoringViewProps = {}) {
  const auth = useAuth();
  const { t } = useLocale();
  const diagnosticsContentId = useId();
  const queryClient = useQueryClient();
  const isControlled = sharedSession !== undefined;
  const token = isControlled ? (sharedSession?.accessToken ?? '') : (auth.accessToken ?? '');
  const sessionScope = isControlled
    ? (sharedSession?.sessionScope ?? '')
    : (auth.sessionScope ?? '');
  const sessionClient = useManagementClient(apiUrl);
  const controlledClient = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const client =
    !isControlled || (token === auth.accessToken && sessionScope === auth.sessionScope)
      ? sessionClient
      : controlledClient;

  const credentialId = useMemo(() => getCredentialId(queryClient, token), [queryClient, token]);

  const [selectedReview, setSelectedReview] = useState<ScopedReview | null>(null);
  const [clockTime, setClockTime] = useState<string>(() => formatClockTime());
  const [activeFilterWorker] = useState<number | null>(null);
  const [ppeFilter] = useState<'ALL' | PpeItem>('ALL');
  const [showModelObjects, setShowModelObjects] = useState(false);
  const [viewMode, setViewMode] = useState<'single' | 'wall'>('single');
  const [cameraDisplayPresets, setCameraDisplayPresets] = useState<Record<string, DisplayPreset>>(
    {},
  );
  const [wallTileSnapshots, setWallTileSnapshots] = useState<Record<string, ScopedWallSnapshot>>(
    {},
  );

  // Own scoped TanStack me query: only enabled when !isControlled && token && sessionScope
  const meQuery = useQuery<AccountResponse>({
    queryKey: ['ppe-monitoring', apiUrl, sessionScope, credentialId, 'me'],
    queryFn: () => client.me(token),
    enabled: !isControlled && Boolean(token && sessionScope),
    gcTime: 0,
    staleTime: 5 * 60 * 1000,
  });

  const effectiveUser = isControlled ? (sharedSession?.user ?? null) : (meQuery.data ?? null);
  const isGlobalAdmin = useMemo(() => {
    if (!effectiveUser || effectiveUser.mustChangePassword === true) return false;
    return effectiveUser.roleAssignments.some(
      ({ role, siteId }) => role === 'ADMIN' && siteId === null,
    );
  }, [effectiveUser]);

  const isAiWorkPaused =
    import.meta.env.VITE_AI_WORK_PAUSED === 'true' || import.meta.env.VITE_AI_WORK_PAUSED === true;

  const [isZonePpeOpen, setIsZonePpeOpen] = useState(false);
  const [isRegisterCameraOpen, setIsRegisterCameraOpen] = useState(false);
  const [isManageCameraOpen, setIsManageCameraOpen] = useState(false);
  const [rejectedRegistrationCredential, setRejectedRegistrationCredential] = useState<
    number | null
  >(null);
  const [registrationFeedback, setRegistrationFeedback] = useState<string | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [requestedSiteId, setSelectedSiteId] = useState<string>(initialSelection?.siteId ?? '');
  const [requestedCameraId, setSelectedCameraId] = useState<string>(
    initialSelection?.cameraId ?? '',
  );
  const [applyingCameraScope, setApplyingCameraScope] = useState<string | null>(null);
  const expiredScopeRef = useRef<string | null>(null);

  const activeTokenRef = useRef(token);
  const activeSessionScopeRef = useRef(sessionScope);
  const activeCredentialIdRef = useRef(credentialId);
  const activeSiteIdRef = useRef('');
  useLayoutEffect(() => {
    activeTokenRef.current = token;
    activeSessionScopeRef.current = sessionScope;
    activeCredentialIdRef.current = credentialId;
  }, [token, sessionScope, credentialId]);

  // Reset selection states when scope changes (render-phase sync, no manual removeQueries)
  const currentScopeToken = `${apiUrl}:${sessionScope}:${credentialId}`;
  const [prevScopeToken, setPrevScopeToken] = useState(currentScopeToken);
  if (prevScopeToken !== currentScopeToken) {
    setPrevScopeToken(currentScopeToken);
    setSelectedSiteId('');
    setSelectedCameraId('');
    setIsZonePpeOpen(false);
    setIsRegisterCameraOpen(false);
    setIsManageCameraOpen(false);
    setRejectedRegistrationCredential(null);
    setRegistrationFeedback(null);
    setApplyingCameraScope(null);
    setWallTileSnapshots({});
    setCameraDisplayPresets({});
  }
  useLayoutEffect(() => {
    expiredScopeRef.current = null;
  }, [currentScopeToken]);

  // 1. Load authorized sites for user - Explicit Accumulative Pagination
  const sitesInfiniteQuery = useInfiniteQuery({
    queryKey: ['ppe-monitoring', apiUrl, sessionScope, credentialId, 'sites', 'pages'],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listSites(token, { offset: pageParam, limit: 20 }, { signal });
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length > 20
      ) {
        throw new Error('Malformed site page');
      }
      if (page.items.length === 0 && pageParam < page.total) {
        throw new Error('Non-progressing site page');
      }
      return page;
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.items.length;
      return lastPage.items.length > 0 && nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(token && sessionScope && (!isControlled || sharedSession !== null)),
    gcTime: 0,
    retry: false,
  });

  const allFetchedSites = useMemo(() => {
    if (!sitesInfiniteQuery.data?.pages) return [];
    const seen = new Set<string>();
    const list: SiteResponse[] = [];
    for (const page of sitesInfiniteQuery.data.pages) {
      for (const s of page.items) {
        if (s && s.id && !seen.has(s.id)) {
          seen.add(s.id);
          list.push(s);
        }
      }
    }
    return list;
  }, [sitesInfiniteQuery.data]);

  const siteServerTotal = sitesInfiniteQuery.data?.pages.at(-1)?.total ?? 0;

  const sitesError = sitesInfiniteQuery.error;
  const isSitesHard = isAuthOrScopeError(sitesError);
  const isSitesBaseError = Boolean(
    sitesError &&
    (isSitesHard || !sitesInfiniteQuery.isFetchNextPageError || allFetchedSites.length === 0),
  );
  const isTransientNextSitesError = Boolean(
    sitesError &&
    !isSitesHard &&
    sitesInfiniteQuery.isFetchNextPageError &&
    allFetchedSites.length > 0,
  );

  const visibleAuthorizedSites = useMemo(
    () => (isSitesBaseError ? [] : allFetchedSites),
    [isSitesBaseError, allFetchedSites],
  );

  const isSitesInitialLoading = Boolean(
    token && sessionScope && sitesInfiniteQuery.isLoading && !sitesInfiniteQuery.data,
  );

  const holdLinkedSite = Boolean(
    initialSelection?.siteId && initialSelection.siteId === requestedSiteId,
  );
  const selectedSiteId = visibleAuthorizedSites.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : holdLinkedSite
      ? ''
      : (visibleAuthorizedSites[0]?.id ?? '');

  const canViewSiteCameras = useMemo(() => {
    if (!isControlled) return true;
    const user = sharedSession?.user;
    if (
      !user ||
      user.mustChangePassword === true ||
      !selectedSiteId ||
      !Array.isArray(user.roleAssignments)
    ) {
      return false;
    }
    return user.roleAssignments.some(
      ({ role, siteId }) =>
        (role === 'ADMIN' && siteId === null) ||
        (role === 'SAFETY_OFFICER' && siteId === selectedSiteId),
    );
  }, [isControlled, sharedSession, selectedSiteId]);

  // 2. Load preview-eligible cameras for selected site - Explicit Accumulative Pagination
  const previewCamerasInfiniteQuery = useInfiniteQuery({
    queryKey: [
      'ppe-monitoring',
      apiUrl,
      sessionScope,
      credentialId,
      selectedSiteId,
      'cameras',
      'pages',
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listPreviewCameras(
        token,
        selectedSiteId,
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
    enabled: Boolean(
      token &&
      sessionScope &&
      selectedSiteId &&
      canViewSiteCameras &&
      !isSitesBaseError &&
      (!isControlled || sharedSession !== null),
    ),
    gcTime: 0,
    retry: false,
  });

  const allFetchedCameras = useMemo(() => {
    if (!canViewSiteCameras || !previewCamerasInfiniteQuery.data?.pages) return [];
    const seen = new Set<string>();
    const list: CameraResponse[] = [];
    for (const page of previewCamerasInfiniteQuery.data.pages) {
      for (const cam of page.items) {
        // Strict same-site filter before deduplication
        if (cam && cam.siteId === selectedSiteId && cam.id && !seen.has(cam.id)) {
          seen.add(cam.id);
          list.push(cam);
        }
      }
    }
    return list;
  }, [canViewSiteCameras, previewCamerasInfiniteQuery.data, selectedSiteId]);

  const cameraServerTotal = canViewSiteCameras
    ? (previewCamerasInfiniteQuery.data?.pages.at(-1)?.total ?? 0)
    : 0;

  const camerasError = canViewSiteCameras ? previewCamerasInfiniteQuery.error : null;
  const isCamerasHard = isAuthOrScopeError(camerasError);
  const isCamerasBaseError = Boolean(
    isSitesBaseError ||
    (camerasError &&
      (isCamerasHard ||
        !previewCamerasInfiniteQuery.isFetchNextPageError ||
        allFetchedCameras.length === 0)),
  );
  const isTransientNextCamerasError = Boolean(
    !isSitesBaseError &&
    camerasError &&
    !isCamerasHard &&
    previewCamerasInfiniteQuery.isFetchNextPageError &&
    allFetchedCameras.length > 0,
  );

  const visibleAuthorizedCameras = useMemo(
    () => (isCamerasBaseError ? [] : allFetchedCameras),
    [isCamerasBaseError, allFetchedCameras],
  );

  const isCamerasInitialLoading = Boolean(
    canViewSiteCameras &&
    token &&
    sessionScope &&
    selectedSiteId &&
    !isSitesBaseError &&
    previewCamerasInfiniteQuery.isLoading &&
    !previewCamerasInfiniteQuery.data,
  );

  const holdLinkedCamera = Boolean(
    canViewSiteCameras &&
    initialSelection?.cameraId &&
    initialSelection.cameraId === requestedCameraId,
  );
  const selectedCameraId = visibleAuthorizedCameras.some(
    (camera) => camera.id === requestedCameraId,
  )
    ? requestedCameraId
    : holdLinkedCamera
      ? ''
      : (visibleAuthorizedCameras[0]?.id ?? '');

  if (requestedSiteId !== selectedSiteId && selectedSiteId) {
    setSelectedSiteId(selectedSiteId);
  }
  if (requestedCameraId !== selectedCameraId && selectedCameraId) {
    setSelectedCameraId(selectedCameraId);
  }
  if (isSitesBaseError && isZonePpeOpen) {
    setIsZonePpeOpen(false);
  }
  if (isSitesBaseError && isRegisterCameraOpen) {
    setIsRegisterCameraOpen(false);
  }
  if (isSitesBaseError && isManageCameraOpen) {
    setIsManageCameraOpen(false);
  }
  if (isSitesBaseError && registrationFeedback) {
    setRegistrationFeedback(null);
  }

  const isSiteSettledEmpty = Boolean(
    token &&
    sessionScope &&
    (!isControlled || sharedSession !== null) &&
    !isSitesInitialLoading &&
    !isSitesBaseError &&
    sitesInfiniteQuery.isSuccess &&
    !sitesInfiniteQuery.isFetching &&
    visibleAuthorizedSites.length === 0 &&
    !sitesInfiniteQuery.hasNextPage,
  );

  const isCameraSettledEmpty = Boolean(
    canViewSiteCameras &&
    token &&
    sessionScope &&
    (!isControlled || sharedSession !== null) &&
    selectedSiteId &&
    visibleAuthorizedSites.length > 0 &&
    !isSitesBaseError &&
    !isCamerasBaseError &&
    !isCamerasInitialLoading &&
    previewCamerasInfiniteQuery.isSuccess &&
    !previewCamerasInfiniteQuery.isFetching &&
    visibleAuthorizedCameras.length === 0,
  );

  const isCamerasRefreshing = Boolean(
    canViewSiteCameras &&
    selectedSiteId &&
    previewCamerasInfiniteQuery.isFetching &&
    !previewCamerasInfiniteQuery.isFetchingNextPage &&
    !isCamerasInitialLoading &&
    !isCamerasBaseError &&
    !isSitesBaseError,
  );

  const hasNextCameraPage = Boolean(canViewSiteCameras && previewCamerasInfiniteQuery.hasNextPage);

  // Memo-derived query.data { items, total } facade for consistent consumer compatibility
  const sitesQuery = useMemo(
    () => ({
      ...sitesInfiniteQuery,
      data: {
        items: visibleAuthorizedSites,
        total: siteServerTotal,
      },
    }),
    [sitesInfiniteQuery, visibleAuthorizedSites, siteServerTotal],
  );

  const previewCamerasQuery = useMemo(
    () => ({
      ...previewCamerasInfiniteQuery,
      data: {
        items: visibleAuthorizedCameras,
        total: cameraServerTotal,
      },
    }),
    [previewCamerasInfiniteQuery, visibleAuthorizedCameras, cameraServerTotal],
  );

  // Render-phase sync when siteId changes: clear stale wall tile snapshots immediately
  const [prevSiteScope, setPrevSiteScope] = useState(selectedSiteId);
  if (prevSiteScope !== selectedSiteId) {
    setPrevSiteScope(selectedSiteId);
    setIsZonePpeOpen(false);
    setIsRegisterCameraOpen(false);
    setIsManageCameraOpen(false);
    setRegistrationFeedback(null);
    setWallTileSnapshots({});
    setCameraDisplayPresets({});
  }
  useLayoutEffect(() => {
    activeSiteIdRef.current = selectedSiteId;
  }, [selectedSiteId]);

  const zonePpeCapabilities = useMemo(
    () => deriveZonePpeCapabilities(effectiveUser, selectedSiteId),
    [effectiveUser, selectedSiteId],
  );
  const canRegisterCamera = Boolean(
    zonePpeCapabilities.canManageRegions &&
    token &&
    sessionScope &&
    (!isControlled || sharedSession !== null) &&
    selectedSiteId &&
    !isSitesBaseError &&
    !isSitesInitialLoading &&
    rejectedRegistrationCredential !== credentialId &&
    ![sitesQuery.error, previewCamerasQuery.error, meQuery.error].some(
      (error) => error instanceof ApiError && error.status === 401,
    ) &&
    visibleAuthorizedSites.some((s) => s.id === selectedSiteId),
  );

  if (!canRegisterCamera && isRegisterCameraOpen) {
    setIsRegisterCameraOpen(false);
  }
  if (!canRegisterCamera && registrationFeedback) {
    setRegistrationFeedback(null);
  }

  const canOpenZonePpe =
    (isGlobalAdmin || zonePpeCapabilities.canManageZones || zonePpeCapabilities.canManageRegions) &&
    Boolean(token && sessionScope && selectedSiteId) &&
    !isSitesBaseError &&
    ![sitesQuery.error, previewCamerasQuery.error, meQuery.error].some(
      (error) => error instanceof ApiError && error.status === 401,
    );

  if (!canOpenZonePpe && isZonePpeOpen) {
    setIsZonePpeOpen(false);
  }

  const triggerSessionExpired = auth.triggerSessionExpired;

  const handleTileUnmount = useCallback((cameraId: string) => {
    setWallTileSnapshots((prev) => {
      if (!prev[cameraId]) return prev;
      const next = { ...prev };
      delete next[cameraId];
      return next;
    });
  }, []);

  const handleTilePreviewUpdate = useCallback(
    (snapshot: ScopedWallSnapshot) => {
      // Synchronous late callback rejection:
      // If the incoming snapshot belongs to a superseded scope (different apiUrl, credentialId, sessionScope, siteId, client, or token),
      // drop it immediately. Never allow late callbacks from past sessions or unmounted sites to write into state.
      if (
        snapshot.scope.apiUrl !== apiUrl ||
        snapshot.scope.credentialId !== credentialId ||
        snapshot.scope.sessionScope !== sessionScope ||
        snapshot.scope.siteId !== selectedSiteId ||
        snapshot.scope.token !== token ||
        snapshot.scope.client !== client
      ) {
        return;
      }

      // Propagate 401 auth expiration from EACH tile in wall mode immediately
      if (snapshot.errorStatus === 401) {
        if (expiredScopeRef.current !== sessionScope) {
          expiredScopeRef.current = sessionScope;
          triggerSessionExpired(sessionScope);
          if (isControlled && sharedSession?.onSignOut) {
            sharedSession.onSignOut();
          }
        }
        return;
      }

      if (!canViewSiteCameras) return;

      setWallTileSnapshots((prev) => {
        const curr = prev[snapshot.scope.cameraId];
        if (
          curr?.preview === snapshot.preview &&
          curr?.status === snapshot.status &&
          curr?.sourceKind === snapshot.sourceKind &&
          curr?.capturedAt === snapshot.capturedAt &&
          curr?.errorStatus === snapshot.errorStatus &&
          curr?.scope.apiUrl === snapshot.scope.apiUrl &&
          curr?.scope.credentialId === snapshot.scope.credentialId &&
          curr?.scope.sessionScope === snapshot.scope.sessionScope &&
          curr?.scope.siteId === snapshot.scope.siteId &&
          curr?.scope.cameraId === snapshot.scope.cameraId &&
          curr?.scope.client === snapshot.scope.client &&
          curr?.scope.token === snapshot.scope.token
        ) {
          return prev;
        }
        return {
          ...prev,
          [snapshot.scope.cameraId]: snapshot,
        };
      });
    },
    [
      canViewSiteCameras,
      apiUrl,
      credentialId,
      sessionScope,
      selectedSiteId,
      token,
      client,
      isControlled,
      sharedSession,
      triggerSessionExpired,
    ],
  );

  // MF05 Demo controls gating and scoped applying state
  const isDemoControlsEnabled =
    import.meta.env.VITE_MF05_DEMO_CONTROLS === 'true' ||
    import.meta.env.VITE_MF05_DEMO_CONTROLS === true;
  const currentCameraScope = `${currentScopeToken}:${selectedSiteId}:${selectedCameraId}`;
  const [prevCameraScope, setPrevCameraScope] = useState(currentCameraScope);
  if (prevCameraScope !== currentCameraScope) {
    setPrevCameraScope(currentCameraScope);
    if (applyingCameraScope !== null) {
      setApplyingCameraScope(null);
    }
  }
  const isApplying = Boolean(applyingCameraScope && applyingCameraScope === currentCameraScope);
  const activeCameraScopeRef = useRef(currentCameraScope);
  useLayoutEffect(() => {
    activeCameraScopeRef.current = currentCameraScope;
  }, [currentCameraScope]);

  // Zero-flash Review Scope Guard: ensure active review matches current scope synchronously
  const isReviewScopeValid =
    canViewSiteCameras &&
    selectedReview !== null &&
    selectedReview.scope.apiUrl === apiUrl &&
    selectedReview.scope.credentialId === credentialId &&
    selectedReview.scope.sessionScope === sessionScope &&
    selectedReview.scope.siteId === selectedSiteId &&
    selectedReview.scope.cameraId === selectedCameraId;

  if (selectedReview !== null && !isReviewScopeValid) {
    setSelectedReview(null);
  }

  const activeReviewItem = useMemo<PpeReviewItem | null>(() => {
    if (!isReviewScopeValid || !selectedReview) return null;
    const raw = selectedReview.item;
    const rawLabel = raw.rawIssue !== undefined ? raw.rawIssue : raw.issue;
    return {
      ...raw,
      worker:
        raw.trackId !== null ? t('ppe.trackLabel', { id: raw.trackId }) : t('ppe.untrackedLabel'),
      camera: raw.cameraFallbackKey ? t(raw.cameraFallbackKey) : raw.camera,
      workArea: raw.workAreaFallbackKey ? t(raw.workAreaFallbackKey) : raw.workArea,
      issue: rawLabel && rawLabel.trim().length > 0 ? rawLabel : t('ppe.event.defaultIssue'),
      status: raw.statusKey ? t(raw.statusKey) : raw.status,
    };
  }, [isReviewScopeValid, selectedReview, t]);

  const selectedSite = useMemo(
    () => sitesQuery.data?.items.find((s) => s.id === selectedSiteId) ?? null,
    [sitesQuery.data, selectedSiteId],
  );

  const isCameraViewingRestricted = Boolean(
    isControlled &&
    sharedSession !== null &&
    token &&
    sessionScope &&
    selectedSiteId &&
    selectedSite &&
    !isSitesBaseError &&
    !isSitesInitialLoading &&
    !canViewSiteCameras,
  );

  const selectedCamera = useMemo(
    () => previewCamerasQuery.data?.items.find((c) => c.id === selectedCameraId) ?? null,
    [previewCamerasQuery.data, selectedCameraId],
  );

  const canManageCamera = Boolean(
    zonePpeCapabilities.canManageRegions &&
    token &&
    sessionScope &&
    (!isControlled || sharedSession !== null) &&
    selectedSiteId &&
    selectedCameraId &&
    selectedCamera &&
    !isSitesBaseError &&
    !isSitesInitialLoading &&
    !isCamerasBaseError &&
    !isCamerasInitialLoading &&
    rejectedRegistrationCredential !== credentialId &&
    ![sitesQuery.error, previewCamerasQuery.error, meQuery.error].some(
      (error) => error instanceof ApiError && error.status === 401,
    ) &&
    visibleAuthorizedSites.some((s) => s.id === selectedSiteId) &&
    visibleAuthorizedCameras.some((c) => c.id === selectedCameraId),
  );

  if (!canManageCamera && isManageCameraOpen) {
    setIsManageCameraOpen(false);
  }

  const getPresetForCamera = useCallback(
    (camera?: { id?: string; code?: string; externalId?: string } | null): DisplayPreset => {
      if (!camera?.id) return 'FULL_EIGHT';
      return cameraDisplayPresets[camera.id] ?? getDefaultDisplayPresetForCamera(camera);
    },
    [cameraDisplayPresets],
  );

  const getFilterClassesForCamera = useCallback(
    (camera: CameraResponse): readonly string[] | undefined => {
      const preset = getPresetForCamera(camera);
      return preset === 'FULL_EIGHT' ? undefined : DISPLAY_PRESET_CONFIG[preset].classes;
    },
    [getPresetForCamera],
  );

  const activeDisplayPreset = selectedCamera
    ? getPresetForCamera(selectedCamera)
    : selectedCameraId
      ? (cameraDisplayPresets[selectedCameraId] ?? 'FULL_EIGHT')
      : 'FULL_EIGHT';

  // 3. Connect to scoped backend preview (500ms focused completion delay for single focus view)
  const scopedPreview = useScopedCameraPreview({
    apiUrl,
    client,
    token,
    sessionScope,
    siteId: selectedSiteId,
    cameraId: selectedCameraId,
    enabled: Boolean(
      !isAiWorkPaused &&
      selectedCamera?.status === 'ACTIVE' &&
      viewMode === 'single' &&
      token &&
      sessionScope &&
      selectedSiteId &&
      selectedCameraId &&
      (!isControlled || sharedSession !== null),
    ),
    cadenceMs: 500,
  });

  // CameraResponse does NOT contain sourceKind. Bounded demo identifies the two live
  // hardware capture feeds by known externalId, and two recorded demo feeds by known externalId.
  // Inference availability / AI snapshot must never flap or disable raw video stream activation.
  const isSelectedCameraLive = isLiveCameraSource(selectedCamera?.externalId);
  const isSelectedCameraRecorded = isRecordedCameraSource(selectedCamera?.externalId);

  const mediaScope = `${sessionScope ?? ''}|${selectedSiteId}|${selectedCameraId}`;
  const [requestedMediaMode, setRequestedMediaMode] = useState<{
    scope: string;
    mode: 'live-raw' | 'recorded-raw' | 'ai-analyzed';
  } | null>(null);

  const defaultModeForCamera: 'live-raw' | 'recorded-raw' | 'ai-analyzed' = isSelectedCameraLive
    ? 'live-raw'
    : isSelectedCameraRecorded
      ? 'recorded-raw'
      : 'ai-analyzed';

  const userSelectedMode =
    requestedMediaMode?.scope === mediaScope ? requestedMediaMode.mode : defaultModeForCamera;

  const effectiveStreamViewMode: 'live-raw' | 'recorded-raw' | 'ai-analyzed' = isSelectedCameraLive
    ? userSelectedMode === 'live-raw' || userSelectedMode === 'ai-analyzed'
      ? userSelectedMode
      : 'live-raw'
    : isSelectedCameraRecorded
      ? userSelectedMode === 'recorded-raw' || userSelectedMode === 'ai-analyzed'
        ? userSelectedMode
        : 'recorded-raw'
      : 'ai-analyzed';

  const setStreamViewMode = (mode: 'live-raw' | 'recorded-raw' | 'ai-analyzed') =>
    setRequestedMediaMode({ scope: mediaScope, mode });

  // Connect to authenticated raw NDJSON media stream for ONE selected LIVE camera
  const scopedMedia = useScopedCameraMedia({
    apiUrl,
    client,
    token,
    sessionScope,
    siteId: selectedSiteId,
    cameraId: selectedCameraId,
    cameraExternalId: selectedCamera?.externalId,
    isLive: isSelectedCameraLive,
    enabled: Boolean(
      !isAiWorkPaused &&
      selectedCamera?.status === 'ACTIVE' &&
      viewMode === 'single' &&
      effectiveStreamViewMode === 'live-raw' &&
      isSelectedCameraLive &&
      token &&
      sessionScope &&
      selectedSiteId &&
      selectedCameraId &&
      !isApplying &&
      (!isControlled || sharedSession !== null),
    ),
  });

  // Connect to authenticated recorded MP4 video stream for ONE selected RECORDED camera
  const scopedRecordedVideo = useScopedRecordedVideo({
    apiUrl,
    client,
    token,
    sessionScope,
    siteId: selectedSiteId,
    cameraId: selectedCameraId,
    cameraExternalId: selectedCamera?.externalId,
    isRecorded: isSelectedCameraRecorded,
    enabled: Boolean(
      !isAiWorkPaused &&
      selectedCamera?.status === 'ACTIVE' &&
      viewMode === 'single' &&
      effectiveStreamViewMode === 'recorded-raw' &&
      isSelectedCameraRecorded &&
      token &&
      sessionScope &&
      selectedSiteId &&
      selectedCameraId &&
      !isApplying &&
      (!isControlled || sharedSession !== null),
    ),
  });

  const previewRetryRef = useRef(scopedPreview.retry);
  useLayoutEffect(() => {
    previewRetryRef.current = scopedPreview.retry;
  }, [scopedPreview.retry]);

  const mediaRetryRef = useRef(scopedMedia.retry);
  useLayoutEffect(() => {
    mediaRetryRef.current = scopedMedia.retry;
  }, [scopedMedia.retry]);

  const recordedVideoRetryRef = useRef(scopedRecordedVideo.retry);
  useLayoutEffect(() => {
    recordedVideoRetryRef.current = scopedRecordedVideo.retry;
  }, [scopedRecordedVideo.retry]);

  const handleApplyingChange = useCallback(
    (applying: boolean) => {
      if (activeCameraScopeRef.current !== currentCameraScope) return;
      setApplyingCameraScope(applying ? currentCameraScope : null);
      if (!applying) {
        previewRetryRef.current();
        mediaRetryRef.current();
        recordedVideoRetryRef.current();
      }
    },
    [currentCameraScope],
  );

  // Scoped safe session-expired handling for CURRENT 401 (not 403)
  useEffect(() => {
    if (expiredScopeRef.current === sessionScope) return;

    if (
      scopedPreview.errorStatus === 401 ||
      scopedMedia.errorStatus === 401 ||
      scopedRecordedVideo.errorStatus === 401
    ) {
      expiredScopeRef.current = sessionScope;
      triggerSessionExpired(sessionScope);
      if (isControlled && sharedSession?.onSignOut) {
        sharedSession.onSignOut();
      }
      return;
    }

    const checkError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        expiredScopeRef.current = sessionScope;
        triggerSessionExpired(sessionScope);
        if (isControlled && sharedSession?.onSignOut) {
          sharedSession.onSignOut();
        }
        return true;
      }
      return false;
    };

    if (sitesQuery.error && checkError(sitesQuery.error)) return;
    if (previewCamerasQuery.error && checkError(previewCamerasQuery.error)) return;
    if (meQuery.error && checkError(meQuery.error)) return;
  }, [
    scopedPreview.errorStatus,
    scopedMedia.errorStatus,
    scopedRecordedVideo.errorStatus,
    sitesQuery.error,
    previewCamerasQuery.error,
    meQuery.error,
    sessionScope,
    isControlled,
    sharedSession,
    triggerSessionExpired,
  ]);

  const rawWallSnapshot = viewMode === 'wall' ? wallTileSnapshots[selectedCameraId] : null;

  // Strict synchronous validity guard:
  // Must verify that the snapshot matches CURRENT render scope exactly:
  // - apiUrl, credentialId, sessionScope, siteId, cameraId, client, token
  // - Camera must still exist in authorized preview cameras
  const isWallSnapshotValid = Boolean(
    rawWallSnapshot &&
    viewMode === 'wall' &&
    rawWallSnapshot.scope.apiUrl === apiUrl &&
    rawWallSnapshot.scope.credentialId === credentialId &&
    rawWallSnapshot.scope.sessionScope === sessionScope &&
    rawWallSnapshot.scope.siteId === selectedSiteId &&
    rawWallSnapshot.scope.cameraId === selectedCameraId &&
    rawWallSnapshot.scope.client === client &&
    rawWallSnapshot.scope.token === token &&
    token &&
    sessionScope &&
    selectedSiteId &&
    selectedCameraId &&
    (previewCamerasQuery.data?.items.some((c) => c.id === selectedCameraId) ?? true),
  );

  const activeWallSnapshot = isWallSnapshotValid ? rawWallSnapshot : null;

  const preview =
    isApplying || isAiWorkPaused
      ? null
      : viewMode === 'wall'
        ? (activeWallSnapshot?.preview ?? null)
        : scopedPreview.preview;
  const activeStatus = isAiWorkPaused
    ? 'UNAVAILABLE'
    : viewMode === 'wall'
      ? (activeWallSnapshot?.status ?? (selectedCameraId ? 'CONNECTING' : 'UNAVAILABLE'))
      : scopedPreview.status;
  const activeSourceKind = isAiWorkPaused
    ? null
    : viewMode === 'wall'
      ? (activeWallSnapshot?.sourceKind ?? null)
      : scopedPreview.sourceKind;
  const activeCapturedAt = preview?.frame.capturedAt ?? null;
  const displayedCapturedTime = useMemo(
    () => formatCapturedFrameTime(activeCapturedAt),
    [activeCapturedAt],
  );

  const isRawActive = effectiveStreamViewMode === 'live-raw';
  const isRecordedRawActive = effectiveStreamViewMode === 'recorded-raw';

  // In live-raw mode, source badges reflect the actual raw media status from scopedMedia.
  // In recorded-raw mode, source badges reflect the native recorded MP4 playback status from scopedRecordedVideo.
  // In AI mode (or replay feeds), source badges reflect the scoped preview / inference status.
  const displayedSourceLabel = isAiWorkPaused
    ? 'UNAVAILABLE'
    : isRawActive
      ? scopedMedia.status === 'LIVE'
        ? 'LIVE'
        : scopedMedia.status === 'STALLED'
          ? 'STALLED'
          : scopedMedia.status === 'CONNECTING'
            ? 'CONNECTING'
            : 'UNAVAILABLE'
      : isRecordedRawActive
        ? scopedRecordedVideo.status === 'READY'
          ? 'REPLAY'
          : scopedRecordedVideo.status === 'LOADING'
            ? 'CONNECTING'
            : 'UNAVAILABLE'
        : activeStatus === 'REPLAY'
          ? 'REPLAY'
          : activeStatus === 'LIVE'
            ? 'LIVE'
            : 'UNAVAILABLE';

  const displayedSourceBadgeClass =
    displayedSourceLabel === 'LIVE'
      ? 'bg-red-500/20 text-red-200 border-red-500/40'
      : displayedSourceLabel === 'REPLAY' || displayedSourceLabel === 'STALLED'
        ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
        : 'bg-slate-700/40 text-slate-300 border-slate-600/40';

  const displayedDotClass =
    displayedSourceLabel === 'LIVE'
      ? 'bg-red-400 animate-ping'
      : displayedSourceLabel === 'REPLAY' || displayedSourceLabel === 'STALLED'
        ? 'bg-amber-400'
        : 'bg-slate-400';

  const displayedStatusText =
    displayedSourceLabel === 'LIVE'
      ? `LIVE - ${clockTime}`
      : displayedSourceLabel === 'REPLAY'
        ? `REPLAY - ${clockTime}`
        : displayedSourceLabel === 'STALLED'
          ? `STALLED - ${clockTime}`
          : displayedSourceLabel === 'CONNECTING'
            ? 'CONNECTING'
            : 'UNAVAILABLE';

  const isLive = !isApplying && (activeStatus === 'LIVE' || activeStatus === 'REPLAY');
  const ppeDetections = useMemo(() => preview?.frame.detections ?? [], [preview]);
  const modelObjects = preview?.frame.modelObjects;

  const activePresetClasses = DISPLAY_PRESET_CONFIG[activeDisplayPreset].classes;
  const positiveModelDetections = useMemo(() => {
    if (!modelObjects?.detections) return [];
    return modelObjects.detections.filter(
      (d) =>
        (POSITIVE_PPE_OBJECT_CLASSES as readonly string[]).includes(d.className) &&
        (activeDisplayPreset === 'FULL_EIGHT' || activePresetClasses.includes(d.className)),
    );
  }, [modelObjects, activeDisplayPreset, activePresetClasses]);

  const negativeModelDetections = useMemo(() => {
    if (!modelObjects?.detections) return [];
    return modelObjects.detections.filter((d) =>
      (NEGATIVE_PPE_OBJECT_CLASSES as readonly string[]).includes(d.className),
    );
  }, [modelObjects]);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(formatClockTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const testDetection = useMemo(() => {
    if (ppeDetections.length === 0) return null;
    return (
      ppeDetections.find((detection) => isConfirmedPpeDetection(detection)) ??
      ppeDetections[0] ??
      null
    );
  }, [ppeDetections]);

  const ppeResultState = useMemo(() => getPpeResultState(ppeDetections), [ppeDetections]);
  const hasExpandedReported = useMemo(() => {
    return ppeDetections.some(
      (det) =>
        det.ppeStatus && EXPANDED_PPE_ITEMS.some((item) => det.ppeStatus[item] !== undefined),
    );
  }, [ppeDetections]);

  const activeCameraContext = useMemo(() => {
    if (selectedCamera) {
      return {
        camera: `${selectedCamera.code} · ${selectedCamera.name}`,
        workArea: selectedSite
          ? `${selectedSite.code} · ${selectedSite.name}`
          : t('ppe.context.siteScopeFallback'),
        cameraFallbackKey: undefined as TranslationKey | undefined,
        workAreaFallbackKey: (selectedSite ? undefined : 'ppe.context.siteScopeFallback') as
          TranslationKey | undefined,
      };
    }
    const rawCameraId = viewMode === 'wall' ? selectedCameraId : scopedPreview.cameraExternalId;
    const resolved = resolveCameraAndWorkArea(
      rawCameraId,
      testDetection?.regionId,
      t('ppe.context.noCameraSelected'),
    );
    return {
      ...resolved,
      cameraFallbackKey: (rawCameraId && rawCameraId.trim().length > 0
        ? undefined
        : 'ppe.context.noCameraSelected') as TranslationKey | undefined,
      workAreaFallbackKey: undefined as TranslationKey | undefined,
    };
  }, [
    selectedCamera,
    selectedSite,
    viewMode,
    selectedCameraId,
    scopedPreview.cameraExternalId,
    testDetection?.regionId,
    t,
  ]);

  // Derive observation events from active snapshot frame
  const ppeEvents: PpeReviewItem[] = useMemo(() => {
    if (!preview) return [];
    const timeStr = displayedCapturedTime;

    return preview.frame.detections
      .filter(
        (det) =>
          isConfirmedPpeDetection(det) ||
          (det.confirmedMissingItems && det.confirmedMissingItems.length > 0) ||
          Object.values(det.ppeStatus || {}).includes('MISSING'),
      )
      .map((det) => ({
        id:
          det.eventId || (det.trackId !== null ? `SNAPSHOT-${det.trackId}` : 'SNAPSHOT-UNTRACKED'),
        rowKey: getPpeEventRowKey(
          det.eventId || 'SNAP',
          det.trackId,
          det.confirmedMissingItems?.[0],
        ),
        trackId: det.trackId,
        ppeItem: det.confirmedMissingItems?.[0],
        time: timeStr,
        worker:
          det.trackId !== null ? t('ppe.trackLabel', { id: det.trackId }) : t('ppe.untrackedLabel'),
        camera: activeCameraContext.camera,
        workArea: activeCameraContext.workArea,
        cameraFallbackKey: activeCameraContext.cameraFallbackKey,
        workAreaFallbackKey: activeCameraContext.workAreaFallbackKey,
        rawIssue: det.label,
        issue: det.label && det.label.trim().length > 0 ? det.label : t('ppe.event.defaultIssue'),
        confidence: det.confidence ? `${Math.round(det.confidence * 100)}%` : '—',
        statusKey: 'ppe.event.statusSnapshotObservation',
        status: t('ppe.event.statusSnapshotObservation'),
      }));
  }, [preview, displayedCapturedTime, activeCameraContext, t]);

  const displayedEvents = useMemo(() => {
    return filterPpeEvents(ppeEvents, {
      workerTrackId: activeFilterWorker,
      itemType: ppeFilter,
    });
  }, [ppeEvents, activeFilterWorker, ppeFilter]);

  const openReviewFromDetection = () => {
    if (!testDetection) return;
    const statusKey: TranslationKey = isConfirmedPpeDetection(testDetection)
      ? 'ppe.event.statusObservationActive'
      : 'ppe.event.statusScanning';
    const item: PpeReviewItem = {
      id:
        testDetection.eventId ||
        (testDetection.trackId !== null
          ? `SNAPSHOT-${testDetection.trackId}`
          : 'SNAPSHOT-UNTRACKED'),
      rowKey: getPpeEventRowKey(testDetection.eventId || 'SNAP', testDetection.trackId),
      trackId: testDetection.trackId,
      worker:
        testDetection.trackId !== null
          ? t('ppe.trackLabel', { id: testDetection.trackId })
          : t('ppe.untrackedLabel'),
      camera: activeCameraContext.camera,
      workArea: activeCameraContext.workArea,
      cameraFallbackKey: activeCameraContext.cameraFallbackKey,
      workAreaFallbackKey: activeCameraContext.workAreaFallbackKey,
      rawIssue: testDetection.label,
      issue:
        testDetection.label && testDetection.label.trim().length > 0
          ? testDetection.label
          : t('ppe.event.defaultIssue'),
      confidence:
        testDetection.confidence !== null ? `${Math.round(testDetection.confidence * 100)}%` : '—',
      statusKey,
      status: t(statusKey),
      time: displayedCapturedTime,
    };
    setSelectedReview({
      item,
      scope: {
        apiUrl,
        credentialId,
        sessionScope,
        siteId: selectedSiteId,
        cameraId: selectedCameraId,
      },
    });
  };

  return (
    <div className="space-y-4 max-w-[1240px] w-full min-w-0 max-w-full mx-auto text-[#2F3437] pb-10">
      {/* 0. Page Title & Concise Operational Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{t('ppe.header.title')}</h1>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200/80 bg-white text-xs shadow-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isAiWorkPaused
                  ? 'bg-amber-500'
                  : activeStatus === 'LIVE' && preview
                    ? 'bg-red-500 animate-pulse'
                    : activeStatus === 'REPLAY'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
              }`}
            />
            <span className="font-semibold text-slate-800">
              {isAiWorkPaused
                ? t('ppe.header.status.paused')
                : activeStatus === 'LIVE' && preview
                  ? t('ppe.header.status.live')
                  : activeStatus === 'REPLAY'
                    ? t('ppe.header.status.replay')
                    : t('ppe.header.status.standby')}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">{clockTime}</span>
          </div>
        </div>
      </div>

      {/* AI Work Paused Operational Banner (slim one-line summary + native details) */}
      {isAiWorkPaused && (
        <div
          data-testid="ai-work-paused-banner"
          className="rounded-2xl border border-amber-200/90 bg-amber-50/60 px-4 py-2.5 text-amber-950"
        >
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-amber-200/70 text-amber-800 mt-0.5">
              <IconAlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:text-sm">
                <h2 className="font-semibold text-amber-950">{t('ppe.pausedBanner.title')}</h2>
                <span className="text-amber-400" aria-hidden="true">
                  ·
                </span>
                <p className="text-amber-900">{t('ppe.pausedBanner.summary')}</p>
              </div>
              <details className="mt-1 text-xs text-amber-800">
                <summary className="cursor-pointer font-medium text-amber-900 hover:underline select-none">
                  {t('ppe.pausedBanner.detailsToggle')}
                </summary>
                <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                  {t('ppe.pausedBanner.description')}
                </p>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Fail closed session notice when controlled session is null */}
      {isControlled && sharedSession === null && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <IconAlertTriangle className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold text-slate-800">{t('ppe.sessionExpired.title')}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">{t('ppe.sessionExpired.description')}</p>
        </div>
      )}

      {/* Monitoring Scope (Primary Selectors) & Secondary Configuration Actions */}
      <div
        className={`grid grid-cols-1 gap-4 items-start min-w-0 w-full max-w-full ${
          onOpenSetup
            ? isGlobalAdmin || canOpenZonePpe || canRegisterCamera || canManageCamera
              ? 'lg:grid-cols-[minmax(0,1fr)_auto]'
              : ''
            : canOpenZonePpe || canRegisterCamera || canManageCamera || registrationFeedback
              ? 'xl:grid-cols-[minmax(0,1fr)_360px]'
              : ''
        }`}
      >
        <section
          aria-label={t('ppe.layout.monitoringScope')}
          className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-xs flex flex-col justify-between gap-2.5 min-w-0 w-full max-w-full"
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('ppe.layout.monitoringScope')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 min-w-0 w-full max-w-full">
            {/* Site Scope Block */}
            <div className="flex flex-col gap-1 min-w-0 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <label
                  htmlFor="site-selector"
                  className="text-xs font-semibold text-slate-700 truncate"
                >
                  {t('ppe.scope.siteLabel')}
                </label>
                {!isSitesBaseError && allFetchedSites.length > 0 && (
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                    {t('ppe.scope.loadedCount', {
                      loaded: visibleAuthorizedSites.length,
                      total: siteServerTotal,
                    })}
                  </span>
                )}
              </div>
              <select
                id="site-selector"
                aria-label={t('ppe.scope.siteLabel')}
                value={selectedSiteId}
                onChange={(e) => {
                  setSelectedSiteId(e.target.value);
                  setSelectedCameraId('');
                  setIsZonePpeOpen(false);
                }}
                disabled={
                  !token || sitesInfiniteQuery.isPending || visibleAuthorizedSites.length === 0
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-900 min-w-0 max-w-full truncate transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {!selectedSiteId && visibleAuthorizedSites.length > 0 && (
                  <option value="">{tr('cameraSetup.chooseSite', { ns: 'safety' })}</option>
                )}
                {visibleAuthorizedSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </select>

              {(isSitesInitialLoading ||
                isSitesBaseError ||
                isTransientNextSitesError ||
                (!isSitesBaseError &&
                  !isTransientNextSitesError &&
                  sitesInfiniteQuery.hasNextPage)) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {isSitesInitialLoading && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="text-xs text-slate-500 whitespace-nowrap"
                    >
                      {t('ppe.scope.loadingSites')}
                    </span>
                  )}

                  {isSitesBaseError && (
                    <button
                      type="button"
                      onClick={() => {
                        if (sitesInfiniteQuery.isFetching) return;
                        sitesInfiniteQuery.refetch({ cancelRefetch: false });
                      }}
                      disabled={sitesInfiniteQuery.isFetching}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 shrink-0 whitespace-nowrap"
                    >
                      {sitesInfiniteQuery.isFetching
                        ? t('ppe.scope.retryingSites')
                        : t('ppe.scope.retrySites')}
                    </button>
                  )}

                  {isTransientNextSitesError && (
                    <button
                      type="button"
                      onClick={() => {
                        if (sitesInfiniteQuery.isFetching) return;
                        sitesInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                      }}
                      disabled={sitesInfiniteQuery.isFetching}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 shrink-0 whitespace-nowrap"
                    >
                      {sitesInfiniteQuery.isFetching
                        ? t('ppe.scope.retryingMoreSites')
                        : t('ppe.scope.retryMoreSites')}
                    </button>
                  )}

                  {!isSitesBaseError &&
                    !isTransientNextSitesError &&
                    sitesInfiniteQuery.hasNextPage && (
                      <button
                        type="button"
                        onClick={() => {
                          if (sitesInfiniteQuery.isFetching) return;
                          sitesInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                        }}
                        disabled={sitesInfiniteQuery.isFetching}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 shrink-0 whitespace-nowrap"
                      >
                        {sitesInfiniteQuery.isFetching
                          ? t('ppe.scope.loadingMoreSites')
                          : t('ppe.scope.loadMoreSites')}
                      </button>
                    )}
                </div>
              )}
            </div>

            {/* Camera Scope Block */}
            <div className="flex flex-col gap-1 min-w-0 w-full max-w-full">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <label
                  htmlFor="camera-selector"
                  className="text-xs font-semibold text-slate-700 truncate"
                >
                  {t('ppe.scope.cameraLabel')}
                </label>
                {!isCamerasBaseError && allFetchedCameras.length > 0 && (
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                    {t('ppe.scope.loadedCount', {
                      loaded: visibleAuthorizedCameras.length,
                      total: cameraServerTotal,
                    })}
                  </span>
                )}
              </div>
              <select
                id="camera-selector"
                aria-label={t('ppe.scope.cameraLabel')}
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                disabled={
                  !token ||
                  previewCamerasInfiniteQuery.isPending ||
                  visibleAuthorizedCameras.length === 0
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-900 min-w-0 max-w-full truncate transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {!selectedCameraId && visibleAuthorizedCameras.length > 0 && (
                  <option value="">{tr('cameraSetup.chooseCamera', { ns: 'safety' })}</option>
                )}
                {visibleAuthorizedCameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.code} · {camera.name}
                  </option>
                ))}
              </select>

              {(isCamerasInitialLoading ||
                isCamerasRefreshing ||
                (isCamerasBaseError && !isSitesBaseError) ||
                isTransientNextCamerasError ||
                (!isCamerasBaseError && !isTransientNextCamerasError && hasNextCameraPage)) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {isCamerasInitialLoading && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="text-xs text-slate-500 whitespace-nowrap"
                    >
                      {t('ppe.scope.loadingCameras')}
                    </span>
                  )}

                  {isCamerasRefreshing && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="text-xs text-slate-500 whitespace-nowrap"
                    >
                      {t('ppe.scope.refreshingCameras')}
                    </span>
                  )}

                  {isCamerasBaseError && !isSitesBaseError && (
                    <button
                      type="button"
                      onClick={() => {
                        if (previewCamerasInfiniteQuery.isFetching) return;
                        previewCamerasInfiniteQuery.refetch({ cancelRefetch: false });
                      }}
                      disabled={previewCamerasInfiniteQuery.isFetching}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 shrink-0 whitespace-nowrap"
                    >
                      {previewCamerasInfiniteQuery.isFetching
                        ? t('ppe.scope.retryingCameras')
                        : t('ppe.scope.retryCameras')}
                    </button>
                  )}

                  {isTransientNextCamerasError && (
                    <button
                      type="button"
                      onClick={() => {
                        if (previewCamerasInfiniteQuery.isFetching) return;
                        previewCamerasInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                      }}
                      disabled={previewCamerasInfiniteQuery.isFetching}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 shrink-0 whitespace-nowrap"
                    >
                      {previewCamerasInfiniteQuery.isFetching
                        ? t('ppe.scope.retryingMoreCameras')
                        : t('ppe.scope.retryMoreCameras')}
                    </button>
                  )}

                  {!isCamerasBaseError && !isTransientNextCamerasError && hasNextCameraPage && (
                    <button
                      type="button"
                      onClick={() => {
                        if (previewCamerasInfiniteQuery.isFetching) return;
                        previewCamerasInfiniteQuery.fetchNextPage({ cancelRefetch: false });
                      }}
                      disabled={previewCamerasInfiniteQuery.isFetching}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 shrink-0 whitespace-nowrap"
                    >
                      {previewCamerasInfiniteQuery.isFetching
                        ? t('ppe.scope.loadingMoreCameras')
                        : t('ppe.scope.loadMoreCameras')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Safe Error Messages & Empty Status */}
          {sitesError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 flex items-center gap-2 w-full"
            >
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{getSafePublicMetadataErrorMessage(sitesError, 'site', t)}</span>
            </div>
          )}

          {camerasError && !isSitesBaseError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 flex items-center gap-2 w-full"
            >
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{getSafePublicMetadataErrorMessage(camerasError, 'camera', t)}</span>
            </div>
          )}

          {((holdLinkedSite && !selectedSiteId && sitesInfiniteQuery.isSuccess) ||
            (holdLinkedCamera &&
              selectedSiteId &&
              !selectedCameraId &&
              previewCamerasInfiniteQuery.isSuccess)) && (
            <p role="status" className="text-xs text-slate-600">
              {tr('cameraSetup.linkedSelection', { ns: 'safety' })}
            </p>
          )}
          {isSiteSettledEmpty && (
            <div
              role="status"
              aria-live="polite"
              className="text-xs text-slate-500 italic py-0.5 px-1 w-full"
            >
              {t('ppe.empty.noSites')}
            </div>
          )}

          {isCameraViewingRestricted && (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-slate-600 py-0.5 px-1 w-full"
            >
              {t('ppe.scope.noCameraMonitoringAccess')}
            </p>
          )}

          {isCameraSettledEmpty && (
            <div
              role="status"
              aria-live="polite"
              className="text-xs text-slate-500 italic py-0.5 px-1 w-full"
            >
              {hasNextCameraPage
                ? t('ppe.empty.noCamerasLoadedYet')
                : t('ppe.empty.noCamerasInScope')}
            </div>
          )}
        </section>

        {onOpenSetup ? (
          (isGlobalAdmin || canOpenZonePpe || canRegisterCamera || canManageCamera) && (
            <section
              aria-label={t('ppe.layout.configuration')}
              className="rounded-2xl border border-slate-200/80 bg-[#F8FAFC] px-4 py-3.5 shadow-xs flex flex-col justify-start self-start gap-2.5 min-w-0 w-full max-w-full"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t('ppe.layout.configuration')}
                </h2>
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  disabled={!selectedSiteId}
                  onClick={() =>
                    onOpenSetup({ siteId: selectedSiteId, cameraId: selectedCamera?.id })
                  }
                >
                  {tr('cameraSetup.title', { ns: 'safety' })}
                </button>
              </div>
            </section>
          )
        ) : (
          <section
            aria-label={t('ppe.layout.configuration')}
            className={
              canOpenZonePpe || canRegisterCamera || canManageCamera || registrationFeedback
                ? 'rounded-2xl border border-slate-200/80 bg-[#F8FAFC] px-4 py-3.5 shadow-xs flex flex-col justify-start self-start gap-2.5 min-w-0 w-full max-w-full'
                : 'sr-only'
            }
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {t('ppe.layout.configuration')}
              </h2>
            </div>

            <div className="flex flex-col gap-2 min-w-0 w-full">
              {/* Authorized Configure PPE by Zone trigger */}
              {canOpenZonePpe && (
                <button
                  type="button"
                  onClick={() => {
                    setIsZonePpeOpen(true);
                  }}
                  disabled={!selectedSiteId}
                  className="w-full min-w-0 rounded-lg border border-[#0F172A] bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  <IconShield className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t('ppe.admin.configureByZone')}</span>
                </button>
              )}

              {(canRegisterCamera || canManageCamera) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0 w-full">
                  {/* Global Admin Register camera trigger */}
                  {canRegisterCamera && (
                    <button
                      type="button"
                      onClick={() => {
                        setRegistrationFeedback(null);
                        setIsRegisterCameraOpen(true);
                      }}
                      className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <IconCamera className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{t('ppe.admin.registerCamera')}</span>
                    </button>
                  )}

                  {/* Global Admin Manage camera trigger */}
                  {canManageCamera && (
                    <button
                      type="button"
                      onClick={() => {
                        setRegistrationFeedback(null);
                        setIsManageCameraOpen(true);
                      }}
                      className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <IconCamera className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{t('ppe.admin.manageCamera')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {registrationFeedback && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 flex items-center justify-between gap-2 w-full"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <IconCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    {registrationFeedback === 'ppe.admin.registrationSuccess'
                      ? t('ppe.admin.registrationSuccess')
                      : registrationFeedback}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={t('ppe.admin.dismissStatusAria')}
                  onClick={() => setRegistrationFeedback(null)}
                  className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  {t('ppe.admin.dismiss')}
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Viewing Controls Bar: View Mode Switcher, Quick Camera Strip & Polling Cadence */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-2 shadow-xs min-w-0 w-full max-w-full">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
          {/* View Mode Switcher: Single Focus vs 4-Source Wall */}
          <div
            className="flex items-center rounded-xl border border-slate-200/90 bg-[#F1F5F9] p-0.5 flex-shrink-0"
            role="group"
            aria-label={t('ppe.viewMode.groupAria')}
          >
            <button
              type="button"
              data-testid="toggle-view-single"
              onClick={() => setViewMode('single')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 ${
                viewMode === 'single'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              aria-pressed={viewMode === 'single'}
            >
              <IconEye className="w-3.5 h-3.5" />
              <span>{t('ppe.viewMode.single')}</span>
            </button>
            <button
              type="button"
              data-testid="toggle-view-wall"
              onClick={() => setViewMode('wall')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 ${
                viewMode === 'wall'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              aria-pressed={viewMode === 'wall'}
            >
              <IconGrid className="w-3.5 h-3.5" />
              <span>{t('ppe.viewMode.wall')}</span>
            </button>
          </div>

          {/* Inline quick camera chips in Single Focus mode */}
          {visibleAuthorizedCameras.length > 0 && viewMode === 'single' && (
            <>
              <span className="hidden sm:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />
              <div
                data-testid="camera-overview-strip"
                className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar min-w-0 py-0.5"
              >
                {previewCamerasQuery.data.items.map((cam) => {
                  const isCurrent = cam.id === selectedCameraId;
                  const camCtx = resolveCameraAndWorkArea(cam.name || cam.code);
                  return (
                    <button
                      key={`cam-chip-${cam.id}`}
                      type="button"
                      data-testid={`camera-chip-${cam.id}`}
                      aria-pressed={isCurrent}
                      onClick={() => setSelectedCameraId(cam.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 ${
                        isCurrent
                          ? 'border-slate-900 bg-slate-900 text-white font-medium'
                          : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-700'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isCurrent ? 'bg-emerald-400' : 'bg-slate-400'
                        }`}
                        title={
                          isCurrent
                            ? t('ppe.overview.selectedTitle')
                            : t('ppe.overview.selectTitle')
                        }
                        aria-label={isCurrent ? t('ppe.overview.selectedAria') : undefined}
                      />
                      <span className="truncate max-w-[140px]">{camCtx.camera}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {!isAiWorkPaused && viewMode === 'wall' && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 py-1 flex-shrink-0 min-w-0">
            <span className="text-[11px] font-mono text-slate-600 tabular-nums truncate">
              {t('ppe.cadence.wall')}
            </span>
            {previewCamerasQuery.data?.items.some((camera) => camera.status === 'ACTIVE') && (
              <span
                className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
                title={t('ppe.cadence.pollingWallTitle')}
              />
            )}
          </div>
        )}
      </div>

      {/* Main Interactive Viewport: Camera Video Feed (Single Focus or 4-Source Wall) + Right Card (360px) */}
      <div
        data-testid="ppe-monitoring-layout"
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-stretch"
      >
        {/* Left: Camera Feed Viewport OR 4-Source Wall */}
        {viewMode === 'wall' ? (
          <div className="flex flex-col gap-2.5 min-w-0 w-full" data-testid="wall-view-container">
            <FourSourceWall
              apiUrl={apiUrl}
              client={client}
              token={token}
              sessionScope={sessionScope}
              credentialId={credentialId}
              siteId={selectedSiteId}
              siteCode={selectedSite?.code}
              siteName={selectedSite?.name}
              selectedCameraId={selectedCameraId}
              onSelectCamera={(camId) => setSelectedCameraId(camId)}
              cameras={
                previewCamerasQuery.data?.items.filter((camera) => camera.status === 'ACTIVE') ?? []
              }
              enabled={
                !isAiWorkPaused &&
                viewMode === 'wall' &&
                Boolean(token && sessionScope && selectedSiteId)
              }
              isAiWorkPaused={isAiWorkPaused}
              showModelObjects={showModelObjects}
              filterClasses={
                activeDisplayPreset === 'FULL_EIGHT'
                  ? undefined
                  : DISPLAY_PRESET_CONFIG[activeDisplayPreset].classes
              }
              getFilterClassesForCamera={getFilterClassesForCamera}
              onTilePreviewUpdate={handleTilePreviewUpdate}
              onTileUnmount={handleTileUnmount}
              isApplying={isApplying}
            />
          </div>
        ) : (
          <div className="relative bg-[#0F141C] rounded-2xl border border-slate-800 overflow-hidden w-full min-w-0 aspect-video xl:aspect-auto xl:h-[540px] flex flex-col justify-between select-none shadow-sm">
            <div className="absolute inset-0">
              {isAiWorkPaused ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[#0F141C] px-5 py-16 text-center text-white">
                  <IconCamera className="h-8 w-8 text-slate-400" />
                  <h2 className="text-sm font-semibold">{t('ppe.viewport.pausedTitle')}</h2>
                  <p className="max-w-sm text-xs leading-relaxed text-slate-300">
                    {t('ppe.viewport.pausedDesc')}
                  </p>
                </div>
              ) : isApplying ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center space-y-2">
                  <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-1" />
                  <p className="text-xs font-semibold text-amber-300">
                    {t('ppe.viewport.applyingTitle')}
                  </p>
                  <p className="text-[11px] text-white/50">{t('ppe.viewport.applyingDesc')}</p>
                </div>
              ) : effectiveStreamViewMode === 'live-raw' ? (
                scopedMedia.image ? (
                  <RawCameraMediaCanvas
                    image={scopedMedia.image}
                    frame={scopedMedia.frame}
                    width={scopedMedia.frame?.width}
                    height={scopedMedia.frame?.height}
                  />
                ) : scopedMedia.status === 'CONNECTING' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-400 border-t-transparent animate-spin mb-3" />
                    <p className="text-xs font-semibold">{t('ppe.viewport.rawConnectingTitle')}</p>
                    <p className="text-[11px] text-white/50 mt-1">
                      {t('ppe.viewport.rawConnectingDesc')}
                    </p>
                  </div>
                ) : scopedMedia.status === 'STALLED' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center space-y-3">
                    <IconAlertTriangle className="w-8 h-8 text-amber-400" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        {t('ppe.viewport.rawStalledTitle')}
                      </p>
                      <p className="text-[11px] text-white/60 mt-1 max-w-sm">
                        {t('ppe.viewport.rawStalledDesc')}
                      </p>
                    </div>
                    {token && selectedCameraId && (
                      <button
                        type="button"
                        onClick={scopedMedia.retry}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shadow-xs"
                      >
                        {t('ppe.viewport.reconnectStream')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center space-y-3">
                    <IconAlertTriangle className="w-8 h-8 text-amber-400" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        {scopedMedia.status === 'HALTED'
                          ? t('ppe.viewport.rawAccessDeniedTitle')
                          : t('ppe.viewport.rawUnavailableTitle')}
                      </p>
                      <p role="status" className="text-[11px] text-white/60 mt-1 max-w-sm">
                        {scopedMedia.errorStatus === 401
                          ? t('ppe.viewport.rawError401')
                          : scopedMedia.errorStatus === 403
                            ? t('ppe.viewport.rawError403')
                            : scopedMedia.errorStatus === 429
                              ? t('ppe.viewport.rawError429')
                              : scopedMedia.errorStatus === 503
                                ? t('ppe.viewport.rawError503')
                                : t('ppe.viewport.rawErrorDefault')}
                      </p>
                    </div>
                    {token && selectedCameraId && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={scopedMedia.retry}
                          disabled={
                            scopedMedia.status === 'HALTED' || scopedMedia.errorStatus === 429
                          }
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                        >
                          {t('ppe.viewport.retryStream')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStreamViewMode('ai-analyzed')}
                          className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors cursor-pointer shadow-xs"
                        >
                          {t('ppe.viewport.switchToAiEvidence')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : effectiveStreamViewMode === 'recorded-raw' ? (
                scopedRecordedVideo.videoUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center bg-black">
                    <video
                      data-testid="raw-recorded-video-element"
                      data-media-camera={selectedCamera?.externalId ?? ''}
                      src={scopedRecordedVideo.videoUrl}
                      className="w-full h-full object-contain"
                      muted
                      autoPlay
                      loop
                      playsInline
                      controls
                    />
                  </div>
                ) : scopedRecordedVideo.status === 'LOADING' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-400 border-t-transparent animate-spin mb-3" />
                    <p className="text-xs font-semibold">
                      {t('ppe.viewport.recordedLoadingTitle')}
                    </p>
                    <p className="text-[11px] text-white/50 mt-1">
                      {t('ppe.viewport.recordedLoadingDesc')}
                    </p>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center space-y-3">
                    <IconAlertTriangle className="w-8 h-8 text-amber-400" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        {scopedRecordedVideo.status === 'HALTED'
                          ? t('ppe.viewport.recordedAccessDeniedTitle')
                          : t('ppe.viewport.recordedUnavailableTitle')}
                      </p>
                      <p role="status" className="text-[11px] text-white/60 mt-1 max-w-sm">
                        {scopedRecordedVideo.errorStatus === 401
                          ? t('ppe.viewport.recordedError401')
                          : scopedRecordedVideo.errorStatus === 403
                            ? t('ppe.viewport.recordedError403')
                            : t('ppe.viewport.recordedErrorDefault')}
                      </p>
                    </div>
                    {token && selectedCameraId && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={scopedRecordedVideo.retry}
                          disabled={scopedRecordedVideo.status === 'HALTED'}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                        >
                          {t('ppe.viewport.retryVideo')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStreamViewMode('ai-analyzed')}
                          className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors cursor-pointer shadow-xs"
                        >
                          {t('ppe.viewport.switchToAiEvidence')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : preview ? (
                <RealtimePreviewCanvas
                  preview={preview}
                  mode="ppe"
                  showModelObjects={showModelObjects}
                  filterClasses={
                    activeDisplayPreset === 'FULL_EIGHT'
                      ? undefined
                      : DISPLAY_PRESET_CONFIG[activeDisplayPreset].classes
                  }
                />
              ) : scopedPreview.status === 'CONNECTING' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center">
                  <div className="w-8 h-8 rounded-full border-2 border-slate-400 border-t-transparent animate-spin mb-3" />
                  <p className="text-xs font-semibold">
                    {t('ppe.viewport.snapshotConnectingTitle')}
                  </p>
                  <p className="text-[11px] text-white/50 mt-1">
                    {t('ppe.viewport.snapshotConnectingDesc')}
                  </p>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0F141C] text-white/80 p-6 text-center space-y-3">
                  <IconAlertTriangle className="w-8 h-8 text-amber-400" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      {t('ppe.viewport.snapshotUnavailableTitle')}
                    </p>
                    <p className="text-[11px] text-white/60 mt-1 max-w-sm">
                      {scopedPreview.errorStatus === 401
                        ? t('ppe.viewport.rawError401')
                        : scopedPreview.errorStatus === 403
                          ? t('ppe.viewport.rawError403')
                          : scopedPreview.errorStatus === 503
                            ? t('ppe.viewport.rawError503')
                            : t('ppe.viewport.snapshotErrorDefault')}
                    </p>
                  </div>
                  {scopedPreview.errorStatus === 429 && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-[11px] text-amber-300/90 font-medium"
                    >
                      {t('ppe.viewport.snapshotCooldown429')}
                    </p>
                  )}
                  {token && selectedCameraId && (
                    <button
                      type="button"
                      onClick={scopedPreview.retry}
                      disabled={
                        scopedPreview.isPolling ||
                        scopedPreview.errorStatus === 429 ||
                        scopedPreview.errorStatus === 403 ||
                        scopedPreview.errorStatus === 401
                      }
                      aria-disabled={
                        scopedPreview.isPolling ||
                        scopedPreview.errorStatus === 429 ||
                        scopedPreview.errorStatus === 403 ||
                        scopedPreview.errorStatus === 401
                      }
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('ppe.viewport.retrySnapshot')}
                    </button>
                  )}
                </div>
              )}

              {/* Scanning line indicator */}
              {!isAiWorkPaused && effectiveStreamViewMode === 'ai-analyzed' && (
                <div className="absolute top-[40%] left-0 right-0 h-[1px] bg-amber-500/40 opacity-50 pointer-events-none" />
              )}

              {/* Empty live frame indicator */}
              {effectiveStreamViewMode === 'ai-analyzed' &&
                isLive &&
                ppeDetections.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="bg-black/60 px-3.5 py-1.5 rounded-xl text-white/90 text-xs font-semibold">
                      {scopedPreview.status === 'REPLAY' || scopedPreview.sourceKind === 'REPLAY'
                        ? t('ppe.viewport.emptyFrameReplay')
                        : t('ppe.viewport.emptyFrameLive')}
                    </div>
                  </div>
                )}
            </div>

            {/* Top Camera Metadata */}
            <div className="relative z-10 px-4 py-3 flex items-start justify-between text-white pointer-events-none">
              <div className="flex flex-col gap-0.5 max-w-[70%] sm:max-w-[75%] min-w-0 pr-2">
                <span
                  title={activeCameraContext.camera}
                  className="font-bold text-sm tracking-wide text-white truncate"
                >
                  {activeCameraContext.camera}
                </span>
                <span
                  title={activeCameraContext.workArea}
                  className="text-white/80 font-medium text-xs tracking-wider uppercase truncate"
                >
                  {activeCameraContext.workArea}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  data-testid="factual-source-label"
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase border ${displayedSourceBadgeClass}`}
                >
                  {t('ppe.viewport.sourceBadge', { source: displayedSourceLabel })}
                </span>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-black/60 flex-shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${displayedDotClass}`} />
                  <span className="font-mono text-[10px] font-semibold text-white tracking-wider tabular-nums">
                    {displayedStatusText}
                  </span>
                </div>
              </div>
            </div>

            {/* Error Banner if error present while active viewport content is displayed */}
            {(effectiveStreamViewMode === 'live-raw'
              ? Boolean(scopedMedia.image && scopedMedia.error)
              : effectiveStreamViewMode === 'recorded-raw'
                ? Boolean(scopedRecordedVideo.videoUrl && scopedRecordedVideo.error)
                : Boolean(preview && scopedPreview.error)) && (
              <div className="relative z-10 px-4 py-1.5 bg-amber-950/85 text-amber-200 text-xs flex items-center gap-2">
                <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                <span className="truncate">
                  {effectiveStreamViewMode === 'live-raw'
                    ? scopedMedia.errorStatus === 401
                      ? t('ppe.viewport.rawError401')
                      : scopedMedia.errorStatus === 403
                        ? t('ppe.viewport.rawError403')
                        : scopedMedia.errorStatus === 429
                          ? t('ppe.viewport.rawError429')
                          : scopedMedia.errorStatus === 503
                            ? t('ppe.viewport.rawError503')
                            : t('ppe.viewport.rawErrorDefault')
                    : effectiveStreamViewMode === 'recorded-raw'
                      ? scopedRecordedVideo.errorStatus === 401
                        ? t('ppe.viewport.recordedError401')
                        : scopedRecordedVideo.errorStatus === 403
                          ? t('ppe.viewport.recordedError403')
                          : t('ppe.viewport.recordedErrorDefault')
                      : scopedPreview.errorStatus === 401
                        ? t('ppe.viewport.rawError401')
                        : scopedPreview.errorStatus === 403
                          ? t('ppe.viewport.rawError403')
                          : scopedPreview.errorStatus === 429
                            ? t('ppe.viewport.snapshotCooldown429')
                            : scopedPreview.errorStatus === 503
                              ? t('ppe.viewport.rawError503')
                              : t('ppe.viewport.snapshotErrorDefault')}
                </span>
              </div>
            )}

            {/* Bottom Toolbar */}
            <div className="relative z-10 px-4 py-2 bg-slate-950/85 border-t border-white/10 flex flex-wrap gap-2.5 items-center justify-between text-white text-xs">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                {/* Live video vs AI evidence toggle controls */}
                {isSelectedCameraLive ? (
                  <div
                    className="flex items-center rounded-xl bg-black/60 border border-white/20 p-0.5"
                    role="group"
                    aria-label={t('ppe.toolbar.videoModeGroupAria')}
                  >
                    <button
                      type="button"
                      data-testid="mode-toggle-live-raw"
                      disabled={isAiWorkPaused}
                      onClick={() => setStreamViewMode('live-raw')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                        effectiveStreamViewMode === 'live-raw'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-white/70 hover:text-white'
                      }`}
                      aria-pressed={effectiveStreamViewMode === 'live-raw'}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isAiWorkPaused ? 'bg-amber-400' : 'bg-red-400 animate-pulse'}`}
                      />
                      <span>{t('ppe.toolbar.liveRawBtn')}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="mode-toggle-ai-analyzed"
                      disabled={isAiWorkPaused}
                      onClick={() => setStreamViewMode('ai-analyzed')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                        effectiveStreamViewMode === 'ai-analyzed'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-white/70 hover:text-white'
                      }`}
                      aria-pressed={effectiveStreamViewMode === 'ai-analyzed'}
                    >
                      <span>{t('ppe.toolbar.aiEvidenceBtn')}</span>
                    </button>
                  </div>
                ) : isSelectedCameraRecorded ? (
                  <div
                    className="flex items-center rounded-xl bg-black/60 border border-white/20 p-0.5"
                    role="group"
                    aria-label={t('ppe.toolbar.recordedModeGroupAria')}
                  >
                    <button
                      type="button"
                      data-testid="mode-toggle-recorded-raw"
                      disabled={isAiWorkPaused}
                      onClick={() => setStreamViewMode('recorded-raw')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                        effectiveStreamViewMode === 'recorded-raw'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-white/70 hover:text-white'
                      }`}
                      aria-pressed={effectiveStreamViewMode === 'recorded-raw'}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span>{t('ppe.toolbar.recordedRawBtn')}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="mode-toggle-ai-analyzed"
                      disabled={isAiWorkPaused}
                      onClick={() => setStreamViewMode('ai-analyzed')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                        effectiveStreamViewMode === 'ai-analyzed'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-white/70 hover:text-white'
                      }`}
                      aria-pressed={effectiveStreamViewMode === 'ai-analyzed'}
                    >
                      <span>{t('ppe.toolbar.aiEvidenceBtn')}</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-white/70 font-medium">
                    {t('ppe.toolbar.replayAiOnly')}
                  </span>
                )}

                <span className="text-white/60 text-[11px] font-mono tabular-nums truncate">
                  {isAiWorkPaused
                    ? t('ppe.toolbar.captionPaused')
                    : effectiveStreamViewMode === 'live-raw'
                      ? t('ppe.toolbar.captionLiveRaw')
                      : effectiveStreamViewMode === 'recorded-raw'
                        ? t('ppe.toolbar.captionRecordedRaw')
                        : t('ppe.toolbar.captionAiPolling')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Right: AI Detection & PPE Check Card (360px, height-aligned with viewport on desktop) */}
        <div
          data-testid="ai-detection-panel"
          className={`bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-h-0 min-w-0 overflow-hidden ${
            viewMode === 'single'
              ? 'h-[540px] xl:h-[540px]'
              : 'h-[540px] xl:h-auto xl:min-h-[540px] xl:[contain:size]'
          }`}
        >
          <div className="flex-1 p-4 space-y-3.5 overflow-y-auto min-h-0">
            {/* Header: flex-wrap prevents RAW VIEW UNANALYZED badge from truncating to RA... */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold text-slate-700 tracking-wide flex-shrink-0">
                  {t('ppe.card.headerTitle')}
                </span>
                {!isAiWorkPaused && effectiveStreamViewMode === 'live-raw' && (
                  <span
                    data-testid="raw-feed-unanalyzed-badge"
                    className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap"
                  >
                    {t('ppe.card.rawUnanalyzedBadge')}
                  </span>
                )}
                {!isAiWorkPaused && effectiveStreamViewMode === 'recorded-raw' && (
                  <span
                    data-testid="recorded-feed-unanalyzed-badge"
                    className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap"
                  >
                    {t('ppe.card.recordedUnanalyzedBadge')}
                  </span>
                )}
              </div>
              <span
                data-testid="ai-evidence-badge"
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border flex-shrink-0 whitespace-nowrap ${
                  !isAiWorkPaused &&
                  preview &&
                  (activeStatus === 'LIVE' || activeStatus === 'REPLAY')
                    ? 'bg-slate-100 text-slate-700 border-slate-300 font-mono tabular-nums'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {isAiWorkPaused
                  ? t('ppe.badge.aiPaused')
                  : preview && (activeStatus === 'LIVE' || activeStatus === 'REPLAY')
                    ? (testDetection?.eventId ?? t('ppe.card.noDetectionBadge'))
                    : t('ppe.card.evidenceUnavailableBadge')}
              </span>
            </div>

            {isAiWorkPaused ? (
              <div className="space-y-3 pt-0.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700 truncate">
                    {activeCameraContext.camera}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="truncate">{activeCameraContext.workArea}</span>
                </div>

                <div
                  data-testid="ai-paused-empty-state"
                  className="rounded-xl bg-amber-50/60 border border-amber-200/80 p-3.5 space-y-1.5"
                >
                  <p className="text-xs font-semibold text-amber-950">
                    {t('ppe.card.pausedEmptyTitle')}
                  </p>
                  <p className="text-xs text-amber-900/80 leading-relaxed">
                    {t('ppe.card.pausedEmptyDesc')}
                  </p>
                </div>

                <details className="text-xs text-slate-500 pt-0.5">
                  <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 select-none">
                    {t('ppe.check.notesSummary')}
                  </summary>
                  <div className="mt-1.5 space-y-1 leading-relaxed">
                    <p>{t('ppe.check.coreNote')}</p>
                    <p>{t('ppe.check.experimentalNote')}</p>
                  </div>
                </details>
              </div>
            ) : (
              <>
                {/* 2-Column Details Grid */}
                <div className="rounded-xl bg-[#F8FAFC] border border-slate-200/70 p-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldIdentity')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 truncate">
                      {!preview || activeStatus === 'UNAVAILABLE'
                        ? t('ppe.card.identitySnapshotUnavailable')
                        : testDetection?.trackId !== null && testDetection?.trackId !== undefined
                          ? t('ppe.card.identityUnknown')
                          : t('ppe.card.identityNoPerson')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldTrackId')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 tabular-nums truncate">
                      {!preview || activeStatus === 'UNAVAILABLE'
                        ? '—'
                        : ppeDetections
                            .map((detection) =>
                              t('ppe.trackLabel', { id: detection.trackId ?? '' }),
                            )
                            .join(', ') || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldCamera')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 truncate">
                      {activeCameraContext.camera}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldWorkArea')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 truncate">
                      {activeCameraContext.workArea}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldDetected')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 font-mono tabular-nums">
                      {!preview || activeStatus === 'UNAVAILABLE' ? '—' : displayedCapturedTime}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {t('ppe.card.fieldConfidence')}
                    </p>
                    <p className="font-semibold text-slate-900 text-xs mt-0.5 font-mono tabular-nums">
                      {!preview ||
                      activeStatus === 'UNAVAILABLE' ||
                      testDetection?.confidence === null ||
                      testDetection?.confidence === undefined
                        ? '—'
                        : `${Math.round(testDetection.confidence * 100)}%`}
                    </p>
                  </div>
                </div>

                {/* PPE Check List */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-bold text-slate-700 tracking-wide">
                      {t('ppe.check.heading')}
                    </p>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                      {t('ppe.check.experimentalBadge')}
                    </span>
                  </div>
                  <details className="mb-2.5 text-xs text-slate-500">
                    <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 select-none">
                      {t('ppe.check.notesSummary')}
                    </summary>
                    <div className="mt-1.5 space-y-1 leading-relaxed">
                      <p>{t('ppe.check.coreNote')}</p>
                      <p>{t('ppe.check.experimentalNote')}</p>
                    </div>
                  </details>
                  <div className="space-y-2">
                    {!preview || activeStatus === 'UNAVAILABLE' ? (
                      <div
                        data-testid="ai-snapshot-unavailable-msg"
                        className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center space-y-1"
                      >
                        <p className="text-xs font-semibold text-slate-700">
                          {t('ppe.check.unavailableTitle')}
                        </p>
                        <p className="text-xs text-slate-500">
                          {effectiveStreamViewMode === 'live-raw'
                            ? t('ppe.check.unavailableRawDesc')
                            : t('ppe.check.unavailableDefaultDesc')}
                        </p>
                      </div>
                    ) : ppeDetections.length === 0 ? (
                      <p className="text-xs text-slate-500 italic py-1">
                        {t('ppe.check.noTrackedIndividuals')}
                      </p>
                    ) : (
                      ppeDetections.map((detection) => {
                        const reportedExtended = EXPANDED_PPE_ITEMS.filter(
                          (item) =>
                            (detection.ppeStatus && detection.ppeStatus[item] !== undefined) ||
                            Boolean(
                              detection.confirmedMissingItems &&
                              detection.confirmedMissingItems.includes(item),
                            ),
                        );
                        const itemsToDisplay = [...CORE_PPE_ITEMS, ...reportedExtended];

                        return (
                          <div
                            key={`ppe-check-${detection.trackId}`}
                            className="rounded-xl bg-[#F8FAFC] border border-slate-200/70 p-2.5"
                          >
                            <p className="mb-1.5 text-xs font-bold text-slate-800 tabular-nums">
                              {t('ppe.trackLabel', { id: detection.trackId ?? '' })}
                            </p>
                            <div className="space-y-0.5">
                              {itemsToDisplay.map((item) => {
                                const state = getPpeItemDisplayState(detection, item);
                                const itemName =
                                  item === 'HARD_HAT'
                                    ? t('ppe.item.HARD_HAT')
                                    : item === 'SAFETY_VEST'
                                      ? t('ppe.item.SAFETY_VEST')
                                      : item === 'GLOVES'
                                        ? t('ppe.item.GLOVES')
                                        : item === 'BOOTS'
                                          ? t('ppe.item.BOOTS')
                                          : item === 'GOGGLES'
                                            ? t('ppe.item.GOGGLES')
                                            : formatPpeItemLabel(item);
                                const statusLabel =
                                  state === 'CONFIRMED_MISSING'
                                    ? t('ppe.status.CONFIRMED_MISSING')
                                    : state === 'PENDING_MISSING'
                                      ? t('ppe.status.PENDING_MISSING')
                                      : state === 'PRESENT'
                                        ? t('ppe.status.PRESENT')
                                        : state === 'NOT_REPORTED'
                                          ? t('ppe.status.NOT_REPORTED')
                                          : t('ppe.status.UNKNOWN');

                                const isItemInConfirmedMissingArray = Boolean(
                                  detection.confirmedMissingItems &&
                                  detection.confirmedMissingItems.includes(item),
                                );

                                return (
                                  <div
                                    key={`${detection.trackId}-${item}`}
                                    className="py-1 border-b border-slate-200/70 last:border-0"
                                  >
                                    <div className="flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-2 min-w-0">
                                        {state === 'PRESENT' ? (
                                          <IconCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                                        ) : state === 'CONFIRMED_MISSING' ? (
                                          <IconX className="w-3.5 h-3.5 text-[#DF2225] flex-shrink-0" />
                                        ) : (
                                          <IconAlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                        )}
                                        <span
                                          className={`font-medium truncate ${
                                            state === 'CONFIRMED_MISSING'
                                              ? 'text-[#DF2225] font-semibold'
                                              : state === 'PENDING_MISSING'
                                                ? 'text-amber-700'
                                                : state === 'PRESENT'
                                                  ? 'text-slate-800'
                                                  : 'text-slate-600'
                                          }`}
                                        >
                                          {itemName} · {statusLabel}
                                        </span>
                                      </div>
                                    </div>

                                    {isItemInConfirmedMissingArray &&
                                      state !== 'CONFIRMED_MISSING' && (
                                        <div
                                          data-testid={`confirmed-episode-warning-${detection.trackId}-${item}`}
                                          className="mt-1.5 p-2 rounded-lg bg-red-50/80 border border-red-200 text-slate-800 text-xs space-y-1 min-w-0"
                                        >
                                          <div className="flex flex-col gap-0.5 min-w-0 font-semibold">
                                            <div className="flex items-start gap-1.5 text-[#DF2225] min-w-0">
                                              <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                              <span className="break-words">
                                                {t('ppe.episodeWarning.title')}
                                              </span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 font-mono pl-5 break-words">
                                              {t('ppe.episodeWarning.currentSnapshot', {
                                                status: statusLabel,
                                              })}
                                            </div>
                                          </div>
                                          <p className="text-[11px] text-slate-600 pl-5 leading-normal break-words">
                                            {state === 'UNKNOWN'
                                              ? t('ppe.episodeWarning.descUnknown')
                                              : state === 'NOT_REPORTED'
                                                ? t('ppe.episodeWarning.descNotReported')
                                                : state === 'PRESENT'
                                                  ? t('ppe.episodeWarning.descPresent')
                                                  : t('ppe.episodeWarning.descDefault')}
                                          </p>
                                        </div>
                                      )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Quick link indicator for Experimental detector objects */}
                {modelObjects && (
                  <div className="pt-1.5 border-t border-slate-200/80 text-center">
                    <button
                      type="button"
                      onClick={() => setIsDiagnosticsOpen(true)}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                    >
                      {modelObjects.detections.length > 0
                        ? t('ppe.card.rawObjectsCountLink', {
                            count: modelObjects.detections.length,
                          })
                        : t('ppe.card.viewDiagnosticsLink')}
                    </button>
                  </div>
                )}

                {/* Result Alert Box */}
                <div className="pt-0.5">
                  <div
                    className={`border-l-[3px] pl-3 ${
                      ppeResultState === 'CONFIRMED_MISSING'
                        ? 'border-red-500'
                        : ppeResultState === 'COMPLIANT'
                          ? 'border-emerald-500'
                          : 'border-slate-200'
                    }`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                      {t('ppe.result.label')}
                    </p>
                    <div
                      className={`flex items-center gap-1.5 text-xs font-bold mb-0.5 ${
                        ppeResultState === 'CONFIRMED_MISSING'
                          ? 'text-red-500'
                          : ppeResultState === 'COMPLIANT'
                            ? 'text-emerald-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {ppeResultState === 'CONFIRMED_MISSING' ? (
                        <span>{t('ppe.result.missingDetected')}</span>
                      ) : ppeResultState === 'COMPLIANT' ? (
                        hasExpandedReported ? (
                          <span>{t('ppe.result.coreAndReportedDetected')}</span>
                        ) : (
                          <span>{t('ppe.result.helmetAndVestDetected')}</span>
                        )
                      ) : !preview || activeStatus === 'UNAVAILABLE' ? (
                        <span>{t('ppe.result.evidenceUnavailable')}</span>
                      ) : ppeDetections.length === 0 ? (
                        <span>{t('ppe.result.noObservations')}</span>
                      ) : (
                        <span>{t('ppe.result.scanningSnapshot')}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {!preview || activeStatus === 'UNAVAILABLE'
                        ? effectiveStreamViewMode === 'live-raw'
                          ? t('ppe.result.descRawUnavailable')
                          : t('ppe.result.descSnapshotOffline')
                        : ppeResultState === 'COMPLIANT'
                          ? hasExpandedReported
                            ? t('ppe.result.descCompliantExpanded')
                            : t('ppe.result.descCompliantCoreOnly')
                          : ppeResultState === 'CONFIRMED_MISSING'
                            ? t('ppe.result.descMissing')
                            : ppeDetections.length === 0
                              ? isLive
                                ? activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                                  ? t('ppe.result.descZeroDetectionsReplay')
                                  : t('ppe.result.descZeroDetectionsLive')
                                : t('ppe.result.descSnapshotOffline')
                              : isLive
                                ? activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                                  ? t('ppe.result.descStreamingReplay')
                                  : t('ppe.result.descStreamingLive')
                                : t('ppe.result.descSnapshotOffline')}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Action button */}
          {(!isControlled || sharedSession !== null) && (
            <div className="p-3 border-t border-slate-200/80 bg-[#F8FAFC] flex-shrink-0">
              <button
                type="button"
                onClick={openReviewFromDetection}
                disabled={!testDetection}
                className="w-full py-2 px-4 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
              >
                {t('ppe.action.reviewAlert')}
              </button>
            </div>
          )}
        </div>
      </div>

      {canOpenZonePpe && isZonePpeOpen && selectedSiteId && (
        <ZonePpeSetupDialog
          client={client}
          key={JSON.stringify([
            apiUrl,
            sessionScope,
            credentialId,
            selectedSiteId,
            zonePpeCapabilities.canManageZones,
            zonePpeCapabilities.canManageRegions,
          ])}
          apiUrl={apiUrl}
          token={token}
          sessionScope={sessionScope}
          credentialId={credentialId}
          siteId={selectedSiteId}
          siteName={selectedSite?.name || selectedSite?.code || selectedSiteId}
          canManageZones={zonePpeCapabilities.canManageZones}
          canManageRegions={zonePpeCapabilities.canManageRegions}
          canReadZones={isGlobalAdmin}
          onClose={() => setIsZonePpeOpen(false)}
        />
      )}

      {canRegisterCamera && isRegisterCameraOpen && selectedSiteId && (
        <CameraRegistrationDialog
          key={JSON.stringify([apiUrl, sessionScope, credentialId, selectedSiteId])}
          open={isRegisterCameraOpen}
          onClose={() => setIsRegisterCameraOpen(false)}
          apiUrl={apiUrl}
          token={token}
          sessionScope={sessionScope}
          credentialId={credentialId}
          siteId={selectedSiteId}
          siteName={selectedSite?.name || selectedSite?.code || selectedSiteId}
          canManageCamera={zonePpeCapabilities.canManageRegions}
          client={client}
          onCreated={(createdCamera) => {
            if (
              createdCamera.siteId !== activeSiteIdRef.current ||
              createdCamera.siteId !== selectedSiteId ||
              activeTokenRef.current !== token ||
              activeSessionScopeRef.current !== sessionScope ||
              activeCredentialIdRef.current !== credentialId ||
              isSitesBaseError ||
              expiredScopeRef.current === sessionScope
            ) {
              return;
            }
            setIsRegisterCameraOpen(false);
            setRegistrationFeedback('ppe.admin.registrationSuccess');
            void queryClient
              .invalidateQueries({
                queryKey: [
                  'ppe-monitoring',
                  apiUrl,
                  sessionScope,
                  credentialId,
                  selectedSiteId,
                  'cameras',
                ],
              })
              .catch(() => undefined);
          }}
          onUnauthorized={() => {
            if (
              activeTokenRef.current !== token ||
              activeSessionScopeRef.current !== sessionScope ||
              activeCredentialIdRef.current !== credentialId ||
              activeSiteIdRef.current !== selectedSiteId ||
              isSitesBaseError
            ) {
              return;
            }
            setIsRegisterCameraOpen(false);
            setRejectedRegistrationCredential(credentialId);
            if (expiredScopeRef.current !== sessionScope) {
              expiredScopeRef.current = sessionScope;
              triggerSessionExpired(sessionScope);
              if (isControlled && sharedSession?.onSignOut) {
                sharedSession.onSignOut();
              }
            }
          }}
        />
      )}

      {canManageCamera && isManageCameraOpen && selectedSiteId && selectedCamera && (
        <CameraManagementDialog
          key={JSON.stringify([
            apiUrl,
            sessionScope,
            credentialId,
            selectedSiteId,
            selectedCamera.id,
          ])}
          open={isManageCameraOpen}
          onClose={() => setIsManageCameraOpen(false)}
          apiUrl={apiUrl}
          token={token}
          sessionScope={sessionScope}
          credentialId={credentialId}
          siteId={selectedSiteId}
          siteName={selectedSite?.name || selectedSite?.code || selectedSiteId}
          camera={selectedCamera}
          canManageCamera={zonePpeCapabilities.canManageRegions}
          client={client}
          onUpdated={(updatedCamera) => {
            if (
              updatedCamera.id !== selectedCameraId ||
              updatedCamera.siteId !== activeSiteIdRef.current ||
              updatedCamera.siteId !== selectedSiteId ||
              activeTokenRef.current !== token ||
              activeSessionScopeRef.current !== sessionScope ||
              activeCredentialIdRef.current !== credentialId ||
              isSitesBaseError ||
              isCamerasBaseError ||
              expiredScopeRef.current === sessionScope
            ) {
              return;
            }
            // Cancel earlier reads before publishing a validated mutation response.
            void queryClient.cancelQueries({
              queryKey: [
                'ppe-monitoring',
                apiUrl,
                sessionScope,
                credentialId,
                selectedSiteId,
                'cameras',
                'pages',
              ],
            });
            queryClient.setQueriesData<{
              pages: { items: CameraResponse[]; total: number }[];
              pageParams: unknown[];
            }>(
              {
                queryKey: [
                  'ppe-monitoring',
                  apiUrl,
                  sessionScope,
                  credentialId,
                  selectedSiteId,
                  'cameras',
                  'pages',
                ],
              },
              (data) =>
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
            void queryClient
              .invalidateQueries({
                queryKey: [
                  'ppe-monitoring',
                  apiUrl,
                  sessionScope,
                  credentialId,
                  selectedSiteId,
                  'cameras',
                ],
              })
              .catch(() => undefined);
            void queryClient
              .invalidateQueries({
                // Region metadata owns a separate opaque credential nonce.
                // Invalidate the exact Site/session family rather than guessing that nonce.
                predicate: ({ queryKey: key }) =>
                  key[0] === 'ppe-monitoring' &&
                  key[1] === apiUrl &&
                  key[2] === sessionScope &&
                  key[4] === selectedSiteId &&
                  (key[5] === 'cameras-for-region' ||
                    key[5] === 'zones' ||
                    (key[5] === 'cameras' && key[6] === updatedCamera.id && key[7] === 'regions')),
              })
              .catch(() => undefined);
            void queryClient
              .invalidateQueries({
                queryKey: ['zone-admin', apiUrl, sessionScope, selectedSiteId],
              })
              .catch(() => undefined);
          }}
          onUnauthorized={() => {
            if (
              activeTokenRef.current !== token ||
              activeSessionScopeRef.current !== sessionScope ||
              activeCredentialIdRef.current !== credentialId ||
              activeSiteIdRef.current !== selectedSiteId ||
              isSitesBaseError
            ) {
              return;
            }
            setIsManageCameraOpen(false);
            setRejectedRegistrationCredential(credentialId);
            if (expiredScopeRef.current !== sessionScope) {
              expiredScopeRef.current = sessionScope;
              triggerSessionExpired(sessionScope);
              if (isControlled && sharedSession?.onSignOut) {
                sharedSession.onSignOut();
              }
            }
          }}
        />
      )}

      {/* Explicit Expandable Secondary Panel: Raw Detector Controls */}
      <div
        data-testid="secondary-diagnostics-drawer"
        className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm"
      >
        <div className="px-4 py-3 bg-[#F8FAFC] border-b border-slate-200/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconShield className="w-4 h-4 text-slate-900 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                {t('ppe.diagnostics.title')}
              </h3>
              <p className="text-xs text-slate-500 truncate">{t('ppe.diagnostics.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="toggle-diagnostics-drawer"
            onClick={() => setIsDiagnosticsOpen((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer shrink-0 shadow-xs"
            aria-expanded={isDiagnosticsOpen}
            aria-controls={diagnosticsContentId}
          >
            {isDiagnosticsOpen ? t('ppe.diagnostics.collapseBtn') : t('ppe.diagnostics.expandBtn')}
          </button>
        </div>

        {isDiagnosticsOpen && (
          <div id={diagnosticsContentId} className="p-4 space-y-4">
            {/* MF05 Demo Control Panel (Diagnostic only, enabled via VITE_MF05_DEMO_CONTROLS === 'true') */}
            {isDemoControlsEnabled && selectedSiteId && selectedCameraId && token && (
              <div className="border border-slate-200/80 rounded-2xl p-3.5 bg-[#F8FAFC]">
                <Mf05DemoControlPanel
                  key={currentCameraScope}
                  apiUrl={apiUrl}
                  token={token}
                  sessionScope={sessionScope}
                  credentialId={credentialId}
                  siteId={selectedSiteId}
                  cameraId={selectedCameraId}
                  canApply={isGlobalAdmin && !isAiWorkPaused}
                  onApplyingChange={handleApplyingChange}
                />
              </div>
            )}

            {/* Unified8 Experimental Raw Model Objects Section */}
            {modelObjects && (
              <div data-testid="experimental-objects-section" className="space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">
                      {t('ppe.diagnostics.experimentalObjectsTitle')}
                    </p>
                    <span
                      data-testid="experimental-objects-status-badge"
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md border flex-shrink-0 ${
                        modelObjects.detections.length > 0
                          ? 'bg-[#EDF3EC] text-[#346538] border-[#C5DDC6]'
                          : 'bg-slate-100 text-slate-600 border-slate-200/80'
                      }`}
                    >
                      {modelObjects.detections.length > 0
                        ? t('ppe.diagnostics.objectDetectedBadge')
                        : t('ppe.diagnostics.noObjectInFrame')}
                    </span>
                  </div>

                  {/* Normalized bounding boxes toggle button */}
                  <button
                    type="button"
                    data-testid="toggle-model-objects"
                    onClick={() => setShowModelObjects((prev) => !prev)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex-shrink-0 shadow-xs ${
                      showModelObjects
                        ? 'bg-[#0F172A] text-white border-[#0F172A]'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {showModelObjects
                      ? t('ppe.diagnostics.boxesOn')
                      : t('ppe.diagnostics.boxesOff')}
                  </button>
                </div>

                {/* Display Focus Presets Bar (DISPLAY FOCUS ONLY) */}
                <div
                  className="rounded-xl bg-[#F8FAFC] border border-slate-200/70 p-3 space-y-2 min-w-0"
                  data-testid="display-preset-bar"
                >
                  <div className="flex items-center justify-between min-w-0">
                    <p className="text-xs font-semibold text-slate-700">
                      {t('ppe.diagnostics.presetHeading')}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      {t('ppe.diagnostics.presetSubnote')}
                    </span>
                  </div>
                  <div
                    className="flex flex-wrap gap-1.5 min-w-0"
                    role="group"
                    aria-label={t('ppe.diagnostics.presetGroupAria')}
                  >
                    {(['FULL_EIGHT', 'GROUND', 'EYE_FACE', 'HEIGHT'] as const).map((presetKey) => {
                      const preset = DISPLAY_PRESET_CONFIG[presetKey];
                      const isActive = activeDisplayPreset === presetKey;
                      return (
                        <button
                          key={presetKey}
                          type="button"
                          data-testid={`preset-btn-${presetKey}`}
                          aria-pressed={isActive}
                          onClick={() => {
                            if (selectedCameraId) {
                              setCameraDisplayPresets((prev) => ({
                                ...prev,
                                [selectedCameraId]: presetKey,
                              }));
                            }
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-xs'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                          title={t(preset.descriptionKey)}
                        >
                          {t(preset.shortLabelKey)}
                        </button>
                      );
                    })}
                  </div>
                  <details className="text-xs text-slate-500 pt-0.5">
                    <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 select-none">
                      {t('ppe.check.notesSummary')}
                    </summary>
                    <div className="mt-1.5 space-y-1 leading-relaxed">
                      <p>{t('ppe.diagnostics.raw15ClassDisclaimer')}</p>
                      <p>{t('ppe.diagnostics.presetDisclaimer')}</p>
                    </div>
                  </details>
                </div>

                {/* 8 Positive PPE Object Families List */}
                <div className="space-y-1 min-w-0">
                  {positiveModelDetections.length === 0 ? (
                    <p className="text-xs text-slate-500 italic py-1">
                      {t('ppe.diagnostics.noObjectInFrame')}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1.5 min-w-0">
                      {positiveModelDetections.map((det, idx) => (
                        <div
                          key={`pos-obj-${det.classId}-${idx}`}
                          data-testid={`model-object-item-${det.className}`}
                          className="flex items-center justify-between rounded-lg bg-[#F8FAFC] border border-slate-200/80 px-2.5 py-1.5 text-xs min-w-0"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-medium text-slate-800 truncate">
                              {det.className}
                            </span>
                            {['Mask', 'fullbody-Harness', 'Lanyard-Hook'].includes(
                              det.className,
                            ) && (
                              <span
                                data-testid={`tag-object-only-${det.className}`}
                                className="text-[10px] font-medium text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded flex-shrink-0"
                              >
                                {t('ppe.diagnostics.objectOnlyTag')}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs text-[#346538] font-semibold tabular-nums flex-shrink-0 ml-1">
                            {Math.round(det.confidence * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Raw Negative Observations (Separate) */}
                {negativeModelDetections.length > 0 && (
                  <div className="pt-1.5 space-y-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-600">
                      {t('ppe.diagnostics.negativeObservationsHeading')}
                    </p>
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {negativeModelDetections.map((det, idx) => (
                        <span
                          key={`neg-obj-${det.classId}-${idx}`}
                          data-testid={`model-object-negative-${det.className}`}
                          className="rounded-md bg-[#FDEBEC] border border-red-200 px-2 py-0.5 text-xs text-red-800 font-mono tabular-nums flex-shrink-0"
                        >
                          {det.className} ({Math.round(det.confidence * 100)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live AI Observations status or Replay Observations Table */}
      {isLive || isAiWorkPaused ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isAiWorkPaused
                      ? 'bg-amber-500'
                      : activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500 animate-pulse'
                  }`}
                />
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                  {isAiWorkPaused
                    ? t('ppe.observations.pausedHeading')
                    : activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                      ? t('ppe.observations.replayHeading')
                      : t('ppe.observations.liveHeading')}
                </h3>
              </div>
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 select-none">
                  {t('ppe.check.notesSummary')}
                </summary>
                <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
                  {isAiWorkPaused
                    ? t('ppe.observations.pausedDesc')
                    : activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                      ? t('ppe.observations.replayDesc')
                      : t('ppe.observations.liveDesc')}
                </p>
              </details>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() =>
                  onNavigate('incidents', {
                    alertType: 'PPE_VIOLATION',
                    ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                  })
                }
                className="self-start sm:self-auto px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                {t('ppe.observations.viewInSafetyAlerts')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 space-y-3.5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {t('ppe.table.heading')}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {t('ppe.table.subtitle')}
                {activeFilterWorker !== null &&
                  t('ppe.table.filteredByTrack', { id: activeFilterWorker })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() =>
                    onNavigate('incidents', {
                      alertType: 'PPE_VIOLATION',
                      ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                    })
                  }
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                >
                  {t('ppe.observations.viewInSafetyAlerts')}
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-600 font-semibold text-xs">
                  <th className="py-2.5 px-3">{t('ppe.table.colTime')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colWorker')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colCamera')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colWorkArea')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colIssue')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colConfidence')}</th>
                  <th className="py-2.5 px-3">{t('ppe.table.colStatus')}</th>
                  <th className="py-2.5 px-3 text-right">{t('ppe.table.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500 text-xs">
                      {t('ppe.table.empty')}
                    </td>
                  </tr>
                ) : (
                  displayedEvents.map((evt) => (
                    <tr key={evt.rowKey} className="hover:bg-[#F8FAFC] transition-colors group">
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-xs tabular-nums">
                        {evt.time}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800 text-xs">
                        {evt.worker}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-xs">{evt.camera}</td>
                      <td className="py-2.5 px-3 text-slate-600 text-xs">{evt.workArea}</td>
                      <td className="py-2.5 px-3 text-[#9F2F2D] font-semibold text-xs">
                        {evt.issue}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-xs tabular-nums">
                        {evt.confidence}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FBF3DB] text-[#956400]">
                          {t('ppe.event.statusSnapshotObservation')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {(!isControlled || sharedSession !== null) && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedReview({
                                item: evt,
                                scope: {
                                  apiUrl,
                                  credentialId,
                                  sessionScope,
                                  siteId: selectedSiteId,
                                  cameraId: selectedCameraId,
                                },
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors shadow-xs"
                          >
                            {t('ppe.action.reviewAlert')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Observation Review Modal */}
      {activeReviewItem && (
        <PpeDialog
          open
          title={t('ppe.reviewModal.title')}
          description={t('ppe.reviewModal.description')}
          onClose={() => setSelectedReview(null)}
        >
          <div className="space-y-3 text-xs">
            <div className="bg-[#F8FAFC] p-3.5 rounded-xl border border-slate-100 space-y-2">
              <p>
                <span className="font-bold text-slate-500">
                  {t('ppe.reviewModal.subjectLabel')}
                </span>{' '}
                {activeReviewItem.worker}
              </p>
              <p>
                <span className="font-bold text-slate-500">{t('ppe.reviewModal.cameraLabel')}</span>{' '}
                {activeReviewItem.camera}
              </p>
              <p>
                <span className="font-bold text-slate-500">
                  {t('ppe.reviewModal.workAreaLabel')}
                </span>{' '}
                {activeReviewItem.workArea}
              </p>
              <p>
                <span className="font-bold text-slate-500">{t('ppe.reviewModal.issueLabel')}</span>{' '}
                <span className="text-[#9F2F2D] font-semibold">{activeReviewItem.issue}</span>
              </p>
              <p>
                <span className="font-bold text-slate-500">{t('ppe.reviewModal.timeLabel')}</span>{' '}
                <span className="font-mono tabular-nums">{activeReviewItem.time}</span>
              </p>
            </div>
            <p className="text-[11px] text-slate-500">{t('ppe.reviewModal.disclaimer')}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200/80">
            <button
              type="button"
              onClick={() => setSelectedReview(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            >
              {t('ppe.reviewModal.dismissBtn')}
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => {
                  setSelectedReview(null);
                  onNavigate('incidents', {
                    alertType: 'PPE_VIOLATION',
                    ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
                  });
                }}
                className="px-4 py-2 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors shadow-xs"
              >
                {t('ppe.reviewModal.continueBtn')}
              </button>
            )}
          </div>
        </PpeDialog>
      )}
    </div>
  );
}
