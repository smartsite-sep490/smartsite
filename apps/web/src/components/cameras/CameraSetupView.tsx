import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconShield, IconX } from '../icons';
import { getOpaqueTokenNonce, getZonePpeScopeKey } from '../ppe/zone-ppe-scope';
import { registerZonePpeDialogCopy } from '../ppe/zone-ppe-dialog-copy';
import { ZonePpeSetupDialog } from '../ppe/ZonePpeSetupDialog';
import { ZonePpeSetupPanel, type ZonePpeSetupPanelProps } from '../ppe/ZonePpeSetupPanel';
import { CameraDiscardBanner } from './CameraDialogPrimitives';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import './camera-setup-catalog-copy';
import './camera-setup-workspace-copy';
import { CameraManagementDialog } from './CameraManagementDialog';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { CameraSetupTour } from './CameraSetupTour';
import { useCameraSetupWorkspace } from './useCameraSetupWorkspace';

registerZonePpeDialogCopy();

const button = CAMERA_BUTTON_STYLES.secondary;
const surface =
  'min-w-0 rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-xs sm:px-5 sm:py-4';
export type CameraSetupViewProps = { apiUrl: string; sharedSession: SharedSession | null };

export function CameraSetupView({ apiUrl, sharedSession }: CameraSetupViewProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const cache = useQueryClient();
  if (!sharedSession?.accessToken || !sharedSession.sessionScope)
    return <p role="status">{t('cameraSetup.session')}</p>;
  const roles = sharedSession.user.roleAssignments;
  const allowed =
    !sharedSession.user.mustChangePassword &&
    roles.some(
      (role) =>
        (role.role === 'ADMIN' && role.siteId === null) ||
        (role.role === 'SITE_MANAGER' && role.siteId !== null),
    );
  if (!allowed) return <p role="alert">{t('cameraSetup.denied')}</p>;
  const key = JSON.stringify([
    apiUrl,
    sharedSession.sessionScope,
    sharedSession.user.id,
    getOpaqueTokenNonce(cache, sharedSession.accessToken),
    roles,
  ]);
  return <SetupWorkspace key={key} apiUrl={apiUrl} session={sharedSession} />;
}

function SetupWorkspace({ apiUrl, session }: { apiUrl: string; session: SharedSession }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const cache = useQueryClient();
  const {
    client,
    key,
    params,
    sites,
    cameras,
    requestedSite,
    site,
    rows,
    capabilities,
    canReadZones,
    canReadCameras,
    canManageCameras,
    canAccessTourZones,
    canOpenMonitoring,
    tourScopeKey,
    isTourAuthorized,
    returnParams,
    activeDialog,
    selectedCamera,
    revoked,
    isSessionRevoked,
    common,
    isCurrentDialog,
    open,
    close,
    selectSite,
    refreshCameras,
    publishCameraUpdate,
    syncActiveRegionCameraParam,
    handleStatusUnauthorized,
  } = useCameraSetupWorkspace(apiUrl, session);

  const requestedCameraId = params.get('cameraId');
  const [focusSelection, setFocusSelection] = useState<{
    siteId: string;
    requestedId: string | null;
    cameraId: string;
  } | null>(null);
  const [inlineRegionDraft, setInlineRegionDraft] = useState({ dirty: false, saving: false });
  const [pendingInlineExit, setPendingInlineExit] = useState<
    { kind: 'close' } | { kind: 'focus'; cameraId: string } | null
  >(null);
  const isInlineRegionsOpen = Boolean(site && activeDialog?.kind === 'regions' && canManageCameras);
  const effectiveRegionDraft = isInlineRegionsOpen
    ? inlineRegionDraft
    : { dirty: false, saving: false };
  const effectivePendingInlineExit = isInlineRegionsOpen ? pendingInlineExit : null;

  const invalidateRegionSetupCaches = (targetSiteId: string) => {
    void cache.invalidateQueries({ queryKey: [...key, 'ppe-policy'] });
    void cache.invalidateQueries({ queryKey: [...key, targetSiteId] });
  };

  const applyCameraFocusSwitch = (cameraId: string) => {
    if (!site) return;
    setPendingInlineExit(null);
    setFocusSelection({
      siteId: site.id,
      requestedId: requestedCameraId,
      cameraId,
    });
    if (activeDialog?.kind === 'regions') {
      const nextCam = rows.find((row) => row.id === cameraId);
      if (nextCam?.status === 'INACTIVE') {
        invalidateRegionSetupCaches(site.id);
        close();
      } else if (nextCam?.status === 'ACTIVE' && cameraId !== activeDialog.cameraId) {
        open('regions', cameraId);
      }
    }
  };

  const requestCloseInlineRegions = () => {
    if (!isCurrentDialog() || !site || effectiveRegionDraft.saving) return;
    if (effectiveRegionDraft.dirty) {
      setPendingInlineExit({ kind: 'close' });
      return;
    }
    setPendingInlineExit(null);
    invalidateRegionSetupCaches(site.id);
    close();
  };

  const confirmDiscardInlineRegions = () => {
    if (!site || effectiveRegionDraft.saving) return;
    const pending = effectivePendingInlineExit;
    setInlineRegionDraft({ dirty: false, saving: false });
    setPendingInlineExit(null);
    if (pending?.kind === 'focus') {
      applyCameraFocusSwitch(pending.cameraId);
      return;
    }
    invalidateRegionSetupCaches(site.id);
    close();
  };
  const focusedCameraId =
    site && focusSelection?.siteId === site.id && focusSelection.requestedId === requestedCameraId
      ? focusSelection.cameraId
      : null;
  const catalogSelectedCamera =
    (focusedCameraId ? rows.find((row) => row.id === focusedCameraId) : undefined) ??
    (requestedCameraId ? rows.find((row) => row.id === requestedCameraId) : undefined) ??
    rows[0] ??
    null;
  const headerReturnParams = new URLSearchParams(returnParams);
  if (
    site &&
    !sites.baseError &&
    !cameras.baseError &&
    focusedCameraId &&
    catalogSelectedCamera?.id === focusedCameraId &&
    catalogSelectedCamera.status === 'ACTIVE'
  ) {
    headerReturnParams.set('cameraId', catalogSelectedCamera.id);
  } else if (
    site &&
    !sites.baseError &&
    !cameras.baseError &&
    !headerReturnParams.has('cameraId') &&
    !requestedCameraId &&
    catalogSelectedCamera?.status === 'ACTIVE'
  ) {
    headerReturnParams.set('cameraId', catalogSelectedCamera.id);
  }

  const errorNotice = (catalog: typeof sites | typeof cameras) =>
    catalog.error && (
      <div
        role="alert"
        className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950"
      >
        <p>
          {t(
            catalog.status === 403 || catalog.status === 404
              ? 'cameraSetup.forbidden'
              : 'cameraSetup.error',
          )}
        </p>
        {catalog.baseError && catalog.status !== 401 && (
          <button
            className={button}
            type="button"
            disabled={catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            {t('cameraSetup.retry')}
          </button>
        )}
      </div>
    );

  if (isSessionRevoked) return <p role="alert">{t('cameraSetup.session')}</p>;

  const inlineRegionPanelProps: ZonePpeSetupPanelProps | null =
    site && activeDialog?.kind === 'regions' && canManageCameras
      ? {
          ...common,
          section: 'regions',
          initialCameraId: activeDialog.cameraId,
          onSelectCamera: (cameraId) => {
            if (isCurrentDialog()) syncActiveRegionCameraParam(cameraId, true);
          },
          canReadZones,
          canManageZones: capabilities.canManageZones,
          canManageRegions: canManageCameras,
          onClose: requestCloseInlineRegions,
          onDraftStateChange: setInlineRegionDraft,
        }
      : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-950">
            {t('cameraSetup.title')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
            {t('cameraSetup.intro')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CameraSetupTour
            userId={session.user.id}
            tourScopeKey={`${tourScopeKey}:${catalogSelectedCamera?.id ?? 'none'}`}
            isAuthorized={isTourAuthorized}
            hasSiteScope={Boolean(site && !sites.isPending && !sites.baseError)}
            canManageCameras={canManageCameras}
            canAccessZones={canAccessTourZones}
            selectedCamera={catalogSelectedCamera}
          />
          {canOpenMonitoring && (
            <nav
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-1"
              aria-label={t('cameraSetup.monitor')}
            >
              <Link className={button} to={site ? `/ppe?${headerReturnParams}` : '/ppe'}>
                {t('cameraSetup.monitorPpe')}
              </Link>
              <Link className={button} to={site ? `/zones?${headerReturnParams}` : '/zones'}>
                {t('cameraSetup.monitorZones')}
              </Link>
            </nav>
          )}
        </div>
      </header>
      <section
        className={surface}
        aria-label={t('cameraSetup.site')}
        data-tour-anchor="camera-setup-scope"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <label
              className="shrink-0 text-sm font-semibold text-slate-800"
              htmlFor="camera-setup-site"
            >
              {t('cameraSetup.site')}
            </label>
            <select
              id="camera-setup-site"
              value={site?.id ?? ''}
              disabled={sites.baseError || sites.isPending}
              className="min-h-10 w-full min-w-0 max-w-md rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-900 shadow-2xs transition-colors hover:border-slate-400 focus-visible:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              onChange={(event) => {
                selectSite(event.target.value);
              }}
            >
              <option value="" disabled>
                {t('cameraSetup.chooseSite')}
              </option>
              {sites.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} · {row.name}
                </option>
              ))}
            </select>
          </div>
          {sites.hasNextPage && !sites.baseError && (
            <button
              className={button}
              type="button"
              disabled={sites.isFetching}
              onClick={sites.loadMore}
            >
              {t('cameraSetup.sitesMore')}
            </button>
          )}
        </div>
        {sites.isPending && (
          <p role="status" className="mt-3 text-xs text-slate-500">
            {t('cameraSetup.loading')}
          </p>
        )}
        {errorNotice(sites)}
        {sites.settledEmpty && (
          <p role="status" className="mt-3 text-xs text-slate-500">
            {t('cameraSetup.noSites')}
          </p>
        )}
        {Boolean(
          requestedSite && !site && !sites.isPending && !sites.baseError && sites.rows.length > 0,
        ) && (
          <p role="status" className="mt-3 text-xs text-slate-600">
            {t('cameraSetup.linkedSelection')}
          </p>
        )}
      </section>
      {site && (
        <CameraSetupCatalog
          key={site.id}
          siteId={site.id}
          siteCode={site.code}
          siteName={site.name}
          canOpenMonitoring={canOpenMonitoring && !sites.baseError && !cameras.baseError}
          capabilities={capabilities}
          canReadZones={canReadZones}
          canReadCameras={canReadCameras}
          cameras={cameras}
          rows={rows}
          requestedCameraId={requestedCameraId}
          focusedCameraId={focusedCameraId}
          onFocusCamera={(cameraId) => {
            if (!site) return;
            if (isInlineRegionsOpen) {
              if (effectiveRegionDraft.saving) return;
              if (effectiveRegionDraft.dirty && cameraId !== activeDialog?.cameraId) {
                setPendingInlineExit({ kind: 'focus', cameraId });
                return;
              }
            }
            applyCameraFocusSwitch(cameraId);
          }}
          cameraError={errorNotice(cameras)}
          open={open}
          inlineRegionStage={
            inlineRegionPanelProps ? (
              <InlineRegionSetupStage
                key={`regions:${activeDialog?.cameraId ?? ''}:${getZonePpeScopeKey(cache, inlineRegionPanelProps)}`}
                panelProps={inlineRegionPanelProps}
                confirmDiscard={Boolean(effectivePendingInlineExit)}
                saving={effectiveRegionDraft.saving}
                onKeepEditing={() => setPendingInlineExit(null)}
                onDiscardChanges={confirmDiscardInlineRegions}
              />
            ) : undefined
          }
          policyContext={
            canReadCameras && !revoked && !sites.baseError && !cameras.baseError
              ? {
                  setupKey: key,
                  token: session.accessToken,
                  siteId: site.id,
                  client,
                  onUnauthorized: () => handleStatusUnauthorized(site.id),
                }
              : undefined
          }
          statusContext={{
            setupKey: key,
            token: session.accessToken,
            siteId: site.id,
            client,
            enabled: Boolean(canReadCameras && !revoked && !sites.baseError && !cameras.baseError),
            onUnauthorized: () => {
              handleStatusUnauthorized(site.id);
            },
          }}
        />
      )}
      {site && activeDialog?.kind === 'register' && canManageCameras && (
        <CameraRegistrationDialog
          {...common}
          open
          onCreated={(createdCamera?: CameraResponse) => {
            if (
              !isCurrentDialog() ||
              !site ||
              revoked ||
              sites.baseError ||
              cameras.baseError ||
              (createdCamera && createdCamera.siteId !== site.id)
            ) {
              return;
            }
            close();
            refreshCameras(createdCamera?.id);
          }}
        />
      )}
      {site && activeDialog?.kind === 'manage' && selectedCamera && canManageCameras && (
        <CameraManagementDialog
          {...common}
          open
          camera={selectedCamera}
          onUpdated={(updatedCamera) => {
            if (
              !isCurrentDialog() ||
              !site ||
              revoked ||
              sites.baseError ||
              cameras.baseError ||
              !updatedCamera ||
              updatedCamera.id !== selectedCamera.id ||
              updatedCamera.siteId !== site.id ||
              updatedCamera.configurationVersion < selectedCamera.configurationVersion
            ) {
              return;
            }
            publishCameraUpdate(site.id, updatedCamera);
          }}
        />
      )}
      {site && activeDialog?.kind === 'zones' && (
        <ZonePpeSetupDialog
          key={`zones:${activeDialog.cameraId ?? ''}`}
          {...common}
          onClose={() => {
            if (!isCurrentDialog()) return;
            close();
          }}
          section="zones"
          canReadZones={canReadZones}
          canManageZones={capabilities.canManageZones}
          canManageRegions={canManageCameras}
        />
      )}
    </div>
  );
}

function InlineRegionSetupStage({
  panelProps,
  confirmDiscard,
  saving,
  onKeepEditing,
  onDiscardChanges,
}: {
  panelProps: ZonePpeSetupPanelProps;
  confirmDiscard: boolean;
  saving: boolean;
  onKeepEditing: () => void;
  onDiscardChanges: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const stageRef = useRef<HTMLElement>(null);
  const onDraftStateChange = panelProps.onDraftStateChange;
  useLayoutEffect(() => {
    return () => {
      onDraftStateChange?.({ dirty: false, saving: false });
    };
  }, [onDraftStateChange]);

  useEffect(() => {
    stageRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  return (
    <section
      ref={stageRef}
      data-testid="camera-setup-inline-region-stage"
      aria-label={t('regionSetup.title')}
      className="min-w-0 rounded-2xl border border-slate-300 bg-white p-3 sm:p-5 shadow-xs space-y-4"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 pb-3.5 min-w-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shrink-0">
            <IconShield className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-slate-950 break-words [overflow-wrap:anywhere]">
              {t('regionSetup.title')}
            </h3>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600 break-words [overflow-wrap:anywhere]">
              {t('regionSetup.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={panelProps.onClose}
          disabled={saving}
          aria-label={t('zoneSetup.closeAria')}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>
      {confirmDiscard && (
        <CameraDiscardBanner
          disabled={saving}
          onKeepEditing={onKeepEditing}
          onDiscardChanges={onDiscardChanges}
        />
      )}
      <ZonePpeSetupPanel {...panelProps} embedded />
    </section>
  );
}
