import { useCallback, useId, useState } from 'react';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { SafetyEpisodeInboxItem } from '@smartsite/contracts/safety-episodes';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconChevronLeft } from '../icons';
import { Badge, Button, Card } from '../ui';
import { SafetyEpisodeInboxWorkspace } from './SafetyEpisodeInboxWorkspace';
import { TrackedEpisodeEvidenceWorkspace } from './TrackedEpisodeEvidenceWorkspace';
import './safety-episode-triage-catalog';

export type SafetyEpisodeTriageClient = Pick<
  SmartSiteManagementClient,
  | 'listSafetyEpisodeInbox'
  | 'readSafetyEpisodeInbox'
  | 'getTrackedEpisode'
  | 'listTrackedEpisodeObservations'
  | 'readTrackedEpisodeMedia'
  | 'getTrackedObservationIdentity'
>;

export interface SafetyEpisodeTriageSiteOption {
  id: string;
  name: string;
}

export interface SafetyEpisodeTriageWorkspaceProps {
  client: SafetyEpisodeTriageClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sites: readonly SafetyEpisodeTriageSiteOption[];
  onOpenEventLocal: (item: SafetyEpisodeInboxItem) => void;
}

export interface SelectedTrackedEpisodeRef {
  recipientId: string;
  episodeId: string;
  siteId: string;
  siteKey: string;
  segmentId: string;
  scopeSha256: string;
}

interface NormalizedSiteOption {
  id: string;
  key: string;
  name: string;
}

interface TriageScopeSnapshot {
  client: SafetyEpisodeTriageClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sortedSiteIdsKey: string;
  generation: number;
}

function normalizeSites(sites: readonly SafetyEpisodeTriageSiteOption[]): NormalizedSiteOption[] {
  const seen = new Set<string>();
  const normalized: NormalizedSiteOption[] = [];

  for (const site of sites) {
    const id = site.id.trim();
    const key = id.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      id,
      key,
      name: site.name.trim() || id,
    });
  }

  return normalized;
}

function buildSortedSiteIdsKey(sites: readonly NormalizedSiteOption[]): string {
  return sites
    .map((site) => site.key)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(',');
}

export function SafetyEpisodeTriageWorkspace(props: SafetyEpisodeTriageWorkspaceProps) {
  const instanceId = useId();
  const normalizedSites = normalizeSites(props.sites);
  const sortedSiteIdsKey = buildSortedSiteIdsKey(normalizedSites);

  const [snapshot, setSnapshot] = useState<TriageScopeSnapshot>(() => ({
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
    <SafetyEpisodeTriageWorkspaceInner
      key={workspaceKey}
      generation={snapshot.generation}
      allowedSites={normalizedSites}
      {...props}
    />
  );
}

function SafetyEpisodeTriageWorkspaceInner({
  generation,
  allowedSites,
  client,
  token,
  scopeKey,
  apiUrl,
  sites,
  onOpenEventLocal,
}: SafetyEpisodeTriageWorkspaceProps & {
  generation: number;
  allowedSites: readonly NormalizedSiteOption[];
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

  const [selectedTracked, setSelectedTracked] = useState<SelectedTrackedEpisodeRef | null>(null);
  const [showSelectionTechnical, setShowSelectionTechnical] = useState(false);
  const [isInboxHardDenied, setIsInboxHardDenied] = useState(false);

  const hasValidScope = Boolean(
    token.trim() && scopeKey.trim() && apiUrl.trim() && allowedSites.length > 0,
  );

  const allowedSiteMap = new Map<string, NormalizedSiteOption>();
  for (const site of allowedSites) {
    allowedSiteMap.set(site.key, site);
  }

  const activeTracked =
    hasValidScope &&
    !isInboxHardDenied &&
    selectedTracked !== null &&
    allowedSiteMap.has(selectedTracked.siteKey)
      ? selectedTracked
      : null;

  const activeSite =
    activeTracked !== null ? (allowedSiteMap.get(activeTracked.siteKey) ?? null) : null;

  const handleInboxHardDenied = useCallback(() => {
    setIsInboxHardDenied(true);
    setSelectedTracked(null);
    setShowSelectionTechnical(false);
  }, []);

  const handleOpenEpisode = (item: SafetyEpisodeInboxItem) => {
    if (!hasValidScope || isInboxHardDenied) {
      return;
    }

    const recipientId = item.id.trim();
    const episodeId = item.episode.id.trim();
    const rawSiteId = item.episode.siteId.trim();
    if (!recipientId || !episodeId || !rawSiteId) {
      return;
    }

    const authorizedSite = allowedSiteMap.get(rawSiteId.toLowerCase());
    if (!authorizedSite) {
      return;
    }

    const subject = item.episode.subject;
    if (subject.kind === 'EVENT_LOCAL') {
      const eventId = subject.eventId.trim();
      if (
        !eventId ||
        !Number.isSafeInteger(subject.personObservationIndex) ||
        subject.personObservationIndex < 0
      ) {
        return;
      }
      onOpenEventLocal(item);
      return;
    }

    if (subject.kind === 'TRACKED') {
      const segmentId = subject.segmentId.trim();
      const scopeSha256 = subject.scopeSha256.trim();
      if (!segmentId || !scopeSha256) {
        return;
      }

      setShowSelectionTechnical(false);
      setSelectedTracked({
        recipientId,
        episodeId,
        siteId: authorizedSite.id,
        siteKey: authorizedSite.key,
        segmentId,
        scopeSha256,
      });
    }
  };

  const handleBackToInbox = () => {
    setSelectedTracked(null);
    setShowSelectionTechnical(false);
  };

  return (
    <section className="space-y-4" data-testid="safety-episode-triage-workspace">
      <div
        hidden={activeTracked !== null}
        aria-hidden={activeTracked !== null ? 'true' : undefined}
        data-testid="safety-episode-triage-inbox-pane"
      >
        <SafetyEpisodeInboxWorkspace
          client={client}
          token={token}
          scopeKey={scopeKey}
          apiUrl={apiUrl}
          sites={sites}
          onOpenEpisode={handleOpenEpisode}
          onHardDenied={handleInboxHardDenied}
        />
      </div>

      {activeTracked !== null && activeSite !== null && (
        <div className="space-y-4" data-testid="safety-episode-triage-detail-pane">
          <Card className="p-4" data-testid="safety-episode-triage-detail-header">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<IconChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={handleBackToInbox}
                  data-testid="safety-triage-back-button"
                >
                  {t('safetyTriage.backToInbox')}
                </Button>

                <Badge variant="info" data-testid="safety-triage-site-label">
                  {activeSite.name}
                </Badge>

                <h2
                  className="text-sm font-bold text-slate-900"
                  data-testid="safety-triage-detail-heading"
                >
                  {t('safetyTriage.trackedHeading')}
                </h2>
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowSelectionTechnical((prev) => !prev)}
                aria-expanded={showSelectionTechnical}
                data-testid="safety-triage-tech-toggle"
              >
                {showSelectionTechnical
                  ? t('safetyTriage.hideSelectionTechnical')
                  : t('safetyTriage.showSelectionTechnical')}
              </Button>
            </div>

            {showSelectionTechnical && (
              <dl
                className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 text-xs text-slate-700 sm:grid-cols-2"
                data-testid="safety-triage-selection-technical"
              >
                <div>
                  <dt className="font-semibold text-slate-600">{t('safetyTriage.recipientId')}</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-900">
                    {activeTracked.recipientId}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">{t('safetyTriage.episodeId')}</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-900">
                    {activeTracked.episodeId}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">{t('safetyTriage.siteId')}</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-900">
                    {activeTracked.siteId}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">{t('safetyTriage.segmentId')}</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-900">
                    {activeTracked.segmentId}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-slate-600">{t('safetyTriage.scopeSha256')}</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-900">
                    {activeTracked.scopeSha256}
                  </dd>
                </div>
              </dl>
            )}
          </Card>

          <TrackedEpisodeEvidenceWorkspace
            key={`${generation}:${activeTracked.siteKey}:${activeTracked.episodeId}`}
            client={client}
            token={token}
            sessionScope={scopeKey}
            apiUrl={apiUrl}
            siteId={activeTracked.siteId}
            episodeId={activeTracked.episodeId}
          />
        </div>
      )}
    </section>
  );
}
