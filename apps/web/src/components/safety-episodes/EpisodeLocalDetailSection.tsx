import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SafetyEpisode, SafetyEpisodeInboxPage } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import type { useManagementClient } from '../../features/auth/auth-session';
import { uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { Button } from '../ui';
import { EpisodeEvidence } from './EpisodeEvidence';
import { EpisodeRequestIdentificationLink } from './EpisodeRequestIdentificationLink';
import { EpisodeWorkflowLinks } from './EpisodeWorkflowLinks';

type EpisodeInboxRow = SafetyEpisodeInboxPage['items'][number];

const formatObservedDate = (value: string) => new Date(value).toLocaleString(uiLocale());

export interface EpisodeInboxFiltersProps {
  loadedCount: number;
  totalCount: number | string;
  unreadCount: number | string;
  refreshDisabled: boolean;
  refreshLoading: boolean;
  showUpdatesBanner: boolean;
  loadUpdatesDisabled: boolean;
  siteId: string;
  readStatus: 'ALL' | 'UNREAD';
  canonicalSites: readonly string[];
  siteNames: ReadonlyMap<string, string>;
  hasMoreSites: boolean;
  isFetchingNextSitesPage: boolean;
  onRefresh: () => void;
  onLoadUpdates: () => void;
  onFilterChange: (key: 'siteId' | 'readStatus', value: string) => void;
  onLoadMoreSites: () => void;
}

export function EpisodeInboxFilters({
  loadedCount,
  totalCount,
  unreadCount,
  refreshDisabled,
  refreshLoading,
  showUpdatesBanner,
  loadUpdatesDisabled,
  siteId,
  readStatus,
  canonicalSites,
  siteNames,
  hasMoreSites,
  isFetchingNextSitesPage,
  onRefresh,
  onLoadUpdates,
  onFilterChange,
  onLoadMoreSites,
}: EpisodeInboxFiltersProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            id="episode-inbox-heading"
            className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-950"
          >
            {t('episodes.title')}
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-600 tabular-nums">
            {t('episodes.count', {
              loaded: loadedCount,
              total: totalCount,
              unread: unreadCount,
            })}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={refreshDisabled}
          isLoading={refreshLoading}
          onClick={onRefresh}
        >
          {t('episodes.refresh')}
        </Button>
      </header>
      {showUpdatesBanner && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-700/35 bg-teal-50/70 px-4 py-3 text-sm text-teal-950"
        >
          <p className="font-medium">{t('episodes.newItems')}</p>
          <Button variant="outline" disabled={loadUpdatesDisabled} onClick={onLoadUpdates}>
            {t('episodes.loadUpdates')}
          </Button>
        </div>
      )}
      <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:max-w-2xl">
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 text-xs sm:text-sm font-semibold text-slate-800">
          <span className="shrink-0 text-slate-600">{t('episodes.site')}</span>
          <select
            className="block h-10 w-full min-w-0 truncate rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
            value={siteId}
            onChange={(e) => onFilterChange('siteId', e.target.value)}
          >
            <option value="">{t('episodes.allSites')}</option>
            {canonicalSites.map((id) => (
              <option key={id} value={id}>
                {siteNames.get(id.toLowerCase()) ?? t('episodes.siteNamePending')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 text-xs sm:text-sm font-semibold text-slate-800">
          <span className="shrink-0 text-slate-600">{t('episodes.filter')}</span>
          <select
            className="block h-10 w-full min-w-0 truncate rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
            value={readStatus}
            onChange={(e) => onFilterChange('readStatus', e.target.value)}
          >
            <option value="ALL">{t('episodes.all')}</option>
            <option value="UNREAD">{t('episodes.unread')}</option>
          </select>
        </label>
      </div>
      {hasMoreSites && (
        <Button variant="ghost" onClick={onLoadMoreSites} disabled={isFetchingNextSitesPage}>
          {t('episodes.moreSites')}
        </Button>
      )}
    </div>
  );
}

export interface EpisodeQueueListProps {
  rows: readonly EpisodeInboxRow[];
  selectedId?: string;
  siteNames: ReadonlyMap<string, string>;
  cameraNames: ReadonlyMap<string, string>;
  hasNextPage: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  nextPageForbidden: boolean;
  onSelectRow: (id: string) => void;
  onLoadMore: () => void;
}

export function EpisodeQueueList({
  rows,
  selectedId,
  siteNames,
  cameraNames,
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  nextPageForbidden,
  onSelectRow,
  onLoadMore,
}: EpisodeQueueListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2" aria-label={t('episodes.list')}>
      {rows.map((row) => {
        const cameraKey = `${row.episode.siteId.toLowerCase()}::${row.episode.cameraId.toLowerCase()}`;
        const cameraLabel = cameraNames.get(cameraKey);
        return (
          <button
            type="button"
            key={row.id}
            aria-pressed={row.id === selectedId}
            className={`w-full rounded-2xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 ${
              row.id === selectedId
                ? 'border-slate-900 bg-slate-900/[0.04] ring-1 ring-slate-900/15 shadow-2xs'
                : row.unread
                  ? 'border-slate-300 border-l-4 border-l-teal-700 bg-white shadow-2xs hover:bg-slate-50/70'
                  : 'border-slate-200 bg-white/95 hover:border-slate-300 hover:bg-white'
            }`}
            onClick={() => onSelectRow(row.id)}
          >
            <span className="flex items-center justify-between gap-2">
              <strong className="text-sm font-semibold text-slate-950">
                {row.episode.subject.kind === 'EVENT_LOCAL'
                  ? t('episodes.subject', {
                      number: row.episode.subject.personObservationIndex + 1,
                    })
                  : t('episodes.trackedSubject')}
              </strong>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                  row.unread
                    ? 'border-teal-700/35 bg-teal-50 text-teal-950'
                    : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}
              >
                {row.unread && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-700" />
                )}
                {t(row.unread ? 'episodes.unread' : 'episodes.read')}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs sm:text-sm font-medium text-slate-600">
              {siteNames.get(row.episode.siteId.toLowerCase()) ?? t('episodes.siteNamePending')}
              {cameraLabel ? ` · ${cameraLabel}` : ''}
            </span>
            <span className="mt-2 flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="rounded-md border border-amber-300/80 bg-amber-50/80 px-2 py-0.5 font-semibold text-amber-950">
                {t('episodes.findings', { count: row.episode.findingCount })}
              </span>
              <time className="text-slate-500" dateTime={row.episode.firstObservedAt}>
                {formatObservedDate(row.episode.firstObservedAt)}
              </time>
            </span>
          </button>
        );
      })}
      {(hasNextPage || isFetchNextPageError) && (
        <Button
          className="w-full"
          variant="outline"
          onClick={onLoadMore}
          disabled={isFetchingNextPage || nextPageForbidden}
        >
          {t(isFetchingNextPage ? 'episodes.loading' : 'episodes.more')}
        </Button>
      )}
    </div>
  );
}

export interface EpisodeLocalDetailSectionProps {
  apiUrl: string;
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  episode: SafetyEpisode & {
    subject: Extract<SafetyEpisode['subject'], { kind: 'EVENT_LOCAL' }>;
  };
  originRecipientId: string;
  renderRevisionAction: () => ReactNode;
}

export function EpisodeLocalDetailSection({
  apiUrl,
  client,
  token,
  scope,
  episode,
  originRecipientId,
  renderRevisionAction,
}: EpisodeLocalDetailSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">
          {t('episodes.subject', { number: episode.subject.personObservationIndex + 1 })}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t(
            episode.identityDecision?.action === 'RESOLVE'
              ? 'episodes.identityRecorded'
              : 'episodes.identityUnknown',
          )}
        </p>
      </div>
      <ul className="divide-y divide-slate-200">
        {episode.findings.map((finding) => {
          const label = t('ppeNotifications.' + finding.candidateSubtype, {
            defaultValue: localizedLabel(finding.candidateSubtype),
          });
          return (
            <li
              key={finding.alertId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <strong className="block text-sm">{label}</strong>
                <span className="text-sm text-slate-600">{localizedLabel(finding.status)}</span>
              </div>
              <Link
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                aria-label={`${t('episodes.findingAction')}: ${label}`}
                to={`/incidents?${new URLSearchParams({
                  siteId: episode.siteId,
                  alertId: finding.alertId,
                })}`}
              >
                {t('episodes.findingAction')}
              </Link>
            </li>
          );
        })}
      </ul>
      <EpisodeEvidence
        key={episode.id}
        apiUrl={apiUrl}
        client={client}
        token={token}
        scope={scope}
        episode={episode}
      />
      <EpisodeWorkflowLinks episode={episode} />
      <EpisodeRequestIdentificationLink
        siteId={episode.siteId}
        episodeId={episode.id}
        originRecipientId={originRecipientId}
        client={client}
        token={token}
        scope={scope}
      />
      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer">{t('episodes.technical')}</summary>
        <dl className="mt-2 grid gap-2 break-all">
          <dt>{t('episodes.camera')}</dt>
          <dd>{episode.cameraId}</dd>
          <dt>{t('episodes.revision')}</dt>
          <dd>{episode.contentRevision}</dd>
          <dt>{t('episodes.event')}</dt>
          <dd>{episode.subject.eventId}</dd>
        </dl>
      </details>
      {renderRevisionAction()}
    </>
  );
}
