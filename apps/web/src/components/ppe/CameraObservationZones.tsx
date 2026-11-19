import React from 'react';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { registerCameraObservationZonesCatalog } from './camera-observation-zones-catalog';
import { useMonitorReadabilityTranslate } from './monitor-readability';
import type { CameraObservationZonesState, ObservationZoneItem } from './useCameraObservationZones';

registerCameraObservationZonesCatalog();

const UUID_SUBSTRING_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CameraObservationZonesProps {
  siteCode?: string;
  siteName?: string;
  cameraId: string;
  cameraCode: string;
  cameraName: string;
  isSelected: boolean;
  zonesState: CameraObservationZonesState;
  showCameraAndSiteRows?: boolean;
  maxInlineZones?: number;
}

function renderZoneChip(zone: ObservationZoneItem) {
  const trimmedName = zone.name.trim();
  const trimmedCode = zone.code.trim();
  const isUuidCode = UUID_SUBSTRING_RE.test(trimmedCode);
  const primaryLabel = trimmedName || trimmedCode;
  const showSecondaryCode =
    Boolean(trimmedName && trimmedCode && trimmedName !== trimmedCode) && !isUuidCode;
  const chipTitle = showSecondaryCode ? `${trimmedName} (${trimmedCode})` : primaryLabel;

  return (
    <span
      key={zone.id.toLowerCase()}
      title={chipTitle || undefined}
      className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-md bg-white/10 border border-white/15 px-2 py-0.5 text-xs text-white/95 break-words [overflow-wrap:anywhere]"
    >
      <span className="font-medium text-white min-w-0 break-words [overflow-wrap:anywhere]">
        {primaryLabel}
      </span>
      {showSecondaryCode && (
        <>
          <span className="text-white/50">·</span>
          <span className="font-mono font-semibold text-white/85 break-words">{trimmedCode}</span>
        </>
      )}
    </span>
  );
}

export function CameraObservationZones({
  siteCode,
  siteName,
  cameraId,
  cameraCode,
  cameraName,
  isSelected,
  zonesState,
  showCameraAndSiteRows = true,
  maxInlineZones,
}: CameraObservationZonesProps) {
  registerCameraObservationZonesCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const trMonitor = useMonitorReadabilityTranslate();

  const trimmedSiteCode = siteCode?.trim() ?? '';
  const trimmedSiteName = siteName?.trim() ?? '';
  const hasSiteIdentity = Boolean(trimmedSiteCode || trimmedSiteName);

  const trimmedCameraCode = cameraCode.trim();
  const trimmedCameraName = cameraName.trim();
  const showDistinctCameraCodeAndName =
    Boolean(trimmedCameraCode && trimmedCameraName) && trimmedCameraCode !== trimmedCameraName;

  const hasOverflowZones =
    typeof maxInlineZones === 'number' &&
    maxInlineZones > 0 &&
    zonesState.zones.length > maxInlineZones;
  const inlineZones = hasOverflowZones
    ? zonesState.zones.slice(0, maxInlineZones)
    : zonesState.zones;
  const overflowZones = hasOverflowZones ? zonesState.zones.slice(maxInlineZones) : [];

  return (
    <div className="flex flex-col gap-1.5 min-w-0 max-w-full pr-1 text-xs">
      {showCameraAndSiteRows && (
        <>
          {/* Camera Identity Row */}
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {showDistinctCameraCodeAndName ? (
              <>
                <span className="font-mono font-semibold text-xs tracking-wide text-white/90 break-words">
                  {trimmedCameraCode}
                </span>
                <span className="text-white/50 text-xs">·</span>
                <span className="font-semibold text-xs tracking-wide text-white break-words min-w-0">
                  {trimmedCameraName}
                </span>
              </>
            ) : (
              <span className="font-semibold text-xs tracking-wide text-white break-words min-w-0">
                {trimmedCameraName || trimmedCameraCode}
              </span>
            )}
            {isSelected && (
              <span
                data-testid={`focused-badge-${cameraId}`}
                className="bg-[#111111] text-white border border-white/20 text-xs font-semibold px-2 py-0.5 rounded flex-shrink-0"
              >
                {t('ppe.wall.context.focusedBadge')}
              </span>
            )}
          </div>

          {/* Site Context Row */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/80 min-w-0">
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
        </>
      )}

      {/* Observation Zones Row */}
      <div
        data-testid={`wall-zones-${cameraId}`}
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-1.5 text-xs min-w-0 max-w-full"
      >
        <span className="font-semibold uppercase tracking-wider text-white/60">
          {t('ppe.wall.context.zonesLabel')}:
        </span>

        {zonesState.isInitialLoading ? (
          <span className="text-white/75 font-medium break-words">
            {t('ppe.wall.context.loadingZones')}
          </span>
        ) : zonesState.isBaseError ? (
          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            <span className="text-amber-300 font-medium break-words [overflow-wrap:anywhere]">
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
                  className="pointer-events-auto inline-flex min-h-8 max-w-full items-center rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1 text-xs font-semibold text-white whitespace-normal break-words transition-colors cursor-pointer"
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
            {inlineZones.map(renderZoneChip)}

            {hasOverflowZones && (
              <details
                data-testid={`zones-overflow-disclosure-${cameraId}`}
                className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 open:basis-full"
              >
                <summary className="pointer-events-auto inline-flex min-h-8 min-w-0 max-w-full cursor-pointer items-center rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-100 hover:bg-white/20 select-none tabular-nums whitespace-normal break-words [overflow-wrap:anywhere]">
                  {`+${trMonitor('monitor.zones.linkedCount', {
                    count: overflowZones.length,
                  })}`}
                </summary>
                <div className="mt-1.5 flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
                  {overflowZones.map(renderZoneChip)}
                </div>
              </details>
            )}

            {zonesState.unresolvedRegionCount > 0 && (
              <span className="inline-flex max-w-full items-center rounded-md bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-medium text-amber-200 tabular-nums break-words [overflow-wrap:anywhere]">
                {t('ppe.wall.context.unresolvedZones', {
                  count: zonesState.unresolvedRegionCount,
                })}
              </span>
            )}

            {zonesState.isNextPageError && (
              <span className="text-amber-300 font-medium tabular-nums break-words [overflow-wrap:anywhere]">
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
                className="pointer-events-auto inline-flex min-h-8 max-w-full items-center rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 text-xs font-semibold text-white whitespace-normal break-words transition-colors cursor-pointer"
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
