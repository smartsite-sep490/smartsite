import React, { useEffect, useMemo } from 'react';
import type { CameraResponse } from '@smartsite/contracts/management';
import {
  useScopedCameraPreview,
  type ScopedPreviewStatus,
} from '../cameras/useScopedCameraPreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import { IconAlertTriangle } from '../icons';
import { formatClockTime } from '../cameras/monitoringUtils';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
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
  enabled: boolean;
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
  enabled,
  showModelObjects,
  filterClasses,
  isApplying,
  onPreviewUpdate,
  onTileUnmount,
}: FourSourceWallTileProps) {
  const scopedPreview = useScopedCameraPreview({
    apiUrl,
    client,
    token,
    sessionScope,
    siteId,
    cameraId: camera.id,
    enabled: enabled && Boolean(token && sessionScope && siteId && camera.id),
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

  const { preview, status, sourceKind, capturedAt, error, errorStatus, retry, isPolling } =
    scopedPreview;
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
      data-testid={`wall-tile-${camera.id}`}
      aria-label={`Camera ${camera.name || camera.code} (${isSelected ? 'focused' : 'available'})`}
      onClick={() => onSelect(camera.id)}
      className={`relative rounded-2xl border transition-all flex flex-col justify-between overflow-hidden cursor-pointer select-none bg-[#0F141C] ${
        isSelected
          ? 'border-[#0F172A] ring-2 ring-[#0F172A]/40 shadow-sm'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Header Bar — Flat minimalist overlay without gradient */}
      <div className="relative z-10 px-3 py-2 bg-black/60 flex items-start justify-between text-white gap-2 pointer-events-none">
        <CameraObservationZones
          siteCode={siteCode}
          siteName={siteName}
          cameraId={camera.id}
          cameraCode={camera.code}
          cameraName={camera.name}
          isSelected={isSelected}
          zonesState={zonesState}
        />

        {/* Factual Source Badge (LIVE / REPLAY / UNAVAILABLE) */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            data-testid={`wall-source-badge-${camera.id}`}
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border ${
              isLive
                ? 'bg-red-500/20 text-red-200 border-red-500/40'
                : isReplay
                  ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                  : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
            }`}
          >
            {isReplay
              ? 'REPLAY'
              : isLive
                ? 'LIVE'
                : status === 'CONNECTING'
                  ? 'CONNECTING'
                  : 'UNAVAILABLE'}
          </span>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive ? 'bg-red-400' : isReplay ? 'bg-amber-400' : 'bg-slate-400'
              }`}
            />
            <span className="font-mono text-[9px] font-semibold text-white/90">
              {capturedAt ? formatClockTime(new Date(capturedAt)) : '--:--:--'}
            </span>
          </div>
        </div>
      </div>

      {/* Video Canvas Viewport */}
      <div className="relative aspect-video w-full flex-1 min-h-[160px] bg-[#0F141C]">
        {isApplying && isSelected ? (
          <div
            data-testid={`wall-applying-${camera.id}`}
            className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center space-y-2"
          >
            <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-1" />
            <p className="text-[11px] font-semibold text-amber-300">Applying Demo Region...</p>
            <p className="text-[10px] text-white/50">Awaiting fresh camera snapshot...</p>
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
            <p className="text-[11px] font-semibold">
              Connecting ({isSelected ? '500ms' : '1s'} snapshot)...
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center space-y-2">
            <IconAlertTriangle className="w-6 h-6 text-amber-400" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Snapshot Unavailable
            </p>
            <p className="text-[10px] text-white/60 max-w-[200px] truncate">
              {error || 'No active camera snapshot available.'}
            </p>
            {errorStatus === 429 && (
              <p role="status" aria-live="polite" className="text-[10px] text-white/70">
                Automatic retry resumes after server cooldown.
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
                className="pointer-events-auto rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-[#111111] hover:bg-slate-100 transition-colors cursor-pointer mt-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Empty live frame indicator: offline/empty cannot say safe — Strict Person detections terminology */}
        {preview && detectionsCount === 0 && (
          <div className="absolute inset-x-2 bottom-8 flex justify-center pointer-events-none z-10">
            <div className="bg-black/70 px-2 py-1 rounded text-white/80 text-[10px] font-medium text-center truncate max-w-full">
              No Person detections · Zero detections do not certify safety clearance
            </div>
          </div>
        )}
      </div>

      {/* Bottom Summary Bar — Flat minimalist overlay without gradient */}
      <div className="relative z-10 px-3 py-1.5 bg-black/60 flex items-center justify-between text-white text-[10px] pointer-events-none">
        <div className="flex items-center gap-2 text-white/70">
          <span>Cadence: {isSelected ? '500ms' : '1s'}</span>
          {detectionsCount > 0 ? (
            <span className="text-emerald-300 font-semibold">
              {detectionsCount} Person detection(s)
            </span>
          ) : (
            <span className="text-white/50">No Person detections</span>
          )}
          {showModelObjects && modelObjectsCount > 0 && (
            <span className="text-sky-300 font-semibold">{modelObjectsCount} raw object(s)</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            data-testid={`focus-btn-${camera.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(camera.id);
            }}
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors cursor-pointer ${
              isSelected ? 'bg-white text-[#111111]' : 'bg-white/20 text-white hover:bg-white/40'
            }`}
          >
            {isSelected ? 'Active' : 'Focus'}
          </button>
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
  cameras: CameraResponse[];
  enabled: boolean;
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
  cameras,
  enabled,
  showModelObjects,
  filterClasses,
  getFilterClassesForCamera,
  isApplying,
  onTilePreviewUpdate,
  onTileUnmount,
}: FourSourceWallProps) {
  // Maximum 4 actual authorized preview cameras; never fabricate a fourth feed
  const activeCameras = useMemo(() => cameras.slice(0, 4), [cameras]);

  if (activeCameras.length === 0) {
    return (
      <div
        data-testid="wall-empty-state"
        className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center space-y-2 shadow-sm"
      >
        <p className="text-sm font-semibold text-slate-800">
          Chưa có camera khả dụng cho công trường này
        </p>
        <p className="text-xs text-slate-500">
          Vui lòng chọn công trường khác hoặc liên hệ quản trị viên để cấp quyền camera.
        </p>
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
          enabled={enabled}
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
            className="rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] aspect-video min-h-[160px] flex flex-col items-center justify-center p-4 text-center select-none"
          >
            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center text-slate-600 mb-2 font-mono text-xs font-semibold">
              {slotNumber}
            </div>
            <p className="text-xs font-semibold text-slate-700">
              Kênh {slotNumber} · Chưa chỉ định
            </p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-[220px]">
              Chưa có nguồn camera được phân quyền. Hệ thống không tạo nguồn mô phỏng.
            </p>
          </div>
        );
      })}
    </div>
  );
}
