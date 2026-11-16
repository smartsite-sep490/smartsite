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
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="episode-inbox-heading" className="text-2xl font-semibold text-slate-950">
            {t('episodes.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"
        >
          <p>{t('episodes.newItems')}</p>
          <Button variant="outline" disabled={loadUpdatesDisabled} onClick={onLoadUpdates}>
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
        <label className="space-y-1 text-sm font-medium">
          {t('episodes.filter')}
          <select
            className="block w-full rounded-lg border border-slate-300 bg-white p-2.5"
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
    </>
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
            className={`w-full rounded-xl border p-4 text-left focus-visible:outline-2 ${
              row.id === selectedId
                ? 'border-orange-500 bg-orange-50'
                : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
            onClick={() => onSelectRow(row.id)}
          >
            <span className="flex items-center justify-between gap-2">
              <strong>
                {row.episode.subject.kind === 'EVENT_LOCAL'
                  ? t('episodes.subject', {
                      number: row.episode.subject.personObservationIndex + 1,
                    })
                  : t('episodes.trackedSubject')}
              </strong>
              <span className="text-xs">{t(row.unread ? 'episodes.unread' : 'episodes.read')}</span>
            </span>
            <span className="mt-1 block truncate text-sm text-slate-700">
              {siteNames.get(row.episode.siteId.toLowerCase()) ?? t('episodes.siteNamePending')}
              {cameraLabel ? ` · ${cameraLabel}` : ''}
            </span>
            <span className="mt-2 block text-sm">
              {t('episodes.findings', { count: row.episode.findingCount })}
            </span>
            <time
              className="mt-1 block text-xs text-slate-500"
              dateTime={row.episode.firstObservedAt}
            >
              {formatObservedDate(row.episode.firstObservedAt)}
            </time>
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
