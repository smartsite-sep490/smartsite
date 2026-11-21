import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import {
  isSafetyIdentificationRouteEnabled,
  matchCanonicalId,
  sameSafetyId,
  sanitizeSafetyFrameKey,
  sanitizeSafetyUuid,
  uniqueCanonicalIds,
} from './components/safety-episodes/safetyUrlParams';
import { SafetyTaskTour } from './components/safety/SafetyTaskTour';
import {
  buildFrameInboxTourSteps,
  FRAME_INBOX_TOUR_VERSION,
} from './components/safety/safetyTaskTourModel';
import { useManagementClient } from './features/auth/auth-session';
import './components/safety-episodes/tracked-episode-workspace-catalog';
import './frame-inbox-catalog';
import { FrameInboxCards } from './FrameInboxCards';
import { FrameInboxSiteFilter, type FrameCameraOption } from './FrameInboxSiteFilter';
import { SAFETY_NAMESPACE } from './i18n/runtime';

interface Props {
  apiUrl: string;
  session: Pick<LoginResponse, 'accessToken' | 'user'>;
}

interface ScopedProps {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  userId?: string;
  scope: string;
  siteIds: string[];
  siteId?: string;
  cameraId?: string;
  frameKey?: string;
}

export function FramePpeInbox({ apiUrl, session }: Props) {
  const { t } = useTranslation();
  const client = useManagementClient(apiUrl);
  const [params] = useSearchParams();
  const rawSiteParam = params.get('siteId');
  const siteIds = uniqueCanonicalIds(
    session.user.roleAssignments.flatMap(({ role, siteId: assignedSiteId }) =>
      role === 'SAFETY_OFFICER' && assignedSiteId ? [assignedSiteId] : [],
    ),
  );
  const matchedSiteId = rawSiteParam !== null ? matchCanonicalId(siteIds, rawSiteParam) : undefined;
  const cameraId = sanitizeSafetyUuid(params.get('cameraId'))?.toLowerCase();
  const frameKey = sanitizeSafetyFrameKey(params.get('frameKey'));
  const roleKey = JSON.stringify(siteIds.map((id) => id.toLowerCase()));

  const [scope, setScope] = useState(() => ({
    token: session.accessToken,
    roleKey,
    apiUrl,
    nonce: crypto.randomUUID(),
  }));
  if (scope.token !== session.accessToken || scope.roleKey !== roleKey || scope.apiUrl !== apiUrl) {
    setScope({
      token: session.accessToken,
      roleKey,
      apiUrl,
      nonce: crypto.randomUUID(),
    });
    return null;
  }
  if (!siteIds.length || !session.user.isActive || session.user.mustChangePassword) {
    return null;
  }
  if (rawSiteParam !== null && !matchedSiteId) {
    return (
      <p
        role="alert"
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-950"
      >
        {t('frameInbox.siteDenied')}
      </p>
    );
  }

  return (
    <ScopedFramePpeInbox
      key={scope.nonce}
      client={client}
      token={scope.token}
      userId={session.user.id}
      scope={scope.nonce}
      siteIds={siteIds}
      siteId={matchedSiteId}
      cameraId={cameraId}
      frameKey={frameKey}
    />
  );
}

function ScopedFramePpeInbox({
  client,
  token,
  userId,
  scope,
  siteIds,
  siteId,
  cameraId,
  frameKey,
}: ScopedProps) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filterScopeKey, setFilterScopeKey] = useState(() =>
    JSON.stringify([siteId, cameraId, frameKey]),
  );
  const currentFilterKey = JSON.stringify([siteId, cameraId, frameKey]);
  if (filterScopeKey !== currentFilterKey) {
    setFilterScopeKey(currentFilterKey);
    if (unreadOnly) setUnreadOnly(false);
  }

  const query = useInfiniteQuery({
    queryKey: ['frame-ppe-inbox', scope, siteId, cameraId, frameKey, unreadOnly],
    queryFn: ({ pageParam, signal }) =>
      client.listSafetyFrameInbox(
        token,
        {
          offset: pageParam,
          limit: 20,
          readStatus: unreadOnly ? 'UNREAD' : 'ALL',
          siteId,
          cameraId,
          frameKey,
        },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      last.items.length && offset + last.items.length < last.total
        ? offset + last.items.length
        : undefined,
    retry: false,
    gcTime: 0,
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && [401, 403, 404].includes(q.state.error.status ?? 0)
        ? false
        : 10_000,
    refetchIntervalInBackground: false,
  });

  const revoked =
    query.error instanceof ApiError && [401, 403, 404].includes(query.error.status ?? 0);
  const visible = !revoked && (!query.isError || query.isFetchNextPageError);
  const allowedSiteSet = new Set(siteIds.map((id) => id.toLowerCase()));
  const siteFrames = visible
    ? (query.data?.pages
        .flatMap((page) => page.items)
        .filter(
          (frame) =>
            allowedSiteSet.has(frame.siteId.toLowerCase()) &&
            (siteId === undefined || sameSafetyId(frame.siteId, siteId)),
        ) ?? [])
    : [];

  const cameraCatalogKey = JSON.stringify([scope, siteId ?? '']);
  const [knownCameraCatalog, setKnownCameraCatalog] = useState<{
    key: string;
    serialized: string;
    items: readonly FrameCameraOption[];
  }>(() => ({ key: cameraCatalogKey, serialized: '[]', items: [] }));

  const cameraMap = new Map<string, FrameCameraOption>();
  if (!revoked) {
    if (knownCameraCatalog.key === cameraCatalogKey) {
      for (const cam of knownCameraCatalog.items) {
        cameraMap.set(cam.id, cam);
      }
    }
    for (const frame of siteFrames) {
      const id = frame.cameraId.toLowerCase();
      const name =
        !siteId && siteIds.length > 1 && frame.siteName
          ? `${frame.siteName} · ${frame.cameraName}`
          : frame.cameraName;
      cameraMap.set(id, { id, name });
    }
  }
  const availableCameras = [...cameraMap.values()];
  const nextCameraSerialized = JSON.stringify(availableCameras);
  if (
    knownCameraCatalog.key !== cameraCatalogKey ||
    knownCameraCatalog.serialized !== nextCameraSerialized
  ) {
    setKnownCameraCatalog({
      key: cameraCatalogKey,
      serialized: nextCameraSerialized,
      items: availableCameras,
    });
  }

  const frames = cameraId
    ? siteFrames.filter((frame) => sameSafetyId(frame.cameraId, cameraId))
    : siteFrames;
  const unreadCount = query.data?.pages.at(-1)?.unreadCount ?? 0;
  const hasFrames = frames.length > 0;
  const c02Enabled = isSafetyIdentificationRouteEnabled();
  const isTourReady =
    !revoked && !query.isPending && (!query.isError || query.isFetchNextPageError);
  const tourScopeKey = `${scope}:${siteId ?? 'all'}:${cameraId ?? 'all'}:${frameKey ?? 'all'}:${unreadOnly ? 'unread' : 'all'}`;
  const tourSteps = useMemo(
    () => buildFrameInboxTourSteps({ hasFrames, enableIdentification: c02Enabled }),
    [hasFrames, c02Enabled],
  );
  const allFramesParams = new URLSearchParams({
    tab: 'ppe-frames',
    ...(siteId ? { siteId } : {}),
    ...(cameraId ? { cameraId } : {}),
  });

  return (
    <section className="w-full min-w-0 space-y-3" aria-label={t('frameInbox.title')}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header
          data-testid="frame-inbox-header"
          className="space-y-3 border-b border-slate-200 px-4 py-4 sm:px-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <div
              data-testid="frame-inbox-title-row"
              className="flex min-w-[min(100%,20rem)] flex-1 flex-wrap items-center gap-3"
            >
              <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-slate-950">
                {t('frameInbox.title')}
              </h1>
              {visible && query.data && (
                <div
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap tabular-nums ${
                    unreadCount > 0
                      ? 'border-teal-700/25 bg-teal-50/80 text-teal-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${unreadCount > 0 ? 'bg-teal-700' : 'bg-slate-400'}`}
                  />
                  <p role="status">{t('frameInbox.unreadCount', { count: unreadCount })}</p>
                </div>
              )}
              {frameKey && (
                <Link
                  className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium whitespace-nowrap text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                  to={`/incidents?${allFramesParams}`}
                >
                  {t('frameInbox.allFrames')}
                </Link>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-800 ${
                  unreadOnly
                    ? 'border-teal-700/60 bg-teal-50/80 text-teal-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  className="h-4 w-4 shrink-0 rounded border-slate-400 accent-teal-800 focus-visible:outline-none"
                  onChange={(event) => setUnreadOnly(event.target.checked)}
                />
                {t('frameInbox.unreadOnly')}
              </label>
              <button
                type="button"
                disabled={query.isFetching || revoked}
                onClick={() => void query.refetch()}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium whitespace-nowrap text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {query.isFetching ? t('frameInbox.refreshing') : t('common.refresh')}
              </button>
            </div>
          </div>

          <p
            data-testid="frame-inbox-header-scope-note"
            className="w-full min-w-0 text-sm leading-snug text-slate-600"
          >
            {tSafety('frameInbox.scopeCountNote')}
          </p>

          <div data-tour-anchor="frame-inbox-filters" className="border-t border-slate-100 pt-3">
            <FrameInboxSiteFilter
              client={client}
              token={token}
              scope={scope}
              siteIds={siteIds}
              siteId={siteId}
              cameraId={cameraId}
              availableCameras={availableCameras}
            />
          </div>
        </header>

        {query.isPending && (
          <p role="status" className="px-5 py-8 text-sm text-slate-600">
            {t('frameInbox.loading')}
          </p>
        )}
        {query.isError && (
          <div className="p-4">
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
            >
              <span>{revoked ? t('frameInbox.unavailable') : t('frameInbox.loadError')}</span>
              {!revoked && (
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg border border-amber-400/80 bg-white px-3 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                  onClick={() =>
                    void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
                  }
                >
                  {t('common.retry')}
                </button>
              )}
            </div>
          </div>
        )}
        {query.isSuccess && !frames.length && (
          <p role="status" className="px-6 py-10 text-center text-sm text-slate-600">
            {t('frameInbox.empty')}
          </p>
        )}

        <div>
          <FrameInboxCards
            key={JSON.stringify([siteId, cameraId, frameKey, unreadOnly])}
            client={client}
            token={token}
            scope={scope}
            frames={frames}
            cameraId={cameraId}
            frameKey={frameKey}
            onRefetch={() => query.refetch()}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <div>
          {visible && query.hasNextPage && !query.isFetchNextPageError && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50"
            >
              {t('common.load_more')}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SafetyTaskTour
            taskId="frame-inbox"
            tourVersion={FRAME_INBOX_TOUR_VERSION}
            userId={userId}
            scopeKey={tourScopeKey}
            isAuthorized={isTourReady}
            steps={tourSteps}
          />
        </div>
      </div>
    </section>
  );
}
