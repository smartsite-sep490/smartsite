import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { useManagementClient } from '../../features/auth/auth-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './tracked-episode-workspace-catalog';
import { Button, Card } from '../ui';
import {
  EpisodeInboxFilters,
  EpisodeLocalDetailSection,
  EpisodeQueueList,
} from './EpisodeLocalDetailSection';
import {
  sameSafetyId,
  sanitizeSameAppIncidentsHref,
  sanitizeSafetyQueryId,
  uniqueCanonicalIds,
} from './safetyUrlParams';
import { TrackedEpisodeEvidenceWorkspace } from './TrackedEpisodeEvidenceWorkspace';

const size = 20;
const hardDenial = (error: unknown) =>
  error instanceof ApiError && error.status !== undefined && [401, 403, 404].includes(error.status);
const pageSignature = (page: {
  items: { id: string; episode: { contentRevision: number }; seenRevision: number }[];
  total: number;
}) =>
  JSON.stringify([
    page.total,
    page.items.map((row) => [row.id, row.episode.contentRevision, row.seenRevision]),
  ]);

interface SafetyEpisodeInboxProps {
  apiUrl: string;
  session: Pick<LoginResponse, 'accessToken' | 'user'>;
  scope: string;
  sites: string[];
  returnToFrameHref?: string;
  onSignOut?: () => void;
}

export function SafetyEpisodeInbox({
  apiUrl,
  session,
  scope,
  sites,
  returnToFrameHref,
  onSignOut,
}: SafetyEpisodeInboxProps) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [params, setParams] = useSearchParams();
  const canonicalSites = uniqueCanonicalIds(sites);
  const allowedSiteMap = new Map(canonicalSites.map((id) => [id.toLowerCase(), id] as const));

  const rawSiteParam = params.get('siteId');
  const hasSiteParam = rawSiteParam !== null && rawSiteParam.trim() !== '';
  const sanitizedSiteParam = sanitizeSafetyQueryId(rawSiteParam);
  const matchedSiteId = sanitizedSiteParam
    ? allowedSiteMap.get(sanitizedSiteParam.toLowerCase())
    : undefined;
  const siteId = matchedSiteId ?? '';

  const readStatus: 'ALL' | 'UNREAD' = params.get('readStatus') === 'UNREAD' ? 'UNREAD' : 'ALL';

  const rawRecipientParam = params.get('recipientId');
  const hasRecipientParam = rawRecipientParam !== null && rawRecipientParam.trim() !== '';
  const recipientId = sanitizeSafetyQueryId(rawRecipientParam) ?? '';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackedRecipientKey, setTrackedRecipientKey] = useState(rawRecipientParam ?? '');
  if (trackedRecipientKey !== (rawRecipientParam ?? '')) {
    setTrackedRecipientKey(rawRecipientParam ?? '');
    setSelectedId(null);
  }

  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const alive = useRef(true);
  const signedOut = useRef(false);
  const prefix = ['safety-episode-workspace', apiUrl, scope];

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const queryKey = ['safety-episode-workspace', apiUrl, scope];
      void cache.cancelQueries({ queryKey });
      cache.removeQueries({ queryKey });
    };
  }, [apiUrl, scope, cache]);

  async function request<T>(work: Promise<T> | (() => Promise<T>)): Promise<T> {
    try {
      return await (typeof work === 'function' ? work() : work);
    } catch (error) {
      if (
        alive.current &&
        !signedOut.current &&
        error instanceof ApiError &&
        error.status === 401
      ) {
        signedOut.current = true;
        onSignOut?.();
      }
      throw error;
    }
  }

  const permitted =
    (!hasSiteParam || Boolean(matchedSiteId)) && (!hasRecipientParam || Boolean(recipientId));

  const metadata = useInfiniteQuery({
    queryKey: [...prefix, 'sites'],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      request(
        client.listSites(session.accessToken, { offset: pageParam, limit: size }, { signal }),
      ),
    getNextPageParam: (last, pages) => {
      const raw = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && raw < last.total ? raw : undefined;
    },
    enabled: permitted,
    retry: false,
  });

  const inboxQueryOptions = (offset: number) =>
    recipientId
      ? { recipientId, limit: 1 }
      : { offset, limit: size, readStatus, ...(siteId ? { siteId } : {}) };

  const inbox = useInfiniteQuery({
    queryKey: [...prefix, 'inbox', siteId, readStatus, recipientId],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      request(() =>
        client.listSafetyEpisodeInbox(session.accessToken, inboxQueryOptions(pageParam), {
          signal,
        }),
      ),
    getNextPageParam: (last, pages) => {
      if (recipientId) return undefined;
      const raw = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && raw < last.total ? raw : undefined;
    },
    enabled: permitted,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const updates = useQuery({
    queryKey: [...prefix, 'updates', siteId, readStatus, recipientId],
    queryFn: ({ signal }) =>
      request(() =>
        client.listSafetyEpisodeInbox(session.accessToken, inboxQueryOptions(0), { signal }),
      ),
    enabled: false,
    retry: false,
  });

  const changed =
    Boolean(updates.data) &&
    Boolean(inbox.data?.pages[0]) &&
    pageSignature(updates.data!) !== pageSignature(inbox.data!.pages[0]!);
  const rawRows = [
    ...new Map(
      (inbox.data?.pages.flatMap((p) => p.items) ?? []).map((row) => [row.id, row]),
    ).values(),
  ];
  const recipientOutOfScope =
    recipientId !== '' &&
    rawRows.some(
      (row) =>
        !allowedSiteMap.has(row.episode.siteId.toLowerCase()) ||
        (siteId !== '' && !sameSafetyId(row.episode.siteId, siteId)),
    );
  const sitePermitted = permitted && !recipientOutOfScope;
  const blocked =
    !sitePermitted ||
    (updates.isError && hardDenial(updates.error)) ||
    (inbox.isError && (!inbox.isFetchNextPageError || hardDenial(inbox.error))) ||
    (metadata.isError && (!metadata.isFetchNextPageError || hardDenial(metadata.error)));
  const rows = blocked
    ? []
    : rawRows.filter(
        (row) =>
          allowedSiteMap.has(row.episode.siteId.toLowerCase()) &&
          (siteId === '' || sameSafetyId(row.episode.siteId, siteId)) &&
          (recipientId === '' || sameSafetyId(row.id, recipientId)) &&
          (readStatus !== 'UNREAD' || row.unread),
      );
  const names = new Map(
    (metadata.data?.pages.flatMap((p) => p.items) ?? [])
      .filter((s) => allowedSiteMap.has(s.id.toLowerCase()))
      .map((s) => [s.id.toLowerCase(), s.name]),
  );

  const visibleCameraSiteIds = uniqueCanonicalIds(rows.map((row) => row.episode.siteId)).slice(
    0,
    5,
  );
  const cameraLookup = useQuery({
    queryKey: [...prefix, 'cameras', visibleCameraSiteIds.join(',')],
    queryFn: async ({ signal }) => {
      const settled = await Promise.allSettled(
        visibleCameraSiteIds.map(async (targetSiteId) => {
          const res = await request(
            client.listPreviewCameras(
              session.accessToken,
              targetSiteId,
              { offset: 0, limit: 100 },
              { signal },
            ),
          );
          return { siteId: targetSiteId, items: Array.isArray(res?.items) ? res.items : [] };
        }),
      );
      const entries: Array<[string, string]> = [];
      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        for (const cam of item.value.items) {
          if (cam?.id && cam?.name) {
            entries.push([`${item.value.siteId.toLowerCase()}::${cam.id.toLowerCase()}`, cam.name]);
          }
        }
      }
      return entries;
    },
    enabled:
      !blocked &&
      visibleCameraSiteIds.length > 0 &&
      typeof client.listPreviewCameras === 'function',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const cameraNames = new Map(cameraLookup.data ?? []);
  const safeReturnToFrameHref = sanitizeSameAppIncidentsHref(returnToFrameHref);

  const selected =
    rows.find((row) => row.id === selectedId) ??
    (recipientId ? rows.find((row) => sameSafetyId(row.id, recipientId)) : undefined);

  const detail = useQuery({
    queryKey: [...prefix, 'detail', selected?.episode.siteId, selected?.episode.id],
    queryFn: async ({ signal }) => {
      if (!selected) throw new Error('Episode not selected');
      const value = await request(
        client.getSafetyEpisode(session.accessToken, selected.episode.siteId, selected.episode.id, {
          signal,
        }),
      );
      if (
        !sameSafetyId(value.id, selected.episode.id) ||
        !sameSafetyId(value.siteId, selected.episode.siteId) ||
        !allowedSiteMap.has(value.siteId.toLowerCase())
      ) {
        throw new Error('Episode scope mismatch');
      }
      return value;
    },
    enabled: selected?.episode.subject.kind === 'EVENT_LOCAL' && !blocked,
    retry: false,
  });

  const visible = selected && !detail.isError ? detail.data : undefined;
  const visibleLocalEpisode =
    visible && visible.subject.kind === 'EVENT_LOCAL'
      ? ({ ...visible, subject: visible.subject } as const)
      : undefined;

  const read = useMutation({
    mutationFn: async ({ id, revision }: { id: string; revision: number }) =>
      request(client.readSafetyEpisodeInbox(session.accessToken, id, { seenRevision: revision })),
    retry: false,
    onSuccess: async () => {
      await cache.cancelQueries({ queryKey: [...prefix, 'updates'] });
      await cache.invalidateQueries({ queryKey: prefix });
      await cache.resetQueries({ queryKey: [...prefix, 'updates'] });
    },
  });

  function revisionAction(id: string, revision: number, recheck: () => Promise<boolean>) {
    const selectedResult = read.variables?.id === id;
    if (selectedResult && read.isError) {
      return (
        <div role="alert">
          <p>{t('episodes.readUncertain')}</p>
          <Button
            variant="outline"
            onClick={async () => {
              const [list, detailOk] = await Promise.all([inbox.refetch(), recheck()]);
              if (!list.isError && detailOk) read.reset();
            }}
          >
            {t('episodes.reconcile')}
          </Button>
        </div>
      );
    }
    return (
      <>
        <Button
          variant="outline"
          disabled={read.isPending}
          onClick={() => read.mutate({ id, revision })}
        >
          {t('episodes.markRead')}
        </Button>
        {selectedResult && read.data && (
          <p role="status" className="text-sm">
            {t(read.data.unread ? 'episodes.newer' : 'episodes.readSaved')}
          </p>
        )}
      </>
    );
  }

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('recipientId');
    if (key === 'siteId') {
      next.delete('cameraId');
      next.delete('frameKey');
    }
    if (value) next.set(key, value);
    else next.delete(key);
    setSelectedId(null);
    read.reset();
    setParams(next);
  }

  const latest = inbox.data?.pages.at(-1);
  const failed =
    blocked || inbox.isFetchNextPageError || metadata.isFetchNextPageError || updates.isError;
  const alertMessageKey = !sitePermitted
    ? 'episodes.deniedSite'
    : blocked
      ? 'episodes.unavailable'
      : updates.isError
        ? 'episodes.updateCheckFailed'
        : 'episodes.nextFailed';

  return (
    <section aria-labelledby="episode-inbox-heading" className="space-y-4">
      <EpisodeInboxFilters
        loadedCount={rows.length}
        totalCount={blocked ? '—' : (latest?.total ?? '—')}
        unreadCount={blocked ? '—' : (latest?.unreadCount ?? '—')}
        refreshDisabled={!sitePermitted || read.isPending}
        refreshLoading={updates.isFetching || (inbox.isRefetching && !inbox.isFetchingNextPage)}
        showUpdatesBanner={changed && !blocked}
        loadUpdatesDisabled={inbox.isFetching || updates.isFetching || read.isPending}
        siteId={siteId}
        readStatus={readStatus}
        canonicalSites={canonicalSites}
        siteNames={names}
        hasMoreSites={Boolean(metadata.hasNextPage || metadata.isFetchNextPageError)}
        isFetchingNextSitesPage={metadata.isFetchingNextPage}
        onRefresh={() => {
          if (!sitePermitted) return;
          void metadata.refetch();
          if (inbox.isError || !inbox.data) void inbox.refetch();
          void updates.refetch();
        }}
        onLoadUpdates={() => {
          void (async () => {
            const result = await inbox.refetch();
            if (!result.isError) await cache.resetQueries({ queryKey: [...prefix, 'updates'] });
          })();
        }}
        onFilterChange={filter}
        onLoadMoreSites={() => void metadata.fetchNextPage()}
      />
      {failed && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          {t(alertMessageKey)}{' '}
          {sitePermitted && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (metadata.isFetchNextPageError && !hardDenial(metadata.error)) {
                  void metadata.fetchNextPage();
                } else if (metadata.isError) {
                  void metadata.refetch();
                }
                if (inbox.isFetchNextPageError && !hardDenial(inbox.error)) {
                  void inbox.fetchNextPage();
                } else if (inbox.isError) {
                  void inbox.refetch();
                }
                if (updates.isError) void updates.refetch();
              }}
            >
              {t('episodes.retry')}
            </Button>
          )}
        </div>
      )}
      {inbox.isPending && permitted && <p role="status">{t('episodes.loading')}</p>}
      {!blocked && inbox.isSuccess && rows.length === 0 && (
        <Card>
          <p role="status">{t(readStatus === 'UNREAD' ? 'episodes.noUnread' : 'episodes.empty')}</p>
        </Card>
      )}
      {rows.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <EpisodeQueueList
            rows={rows}
            selectedId={selected?.id}
            siteNames={names}
            cameraNames={cameraNames}
            hasNextPage={Boolean(inbox.hasNextPage)}
            isFetchNextPageError={inbox.isFetchNextPageError}
            isFetchingNextPage={inbox.isFetchingNextPage}
            nextPageForbidden={hardDenial(inbox.error)}
            onSelectRow={(rowId) => {
              setSelectedId(rowId);
              read.reset();
            }}
            onLoadMore={() => void inbox.fetchNextPage()}
          />
          <div
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
            aria-label={t('episodes.detail')}
          >
            {!selected && (
              <div
                data-testid="episode-empty-guidance"
                className="max-w-xl space-y-3.5 py-2 text-left"
              >
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-950">{t('episodes.select')}</h2>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {tSafety('episodes.emptyGuideHint')}
                  </p>
                </div>
                <p className="text-sm font-medium text-slate-700 tabular-nums">
                  {t('episodes.count', {
                    loaded: rows.length,
                    total: blocked ? '—' : (latest?.total ?? '—'),
                    unread: blocked ? '—' : (latest?.unreadCount ?? '—'),
                  })}
                </p>
                <ol className="space-y-2 border-t border-slate-100 pt-3.5 text-sm leading-relaxed text-slate-600">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 tabular-nums">
                      1
                    </span>
                    <span>{tSafety('episodes.emptyGuideStep1')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 tabular-nums">
                      2
                    </span>
                    <span>{tSafety('episodes.emptyGuideStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 tabular-nums">
                      3
                    </span>
                    <span>{tSafety('episodes.emptyGuideStep3')}</span>
                  </li>
                </ol>
              </div>
            )}
            {selected?.episode.subject.kind === 'EVENT_LOCAL' && detail.isPending && (
              <p role="status">{t('episodes.loading')}</p>
            )}
            {selected?.episode.subject.kind === 'TRACKED' && (
              <TrackedEpisodeEvidenceWorkspace
                client={client}
                token={session.accessToken}
                sessionScope={scope}
                apiUrl={apiUrl}
                siteId={selected.episode.siteId}
                episodeId={selected.episode.id}
                originRecipientId={selected.id}
                returnToFrameHref={
                  recipientId && sameSafetyId(selected.id, recipientId)
                    ? safeReturnToFrameHref
                    : undefined
                }
                canReviewFindings
                renderRevisionAction={(revision, recheck) =>
                  revisionAction(selected.id, revision, recheck)
                }
              />
            )}
            {selected?.episode.subject.kind === 'EVENT_LOCAL' && detail.isError && (
              <div role="alert">
                {t('episodes.unavailable')}{' '}
                <Button variant="outline" onClick={() => void detail.refetch()}>
                  {t('episodes.retry')}
                </Button>
              </div>
            )}
            {selected && visibleLocalEpisode && (
              <EpisodeLocalDetailSection
                apiUrl={apiUrl}
                client={client}
                token={session.accessToken}
                scope={scope}
                episode={visibleLocalEpisode}
                originRecipientId={selected.id}
                renderRevisionAction={() =>
                  revisionAction(
                    selected.id,
                    visibleLocalEpisode.contentRevision,
                    async () => !(await detail.refetch()).isError,
                  )
                }
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
