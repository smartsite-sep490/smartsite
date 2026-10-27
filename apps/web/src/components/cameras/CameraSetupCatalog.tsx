import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import type { useSetupCatalog } from './useSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
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
  const [focusOverride, setFocusOverride] = useState<{
    baseRequestedId: string | null | undefined;
    cameraId: string;
  } | null>(null);
  const focusedCameraId =
    focusOverride?.baseRequestedId === requestedCameraId ? focusOverride.cameraId : null;
  const setFocusedCameraId = (cameraId: string) =>
    setFocusOverride({ baseRequestedId: requestedCameraId, cameraId });
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
  const button = CAMERA_BUTTON_STYLES.secondary;
  const primarySurface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs';
  return (
    <div>
      <section className={primarySurface} aria-label={t('cameraSetup.cameras')}>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 border-b border-slate-100 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {t('cameraSetup.cameras')}
            </h2>
            <p className="max-w-xl text-xs leading-5 text-slate-500">
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
            {!cameras.baseError && (rows.length > 0 || !canManageCameras) && (
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
              <ul className="mt-4 space-y-2.5">
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
                  return (
                    <li
                      key={row.id}
                      aria-labelledby={nameId}
                      aria-current={isSelectedCamera ? 'true' : undefined}
                      className={`flex flex-col justify-between gap-4 rounded-xl border px-4 py-3.5 transition-colors sm:flex-row sm:items-center ${
                        isSelectedCamera
                          ? 'border-slate-900 bg-slate-100/70 ring-1 ring-slate-900/10'
                          : 'border-slate-200/90 bg-slate-50/30 hover:border-slate-300 hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <h3
                          id={nameId}
                          className="break-words [overflow-wrap:anywhere] text-base font-semibold tracking-tight text-slate-900"
                        >
                          {canManageCameras ? (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              className="cursor-pointer rounded-md text-left underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
                              onClick={(event) => {
                                setFocusedCameraId(row.id);
                                open(isEnabled ? 'regions' : 'manage', row.id, event.currentTarget);
                              }}
                            >
                              {row.name}
                            </button>
                          ) : (
                            row.name
                          )}
                        </h3>
                        <CameraSetupRowMetadata row={row} isEnabled={isEnabled} />
                        {!isEnabled && canManageCameras && (
                          <p id={hintId} className="text-xs leading-5 text-slate-500">
                            {t('cameraSetup.inactiveHint')}
                          </p>
                        )}
                      </div>
                      {(canManageCameras || canMonitorRow || rows.length > 1) && (
                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-center">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              aria-pressed={isSelectedCamera}
                              className={CAMERA_BUTTON_STYLES.compactSecondary}
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
                          {canMonitorRow && (
                            <>
                              <Link
                                id={ppeMonitorId}
                                aria-labelledby={`${ppeMonitorId} ${nameId}`}
                                className={`${CAMERA_BUTTON_STYLES.compactSecondary} shrink-0`}
                                to={`/ppe?${monitorParams}`}
                              >
                                {t('cameraSetup.monitorPpe')}
                              </Link>
                              <Link
                                id={zonesMonitorId}
                                aria-labelledby={`${zonesMonitorId} ${nameId}`}
                                className={`${CAMERA_BUTTON_STYLES.compactSecondary} shrink-0`}
                                to={`/zones?${monitorParams}`}
                              >
                                {t('cameraSetup.monitorZones')}
                              </Link>
                            </>
                          )}
                          {canManageCameras && (
                            <>
                              {isEnabled && (
                                <button
                                  type="button"
                                  className={button}
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
                                className={`${CAMERA_BUTTON_STYLES.compactSecondary} shrink-0`}
                                aria-label={t('cameraSetup.manage', { name: row.name })}
                                aria-describedby={!isEnabled ? hintId : undefined}
                                onClick={(event) => {
                                  setFocusedCameraId(row.id);
                                  open('manage', row.id, event.currentTarget);
                                }}
                              >
                                {t('cameraSetup.manageAction')}
                              </button>
                            </>
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
                    className={button}
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
