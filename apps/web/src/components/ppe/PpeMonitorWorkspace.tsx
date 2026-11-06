import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  type LoginResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { FourSourceWall } from './FourSourceWall';
import { FocusedCameraMedia } from './FocusedCameraMedia';
import { MonitorWorkspaceTour } from './MonitorWorkspaceTour';
import { useMonitorPages } from './useMonitorPages';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { Mf06ZoneAssessmentPanel } from './Mf06ZoneAssessmentPanel';

registerFeatureCatalog({
  en: {
    'monitor.title': 'PPE monitoring',
    'monitor.zoneTitle': 'Restricted area monitoring',
    'monitor.site': 'Site',
    'monitor.camera': 'Camera',
    'monitor.choose': 'Select',
    'monitor.loading': 'Loading…',
    'monitor.error': 'Metadata unavailable. Retry.',
    'monitor.retry': 'Retry',
    'monitor.more': 'Load more',
    'monitor.emptySite': 'No sites available.',
    'monitor.emptyCamera': 'No active camera in the loaded pages.',
    'monitor.partial': 'More cameras may be on later pages.',
    'monitor.grid': 'Camera grid',
    'monitor.focus': 'Focus',
    'monitor.fullscreen': 'Fullscreen',
    'monitor.fullscreenError': 'Fullscreen is unavailable in this browser.',
    'monitor.paused': 'AI processing is paused. Camera previews are disabled.',
    'monitor.evidence': 'Open safety records',
    'monitor.denied':
      'Camera monitoring requires an active Admin or assigned Safety Officer session.',
    'monitor.loaded': '{loaded} loaded / {total} reported',
    'monitor.hint':
      'Choose a Site, then select or enlarge a camera. Saved findings are reviewed in safety records.',
  },
  vi: {
    'monitor.title': 'Giám sát bảo hộ',
    'monitor.zoneTitle': 'Giám sát khu vực hạn chế',
    'monitor.site': 'Công trường',
    'monitor.camera': 'Camera',
    'monitor.choose': 'Chọn',
    'monitor.loading': 'Đang tải…',
    'monitor.error': 'Không tải được cấu hình. Hãy thử lại.',
    'monitor.retry': 'Thử lại',
    'monitor.more': 'Tải thêm',
    'monitor.emptySite': 'Không có công trường khả dụng.',
    'monitor.emptyCamera': 'Chưa có camera hoạt động trong các trang đã tải.',
    'monitor.partial': 'Các trang sau có thể còn camera.',
    'monitor.grid': 'Lưới camera',
    'monitor.focus': 'Tiêu điểm',
    'monitor.fullscreen': 'Toàn màn hình',
    'monitor.fullscreenError': 'Trình duyệt chưa cho phép toàn màn hình.',
    'monitor.paused': 'Đang tạm dừng xử lý AI. Xem trước camera đã tắt.',
    'monitor.evidence': 'Mở hồ sơ an toàn',
    'monitor.denied': 'Cần phiên Admin hoặc Cán bộ an toàn đang hoạt động và được phân công.',
    'monitor.loaded': 'Đã tải {loaded} / tổng báo về {total}',
    'monitor.hint':
      'Chọn công trường rồi chọn hoặc phóng to camera. Xem các phát hiện đã lưu tại hồ sơ an toàn.',
  },
});

type Session = Pick<LoginResponse, 'accessToken' | 'user'>;
interface Props {
  apiUrl: string;
  session: Session;
  aiPaused?: boolean;
  observationMode?: 'ppe' | 'zone';
}

function isRevokedStatus(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0);
}

/** A credential/role change remounts the entire display before old pixels can render. */
export function PpeMonitorWorkspace({
  apiUrl,
  session,
  aiPaused = import.meta.env.VITE_AI_WORK_PAUSED === 'true',
  observationMode = 'ppe',
}: Props) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const client = useManagementClient(apiUrl);
  const roles = JSON.stringify(session.user.roleAssignments);
  const [identity, setIdentity] = useState(() => ({
    token: session.accessToken,
    user: session.user.id,
    roles,
    apiUrl,
    client,
    nonce: crypto.randomUUID(),
  }));
  if (
    identity.token !== session.accessToken ||
    identity.user !== session.user.id ||
    identity.roles !== roles ||
    identity.apiUrl !== apiUrl ||
    identity.client !== client
  ) {
    setIdentity({
      token: session.accessToken,
      user: session.user.id,
      roles,
      apiUrl,
      client,
      nonce: crypto.randomUUID(),
    });
    return null;
  }
  const canRead =
    session.user.isActive &&
    !session.user.mustChangePassword &&
    session.user.roleAssignments.some(
      (r) =>
        (r.role === 'ADMIN' && r.siteId === null) || (r.role === 'SAFETY_OFFICER' && !!r.siteId),
    );
  if (!canRead) return <p role="alert">{t('monitor.denied')}</p>;
  return (
    <MonitorScope
      key={`${identity.nonce}:${observationMode}`}
      {...{ apiUrl, session, client, aiPaused, observationMode }}
      scope={identity.nonce}
    />
  );
}

function MonitorScope({
  apiUrl,
  session,
  client,
  aiPaused,
  scope,
  observationMode = 'ppe',
}: Props & { client: SmartSiteManagementClient; scope: string }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [chosenSite, setSite] = useState('');
  const sites = useMonitorPages(scope, 'sites', true, (offset, signal) =>
    client.listSites(session.accessToken, { offset, limit: 20 }, { signal }),
  );
  const globalAdmin = session.user.roleAssignments.some(
    (r) => r.role === 'ADMIN' && r.siteId === null,
  );
  const allowed = new Set(
    session.user.roleAssignments.filter((r) => r.role === 'SAFETY_OFFICER').map((r) => r.siteId),
  );
  const visibleSites = sites.rows.filter((site) => globalAdmin || allowed.has(site.id));
  const site = visibleSites.find((row) => row.id === chosenSite) ?? visibleSites[0];
  const siteMetadataReady =
    Boolean(site) &&
    !sites.isPending &&
    !(sites.isError && !sites.isFetchNextPageError) &&
    !isRevokedStatus(sites.error);
  return (
    <section className="space-y-5 min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {t(observationMode === 'zone' ? 'monitor.zoneTitle' : 'monitor.title')}
        </h1>
        {site && (
          <Link
            data-tour-anchor="monitor-safety-records"
            className="rounded-lg border px-4 py-2 text-sm"
            to={`/incidents?tab=episodes&siteId=${encodeURIComponent(site.id)}`}
          >
            {t('monitor.evidence')}
          </Link>
        )}
      </header>
      <p className="text-sm text-slate-600">{t('monitor.hint')}</p>
      {aiPaused && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          {t('monitor.paused')}
        </p>
      )}
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <label className="block min-w-0 w-full text-sm font-medium text-slate-800">
          {t('monitor.site')}
          <select
            data-tour-anchor="monitor-site-scope"
            className="mt-1.5 block min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
            value={site?.id ?? ''}
            onChange={(e) => setSite(e.target.value)}
            disabled={sites.isPending || !visibleSites.length}
          >
            {!site && <option value="">{t('monitor.choose')}</option>}
            {visibleSites.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600 empty:hidden">
          {sites.isPending ? (
            <p role="status" className="min-w-0 text-xs text-slate-500">
              {t('monitor.loading')}
            </p>
          ) : sites.isError && !sites.isFetchNextPageError ? (
            <button
              type="button"
              className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              onClick={() => void sites.refetch()}
            >
              {t('monitor.error')}
            </button>
          ) : !visibleSites.length && !sites.hasNextPage ? (
            <p role="status" className="min-w-0 text-xs text-slate-600">
              {t('monitor.emptySite')}
            </p>
          ) : null}
          {sites.hasNextPage && (
            <button
              type="button"
              className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={sites.isFetchingNextPage}
              onClick={() => void sites.fetchNextPage()}
            >
              {t(sites.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
            </button>
          )}
        </div>
      </div>
      {site && (
        <CameraScope
          key={`${scope}:${site.id}`}
          {...{ apiUrl, client, session, aiPaused, scope, observationMode }}
          site={site}
          siteMetadataReady={siteMetadataReady}
        />
      )}
    </section>
  );
}

function CameraScope({
  apiUrl,
  client,
  session,
  aiPaused,
  scope,
  site,
  siteMetadataReady,
  observationMode = 'ppe',
}: Props & {
  client: SmartSiteManagementClient;
  scope: string;
  site: { id: string; name: string; code: string };
  siteMetadataReady: boolean;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [chosen, setCamera] = useState(''),
    [focus, setFocus] = useState(false),
    [fullscreenError, setFullscreenError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const cameras = useMonitorPages(scope, `cameras:${site.id}`, true, (offset, signal) =>
    client.listPreviewCameras(session.accessToken, site.id, { offset, limit: 20 }, { signal }),
  );
  const active = cameras.rows.filter((row) => row.status === 'ACTIVE' && row.siteId === site.id);
  const selected = active.find((row) => row.id === chosen) ?? active[0];
  const wall = selected
    ? [selected, ...active.filter((row) => row.id !== selected.id)].slice(0, 4)
    : [];
  const isMetadataReady =
    siteMetadataReady &&
    !cameras.isPending &&
    !(cameras.isError && !cameras.isFetchNextPageError) &&
    !isRevokedStatus(cameras.error);
  const common = {
    apiUrl,
    client,
    token: session.accessToken,
    sessionScope: scope,
    credentialId: 1,
    siteId: site.id,
    siteCode: site.code,
    siteName: site.name,
    enabled: !aiPaused,
    isAiWorkPaused: aiPaused,
    showModelObjects: false,
  };
  return (
    <div className="space-y-4">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="min-w-0 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 w-full flex-1 lg:max-w-md">
            <label className="block min-w-0 w-full text-sm font-medium text-slate-800">
              {t('monitor.camera')}
              <select
                data-tour-anchor="monitor-camera-select"
                className="mt-1.5 block min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                value={selected?.id ?? ''}
                onChange={(e) => setCamera(e.target.value)}
                disabled={!active.length}
              >
                {!selected && <option value="">{t('monitor.choose')}</option>}
                {active.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-2 lg:justify-end">
            {selected && (
              <>
                <button
                  type="button"
                  data-tour-anchor="monitor-focus-toggle"
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  onClick={() => setFocus(!focus)}
                >
                  {t(focus ? 'monitor.grid' : 'monitor.focus')}
                </button>
                <button
                  type="button"
                  data-tour-anchor="monitor-fullscreen"
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  onClick={() => {
                    setFullscreenError(false);
                    const pending = container.current?.requestFullscreen?.();
                    if (!pending) setFullscreenError(true);
                    else void pending.catch(() => setFullscreenError(true));
                  }}
                >
                  {t('monitor.fullscreen')}
                </button>
              </>
            )}
            <MonitorWorkspaceTour
              userId={session.user.id}
              scope={scope}
              observationMode={observationMode}
              siteId={site.id}
              selectedCameraId={selected?.id ?? null}
              isMetadataReady={isMetadataReady}
              hasActiveCamera={Boolean(selected)}
            />
          </div>
        </div>
        <div className="min-w-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
          <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p role="status" className="min-w-0 text-xs text-slate-500 tabular-nums">
              {cameras.isPending
                ? t('monitor.loading')
                : cameras.isError && !cameras.isFetchNextPageError
                  ? t('monitor.error')
                  : t('monitor.loaded', {
                      loaded: cameras.rows.length,
                      total: cameras.total ?? '—',
                    })}
            </p>
            {!cameras.isPending && !cameras.isError && !active.length && (
              <p className="min-w-0 text-xs text-slate-600">
                {t('monitor.emptyCamera')} {cameras.hasNextPage && t('monitor.partial')}
              </p>
            )}
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            {cameras.isError && !cameras.isFetchNextPageError && (
              <button
                type="button"
                className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                onClick={() => void cameras.refetch()}
              >
                {t('monitor.retry')}
              </button>
            )}
            {cameras.hasNextPage && (
              <button
                type="button"
                className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={cameras.isFetchingNextPage}
                onClick={() => void cameras.fetchNextPage()}
              >
                {t(cameras.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
              </button>
            )}
          </div>
        </div>
      </div>
      {fullscreenError && <p role="alert">{t('monitor.fullscreenError')}</p>}
      <div ref={container} className="bg-slate-50 min-w-0">
        {selected &&
          (focus ? (
            <FocusedCameraMedia
              key={selected.id}
              apiUrl={apiUrl}
              client={client}
              token={session.accessToken}
              sessionScope={scope}
              siteId={site.id}
              camera={selected}
              observationMode={observationMode}
              aiPaused={!!aiPaused}
            />
          ) : (
            <FourSourceWall
              observationMode={observationMode}
              {...common}
              cameras={wall}
              selectedCameraId={selected.id}
              onSelectCamera={setCamera}
              onEnlargeCamera={(id) => {
                setCamera(id);
                setFocus(true);
              }}
            />
          ))}
      </div>
      {observationMode === 'zone' && (
        <Mf06ZoneAssessmentPanel
          token={session.accessToken}
          siteId={site.id}
          credentialId={scope}
          apiUrl={apiUrl}
          client={client}
          cameraCatalog={active}
        />
      )}
    </div>
  );
}
