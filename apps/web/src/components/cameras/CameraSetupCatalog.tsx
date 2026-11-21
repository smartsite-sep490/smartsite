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
import { CameraSetupChecklist } from './CameraSetupTour';
import { CameraSetupWorkflow, type CameraSetupOpenHandler } from './CameraSetupWorkflow';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';

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
  focusedCameraId: controlledFocusedCameraId,
  onFocusCamera,
  cameraError,
  open,
  statusContext,
  policyContext,
  sourceSetupStage,
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
  focusedCameraId?: string | null;
  onFocusCamera?: (cameraId: string) => void;
  cameraError: ReactNode;
  open: CameraSetupOpenHandler;
  statusContext?: CameraApplicationStatusContext;
  policyContext?: CameraPpeContext;
  sourceSetupStage?: ReactNode;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const catalogId = useId();
  const [lastRequestedId, setLastRequestedId] = useState(requestedCameraId);
  const [focusOverrideId, setInternalFocusedCameraId] = useState<string | null>(null);
  const [ppeExpandRequest, setPpeExpandRequest] = useState<{
    cameraId: string;
    seq: number;
  } | null>(null);
  if (lastRequestedId !== requestedCameraId) {
    setLastRequestedId(requestedCameraId);
    if (focusOverrideId !== null) {
      setInternalFocusedCameraId(null);
    }
  }
  const internalFocusedCameraId = lastRequestedId === requestedCameraId ? focusOverrideId : null;
  const focusedCameraId =
    controlledFocusedCameraId !== undefined ? controlledFocusedCameraId : internalFocusedCameraId;
  const setFocusedCameraId = (cameraId: string) => {
    setInternalFocusedCameraId(cameraId);
    onFocusCamera?.(cameraId);
  };
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
            {sourceSetupStage}
            {!cameras.baseError && !cameras.isPending && (
              <CameraSetupChecklist
                siteId={siteId}
                selectedCamera={selectedCamera}
                policyContext={policyContext}
                statusContext={statusContext}
              />
            )}
            {!cameras.baseError && (rows.length > 0 || !canManageCameras) && (
              <CameraSetupContextBar
                siteId={siteId}
                siteCode={siteCode}
                siteName={siteName}
                rows={rows}
                selectedCamera={selectedCamera}
                canManageCameras={canManageCameras}
                canOpenMonitoring={canOpenMonitoring}
                open={open}
                onSelectCamera={rows.length > 1 ? setFocusedCameraId : undefined}
                onOpenPpePolicy={
                  policyContext && selectedCamera
                    ? () => {
                        setPpeExpandRequest((prev) => ({
                          cameraId: selectedCamera.id,
                          seq: (prev?.seq ?? 0) + 1,
                        }));
                      }
                    : undefined
                }
                statusContext={statusContext}
              />
            )}

            {selectedCamera && policyContext && !cameras.baseError && (
              <CameraPpePolicyPanel
                key={selectedCamera.id}
                cameraId={selectedCamera.id}
                camera={selectedCamera}
                context={policyContext}
                statusContext={statusContext}
                canWrite={canManageCameras}
                expandSignal={
                  ppeExpandRequest?.cameraId === selectedCamera.id ? ppeExpandRequest.seq : 0
                }
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
                  return (
                    <li
                      key={row.id}
                      aria-labelledby={nameId}
                      aria-current={isSelectedCamera ? 'true' : undefined}
                      className={`min-w-0 space-y-3 rounded-xl border p-4 transition-colors xl:flex xl:items-start xl:justify-between xl:gap-5 xl:space-y-0 ${
                        isSelectedCamera
                          ? 'border-slate-300 border-l-4 border-l-slate-900 bg-slate-50/90 shadow-2xs ring-1 ring-slate-900/10'
                          : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <h3
                          id={nameId}
                          className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base leading-snug font-semibold tracking-tight text-slate-950"
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
                          <p
                            id={hintId}
                            className={
                              isSelectedCamera ? 'sr-only' : 'text-xs leading-5 text-slate-500'
                            }
                          >
                            {t('cameraSetup.inactiveHint')}
                          </p>
                        )}
                      </div>
                      {(canManageCameras || canMonitorRow || rows.length > 1) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5 border-t border-slate-200/70 pt-3 xl:shrink-0 xl:self-center xl:border-t-0 xl:pt-0">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              aria-pressed={isSelectedCamera}
                              className={
                                isSelectedCamera
                                  ? `${CAMERA_BUTTON_STYLES.compactSecondary} border-slate-900 bg-slate-900/5 text-slate-900`
                                  : CAMERA_BUTTON_STYLES.compactSecondary
                              }
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
                          {canManageCameras && (
                            <div
                              className={`flex flex-wrap items-center gap-2 ${
                                rows.length > 1 ? 'sm:border-l sm:border-slate-200 sm:pl-2' : ''
                              }`}
                            >
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
                            </div>
                          )}
                          {canMonitorRow && (
                            <div className="flex flex-wrap items-center gap-2">
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
              <div
                role="status"
                data-testid="camera-setup-empty-catalog"
                className="mt-4 space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-6 text-center"
              >
                <p className="text-sm font-semibold text-slate-800">{t('cameraSetup.noCameras')}</p>
                <p className="mx-auto max-w-xl text-xs leading-5 text-slate-600">
                  {t(
                    canManageCameras
                      ? 'cameraSetup.emptyStepFlowManager'
                      : 'cameraSetup.emptyStepFlowReadOnly',
                  )}
                </p>
                {canManageCameras && (
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    {canWriteZones && (
                      <button
                        type="button"
                        className={CAMERA_BUTTON_STYLES.secondary}
                        onClick={(event) => open('zones', undefined, event.currentTarget)}
                      >
                        {t('cameraSetup.emptyStep1Action')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={CAMERA_BUTTON_STYLES.primary}
                      onClick={(event) => open('register', undefined, event.currentTarget)}
                    >
                      {t('cameraSetup.emptyStep2Action')}
                    </button>
                  </div>
                )}
              </div>
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
