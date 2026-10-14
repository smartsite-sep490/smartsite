import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, RegionMutationResponse } from '@smartsite/contracts';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import { IconCamera, IconAlertTriangle, IconCheck, IconX } from '../icons';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';

export interface ZonePpeCameraRegionPanelProps {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  zones: ZoneResponse[];
  onClose?: () => void;
}

class LocalRegionValidationError extends Error {
  readonly errorKey: TranslationKey;

  constructor(errorKey: TranslationKey) {
    super(errorKey);
    this.name = 'LocalRegionValidationError';
    this.errorKey = errorKey;
  }
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

// ── Pure Geometry Helpers ───────────────────────────────────────────────────

// Draft coordinates are already quantized to 4 decimals by toFixed(4); use integer shoelace to avoid floating-point cancellation.
function calculatePolygonArea(coords: [number, number][]): number {
  let crossSum = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[(i + 1) % n]!;
    const ix1 = Math.round(x1 * 10000);
    const iy1 = Math.round(y1 * 10000);
    const ix2 = Math.round(x2 * 10000);
    const iy2 = Math.round(y2 * 10000);
    crossSum += ix1 * iy2 - ix2 * iy1;
  }
  return Math.abs(crossSum) / (2 * 10000 * 10000);
}

function orientation(p: [number, number], q: [number, number], r: [number, number]): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-9) return 0; // Collinear
  return val > 0 ? 1 : 2; // 1: Clockwise, 2: Counterclockwise
}

function onSegment(p: [number, number], q: [number, number], r: [number, number]): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9
  );
}

function segmentsIntersectOrOverlap(
  p1: [number, number],
  q1: [number, number],
  p2: [number, number],
  q2: [number, number],
  isAdjacent: boolean,
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (isAdjacent) {
    // Adjacent edges share an endpoint. Check if they fold back on each other (180 degree overlap).
    if (o1 === 0 && o2 === 0) {
      if (
        onSegment(p1, q2, q1) &&
        (Math.abs(q2[0] - q1[0]) > 1e-6 || Math.abs(q2[1] - q1[1]) > 1e-6)
      ) {
        return true;
      }
      if (
        onSegment(p2, p1, q2) &&
        (Math.abs(p1[0] - p2[0]) > 1e-6 || Math.abs(p1[1] - p2[1]) > 1e-6)
      ) {
        return true;
      }
    }
    return false;
  }

  // Non-adjacent edges:
  // 1. General proper crossing:
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    return true;
  }

  // 2. Collinear overlaps or point touches non-adjacent edge:
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

function validatePolygonGeometry(coords: [number, number][]): TranslationKey | null {
  const n = coords.length;
  if (n < 3) return 'regionSetup.validation.minPoints';
  if (n > 32) return 'regionSetup.validation.maxPoints';

  // Reject any repeated vertex (not just consecutive)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        Math.abs(coords[i]![0] - coords[j]![0]) < 1e-6 &&
        Math.abs(coords[i]![1] - coords[j]![1]) < 1e-6
      ) {
        return 'regionSetup.validation.duplicateVertices';
      }
    }
  }

  // Zero degenerate area only (no arbitrary threshold)
  const area = calculatePolygonArea(coords);
  if (area <= 0) {
    return 'regionSetup.validation.zeroArea';
  }

  // Check self-intersections and collinear overlaps
  for (let i = 0; i < n; i++) {
    const p1 = coords[i]!;
    const q1 = coords[(i + 1) % n]!;

    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      const p2 = coords[j]!;
      const q2 = coords[(j + 1) % n]!;

      if (segmentsIntersectOrOverlap(p1, q1, p2, q2, isAdjacent)) {
        return 'regionSetup.validation.selfIntersect';
      }
    }
  }

  return null;
}

// ── Internal Opaque Nonce Generator (Never serialize token in query keys) ────

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

// ── Inner Drawing & Mutation Component (Remounted on Scope Changes) ──────────

interface ZonePpeCameraRegionDrawerProps {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  selectedCamera: CameraResponse;
  selectedZone: ZoneResponse;
  frozenPreview: DecodedPreview;
  isStreamUnavailable?: boolean;
  lastSavedDraft: string | null;
  onSaveSuccess: (data: RegionMutationResponse, savedDraftKey: string) => void;
  onClose: () => void;
}

function ZonePpeCameraRegionDrawer({
  apiUrl,
  token,
  sessionScope,
  credentialId,
  internalNonce,
  siteId,
  selectedCamera,
  selectedZone,
  frozenPreview,
  isStreamUnavailable,
  lastSavedDraft,
  onSaveSuccess,
  onClose,
}: ZonePpeCameraRegionDrawerProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);
  const [serverErrorKey, setServerErrorKey] = useState<TranslationKey | null>(null);

  const validationError = validationErrorKey ? t(validationErrorKey) : null;
  const serverError = serverErrorKey ? t(serverErrorKey) : null;

  // TTL expiration check: never display expired frozen pixels (>5s old)
  const [isSnapshotExpired, setIsSnapshotExpired] = useState(() => {
    const capturedTime = Date.parse(frozenPreview.frame.capturedAt);
    return Number.isFinite(capturedTime) ? Date.now() - capturedTime > 5000 : true;
  });

  useEffect(() => {
    const capturedTime = Date.parse(frozenPreview.frame.capturedAt);
    const remaining = Number.isFinite(capturedTime)
      ? Math.max(0, 5000 - (Date.now() - capturedTime))
      : 0;
    const timer = setTimeout(() => {
      setIsSnapshotExpired(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [frozenPreview.frame.capturedAt]);

  const isImageStale = isSnapshotExpired || Boolean(isStreamUnavailable);

  const isMountedRef = useRef(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    svgRef.current?.focus();
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  // Shortcuts belong to this editor, never another form or the parent dialog.
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return; // Ignore global typing z undo
    }

    if (e.key.toLowerCase() === 'z' && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      setDraftPoints((prev) => prev.slice(0, -1));
      setValidationErrorKey(null);
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draftPoints.length >= 32) {
      setValidationErrorKey('regionSetup.validation.maxPointsClick');
      return;
    }

    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;

    // Never clamp out-of-bounds clicks; reject!
    if (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1) {
      setValidationErrorKey('regionSetup.validation.outOfBounds');
      return;
    }

    const normX = Number(rawX.toFixed(4));
    const normY = Number(rawY.toFixed(4));

    // Reject ANY repeated vertex in the polygon
    if (
      draftPoints.some(([px, py]) => Math.abs(px - normX) < 1e-6 && Math.abs(py - normY) < 1e-6)
    ) {
      setValidationErrorKey('regionSetup.validation.duplicateVertexClick');
      return;
    }

    setDraftPoints((prev) => [...prev, [normX, normY]]);
    setValidationErrorKey(null);
    setServerErrorKey(null);
  };

  const handleUndo = () => {
    setDraftPoints((prev) => prev.slice(0, -1));
    setValidationErrorKey(null);
  };

  const handleReset = () => {
    setDraftPoints([]);
    setValidationErrorKey(null);
  };

  const createRegionMutation = useMutation({
    mutationFn: async () => {
      // 1. Client-side geometry validation
      const geoErrorKey = validatePolygonGeometry(draftPoints);
      if (geoErrorKey) {
        throw new LocalRegionValidationError(geoErrorKey);
      }

      // 2. Duplicate draft block
      const draftKey = JSON.stringify(draftPoints);
      if (draftKey === lastSavedDraft) {
        throw new LocalRegionValidationError('regionSetup.validation.alreadySaved');
      }

      // 3. AbortController for fresh getCamera query
      abortControllerRef.current = new AbortController();
      const freshCamera = await client.getCamera(token, siteId, selectedCamera.id, {
        signal: abortControllerRef.current.signal,
      });

      // 4. Late active guard after await: check mount and metadata matching
      if (!isMountedRef.current || abortControllerRef.current.signal.aborted) {
        throw new LocalRegionValidationError('regionSetup.error.cancelled');
      }
      if (
        freshCamera.id !== selectedCamera.id ||
        freshCamera.siteId !== siteId ||
        freshCamera.status !== 'ACTIVE' ||
        freshCamera.externalId !== selectedCamera.externalId
      ) {
        throw new LocalRegionValidationError('regionSetup.error.cameraChangedOrInactive');
      }

      // 5. POST createRegion
      return client.createRegion(token, siteId, selectedCamera.id, {
        zoneId: selectedZone.id,
        polygon: {
          coordinates: draftPoints,
        },
        expectedConfigurationVersion: freshCamera.configurationVersion,
      });
    },
    onSuccess: (data: RegionMutationResponse) => {
      if (!isMountedRef.current) return;

      // Wrong-scope response guard
      if (data.region.cameraId !== selectedCamera.id || data.region.zoneId !== selectedZone.id) {
        setServerErrorKey('regionSetup.error.wrongScope');
        return;
      }

      // Invalidate queries:
      // 1. Camera observation regions
      queryClient.invalidateQueries({
        queryKey: [
          'ppe-monitoring',
          apiUrl,
          sessionScope,
          internalNonce,
          siteId,
          'cameras',
          selectedCamera.id,
          'regions',
        ],
      });
      // 2. Actual cameras-for-region key
      queryClient.invalidateQueries({
        queryKey: [
          'ppe-monitoring',
          apiUrl,
          sessionScope,
          internalNonce,
          siteId,
          'cameras-for-region',
        ],
      });
      // 3. Zone-admin prefix and zones
      queryClient.invalidateQueries({
        queryKey: ['ppe-monitoring', apiUrl, sessionScope, credentialId, siteId, 'zones'],
      });
      queryClient.invalidateQueries({
        queryKey: ['zone-admin', apiUrl, sessionScope, siteId, selectedCamera.id],
      });

      onSaveSuccess(data, JSON.stringify(draftPoints));
    },
    onError: (err: unknown) => {
      if (!isMountedRef.current) return;

      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerErrorKey('regionSetup.error.401');
          return;
        }
        if (err.status === 403) {
          setServerErrorKey('regionSetup.error.403');
          return;
        }
        if (err.status === 409) {
          setServerErrorKey('regionSetup.error.409');
          // Invalidate cameras-for-region to refresh configuration version (NO auto-POST retry!)
          queryClient.invalidateQueries({
            queryKey: [
              'ppe-monitoring',
              apiUrl,
              sessionScope,
              internalNonce,
              siteId,
              'cameras-for-region',
            ],
          });
          return;
        }
      }

      // Safe error messages: never leak raw network err.message or upstream private text
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (err instanceof LocalRegionValidationError) {
        setServerErrorKey(err.errorKey);
      } else {
        setServerErrorKey('regionSetup.error.saveDefault');
      }
    },
  });

  const handleSaveRegion = () => {
    if (createRegionMutation.isPending) return;

    const geoErrorKey = validatePolygonGeometry(draftPoints);
    if (geoErrorKey) {
      setValidationErrorKey(geoErrorKey);
      return;
    }

    const draftKey = JSON.stringify(draftPoints);
    if (draftKey === lastSavedDraft) {
      setValidationErrorKey('regionSetup.validation.alreadySaved');
      return;
    }

    setValidationErrorKey(null);
    setServerErrorKey(null);
    createRegionMutation.mutate();
  };

  return (
    <div className="space-y-3" data-ppe-region-editor onKeyDown={handleEditorKeyDown}>
      {/* Validation & Server Error Notices */}
      {validationError && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>{validationError}</span>
        </div>
      )}

      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Control Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={draftPoints.length === 0 || createRegionMutation.isPending}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.undoPoint')}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={draftPoints.length === 0 || createRegionMutation.isPending}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.resetDrawing')}
          </button>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-3">
          <span className="font-semibold text-slate-800">
            {t('regionSetup.drawer.pointsCount', { count: draftPoints.length })}
          </span>
        </div>
      </div>

      {/* SVG Drawing Canvas on Frozen Frame */}
      <div
        className="relative w-full border border-slate-800 rounded-xl overflow-hidden bg-slate-950 select-none shadow-inner"
        style={{ aspectRatio: `${frozenPreview.frame.width} / ${frozenPreview.frame.height}` }}
      >
        {isImageStale && (
          <div
            data-testid="stale-image-notice"
            className="absolute top-2 right-2 z-10 rounded-xl bg-amber-950/80 border border-amber-600/50 px-2.5 py-1 text-[11px] text-amber-200 pointer-events-none flex items-center gap-1.5 backdrop-blur-xs"
          >
            <IconAlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>{t('regionSetup.drawer.stalePixelsNotice')}</span>
          </div>
        )}

        <svg
          ref={svgRef}
          role="region"
          aria-label={t('regionSetup.drawer.canvasAria')}
          tabIndex={0}
          viewBox={`0 0 ${frozenPreview.frame.width} ${frozenPreview.frame.height}`}
          onClick={handleSvgClick}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
        >
          {/* Frozen Snapshot Image: never display expired frozen pixels */}
          {!isImageStale && (
            <image
              href={frozenPreview.frame.imageDataUrl}
              width={frozenPreview.frame.width}
              height={frozenPreview.frame.height}
            />
          )}

          {/* Polygon Path Preview */}
          {draftPoints.length >= 2 && (
            <polyline
              points={draftPoints
                .map(
                  ([x, y]) => `${x * frozenPreview.frame.width},${y * frozenPreview.frame.height}`,
                )
                .join(' ')}
              fill={draftPoints.length >= 3 ? 'rgba(59, 130, 246, 0.25)' : 'none'}
              stroke="#3B82F6"
              strokeWidth="2.5"
              strokeDasharray={draftPoints.length >= 3 ? 'none' : '4 2'}
            />
          )}

          {/* Points Anchors */}
          {draftPoints.map(([x, y], idx) => (
            <g key={idx}>
              <circle
                cx={x * frozenPreview.frame.width}
                cy={y * frozenPreview.frame.height}
                r="5"
                fill="#3B82F6"
                stroke="#FFFFFF"
                strokeWidth="2"
              />
              <text
                x={x * frozenPreview.frame.width + 7}
                y={y * frozenPreview.frame.height - 7}
                fill="#FFFFFF"
                fontSize="11"
                fontWeight="bold"
                filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.8))"
              >
                {idx + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Save Action Bar */}
      <div className="flex items-center justify-between border-t border-slate-200/80 pt-3">
        <div className="text-[11px] text-slate-500">
          {t('regionSetup.drawer.shortcutsLabel')}{' '}
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded-md text-[10px] font-mono border border-slate-200">
            Z
          </kbd>{' '}
          {t('regionSetup.drawer.shortcutUndo')} ·{' '}
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded-md text-[10px] font-mono border border-slate-200">
            Esc
          </kbd>{' '}
          {t('regionSetup.drawer.shortcutCancel')}
        </div>
        <button
          type="button"
          onClick={handleSaveRegion}
          disabled={draftPoints.length < 3 || createRegionMutation.isPending}
          className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-xs"
        >
          {createRegionMutation.isPending ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              {t('regionSetup.drawer.saving')}
            </>
          ) : (
            t('regionSetup.drawer.saveRegion')
          )}
        </button>
      </div>
    </div>
  );
}

// ── Parent Panel Component ──────────────────────────────────────────────────

interface DrawingScope {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  cameraId: string;
  zoneId: string;
  preview: DecodedPreview;
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
      ])}
      {...props}
      internalNonce={internalNonce}
      zones={props.zones.filter((zone) => zone.siteId === props.siteId)}
    />
  );
}

function ZonePpeCameraRegionPanelContent({
  apiUrl,
  token,
  sessionScope,
  credentialId,
  siteId,
  zones,
  onClose,
  internalNonce,
}: ZonePpeCameraRegionPanelProps & { internalNonce: number }) {
  const { t } = useLocale();
  const isAiWorkPaused =
    import.meta.env.VITE_AI_WORK_PAUSED === 'true' || import.meta.env.VITE_AI_WORK_PAUSED === true;

  // 1. Zone Selection (default to first zone if available)
  const [requestedZoneId, setSelectedZoneId] = useState<string>(() => zones[0]?.id ?? '');
  const selectedZoneId = zones.some((zone) => zone.id === requestedZoneId)
    ? requestedZoneId
    : (zones[0]?.id ?? '');

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedZoneId) ?? null,
    [zones, selectedZoneId],
  );

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

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

  // Error Classification for Camera Query
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

  const [requestedCameraId, setSelectedCameraId] = useState<string>('');
  const selectedCameraId = visibleActiveCameras.some((c) => c.id === requestedCameraId)
    ? requestedCameraId
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

  // Error Classification for Region Query
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

  // 4. Live/Replay Scoped Camera Preview via Gateway
  const scopedPreview = useScopedCameraPreview({
    apiUrl,
    token,
    sessionScope,
    siteId,
    cameraId: selectedCameraId,
    enabled: !isAiWorkPaused,
  });

  const isExternalIdMatched = Boolean(
    selectedCamera &&
    scopedPreview.cameraExternalId &&
    scopedPreview.cameraExternalId === selectedCamera.externalId,
  );

  const isPreviewStatusReady = scopedPreview.status === 'LIVE' || scopedPreview.status === 'REPLAY';

  const canStartDrawing = Boolean(
    !isAiWorkPaused &&
    scopedPreview.preview &&
    isPreviewStatusReady &&
    isExternalIdMatched &&
    !isCameraBaseError &&
    !isAuthOrScopeError(regionsInfiniteQuery.error),
  );

  // 5. Drawing State bound to complete captured scope
  const [drawingScope, setDrawingScope] = useState<DrawingScope | null>(null);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(null);
  const [savedRegionInfo, setSavedRegionInfo] = useState<{
    id: string;
    version: number;
  } | null>(null);

  const successFeedback = savedRegionInfo
    ? t('regionSetup.feedback.saved', {
        id: savedRegionInfo.id,
        version: savedRegionInfo.version,
      })
    : null;

  // Track active selection to clear stale feedback/draft whenever selection changes even when not drawing
  const [activeSelectionKey, setActiveSelectionKey] = useState(
    () => `${siteId}:${selectedZoneId}:${selectedCameraId}`,
  );
  const currentSelectionKey = `${siteId}:${selectedZoneId}:${selectedCameraId}`;
  if (activeSelectionKey !== currentSelectionKey) {
    setActiveSelectionKey(currentSelectionKey);
    setDrawingScope(null);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  }

  // Immediate revocation & isolation guard
  const isDrawingScopeRevoked = Boolean(
    drawingScope &&
    (isAiWorkPaused ||
      drawingScope.siteId !== siteId ||
      drawingScope.cameraId !== selectedCameraId ||
      drawingScope.zoneId !== selectedZoneId ||
      drawingScope.sessionScope !== sessionScope ||
      drawingScope.token !== token ||
      drawingScope.credentialId !== credentialId ||
      drawingScope.internalNonce !== internalNonce ||
      drawingScope.apiUrl !== apiUrl ||
      !activeCameras.some((cam) => cam.id === drawingScope.cameraId) ||
      !zones.some((z) => z.id === drawingScope.zoneId) ||
      (scopedPreview.cameraExternalId &&
        selectedCamera &&
        scopedPreview.cameraExternalId !== selectedCamera.externalId) ||
      scopedPreview.errorStatus === 401 ||
      scopedPreview.errorStatus === 403 ||
      scopedPreview.errorStatus === 404 ||
      isAuthOrScopeError(camerasInfiniteQuery.error) ||
      isAuthOrScopeError(regionsInfiniteQuery.error)),
  );

  if (requestedZoneId !== selectedZoneId) {
    setSelectedZoneId(selectedZoneId);
  }
  if (requestedCameraId !== selectedCameraId) {
    setSelectedCameraId(selectedCameraId);
  }
  if (isDrawingScopeRevoked) {
    setDrawingScope(null);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  }

  // Synchronous scope equality gate: drawing canvas is ONLY visible if current scope strictly matches drawing scope
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

  const handleStartDrawing = () => {
    if (!canStartDrawing || !scopedPreview.preview) return;
    setDrawingScope({
      apiUrl,
      token,
      sessionScope,
      credentialId,
      internalNonce,
      siteId,
      cameraId: selectedCameraId,
      zoneId: selectedZoneId,
      preview: scopedPreview.preview,
    });
    setSavedRegionInfo(null);
  };

  const handleSaveSuccess = (data: RegionMutationResponse, savedDraftKey: string) => {
    setLastSavedDraft(savedDraftKey);
    setSavedRegionInfo({
      id: data.region.id,
      version: data.region.version,
    });
  };

  const handleZoneChange = (zoneId: string) => {
    setSelectedZoneId(zoneId);
    setDrawingScope(null);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  };

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    setDrawingScope(null);
    setLastSavedDraft(null);
    setSavedRegionInfo(null);
  };

  return (
    <div
      role="region"
      aria-label={t('regionSetup.sectionAria')}
      className="rounded-2xl border border-slate-200/80 bg-white p-6 space-y-5 min-w-0 w-full max-w-full shadow-sm"
    >
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
            {visibleActiveCameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.code} · {camera.name}
              </option>
            ))}
          </select>

          {/* Initial Camera Loading */}
          {isCamerasInitialLoading && (
            <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
              {t('regionSetup.camera.loading')}
            </div>
          )}

          {/* Camera Error Message */}
          {cameraError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
            >
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{getSafePublicErrorMessage(cameraError, 'camera', t)}</span>
            </div>
          )}

          {/* Camera Pagination & Retry Controls */}
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

      {/* Snapshot Preview & Drawing Trigger */}
      <div className="space-y-3">
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

        {/* Warning messages if preview cannot be used for drawing */}
        {!canStartDrawing && !isCurrentScopeActive && (
          <div className="text-xs text-amber-800 bg-[#FBF3DB] p-3 rounded-xl border border-amber-200">
            {isAiWorkPaused
              ? t('regionSetup.previewWarning.aiPaused')
              : !scopedPreview.preview || scopedPreview.status === 'UNAVAILABLE'
                ? t('regionSetup.previewWarning.unavailable')
                : !isExternalIdMatched
                  ? t('regionSetup.previewWarning.externalIdMismatch')
                  : t('regionSetup.previewWarning.connecting')}
          </div>
        )}

        {/* Remount inner drawing/mutation component keyed by opaque scope ID */}
        {isCurrentScopeActive && drawingScope && selectedCamera && selectedZone && (
          <ZonePpeCameraRegionDrawer
            key={`${apiUrl}:${sessionScope}:${internalNonce}:${siteId}:${selectedCameraId}:${selectedZoneId}`}
            apiUrl={apiUrl}
            token={token}
            sessionScope={sessionScope}
            credentialId={credentialId}
            internalNonce={internalNonce}
            siteId={siteId}
            selectedCamera={selectedCamera}
            selectedZone={selectedZone}
            frozenPreview={drawingScope.preview}
            isStreamUnavailable={
              !scopedPreview.preview ||
              scopedPreview.status === 'UNAVAILABLE' ||
              scopedPreview.status === 'CONNECTING'
            }
            lastSavedDraft={lastSavedDraft}
            onSaveSuccess={handleSaveSuccess}
            onClose={() => setDrawingScope(null)}
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

        {/* Initial Region Loading State */}
        {isRegionsInitialLoading && (
          <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
            {t('regionSetup.list.loading')}
          </div>
        )}

        {/* Region Error Message */}
        {regionError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{getSafePublicErrorMessage(regionError, 'region', t)}</span>
          </div>
        )}

        {/* Base / Hard Error Retry Button */}
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

        {/* Empty State: Only when not initial loading, not base error, camera selected, no linked regions */}
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

        {/* No camera selected guidance */}
        {!selectedCameraId && !isCameraBaseError && !camerasInfiniteQuery.isLoading && (
          <div className="text-xs text-slate-500 italic py-1">
            {t('regionSetup.list.noCameraSelected')}
          </div>
        )}

        {/* Render Region List */}
        {visibleLinkedRegions.length > 0 && (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
            {visibleLinkedRegions.map((region) => (
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
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 shrink-0">
                  {region.coordinateSpace}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Next Page Region Controls */}
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
