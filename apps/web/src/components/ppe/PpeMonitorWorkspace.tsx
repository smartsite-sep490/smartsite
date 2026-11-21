import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError } from '@smartsite/api-client';
import { MonitorWorkspaceTour } from './MonitorWorkspaceTour';
import { useTranslation } from 'react-i18next';
import type { LoginResponse } from '@smartsite/api-client';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { FourSourceWall } from './FourSourceWall';
import { FocusedCameraMedia } from './FocusedCameraMedia';
import { useMonitorPages } from './useMonitorPages';
import { useMonitorReadabilityTranslate } from './monitor-readability';
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
    'monitor.linkedSiteUnavailable': 'The linked site is unavailable.',
    'monitor.linkedCameraUnavailable': 'The linked camera is unavailable.',
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
    'monitor.linkedSiteUnavailable': 'Công trường trong liên kết không khả dụng.',
    'monitor.linkedCameraUnavailable': 'Camera trong liên kết không khả dụng.',
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
  /**
   * Pending P8 dependency: `/incidents?tab=ppe-frames` (`FramePpeInbox`) is not yet integrated
   * on `Main`. Keep disabled (`false`) by default so Main never exposes a broken navigation target;
   * enable once P8 Frame Inbox is composed onto `/incidents`.
   */
  enableFrameInboxLink?: boolean;
}

/** A credential/role change remounts the entire display before old pixels can render. */
export function PpeMonitorWorkspace({
  apiUrl,
  session,
  aiPaused = import.meta.env.VITE_AI_WORK_PAUSED === 'true',
  enableFrameInboxLink = false,
}: Props) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const linkedSiteId = params.get('siteId') ?? '';
  const linkedCameraId = linkedSiteId ? (params.get('cameraId') ?? '') : '';
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
    session.user.roleAssignments.some((r) => r.role === 'SAFETY_OFFICER' && !!r.siteId);
  if (!canRead) return <p role="alert">{t('monitor.denied')}</p>;
  return (
    <MonitorScope
      key={JSON.stringify([identity.nonce, linkedSiteId, linkedCameraId])}
      {...{ apiUrl, session, client, aiPaused, enableFrameInboxLink }}
      scope={identity.nonce}
      linkedSiteId={linkedSiteId}
      linkedCameraId={linkedCameraId}
    />
  );
}

function MonitorScope({
  apiUrl,
  session,
  client,
  aiPaused,
  enableFrameInboxLink,
  scope,
  linkedSiteId,
  linkedCameraId,
}: Props & {
  client: SmartSiteManagementClient;
  scope: string;
  linkedSiteId: string;
  linkedCameraId: string;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const trMonitor = useMonitorReadabilityTranslate();
  const [chosenSite, setSite] = useState(linkedSiteId);
  const sites = useMonitorPages(scope, 'sites', true, (offset, signal) =>
    client.listSites(session.accessToken, { offset, limit: 20 }, { signal }),
  );
  const allowed = useMemo(
    () =>
      new Set(
        session.user.roleAssignments
          .filter((r) => r.role === 'SAFETY_OFFICER')
          .map((r) => r.siteId),
      ),
    [session.user.roleAssignments],
  );
  const visibleSites = sites.rows.filter((site) => allowed.has(site.id));
  const site =
    visibleSites.find((row) => row.id === chosenSite) ??
    (linkedSiteId && chosenSite === linkedSiteId ? undefined : visibleSites[0]);
  useEffect(() => {
    if (
      (!visibleSites.length || (allowed.has(chosenSite) && !site)) &&
      sites.hasNextPage &&
      !sites.isFetching &&
      !sites.error
    )
      void sites.fetchNextPage({ cancelRefetch: false });
  }, [visibleSites.length, allowed, chosenSite, site, sites]);
  const siteSelector = (
    <label className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 flex-[1_1_13rem] lg:max-w-xs text-xs font-medium text-slate-800">
      <span className="shrink-0">{t('monitor.site')}</span>
      <select
        name="monitorSite"
        data-tour-anchor="monitor-site-scope"
        className="block h-8 flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs sm:text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
        value={site?.id ?? ''}
        onChange={(e) => setSite(e.target.value)}
        disabled={sites.isPending || !visibleSites.length}
      >
        {!site && <option value="">{t('monitor.choose')}</option>}
        {visibleSites.map((row) => (
          <option key={row.id} value={row.id}>
            {row.code ? `${row.code} · ${row.name}` : row.name}
          </option>
        ))}
      </select>
    </label>
  );

  const siteNotices = (
    <>
      {sites.isPending ? (
        <p role="status" className="w-full text-xs text-slate-600">
          {t('monitor.loading')}
        </p>
      ) : sites.isError && !sites.isFetchNextPageError ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-900">
          <span>{trMonitor('monitor.siteErrorDetail')}</span>
          <button
            type="button"
            className="rounded-md border border-rose-300 bg-white px-2.5 py-1 font-semibold text-rose-900 hover:bg-rose-100 cursor-pointer"
            onClick={() => void sites.refetch()}
          >
            {t('monitor.error')}
          </button>
        </div>
      ) : linkedSiteId && !site && !sites.hasNextPage ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
          <p role="status">{t('monitor.linkedSiteUnavailable')}</p>
          {visibleSites.length > 0 && (
            <button
              type="button"
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer"
              onClick={() => setSite(visibleSites[0]!.id)}
            >
              {t('monitor.choose')}
            </button>
          )}
        </div>
      ) : !visibleSites.length && !sites.hasNextPage ? (
        <p
          role="status"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
        >
          {t('monitor.emptySite')}
        </p>
      ) : null}
      {sites.hasNextPage && (
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          disabled={sites.isFetchingNextPage}
          onClick={() => void sites.fetchNextPage()}
        >
          {t(sites.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
        </button>
      )}
    </>
  );

  return (
    <section className="space-y-2 min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
          <h1 className="text-lg font-semibold text-slate-950">{t('monitor.title')}</h1>
          <p className="text-xs text-slate-600">{t('monitor.hint')}</p>
        </div>
        {site && (
          <div className="flex flex-wrap items-center gap-2">
            {enableFrameInboxLink && (
              <Link
                data-testid="monitor-frame-inbox-link"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                to={`/incidents?tab=ppe-frames&siteId=${encodeURIComponent(site.id)}`}
              >
                {trMonitor('monitor.frameInbox')}
              </Link>
            )}
            <Link
              className="rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              data-tour-anchor="monitor-safety-records"
              to={`/incidents?tab=episodes&siteId=${encodeURIComponent(site.id)}`}
            >
              {t('monitor.evidence')}
            </Link>
          </div>
        )}
      </header>
      {aiPaused && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        >
          {t('monitor.paused')}
        </p>
      )}
      {site ? (
        <CameraScope
          {...{ apiUrl, client, session, aiPaused, scope }}
          site={site}
          siteSelector={siteSelector}
          siteNotices={siteNotices}
          canManageCameras={session.user.roleAssignments.some(
            (r) => r.role === 'SITE_MANAGER' && r.siteId === site.id,
          )}
          linkedCameraId={site.id === linkedSiteId ? linkedCameraId : ''}
        />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          {siteSelector}
          {siteNotices}
        </div>
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
  siteSelector,
  siteNotices,
  canManageCameras,
  linkedCameraId,
}: Props & {
  client: SmartSiteManagementClient;
  scope: string;
  site: { id: string; name: string; code: string };
  siteSelector: ReactNode;
  siteNotices: ReactNode;
  canManageCameras: boolean;
  linkedCameraId: string;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const trMonitor = useMonitorReadabilityTranslate();
  const siteScopeKey = `${scope}:${site.id}:${linkedCameraId}`;
  const [scopeState, setScopeState] = useState(() => ({
    siteScopeKey,
    chosen: linkedCameraId,
    focus: false,
    fullscreenError: false,
  }));
  if (scopeState.siteScopeKey !== siteScopeKey) {
    setScopeState({
      siteScopeKey,
      chosen: linkedCameraId,
      focus: false,
      fullscreenError: false,
    });
  }
  const chosen = scopeState.siteScopeKey === siteScopeKey ? scopeState.chosen : linkedCameraId;
  const focus = scopeState.siteScopeKey === siteScopeKey ? scopeState.focus : false;
  const fullscreenError =
    scopeState.siteScopeKey === siteScopeKey ? scopeState.fullscreenError : false;
  const setCamera = (nextCameraId: string) =>
    setScopeState((prev) => ({
      ...(prev.siteScopeKey === siteScopeKey
        ? prev
        : { siteScopeKey, chosen: linkedCameraId, focus: false, fullscreenError: false }),
      chosen: nextCameraId,
    }));
  const setFocus = (nextFocus: boolean) =>
    setScopeState((prev) => ({
      ...(prev.siteScopeKey === siteScopeKey
        ? prev
        : { siteScopeKey, chosen: linkedCameraId, focus: false, fullscreenError: false }),
      focus: nextFocus,
    }));
  const setFullscreenError = (nextError: boolean) =>
    setScopeState((prev) => ({
      ...(prev.siteScopeKey === siteScopeKey
        ? prev
        : { siteScopeKey, chosen: linkedCameraId, focus: false, fullscreenError: false }),
      fullscreenError: nextError,
    }));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const fullscreenBtnRef = useRef<HTMLButtonElement>(null);
  const fullscreenExitBtnRef = useRef<HTMLButtonElement>(null);
  const wasFullscreenRef = useRef(false);
  const pendingFocusTargetRef = useRef<
    { kind: 'focus-exit' } | { kind: 'grid-enlarge'; cameraId: string } | null
  >(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const nextIsFullscreen = Boolean(
        document.fullscreenElement && document.fullscreenElement === container.current,
      );
      setIsFullscreen(nextIsFullscreen);
      if (nextIsFullscreen && !wasFullscreenRef.current) {
        wasFullscreenRef.current = true;
        queueMicrotask(() => {
          fullscreenExitBtnRef.current?.focus();
        });
      } else if (!nextIsFullscreen && wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        queueMicrotask(() => {
          fullscreenBtnRef.current?.focus();
        });
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const pending = pendingFocusTargetRef.current;
    if (!pending) return;
    pendingFocusTargetRef.current = null;
    queueMicrotask(() => {
      if (pending.kind === 'focus-exit') {
        const target =
          container.current?.querySelector<HTMLElement>('[data-testid="focused-exit-to-grid"]') ??
          document.querySelector<HTMLElement>('[data-testid="monitor-focus-btn"]');
        target?.focus();
      } else {
        const target =
          container.current?.querySelector<HTMLElement>(
            `[data-testid="enlarge-camera-btn-${pending.cameraId}"]`,
          ) ?? document.querySelector<HTMLElement>('[data-testid="monitor-grid-btn"]');
        target?.focus();
      }
    });
  }, [focus, chosen]);

  const cameras = useMonitorPages(scope, `cameras:${site.id}`, true, (offset, signal) =>
    client.listPreviewCameras(session.accessToken, site.id, { offset, limit: 20 }, { signal }),
  );
  const siteCameras = cameras.rows.filter((row) => row.siteId === site.id);
  const active = siteCameras.filter((row) => row.status === 'ACTIVE');
  const inactiveCount = siteCameras.filter((row) => row.status !== 'ACTIVE').length;
  const selected =
    active.find((row) => row.id === chosen) ??
    (linkedCameraId && chosen === linkedCameraId ? undefined : active[0]);
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
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        {siteSelector}
        <label className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 flex-[1_1_13rem] lg:max-w-xs text-xs font-medium text-slate-800">
          <span className="shrink-0">{t('monitor.camera')}</span>
          <select
            name="monitorCamera"
            data-tour-anchor="monitor-camera-select"
            className="block h-8 flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs sm:text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
            value={selected?.id ?? ''}
            onChange={(e) => setCamera(e.target.value)}
            disabled={!active.length}
          >
            {!selected && <option value="">{t('monitor.choose')}</option>}
            {active.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code ? `${row.code} · ${row.name}` : row.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label={trMonitor('monitor.layout.groupAria')}
              data-testid="monitor-layout-controls"
              data-tour-anchor="monitor-focus-toggle"
              className="inline-flex min-h-8 max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5"
            >
              <button
                type="button"
                data-testid="monitor-grid-btn"
                aria-pressed={!focus}
                onClick={() => setFocus(false)}
                className="rounded-lg border border-transparent px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-pressed:border-slate-900 aria-pressed:bg-slate-900 aria-pressed:font-semibold aria-pressed:text-white cursor-pointer"
              >
                {trMonitor('monitor.layout.grid4')}
              </button>
              <button
                type="button"
                data-testid="monitor-focus-btn"
                aria-pressed={focus}
                onClick={() => {
                  if (!focus) {
                    pendingFocusTargetRef.current = { kind: 'focus-exit' };
                    setFocus(true);
                  }
                }}
                className="rounded-lg border border-transparent px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-pressed:border-slate-900 aria-pressed:bg-slate-900 aria-pressed:font-semibold aria-pressed:text-white cursor-pointer"
              >
                {trMonitor('monitor.layout.focus1')}
              </button>
            </div>
            <button
              ref={fullscreenBtnRef}
              type="button"
              data-testid="monitor-fullscreen-btn"
              aria-pressed={isFullscreen}
              className="min-h-8 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
              data-tour-anchor="monitor-fullscreen"
              onClick={() => {
                setFullscreenError(false);
                if (isFullscreen && document.exitFullscreen) {
                  void document.exitFullscreen().catch(() => setFullscreenError(true));
                  return;
                }
                const pending = container.current?.requestFullscreen?.();
                if (!pending) setFullscreenError(true);
                else void pending.catch(() => setFullscreenError(true));
              }}
            >
              {isFullscreen ? trMonitor('monitor.layout.exitFullscreen') : t('monitor.fullscreen')}
            </button>
          </div>
        )}
        <MonitorWorkspaceTour
          userId={session.user.id}
          scope={scope}
          observationMode="ppe"
          siteId={site.id}
          selectedCameraId={selected?.id}
          isMetadataReady={
            !cameras.isPending &&
            (!cameras.isError ||
              (cameras.isFetchNextPageError &&
                !(
                  cameras.error instanceof ApiError &&
                  [401, 403, 404].includes(cameras.error.status ?? 0)
                )))
          }
          hasActiveCamera={Boolean(selected)}
        />
        <p role="status" className="ml-auto text-xs text-slate-500 whitespace-nowrap">
          {cameras.isPending
            ? t('monitor.loading')
            : cameras.isError && !cameras.isFetchNextPageError
              ? t('monitor.error')
              : t('monitor.loaded', { loaded: cameras.rows.length, total: cameras.total ?? '—' })}
        </p>
        {siteNotices}
        {cameras.isError && !cameras.isFetchNextPageError && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            <span>{trMonitor('monitor.cameraErrorDetail')}</span>
            <button
              type="button"
              className="rounded-md border border-rose-300 bg-white px-3 py-1 font-semibold text-rose-900 hover:bg-rose-100 cursor-pointer"
              onClick={() => void cameras.refetch()}
            >
              {t('monitor.retry')}
            </button>
          </div>
        )}
        {linkedCameraId &&
          chosen === linkedCameraId &&
          !selected &&
          !cameras.isPending &&
          !cameras.isError &&
          !cameras.hasNextPage && (
            <div
              data-testid="monitor-linked-camera-empty"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950"
            >
              <div className="space-y-0.5">
                <p role="status" className="font-semibold">
                  {t('monitor.linkedCameraUnavailable')}
                </p>
                <p className="text-amber-900/80">{trMonitor('monitor.linkedCameraHint')}</p>
              </div>
              {active.length > 0 && (
                <button
                  type="button"
                  data-testid="monitor-clear-linked-camera"
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer"
                  onClick={() => setCamera(active[0]!.id)}
                >
                  {trMonitor('monitor.clearLinkedCamera')}
                </button>
              )}
            </div>
          )}
        {!linkedCameraId && !cameras.isPending && !cameras.isError && !active.length && (
          <div
            data-testid="monitor-no-active-cameras"
            className="w-full space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700"
          >
            <p className="font-semibold text-slate-900">
              {t('monitor.emptyCamera')} {cameras.hasNextPage && t('monitor.partial')}
            </p>
            {inactiveCount > 0 && (
              <p>{trMonitor('monitor.emptyInactiveHint', { inactive: inactiveCount })}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <p className="text-slate-600">{trMonitor('monitor.emptyOfficerHint')}</p>
              {canManageCameras && (
                <Link
                  data-testid="monitor-inspect-camera-setup"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-900 hover:bg-slate-100"
                  to={`/camera-setup?siteId=${encodeURIComponent(site.id)}`}
                >
                  {trMonitor('monitor.openCameraSetup')}
                </Link>
              )}
            </div>
          </div>
        )}
        {cameras.hasNextPage && (
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            disabled={cameras.isFetchingNextPage}
            onClick={() => void cameras.fetchNextPage()}
          >
            {t(cameras.isFetchNextPageError ? 'monitor.retry' : 'monitor.more')}
          </button>
        )}
      </div>
      {fullscreenError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950"
        >
          <span>{t('monitor.fullscreenError')}</span>
          {!focus && selected && (
            <button
              type="button"
              data-testid="monitor-fullscreen-focus-fallback"
              className="rounded-md border border-amber-300 bg-white px-3 py-1 font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer"
              onClick={() => {
                setFullscreenError(false);
                pendingFocusTargetRef.current = { kind: 'focus-exit' };
                setFocus(true);
              }}
            >
              {trMonitor('monitor.layout.useFocusFallback')}
            </button>
          )}
        </div>
      )}
      <div
        ref={container}
        tabIndex={-1}
        data-monitor-fullscreen={isFullscreen ? 'true' : undefined}
        className={
          isFullscreen
            ? 'min-w-0 space-y-2.5 bg-slate-950 p-3 overflow-y-auto'
            : 'bg-slate-50 min-w-0'
        }
      >
        {isFullscreen && selected && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-white">
            <span className="text-xs font-semibold truncate">
              {selected.code ? `${selected.code} · ${selected.name}` : selected.name}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label={trMonitor('monitor.layout.groupAria')}
                data-testid="monitor-fullscreen-layout-controls"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1"
              >
                <button
                  type="button"
                  aria-pressed={!focus}
                  onClick={() => setFocus(false)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-slate-950 cursor-pointer"
                >
                  {trMonitor('monitor.layout.grid4')}
                </button>
                <button
                  type="button"
                  aria-pressed={focus}
                  onClick={() => {
                    if (!focus) {
                      pendingFocusTargetRef.current = { kind: 'focus-exit' };
                      setFocus(true);
                    }
                  }}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-slate-950 cursor-pointer"
                >
                  {trMonitor('monitor.layout.focus1')}
                </button>
              </div>
              <button
                ref={fullscreenExitBtnRef}
                type="button"
                data-testid="monitor-fullscreen-exit-btn"
                onClick={() => {
                  if (document.exitFullscreen) {
                    void document.exitFullscreen().catch(() => setFullscreenError(true));
                  }
                }}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
              >
                {trMonitor('monitor.layout.exitFullscreen')}
              </button>
            </div>
          </div>
        )}
        {selected &&
          (focus ? (
            <FocusedCameraMedia
              key={`${siteScopeKey}:${selected.id}`}
              apiUrl={apiUrl}
              client={client}
              token={session.accessToken}
              sessionScope={scope}
              siteId={site.id}
              siteCode={site.code}
              siteName={site.name}
              camera={selected}
              aiPaused={!!aiPaused}
              onExitFocus={() => {
                pendingFocusTargetRef.current = { kind: 'grid-enlarge', cameraId: selected.id };
                setFocus(false);
              }}
            />
          ) : (
            <FourSourceWall
              key={siteScopeKey}
              {...common}
              cameras={wall}
              selectedCameraId={selected.id}
              onSelectCamera={setCamera}
              onEnlargeCamera={(id) => {
                pendingFocusTargetRef.current = { kind: 'focus-exit' };
                setCamera(id);
                setFocus(true);
              }}
            />
          ))}
      </div>
    </div>
  );
}
