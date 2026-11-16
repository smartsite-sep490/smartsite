import { useTranslation } from 'react-i18next';
import type { RegionResponse } from '@smartsite/contracts';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertTriangle } from '../icons';
import {
  getSafePublicErrorMessage,
  registerCameraRegionPanelCatalog,
} from './camera-region-panel-catalog';
import { RegionGeometryConfirmationStatus } from './RegionGeometryConfirmationStatus';
import { extractRegionPolygonCoordinates, type NormalizedPoint } from './region-polygon-geometry';

registerCameraRegionPanelCatalog();

export interface CameraRegionListProps {
  selectedCameraId: string;
  isCameraBaseError: boolean;
  isLoadingCameras: boolean;
  allFetchedRegions: RegionResponse[];
  visibleLinkedRegions: RegionResponse[];
  regionServerTotal: number;
  isRegionsInitialLoading: boolean;
  regionError: unknown;
  isRegionBaseError: boolean;
  isTransientNextRegionError: boolean;
  isFetchingRegions: boolean;
  hasNextRegionPage: boolean;
  canStartDrawing: boolean;
  isCurrentScopeActive: boolean;
  onStartEditingRegion: (region: RegionResponse, initialPoints: NormalizedPoint[]) => void;
  onRetryInitialRegions: () => void;
  onFetchNextRegions: () => void;
}

export function CameraRegionList({
  selectedCameraId,
  isCameraBaseError,
  isLoadingCameras,
  allFetchedRegions,
  visibleLinkedRegions,
  regionServerTotal,
  isRegionsInitialLoading,
  regionError,
  isRegionBaseError,
  isTransientNextRegionError,
  isFetchingRegions,
  hasNextRegionPage,
  canStartDrawing,
  isCurrentScopeActive,
  onStartEditingRegion,
  onRetryInitialRegions,
  onFetchNextRegions,
}: CameraRegionListProps) {
  registerCameraRegionPanelCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);

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
        <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
          {visibleLinkedRegions.map((region) => {
            const editablePoints = extractRegionPolygonCoordinates(region.polygon);
            return (
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
                  <RegionGeometryConfirmationStatus
                    geometryConfirmation={region.geometryConfirmation}
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {editablePoints && (
                    <button
                      type="button"
                      onClick={() => onStartEditingRegion(region, editablePoints)}
                      disabled={!canStartDrawing || isCurrentScopeActive}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
                    >
                      {t('regionSetup.list.editGeometry')}
                    </button>
                  )}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 shrink-0">
                    {region.coordinateSpace}
                  </span>
                </div>
              </div>
            );
          })}
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
