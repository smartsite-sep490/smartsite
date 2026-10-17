import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { useManagementClient } from '../../features/auth/auth-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { deriveZonePpeCapabilities, getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import { ZonePpeSetupDialog } from '../ppe/ZonePpeSetupDialog';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';
import { CameraManagementDialog } from './CameraManagementDialog';
import { useSetupCatalog } from './useSetupCatalog';
import './camera-setup-catalog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

const button = CAMERA_BUTTON_STYLES.secondary;
const surface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-5';
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
    kind: 'register' | 'manage' | 'zones';
    siteId: string;
    cameraId?: string;
  } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const signedOut = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
  const returnParams = new URLSearchParams(site ? { siteId: site.id } : {});
  const returnCamera = rows.find((row) => row.id === params.get('cameraId'));
  if (returnCamera) returnParams.set('cameraId', returnCamera.id);
  const canOpenMonitoring = session.user.roleAssignments.some(
    (role) =>
      (role.role === 'ADMIN' && role.siteId === null) ||
      (role.role === 'SAFETY_OFFICER' && role.siteId === site?.id),
  );
  const activeDialog = !revoked && site?.id === dialog?.siteId ? dialog : null;
  if (!revoked && (sites.status === 401 || cameras.status === 401)) setRevoked(true);
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
  const open = (kind: 'register' | 'manage' | 'zones', cameraId?: string) => {
    if (site) setDialog({ kind, siteId: site.id, cameraId });
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
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
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
  if (revoked || sites.status === 401 || cameras.status === 401)
    return <p role="alert">{t('cameraSetup.session')}</p>;
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {t('cameraSetup.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {t('cameraSetup.intro')}
          </p>
        </div>
        {canOpenMonitoring && (
          <Link className={button} to={site ? `/ppe?${returnParams}` : '/ppe'}>
            {t('cameraSetup.monitor')}
          </Link>
        )}
      </header>
      <section className={surface} aria-label={t('cameraSetup.site')}>
        <label className="block text-sm font-semibold text-slate-700" htmlFor="camera-setup-site">
          {t('cameraSetup.site')}
        </label>
        <div className="mt-2 flex flex-wrap gap-3">
          <select
            id="camera-setup-site"
            value={site?.id ?? ''}
            disabled={sites.baseError || sites.isPending}
            className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            onChange={(event) => {
              close();
              setParams({ siteId: event.target.value });
            }}
          >
            <option value="">{t('cameraSetup.chooseSite')}</option>
            {sites.rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} · {row.name}
              </option>
            ))}
          </select>
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
          <p role="status" className="mt-3 text-sm text-slate-500">
            {t('cameraSetup.loading')}
          </p>
        )}
        {errorNotice(sites)}
        {sites.settledEmpty && (
          <p role="status" className="mt-3 text-sm text-slate-500">
            {t('cameraSetup.noSites')}
          </p>
        )}
        {Boolean(
          requestedSite && !site && !sites.isPending && !sites.baseError && sites.rows.length > 0,
        ) && (
          <p role="status" className="mt-3 text-sm text-slate-500">
            {t('cameraSetup.linkedSelection')}
          </p>
        )}
      </section>
      {site && (
        <CameraSetupCatalog
          capabilities={capabilities}
          canReadCameras={canReadCameras}
          cameras={cameras}
          rows={rows}
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
        activeDialog?.kind === 'zones' &&
        (capabilities.canManageZones || canManageCameras) && (
          <ZonePpeSetupDialog
            {...common}
            canManageZones={capabilities.canManageZones}
            canManageRegions={canManageCameras}
          />
        )}
    </div>
  );
}
