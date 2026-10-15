import React from 'react';
import { useLocale } from '../../i18n/ppe-locale';
import type { CameraObservationZonesState } from './useCameraObservationZones';

export interface CameraObservationZonesProps {
  siteCode?: string;
  siteName?: string;
  cameraId: string;
  cameraCode: string;
  cameraName: string;
  isSelected: boolean;
  zonesState: CameraObservationZonesState;
}

export function CameraObservationZones({
  siteCode,
  siteName,
  cameraId,
  cameraCode,
  cameraName,
  isSelected,
  zonesState,
}: CameraObservationZonesProps) {
  const { t } = useLocale();

  const trimmedSiteCode = siteCode?.trim() ?? '';
  const trimmedSiteName = siteName?.trim() ?? '';
  const hasSiteIdentity = Boolean(trimmedSiteCode || trimmedSiteName);

  const trimmedCameraCode = cameraCode.trim();
  const trimmedCameraName = cameraName.trim();
  const showDistinctCameraCodeAndName =
    Boolean(trimmedCameraCode && trimmedCameraName) && trimmedCameraCode !== trimmedCameraName;

  return (
    <div className="flex flex-col gap-1 min-w-0 pr-1">
      {/* Camera Identity Row */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {showDistinctCameraCodeAndName ? (
          <>
            <span className="font-mono font-bold text-[11px] tracking-wide text-white/90 break-words">
              {trimmedCameraCode}
            </span>
            <span className="text-white/50 text-[10px]">·</span>
            <span className="font-bold text-xs tracking-wide text-white break-words min-w-0">
              {trimmedCameraName}
            </span>
          </>
        ) : (
          <span className="font-bold text-xs tracking-wide text-white break-words min-w-0">
            {trimmedCameraName || trimmedCameraCode}
          </span>
        )}
        {isSelected && (
          <span
            data-testid={`focused-badge-${cameraId}`}
            className="bg-[#111111] text-white border border-white/20 text-[9px] font-bold px-1.5 py-0.2 rounded uppercase flex-shrink-0"
          >
            {t('ppe.wall.context.focusedBadge')}
          </span>
        )}
      </div>

      {/* Site Context Row */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/80 min-w-0">
        <span className="font-semibold uppercase tracking-wider text-white/60">
          {t('ppe.wall.context.siteLabel')}:
        </span>
        {hasSiteIdentity ? (
          <>
            {trimmedSiteCode && (
              <span className="font-mono font-semibold text-white/90 break-words">
                {trimmedSiteCode}
              </span>
            )}
            {trimmedSiteCode && trimmedSiteName && trimmedSiteCode !== trimmedSiteName && (
              <span className="text-white/50">·</span>
            )}
            {trimmedSiteName && trimmedSiteName !== trimmedSiteCode && (
              <span className="font-medium text-white/85 break-words min-w-0">
                {trimmedSiteName}
              </span>
            )}
          </>
        ) : (
          <span className="font-medium text-white/70 break-words">
            {t('ppe.context.siteScopeFallback')}
          </span>
        )}
      </div>

      {/* Observation Zones Row */}
      <div
        data-testid={`wall-zones-${cameraId}`}
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-1.5 text-[10px] min-w-0"
      >
        <span className="font-semibold uppercase tracking-wider text-white/60">
          {t('ppe.wall.context.zonesLabel')}:
        </span>

        {zonesState.isInitialLoading ? (
          <span className="text-white/75 font-medium break-words">
            {t('ppe.wall.context.loadingZones')}
          </span>
        ) : zonesState.isBaseError ? (
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-amber-300 font-medium break-words">
              {zonesState.errorStatus === 403
                ? t('ppe.wall.context.zonesAccessDenied')
                : t('ppe.wall.context.zonesUnavailable')}
            </span>
            {zonesState.errorStatus !== 401 &&
              zonesState.errorStatus !== 403 &&
              zonesState.errorStatus !== 429 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    zonesState.retryBase();
                  }}
                  className="pointer-events-auto rounded bg-white/15 hover:bg-white/25 px-1.5 py-0.5 text-[9px] font-semibold text-white transition-colors cursor-pointer"
                >
                  {t('ppe.wall.context.retryZones')}
                </button>
              )}
          </div>
        ) : zonesState.isTrueEmpty ? (
          <span className="text-white/70 font-medium break-words">
            {t('ppe.wall.context.noZonesLinked')}
          </span>
        ) : (
          <>
            {zonesState.zones.map((zone) => (
              <span
                key={zone.id.toLowerCase()}
                className="inline-flex flex-wrap items-center gap-1 rounded bg-white/10 border border-white/15 px-1.5 py-0.5 text-[10px] text-white/95 min-w-0 break-words"
              >
                <span className="font-mono font-semibold text-white break-words">{zone.code}</span>
                {zone.name !== zone.code && (
                  <>
                    <span className="text-white/50">·</span>
                    <span className="font-medium break-words min-w-0">{zone.name}</span>
                  </>
                )}
              </span>
            ))}

            {zonesState.unresolvedRegionCount > 0 && (
              <span className="inline-flex items-center rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 break-words">
                {t('ppe.wall.context.unresolvedZones', {
                  count: zonesState.unresolvedRegionCount,
                })}
              </span>
            )}

            {zonesState.isNextPageError && (
              <span className="text-amber-300 font-medium break-words">
                {t('ppe.wall.context.partialLoadError', {
                  loaded: zonesState.rawLoadedCount,
                  total: zonesState.total,
                })}
              </span>
            )}

            {zonesState.canLoadMore && (
              <button
                type="button"
                disabled={zonesState.isFetchingNextPage}
                onClick={(e) => {
                  e.stopPropagation();
                  zonesState.loadMore();
                }}
                className="pointer-events-auto rounded bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed px-1.5 py-0.5 text-[9px] font-semibold text-white transition-colors cursor-pointer"
              >
                {zonesState.isFetchingNextPage
                  ? t('ppe.wall.context.loadingMoreZones')
                  : t('ppe.wall.context.loadMoreZones')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
