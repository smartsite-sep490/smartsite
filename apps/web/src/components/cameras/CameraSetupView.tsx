import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { useManagementClient } from '../../features/auth/auth-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { deriveZonePpeCapabilities, getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import { ZonePpeSetupDialog } from '../ppe/ZonePpeSetupDialog';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';
import { CameraManagementDialog } from './CameraManagementDialog';
import { setupErrorStatus, useSetupCatalog } from './useSetupCatalog';
import './camera-setup-catalog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

const button = CAMERA_BUTTON_STYLES.secondary;
const surface = 'min-w-0 rounded-2xl border border-slate-200/90 bg-white px-5 py-4 shadow-xs';
type Props = { apiUrl: string; sharedSession: SharedSession | null };

export function CameraSetupView({ apiUrl, sharedSession }: Props) {
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
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{
    kind: 'register' | 'manage' | 'zones' | 'regions';
    siteId: string;
    cameraId?: string;
  } | null>(null);
  const [selectedRegionCamera, setSelectedRegionCamera] = useState<{
    siteId: string;
    cameraId: string;
  } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const signedOut = useRef(false);
  const mounted = useRef(true);
  const activeLookupAbortRef = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    };
  }, []);
  const credentialId = getOpaqueTokenNonce(cache, session.accessToken);
  const key = [
    'camera-setup',
    apiUrl,
    session.sessionScope,
    session.user.id,
    credentialId,
    session.user.roleAssignments,
  ];
  const sites = useSetupCatalog<SiteResponse>([...key, 'sites'], !revoked, (offset, signal) =>
    client.listSites(session.accessToken, { offset, limit: 20 }, { signal }),
  );
  const requestedSite = params.get('siteId');
  const site = requestedSite ? sites.rows.find((row) => row.id === requestedSite) : sites.rows[0];
  const capabilities = deriveZonePpeCapabilities(session.user, site?.id);
  const canReadZones =
    !revoked &&
    session.user.roleAssignments.some(({ role, siteId }) => role === 'ADMIN' && siteId === null);
  const canReadCameras = session.user.roleAssignments.some(
    ({ role, siteId }) =>
      (role === 'ADMIN' && siteId === null) ||
      (siteId === site?.id && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(role)),
  );
  const cameras = useSetupCatalog<CameraResponse>(
    [...key, site?.id, 'cameras'],
    Boolean(site && canReadCameras && !revoked),
    (offset, signal) =>
      client.listCameras(session.accessToken, site!.id, { offset, limit: 20 }, { signal }),
  );
  const rows = cameras.rows.filter((row) => row.siteId === site?.id);
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const selectedCamera = rows.find((row) => row.id === dialog?.cameraId);
  const dialogScope = useRef({ dialog, siteId: site?.id });
  useLayoutEffect(() => {
    dialogScope.current = { dialog, siteId: site?.id };
  }, [dialog, site?.id]);
  const isCurrentDialog = () =>
    mounted.current &&
    dialogScope.current.dialog === dialog &&
    dialogScope.current.siteId === site?.id;
  const requestedCameraId = params.get('cameraId');
  const loadedReturnCamera =
    !revoked && !sites.baseError && !cameras.baseError && requestedCameraId
      ? rows.find((row) => row.id === requestedCameraId)
      : undefined;
  const explicitDialogCameraId =
    site &&
    !revoked &&
    !sites.baseError &&
    !cameras.baseError &&
    canReadCameras &&
    canManageCameras &&
    selectedRegionCamera?.siteId === site.id &&
    selectedRegionCamera.cameraId === requestedCameraId
      ? selectedRegionCamera.cameraId
      : null;
  const shouldFetchSelectedCamera = Boolean(site && explicitDialogCameraId && !loadedReturnCamera);
  useLayoutEffect(() => {
    if (!shouldFetchSelectedCamera) {
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    }
    return () => {
      activeLookupAbortRef.current?.abort();
      activeLookupAbortRef.current = null;
    };
  }, [shouldFetchSelectedCamera, site?.id, explicitDialogCameraId]);
  const selectedCameraQuery = useQuery({
    queryKey: [...key, site?.id, 'selected-camera', explicitDialogCameraId],
    enabled: shouldFetchSelectedCamera,
    queryFn: async ({ signal }) => {
      activeLookupAbortRef.current?.abort();
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
      activeLookupAbortRef.current = controller;
      try {
        const camera = await client.getCamera(
          session.accessToken,
          site!.id,
          explicitDialogCameraId!,
          { signal: controller.signal },
        );
        controller.signal.throwIfAborted();
        if (
          !camera ||
          camera.id !== explicitDialogCameraId ||
          camera.siteId !== site!.id ||
          camera.status !== 'ACTIVE'
        ) {
          throw new Error('Invalid selected camera metadata');
        }
        return camera;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
    retry: false,
    gcTime: 0,
  });
  const selectedCameraStatus = setupErrorStatus(selectedCameraQuery.error);
  const verifiedDialogCamera =
    shouldFetchSelectedCamera &&
    selectedCameraQuery.isSuccess &&
    !selectedCameraQuery.isFetching &&
    !selectedCameraQuery.isError &&
    selectedCameraQuery.data?.id === explicitDialogCameraId &&
    selectedCameraQuery.data.siteId === site?.id &&
    selectedCameraQuery.data.status === 'ACTIVE'
      ? selectedCameraQuery.data
      : undefined;
  const returnParams = new URLSearchParams(site ? { siteId: site.id } : {});
  const returnCamera =
    !revoked && !sites.baseError && !cameras.baseError
      ? explicitDialogCameraId && loadedReturnCamera?.status === 'INACTIVE'
        ? undefined
        : (loadedReturnCamera ?? verifiedDialogCamera)
      : undefined;
  if (returnCamera) returnParams.set('cameraId', returnCamera.id);
  const canOpenMonitoring = session.user.roleAssignments.some(
    (role) =>
      (role.role === 'ADMIN' && role.siteId === null) ||
      (role.role === 'SAFETY_OFFICER' && role.siteId === site?.id),
  );
  const activeDialog = !revoked && site?.id === dialog?.siteId ? dialog : null;
  if (!revoked && (sites.status === 401 || cameras.status === 401 || selectedCameraStatus === 401))
    setRevoked(true);
  useEffect(() => {
    if (!revoked) return;
    if (!signedOut.current) {
      signedOut.current = true;
      session.onSignOut?.();
    }
  }, [revoked, session]);
  const refreshCameras = () => {
    void cache.invalidateQueries({ queryKey: [...key, site?.id, 'cameras'] });
  };
  const unauthorized = () => {
    if (!isCurrentDialog()) return;
    setRevoked(true);
    if (!signedOut.current) {
      signedOut.current = true;
      session.onSignOut?.();
    }
  };
  const syncActiveRegionCameraParam = (cameraId?: string, allowUnloaded = false) => {
    if (!site || !canManageCameras || !cameraId) {
      return;
    }
    const loadedRow = rows.find((row) => row.id === cameraId);
    if (loadedRow ? loadedRow.status !== 'ACTIVE' : !allowUnloaded) {
      return;
    }
    setSelectedRegionCamera({ siteId: site.id, cameraId });
    const nextParams = new URLSearchParams(params);
    nextParams.set('siteId', site.id);
    nextParams.set('cameraId', cameraId);
    setParams(nextParams, { replace: true });
  };
  const open = (kind: 'register' | 'manage' | 'zones' | 'regions', cameraId?: string) => {
    if (!site) return;
    if (kind === 'regions') {
      syncActiveRegionCameraParam(cameraId, false);
    }
    setDialog({ kind, siteId: site.id, cameraId });
  };
  const close = () => setDialog(null);
  const common = {
    client,
    apiUrl,
    token: session.accessToken,
    sessionScope: session.sessionScope,
    credentialId,
    siteId: site?.id ?? '',
    siteName: site?.name ?? '',
    canManageCamera: capabilities.canManageRegions,
    onClose: () => {
      if (isCurrentDialog()) close();
    },
    onUnauthorized: unauthorized,
  };
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
  if (revoked || sites.status === 401 || cameras.status === 401 || selectedCameraStatus === 401)
    return <p role="alert">{t('cameraSetup.session')}</p>;
  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {t('cameraSetup.title')}
          </h1>
          <p className="max-w-xl text-xs leading-5 text-slate-500">{t('cameraSetup.intro')}</p>
        </div>
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
      </header>
      <section className={surface} aria-label={t('cameraSetup.site')}>
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
                close();
                setSelectedRegionCamera(null);
                setParams({ siteId: event.target.value });
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
          capabilities={capabilities}
          canReadZones={canReadZones}
          canReadCameras={canReadCameras}
          cameras={cameras}
          rows={rows}
          requestedCameraId={params.get('cameraId')}
          cameraError={errorNotice(cameras)}
          open={open}
        />
      )}
      {site && activeDialog?.kind === 'register' && canManageCameras && (
        <CameraRegistrationDialog
          {...common}
          open
          onCreated={() => {
            if (isCurrentDialog()) {
              close();
              refreshCameras();
            }
          }}
        />
      )}
      {site && activeDialog?.kind === 'manage' && selectedCamera && canManageCameras && (
        <CameraManagementDialog
          {...common}
          open
          camera={selectedCamera}
          onUpdated={() => {
            if (isCurrentDialog()) refreshCameras();
          }}
        />
      )}
      {site &&
        (activeDialog?.kind === 'zones' || activeDialog?.kind === 'regions') &&
        (activeDialog.kind === 'regions'
          ? canManageCameras
          : canReadZones || capabilities.canManageZones) && (
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
