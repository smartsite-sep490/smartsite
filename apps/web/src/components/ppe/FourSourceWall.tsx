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
  const linkedZoneSummary =
    zonesState.zones.length === 1
      ? zonesState.zones[0]?.code
      : zonesState.zones.length > 1
        ? trMonitor('monitor.zones.linkedCount', {
            count: Math.max(zonesState.total, zonesState.zones.length),
          })
        : null;

  return (
    <div
      role="group"
      data-testid={`wall-tile-${camera.id}`}
      aria-label={t(isSelected ? 'ppe.wall.tileAriaFocused' : 'ppe.wall.tileAriaAvailable', {
        camera: camera.name || camera.code,
      })}
      onClick={() => onSelect(camera.id)}
      className={`relative min-w-0 rounded-xl border transition-all flex flex-col overflow-hidden cursor-pointer select-none bg-[#0F141C] ${
        isSelected
          ? 'border-[#0F172A] ring-2 ring-[#0F172A]/40 shadow-sm'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="relative z-10 px-2.5 py-1.5 bg-slate-950/90 border-b border-white/10 flex flex-wrap items-center justify-between text-white gap-1.5 pointer-events-none">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
          {camera.code && camera.name && camera.name !== camera.code && (
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-200 flex-shrink-0">
              {camera.code}
            </span>
          )}
          <span
            title={`${camera.name || camera.code} (${camera.code})`}
            className="font-bold text-xs tracking-wide text-white truncate"
          >
            {camera.name || camera.code}
          </span>
          {linkedZoneSummary && (
            <span
              data-testid={`wall-zone-chip-${camera.id}`}
              className="hidden sm:inline-flex items-center rounded border border-sky-400/30 bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-200 flex-shrink-0"
            >
              {linkedZoneSummary}
            </span>
          )}
          {isSelected && (
            <span
              data-testid={`focused-badge-${camera.id}`}
              className="bg-[#111111] text-white border border-white/20 text-[11px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0"
            >
              {t('ppe.wall.context.focusedBadge')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            data-testid={`wall-source-badge-${camera.id}`}
            className={`px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase border ${
              isAiWorkPaused
                ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                : isLive
                  ? 'bg-red-500/20 text-red-200 border-red-500/40'
                  : isReplay
                    ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                    : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
            }`}
          >
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
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive ? 'bg-red-400' : isReplay ? 'bg-amber-400' : 'bg-slate-400'
              }`}
            />
            <span className="font-mono text-[11px] font-semibold text-white/90">
              {formattedCapturedAt}
            </span>
          </div>
        </div>
      </div>

      <div
        data-testid={`wall-video-viewport-${camera.id}`}
        className="relative aspect-video w-full lg:aspect-auto lg:h-[clamp(9.25rem,calc((100vh-22rem)/2),13.75rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(11rem,calc((100vh-10.5rem)/2),24rem)] bg-[#0F141C] overflow-hidden"
      >
        {isAiWorkPaused ? (
          <div
            data-testid={`wall-paused-${camera.id}`}
            className="absolute inset-0 flex items-center justify-center text-white p-3 text-center"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80">
              <IconCamera className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs font-semibold text-white">{t('ppe.viewport.pausedTitle')}</p>
            </div>
          </div>
        ) : isApplying && isSelected ? (
          <div
            data-testid={`wall-applying-${camera.id}`}
            className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-3 text-center space-y-1.5"
          >
            <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-0.5" />
            <p className="text-xs font-semibold text-amber-300">
              {t('ppe.viewport.applyingTitle')}
            </p>
            <p className="text-xs text-white/50">{t('ppe.wall.awaitingSnapshot')}</p>
          </div>
        ) : preview ? (
          <RealtimePreviewCanvas
            preview={preview}
            mode="ppe"
            showModelObjects={showModelObjects}
            filterClasses={filterClasses}
          />
        ) : status === 'CONNECTING' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-3 text-center">
            <div className="w-5 h-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin mb-1.5" />
            <p className="text-xs font-semibold">
              {t('ppe.wall.connectingSnapshot', { cadence: isSelected ? '500ms' : '1s' })}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-2.5 text-center space-y-1">
            <IconAlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              {t('ppe.wall.snapshotUnavailable')}
            </p>
            <span
              data-testid={`wall-failure-kind-${camera.id}`}
              className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200"
            >
              {telemetry.failureKind === 'ACCESS_RESTRICTED'
                ? trMonitor('monitor.state.accessRestricted')
                : telemetry.failureKind === 'CAMERA_UNAVAILABLE'
                  ? trMonitor('monitor.state.cameraUnavailable')
                  : trMonitor('monitor.state.aiUnavailable')}
            </span>
            <p className="text-[11px] leading-snug text-white/65 max-w-xs break-words [overflow-wrap:anywhere]">
              {telemetry.failureKind === 'ACCESS_RESTRICTED'
                ? trMonitor('monitor.state.accessRestrictedHint')
                : telemetry.failureKind === 'CAMERA_UNAVAILABLE'
                  ? trMonitor('monitor.state.cameraUnavailableHint')
                  : trMonitor('monitor.state.aiUnavailableHint')}
            </p>
            {errorStatus === 429 && (
              <p role="status" aria-live="polite" className="text-[11px] text-white/70">
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
                className="pointer-events-auto rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#111111] hover:bg-slate-100 transition-colors cursor-pointer mt-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('mf06.detail.retry')}
              </button>
            )}
          </div>
        )}
      </div>

      <div
        data-testid={`wall-metadata-bar-${camera.id}`}
        className="relative z-10 px-2.5 py-1.5 bg-slate-950/90 border-t border-white/10 text-white text-xs"
      >
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          <span
            data-testid={`wall-people-state-${camera.id}`}
            className={`min-w-0 flex-[1_1_8rem] rounded-md border px-2 py-0.5 text-[11px] leading-tight font-medium break-words [overflow-wrap:anywhere] ${
              telemetry.peopleState.kind === 'ACTIVE_COUNT'
                ? 'border-emerald-400/30 bg-emerald-500/15 font-semibold text-emerald-200'
                : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                  ? 'border-white/15 bg-white/10 text-slate-200'
                  : 'border-amber-400/25 bg-amber-500/10 text-amber-200'
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

          <details
            data-testid={`wall-tile-details-${camera.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-white/80 min-w-0 shrink-0 open:basis-full open:order-last"
          >
            <summary className="inline-flex items-center cursor-pointer font-semibold text-xs text-white/90 hover:text-white select-none px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
              {t('ppe.common.details')}
            </summary>
            <div className="mt-1.5 pt-1.5 border-t border-white/15 space-y-1.5 max-h-28 overflow-y-auto overscroll-contain pr-1">
              <CameraObservationZones
                siteCode={siteCode}
                siteName={siteName}
                cameraId={camera.id}
                cameraCode={camera.code}
                cameraName={camera.name}
                isSelected={false}
                zonesState={zonesState}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-white/60">
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

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 ml-auto">
            <button
              type="button"
              data-testid={`focus-btn-${camera.id}`}
              aria-label={`${t(isSelected ? 'ppe.overview.selectedAria' : 'ppe.overview.selectTitle')}: ${camera.name || camera.code}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(camera.id);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected ? 'bg-white text-[#111111]' : 'bg-white/20 text-white hover:bg-white/40'
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
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/20 text-white hover:bg-white/40 transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconMaximize className="w-3.5 h-3.5" />
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
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/20 text-white hover:bg-white/40 transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconShield className="w-3.5 h-3.5" />
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
        className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center space-y-2 shadow-sm"
      >
        <p className="text-sm font-semibold text-slate-800">{t('ppe.wall.emptyTitle')}</p>
        <p className="text-xs text-slate-500">{t('ppe.wall.emptyDesc')}</p>
      </div>
    );
  }

  const unassignedCount = Math.max(0, 4 - activeCameras.length);
  const hasSelectedInWall = activeCameras.some((c) => c.id === selectedCameraId);

  return (
    <div
      data-testid="four-source-wall-grid"
      className="grid grid-cols-1 lg:grid-cols-2 items-start gap-2.5 w-full min-w-0"
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

      {Array.from({ length: unassignedCount }).map((_, idx) => {
        const slotNumber = activeCameras.length + idx + 1;
        return (
          <div
            key={`unassigned-slot-${slotNumber}`}
            data-testid={`wall-unassigned-slot-${slotNumber}`}
            className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] aspect-video w-full lg:aspect-auto lg:h-[clamp(13rem,calc((100vh-17.5rem)/2),17.75rem)] flex flex-col items-center justify-center p-4 text-center select-none"
          >
            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center text-slate-600 mb-2 font-mono text-xs font-semibold">
              {slotNumber}
            </div>
            <p className="text-xs font-semibold text-slate-700">
              {t('ppe.wall.unassignedSlotTitle', { slot: slotNumber })}
            </p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-[220px]">
              {t('ppe.wall.unassignedSlotDesc')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
