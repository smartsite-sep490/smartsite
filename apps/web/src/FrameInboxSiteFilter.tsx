import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import { IconBuilding, IconCamera, IconChevronDown, IconFilter, IconX } from './components/icons';
import { useManagementClient } from './features/auth/auth-session';
import './frame-inbox-catalog';
import { SAFETY_NAMESPACE } from './i18n/runtime';

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
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const filterControlsId = useId();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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

  const activeFilterCount = Number(Boolean(siteId)) + Number(Boolean(cameraId));
  const activeSiteName = siteId ? (names.get(siteId) ?? t('episodes.siteNamePending')) : undefined;
  const activeCameraName = cameraId
    ? (cameraMap.get(cameraId) ?? t('frameInbox.cameraNamePending'))
    : undefined;
  const activeSiteBadgeText = activeSiteName
    ? t('frameInbox.activeSiteBadge', { site: activeSiteName })
    : undefined;
  const activeCameraBadgeText = activeCameraName
    ? t('frameInbox.activeCameraBadge', { camera: activeCameraName })
    : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className={`flex min-w-0 gap-2 lg:order-2 lg:justify-end ${
            activeFilterCount > 0
              ? 'flex-col items-stretch sm:flex-row sm:flex-wrap sm:items-center'
              : 'flex-wrap items-center justify-between'
          }`}
        >
          {!revoked && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:gap-2 lg:flex-initial lg:justify-end">
              {siteId && activeSiteBadgeText ? (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 sm:max-w-none">
                  <span
                    title={activeSiteBadgeText}
                    className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-teal-700/25 bg-teal-50/75 px-2 py-1 text-xs font-medium text-teal-950 sm:max-w-[min(100%,18rem)] sm:items-center sm:px-2.5"
                  >
                    <IconFilter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 sm:mt-0" />
                    <span title={activeSiteBadgeText} className="break-words sm:truncate">
                      {activeSiteBadgeText}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => applySiteFilter('')}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                  >
                    <IconX className="h-3.5 w-3.5 shrink-0" />
                    <span>{t('frameInbox.clearSiteFilter')}</span>
                  </button>
                </div>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 tabular-nums">
                  <IconBuilding className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">
                    {t('frameInbox.allAssignedSitesBadge', { count: siteIds.length })}
                  </span>
                </span>
              )}
              {cameraId && activeCameraBadgeText && (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 sm:max-w-none">
                  <span
                    title={activeCameraBadgeText}
                    className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-teal-700/25 bg-teal-50/75 px-2 py-1 text-xs font-medium text-teal-950 sm:max-w-[min(100%,16rem)] sm:items-center sm:px-2.5"
                  >
                    <IconCamera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 sm:mt-0" />
                    <span title={activeCameraBadgeText} className="break-words sm:truncate">
                      {activeCameraBadgeText}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => applyCameraFilter('')}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                  >
                    <IconX className="h-3.5 w-3.5 shrink-0" />
                    <span>{t('frameInbox.clearCameraFilter')}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            data-testid="frame-inbox-mobile-filter-toggle"
            aria-expanded={mobileFiltersOpen}
            aria-controls={filterControlsId}
            disabled={revoked}
            onClick={() => setMobileFiltersOpen((prev) => !prev)}
            className={`inline-flex h-9 shrink-0 self-start items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden ${
              mobileFiltersOpen || activeFilterCount > 0
                ? 'border-teal-700/50 bg-teal-50/70 text-teal-950'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <IconFilter className="h-3.5 w-3.5 shrink-0" />
            <span>
              {mobileFiltersOpen
                ? tSafety('frameInbox.hideFilters')
                : activeFilterCount > 0
                  ? tSafety('frameInbox.filtersToggleActive', { count: activeFilterCount })
                  : tSafety('frameInbox.filtersToggle')}
            </span>
            <IconChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <div
          id={filterControlsId}
          data-testid="frame-inbox-filter-controls"
          className={`${mobileFiltersOpen ? 'grid' : 'hidden sm:grid'} w-full min-w-0 gap-2.5 sm:grid-cols-2 lg:order-1 lg:max-w-3xl lg:gap-3`}
        >
          <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5 text-sm font-medium text-slate-700">
            <span className="shrink-0 text-slate-600">{t('episodes.site')}</span>
            <select
              value={siteId ?? ''}
              disabled={revoked}
              title={activeSiteName ?? t('episodes.allSites')}
              className={`block h-9 w-full min-w-0 max-w-full truncate rounded-lg border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
                siteId && !revoked
                  ? 'border-teal-700/70 bg-teal-50/35 font-semibold text-teal-950'
                  : 'border-slate-200 bg-white font-medium text-slate-900 hover:border-slate-300'
              }`}
              onChange={(event) => applySiteFilter(event.target.value)}
            >
              <option value="">{t('episodes.allSites')}</option>
              {siteIds.map((id) => (
                <option key={id} value={id} disabled={!names.has(id)}>
                  {names.get(id) ?? t('episodes.siteNamePending')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5 text-sm font-medium text-slate-700">
            <span className="shrink-0 text-slate-600">{t('episodes.camera')}</span>
            <select
              value={cameraId ?? ''}
              disabled={revoked || (cameraOptions.length === 0 && !cameraId)}
              title={activeCameraName ?? t('frameInbox.allCameras')}
              className={`block h-9 w-full min-w-0 max-w-full truncate rounded-lg border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
                cameraId && !revoked
                  ? 'border-teal-700/70 bg-teal-50/35 font-semibold text-teal-950'
                  : 'border-slate-200 bg-white font-medium text-slate-900 hover:border-slate-300'
              }`}
              onChange={(event) => applyCameraFilter(event.target.value)}
            >
              <option value="">{t('frameInbox.allCameras')}</option>
              {cameraOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
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
