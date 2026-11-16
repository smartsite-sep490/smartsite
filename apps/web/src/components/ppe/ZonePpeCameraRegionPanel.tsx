import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconCamera, IconCheck, IconX } from '../icons';
import {
  getOpaqueTokenNonce,
  registerCameraRegionPanelCatalog,
  type ZonePpeCameraRegionPanelProps,
} from './camera-region-panel-catalog';
import { CameraRegionList } from './CameraRegionList';
import { CameraRegionReferenceStatusCard } from './CameraRegionReferenceControls';
import { CameraRegionSelectionControls } from './CameraRegionSelectionControls';
import { regionPolygonEditorCatalog } from './region-polygon-editor-catalog';
import { useZonePpeCameraRegionPanel } from './useZonePpeCameraRegionPanel';
import { ZonePpeCameraRegionDrawer } from './ZonePpeCameraRegionDrawer';

void regionPolygonEditorCatalog;

export type { ZonePpeCameraRegionPanelProps };

registerCameraRegionPanelCatalog();

export function ZonePpeCameraRegionPanel(props: ZonePpeCameraRegionPanelProps) {
  const queries = useQueryClient();
  const internalNonce = useMemo(
    () => getOpaqueTokenNonce(queries, props.token),
    [queries, props.token],
  );
  return (
    <ZonePpeCameraRegionPanelContent
      key={JSON.stringify([
        props.apiUrl,
        props.sessionScope,
        props.siteId,
        props.credentialId,
        internalNonce,
        props.initialCameraId ?? '',
      ])}
      {...props}
      internalNonce={internalNonce}
      zones={props.zones.filter((zone) => zone.siteId === props.siteId)}
    />
  );
}

function ZonePpeCameraRegionPanelContent(
  props: ZonePpeCameraRegionPanelProps & { internalNonce: number },
) {
  registerCameraRegionPanelCatalog();
  const {
    embedded = false,
    apiUrl,
    token,
    sessionScope,
    credentialId,
    siteId,
    zones,
    tourUserId,
    onDraftStateChange,
    onClose,
    internalNonce,
  } = props;
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const panel = useZonePpeCameraRegionPanel(props);
  const [drawerDraft, setDrawerDraft] = useState({ dirty: false, saving: false });
  const [pendingScopeSwitch, setPendingScopeSwitch] = useState<
    { kind: 'zone'; id: string } | { kind: 'camera'; id: string } | null
  >(null);
  const handleDrawerDraftChange = useCallback(
    (state: { dirty: boolean; saving: boolean }) => {
      setDrawerDraft(state);
      if (!state.dirty) setPendingScopeSwitch(null);
      onDraftStateChange?.(state);
    },
    [onDraftStateChange],
  );
  const requestZoneChange = (zoneId: string) => {
    if (drawerDraft.saving || zoneId === panel.selectedZoneId) return;
    if (panel.isCurrentScopeActive && drawerDraft.dirty) {
      setPendingScopeSwitch({ kind: 'zone', id: zoneId });
      return;
    }
    setPendingScopeSwitch(null);
    panel.handleZoneChange(zoneId);
  };
  const requestCameraChange = (cameraId: string) => {
    if (drawerDraft.saving || cameraId === panel.selectedCameraId) return;
    if (panel.isCurrentScopeActive && drawerDraft.dirty) {
      setPendingScopeSwitch({ kind: 'camera', id: cameraId });
      return;
    }
    setPendingScopeSwitch(null);
    panel.handleCameraChange(cameraId);
  };
  const startDrawingHintKey = panel.canStartDrawing
    ? 'regionSetup.action.startDrawingHint'
    : zones.length === 0
      ? 'regionSetup.action.hintNoZones'
      : !panel.selectedCamera
        ? 'regionSetup.action.hintNoActiveCamera'
        : panel.statusCardReference &&
            (panel.isStatusCardReferenceExpired ||
              panel.statusCardReference.configurationVersion !==
                panel.selectedCamera.configurationVersion)
          ? 'regionSetup.action.hintExpiredOrRevision'
          : 'regionSetup.action.hintNeedReference';

  return (
    <div
      role={embedded ? undefined : 'region'}
      aria-label={embedded ? undefined : t('regionSetup.sectionAria')}
      className={
        embedded
          ? `${panel.isCurrentScopeActive ? 'space-y-3' : 'space-y-5'} min-w-0`
          : 'rounded-2xl border border-slate-200/80 bg-white p-6 space-y-5 min-w-0 w-full max-w-full shadow-sm'
      }
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900 flex-shrink-0">
              <IconCamera className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {t('regionSetup.title')}
              </h3>
              <p className="text-xs text-slate-500 truncate mt-0.5">{t('regionSetup.subtitle')}</p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('regionSetup.closeAria')}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {panel.successFeedback && (
        <div
          role="status"
          data-testid="region-saved-feedback"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-2 min-w-0 w-full"
        >
          <div className="flex items-start gap-2 min-w-0">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold break-words">{panel.successFeedback}</p>
              {panel.savedRegionInfo && (
                <p className="text-emerald-800 break-words">
                  {t('regionSetup.feedback.reloadHint', {
                    configVersion: panel.savedRegionInfo.configurationVersion,
                  })}
                </p>
              )}
            </div>
          </div>
          {panel.savedRegionInfo && panel.canRequestReference && (
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="region-saved-reload-reference"
                disabled={panel.configReference.isLoading}
                onClick={panel.handleRequestReference}
                className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                {t('regionSetup.feedback.reloadReferenceBtn', {
                  configVersion: panel.savedRegionInfo.configurationVersion,
                })}
              </button>
            </div>
          )}
        </div>
      )}

      <CameraRegionSelectionControls
        zones={zones}
        selectedZoneId={panel.selectedZoneId}
        onZoneChange={requestZoneChange}
        selectedCameraId={panel.selectedCameraId}
        onCameraChange={requestCameraChange}
        allFetchedCameras={panel.allFetchedCameras}
        visibleActiveCameras={panel.visibleActiveCameras}
        cameraServerTotal={panel.cameraServerTotal}
        isCamerasInitialLoading={panel.isCamerasInitialLoading}
        cameraError={panel.cameraError}
        isCameraBaseError={panel.isCameraBaseError}
        isTransientNextCameraError={panel.isTransientNextCameraError}
        isFetchingCameras={panel.camerasInfiniteQuery.isFetching}
        hasNextCameraPage={Boolean(panel.camerasInfiniteQuery.hasNextPage)}
        isSaving={drawerDraft.saving}
        onRetryInitialCameras={() => {
          if (panel.camerasInfiniteQuery.isFetching) return;
          void panel.camerasInfiniteQuery.refetch({ cancelRefetch: false });
        }}
        onFetchNextCameras={() => {
          if (panel.camerasInfiniteQuery.isFetching) return;
          void panel.camerasInfiniteQuery.fetchNextPage({ cancelRefetch: false });
        }}
      />

      {pendingScopeSwitch && panel.isCurrentScopeActive && drawerDraft.dirty && (
        <div
          role="alert"
          data-testid="region-scope-discard-prompt"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"
        >
          <span className="font-medium">{t('regionSetup.drawer.discardPrompt')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={drawerDraft.saving}
              onClick={() => setPendingScopeSwitch(null)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {t('regionSetup.drawer.keepEditing')}
            </button>
            <button
              type="button"
              disabled={drawerDraft.saving}
              onClick={() => {
                const target = pendingScopeSwitch;
                setPendingScopeSwitch(null);
                setDrawerDraft({ dirty: false, saving: false });
                onDraftStateChange?.({ dirty: false, saving: false });
                if (target.kind === 'zone') panel.handleZoneChange(target.id);
                else panel.handleCameraChange(target.id);
              }}
              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
            >
              {t('regionSetup.drawer.confirmDiscard')}
            </button>
          </div>
        </div>
      )}

      <div className={panel.isCurrentScopeActive ? 'space-y-2.5' : 'space-y-3'}>
        {panel.activeMutationScopeError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {t(
              panel.activeMutationScopeError.status === 401
                ? 'regionSetup.error.401'
                : panel.activeMutationScopeError.status === 403
                  ? 'regionSetup.error.403'
                  : 'regionSetup.reference.error.404',
            )}
          </p>
        )}

        <CameraRegionReferenceStatusCard
          reference={panel.statusCardReference}
          isExpired={panel.isStatusCardReferenceExpired}
          expectedConfigurationVersion={panel.selectedCamera?.configurationVersion ?? null}
          isLoading={panel.configReference.isLoading}
          error={panel.configReference.error}
          canRequest={panel.canRequestReference}
          isDrawingActive={panel.isCurrentScopeActive}
          onRequestReference={panel.handleRequestReference}
        />

        {!panel.isCurrentScopeActive && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={panel.handleStartDrawing}
              disabled={!panel.canStartDrawing}
              className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {t('regionSetup.action.startDrawing')}
            </button>

            <span data-testid="region-start-drawing-hint" className="text-xs text-slate-600">
              {t(startDrawingHintKey)}
            </span>
          </div>
        )}

        {panel.isCurrentScopeActive &&
          panel.drawingScope &&
          panel.selectedCamera &&
          panel.selectedZone && (
            <ZonePpeCameraRegionDrawer
              key={`${apiUrl}:${sessionScope}:${internalNonce}:${siteId}:${panel.selectedCameraId}:${panel.selectedZoneId}:${panel.drawingScope.editingRegion?.id ?? 'new'}`}
              apiUrl={apiUrl}
              client={panel.client}
              token={token}
              sessionScope={sessionScope}
              credentialId={credentialId}
              internalNonce={internalNonce}
              siteId={siteId}
              selectedCamera={panel.selectedCamera}
              selectedZone={panel.selectedZone}
              frozenReference={panel.drawingScope.reference}
              candidateReference={panel.candidateReference}
              editingRegion={panel.drawingScope.editingRegion}
              tourUserId={tourUserId}
              lastSavedDraft={panel.lastSavedDraft}
              onAcceptCandidateReference={panel.handleAcceptCandidateReference}
              onScopeRevoked={panel.handleScopeRevoked}
              onCancelCandidateReview={panel.handleCancelCandidateReview}
              onSaveSuccess={panel.handleSaveSuccess}
              onDraftStateChange={handleDrawerDraftChange}
              onClose={() => {
                setPendingScopeSwitch(null);
                setDrawerDraft({ dirty: false, saving: false });
                onDraftStateChange?.({ dirty: false, saving: false });
                panel.handleCloseDrawer();
              }}
            />
          )}
      </div>

      <CameraRegionList
        selectedCameraId={panel.selectedCameraId}
        isCameraBaseError={panel.isCameraBaseError}
        isLoadingCameras={panel.camerasInfiniteQuery.isLoading}
        allFetchedRegions={panel.allFetchedRegions}
        visibleLinkedRegions={panel.visibleLinkedRegions}
        regionServerTotal={panel.regionServerTotal}
        isRegionsInitialLoading={panel.isRegionsInitialLoading}
        regionError={panel.regionError}
        isRegionBaseError={panel.isRegionBaseError}
        isTransientNextRegionError={panel.isTransientNextRegionError}
        isFetchingRegions={panel.regionsInfiniteQuery.isFetching}
        hasNextRegionPage={Boolean(panel.regionsInfiniteQuery.hasNextPage)}
        canStartDrawing={panel.canStartDrawing}
        isCurrentScopeActive={panel.isCurrentScopeActive}
        onStartEditingRegion={panel.handleStartEditingRegion}
        onRetryInitialRegions={() => {
          if (panel.regionsInfiniteQuery.isFetching) return;
          void panel.regionsInfiniteQuery.refetch({ cancelRefetch: false });
        }}
        onFetchNextRegions={() => {
          if (panel.regionsInfiniteQuery.isFetching) return;
          void panel.regionsInfiniteQuery.fetchNextPage({ cancelRefetch: false });
        }}
      />
    </div>
  );
}
