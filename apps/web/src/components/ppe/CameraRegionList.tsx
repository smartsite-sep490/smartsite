import { useTranslation } from 'react-i18next';
import type { RegionResponse, ZoneResponse } from '@smartsite/contracts';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertTriangle } from '../icons';
import {
  getSafePublicErrorMessage,
  registerCameraRegionPanelCatalog,
} from './camera-region-panel-catalog';
import { RegionGeometryConfirmationStatus } from './RegionGeometryConfirmationStatus';
import { doesRegionNeedViewRevalidation } from './cameraRegionReferenceUtils';
import { extractRegionPolygonCoordinates, type NormalizedPoint } from './region-polygon-geometry';

registerCameraRegionPanelCatalog();

export interface CameraRegionListProps {
  selectedCameraId: string;
  selectedZone?: { id?: string; code: string; name: string; restrictionPolicy?: string } | null;
  zones?: ZoneResponse[];
  currentViewRevision?: number | null;
  isCameraBaseError: boolean;
  isLoadingCameras: boolean;
  allFetchedRegions: RegionResponse[];
  allCameraRegions?: RegionResponse[];
  visibleLinkedRegions: RegionResponse[];
  regionServerTotal: number;
  isRegionsInitialLoading: boolean;
  regionError: unknown;
  isRegionBaseError: boolean;
  isTransientNextRegionError: boolean;
  isFetchingRegions: boolean;
  hasNextRegionPage: boolean;
  canStartDrawing: boolean;
  canRequestReference?: boolean;
  isLoadingReference?: boolean;
  pendingEditRegionId?: string | null;
  isCurrentScopeActive: boolean;
  onStartEditingRegion: (region: RegionResponse, initialPoints: NormalizedPoint[]) => void;
  onEditSavedRegion?: (region: RegionResponse, initialPoints: NormalizedPoint[]) => void;
  onRetryInitialRegions: () => void;
  onFetchNextRegions: () => void;
}

export function CameraRegionList({
  selectedCameraId,
  selectedZone = null,
  zones,
  currentViewRevision = null,
  isCameraBaseError,
  isLoadingCameras,
  allFetchedRegions,
  allCameraRegions,
  visibleLinkedRegions,
  regionServerTotal,
  isRegionsInitialLoading,
  regionError,
  isRegionBaseError,
  isTransientNextRegionError,
  isFetchingRegions,
  hasNextRegionPage,
  canStartDrawing,
  canRequestReference = false,
  isLoadingReference = false,
  pendingEditRegionId = null,
  isCurrentScopeActive,
  onStartEditingRegion,
  onEditSavedRegion,
  onRetryInitialRegions,
  onFetchNextRegions,
}: CameraRegionListProps) {
  registerCameraRegionPanelCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const zonesById = new Map((zones ?? []).map((zone) => [zone.id, zone]));
  const selectedZoneId = selectedZone?.id;
  const otherZoneRegions =
    allCameraRegions && selectedZoneId
      ? allCameraRegions.filter(
          (region) => region.zoneId !== selectedZoneId && zonesById.has(region.zoneId),
        )
      : [];

  const renderRegionRow = (
    region: RegionResponse,
    idx: number,
    zoneInfo: { code: string; name: string; restrictionPolicy?: string } | null,
    isOtherZone: boolean,
  ) => {
    const editablePoints = extractRegionPolygonCoordinates(region.polygon);
    const needsRevalidation = doesRegionNeedViewRevalidation(
      region.geometryConfirmation,
      currentViewRevision,
    );
    const regionNumberTitle = t('regionSetup.list.regionNumberTitle', { index: idx + 1 });
    const regionTitle = zoneInfo ? `${zoneInfo.name} · ${regionNumberTitle}` : regionNumberTitle;
    const isRestrictedZone = Boolean(
      zoneInfo?.restrictionPolicy && zoneInfo.restrictionPolicy !== 'NONE',
    );
    const canTriggerOneClickEdit = Boolean(onEditSavedRegion && canRequestReference);
    const isEditDisabled =
      isCurrentScopeActive || isLoadingReference || (!canStartDrawing && !canTriggerOneClickEdit);
    const isPendingThisRegion = isLoadingReference && pendingEditRegionId === region.id;
    const editLabel = isPendingThisRegion
      ? t('regionSetup.list.loadingReferenceForEdit')
      : canStartDrawing
        ? t(
            needsRevalidation
              ? 'regionSetup.list.revalidateGeometry'
              : 'regionSetup.list.editGeometry',
          )
        : canTriggerOneClickEdit
          ? t('regionSetup.list.editNeedReference')
          : t(
              needsRevalidation
                ? 'regionSetup.list.revalidateGeometry'
                : 'regionSetup.list.editGeometry',
            );

    return (
      <div
        key={region.id}
        data-testid={isOtherZone ? `other-zone-region-row-${region.id}` : undefined}
        className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs min-w-0"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span
              title={regionTitle}
              className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"
            >
              {regionTitle}
            </span>
            {isRestrictedZone && (
              <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 shrink-0">
                {t('regionSetup.list.restrictedBadge')}
              </span>
            )}
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 shrink-0">
              {t('regionSetup.list.versionStatus', {
                version: region.version,
                status: region.isActive
                  ? t('regionSetup.list.statusActive')
                  : t('regionSetup.list.statusInactive'),
              })}
            </span>
            <RegionGeometryConfirmationStatus
              geometryConfirmation={region.geometryConfirmation}
              currentViewRevision={currentViewRevision}
            />
          </div>
          <details
            data-testid={`camera-region-list-tech-${region.id}`}
            className="text-[11px] text-slate-500"
          >
            <summary className="cursor-pointer select-none font-medium text-slate-500 hover:text-slate-800">
              {t('regionSetup.list.technicalIdSummary')}
            </summary>
            <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-slate-600 break-all">
              <p className="select-all">
                {t('regionSetup.list.technicalRegionId', { id: region.id })}
              </p>
              {zoneInfo?.code && (
                <p className="text-slate-500 select-all">
                  {t('regionSetup.list.technicalZoneCode', { code: zoneInfo.code })}
                </p>
              )}
              <p className="text-slate-500 select-all">
                {t('regionSetup.list.technicalZoneId', { id: region.zoneId })}
              </p>
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {editablePoints && (
            <button
              type="button"
              onClick={() => {
                if (onEditSavedRegion) {
                  onEditSavedRegion(region, editablePoints);
                } else {
                  onStartEditingRegion(region, editablePoints);
                }
              }}
              disabled={isEditDisabled}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] ${
                needsRevalidation
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
              }`}
            >
              {editLabel}
            </button>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 shrink-0">
            {region.coordinateSpace}
          </span>
        </div>
      </div>
    );
  };

  return (
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

      {isRegionsInitialLoading && (
        <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
          {t('regionSetup.list.loading')}
        </div>
      )}

      {Boolean(regionError) && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getSafePublicErrorMessage(regionError, 'region', t)}</span>
        </div>
      )}

      {isRegionBaseError && (
        <div className="py-1">
          <button
            type="button"
            onClick={onRetryInitialRegions}
            disabled={isFetchingRegions}
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            {isFetchingRegions
              ? t('regionSetup.list.retrying')
              : t('regionSetup.list.retryInitial')}
          </button>
        </div>
      )}

      {!isRegionsInitialLoading &&
        !isRegionBaseError &&
        Boolean(selectedCameraId) &&
        visibleLinkedRegions.length === 0 && (
          <>
            {hasNextRegionPage ? (
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

      {!selectedCameraId && !isCameraBaseError && !isLoadingCameras && (
        <div className="text-xs text-slate-500 italic py-1">
          {t('regionSetup.list.noCameraSelected')}
        </div>
      )}

      {visibleLinkedRegions.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
          {visibleLinkedRegions.map((region, idx) =>
            renderRegionRow(region, idx, selectedZone, false),
          )}
        </div>
      )}

      {otherZoneRegions.length > 0 && (
        <div
          data-testid="other-zone-regions-section"
          className="border-t border-slate-200/70 pt-3 space-y-2"
        >
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-slate-800">
              {t('regionSetup.list.otherZonesHeading', { count: otherZoneRegions.length })}
            </p>
            <p className="text-xs text-slate-600">{t('regionSetup.list.otherZonesHint')}</p>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {otherZoneRegions.map((region, idx) =>
              renderRegionRow(region, idx, zonesById.get(region.zoneId) ?? null, true),
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {isTransientNextRegionError && (
          <button
            type="button"
            onClick={onFetchNextRegions}
            disabled={isFetchingRegions}
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            {isFetchingRegions
              ? t('regionSetup.list.retryingMore')
              : t('regionSetup.list.retryNextPage')}
          </button>
        )}

        {!isRegionBaseError && !isTransientNextRegionError && hasNextRegionPage && (
          <button
            type="button"
            onClick={onFetchNextRegions}
            disabled={isFetchingRegions}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {isFetchingRegions ? t('regionSetup.list.loadingMore') : t('regionSetup.list.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
}
