import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

interface StoredInboxOpener {
  recipientId: string;
  element: HTMLElement | null;
}

type PendingFocusTransition = 'DETAIL_HEADING' | 'INBOX_OPENER';

function findInboxOpenerButton(
  container: HTMLElement | null,
  recipientId: string,
): HTMLElement | null {
  if (!container || !recipientId) {
    return null;
  }
  const targetTestId = `safety-inbox-open-${recipientId}`;
  for (const button of container.querySelectorAll<HTMLElement>('button[data-testid]')) {
    if (button.getAttribute('data-testid') === targetTestId) {
      return button;
    }
  }
  return null;
}

function isFocusableInVisibleInbox(
  element: HTMLElement | null,
  inboxPane: HTMLElement,
): element is HTMLElement {
  if (!element || !element.isConnected || !inboxPane.contains(element)) {
    return false;
  }
  if (element.closest('[hidden]') || element.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  return !(element instanceof HTMLButtonElement && element.disabled);
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

  const inboxPaneRef = useRef<HTMLDivElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const storedOpenerRef = useRef<StoredInboxOpener | null>(null);
  const pendingFocusTransitionRef = useRef<PendingFocusTransition | null>(null);

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
    storedOpenerRef.current = null;
    pendingFocusTransitionRef.current = null;
    setIsInboxHardDenied(true);
    setSelectedTracked(null);
    setShowSelectionTechnical(false);
  }, []);

  useEffect(() => {
    const transition = pendingFocusTransitionRef.current;
    if (!transition) {
      return;
    }

    if (transition === 'DETAIL_HEADING') {
      if (!activeTracked) {
        return;
      }
      pendingFocusTransitionRef.current = null;
      const heading = detailHeadingRef.current;
      if (heading && heading.isConnected && !heading.closest('[hidden]')) {
        heading.focus();
      }
      return;
    }

    if (transition === 'INBOX_OPENER' && activeTracked === null) {
      pendingFocusTransitionRef.current = null;
      const opener = storedOpenerRef.current;
      storedOpenerRef.current = null;

      if (!hasValidScope || isInboxHardDenied) {
        return;
      }

      const inboxPane = inboxPaneRef.current;
      if (
        !inboxPane ||
        !inboxPane.isConnected ||
        inboxPane.hidden ||
        inboxPane.closest('[hidden]')
      ) {
        return;
      }

      const openerCandidate = opener
        ? isFocusableInVisibleInbox(opener.element, inboxPane)
          ? opener.element
          : findInboxOpenerButton(inboxPane, opener.recipientId)
        : null;

      if (isFocusableInVisibleInbox(openerCandidate, inboxPane)) {
        openerCandidate.focus();
        return;
      }

      inboxPane.focus();
    }
  }, [activeTracked, hasValidScope, isInboxHardDenied]);

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

      const inboxPane = inboxPaneRef.current;
      const openerElement = findInboxOpenerButton(inboxPane, recipientId);

      storedOpenerRef.current = {
        recipientId,
        element: openerElement,
      };
      pendingFocusTransitionRef.current = 'DETAIL_HEADING';

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
    if (!hasValidScope || isInboxHardDenied) {
      storedOpenerRef.current = null;
      pendingFocusTransitionRef.current = null;
      return;
    }
    pendingFocusTransitionRef.current = 'INBOX_OPENER';
    setSelectedTracked(null);
    setShowSelectionTechnical(false);
  };

  return (
    <section className="space-y-4" data-testid="safety-episode-triage-workspace">
      <div
        ref={inboxPaneRef}
        tabIndex={-1}
        hidden={activeTracked !== null}
        aria-hidden={activeTracked !== null ? 'true' : undefined}
        data-testid="safety-episode-triage-inbox-pane"
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2"
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
                  ref={detailHeadingRef}
                  tabIndex={-1}
                  className="rounded-xs text-sm font-bold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-[#071A2B]/20 focus-visible:ring-offset-1"
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
