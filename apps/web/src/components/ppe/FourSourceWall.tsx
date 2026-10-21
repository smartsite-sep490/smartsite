import React, { useEffect, useMemo } from 'react';
import type { CameraResponse } from '@smartsite/contracts/management';
import {
  useScopedCameraPreview,
  type ScopedPreviewStatus,
} from '../cameras/useScopedCameraPreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import { IconAlertTriangle, IconCamera, IconMaximize, IconShield } from '../icons';
import { formatClockTime } from '../cameras/monitoringUtils';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { useLocale } from '../../i18n/ppe-locale';
import { CameraObservationZones } from './CameraObservationZones';
import { useCameraObservationZones } from './useCameraObservationZones';

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

export function FourSourceWallTile({
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
}: FourSourceWallTileProps) {
  const { t, locale } = useLocale();
  const isVi = locale === 'vi';

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
    error,
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

  // Sync latest frame to parent carrying full scope metadata and errorStatus for 401 propagation
  useEffect(() => {
    onPreviewUpdate?.({
      scope: {
        apiUrl,
        client,
        token,
        sessionScope,
        credentialId,
        siteId,
        cameraId: camera.id,
      },
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

  // Immediately notify parent upon tile unmount to drop snapshot without delay
  useEffect(() => {
    return () => {
      onTileUnmount?.(camera.id);
    };
  }, [camera.id, onTileUnmount]);

  const isLive = status === 'LIVE' || sourceKind === 'LIVE';
  const isReplay = status === 'REPLAY' || sourceKind === 'REPLAY';
  const detectionsCount = preview?.frame.detections.length ?? 0;
  const modelObjectsCount = preview?.frame.modelObjects?.detections.length ?? 0;

  return (
    <div
      role="group"
      data-testid={`wall-tile-${camera.id}`}
      aria-label={t(isSelected ? 'ppe.wall.tileAriaFocused' : 'ppe.wall.tileAriaAvailable', {
        camera: camera.name || camera.code,
      })}
      onClick={() => onSelect(camera.id)}
      className={`relative rounded-2xl border transition-all flex flex-col justify-between overflow-hidden cursor-pointer select-none bg-[#0F141C] ${
        isSelected
          ? 'border-[#0F172A] ring-2 ring-[#0F172A]/40 shadow-sm'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Header Bar — Concise camera display name + compact status */}
      <div className="relative z-10 px-3 py-2 bg-black/60 flex items-center justify-between text-white gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 min-w-0 pr-1">
          <span
            title={`${camera.name || camera.code} (${camera.code})`}
            className="font-bold text-xs tracking-wide text-white truncate"
          >
            {camera.name || camera.code}
          </span>
          {isSelected && (
            <span
              data-testid={`focused-badge-${camera.id}`}
              className="bg-[#111111] text-white border border-white/20 text-xs font-bold px-2 py-0.5 rounded uppercase flex-shrink-0"
            >
              {t('ppe.wall.context.focusedBadge')}
            </span>
          )}
        </div>

        {/* Factual Source Badge (LIVE / REPLAY / UNAVAILABLE / AI WORK PAUSED) */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            data-testid={`wall-source-badge-${camera.id}`}
            className={`px-2 py-0.5 rounded text-xs font-bold tracking-wider uppercase border ${
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
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive ? 'bg-red-400' : isReplay ? 'bg-amber-400' : 'bg-slate-400'
              }`}
            />
            <span className="font-mono text-xs font-semibold text-white/90">
              {capturedAt ? formatClockTime(new Date(capturedAt)) : '--:--:--'}
            </span>
          </div>
        </div>
      </div>

      {/* Video Canvas Viewport — Primary camera image, uniform 16:9 aspect ratio, bounded height */}
      <div className="relative aspect-video w-full max-h-[260px] bg-[#0F141C]">
        {isAiWorkPaused ? (
          <div
            data-testid={`wall-paused-${camera.id}`}
            className="absolute inset-0 flex items-center justify-center text-white p-4 text-center"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80">
              <IconCamera className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs font-semibold text-white">{t('ppe.viewport.pausedTitle')}</p>
            </div>
          </div>
        ) : isApplying && isSelected ? (
          <div
            data-testid={`wall-applying-${camera.id}`}
            className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center space-y-2"
          >
            <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-1" />
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
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center">
            <div className="w-6 h-6 rounded-full border-2 border-slate-400 border-t-transparent animate-spin mb-2" />
            <p className="text-xs font-semibold">
              {t('ppe.wall.connectingSnapshot', { cadence: isSelected ? '500ms' : '1s' })}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center space-y-2">
            <IconAlertTriangle className="w-6 h-6 text-amber-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
              {t('ppe.wall.snapshotUnavailable')}
            </p>
            <p className="text-xs text-white/60 max-w-[200px] truncate">
              {error || t('ppe.wall.noActiveSnapshot')}
            </p>
            {errorStatus === 429 && (
              <p role="status" aria-live="polite" className="text-xs text-white/70">
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
                className="pointer-events-auto rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#111111] hover:bg-slate-100 transition-colors cursor-pointer mt-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('mf06.detail.retry')}
              </button>
            )}
          </div>
        )}

        {/* Empty live frame indicator: offline/empty cannot say safe — Strict Person detections terminology */}
        {preview && detectionsCount === 0 && (
          <div className="absolute inset-x-2 bottom-8 flex justify-center pointer-events-none z-10">
            <div className="bg-black/70 px-2.5 py-1 rounded text-white/80 text-xs font-medium text-center truncate max-w-full">
              {t('ppe.wall.noPersonDetectionsDisclaimer')}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Summary Bar & Native Details Disclosure */}
      <div className="relative z-10 px-3 py-2 bg-black/60 flex flex-col gap-2 text-white text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-white/80 pointer-events-auto">
            {!isAiWorkPaused &&
              (detectionsCount > 0 ? (
                <span className="text-emerald-300 font-semibold text-xs">
                  {t('ppe.wall.personDetectionsCount', { count: detectionsCount })}
                </span>
              ) : (
                <span className="text-white/60 text-xs">{t('ppe.wall.noPersonDetections')}</span>
              ))}

            <details
              data-testid={`wall-tile-details-${camera.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-white/80"
            >
              <summary className="inline-flex items-center cursor-pointer font-semibold text-xs text-white/90 hover:text-white select-none px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
                {isVi ? 'Chi tiết' : 'Details'}
              </summary>
              <div className="mt-2 pt-2 border-t border-white/15 space-y-1.5">
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
                  <span>ID: {camera.id}</span>
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
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              data-testid={`focus-btn-${camera.id}`}
              aria-label={`${t(isSelected ? 'ppe.overview.selectedAria' : 'ppe.overview.selectTitle')}: ${camera.name || camera.code}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(camera.id);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected ? 'bg-white text-[#111111]' : 'bg-white/20 text-white hover:bg-white/40'
              }`}
            >
              {isSelected ? t('ppe.overview.selectedAria') : t('ppe.overview.selectTitle')}
            </button>

            {onEnlarge && (
              <button
                type="button"
                data-testid={`enlarge-camera-btn-${camera.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEnlarge(camera.id);
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/20 text-white hover:bg-white/40 transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconMaximize className="w-3.5 h-3.5" />
                <span>{isVi ? 'Phóng to camera' : 'Enlarge camera'}</span>
              </button>
            )}

            {onOpenEvidence && (
              <button
                type="button"
                data-testid={`tile-evidence-btn-${camera.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenEvidence(camera.id);
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/20 text-white hover:bg-white/40 transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <IconShield className="w-3.5 h-3.5" />
                <span>{isVi ? 'Bằng chứng' : 'Evidence'}</span>
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

export function FourSourceWall({
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
}: FourSourceWallProps) {
  const { t } = useLocale();
  // Maximum 4 actual authorized preview cameras; never fabricate a fourth feed
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

  // Calculate unassigned slots if fewer than 4 cameras (no fabricated feeds)
  const unassignedCount = Math.max(0, 4 - activeCameras.length);

  return (
    <div
      data-testid="four-source-wall-grid"
      className="grid grid-cols-1 md:grid-cols-2 gap-3.5 w-full min-w-0"
    >
      {activeCameras.map((camera) => (
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

      {/* Explicit placeholder for unassigned source slots — never fabricated */}
      {Array.from({ length: unassignedCount }).map((_, idx) => {
        const slotNumber = activeCameras.length + idx + 1;
        return (
          <div
            key={`unassigned-slot-${slotNumber}`}
            data-testid={`wall-unassigned-slot-${slotNumber}`}
            className="rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] aspect-video max-h-[260px] flex flex-col items-center justify-center p-4 text-center select-none"
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
