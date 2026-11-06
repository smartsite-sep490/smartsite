import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import type { useSetupCatalog } from './useSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import './camera-setup-catalog-copy';
import type { CameraApplicationStatusContext } from './CameraApplicationStatusSummary';
import { CameraSetupContextBar, CameraSetupRowMetadata } from './CameraSetupContextPanel';
import { CameraSetupWorkflow, type CameraSetupOpenHandler } from './CameraSetupWorkflow';

export function CameraSetupCatalog({
  siteId,
  siteCode,
  siteName,
  canOpenMonitoring = false,
  capabilities,
  canReadCameras,
  canReadZones = false,
  cameras,
  rows,
  requestedCameraId = null,
  cameraError,
  open,
  statusContext,
}: {
  siteId?: string;
  siteCode?: string;
  siteName?: string;
  canOpenMonitoring?: boolean;
  capabilities: ZonePpeCapabilities;
  canReadCameras: boolean;
  canReadZones?: boolean;
  cameras: ReturnType<typeof useSetupCatalog<CameraResponse>>;
  rows: CameraResponse[];
  requestedCameraId?: string | null;
  cameraError: ReactNode;
  open: CameraSetupOpenHandler;
  statusContext?: CameraApplicationStatusContext;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const catalogId = useId();
  const [lastRequestedId, setLastRequestedId] = useState(requestedCameraId);
  const [focusOverrideId, setFocusedCameraId] = useState<string | null>(null);
  if (lastRequestedId !== requestedCameraId) {
    setLastRequestedId(requestedCameraId);
    if (focusOverrideId !== null) {
      setFocusedCameraId(null);
    }
  }
  const focusedCameraId = lastRequestedId === requestedCameraId ? focusOverrideId : null;
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const canWriteZones = capabilities.canManageZones || canManageCameras;
  const hasLoadedCameraPages = Boolean(cameras.data?.pages.length) && !cameras.baseError;
  const selectedCamera =
    (focusedCameraId ? rows.find((row) => row.id === focusedCameraId) : undefined) ??
    (requestedCameraId ? rows.find((row) => row.id === requestedCameraId) : undefined) ??
    rows[0] ??
    null;
  const showLinkedCameraNotice = Boolean(
    requestedCameraId &&
    !rows.some((row) => row.id === requestedCameraId) &&
    hasLoadedCameraPages &&
    !cameras.error &&
    !cameras.isFetching,
  );
  const showPartialPageNotice = Boolean(
    !cameras.error &&
    !cameras.isFetching &&
    cameras.hasNextPage &&
    rows.length === 0 &&
    !showLinkedCameraNotice,
  );
  const showContextBar =
    canReadCameras && !cameras.baseError && (rows.length > 0 || !canManageCameras);
  const hideRedundantHeaderHint = showContextBar && (Boolean(selectedCamera) || !canManageCameras);
  const primaryButton = CAMERA_BUTTON_STYLES.primary;
  const secondaryButton = CAMERA_BUTTON_STYLES.secondary;
  const primarySurface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs';

  return (
    <div>
      <section className={primarySurface} aria-label={t('cameraSetup.cameras')}>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 border-b border-slate-100 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {t('cameraSetup.cameras')}
            </h2>
            <p
              className={
                hideRedundantHeaderHint ? 'sr-only' : 'max-w-xl text-xs leading-5 text-slate-500'
              }
            >
              {t(capabilities.canManageRegions ? 'cameraSetup.metadata' : 'cameraSetup.adminHint')}
            </p>
          </div>
          <CameraSetupWorkflow
            canWriteZones={canWriteZones}
            canReadZones={canReadZones}
            canManageCameras={canManageCameras}
            open={open}
          />
        </div>
        {canReadCameras && (
          <>
            {showContextBar && (
              <CameraSetupContextBar
                siteCode={siteCode}
                siteName={siteName}
                rows={rows}
                selectedCamera={selectedCamera}
                canManageCameras={canManageCameras}
                canOpenMonitoring={canOpenMonitoring}
                open={open}
                statusContext={statusContext}
              />
            )}
            {cameras.isPending && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 text-sm text-slate-500"
              >
                {t('cameraSetup.loading')}
              </p>
            )}
            {cameraError}
            {rows.length > 0 && (
              <ul className="mt-4 space-y-3">
                {rows.map((row) => {
                  const isEnabled = row.status === 'ACTIVE';
                  const isSelectedCamera = selectedCamera?.id === row.id;
                  const nameId = `${catalogId}-camera-name-${row.id}`;
                  const hintId = `${catalogId}-inactive-hint-${row.id}`;
                  const ppeMonitorId = `${catalogId}-camera-ppe-${row.id}`;
                  const zonesMonitorId = `${catalogId}-camera-zones-${row.id}`;
                  const canMonitorRow =
                    canOpenMonitoring &&
                    isEnabled &&
                    Boolean(siteId && row.siteId === siteId) &&
                    !cameras.baseError;
                  const monitorParams = canMonitorRow
                    ? new URLSearchParams({ siteId: row.siteId, cameraId: row.id }).toString()
                    : '';
                  const regionsButtonClass = `${
                    isSelectedCamera ? primaryButton : secondaryButton
                  } min-h-9 shrink-0`;
                  const manageButtonClass = `${
                    !isEnabled && isSelectedCamera
                      ? secondaryButton
                      : CAMERA_BUTTON_STYLES.compactSecondary
                  } min-h-9 shrink-0`;
                  const monitorLinkClass = `${CAMERA_BUTTON_STYLES.compactSecondary} min-h-9 shrink-0`;

                  return (
                    <li
                      key={row.id}
                      aria-labelledby={nameId}
                      aria-current={isSelectedCamera ? 'true' : undefined}
                      className={`min-w-0 space-y-3 rounded-xl border p-4 transition-colors xl:flex xl:items-start xl:justify-between xl:gap-5 xl:space-y-0 ${
                        isSelectedCamera
                          ? 'border-slate-300 border-l-4 border-l-slate-900 bg-slate-50/90 shadow-2xs ring-1 ring-slate-900/10'
                          : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2.5">
                          <h3
                            id={nameId}
                            title={row.name}
                            className="min-w-0 max-w-full flex-[1_1_12rem] break-words [overflow-wrap:anywhere] text-base leading-snug font-semibold tracking-tight text-slate-950"
                          >
                            {canManageCameras ? (
                              <button
                                type="button"
                                title={row.name}
                                aria-haspopup="dialog"
                                className="max-w-full cursor-pointer rounded-md text-left break-words [overflow-wrap:anywhere] decoration-slate-300 underline-offset-4 hover:underline hover:decoration-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
                                onClick={(event) => {
                                  setFocusedCameraId(row.id);
                                  open(
                                    isEnabled ? 'regions' : 'manage',
                                    row.id,
                                    event.currentTarget,
                                  );
                                }}
                              >
                                {row.name}
                              </button>
                            ) : (
                              row.name
                            )}
                          </h3>
                          {rows.length > 1 && (
                            <button
                              type="button"
                              aria-pressed={isSelectedCamera}
                              className={`inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] ${
                                isSelectedCamera
                                  ? 'border-slate-900/30 bg-slate-900/10 font-semibold text-slate-900'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-[#111111]'
                              }`}
                              onClick={() => setFocusedCameraId(row.id)}
                            >
                              {t(
                                isSelectedCamera
                                  ? 'cameraSetup.selectedCameraBtn'
                                  : 'cameraSetup.selectCameraBtn',
                                { code: row.code },
                              )}
                            </button>
                          )}
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <CameraSetupRowMetadata row={row} isEnabled={isEnabled} />
                        </div>
                        {!isEnabled && canManageCameras && (
                          <p
                            id={hintId}
                            className={
                              selectedCamera ? 'sr-only' : 'text-xs leading-5 text-slate-500'
                            }
                          >
                            {t('cameraSetup.inactiveHint')}
                          </p>
                        )}
                      </div>
                      {(canManageCameras || canMonitorRow) && (
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2.5 border-t border-slate-200/70 pt-3 xl:shrink-0 xl:justify-end xl:self-center xl:border-t-0 xl:pt-0">
                          {canManageCameras && (
                            <div className="flex flex-wrap items-center gap-2">
                              {isEnabled && (
                                <button
                                  type="button"
                                  className={regionsButtonClass}
                                  aria-describedby={nameId}
                                  onClick={(event) => {
                                    setFocusedCameraId(row.id);
                                    open('regions', row.id, event.currentTarget);
                                  }}
                                >
                                  {t('cameraSetup.regionsAction')}
                                </button>
                              )}
                              <button
                                type="button"
                                className={manageButtonClass}
                                aria-label={t('cameraSetup.manage', { name: row.name })}
                                aria-describedby={!isEnabled ? hintId : undefined}
                                onClick={(event) => {
                                  setFocusedCameraId(row.id);
                                  open('manage', row.id, event.currentTarget);
                                }}
                              >
                                {t('cameraSetup.manageAction')}
                              </button>
                            </div>
                          )}
                          {canMonitorRow && (
                            <div
                              className={`flex flex-wrap items-center gap-2 ${
                                canManageCameras ? 'sm:border-l sm:border-slate-200 sm:pl-2.5' : ''
                              }`}
                            >
                              <Link
                                id={ppeMonitorId}
                                aria-labelledby={`${ppeMonitorId} ${nameId}`}
                                className={monitorLinkClass}
                                to={`/ppe?${monitorParams}`}
                              >
                                {t('cameraSetup.monitorPpe')}
                              </Link>
                              <Link
                                id={zonesMonitorId}
                                aria-labelledby={`${zonesMonitorId} ${nameId}`}
                                className={monitorLinkClass}
                                to={`/zones?${monitorParams}`}
                              >
                                {t('cameraSetup.monitorZones')}
                              </Link>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {cameras.settledEmpty && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500"
              >
                {t('cameraSetup.noCameras')}
              </p>
            )}
            {showLinkedCameraNotice && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600"
              >
                {t(
                  cameras.hasNextPage
                    ? 'cameraSetup.linkedCameraMore'
                    : 'cameraSetup.linkedCameraUnavailable',
                )}
              </p>
            )}
            {showPartialPageNotice && (
              <p role="status" className="mt-3 text-sm text-slate-600">
                {t('cameraSetup.partial')}
              </p>
            )}
            {((hasLoadedCameraPages && !cameras.settledEmpty) ||
              (!cameras.baseError && cameras.hasNextPage)) && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                {hasLoadedCameraPages && !cameras.settledEmpty ? (
                  <p className="text-xs font-medium tabular-nums text-slate-500">
                    {t('cameraSetup.count', { loaded: rows.length, total: cameras.total })}
                  </p>
                ) : (
                  <span />
                )}
                {!cameras.baseError && cameras.hasNextPage && (
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={cameras.isFetching}
                    onClick={cameras.loadMore}
                  >
                    {t('cameraSetup.camerasMore')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
