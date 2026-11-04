import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LoginResponse } from '@smartsite/api-client';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { FourSourceWall } from './FourSourceWall';
import { FocusedCameraMedia } from './FocusedCameraMedia';
import { useMonitorPages } from './useMonitorPages';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

registerFeatureCatalog({
  en: {
    'monitor.title': 'PPE monitoring',
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
}

/** A credential/role change remounts the entire display before old pixels can render. */
export function PpeMonitorWorkspace({
  apiUrl,
  session,
  aiPaused = import.meta.env.VITE_AI_WORK_PAUSED === 'true',
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
      key={identity.nonce}
      {...{ apiUrl, session, client, aiPaused }}
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
  return (
    <section className="space-y-5 min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('monitor.title')}</h1>
        {site && (
          <Link
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
      <div className="rounded-xl border bg-white p-4 space-y-2">
        <label className="block text-sm">
          {t('monitor.site')}
          <select
            className="block mt-2 w-full rounded-lg border p-2"
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
        {sites.isPending ? (
          <p role="status">{t('monitor.loading')}</p>
        ) : sites.isError && !sites.isFetchNextPageError ? (
          <button onClick={() => void sites.refetch()}>{t('monitor.error')}</button>
        ) : !visibleSites.length && !sites.hasNextPage ? (
          <p role="status">{t('monitor.emptySite')}</p>
        ) : null}
        {sites.hasNextPage && (
          <button disabled={sites.isFetchingNextPage} onClick={() => void sites.fetchNextPage()}>
            {t(sites.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
          </button>
        )}
      </div>
      {site && (
        <CameraScope
          key={`${scope}:${site.id}`}
          {...{ apiUrl, client, session, aiPaused, scope }}
          site={site}
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
}: Props & {
  client: SmartSiteManagementClient;
  scope: string;
  site: { id: string; name: string; code: string };
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
      <div className="rounded-xl border bg-white p-4 flex flex-wrap items-end gap-4">
        <label className="grow text-sm">
          {t('monitor.camera')}
          <select
            className="block mt-2 w-full rounded-lg border p-2"
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
        {selected && (
          <>
            <button className="rounded-lg border px-3 py-2" onClick={() => setFocus(!focus)}>
              {t(focus ? 'monitor.grid' : 'monitor.focus')}
            </button>
            <button
              className="rounded-lg border px-3 py-2"
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
        <p role="status" className="w-full text-xs text-slate-500">
          {cameras.isPending
            ? t('monitor.loading')
            : cameras.isError && !cameras.isFetchNextPageError
              ? t('monitor.error')
              : t('monitor.loaded', { loaded: cameras.rows.length, total: cameras.total ?? '—' })}
        </p>
        {cameras.isError && !cameras.isFetchNextPageError && (
          <button onClick={() => void cameras.refetch()}>{t('monitor.retry')}</button>
        )}
        {!cameras.isPending && !cameras.isError && !active.length && (
          <p>
            {t('monitor.emptyCamera')} {cameras.hasNextPage && t('monitor.partial')}
          </p>
        )}
        {cameras.hasNextPage && (
          <button
            disabled={cameras.isFetchingNextPage}
            onClick={() => void cameras.fetchNextPage()}
          >
            {t(cameras.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
          </button>
        )}
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
              aiPaused={!!aiPaused}
            />
          ) : (
            <FourSourceWall
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
    </div>
  );
}
