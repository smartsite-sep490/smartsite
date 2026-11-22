import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { useTranslation } from 'react-i18next';
import type { ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertTriangle } from '../icons';
import {
  getSafePublicErrorMessage,
  registerCameraRegionPanelCatalog,
} from './camera-region-panel-catalog';

registerCameraRegionPanelCatalog();

export interface CameraRegionSelectionControlsProps {
  zones: ZoneResponse[];
  selectedZoneId: string;
  onZoneChange: (zoneId: string) => void;
  selectedCameraId: string;
  onCameraChange: (cameraId: string) => void;
  allFetchedCameras: CameraResponse[];
  visibleActiveCameras: CameraResponse[];
  cameraServerTotal: number;
  isCamerasInitialLoading: boolean;
  cameraError: unknown;
  isCameraBaseError: boolean;
  isTransientNextCameraError: boolean;
  isFetchingCameras: boolean;
  hasNextCameraPage: boolean;
  isSaving?: boolean;
  onRetryInitialCameras: () => void;
  onFetchNextCameras: () => void;
}

export function CameraRegionSelectionControls({
  zones,
  selectedZoneId,
  onZoneChange,
  selectedCameraId,
  onCameraChange,
  allFetchedCameras,
  visibleActiveCameras,
  cameraServerTotal,
  isCamerasInitialLoading,
  cameraError,
  isCameraBaseError,
  isTransientNextCameraError,
  isFetchingCameras,
  hasNextCameraPage,
  isSaving = false,
  onRetryInitialCameras,
  onFetchNextCameras,
}: CameraRegionSelectionControlsProps) {
  registerCameraRegionPanelCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const zoneNameCounts = new Map<string, number>();
  for (const zone of zones) {
    const normalized = zone.name.trim().toLowerCase();
    zoneNameCounts.set(normalized, (zoneNameCounts.get(normalized) ?? 0) + 1);
  }
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const selectedCamera =
    visibleActiveCameras.find((camera) => camera.id === selectedCameraId) ?? null;
  const selectedCameraTitle = selectedCamera
    ? selectedCamera.name.trim() && selectedCamera.name.trim() !== selectedCamera.code.trim()
      ? `${selectedCamera.name} (${selectedCamera.code})`
      : selectedCamera.code
    : undefined;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 w-full max-w-full">
      <div className="min-w-0 w-full space-y-1.5">
        <label htmlFor="select-zone-link" className="block text-xs font-semibold text-slate-700">
          {t('regionSetup.field.selectZone')}
        </label>
        <SmartNativeSelect
          id="select-zone-link"
          aria-label={t('regionSetup.field.selectZone')}
          title={selectedZone ? `${selectedZone.name} (${selectedZone.code})` : undefined}
          value={selectedZoneId}
          onChange={(e) => onZoneChange(e.target.value)}
          disabled={zones.length === 0 || isSaving}
          className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 truncate"
        >
          {zones.map((zone) => {
            const hasDuplicateName = (zoneNameCounts.get(zone.name.trim().toLowerCase()) ?? 0) > 1;
            const fullTitle = `${zone.name} (${zone.code})`;
            const optionLabel = hasDuplicateName ? fullTitle : zone.name;
            return (
              <option key={zone.id} value={zone.id} title={fullTitle}>
                {optionLabel}
              </option>
            );
          })}
        </SmartNativeSelect>
        {selectedZone && (
          <details data-testid="region-zone-selection-tech" className="text-[11px] text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-slate-500 hover:text-slate-800">
              {t('regionSetup.list.technicalIdSummary')}
            </summary>
            <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-slate-600 break-all">
              <p className="select-all">
                {t('regionSetup.list.technicalZoneCode', { code: selectedZone.code })}
              </p>
              <p className="text-slate-500 select-all">
                {t('regionSetup.list.technicalZoneId', { id: selectedZone.id })}
              </p>
            </div>
          </details>
        )}
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

        <SmartNativeSelect
          id="select-camera-link"
          aria-label={t('regionSetup.field.selectCamera')}
          title={selectedCameraTitle}
          value={selectedCameraId}
          onChange={(e) => onCameraChange(e.target.value)}
          disabled={visibleActiveCameras.length === 0 || isSaving}
          className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 truncate"
        >
          {!selectedCameraId && <option value="">{t('regionSetup.field.selectCamera')}</option>}
          {visibleActiveCameras.map((camera) => {
            const cameraLabel =
              camera.name.trim() && camera.name.trim() !== camera.code.trim()
                ? `${camera.name} (${camera.code})`
                : camera.code;
            return (
              <option key={camera.id} value={camera.id} title={cameraLabel}>
                {cameraLabel}
              </option>
            );
          })}
        </SmartNativeSelect>

        {isCamerasInitialLoading && (
          <div role="status" aria-live="polite" className="text-xs text-slate-500 py-1">
            {t('regionSetup.camera.loading')}
          </div>
        )}

        {Boolean(cameraError) && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{getSafePublicErrorMessage(cameraError, 'camera', t)}</span>
          </div>
        )}

        {(isCameraBaseError || isTransientNextCameraError || hasNextCameraPage) && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {isCameraBaseError && (
              <button
                type="button"
                onClick={onRetryInitialCameras}
                disabled={isFetchingCameras}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
              >
                {isFetchingCameras
                  ? t('regionSetup.camera.retrying')
                  : t('regionSetup.camera.retryInitial')}
              </button>
            )}

            {isTransientNextCameraError && (
              <button
                type="button"
                onClick={onFetchNextCameras}
                disabled={isFetchingCameras}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              >
                {isFetchingCameras
                  ? t('regionSetup.camera.retryingMore')
                  : t('regionSetup.camera.retryNextPage')}
              </button>
            )}

            {!isCameraBaseError && !isTransientNextCameraError && hasNextCameraPage && (
              <button
                type="button"
                onClick={onFetchNextCameras}
                disabled={isFetchingCameras}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {isFetchingCameras
                  ? t('regionSetup.camera.loadingMore')
                  : t('regionSetup.camera.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
