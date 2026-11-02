import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  TrackedEpisodeDetail,
  TrackedEpisodeMediaRepresentation,
  TrackedEpisodeMediaSource,
  TrackedEpisodeObservationOptions,
  TrackedEpisodeOriginalObservation,
} from '@smartsite/contracts/tracked-episode-frames';
import { useTranslation } from 'react-i18next';
import { uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconClock, IconLoader, IconRefresh } from '../icons';
import { Badge, Button, Card } from '../ui';
import { TrackedEvidenceViewer, type TrackedEvidenceViewerStatus } from './TrackedEvidenceViewer';
import {
  TrackedObservationHistory,
  type TrackedObservationHistoryStatus,
} from './TrackedObservationHistory';
import { TrackedObservationIdentityPanel } from './TrackedObservationIdentityPanel';
import './tracked-episode-workspace-catalog';

export type TrackedEpisodeEvidenceClient = Pick<
  SmartSiteManagementClient,
  | 'getTrackedEpisode'
  | 'listTrackedEpisodeObservations'
  | 'readTrackedEpisodeMedia'
  | 'getTrackedObservationIdentity'
>;

export interface TrackedEpisodeEvidenceWorkspaceProps {
  client: TrackedEpisodeEvidenceClient;
  token: string;
  sessionScope: string;
  apiUrl: string;
  siteId: string;
  episodeId: string;
}

interface CredentialGenerationSnapshot {
  client: TrackedEpisodeEvidenceClient;
  token: string;
  sessionScope: string;
  apiUrl: string;
  siteId: string;
  episodeId: string;
  generation: number;
}

interface HistoryPageParam {
  offset: number;
  throughSequence?: string;
}

interface SelectedMediaState {
  scopeKey: string;
  selectionKey: string;
  source: TrackedEpisodeMediaSource;
  representation: TrackedEpisodeMediaRepresentation;
}

const HISTORY_PAGE_LIMIT = 20;

const isForbiddenError = (error: unknown) =>
  error instanceof ApiError && error.status !== undefined && [401, 403, 404].includes(error.status);

const formatTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(uiLocale()) : value;
};

const buildMediaSelectionKey = (
  source: TrackedEpisodeMediaSource,
  representation: TrackedEpisodeMediaRepresentation,
) =>
  `${source.alertId}:${source.eventId}:${source.personObservationIndex}:${source.evidenceIndex}:${representation}`;

interface AuthorizedMediaDescriptor {
  expectedFrameSha256: string;
  expectedPayloadHash: string;
}

function resolveAuthorizedMediaDescriptor(
  detail: TrackedEpisodeDetail | null,
  items: readonly TrackedEpisodeOriginalObservation[],
  source: TrackedEpisodeMediaSource,
): AuthorizedMediaDescriptor | null {
  if (!detail || !detail.findings.some((finding) => finding.alertId === source.alertId)) {
    return null;
  }
  const observation = items.find(
    (item) =>
      item.alertId === source.alertId &&
      item.eventId === source.eventId &&
      item.personObservationIndex === source.personObservationIndex,
  );
  const frame = observation?.frames.find((entry) => entry.evidenceIndex === source.evidenceIndex);
  if (!observation || !frame) {
    return null;
  }
  return {
    expectedFrameSha256: frame.sha256,
    expectedPayloadHash: observation.payloadHash,
  };
}

export function TrackedEpisodeEvidenceWorkspace(props: TrackedEpisodeEvidenceWorkspaceProps) {
  const instanceId = useId();
  const [snapshot, setSnapshot] = useState<CredentialGenerationSnapshot>(() => ({
    client: props.client,
    token: props.token,
    sessionScope: props.sessionScope,
    apiUrl: props.apiUrl,
    siteId: props.siteId,
    episodeId: props.episodeId,
    generation: 1,
  }));

  if (
    snapshot.client !== props.client ||
    snapshot.token !== props.token ||
    snapshot.sessionScope !== props.sessionScope ||
    snapshot.apiUrl !== props.apiUrl ||
    snapshot.siteId !== props.siteId ||
    snapshot.episodeId !== props.episodeId
  ) {
    setSnapshot({
      client: props.client,
      token: props.token,
      sessionScope: props.sessionScope,
      apiUrl: props.apiUrl,
      siteId: props.siteId,
      episodeId: props.episodeId,
      generation: snapshot.generation + 1,
    });
    return null;
  }

  const workspaceKey = `${instanceId}::${snapshot.generation}::${props.sessionScope}::${props.apiUrl}::${props.siteId}::${props.episodeId}`;
  return (
    <TrackedEpisodeEvidenceWorkspaceInner
      key={workspaceKey}
      instanceId={instanceId}
      generation={snapshot.generation}
      workspaceKey={workspaceKey}
      {...props}
    />
  );
}

function TrackedEpisodeEvidenceWorkspaceInner({
  instanceId,
  generation,
  workspaceKey,
  client,
  token,
  sessionScope,
  apiUrl,
  siteId,
  episodeId,
}: TrackedEpisodeEvidenceWorkspaceProps & {
  instanceId: string;
  generation: number;
  workspaceKey: string;
}) {
  const { t: tCommon } = useTranslation();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();

  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<SelectedMediaState | null>(null);
  const [isEpisodeTechOpen, setIsEpisodeTechOpen] = useState(false);

  const hasValidScope = Boolean(
    token.trim() && sessionScope.trim() && siteId.trim() && episodeId.trim(),
  );

  // Never include the raw token in any query key or DOM text.
  const baseQueryKey = [
    'tracked-episode-evidence-workspace',
    instanceId,
    generation,
    sessionScope,
    apiUrl,
    siteId,
    episodeId,
  ] as const;

  useEffect(() => {
    const prefix = [
      'tracked-episode-evidence-workspace',
      instanceId,
      generation,
      sessionScope,
      apiUrl,
      siteId,
      episodeId,
    ];
    return () => {
      void queryClient.cancelQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: prefix });
    };
  }, [queryClient, instanceId, generation, sessionScope, apiUrl, siteId, episodeId]);

  const detailQuery = useQuery({
    queryKey: [...baseQueryKey, 'detail'],
    enabled: hasValidScope,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => client.getTrackedEpisode(token, siteId, episodeId, { signal }),
  });

  const usableDetail =
    hasValidScope && detailQuery.isSuccess && !detailQuery.isError && !detailQuery.isFetching
      ? detailQuery.data
      : null;

  const effectiveAlertId =
    selectedAlertId !== null &&
    usableDetail?.findings.some((finding) => finding.alertId === selectedAlertId)
      ? selectedAlertId
      : null;

  const historyScopeKey = `${workspaceKey}::${effectiveAlertId ?? 'ALL'}`;

  const historyQuery = useInfiniteQuery({
    queryKey: [...baseQueryKey, 'history', effectiveAlertId ?? 'ALL'],
    enabled: usableDetail !== null,
    initialPageParam: { offset: 0 } as HistoryPageParam,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ pageParam, signal }) => {
      const options: TrackedEpisodeObservationOptions = {
        offset: pageParam.offset,
        limit: HISTORY_PAGE_LIMIT,
        ...(pageParam.throughSequence !== undefined
          ? { throughSequence: pageParam.throughSequence }
          : {}),
        ...(effectiveAlertId !== null ? { alertId: effectiveAlertId } : {}),
      };
      return client.listTrackedEpisodeObservations(token, siteId, episodeId, options, { signal });
    },
    getNextPageParam: (lastPage, allPages): HistoryPageParam | undefined => {
      const firstPage = allPages[0];
      if (!firstPage || !lastPage.hasMore || lastPage.items.length === 0) {
        return undefined;
      }
      const rawReturnedCount = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return {
        offset: rawReturnedCount,
        throughSequence: firstPage.throughSequence,
      };
    },
  });

  const isTransientNextPageError =
    historyQuery.isFetchNextPageError && !isForbiddenError(historyQuery.error);
  const isHistoryBaseError = historyQuery.isError && !isTransientNextPageError;
  const isBaseRefetching = historyQuery.isFetching && !historyQuery.isFetchingNextPage;

  useEffect(() => {
    if (usableDetail === null || isHistoryBaseError) {
      const mediaPrefix = [
        'tracked-episode-evidence-workspace',
        instanceId,
        generation,
        sessionScope,
        apiUrl,
        siteId,
        episodeId,
        'media',
      ];
      void queryClient.cancelQueries({ queryKey: mediaPrefix });
      queryClient.removeQueries({ queryKey: mediaPrefix });
    }
  }, [
    queryClient,
    instanceId,
    generation,
    sessionScope,
    apiUrl,
    siteId,
    episodeId,
    usableDetail,
    isHistoryBaseError,
  ]);

  const loadedPages =
    usableDetail !== null && !isHistoryBaseError && !isBaseRefetching
      ? (historyQuery.data?.pages ?? [])
      : [];
  const lastPage = loadedPages.at(-1);

  const deduplicatedItems: TrackedEpisodeOriginalObservation[] = [];
  const seenObservationKeys = new Set<string>();
  for (const page of loadedPages) {
    for (const item of page.items) {
      const compositeKey = `${item.alertId}:${item.eventId}:${item.personObservationIndex}`;
      if (!seenObservationKeys.has(compositeKey)) {
        seenObservationKeys.add(compositeKey);
        deduplicatedItems.push(item);
      }
    }
  }

  const latestServerTotal = lastPage?.total ?? 0;
  const hasMoreObservations = Boolean(
    lastPage && lastPage.hasMore && lastPage.items.length > 0 && historyQuery.hasNextPage,
  );

  let historyStatus: TrackedObservationHistoryStatus = 'LOADING';
  if (!hasValidScope || (detailQuery.isError && isForbiddenError(detailQuery.error))) {
    historyStatus = 'FORBIDDEN';
  } else if (detailQuery.isError) {
    historyStatus = 'ERROR';
  } else if (detailQuery.isPending || historyQuery.isPending || isBaseRefetching) {
    historyStatus = 'LOADING';
  } else if (isHistoryBaseError) {
    historyStatus = isForbiddenError(historyQuery.error) ? 'FORBIDDEN' : 'ERROR';
  } else {
    historyStatus = 'READY';
  }

  const loadMoreErrorText = isTransientNextPageError
    ? historyQuery.error instanceof Error && historyQuery.error.message.trim()
      ? historyQuery.error.message
      : t('trackedWorkspace.nextPageFailed')
    : null;

  const activeMediaSelection =
    usableDetail !== null &&
    historyStatus === 'READY' &&
    selectedMedia !== null &&
    selectedMedia.scopeKey === historyScopeKey
      ? selectedMedia
      : null;

  const authorizedMediaDescriptor =
    activeMediaSelection !== null
      ? resolveAuthorizedMediaDescriptor(
          usableDetail,
          deduplicatedItems,
          activeMediaSelection.source,
        )
      : null;
  const expectedFrameSha256 = authorizedMediaDescriptor?.expectedFrameSha256 ?? null;
  const expectedPayloadHash = authorizedMediaDescriptor?.expectedPayloadHash ?? null;

  const mediaQuery = useQuery({
    queryKey: [
      ...baseQueryKey,
      'media',
      effectiveAlertId ?? 'ALL',
      activeMediaSelection?.selectionKey ?? 'NONE',
      expectedFrameSha256 ?? 'NO_SHA',
    ],
    enabled: activeMediaSelection !== null && expectedFrameSha256 !== null,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      if (!activeMediaSelection || !expectedFrameSha256) {
        throw new ApiError('invalid-response', 'No authorized media selection.');
      }
      const result = await client.readTrackedEpisodeMedia(
        token,
        siteId,
        episodeId,
        activeMediaSelection.source,
        activeMediaSelection.representation,
        expectedFrameSha256,
        { signal },
      );
      if (
        !result ||
        !(result.blob instanceof Blob) ||
        result.frameSha256 !== expectedFrameSha256 ||
        result.representation !== activeMediaSelection.representation ||
        (activeMediaSelection.representation === 'FRAME' && result.sha256 !== expectedFrameSha256)
      ) {
        throw new ApiError('invalid-response', 'Backend returned inconsistent tracked media.');
      }
      return {
        scopeKey: activeMediaSelection.scopeKey,
        selectionKey: activeMediaSelection.selectionKey,
        blob: result.blob,
      };
    },
  });

  let viewerStatus: TrackedEvidenceViewerStatus = 'LOADING';
  if (activeMediaSelection !== null) {
    if (expectedFrameSha256 === null) {
      viewerStatus = 'ERROR';
    } else if (mediaQuery.isPending || mediaQuery.isFetching) {
      viewerStatus = 'LOADING';
    } else if (mediaQuery.isError) {
      viewerStatus = isForbiddenError(mediaQuery.error) ? 'FORBIDDEN' : 'ERROR';
    } else {
      viewerStatus = 'READY';
    }
  }

  const verifiedViewerMedia =
    activeMediaSelection !== null &&
    expectedFrameSha256 !== null &&
    mediaQuery.isSuccess &&
    !mediaQuery.isError &&
    !mediaQuery.isFetching &&
    mediaQuery.data &&
    mediaQuery.data.scopeKey === activeMediaSelection.scopeKey &&
    mediaQuery.data.selectionKey === activeMediaSelection.selectionKey
      ? mediaQuery.data
      : null;

  const cancelAndClearMediaQueries = () => {
    const mediaPrefix = [...baseQueryKey, 'media'];
    void queryClient.cancelQueries({ queryKey: mediaPrefix });
    queryClient.removeQueries({ queryKey: mediaPrefix });
  };

  const handleSelectFinding = (nextAlertId: string | null) => {
    if (nextAlertId === effectiveAlertId) {
      return;
    }
    setSelectedAlertId(nextAlertId);
    setSelectedMedia(null);
    cancelAndClearMediaQueries();
  };

  const handleOpenSource = (
    source: TrackedEpisodeMediaSource,
    representation: TrackedEpisodeMediaRepresentation,
  ) => {
    if (!usableDetail || historyStatus !== 'READY') {
      return;
    }
    const selectionKey = buildMediaSelectionKey(source, representation);
    cancelAndClearMediaQueries();
    setSelectedMedia({ scopeKey: historyScopeKey, selectionKey, source, representation });
  };

  const handleCloseViewer = () => {
    setSelectedMedia(null);
    cancelAndClearMediaQueries();
  };

  const handleRetryViewer = () => {
    if (activeMediaSelection && expectedFrameSha256 && !mediaQuery.isFetching) {
      void mediaQuery.refetch();
    }
  };

  const handleLoadMore = () => {
    if (
      usableDetail !== null &&
      historyStatus === 'READY' &&
      !historyQuery.isFetching &&
      !historyQuery.isFetchingNextPage &&
      hasMoreObservations
    ) {
      void historyQuery.fetchNextPage();
    }
  };

  const handleHistoryRetry = () => {
    if (detailQuery.isError) {
      if (!detailQuery.isFetching) {
        void detailQuery.refetch();
      }
      return;
    }
    if (historyQuery.isFetching || historyQuery.isFetchingNextPage) {
      return;
    }
    if (isTransientNextPageError) {
      void historyQuery.fetchNextPage();
    } else {
      void historyQuery.refetch();
    }
  };

  const viewerIdentityContent =
    verifiedViewerMedia !== null &&
    activeMediaSelection !== null &&
    expectedFrameSha256 !== null &&
    expectedPayloadHash !== null ? (
      <TrackedObservationIdentityPanel
        key={`${historyScopeKey}::${activeMediaSelection.selectionKey}::${expectedPayloadHash}`}
        client={client}
        token={token}
        scopeKey={historyScopeKey}
        apiUrl={apiUrl}
        siteId={siteId}
        episodeId={episodeId}
        source={activeMediaSelection.source}
        expectedPayloadHash={expectedPayloadHash}
      />
    ) : undefined;

  const episodeTechPanelId = `${instanceId}-episode-tech`;

  return (
    <section
      aria-label={t('trackedWorkspace.title')}
      data-testid="tracked-episode-workspace"
      className="space-y-4"
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">{t('trackedWorkspace.title')}</h2>
            <p className="text-xs leading-relaxed text-slate-600">
              {t('trackedWorkspace.subtitle')}
            </p>
          </div>
          {usableDetail && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={usableDetail.collectionState === 'SEALED' ? 'neutral' : 'info'}
                data-testid="tracked-workspace-state-badge"
              >
                {t(
                  usableDetail.collectionState === 'SEALED'
                    ? 'trackedWorkspace.stateSealed'
                    : 'trackedWorkspace.stateCollecting',
                )}
              </Badge>
              <Badge variant="default" data-testid="tracked-workspace-revision-badge">
                <span className="tabular-nums">
                  {t('trackedWorkspace.revisionBadge', { revision: usableDetail.contentRevision })}
                </span>
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={isEpisodeTechOpen}
                aria-controls={episodeTechPanelId}
                onClick={() => setIsEpisodeTechOpen((prev) => !prev)}
              >
                {t(
                  isEpisodeTechOpen
                    ? 'trackedWorkspace.hideEpisodeTechnical'
                    : 'trackedWorkspace.showEpisodeTechnical',
                )}
              </Button>
            </div>
          )}
        </div>

        {!hasValidScope ||
        (detailQuery.isError && !detailQuery.isFetching && isForbiddenError(detailQuery.error)) ? (
          <div
            role="alert"
            data-testid="tracked-workspace-detail-forbidden"
            className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950"
          >
            <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>{t('trackedWorkspace.forbiddenDetail')}</span>
          </div>
        ) : detailQuery.isPending || detailQuery.isFetching ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="tracked-workspace-detail-loading"
            className="flex items-center gap-2.5 text-sm text-slate-700"
          >
            <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
            <span>{t('trackedWorkspace.loadingDetail')}</span>
          </div>
        ) : detailQuery.isError ? (
          <div
            role="alert"
            data-testid="tracked-workspace-detail-error"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-900"
          >
            <div className="flex items-center gap-2">
              <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
              <span>{t('trackedWorkspace.errorDetail')}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={detailQuery.isFetching}
              onClick={() => void detailQuery.refetch()}
              leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
            >
              {t('trackedWorkspace.retryDetail')}
            </Button>
          </div>
        ) : (
          usableDetail && (
            <>
              <div
                data-testid="tracked-workspace-capture-range"
                className="flex flex-wrap items-center gap-2 text-xs text-slate-700"
              >
                <IconClock className="h-3.5 w-3.5 text-slate-500" />
                <span className="font-semibold text-slate-600">
                  {t('trackedWorkspace.captureRange')}:
                </span>
                <time
                  dateTime={usableDetail.firstObservedAt}
                  className="font-mono tabular-nums text-slate-900"
                >
                  {formatTimestamp(usableDetail.firstObservedAt)}
                </time>
                <span aria-hidden="true">→</span>
                <time
                  dateTime={usableDetail.lastObservedAt}
                  className="font-mono tabular-nums text-slate-900"
                >
                  {formatTimestamp(usableDetail.lastObservedAt)}
                </time>
              </div>

              {isEpisodeTechOpen && (
                <dl
                  id={episodeTechPanelId}
                  data-testid="tracked-workspace-technical"
                  className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2"
                >
                  {[
                    { label: t('trackedWorkspace.episodeId'), value: usableDetail.episodeId },
                    { label: t('trackedWorkspace.siteId'), value: usableDetail.siteId },
                    { label: t('trackedWorkspace.cameraId'), value: usableDetail.cameraId },
                    {
                      label: t('trackedWorkspace.segmentId'),
                      value: usableDetail.subject.segmentId,
                    },
                    {
                      label: t('trackedWorkspace.scopeSha256'),
                      value: usableDetail.subject.scopeSha256,
                    },
                  ].map((entry) => (
                    <div key={entry.label} className="min-w-0">
                      <dt className="font-semibold text-slate-600">{entry.label}</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-900">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div
                role="group"
                aria-label={t('trackedWorkspace.findingFilterLabel')}
                data-testid="tracked-workspace-finding-filters"
                className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"
              >
                <Button
                  size="sm"
                  variant={effectiveAlertId === null ? 'default' : 'outline'}
                  aria-pressed={effectiveAlertId === null}
                  data-testid="tracked-workspace-filter-all"
                  onClick={() => handleSelectFinding(null)}
                >
                  {t('trackedWorkspace.allFindings', { count: usableDetail.findings.length })}
                </Button>
                {usableDetail.findings.map((finding) => {
                  const findingLabel = tCommon('ppeNotifications.' + finding.candidateSubtype, {
                    defaultValue: localizedLabel(finding.candidateSubtype),
                  });
                  const isSelected = effectiveAlertId === finding.alertId;
                  return (
                    <Button
                      key={finding.alertId}
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      aria-pressed={isSelected}
                      data-testid={`tracked-workspace-filter-${finding.alertId}`}
                      onClick={() => handleSelectFinding(finding.alertId)}
                    >
                      {t('trackedWorkspace.findingOption', {
                        label: findingLabel,
                        count: finding.observationCount,
                      })}
                    </Button>
                  );
                })}
              </div>
            </>
          )
        )}
      </Card>

      {usableDetail && (
        <TrackedObservationHistory
          scopeKey={historyScopeKey}
          items={deduplicatedItems}
          total={latestServerTotal}
          hasMore={hasMoreObservations}
          status={historyStatus}
          isLoadingMore={historyQuery.isFetchingNextPage || historyQuery.isFetching}
          loadMoreError={loadMoreErrorText}
          onLoadMore={handleLoadMore}
          onRetry={handleHistoryRetry}
          onOpenSource={handleOpenSource}
        />
      )}

      <TrackedEvidenceViewer
        open={activeMediaSelection !== null && expectedFrameSha256 !== null}
        scopeKey={historyScopeKey}
        selectionKey={activeMediaSelection?.selectionKey ?? ''}
        representation={activeMediaSelection?.representation ?? 'FRAME'}
        status={viewerStatus}
        media={verifiedViewerMedia}
        identityContent={viewerIdentityContent}
        onClose={handleCloseViewer}
        onRetry={handleRetryViewer}
      />
    </section>
  );
}
