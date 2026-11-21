import React, { useEffect, useMemo } from 'react';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  useScopedCameraPreview,
  type ScopedPreviewStatus,
} from '../cameras/useScopedCameraPreview';
import { ScopedRealtimePreviewCanvas as RealtimePreviewCanvas } from '../cameras/ScopedRealtimePreviewCanvas';
import type { ScopedDecodedPreview as DecodedPreview } from '../cameras/scopedRealtimePreview';
import { IconAlertTriangle, IconCamera, IconMaximize, IconShield } from '../icons';
import { formatClockTime } from '../cameras/monitoringUtils';
import { CameraObservationZones } from './CameraObservationZones';
import { useCameraObservationZones } from './useCameraObservationZones';
import { useFourSourceWallTranslate } from './four-source-wall-catalog';
import {
  resolveMonitorTelemetryState,
  useMonitorReadabilityTranslate,
} from './monitor-readability';

export interface ScopedWallSnapshot {
  scope: {
    apiUrl: string;
    credentialId: number;
    sessionScope: string;
    siteId: string;
    cameraId: string;
    client: SmartSiteManagementClient;
    token: string;
  };
  preview: DecodedPreview | null;
  status: ScopedPreviewStatus;
  sourceKind: 'LIVE' | 'REPLAY' | null;
  capturedAt: string | null;
  errorStatus: number | null;
  receivedAt: number;
}

const UUID_SUBSTRING_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function formatSingleLinkedZoneChip(zone: { code: string; name: string } | undefined): {
  label: string | null;
  title: string | undefined;
} {
  if (!zone) {
    return { label: null, title: undefined };
  }
  const trimmedName = zone.name.trim();
  const trimmedCode = zone.code.trim();
  const label =
    UUID_SUBSTRING_RE.test(trimmedCode) && trimmedName ? trimmedName : trimmedCode || trimmedName;
  const title =
    trimmedName && trimmedCode && trimmedName !== trimmedCode
      ? `${trimmedName} (${trimmedCode})`
      : label;
  return { label: label || null, title: title || undefined };
}

export interface FourSourceWallTileProps {
  apiUrl: string;
  client: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  siteCode?: string;
  siteName?: string;
  camera: CameraResponse;
  cameraCountInGrid?: number;
  isSelected: boolean;
  isTourEnlargeAnchor?: boolean;
  onSelect: (cameraId: string) => void;
  onEnlarge?: (cameraId: string) => void;
  onOpenEvidence?: (cameraId: string) => void;
  enabled: boolean;
  isAiWorkPaused?: boolean;
  showModelObjects: boolean;
  filterClasses?: readonly string[];
  isApplying?: boolean;
  onPreviewUpdate?: (snapshot: ScopedWallSnapshot) => void;
  onTileUnmount?: (cameraId: string) => void;
}

export function FourSourceWallTile(props: FourSourceWallTileProps) {
  const {
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId,
    siteId,
    siteCode,
    siteName,
    camera,
    cameraCountInGrid = 4,
    isSelected,
    isTourEnlargeAnchor,
    onSelect,
    onEnlarge,
    onOpenEvidence,
    enabled,
    isAiWorkPaused = false,
    showModelObjects,
    filterClasses,
    isApplying,
    onPreviewUpdate,
    onTileUnmount,
  } = props;
  const t = useFourSourceWallTranslate();
  const trMonitor = useMonitorReadabilityTranslate();
  const scopedPreview = useScopedCameraPreview({
    apiUrl,
    client,
    token,
    sessionScope,
    siteId,
    cameraId: camera.id,
    enabled: !isAiWorkPaused && enabled && Boolean(token && sessionScope && siteId && camera.id),
    cadenceMs: isSelected ? 500 : 1000,
  });
  const zonesState = useCameraObservationZones({
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId,
    siteId,
    cameraId: camera.id,
    configurationVersion: camera.configurationVersion,
  });

  const {
    preview: rawPreview,
    status: rawStatus,
    sourceKind: rawSourceKind,
    capturedAt: rawCapturedAt,
    errorStatus,
    retry,
    isPolling,
  } = scopedPreview;
  const preview = isAiWorkPaused ? null : rawPreview;
  const status: ScopedPreviewStatus = isAiWorkPaused ? 'UNAVAILABLE' : rawStatus;
  const sourceKind = isAiWorkPaused ? null : rawSourceKind;
  const capturedAt = isAiWorkPaused ? null : rawCapturedAt;
  const effectiveErrorStatus =
    errorStatus === 401 || zonesState.errorStatus === 401 ? 401 : errorStatus;
  const retryDisabled =
    isPolling || errorStatus === 429 || errorStatus === 401 || errorStatus === 403;

  useEffect(() => {
    onPreviewUpdate?.({
      scope: { apiUrl, client, token, sessionScope, credentialId, siteId, cameraId: camera.id },
      preview,
      status,
      sourceKind,
      capturedAt,
      errorStatus: effectiveErrorStatus,
      receivedAt: Date.now(),
    });
  }, [
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId,
    siteId,
    camera.id,
    preview,
    status,
    sourceKind,
    capturedAt,
    effectiveErrorStatus,
    onPreviewUpdate,
  ]);

  useEffect(() => {
    return () => {
      onTileUnmount?.(camera.id);
    };
  }, [camera.id, onTileUnmount]);

  const isLive = status === 'LIVE' || sourceKind === 'LIVE';
  const isReplay = status === 'REPLAY' || sourceKind === 'REPLAY';
  const detectionsCount = preview?.frame.detections.length ?? 0;
  const modelObjectsCount = preview?.frame.modelObjects?.detections.length ?? 0;
  const cameraActionName = camera.name ? `${camera.name} (${camera.code})` : camera.code;
  const parsedCapturedAt = capturedAt ? new Date(capturedAt) : null;
  const formattedCapturedAt =
    parsedCapturedAt && !Number.isNaN(parsedCapturedAt.getTime())
      ? formatClockTime(parsedCapturedAt)
      : '--:--:--';
  const telemetry = resolveMonitorTelemetryState({
    isAiPaused: isAiWorkPaused,
    hasActiveAiPreview: Boolean(preview),
    detectionsCount,
    status,
    errorStatus: effectiveErrorStatus,
  });
  const singleZoneDisplay =
    zonesState.zones.length === 1 ? formatSingleLinkedZoneChip(zonesState.zones[0]) : null;
  const linkedZoneSummary =
    zonesState.zones.length === 1
      ? (singleZoneDisplay?.label ?? null)
      : zonesState.zones.length > 1
        ? trMonitor('monitor.zones.linkedCount', {
            count: Math.max(zonesState.total, zonesState.zones.length),
          })
        : null;
  const linkedZoneTitle =
    zonesState.zones.length === 1 ? singleZoneDisplay?.title : (linkedZoneSummary ?? undefined);

  const stageHeightClass =
    cameraCountInGrid === 1
      ? 'lg:h-[clamp(17.5rem,calc(100dvh-23.5rem),36rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(22rem,calc(100dvh-10rem),52rem)]'
      : cameraCountInGrid === 2
        ? 'lg:h-[clamp(15rem,calc(100dvh-21rem),26rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(20rem,calc(100dvh-10.5rem),36rem)]'
        : 'lg:h-[clamp(11.5rem,calc((100dvh-20.5rem)/2),19.5rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(15rem,calc((100dvh-10.5rem)/2),26rem)]';

  return (
    <div
      role="group"
      data-testid={`wall-tile-${camera.id}`}
      aria-label={t(isSelected ? 'ppe.wall.tileAriaFocused' : 'ppe.wall.tileAriaAvailable', {
        camera: camera.name || camera.code,
      })}
      onClick={() => onSelect(camera.id)}
      className={`relative min-w-0 rounded-xl border transition-all flex flex-col overflow-hidden cursor-pointer select-none bg-[#0B0F17] ${
        isSelected
          ? 'border-amber-400/90 ring-1 ring-amber-400/40 shadow-2xs'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="relative z-10 px-3.5 py-2.5 bg-slate-950/95 border-b border-white/10 flex flex-wrap items-center justify-between text-white gap-x-3 gap-y-1.5 pointer-events-none">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span
            title={
              camera.name && camera.code && camera.name !== camera.code
                ? `${camera.name} (${camera.code})`
                : camera.name || camera.code
            }
            className="pointer-events-auto min-w-0 flex-1 font-semibold text-sm sm:text-base tracking-tight text-white truncate"
          >
            {camera.name || camera.code}
          </span>
          {isSelected && (
            <span
              data-testid={`focused-badge-${camera.id}`}
              className="rounded-md border border-amber-400/35 bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-200 shrink-0"
            >
              {t('ppe.wall.context.focusedBadge')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
          <span
            data-testid={`wall-source-badge-${camera.id}`}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide border ${
              isAiWorkPaused
                ? 'bg-amber-500/15 text-amber-200 border-amber-500/35'
                : isLive
                  ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35'
                  : isReplay
                    ? 'bg-amber-500/15 text-amber-200 border-amber-500/35'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-emerald-400' : isReplay ? 'bg-amber-400' : 'bg-slate-400'
              }`}
            />
            {isAiWorkPaused
              ? t('ppe.badge.aiPaused')
              : isReplay
                ? t('ppe.wall.sourceReplay')
                : isLive
                  ? t('ppe.wall.sourceLive')
                  : status === 'CONNECTING'
                    ? t('ppe.wall.sourceConnecting')
                    : t('ppe.wall.sourceUnavailable')}
          </span>
          <span className="font-mono text-xs font-medium tabular-nums text-slate-300">
            {formattedCapturedAt}
          </span>
        </div>
      </div>

      <div
        data-testid={`wall-video-viewport-${camera.id}`}
        onDoubleClick={(e) => {
          if (!onEnlarge) return;
          e.stopPropagation();
          onEnlarge(camera.id);
        }}
        className={`relative aspect-video w-full lg:aspect-auto ${stageHeightClass} bg-[#070A10] overflow-hidden`}
      >
        {isAiWorkPaused ? (
          <div
            data-testid={`wall-paused-${camera.id}`}
            className="absolute inset-0 flex items-center justify-center text-white p-4 text-center"
          >
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80">
              <IconCamera className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-sm font-medium text-white">{t('ppe.viewport.pausedTitle')}</p>
            </div>
          </div>
        ) : isApplying && isSelected ? (
          <div
            data-testid={`wall-applying-${camera.id}`}
            className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center space-y-2"
          >
            <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <p className="text-sm font-semibold text-amber-300">
              {t('ppe.viewport.applyingTitle')}
            </p>
            <p className="text-xs text-slate-300">{t('ppe.wall.awaitingSnapshot')}</p>
          </div>
        ) : preview ? (
          <RealtimePreviewCanvas
            preview={preview}
            mode="ppe"
            showModelObjects={showModelObjects}
            filterClasses={filterClasses}
            hideFrameDetailsOverlay
          />
        ) : status === 'CONNECTING' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-200 p-4 text-center gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
            <p className="text-sm font-medium">
              {t('ppe.wall.connectingSnapshot', { cadence: isSelected ? '500ms' : '1s' })}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-200 p-4 text-center space-y-2">
            <IconAlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
              {t('ppe.wall.snapshotUnavailable')}
            </p>
            <span
              data-testid={`wall-failure-kind-${camera.id}`}
              className="rounded-md border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-slate-200"
            >
              {telemetry.failureKind === 'ACCESS_RESTRICTED'
                ? trMonitor('monitor.state.accessRestricted')
                : telemetry.failureKind === 'CAMERA_UNAVAILABLE'
                  ? trMonitor('monitor.state.cameraUnavailable')
                  : trMonitor('monitor.state.aiUnavailable')}
            </span>
            <p className="text-xs leading-relaxed text-slate-300 max-w-xs break-words [overflow-wrap:anywhere]">
              {telemetry.failureKind === 'ACCESS_RESTRICTED'
                ? trMonitor('monitor.state.accessRestrictedHint')
                : telemetry.failureKind === 'CAMERA_UNAVAILABLE'
                  ? trMonitor('monitor.state.cameraUnavailableHint')
                  : trMonitor('monitor.state.aiUnavailableHint')}
            </p>
            {errorStatus === 429 && (
              <p role="status" aria-live="polite" className="text-xs text-slate-300">
                {t('ppe.viewport.snapshotCooldown429')}
              </p>
            )}
            {token && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  retry();
                }}
                disabled={retryDisabled}
                className="pointer-events-auto inline-flex min-h-9 items-center rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-slate-100 transition-colors cursor-pointer mt-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('mf06.detail.retry')}
              </button>
            )}
          </div>
        )}
      </div>

      <div
        data-testid={`wall-metadata-bar-${camera.id}`}
        className="relative z-10 px-3.5 py-2.5 bg-slate-950/95 border-t border-white/10 text-white text-sm space-y-2"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span
            data-testid={`wall-people-state-${camera.id}`}
            className={`min-w-0 flex-1 leading-relaxed tabular-nums break-words [overflow-wrap:anywhere] ${
              telemetry.peopleState.kind === 'ACTIVE_COUNT'
                ? 'font-semibold text-emerald-300'
                : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                  ? 'text-slate-300'
                  : 'text-amber-300'
            }`}
          >
            {telemetry.peopleState.kind === 'ACTIVE_COUNT'
              ? t('ppe.wall.personDetectionsCount', { count: telemetry.peopleState.count })
              : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                ? t('ppe.wall.noPersonDetectionsDisclaimer')
                : telemetry.peopleState.kind === 'PAUSED'
                  ? trMonitor('monitor.people.paused')
                  : telemetry.peopleState.kind === 'CONNECTING'
                    ? trMonitor('monitor.people.connecting')
                    : trMonitor('monitor.people.unavailable')}
          </span>
          {linkedZoneSummary && (
            <span
              data-testid={`wall-zone-chip-${camera.id}`}
              title={linkedZoneTitle}
              className="pointer-events-auto max-w-[13rem] truncate rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-300 shrink-0"
            >
              {linkedZoneSummary}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
          <details
            data-testid={`wall-tile-details-${camera.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-slate-300 min-w-0 shrink-0 open:basis-full open:order-last"
          >
            <summary className="inline-flex min-h-9 items-center cursor-pointer font-medium text-sm text-slate-200 hover:text-white select-none px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 transition-colors">
              {t('ppe.common.details')}
            </summary>
            <div className="mt-2 pt-2 border-t border-white/15 space-y-2 max-h-32 overflow-y-auto overscroll-contain pr-1">
              <CameraObservationZones
                siteCode={siteCode}
                siteName={siteName}
                cameraId={camera.id}
                cameraCode={camera.code}
                cameraName={camera.name}
                isSelected={false}
                zonesState={zonesState}
              />
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-400">
                <span>
                  {t('mf06.detail.field.cameraId')} {camera.id}
                </span>
                {!isAiWorkPaused && (
                  <span>
                    {t('ppe.wall.cadenceLabel', { cadence: isSelected ? '500ms' : '1s' })}
                  </span>
                )}
                {!isAiWorkPaused && showModelObjects && modelObjectsCount > 0 && (
                  <span className="text-sky-300 font-semibold">
                    {t('ppe.wall.rawObjectsCount', { count: modelObjectsCount })}
                  </span>
                )}
              </div>
            </div>
          </details>

          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ml-auto">
            <button
              type="button"
              data-testid={`focus-btn-${camera.id}`}
              aria-label={`${t(isSelected ? 'ppe.overview.selectedAria' : 'ppe.overview.selectTitle')}: ${camera.name || camera.code}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(camera.id);
              }}
              className={`inline-flex min-h-9 items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected
                  ? 'border border-amber-400/40 bg-amber-400/15 font-semibold text-amber-200'
                  : 'border border-white/15 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {isSelected ? t('ppe.overview.selectedAria') : t('ppe.overview.selectTitle')}
            </button>

            {onEnlarge && (
              <button
                type="button"
                data-testid={`enlarge-camera-btn-${camera.id}`}
                data-tour-anchor={
                  (isTourEnlargeAnchor ?? isSelected) ? 'monitor-enlarge' : undefined
                }
                aria-label={`${t('ppe.wall.enlargeCameraBtn')}: ${cameraActionName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEnlarge(camera.id);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconMaximize className="w-4 h-4 shrink-0" />
                <span>{t('ppe.wall.enlargeCameraBtn')}</span>
              </button>
            )}

            {onOpenEvidence && (
              <button
                type="button"
                data-testid={`tile-evidence-btn-${camera.id}`}
                aria-label={`${t('ppe.common.evidence')}: ${cameraActionName}`}
                aria-haspopup="dialog"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenEvidence(camera.id);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-white/15 bg-white/5 text-slate-100 hover:bg-white/15 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconShield className="w-4 h-4 shrink-0" />
                <span>{t('ppe.common.evidence')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface FourSourceWallProps {
  apiUrl: string;
  client: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  siteCode?: string;
  siteName?: string;
  selectedCameraId: string;
  onSelectCamera: (cameraId: string) => void;
  onEnlargeCamera?: (cameraId: string) => void;
  onOpenEvidence?: (cameraId: string) => void;
  cameras: CameraResponse[];
  enabled: boolean;
  isAiWorkPaused?: boolean;
  showModelObjects: boolean;
  filterClasses?: readonly string[];
  getFilterClassesForCamera?: (camera: CameraResponse) => readonly string[] | undefined;
  isApplying?: boolean;
  onTilePreviewUpdate?: (snapshot: ScopedWallSnapshot) => void;
  onTileUnmount?: (cameraId: string) => void;
}

export function FourSourceWall(props: FourSourceWallProps) {
  const {
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId,
    siteId,
    siteCode,
    siteName,
    selectedCameraId,
    onSelectCamera,
    onEnlargeCamera,
    onOpenEvidence,
    cameras,
    enabled,
    isAiWorkPaused = false,
    showModelObjects,
    filterClasses,
    getFilterClassesForCamera,
    isApplying,
    onTilePreviewUpdate,
    onTileUnmount,
  } = props;
  const t = useFourSourceWallTranslate();
  const activeCameras = useMemo(() => cameras.slice(0, 4), [cameras]);

  if (activeCameras.length === 0) {
    return (
      <div
        data-testid="wall-empty-state"
        className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-2 shadow-xs"
      >
        <p className="text-sm font-semibold text-slate-800">{t('ppe.wall.emptyTitle')}</p>
        <p className="text-xs sm:text-sm text-slate-600">{t('ppe.wall.emptyDesc')}</p>
      </div>
    );
  }

  const hasSelectedInWall = activeCameras.some((c) => c.id === selectedCameraId);
  const gridColumnsClass =
    activeCameras.length === 1 ? 'grid-cols-1 gap-4' : 'grid-cols-1 lg:grid-cols-2 gap-3.5';

  return (
    <div
      data-testid="four-source-wall-grid"
      className={`grid ${gridColumnsClass} items-start w-full min-w-0`}
    >
      {activeCameras.map((camera, idx) => (
        <FourSourceWallTile
          key={camera.id}
          apiUrl={apiUrl}
          client={client}
          token={token}
          sessionScope={sessionScope}
          credentialId={credentialId}
          siteId={siteId}
          siteCode={siteCode}
          siteName={siteName}
          camera={camera}
          cameraCountInGrid={activeCameras.length}
          isSelected={camera.id === selectedCameraId}
          isTourEnlargeAnchor={hasSelectedInWall ? camera.id === selectedCameraId : idx === 0}
          onSelect={onSelectCamera}
          onEnlarge={onEnlargeCamera}
          onOpenEvidence={onOpenEvidence}
          enabled={enabled && !isAiWorkPaused}
          isAiWorkPaused={isAiWorkPaused}
          showModelObjects={showModelObjects}
          filterClasses={
            getFilterClassesForCamera ? getFilterClassesForCamera(camera) : filterClasses
          }
          isApplying={Boolean(isApplying && camera.id === selectedCameraId)}
          onPreviewUpdate={onTilePreviewUpdate}
          onTileUnmount={onTileUnmount}
        />
      ))}
    </div>
  );
}
