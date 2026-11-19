import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  TrackedEpisodeMediaSource,
  TrackedObservationIdentity,
  TrackedObservationIdentityCard,
} from '@smartsite/contracts/tracked-episode-frames';
import { useTranslation } from 'react-i18next';
import { uiLocale } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconLoader, IconRefresh, IconUser } from '../icons';
import { Badge, Button } from '../ui';
import {
  isObservationIdentityCardEnabled,
  sanitizeSafetyUuid,
} from './safetyUrlParams';
import { buildTechnicalEntries } from './tracked-observation-identity-catalog';

export type TrackedObservationIdentityClient = Pick<
  SmartSiteManagementClient,
  'getTrackedObservationIdentity'
> & {
  getTrackedObservationIdentityCard?: SmartSiteManagementClient['getTrackedObservationIdentityCard'];
};

export interface TrackedObservationIdentityPanelProps {
  client: TrackedObservationIdentityClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  siteId: string;
  episodeId: string;
  source: TrackedEpisodeMediaSource;
  expectedPayloadHash: string;
  enableIdentityCard?: boolean;
  onRefreshSource?: () => Promise<unknown> | void;
}

interface IdentityPanelSnapshot {
  client: TrackedObservationIdentityClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  siteId: string;
  episodeId: string;
  alertId: string;
  eventId: string;
  personObservationIndex: number;
  evidenceIndex: number;
  expectedPayloadHash: string;
  useIdentityCard: boolean;
  generation: number;
}

const isForbiddenOrUnavailableError = (error: unknown) =>
  error instanceof ApiError &&
  error.status !== undefined &&
  [401, 403, 404].includes(error.status);

const isConflictError = (error: unknown) =>
  error instanceof ApiError && error.status === 409;

const formatTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(uiLocale()) : value;
};

function hasIdentityCardWorker(
  value: TrackedObservationIdentity | TrackedObservationIdentityCard,
): value is TrackedObservationIdentityCard {
  return 'worker' in value;
}

export function TrackedObservationIdentityPanel(props: TrackedObservationIdentityPanelProps) {
  const instanceId = useId();
  const useIdentityCard =
    isObservationIdentityCardEnabled(props.enableIdentityCard) &&
    typeof props.client.getTrackedObservationIdentityCard === 'function';

  const [snapshot, setSnapshot] = useState<IdentityPanelSnapshot>(() => ({
    client: props.client,
    token: props.token,
    scopeKey: props.scopeKey,
    apiUrl: props.apiUrl,
    siteId: props.siteId,
    episodeId: props.episodeId,
    alertId: props.source.alertId,
    eventId: props.source.eventId,
    personObservationIndex: props.source.personObservationIndex,
    evidenceIndex: props.source.evidenceIndex,
    expectedPayloadHash: props.expectedPayloadHash,
    useIdentityCard,
    generation: 1,
  }));

  if (
    snapshot.client !== props.client ||
    snapshot.token !== props.token ||
    snapshot.scopeKey !== props.scopeKey ||
    snapshot.apiUrl !== props.apiUrl ||
    snapshot.siteId !== props.siteId ||
    snapshot.episodeId !== props.episodeId ||
    snapshot.alertId !== props.source.alertId ||
    snapshot.eventId !== props.source.eventId ||
    snapshot.personObservationIndex !== props.source.personObservationIndex ||
    snapshot.evidenceIndex !== props.source.evidenceIndex ||
    snapshot.expectedPayloadHash !== props.expectedPayloadHash ||
    snapshot.useIdentityCard !== useIdentityCard
  ) {
    setSnapshot({
      client: props.client,
      token: props.token,
      scopeKey: props.scopeKey,
      apiUrl: props.apiUrl,
      siteId: props.siteId,
      episodeId: props.episodeId,
      alertId: props.source.alertId,
      eventId: props.source.eventId,
      personObservationIndex: props.source.personObservationIndex,
      evidenceIndex: props.source.evidenceIndex,
      expectedPayloadHash: props.expectedPayloadHash,
      useIdentityCard,
      generation: snapshot.generation + 1,
    });
    return null;
  }

  const panelKey = [
    instanceId,
    snapshot.generation,
    useIdentityCard ? 'card' : 'legacy',
    props.scopeKey,
    props.apiUrl,
    props.siteId,
    props.episodeId,
    props.source.alertId,
    props.source.eventId,
    props.source.personObservationIndex,
    props.source.evidenceIndex,
    props.expectedPayloadHash,
  ].join('::');

  return (
    <TrackedObservationIdentityPanelInner
      key={panelKey}
      instanceId={instanceId}
      generation={snapshot.generation}
      useIdentityCard={useIdentityCard}
      {...props}
    />
  );
}

function TrackedObservationIdentityPanelInner({
  instanceId,
  generation,
  useIdentityCard,
  client,
  token,
  scopeKey,
  apiUrl,
  siteId,
  episodeId,
  source,
  expectedPayloadHash,
  onRefreshSource,
}: TrackedObservationIdentityPanelProps & {
  instanceId: string;
  generation: number;
  useIdentityCard: boolean;
}) {
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();
  const isMountedRef = useRef(true);

  const [isRequested, setIsRequested] = useState(false);
  const [isRefreshingSource, setIsRefreshingSource] = useState(false);
  const [isTechnicalOpen, setIsTechnicalOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hasValidInput = Boolean(
    token.trim() &&
      scopeKey.trim() &&
      siteId.trim() &&
      episodeId.trim() &&
      source.alertId.trim() &&
      source.eventId.trim() &&
      Number.isInteger(source.personObservationIndex) &&
      source.personObservationIndex >= 0 &&
      Number.isInteger(source.evidenceIndex) &&
      source.evidenceIndex >= 0 &&
      expectedPayloadHash.trim(),
  );

  const transportMode = useIdentityCard ? 'card' : 'legacy';

  // Never include the raw token in any query key or DOM text.
  const queryKey = [
    'tracked-observation-identity',
    transportMode,
    instanceId,
    generation,
    scopeKey,
    apiUrl,
    siteId,
    episodeId,
    source.alertId,
    source.eventId,
    source.personObservationIndex,
    source.evidenceIndex,
    expectedPayloadHash,
  ] as const;

  useEffect(() => {
    const currentKey = [
      'tracked-observation-identity',
      transportMode,
      instanceId,
      generation,
      scopeKey,
      apiUrl,
      siteId,
      episodeId,
      source.alertId,
      source.eventId,
      source.personObservationIndex,
      source.evidenceIndex,
      expectedPayloadHash,
    ];
    return () => {
      void queryClient.cancelQueries({ queryKey: currentKey });
      queryClient.removeQueries({ queryKey: currentKey });
    };
  }, [
    queryClient,
    transportMode,
    instanceId,
    generation,
    scopeKey,
    apiUrl,
    siteId,
    episodeId,
    source.alertId,
    source.eventId,
    source.personObservationIndex,
    source.evidenceIndex,
    expectedPayloadHash,
  ]);

  const identityQuery = useQuery<TrackedObservationIdentity | TrackedObservationIdentityCard>({
    queryKey,
    enabled: hasValidInput && isRequested,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => {
      if (useIdentityCard && typeof client.getTrackedObservationIdentityCard === 'function') {
        return client.getTrackedObservationIdentityCard(
          token,
          siteId,
          episodeId,
          source,
          expectedPayloadHash,
          { signal },
        );
      }
      return client.getTrackedObservationIdentity(
        token,
        siteId,
        episodeId,
        source,
        expectedPayloadHash,
        { signal },
      );
    },
  });

  const handleCollapseClick = () => {
    setIsRequested(false);
    setIsTechnicalOpen(false);
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  };

  const handleRetryClick = () => {
    if (hasValidInput && isRequested && !identityQuery.isFetching) {
      void identityQuery.refetch();
    }
  };

  const handleRefreshConflictClick = async () => {
    if (!hasValidInput || !isRequested || identityQuery.isFetching || isRefreshingSource) {
      return;
    }
    setIsRefreshingSource(true);
    try {
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
      await onRefreshSource?.();
      if (isMountedRef.current) {
        await identityQuery.refetch();
      }
    } finally {
      if (isMountedRef.current) {
        setIsRefreshingSource(false);
      }
    }
  };

  const usableIdentity =
    isRequested &&
    hasValidInput &&
    identityQuery.isSuccess &&
    !identityQuery.isError &&
    !identityQuery.isFetching &&
    !isRefreshingSource
      ? identityQuery.data
      : null;

  const latestDecision = usableIdentity?.latestDecision ?? null;
  const cardPayload =
    useIdentityCard && usableIdentity && hasIdentityCardWorker(usableIdentity)
      ? usableIdentity
      : null;
  const scopedCardWorker =
    cardPayload &&
    latestDecision?.action === 'RESOLVE' &&
    cardPayload.worker !== null &&
    cardPayload.worker.siteId.toLowerCase() === siteId.toLowerCase() &&
    cardPayload.worker.id.toLowerCase() === (latestDecision.workerId ?? '').toLowerCase()
      ? cardPayload.worker
      : null;
  const isCardDirectoryUnavailable =
    cardPayload !== null && latestDecision?.action === 'RESOLVE' && cardPayload.worker === null;

  const technicalPanelId = `${instanceId}-identity-tech`;

  return (
    <section
      aria-label={tSafety('trackedIdentity.title')}
      data-testid="tracked-observation-identity-panel"
      className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-800"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-xs font-semibold text-slate-900">
            {tSafety('trackedIdentity.title')}
          </h3>
          <p data-testid="tracked-identity-disclaimer" className="text-xs text-slate-600">
            {tSafety('trackedIdentity.scopeDisclaimer')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isRequested ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="tracked-identity-read-button"
              onClick={() => setIsRequested(true)}
            >
              {tSafety('trackedIdentity.readAction')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              data-testid="tracked-identity-collapse-button"
              onClick={handleCollapseClick}
            >
              {tSafety('trackedIdentity.collapseAction')}
            </Button>
          )}
        </div>
      </div>

      {!isRequested ? (
        <p data-testid="tracked-identity-idle" className="text-xs text-slate-600">
          {tSafety('trackedIdentity.idlePrompt')}
        </p>
      ) : !hasValidInput ||
        (identityQuery.isError &&
          !identityQuery.isFetching &&
          !isRefreshingSource &&
          isForbiddenOrUnavailableError(identityQuery.error)) ? (
        <div
          role="alert"
          data-testid="tracked-identity-forbidden"
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/90 p-2.5 text-xs text-amber-950"
        >
          <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{tSafety('trackedIdentity.forbidden')}</span>
        </div>
      ) : identityQuery.isPending || identityQuery.isFetching || isRefreshingSource ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="tracked-identity-loading"
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700"
        >
          <IconLoader className="h-3.5 w-3.5 animate-spin text-slate-600" />
          <span>{tSafety('trackedIdentity.loading')}</span>
        </div>
      ) : identityQuery.isError && isConflictError(identityQuery.error) ? (
        <div
          role="alert"
          data-testid="tracked-identity-conflict"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/90 p-2.5 text-xs text-amber-950"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>{tSafety('trackedIdentity.conflict')}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="tracked-identity-refresh-source-button"
            onClick={() => void handleRefreshConflictClick()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {tSafety('trackedIdentity.refreshSourceAction')}
          </Button>
        </div>
      ) : identityQuery.isError ? (
        <div
          role="alert"
          data-testid="tracked-identity-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2.5 text-xs text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{tSafety('trackedIdentity.error')}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="tracked-identity-retry-button"
            onClick={handleRetryClick}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {tSafety('trackedIdentity.retry')}
          </Button>
        </div>
      ) : (
        usableIdentity && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
              {latestDecision === null ? (
                <div
                  role="status"
                  data-testid="tracked-identity-none"
                  className="text-xs font-medium text-slate-800"
                >
                  {tSafety('trackedIdentity.noDecision')}
                </div>
              ) : latestDecision.action === 'CLEAR' ? (
                <div
                  role="status"
                  data-testid="tracked-identity-cleared"
                  className="space-y-1 text-xs text-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">{tSafety('trackedIdentity.clearedBadge')}</Badge>
                    <span className="font-medium">
                      {tSafety('trackedIdentity.clearedSummary', {
                        revision: latestDecision.revision,
                        recordedAt: formatTimestamp(latestDecision.recordedAt),
                      })}
                    </span>
                  </div>
                  <p data-testid="tracked-identity-reason" className="break-words text-slate-600">
                    <span className="font-semibold">{tSafety('trackedIdentity.reasonLabel')}:</span>{' '}
                    {latestDecision.reason}
                  </p>
                </div>
              ) : (
                <div
                  data-testid="tracked-identity-resolved"
                  className="min-w-0 flex-1 space-y-2 text-xs text-slate-800"
                >
                  <div role="status" className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info">
                        <IconUser className="h-3 w-3" />
                        <span>{tSafety('trackedIdentity.resolvedBadge')}</span>
                      </Badge>
                      <span className="break-words font-semibold text-slate-900">
                        {!latestDecision.workerId ||
                        Boolean(sanitizeSafetyUuid(latestDecision.workerId))
                          ? tSafety('trackedIdentity.resolvedSummaryNoUuid', {
                              revision: latestDecision.revision,
                              recordedAt: formatTimestamp(latestDecision.recordedAt),
                            })
                          : tSafety('trackedIdentity.resolvedSummary', {
                              workerId: latestDecision.workerId,
                              revision: latestDecision.revision,
                              recordedAt: formatTimestamp(latestDecision.recordedAt),
                            })}
                      </span>
                    </div>

                    {scopedCardWorker && (
                      <div
                        data-testid="tracked-identity-worker-card"
                        className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/90 p-2.5"
                      >
                        <div className="text-[11px] font-medium text-slate-600">
                          {tSafety('trackedIdentity.workerCardLabel')}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            data-testid="tracked-identity-worker-name"
                            className="text-sm font-bold text-slate-950"
                          >
                            {scopedCardWorker.displayName}
                          </span>
                          <span
                            data-testid="tracked-identity-worker-external-id"
                            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-800"
                          >
                            {tSafety('trackedIdentity.workerCodeLabel')}: {scopedCardWorker.externalId}
                          </span>
                          {scopedCardWorker.isActive ? (
                            <span
                              data-testid="tracked-identity-worker-active"
                              className="inline-flex items-center rounded border border-teal-700/30 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-950"
                            >
                              {tSafety('trackedIdentity.workerActiveBadge')}
                            </span>
                          ) : null}
                        </div>
                        {!scopedCardWorker.isActive && (
                          <div
                            data-testid="tracked-identity-worker-inactive"
                            className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950"
                          >
                            <span className="font-semibold">
                              {tSafety('trackedIdentity.workerInactiveBadge')}:
                            </span>{' '}
                            {tSafety('trackedIdentity.workerInactiveNote')}
                          </div>
                        )}
                      </div>
                    )}

                    {isCardDirectoryUnavailable && (
                      <div
                        data-testid="tracked-identity-directory-unavailable"
                        className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-xs text-amber-950"
                      >
                        {tSafety('trackedIdentity.directoryUnavailable')}
                      </div>
                    )}

                    <p data-testid="tracked-identity-reason" className="break-words text-slate-600">
                      <span className="font-semibold">
                        {tSafety('trackedIdentity.reasonLabel')}:
                      </span>{' '}
                      {latestDecision.reason}
                    </p>
                  </div>
                  <details className="text-[11px] text-slate-600">
                    <summary className="cursor-pointer font-semibold select-none">
                      {tSafety('trackedIdentity.workerRefDisclosure')}
                    </summary>
                    <span
                      data-testid="tracked-identity-worker"
                      className="mt-1 block break-all font-mono text-slate-800"
                    >
                      {tSafety('trackedIdentity.resolvedSummary', {
                        workerId: latestDecision.workerId ?? '',
                        revision: latestDecision.revision,
                        recordedAt: formatTimestamp(latestDecision.recordedAt),
                      })}
                    </span>
                  </details>
                </div>
              )}

              <Button
                size="sm"
                variant="ghost"
                data-testid="tracked-identity-tech-toggle"
                aria-expanded={isTechnicalOpen}
                aria-controls={technicalPanelId}
                onClick={() => setIsTechnicalOpen((prev) => !prev)}
              >
                {tSafety(
                  isTechnicalOpen
                    ? 'trackedIdentity.hideTechnical'
                    : 'trackedIdentity.showTechnical',
                )}
              </Button>
            </div>

            {isTechnicalOpen && (
              <dl
                id={technicalPanelId}
                data-testid="tracked-identity-technical"
                className="grid gap-2 rounded-lg border border-slate-200/80 bg-white p-2.5 text-xs text-slate-700 sm:grid-cols-2"
              >
                {buildTechnicalEntries(usableIdentity, tSafety).map((entry) => (
                  <div key={entry.label} className="min-w-0">
                    <dt className="font-semibold text-slate-600">{entry.label}</dt>
                    <dd className="mt-0.5 break-all font-mono tabular-nums text-slate-900">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )
      )}
    </section>
  );
}
