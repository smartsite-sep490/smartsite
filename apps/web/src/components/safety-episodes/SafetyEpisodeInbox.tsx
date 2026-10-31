import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { useManagementClient } from '../../features/auth/auth-session';
import { uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { Button, Card } from '../ui';
import { EpisodeEvidence } from './EpisodeEvidence';
const size = 20;
const hardDenial = (error: unknown) =>
  error instanceof ApiError && error.status !== undefined && [401, 403, 404].includes(error.status);
const date = (value: string) => new Date(value).toLocaleString(uiLocale());
export function SafetyEpisodeInbox({
  apiUrl,
  session,
  scope,
  sites,
  onSignOut,
}: {
  apiUrl: string;
  session: Pick<LoginResponse, 'accessToken' | 'user'>;
  scope: string;
  sites: string[];
  onSignOut?: () => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const siteId = params.get('siteId') ?? '';
  const readStatus = params.get('readStatus') === 'UNREAD' ? 'UNREAD' : 'ALL';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const alive = useRef(true),
    signedOut = useRef(false);
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
  async function request<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
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
  const permitted = siteId === '' || sites.includes(siteId);
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
  const inbox = useInfiniteQuery({
    queryKey: [...prefix, 'inbox', siteId, readStatus],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      request(
        client.listSafetyEpisodeInbox(
          session.accessToken,
          { offset: pageParam, limit: size, readStatus, ...(siteId ? { siteId } : {}) },
          { signal },
        ),
      ),
    getNextPageParam: (last, pages) => {
      const raw = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && raw < last.total ? raw : undefined;
    },
    enabled: permitted,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Check the first page explicitly without replacing the operator's current working list.
  const updates = useQuery({
    queryKey: [...prefix, 'updates', siteId, readStatus],
    queryFn: ({ signal }) =>
      request(
        client.listSafetyEpisodeInbox(
          session.accessToken,
          { offset: 0, limit: size, readStatus, ...(siteId ? { siteId } : {}) },
          { signal },
        ),
      ),
    enabled: false,
    retry: false,
  });
  const pageSignature = (page: {
    items: { id: string; episode: { contentRevision: number }; seenRevision: number }[];
    total: number;
  }) =>
    JSON.stringify([
      page.total,
      page.items.map((row) => [row.id, row.episode.contentRevision, row.seenRevision]),
    ]);
  const changed =
    !!updates.data &&
    !!inbox.data?.pages[0] &&
    pageSignature(updates.data) !== pageSignature(inbox.data.pages[0]);
  const blocked =
    !permitted ||
    (updates.isError && hardDenial(updates.error)) ||
    (inbox.isError && (!inbox.isFetchNextPageError || hardDenial(inbox.error))) ||
    (metadata.isError && (!metadata.isFetchNextPageError || hardDenial(metadata.error)));
  const rows = blocked
    ? []
    : [
        ...new Map(
          (inbox.data?.pages.flatMap((p) => p.items) ?? []).map((row) => [row.id, row]),
        ).values(),
      ];
  const names = new Map(
    (metadata.data?.pages.flatMap((p) => p.items) ?? [])
      .filter((s) => sites.includes(s.id))
      .map((s) => [s.id, s.name]),
  );
  const selected = rows.find((row) => row.id === selectedId);
  const detail = useQuery({
    queryKey: [...prefix, 'detail', selected?.episode.siteId, selected?.episode.id],
    queryFn: async ({ signal }) => {
      if (!selected) throw new Error('Episode not selected');
      const value = await request(
        client.getSafetyEpisode(session.accessToken, selected.episode.siteId, selected.episode.id, {
          signal,
        }),
      );
      if (value.id !== selected.episode.id || value.siteId !== selected.episode.siteId)
        throw new Error('Episode scope mismatch');
      return value;
    },
    enabled: !!selected && !blocked,
    retry: false,
  });
  const visible = selected && !detail.isError ? detail.data : undefined;
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
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setSelectedId(null);
    read.reset();
    setParams(next);
  }
  const latest = inbox.data?.pages.at(-1);
  const failed =
    blocked || inbox.isFetchNextPageError || metadata.isFetchNextPageError || updates.isError;
  return (
    <section aria-labelledby="episode-inbox-heading" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="episode-inbox-heading" className="text-2xl font-semibold text-slate-950">
            {t('episodes.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('episodes.count', {
              loaded: rows.length,
              total: blocked ? '—' : (latest?.total ?? '—'),
              unread: blocked ? '—' : (latest?.unreadCount ?? '—'),
            })}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!permitted || read.isPending}
          isLoading={updates.isFetching || (inbox.isRefetching && !inbox.isFetchingNextPage)}
          onClick={() => {
            if (permitted) {
              void metadata.refetch();
              if (inbox.isError || !inbox.data) void inbox.refetch();
              void updates.refetch();
            }
          }}
        >
          {t('episodes.refresh')}
        </Button>
      </header>
      {changed && !blocked && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"
        >
          <p>{t('episodes.newItems')}</p>
          <Button
            variant="outline"
            disabled={inbox.isFetching || updates.isFetching || read.isPending}
            onClick={async () => {
              const result = await inbox.refetch();
              if (!result.isError) await cache.resetQueries({ queryKey: [...prefix, 'updates'] });
            }}
          >
            {t('episodes.loadUpdates')}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          {t('episodes.site')}
          <select
            className="block w-full rounded-lg border border-slate-300 bg-white p-2.5"
            value={siteId}
            onChange={(e) => filter('siteId', e.target.value)}
          >
            <option value="">{t('episodes.allSites')}</option>
            {sites.map((id) => (
              <option key={id} value={id}>
                {names.get(id) ?? t('episodes.siteNamePending')}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t('episodes.filter')}
          <select
            className="block w-full rounded-lg border border-slate-300 bg-white p-2.5"
            value={readStatus}
            onChange={(e) => filter('readStatus', e.target.value)}
          >
            <option value="ALL">{t('episodes.all')}</option>
            <option value="UNREAD">{t('episodes.unread')}</option>
          </select>
        </label>
      </div>
      {(metadata.hasNextPage || metadata.isFetchNextPageError) && (
        <Button
          variant="ghost"
          onClick={() => void metadata.fetchNextPage()}
          disabled={metadata.isFetchingNextPage}
        >
          {t('episodes.moreSites')}
        </Button>
      )}
      {failed && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          {t(
            !permitted
              ? 'episodes.deniedSite'
              : blocked
                ? 'episodes.unavailable'
                : updates.isError
                  ? 'episodes.updateCheckFailed'
                  : 'episodes.nextFailed',
          )}{' '}
          {!permitted ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (metadata.isFetchNextPageError && !hardDenial(metadata.error))
                  void metadata.fetchNextPage();
                else if (metadata.isError) void metadata.refetch();
                if (inbox.isFetchNextPageError && !hardDenial(inbox.error))
                  void inbox.fetchNextPage();
                else if (inbox.isError) void inbox.refetch();
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
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <div className="space-y-2" aria-label={t('episodes.list')}>
            {rows.map((row) => (
              <button
                type="button"
                key={row.id}
                aria-pressed={row.id === selectedId}
                className={`w-full rounded-xl border p-4 text-left focus-visible:outline-2 ${row.id === selectedId ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                onClick={() => {
                  setSelectedId(row.id);
                  read.reset();
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong>
                    {t('episodes.subject', {
                      number: row.episode.subject.personObservationIndex + 1,
                    })}
                  </strong>
                  <span className="text-xs">
                    {t(row.unread ? 'episodes.unread' : 'episodes.read')}
                  </span>
                </span>
                <span className="mt-1 block truncate text-sm text-slate-700">
                  {names.get(row.episode.siteId) ?? t('episodes.siteNamePending')}
                </span>
                <span className="mt-2 block text-sm">
                  {t('episodes.findings', { count: row.episode.findingCount })}
                </span>
                <time
                  className="mt-1 block text-xs text-slate-500"
                  dateTime={row.episode.firstObservedAt}
                >
                  {date(row.episode.firstObservedAt)}
                </time>
              </button>
            ))}
            {(inbox.hasNextPage || inbox.isFetchNextPageError) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => void inbox.fetchNextPage()}
                disabled={inbox.isFetchingNextPage || hardDenial(inbox.error)}
              >
                {t(inbox.isFetchingNextPage ? 'episodes.loading' : 'episodes.more')}
              </Button>
            )}
          </div>
          <Card className="min-w-0 space-y-5" aria-label={t('episodes.detail')}>
            {!selected && <p>{t('episodes.select')}</p>}
            {selected && detail.isPending && <p role="status">{t('episodes.loading')}</p>}
            {selected && detail.isError && (
              <div role="alert">
                {t('episodes.unavailable')}{' '}
                <Button variant="outline" onClick={() => void detail.refetch()}>
                  {t('episodes.retry')}
                </Button>
              </div>
            )}
            {visible && (
              <>
                <div>
                  <h2 className="text-xl font-semibold">
                    {t('episodes.subject', { number: visible.subject.personObservationIndex + 1 })}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t(
                      visible.identityDecision?.action === 'RESOLVE'
                        ? 'episodes.identityRecorded'
                        : 'episodes.identityUnknown',
                    )}
                  </p>
                </div>
                <ul className="divide-y divide-slate-200">
                  {visible.findings.map((finding) => (
                    <li
                      key={finding.alertId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <strong className="block text-sm">
                          {t('ppeNotifications.' + finding.candidateSubtype, {
                            defaultValue: localizedLabel(finding.candidateSubtype),
                          })}
                        </strong>
                        <span className="text-sm text-slate-600">
                          {localizedLabel(finding.status)}
                        </span>
                      </div>
                      <Link
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                        aria-label={`${t('episodes.findingAction')}: ${t('ppeNotifications.' + finding.candidateSubtype, { defaultValue: localizedLabel(finding.candidateSubtype) })}`}
                        to={`/incidents?${new URLSearchParams({ siteId: visible.siteId, alertId: finding.alertId })}`}
                      >
                        {t('episodes.findingAction')}
                      </Link>
                    </li>
                  ))}
                </ul>
                <EpisodeEvidence
                  key={visible.id}
                  apiUrl={apiUrl}
                  client={client}
                  token={session.accessToken}
                  scope={scope}
                  episode={visible}
                />
                <details className="text-sm text-slate-600">
                  <summary className="cursor-pointer">{t('episodes.technical')}</summary>
                  <dl className="mt-2 grid gap-2 break-all">
                    <dt>{t('episodes.camera')}</dt>
                    <dd>{visible.cameraId}</dd>
                    <dt>{t('episodes.revision')}</dt>
                    <dd>{visible.contentRevision}</dd>
                    <dt>{t('episodes.event')}</dt>
                    <dd>{visible.subject.eventId}</dd>
                  </dl>
                </details>
                {read.isError ? (
                  <div role="alert">
                    <p>{t('episodes.readUncertain')}</p>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const results = await Promise.all([inbox.refetch(), detail.refetch()]);
                        if (results.every((r) => !r.isError)) read.reset();
                      }}
                    >
                      {t('episodes.reconcile')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    disabled={read.isPending}
                    onClick={() =>
                      selected &&
                      read.mutate({ id: selected.id, revision: visible.contentRevision })
                    }
                  >
                    {t('episodes.markRead')}
                  </Button>
                )}
                {read.data && read.variables?.id === selected?.id && (
                  <p role="status" className="text-sm">
                    {t(read.data.unread ? 'episodes.newer' : 'episodes.readSaved')}
                  </p>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
