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
    <section className="w-full min-w-0 space-y-3.5" aria-label={t('frameInbox.title')}>
      <header className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs sm:px-5">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-slate-950">
                {t('frameInbox.title')}
              </h1>
              {visible && query.data && (
                <div
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs sm:text-sm font-semibold tabular-nums ${
                    unreadCount > 0
                      ? 'border-teal-700/35 bg-teal-50 text-teal-950'
                      : 'border-slate-200 bg-slate-100 text-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${unreadCount > 0 ? 'bg-teal-700' : 'bg-slate-400'}`}
                  />
                  <p role="status">{t('frameInbox.unreadCount', { count: unreadCount })}</p>
                </div>
              )}
              {frameKey && (
                <Link
                  className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs sm:text-sm font-semibold text-teal-900 underline decoration-teal-700/60 underline-offset-2 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30"
                  to={`/incidents?${allFramesParams}`}
                >
                  {t('frameInbox.allFrames')}
                </Link>
              )}
            </div>
            <p
              data-testid="frame-inbox-header-scope-note"
              className="min-w-0 text-xs sm:text-[13px] leading-relaxed text-slate-600"
            >
              {tSafety('frameInbox.scopeCountNote')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
            <label
              className={`inline-flex h-10 cursor-pointer select-none items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-800 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-700/30 ${
                unreadOnly
                  ? 'border-teal-700 bg-teal-50 text-teal-950 ring-1 ring-teal-700/20'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unreadOnly}
                className="h-4 w-4 rounded border-slate-400 accent-teal-800 focus-visible:outline-none"
                onChange={(event) => setUnreadOnly(event.target.checked)}
              />
              {t('frameInbox.unreadOnly')}
            </label>
            <button
              type="button"
              disabled={query.isFetching || revoked}
              onClick={() => void query.refetch()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-900 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {query.isFetching ? t('frameInbox.refreshing') : t('common.refresh')}
            </button>
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

        <div data-tour-anchor="frame-inbox-filters">
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
        <p role="status" className="text-sm text-slate-600">
          {t('frameInbox.loading')}
        </p>
      )}
      {query.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
        >
          <span>{revoked ? t('frameInbox.unavailable') : t('frameInbox.loadError')}</span>
          {!revoked && (
            <button
              type="button"
              className="inline-flex min-h-8 items-center rounded-lg border border-amber-400/80 bg-white px-3 py-1 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
              onClick={() =>
                void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
              }
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
      {query.isSuccess && !frames.length && (
        <p
          role="status"
          className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600"
        >
          {t('frameInbox.empty')}
        </p>
      )}

      <div className="space-y-2.5">
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

      {visible && query.hasNextPage && !query.isFetchNextPageError && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="inline-flex min-h-10 w-full sm:w-auto items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:opacity-50"
        >
          {t('common.load_more')}
        </button>
      )}
    </section>
  );
}
