import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle } from '../icons';
import { Button, Card } from '../ui';
import './safety-episode-inbox-catalog';
import { SafetyEpisodeInboxList } from './SafetyEpisodeInboxList';
import {
  buildSortedSiteIdsKey,
  normalizeAuthorizedSites,
  type InboxScopeSnapshot,
  type NormalizedSiteOption,
  type SafetyEpisodeInboxClient,
  type SafetyEpisodeInboxSiteOption,
  type SafetyEpisodeInboxWorkspaceProps,
} from './safety-episode-inbox-state';

export type {
  SafetyEpisodeInboxClient,
  SafetyEpisodeInboxSiteOption,
  SafetyEpisodeInboxWorkspaceProps,
};

export function SafetyEpisodeInboxWorkspace(props: SafetyEpisodeInboxWorkspaceProps) {
  const instanceId = useId();
  const normalizedSites = normalizeAuthorizedSites(props.sites);
  const sortedSiteIdsKey = buildSortedSiteIdsKey(normalizedSites);

  const [snapshot, setSnapshot] = useState<InboxScopeSnapshot>(() => ({
    client: props.client,
    token: props.token,
    scopeKey: props.scopeKey,
    apiUrl: props.apiUrl,
    sortedSiteIdsKey,
    generation: 1,
  }));

  if (
    snapshot.client !== props.client ||
    snapshot.token !== props.token ||
    snapshot.scopeKey !== props.scopeKey ||
    snapshot.apiUrl !== props.apiUrl ||
    snapshot.sortedSiteIdsKey !== sortedSiteIdsKey
  ) {
    setSnapshot({
      client: props.client,
      token: props.token,
      scopeKey: props.scopeKey,
      apiUrl: props.apiUrl,
      sortedSiteIdsKey,
      generation: snapshot.generation + 1,
    });
    return null;
  }

  const workspaceKey = [
    instanceId,
    snapshot.generation,
    props.scopeKey,
    props.apiUrl,
    sortedSiteIdsKey,
  ].join('::');

  return (
    <SafetyEpisodeInboxWorkspaceInner
      key={workspaceKey}
      instanceId={instanceId}
      generation={snapshot.generation}
      workspaceKey={workspaceKey}
      sortedSiteIdsKey={sortedSiteIdsKey}
      allowedSites={normalizedSites}
      {...props}
    />
  );
}

function SafetyEpisodeInboxWorkspaceInner({
  instanceId,
  generation,
  workspaceKey,
  sortedSiteIdsKey,
  allowedSites,
  client,
  token,
  scopeKey,
  apiUrl,
  onOpenEpisode,
  onHardDenied,
}: SafetyEpisodeInboxWorkspaceProps & {
  instanceId: string;
  generation: number;
  workspaceKey: string;
  sortedSiteIdsKey: string;
  allowedSites: readonly NormalizedSiteOption[];
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState<'ALL' | 'UNREAD'>('ALL');

  const hasValidScope = Boolean(
    token.trim() && scopeKey.trim() && apiUrl.trim() && allowedSites.length > 0,
  );

  const effectiveSiteKey =
    selectedSiteKey !== null && allowedSites.some((site) => site.key === selectedSiteKey)
      ? selectedSiteKey
      : null;

  const filterScopeKey = `${workspaceKey}::${effectiveSiteKey ?? 'ALL_SITES'}::${readStatus}`;

  return (
    <section
      aria-label={t('safetyInbox.title')}
      data-testid="safety-episode-inbox-workspace"
      className="space-y-4"
    >
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900">{t('safetyInbox.title')}</h2>
          <p className="text-xs leading-relaxed text-slate-600">{t('safetyInbox.subtitle')}</p>
        </div>

        {!hasValidScope ? (
          <div
            role="alert"
            data-testid="safety-inbox-unavailable"
            className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950"
          >
            <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>{t('safetyInbox.unavailable')}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div
              role="group"
              aria-label={t('safetyInbox.siteFilterLabel')}
              data-testid="safety-inbox-site-filters"
              className="flex flex-wrap items-center gap-2"
            >
              <Button
                size="sm"
                variant={effectiveSiteKey === null ? 'default' : 'outline'}
                aria-pressed={effectiveSiteKey === null}
                data-testid="safety-inbox-site-filter-all"
                onClick={() => setSelectedSiteKey(null)}
              >
                {t('safetyInbox.allSites', { count: allowedSites.length })}
              </Button>
              {allowedSites.map((site) => {
                const isSelected = effectiveSiteKey === site.key;
                return (
                  <Button
                    key={site.key}
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected}
                    data-testid={`safety-inbox-site-filter-${site.id}`}
                    onClick={() => setSelectedSiteKey(site.key)}
                  >
                    {site.name}
                  </Button>
                );
              })}
            </div>

            <div
              role="group"
              aria-label={t('safetyInbox.readFilterLabel')}
              data-testid="safety-inbox-read-filters"
              className="flex flex-wrap items-center gap-2"
            >
              <Button
                size="sm"
                variant={readStatus === 'ALL' ? 'default' : 'outline'}
                aria-pressed={readStatus === 'ALL'}
                data-testid="safety-inbox-read-filter-ALL"
                onClick={() => setReadStatus('ALL')}
              >
                {t('safetyInbox.filterAll')}
              </Button>
              <Button
                size="sm"
                variant={readStatus === 'UNREAD' ? 'default' : 'outline'}
                aria-pressed={readStatus === 'UNREAD'}
                data-testid="safety-inbox-read-filter-UNREAD"
                onClick={() => setReadStatus('UNREAD')}
              >
                {t('safetyInbox.filterUnread')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {hasValidScope && (
        <SafetyEpisodeInboxList
          key={filterScopeKey}
          instanceId={instanceId}
          generation={generation}
          scopeKey={scopeKey}
          apiUrl={apiUrl}
          sortedSiteIdsKey={sortedSiteIdsKey}
          allowedSites={allowedSites}
          effectiveSiteKey={effectiveSiteKey}
          readStatus={readStatus}
          client={client}
          token={token}
          onOpenEpisode={onOpenEpisode}
          onHardDenied={onHardDenied}
        />
      )}
    </section>
  );
}
