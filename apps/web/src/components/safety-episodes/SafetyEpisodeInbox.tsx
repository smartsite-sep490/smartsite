import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { useManagementClient } from '../../features/auth/auth-session';
import { uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { Badge, Button, Card } from '../ui';
import { EpisodeEvidence } from './EpisodeEvidence';
import { EpisodeWorkflowLinks } from './EpisodeWorkflowLinks';

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
    <section aria-labelledby="episode-inbox-heading" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="space-y-1">
          <h1
            id="episode-inbox-heading"
            className="text-2xl font-semibold tracking-tight text-slate-950"
          >
            {t('episodes.title')}
          </h1>
          <p className="text-sm font-medium text-slate-600 tabular-nums">
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/90 px-4 py-3 text-sm text-slate-900 shadow-xs"
        >
          <p className="font-medium text-blue-950">{t('episodes.newItems')}</p>
          <Button
            size="sm"
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
      <Card className="space-y-3 bg-slate-50/70 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-800">
            <span>{t('episodes.site')}</span>
            <select
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus-visible:outline-2 focus-visible:outline-orange-600"
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
          <label className="space-y-1.5 text-sm font-medium text-slate-800">
            <span>{t('episodes.filter')}</span>
            <select
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus-visible:outline-2 focus-visible:outline-orange-600"
              value={readStatus}
              onChange={(e) => filter('readStatus', e.target.value)}
            >
              <option value="ALL">{t('episodes.all')}</option>
              <option value="UNREAD">{t('episodes.unread')}</option>
            </select>
          </label>
        </div>
        {(metadata.hasNextPage || metadata.isFetchNextPageError) && (
          <div className="flex justify-start border-t border-slate-200/80 pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void metadata.fetchNextPage()}
              disabled={metadata.isFetchingNextPage}
            >
              {t('episodes.moreSites')}
            </Button>
          </div>
        )}
      </Card>
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900"
        >
          <span>
            {t(
              !permitted
                ? 'episodes.deniedSite'
                : blocked
                  ? 'episodes.unavailable'
                  : updates.isError
                    ? 'episodes.updateCheckFailed'
                    : 'episodes.nextFailed',
            )}
          </span>
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
      {inbox.isPending && permitted && (
        <Card className="text-sm text-slate-600">
          <p role="status">{t('episodes.loading')}</p>
        </Card>
      )}
      {!blocked && inbox.isSuccess && rows.length === 0 && (
        <Card className="border-dashed bg-slate-50/60 text-center text-sm text-slate-600">
          <p role="status">{t(readStatus === 'UNREAD' ? 'episodes.noUnread' : 'episodes.empty')}</p>
        </Card>
      )}
      {rows.length > 0 && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <div className="space-y-3" aria-label={t('episodes.list')}>
            <div className="border-b border-slate-200/80 pb-2">
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {t('episodes.list')}
              </h2>
            </div>
            <div className="space-y-2.5">
              {rows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  aria-pressed={row.id === selectedId}
                  className={`w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-orange-600 ${
                    row.id === selectedId
                      ? 'border-orange-500 bg-orange-50/70 shadow-xs ring-1 ring-orange-500/30'
                      : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                  onClick={() => {
                    setSelectedId(row.id);
                    read.reset();
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <strong className="text-sm font-semibold text-slate-950">
                      {t('episodes.subject', {
                        number: row.episode.subject.personObservationIndex + 1,
                      })}
                    </strong>
                    <Badge variant={row.unread ? 'warning' : 'neutral'} dot={row.unread}>
                      {t(row.unread ? 'episodes.unread' : 'episodes.read')}
                    </Badge>
                  </span>
                  <span className="mt-1.5 block truncate text-sm font-medium text-slate-700">
                    {names.get(row.episode.siteId) ?? t('episodes.siteNamePending')}
                  </span>
                  <span className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700 tabular-nums">
                      {t('episodes.findings', { count: row.episode.findingCount })}
                    </span>
                    <time
                      className="text-slate-500 tabular-nums"
                      dateTime={row.episode.firstObservedAt}
                    >
                      {date(row.episode.firstObservedAt)}
                    </time>
                  </span>
                </button>
              ))}
            </div>
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
          <Card className="min-w-0 space-y-6" aria-label={t('episodes.detail')}>
            <div className="border-b border-slate-200/80 pb-3">
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {t('episodes.detail')}
              </h2>
            </div>
            {!selected && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-700">{t('episodes.select')}</p>
              </div>
            )}
            {selected && detail.isPending && (
              <p role="status" className="py-6 text-sm text-slate-600">
                {t('episodes.loading')}
              </p>
            )}
            {selected && detail.isError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900"
              >
                <span>{t('episodes.unavailable')}</span>
                <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
                  {t('episodes.retry')}
                </Button>
              </div>
            )}
            {visible && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight text-slate-950">
                      {t('episodes.subject', {
                        number: visible.subject.personObservationIndex + 1,
                      })}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {t(
                        visible.identityDecision?.action === 'RESOLVE'
                          ? 'episodes.identityRecorded'
                          : 'episodes.identityUnknown',
                      )}
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-slate-200/80 rounded-xl border border-slate-200/90 bg-slate-50/40">
                  {visible.findings.map((finding) => (
                    <li
                      key={finding.alertId}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="space-y-0.5">
                        <strong className="block text-sm font-semibold text-slate-900">
                          {t('ppeNotifications.' + finding.candidateSubtype, {
                            defaultValue: localizedLabel(finding.candidateSubtype),
                          })}
                        </strong>
                        <span className="inline-block text-xs font-medium text-slate-600">
                          {localizedLabel(finding.status)}
                        </span>
                      </div>
                      <Link
                        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-2xs transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-600"
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
                <EpisodeWorkflowLinks episode={visible} />
                <div className="space-y-3 border-t border-slate-200/80 pt-4">
                  {read.isError ? (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-slate-900"
                    >
                      <p>{t('episodes.readUncertain')}</p>
                      <Button
                        size="sm"
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
                    <p role="status" className="text-sm font-medium text-slate-700">
                      {t(read.data.unread ? 'episodes.newer' : 'episodes.readSaved')}
                    </p>
                  )}
                </div>
                <details className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium text-slate-700 select-none">
                    {t('episodes.technical')}
                  </summary>
                  <dl className="mt-3 grid gap-2 border-t border-slate-200/70 pt-3 break-all sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-1.5">
                    <dt className="font-medium text-slate-500">{t('episodes.camera')}</dt>
                    <dd className="font-mono text-slate-700">{visible.cameraId}</dd>
                    <dt className="font-medium text-slate-500">{t('episodes.revision')}</dt>
                    <dd className="font-mono text-slate-700 tabular-nums">
                      {visible.contentRevision}
                    </dd>
                    <dt className="font-medium text-slate-500">{t('episodes.event')}</dt>
                    <dd className="font-mono text-slate-700">{visible.subject.eventId}</dd>
                  </dl>
                </details>
              </>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
