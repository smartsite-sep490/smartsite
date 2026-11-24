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
import {
  CameraSetupContextBar,
  CameraSetupRowMetadata,
  type CameraWorkspaceTask,
} from './CameraSetupContextPanel';
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
  applySavedBar,
  inlineRegionStage,
  activeTask: controlledActiveTask,
  onSelectTask,
  ppeExpandSignal: controlledPpeExpandSignal,
  autoExpandPpeCameraId = null,
  onOpenApply,
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
  applySavedBar?: ReactNode;
  inlineRegionStage?: ReactNode;
  activeTask?: CameraWorkspaceTask | null;
  onSelectTask?: (
    task: CameraWorkspaceTask,
    trigger?: HTMLButtonElement,
    cameraId?: string,
  ) => void;
  ppeExpandSignal?: number;
  autoExpandPpeCameraId?: string | null;
  onOpenApply?: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const catalogId = useId();
  const [lastRequestedId, setLastRequestedId] = useState(requestedCameraId);
  const [focusOverrideId, setInternalFocusedCameraId] = useState<string | null>(null);
  const [internalTask, setInternalTask] = useState<{
    cameraId: string;
    task: CameraWorkspaceTask;
  } | null>(null);
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
  const effectiveActiveTask: CameraWorkspaceTask | null =
    controlledActiveTask !== undefined
      ? controlledActiveTask
      : !selectedCamera || selectedCamera.status !== 'ACTIVE'
        ? null
        : inlineRegionStage
          ? 'regions'
          : internalTask?.cameraId === selectedCamera.id
            ? internalTask.task
            : sourceSetupStage
              ? 'source'
              : null;
  const handleSelectTask = (
    task: CameraWorkspaceTask,
    trigger?: HTMLButtonElement,
    targetCameraId?: string,
  ) => {
    if (onSelectTask) {
      onSelectTask(task, trigger, targetCameraId);
      return;
    }
    const cameraId = targetCameraId ?? selectedCamera?.id;
    if (!cameraId) return;
    if (targetCameraId && targetCameraId !== selectedCamera?.id) {
      setFocusedCameraId(targetCameraId);
    }
    if (task === 'regions') {
      open('regions', cameraId, trigger);
      setInternalTask({ cameraId, task: 'regions' });
      return;
    }
    setInternalTask({ cameraId, task });
    if (task === 'ppe') {
      setPpeExpandRequest((prev) => ({ cameraId, seq: (prev?.seq ?? 0) + 1 }));
    }
  };
  const activePpeExpandSignal =
    controlledPpeExpandSignal !== undefined
      ? controlledPpeExpandSignal
      : ppeExpandRequest && selectedCamera && ppeExpandRequest.cameraId === selectedCamera.id
        ? ppeExpandRequest.seq
        : 0;
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
  const showMasterDetail = canReadCameras && !cameras.baseError && rows.length > 0;
  const hasMobileCatalogControls = Boolean(
    cameraError || showLinkedCameraNotice || (!cameras.baseError && cameras.hasNextPage),
  );
  const primarySurface = 'min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:p-4';
  const railInlineAction =
    'inline-flex min-h-8 items-center rounded-md px-1.5 py-1 text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-[#0F172A] hover:decoration-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer';
  return (
    <div>
      <section className={primarySurface} aria-label={t('cameraSetup.cameras')}>
        <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1.5 border-b border-slate-200 pb-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="text-base font-bold tracking-tight text-slate-950">
              {t('cameraSetup.cameras')}
            </h2>
            <p className="hidden xl:inline text-xs text-slate-500">
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
        {canReadCameras && showMasterDetail && (
          <div
            data-testid="camera-setup-workspace-grid"
            className="mt-3 grid grid-cols-1 items-start gap-4 lg:grid-cols-[14.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]"
          >
            <div
              data-testid="camera-setup-source-rail"
              className={`${
                hasMobileCatalogControls
                  ? 'min-w-0 space-y-2 lg:space-y-2.5'
                  : 'hidden min-w-0 space-y-2.5 lg:block'
              } lg:sticky lg:top-20`}
            >
              {hasLoadedCameraPages && (
                <div
                  className={`${
                    !cameras.baseError && cameras.hasNextPage ? 'flex' : 'hidden lg:flex'
                  } flex-wrap items-center justify-between gap-2 px-0.5`}
                >
                  <p className="text-xs font-medium text-slate-600 tabular-nums">
                    {t('cameraSetup.count', { loaded: rows.length, total: cameras.total })}
                  </p>
                </div>
              )}
              {cameraError}
              <ul
                data-testid="camera-setup-source-list"
                className="hidden lg:block divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
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
                      className={`min-w-0 space-y-2 border-l-[3px] px-3.5 py-3 transition-colors ${
                        isSelectedCamera
                          ? 'border-l-[#0F172A] bg-slate-100/75'
                          : 'border-l-transparent bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="min-w-0 space-y-1.5">
                        <h3
                          id={nameId}
                          className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base leading-snug font-semibold tracking-tight text-slate-950"
                        >
                          {canManageCameras ? (
                            <button
                              type="button"
                              aria-haspopup={!isEnabled ? 'dialog' : undefined}
                              className="cursor-pointer rounded-md text-left underline decoration-slate-300 underline-offset-4 hover:decoration-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F172A]"
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
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              aria-pressed={isSelectedCamera}
                              className={
                                isSelectedCamera
                                  ? 'inline-flex min-h-8 items-center rounded-lg bg-[#0F172A] px-2.5 py-1 text-sm font-semibold text-white cursor-pointer'
                                  : 'inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer'
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
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              {isEnabled && (
                                <button
                                  type="button"
                                  className={railInlineAction}
                                  aria-describedby={nameId}
                                  onClick={(event) => {
                                    setFocusedCameraId(row.id);
                                    open('regions', row.id, event.currentTarget);
                                  }}
                                >
                                  {t('cameraSetup.regionsAction')}
                                </button>
                              )}
                              {isEnabled && policyContext && (
                                <button
                                  type="button"
                                  className={railInlineAction}
                                  aria-describedby={nameId}
                                  onClick={(event) => {
                                    handleSelectTask('ppe', event.currentTarget, row.id);
                                  }}
                                >
                                  {t('cameraSetup.ppeAction')}
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${railInlineAction} shrink-0`}
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
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              <Link
                                id={ppeMonitorId}
                                aria-labelledby={`${ppeMonitorId} ${nameId}`}
                                className={`${railInlineAction} shrink-0`}
                                to={`/ppe?${monitorParams}`}
                              >
                                {t('cameraSetup.monitorPpe')}
                              </Link>
                              <Link
                                id={zonesMonitorId}
                                aria-labelledby={`${zonesMonitorId} ${nameId}`}
                                className={`${railInlineAction} shrink-0`}
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
              {showLinkedCameraNotice && (
                <p
                  role="status"
                  data-testid="camera-setup-linked-notice"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600"
                >
                  {t(
                    cameras.hasNextPage
                      ? 'cameraSetup.linkedCameraMore'
                      : 'cameraSetup.linkedCameraUnavailable',
                  )}
                </p>
              )}
              {!cameras.baseError && cameras.hasNextPage && (
                <div className="pt-0.5 lg:pt-1">
                  <button
                    type="button"
                    data-testid="camera-setup-load-more"
                    className={`${button} w-full`}
                    disabled={cameras.isFetching}
                    onClick={cameras.loadMore}
                  >
                    {t('cameraSetup.camerasMore')}
                  </button>
                </div>
              )}
            </div>

            <div data-testid="camera-setup-detail-pane" className="min-w-0 space-y-3">
              <CameraSetupContextBar
                compact
                siteId={siteId}
                siteCode={siteCode}
                siteName={siteName}
                rows={rows}
                selectedCamera={selectedCamera}
                canManageCameras={canManageCameras}
                canOpenMonitoring={canOpenMonitoring}
                open={open}
                onSelectCamera={rows.length > 1 ? setFocusedCameraId : undefined}
                hasSourceTask={Boolean(sourceSetupStage)}
                activeTask={effectiveActiveTask}
                onSelectTask={handleSelectTask}
                onOpenPpePolicy={
                  policyContext && selectedCamera
                    ? () => handleSelectTask('ppe', undefined, selectedCamera.id)
                    : undefined
                }
                statusContext={statusContext}
                applySlot={applySavedBar}
                diagnosticsSlot={
                  !cameras.isPending ? (
                    <CameraSetupChecklist
                      compact
                      siteId={siteId}
                      selectedCamera={selectedCamera}
                      policyContext={policyContext}
                      statusContext={statusContext}
                    />
                  ) : undefined
                }
              />
              {selectedCamera && selectedCamera.status !== 'ACTIVE' ? (
                <>
                  <div
                    data-testid="camera-setup-disabled-stage"
                    className="min-w-0 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 space-y-3"
                  >
                    <div className="space-y-1">
                      <h3 className="text-base font-bold tracking-tight text-slate-900">
                        {t('cameraSetup.disabledStageHeading')}
                      </h3>
                      <p className="text-sm leading-relaxed text-slate-600 break-words [overflow-wrap:anywhere]">
                        {t(
                          canManageCameras
                            ? 'cameraSetup.disabledStageBody'
                            : 'cameraSetup.disabledStageReadOnlyBody',
                          {
                            name: selectedCamera.name,
                            code: selectedCamera.code,
                            version: selectedCamera.configurationVersion,
                          },
                        )}
                      </p>
                    </div>
                    {canManageCameras && (
                      <div>
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.secondary}
                          onClick={(event) =>
                            open('manage', selectedCamera.id, event.currentTarget)
                          }
                        >
                          {t('cameraSetup.disabledStageAction', { code: selectedCamera.code })}
                        </button>
                      </div>
                    )}
                  </div>
                  {sourceSetupStage}
                  {policyContext && (
                    <CameraPpePolicyPanel
                      key={selectedCamera.id}
                      cameraId={selectedCamera.id}
                      camera={selectedCamera}
                      context={policyContext}
                      statusContext={statusContext}
                      canWrite={canManageCameras}
                      embeddedInTab
                      defaultOpen={false}
                      onOpenReference={(trigger) => open('regions', selectedCamera.id, trigger)}
                      onOpenApply={onOpenApply}
                    />
                  )}
                </>
              ) : effectiveActiveTask === 'regions' && inlineRegionStage ? (
                inlineRegionStage
              ) : effectiveActiveTask === 'source' && sourceSetupStage ? (
                sourceSetupStage
              ) : selectedCamera &&
                policyContext &&
                (effectiveActiveTask === 'ppe' ||
                  (!sourceSetupStage && effectiveActiveTask === null)) ? (
                <CameraPpePolicyPanel
                  key={selectedCamera.id}
                  cameraId={selectedCamera.id}
                  camera={selectedCamera}
                  context={policyContext}
                  statusContext={statusContext}
                  canWrite={canManageCameras}
                  embeddedInTab
                  defaultOpen={
                    effectiveActiveTask === 'ppe' || autoExpandPpeCameraId === selectedCamera.id
                  }
                  onOpenChange={(isOpen) => {
                    if (isOpen && effectiveActiveTask !== 'ppe') {
                      handleSelectTask('ppe', undefined, selectedCamera.id);
                    }
                  }}
                  onOpenReference={(trigger) => open('regions', selectedCamera.id, trigger)}
                  onOpenApply={onOpenApply}
                  expandSignal={activePpeExpandSignal}
                />
              ) : null}
            </div>
          </div>
        )}
        {canReadCameras && !showMasterDetail && (
          <div className="mt-4 space-y-4">
            {!cameras.baseError && !cameras.isPending && (
              <CameraSetupChecklist
                siteId={siteId}
                selectedCamera={selectedCamera}
                policyContext={policyContext}
                statusContext={statusContext}
              />
            )}
            {!cameras.baseError && !canManageCameras && (
              <CameraSetupContextBar
                siteId={siteId}
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
                className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 text-sm text-slate-500"
              >
                {t('cameraSetup.loading')}
              </p>
            )}
            {cameraError}
            {cameras.settledEmpty && (
              <div
                role="status"
                data-testid="camera-setup-empty-catalog"
                className="space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-6 text-center"
              >
                <p className="text-base font-semibold text-slate-900">
                  {t('cameraSetup.noCameras')}
                </p>
                <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-600">
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
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
              >
                {t(
                  cameras.hasNextPage
                    ? 'cameraSetup.linkedCameraMore'
                    : 'cameraSetup.linkedCameraUnavailable',
                )}
              </p>
            )}
            {showPartialPageNotice && (
              <p role="status" className="text-sm text-slate-600">
                {t('cameraSetup.partial')}
              </p>
            )}
            {!cameras.baseError && cameras.hasNextPage && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className={button}
                  disabled={cameras.isFetching}
                  onClick={cameras.loadMore}
                >
                  {t('cameraSetup.camerasMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
