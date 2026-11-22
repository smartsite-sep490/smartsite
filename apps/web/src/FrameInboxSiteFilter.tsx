import { SmartNativeSelect } from './components/ui/SmartNativeSelect';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import { IconBuilding, IconCamera, IconFilter, IconX } from './components/icons';
import { Badge } from './components/ui';
import { useManagementClient } from './features/auth/auth-session';

export interface FrameCameraOption {
  id: string;
  name: string;
}

export function FrameInboxSiteFilter({
  client,
  token,
  scope,
  siteIds,
  siteId,
  cameraId,
  availableCameras = [],
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteIds: string[];
  siteId?: string;
  cameraId?: string;
  availableCameras?: readonly FrameCameraOption[];
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sites = useInfiniteQuery({
    queryKey: ['frame-inbox-sites', scope],
    queryFn: ({ pageParam, signal }) =>
      client.listSites(token, { offset: pageParam, limit: 20 }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      last.items.length && offset + last.items.length < last.total
        ? offset + last.items.length
        : undefined,
    retry: false,
    gcTime: 0,
  });

  const canLoadCameras = Boolean(siteId) && typeof client.listPreviewCameras === 'function';
  const cameras = useQuery({
    queryKey: ['frame-inbox-cameras', scope, siteId],
    queryFn: async ({ signal }) => {
      if (!siteId) return [];
      const res = await client.listPreviewCameras(
        token,
        siteId,
        { offset: 0, limit: 100 },
        { signal },
      );
      return Array.isArray(res?.items) ? res.items : [];
    },
    enabled: canLoadCameras,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const revoked =
    sites.error instanceof ApiError && [401, 403, 404].includes(sites.error.status ?? 0);
  const visible = !revoked && (!sites.isError || sites.isFetchNextPageError);
  const names = new Map(
    visible
      ? (sites.data?.pages
          .flatMap((page) => page.items)
          .filter((site) => siteIds.includes(site.id))
          .map((site) => [site.id, site.name]) ?? [])
      : [],
  );

  const camerasRevoked =
    cameras.error instanceof ApiError && [401, 403, 404].includes(cameras.error.status ?? 0);
  const cameraMap = new Map<string, string>();
  if (!revoked) {
    for (const cam of availableCameras) {
      const normalized = cam.id.toLowerCase();
      if (!cameraMap.has(normalized)) cameraMap.set(normalized, cam.name);
    }
    if (!camerasRevoked && !cameras.isError) {
      for (const cam of cameras.data ?? []) {
        cameraMap.set(cam.id.toLowerCase(), cam.name);
      }
    }
    if (cameraId && !cameraMap.has(cameraId)) {
      cameraMap.set(cameraId, t('frameInbox.cameraNamePending'));
    }
  }
  const cameraOptions = [...cameraMap.entries()];
  const hasActiveFilter = Boolean(siteId || cameraId);

  function applySiteFilter(nextSiteId: string) {
    const next = new URLSearchParams(params);
    for (const key of ['siteId', 'cameraId', 'frameKey', 'recipientId', 'episodeId', 'requestId']) {
      next.delete(key);
    }
    if (nextSiteId) next.set('siteId', nextSiteId);
    setParams(next);
  }

  function applyCameraFilter(nextCameraId: string) {
    const next = new URLSearchParams(params);
    for (const key of ['cameraId', 'frameKey', 'recipientId', 'episodeId', 'requestId']) {
      next.delete(key);
    }
    if (nextCameraId) next.set('cameraId', nextCameraId);
    setParams(next);
  }

  return (
    <div
      className={`space-y-2.5 rounded-2xl border p-3.5 sm:p-4 transition-colors ${
        hasActiveFilter && !revoked
          ? 'border-teal-700/45 bg-teal-50/60 shadow-xs ring-1 ring-teal-700/15'
          : 'border-slate-200/90 bg-white shadow-xs'
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <label className="block w-full space-y-1.5 text-sm font-semibold text-slate-900">
            {t('episodes.site')}
            <SmartNativeSelect
              value={siteId ?? ''}
              disabled={revoked}
              className={`block w-full rounded-xl border px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
                siteId && !revoked
                  ? 'border-teal-700 bg-white font-semibold text-teal-950 ring-1 ring-teal-700/20'
                  : 'border-slate-300 bg-white font-medium text-slate-900 hover:border-slate-400'
              }`}
              onChange={(event) => applySiteFilter(event.target.value)}
            >
              <option value="">{t('episodes.allSites')}</option>
              {siteIds.map((id) => (
                <option key={id} value={id} disabled={!names.has(id)}>
                  {names.get(id) ?? t('episodes.siteNamePending')}
                </option>
              ))}
            </SmartNativeSelect>
          </label>
          <label className="block w-full space-y-1.5 text-sm font-semibold text-slate-900">
            {t('episodes.camera')}
            <SmartNativeSelect
              value={cameraId ?? ''}
              disabled={revoked || (cameraOptions.length === 0 && !cameraId)}
              className={`block w-full rounded-xl border px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
                cameraId && !revoked
                  ? 'border-teal-700 bg-white font-semibold text-teal-950 ring-1 ring-teal-700/20'
                  : 'border-slate-300 bg-white font-medium text-slate-900 hover:border-slate-400'
              }`}
              onChange={(event) => applyCameraFilter(event.target.value)}
            >
              <option value="">{t('frameInbox.allCameras')}</option>
              {cameraOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </SmartNativeSelect>
          </label>
        </div>
        {!revoked && (
          <div className="flex flex-wrap items-center gap-2">
            {siteId ? (
              <>
                <Badge
                  variant="info"
                  dot
                  className="normal-case tracking-normal border-teal-700/30 bg-teal-100/80 px-2.5 py-1 text-xs font-semibold text-teal-950"
                >
                  <IconFilter className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t('frameInbox.activeSiteBadge', {
                      site: names.get(siteId) ?? t('episodes.siteNamePending'),
                    })}
                  </span>
                </Badge>
                <button
                  type="button"
                  onClick={() => applySiteFilter('')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-950 shadow-2xs transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30"
                >
                  <IconX className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('frameInbox.clearSiteFilter')}</span>
                </button>
              </>
            ) : (
              <Badge
                variant="neutral"
                dot
                className="normal-case tracking-normal px-2.5 py-1 text-xs font-medium"
              >
                <IconBuilding className="h-3.5 w-3.5 shrink-0" />
                <span>{t('frameInbox.allAssignedSitesBadge', { count: siteIds.length })}</span>
              </Badge>
            )}
            {cameraId && (
              <>
                <Badge
                  variant="info"
                  dot
                  className="normal-case tracking-normal border-teal-700/30 bg-teal-100/80 px-2.5 py-1 text-xs font-semibold text-teal-950"
                >
                  <IconCamera className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t('frameInbox.activeCameraBadge', {
                      camera: cameraMap.get(cameraId) ?? t('frameInbox.cameraNamePending'),
                    })}
                  </span>
                </Badge>
                <button
                  type="button"
                  onClick={() => applyCameraFilter('')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-950 shadow-2xs transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30"
                >
                  <IconX className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('frameInbox.clearCameraFilter')}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {sites.isPending && (
        <p role="status" className="text-xs text-slate-600">
          {t('common.loading')}
        </p>
      )}
      {sites.isError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950"
        >
          {revoked ? t('frameInbox.unavailable') : t('frameInbox.siteLoadError')}
          {!revoked && (
            <button
              type="button"
              className="ml-2 rounded px-1 font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
              onClick={() =>
                void (sites.isFetchNextPageError ? sites.fetchNextPage() : sites.refetch())
              }
            >
              {t('common.retry')}
            </button>
          )}
        </p>
      )}
      {!revoked && cameras.isError && !camerasRevoked && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950"
        >
          {t('frameInbox.cameraLoadError')}
        </p>
      )}
      {visible && sites.hasNextPage && !sites.isFetchNextPageError && (
        <button
          type="button"
          className="inline-flex items-center rounded-lg px-2 py-1 text-xs sm:text-sm font-semibold text-teal-900 underline decoration-teal-700/60 underline-offset-2 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:opacity-50"
          disabled={sites.isFetchingNextPage}
          onClick={() => void sites.fetchNextPage()}
        >
          {sites.isFetchingNextPage ? t('common.loading') : t('episodes.moreSites')}
        </button>
      )}
    </div>
  );
}
