import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import { ZonePpeSetupDialog } from '../ppe/ZonePpeSetupDialog';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import { CAMERA_SETUP_TOUR_VERSION } from '../safety/safetyTaskTourModel';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import './camera-setup-catalog-copy';
import './camera-setup-workspace-copy';
import { CameraManagementDialog } from './CameraManagementDialog';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { useCameraSetupWorkspace } from './useCameraSetupWorkspace';

const button = CAMERA_BUTTON_STYLES.secondary;
const surface = 'min-w-0 rounded-2xl border border-slate-200/90 bg-white px-5 py-4 shadow-xs';
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
    canOpenMonitoring,
    setupTourSteps,
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

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {t('cameraSetup.title')}
          </h1>
          <p className="max-w-xl text-xs leading-5 text-slate-500">{t('cameraSetup.intro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SafetyTaskTour
            taskId="camera-setup"
            tourVersion={CAMERA_SETUP_TOUR_VERSION}
            userId={session.user.id}
            scopeKey={tourScopeKey}
            isAuthorized={isTourAuthorized}
            steps={setupTourSteps}
          />
          {canOpenMonitoring && (
            <nav
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-1"
              aria-label={t('cameraSetup.monitor')}
            >
              <Link className={button} to={site ? `/ppe?${returnParams}` : '/ppe'}>
                {t('cameraSetup.monitorPpe')}
              </Link>
              <Link className={button} to={site ? `/zones?${returnParams}` : '/zones'}>
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
              className="shrink-0 text-xs font-semibold tracking-wide text-slate-700"
              htmlFor="camera-setup-site"
            >
              {t('cameraSetup.site')}
            </label>
            <select
              id="camera-setup-site"
              value={site?.id ?? ''}
              disabled={sites.baseError || sites.isPending}
              className="w-full min-w-0 max-w-md rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-2xs transition-colors hover:border-slate-400 focus-visible:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
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
          requestedCameraId={params.get('cameraId')}
          cameraError={errorNotice(cameras)}
          open={open}
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
      {site && (activeDialog?.kind === 'zones' || activeDialog?.kind === 'regions') && (
        <ZonePpeSetupDialog
          key={`${activeDialog.kind}:${activeDialog.cameraId ?? ''}`}
          {...common}
          section={activeDialog.kind === 'regions' ? 'regions' : 'zones'}
          initialCameraId={activeDialog.kind === 'regions' ? activeDialog.cameraId : undefined}
          onSelectCamera={
            activeDialog.kind === 'regions'
              ? (cameraId) => {
                  if (isCurrentDialog()) syncActiveRegionCameraParam(cameraId, true);
                }
              : undefined
          }
          canReadZones={canReadZones}
          canManageZones={capabilities.canManageZones}
          canManageRegions={canManageCameras}
        />
      )}
    </div>
  );
}
