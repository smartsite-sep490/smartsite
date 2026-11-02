import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxOptions,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import { useTranslation } from 'react-i18next';
import { uiLocale } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
  IconClock,
  IconLoader,
  IconRefresh,
} from '../icons';
import { Badge, Button, Card } from '../ui';
import './safety-episode-inbox-catalog';

export type SafetyEpisodeInboxClient = Pick<
  SmartSiteManagementClient,
  'listSafetyEpisodeInbox' | 'readSafetyEpisodeInbox'
>;

export interface SafetyEpisodeInboxSiteOption {
  id: string;
  name: string;
}

export interface SafetyEpisodeInboxWorkspaceProps {
  client: SafetyEpisodeInboxClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sites: readonly SafetyEpisodeInboxSiteOption[];
  onOpenEpisode(item: SafetyEpisodeInboxItem): void;
  onHardDenied?: () => void;
}

interface NormalizedSiteOption {
  key: string;
  id: string;
  name: string;
}

interface InboxScopeSnapshot {
  client: SafetyEpisodeInboxClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sortedSiteIdsKey: string;
  generation: number;
}

const INBOX_PAGE_LIMIT = 20;

const isForbiddenError = (error: unknown) =>
  error instanceof ApiError && error.status !== undefined && [401, 403, 404].includes(error.status);

const formatTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(uiLocale()) : value;
};

function normalizeAuthorizedSites(
  sites: readonly SafetyEpisodeInboxSiteOption[],
): NormalizedSiteOption[] {
  const seen = new Set<string>();
  const result: NormalizedSiteOption[] = [];
  for (const site of sites) {
    const trimmedId = site.id.trim();
    const key = trimmedId.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      key,
      id: trimmedId,
      name: site.name.trim() || trimmedId,
    });
  }
  return result;
}

function buildSortedSiteIdsKey(sites: readonly NormalizedSiteOption[]): string {
  return sites
    .map((site) => site.key)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(',');
}

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
        <SafetyEpisodeInboxListSection
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

function SafetyEpisodeInboxListSection({
  instanceId,
  generation,
  scopeKey,
  apiUrl,
  sortedSiteIdsKey,
  allowedSites,
  effectiveSiteKey,
  readStatus,
  client,
  token,
  onOpenEpisode,
  onHardDenied,
}: {
  instanceId: string;
  generation: number;
  scopeKey: string;
  apiUrl: string;
  sortedSiteIdsKey: string;
  allowedSites: readonly NormalizedSiteOption[];
  effectiveSiteKey: string | null;
  readStatus: 'ALL' | 'UNREAD';
  client: SafetyEpisodeInboxClient;
  token: string;
  onOpenEpisode(item: SafetyEpisodeInboxItem): void;
  onHardDenied?: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();

  const readAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const hardForbiddenRef = useRef(false);
  const [pendingReadById, setPendingReadById] = useState<Record<string, boolean>>({});
  const [readErrorById, setReadErrorById] = useState<Record<string, string>>({});
  const [acknowledgedReads, setAcknowledgedReads] = useState<
    Record<string, SafetyEpisodeReadResponse>
  >({});
  const [hardForbidden, setHardForbidden] = useState(false);
  const [openTechById, setOpenTechById] = useState<Record<string, boolean>>({});

  const abortPendingReads = () => {
    for (const activeController of readAbortControllersRef.current.values()) {
      activeController.abort();
    }
    readAbortControllersRef.current.clear();
  };

  const latchHardDenial = () => {
    if (hardForbiddenRef.current) {
      return;
    }
    hardForbiddenRef.current = true;
    abortPendingReads();
    setHardForbidden(true);
    setPendingReadById({});
    setReadErrorById({});
    setAcknowledgedReads({});
    onHardDenied?.();
  };

  const allowedSiteMap = new Map<string, NormalizedSiteOption>();
  for (const site of allowedSites) {
    allowedSiteMap.set(site.key, site);
  }

  // Never include the raw token in any query key or DOM text.
  const queryKey = [
    'safety-episode-inbox',
    instanceId,
    generation,
    scopeKey,
    apiUrl,
    sortedSiteIdsKey,
    effectiveSiteKey ?? 'ALL_SITES',
    readStatus,
  ] as const;

  useEffect(() => {
    const currentKey = [
      'safety-episode-inbox',
      instanceId,
      generation,
      scopeKey,
      apiUrl,
      sortedSiteIdsKey,
      effectiveSiteKey ?? 'ALL_SITES',
      readStatus,
    ];
    const controllers = readAbortControllersRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      void queryClient.cancelQueries({ queryKey: currentKey });
      queryClient.removeQueries({ queryKey: currentKey });
    };
  }, [
    queryClient,
    instanceId,
    generation,
    scopeKey,
    apiUrl,
    sortedSiteIdsKey,
    effectiveSiteKey,
    readStatus,
  ]);

  const inboxQuery = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ pageParam, signal }) => {
      const options: SafetyEpisodeInboxOptions = {
        offset: pageParam,
        limit: INBOX_PAGE_LIMIT,
        readStatus,
        ...(effectiveSiteKey !== null ? { siteId: effectiveSiteKey } : {}),
      };
      try {
        return await client.listSafetyEpisodeInbox(token, options, { signal });
      } catch (error) {
        if (isForbiddenError(error)) {
          latchHardDenial();
        }
        throw error;
      }
    },
    getNextPageParam: (lastPage, allPages): number | undefined => {
      if (lastPage.items.length === 0) {
        return undefined;
      }
      const rawReturnedCount = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (rawReturnedCount >= lastPage.total) {
        return undefined;
      }
      return rawReturnedCount;
    },
  });

  const isTransientNextPageError =
    inboxQuery.isFetchNextPageError && !isForbiddenError(inboxQuery.error);
  const isBaseError = inboxQuery.isError && !isTransientNextPageError;
  const isHardForbidden =
    hardForbidden ||
    (inboxQuery.isError && !inboxQuery.isFetching && isForbiddenError(inboxQuery.error));
  const isInitialOrRetryLoading =
    !isHardForbidden && (inboxQuery.isPending || (isBaseError && inboxQuery.isFetching));
  const isRetryableBaseError = !isHardForbidden && isBaseError && !inboxQuery.isFetching;

  const loadedPages =
    !isHardForbidden && !isInitialOrRetryLoading && !isRetryableBaseError
      ? (inboxQuery.data?.pages ?? [])
      : [];
  const lastPage = loadedPages.at(-1);
  const rawReturnedCount = loadedPages.reduce((sum, page) => sum + page.items.length, 0);
  const serverTotal = lastPage?.total ?? 0;
  const serverUnreadCount = lastPage?.unreadCount ?? 0;
  const hasMore = Boolean(
    lastPage &&
    lastPage.items.length > 0 &&
    rawReturnedCount < lastPage.total &&
    inboxQuery.hasNextPage,
  );

  // Deduplicate by recipient ID while applying authoritative read responses and filtering to allowedSites.
  const authorizedItems: SafetyEpisodeInboxItem[] = [];
  const recipientIndexMap = new Map<string, number>();

  for (const page of loadedPages) {
    for (const rawItem of page.items) {
      const siteKey = rawItem.episode.siteId.toLowerCase();
      if (!allowedSiteMap.has(siteKey)) {
        continue;
      }
      if (effectiveSiteKey !== null && siteKey !== effectiveSiteKey) {
        continue;
      }
      const recipientKey = rawItem.id.toLowerCase();
      const ack = acknowledgedReads[recipientKey];
      const isSameRevisionAck = Boolean(
        ack && ack.contentRevision === rawItem.episode.contentRevision,
      );
      const effectiveSeenRevision =
        isSameRevisionAck && ack
          ? Math.max(rawItem.seenRevision, ack.seenRevision)
          : rawItem.seenRevision;
      const effectiveUnread = isSameRevisionAck
        ? effectiveSeenRevision < rawItem.episode.contentRevision
        : rawItem.unread;

      if (readStatus === 'UNREAD' && !effectiveUnread) {
        continue;
      }

      const mergedItem: SafetyEpisodeInboxItem =
        effectiveSeenRevision !== rawItem.seenRevision || effectiveUnread !== rawItem.unread
          ? {
              ...rawItem,
              seenRevision: effectiveSeenRevision,
              unread: effectiveUnread,
            }
          : rawItem;

      const existingIdx = recipientIndexMap.get(recipientKey);
      if (existingIdx === undefined) {
        recipientIndexMap.set(recipientKey, authorizedItems.length);
        authorizedItems.push(mergedItem);
      } else {
        const previous = authorizedItems[existingIdx];
        if (
          previous &&
          (mergedItem.episode.contentRevision > previous.episode.contentRevision ||
            (mergedItem.episode.contentRevision === previous.episode.contentRevision &&
              mergedItem.seenRevision >= previous.seenRevision))
        ) {
          authorizedItems[existingIdx] = mergedItem;
        }
      }
    }
  }

  const groupedBySite = new Map<string, SafetyEpisodeInboxItem[]>();
  for (const item of authorizedItems) {
    const siteKey = item.episode.siteId.toLowerCase();
    const list = groupedBySite.get(siteKey);
    if (list) {
      list.push(item);
    } else {
      groupedBySite.set(siteKey, [item]);
    }
  }

  const handleOpenAuthorizedEpisode = (recipientId: string) => {
    if (
      hardForbiddenRef.current ||
      isHardForbidden ||
      isInitialOrRetryLoading ||
      isRetryableBaseError
    ) {
      return;
    }
    const idx = recipientIndexMap.get(recipientId.toLowerCase());
    if (idx === undefined) {
      return;
    }
    const currentItem = authorizedItems[idx];
    if (!currentItem || !allowedSiteMap.has(currentItem.episode.siteId.toLowerCase())) {
      return;
    }
    onOpenEpisode(currentItem);
  };

  const handleMarkRead = async (item: SafetyEpisodeInboxItem) => {
    if (
      hardForbiddenRef.current ||
      isHardForbidden ||
      isInitialOrRetryLoading ||
      isRetryableBaseError
    ) {
      return;
    }
    const siteKey = item.episode.siteId.toLowerCase();
    const recipientKey = item.id.toLowerCase();
    const ack = acknowledgedReads[recipientKey];
    const isAwaitingSummaryRefresh = Boolean(
      ack && ack.contentRevision > item.episode.contentRevision,
    );
    if (
      !allowedSiteMap.has(siteKey) ||
      !item.unread ||
      isAwaitingSummaryRefresh ||
      pendingReadById[recipientKey] ||
      readAbortControllersRef.current.has(recipientKey)
    ) {
      return;
    }

    // Capture the DISPLAYED contentRevision at the moment of explicit click.
    const displayedRevision = item.episode.contentRevision;
    const controller = new AbortController();
    readAbortControllersRef.current.set(recipientKey, controller);

    setPendingReadById((prev) => ({ ...prev, [recipientKey]: true }));
    setReadErrorById((prev) => {
      if (!(recipientKey in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[recipientKey];
      return next;
    });

    try {
      const response = await client.readSafetyEpisodeInbox(
        token,
        item.id,
        { seenRevision: displayedRevision },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || hardForbiddenRef.current) {
        return;
      }
      readAbortControllersRef.current.delete(recipientKey);
      setPendingReadById((prev) => ({ ...prev, [recipientKey]: false }));
      setAcknowledgedReads((prev) => ({
        ...prev,
        [recipientKey]: response,
      }));
      void inboxQuery.refetch();
    } catch (error) {
      if (controller.signal.aborted || hardForbiddenRef.current) {
        return;
      }
      readAbortControllersRef.current.delete(recipientKey);
      setPendingReadById((prev) => ({ ...prev, [recipientKey]: false }));
      if (isForbiddenError(error)) {
        latchHardDenial();
        void queryClient.cancelQueries({ queryKey });
        queryClient.removeQueries({ queryKey });
        return;
      }
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : t('safetyInbox.markReadError');
      setReadErrorById((prev) => ({ ...prev, [recipientKey]: message }));
    }
  };

  const handleLoadMore = () => {
    if (
      hardForbiddenRef.current ||
      isHardForbidden ||
      isInitialOrRetryLoading ||
      isRetryableBaseError ||
      inboxQuery.isFetching ||
      inboxQuery.isFetchingNextPage
    ) {
      return;
    }
    if (hasMore || isTransientNextPageError) {
      void inboxQuery.fetchNextPage();
    }
  };

  if (isHardForbidden) {
    return (
      <div
        role="alert"
        data-testid="safety-inbox-forbidden"
        className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950"
      >
        <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
        <span>{t('safetyInbox.forbidden')}</span>
      </div>
    );
  }

  if (isInitialOrRetryLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="safety-inbox-loading"
        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700"
      >
        <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
        <span>{t('safetyInbox.loading')}</span>
      </div>
    );
  }

  if (isRetryableBaseError) {
    return (
      <div
        role="alert"
        data-testid="safety-inbox-error"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900"
      >
        <div className="flex items-center gap-2">
          <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
          <span>{t('safetyInbox.error')}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="safety-inbox-retry"
          disabled={inboxQuery.isFetching}
          onClick={() => void inboxQuery.refetch()}
          leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
        >
          {t('safetyInbox.retry')}
        </Button>
      </div>
    );
  }

  const nextPageErrorMessage = isTransientNextPageError
    ? inboxQuery.error instanceof Error && inboxQuery.error.message.trim()
      ? inboxQuery.error.message
      : t('safetyInbox.nextPageError')
    : null;

  return (
    <div className="space-y-4" data-testid="safety-inbox-ready">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
        <span data-testid="safety-inbox-summary-counts" className="font-medium tabular-nums">
          {t('safetyInbox.summaryCounts', {
            unread: serverUnreadCount,
            total: serverTotal,
            loaded: authorizedItems.length,
          })}
        </span>
        {rawReturnedCount < serverTotal && rawReturnedCount > 0 && (
          <span
            data-testid="safety-inbox-partial-coverage"
            className="font-mono text-xs text-slate-600"
          >
            {t('safetyInbox.partialCoverage', {
              loaded: authorizedItems.length,
              total: serverTotal,
            })}
          </span>
        )}
      </div>

      {authorizedItems.length === 0 ? (
        hasMore ? (
          <div
            role="status"
            data-testid="safety-inbox-partial-empty"
            className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
          >
            {t('safetyInbox.partialEmpty')}
          </div>
        ) : (
          <div
            role="status"
            data-testid="safety-inbox-empty"
            className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
          >
            {t(
              rawReturnedCount > 0
                ? 'safetyInbox.emptyFilteredSites'
                : readStatus === 'UNREAD'
                  ? 'safetyInbox.emptyUnread'
                  : 'safetyInbox.emptyAll',
            )}
          </div>
        )
      ) : (
        <div className="space-y-4" data-testid="safety-inbox-site-groups">
          {allowedSites.map((site) => {
            const siteRows = groupedBySite.get(site.key);
            if (!siteRows || siteRows.length === 0) {
              return null;
            }
            return (
              <Card
                key={site.key}
                data-testid={`safety-inbox-site-group-${site.id}`}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <IconBuilding className="h-4 w-4 text-slate-600" />
                    <h3
                      data-testid={`safety-inbox-site-name-${site.id}`}
                      className="text-sm font-bold text-slate-900"
                    >
                      {site.name}
                    </h3>
                  </div>
                  <Badge variant="neutral" data-testid={`safety-inbox-site-count-${site.id}`}>
                    <span className="tabular-nums">
                      {t('safetyInbox.siteGroupLoaded', { count: siteRows.length })}
                    </span>
                  </Badge>
                </div>

                <ul
                  className="divide-y divide-slate-100"
                  data-testid={`safety-inbox-site-list-${site.id}`}
                >
                  {siteRows.map((item) => {
                    const recipientKey = item.id.toLowerCase();
                    const ack = acknowledgedReads[recipientKey];
                    const isAwaitingSummaryRefresh = Boolean(
                      ack && ack.contentRevision > item.episode.contentRevision,
                    );
                    const isRowPending = Boolean(pendingReadById[recipientKey]);
                    const rowError = readErrorById[recipientKey] ?? null;
                    const isTechOpen = Boolean(openTechById[recipientKey]);
                    const techPanelId = `${instanceId}-row-tech-${item.id}`;
                    const isTracked = item.episode.subject.kind === 'TRACKED';

                    return (
                      <li
                        key={item.id}
                        data-testid="safety-inbox-row"
                        className="space-y-2.5 py-3 first:pt-1 last:pb-1"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant={item.unread ? 'warning' : 'neutral'}
                                data-testid={`safety-inbox-row-status-${item.id}`}
                              >
                                {!item.unread && <IconCheck className="h-3 w-3" />}
                                <span>
                                  {t(
                                    item.unread
                                      ? 'safetyInbox.statusUnread'
                                      : 'safetyInbox.statusRead',
                                  )}
                                </span>
                              </Badge>

                              <Badge
                                variant="default"
                                data-testid={`safety-inbox-row-revision-${item.id}`}
                              >
                                <span className="tabular-nums">
                                  {t('safetyInbox.revisionBadge', {
                                    revision: item.episode.contentRevision,
                                  })}
                                </span>
                              </Badge>

                              {item.seenRevision > 0 && (
                                <Badge
                                  variant="neutral"
                                  data-testid={`safety-inbox-row-seen-${item.id}`}
                                >
                                  <span className="tabular-nums">
                                    {t('safetyInbox.seenRevisionBadge', {
                                      revision: item.seenRevision,
                                    })}
                                  </span>
                                </Badge>
                              )}

                              <Badge variant={isTracked ? 'info' : 'neutral'}>
                                {t(
                                  isTracked
                                    ? 'safetyInbox.kindTracked'
                                    : 'safetyInbox.kindEventLocal',
                                )}
                              </Badge>

                              <Badge
                                variant={
                                  item.episode.collectionState === 'SEALED' ? 'neutral' : 'info'
                                }
                              >
                                {t(
                                  item.episode.collectionState === 'SEALED'
                                    ? 'safetyInbox.stateSealed'
                                    : 'safetyInbox.stateCollecting',
                                )}
                              </Badge>
                            </div>

                            <p
                              data-testid={`safety-inbox-row-subject-${item.id}`}
                              className="text-xs font-medium text-slate-800"
                            >
                              {t('safetyInbox.subjectSummary', {
                                count: item.episode.findingCount,
                              })}
                            </p>

                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                              <IconClock className="h-3.5 w-3.5 text-slate-500" />
                              <span>{t('safetyInbox.lastObserved')}:</span>
                              <time
                                dateTime={item.episode.lastObservedAt}
                                className="font-mono tabular-nums text-slate-800"
                              >
                                {formatTimestamp(item.episode.lastObservedAt)}
                              </time>
                            </div>

                            {isAwaitingSummaryRefresh && ack && (
                              <p
                                role="status"
                                data-testid={`safety-inbox-awaiting-refresh-${item.id}`}
                                className="text-xs font-medium text-amber-800"
                              >
                                {t('safetyInbox.awaitingRefresh', {
                                  revision: ack.contentRevision,
                                  seen: ack.seenRevision,
                                })}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              data-testid={`safety-inbox-open-${item.id}`}
                              onClick={() => handleOpenAuthorizedEpisode(item.id)}
                            >
                              {t('safetyInbox.openEpisode')}
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!item.unread || isRowPending || isAwaitingSummaryRefresh}
                              data-testid={`safety-inbox-mark-read-${item.id}`}
                              onClick={() => void handleMarkRead(item)}
                            >
                              {isRowPending
                                ? t('safetyInbox.markingRead')
                                : t('safetyInbox.markRead')}
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`safety-inbox-tech-toggle-${item.id}`}
                              aria-expanded={isTechOpen}
                              aria-controls={techPanelId}
                              onClick={() =>
                                setOpenTechById((prev) => ({
                                  ...prev,
                                  [recipientKey]: !prev[recipientKey],
                                }))
                              }
                            >
                              {t(
                                isTechOpen
                                  ? 'safetyInbox.hideTechnical'
                                  : 'safetyInbox.showTechnical',
                              )}
                            </Button>
                          </div>
                        </div>

                        {rowError && (
                          <div
                            role="alert"
                            data-testid={`safety-inbox-read-error-${item.id}`}
                            className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2 text-xs text-rose-900"
                          >
                            <IconAlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
                            <span>{rowError}</span>
                          </div>
                        )}

                        {isTechOpen && (
                          <dl
                            id={techPanelId}
                            data-testid={`safety-inbox-technical-${item.id}`}
                            className="grid gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 text-xs text-slate-700 sm:grid-cols-2"
                          >
                            {[
                              { label: t('safetyInbox.recipientId'), value: item.id },
                              { label: t('safetyInbox.episodeId'), value: item.episode.id },
                              { label: t('safetyInbox.siteId'), value: item.episode.siteId },
                              { label: t('safetyInbox.cameraId'), value: item.episode.cameraId },
                              {
                                label: t('safetyInbox.subjectKind'),
                                value: item.episode.subject.kind,
                              },
                              ...(item.episode.subject.kind === 'TRACKED'
                                ? [
                                    {
                                      label: t('safetyInbox.segmentId'),
                                      value: item.episode.subject.segmentId,
                                    },
                                    {
                                      label: t('safetyInbox.scopeSha256'),
                                      value: item.episode.subject.scopeSha256,
                                    },
                                  ]
                                : [
                                    {
                                      label: t('safetyInbox.eventId'),
                                      value: item.episode.subject.eventId,
                                    },
                                    {
                                      label: t('safetyInbox.personIndex'),
                                      value: String(item.episode.subject.personObservationIndex),
                                    },
                                  ]),
                              {
                                label: t('safetyInbox.firstObservedAt'),
                                value: item.episode.firstObservedAt,
                              },
                              {
                                label: t('safetyInbox.firstDeliveredAt'),
                                value: item.firstDeliveredAt,
                              },
                              { label: t('safetyInbox.updatedAt'), value: item.updatedAt },
                            ].map((entry) => (
                              <div key={entry.label} className="min-w-0">
                                <dt className="font-semibold text-slate-600">{entry.label}</dt>
                                <dd className="mt-0.5 break-all font-mono tabular-nums text-slate-900">
                                  {entry.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {nextPageErrorMessage && (
        <div
          role="alert"
          data-testid="safety-inbox-next-page-error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{nextPageErrorMessage}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="safety-inbox-retry-load-more"
            disabled={inboxQuery.isFetching || inboxQuery.isFetchingNextPage}
            onClick={handleLoadMore}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {t('safetyInbox.retryLoadMore')}
          </Button>
        </div>
      )}

      {hasMore && !isTransientNextPageError && (
        <div className="flex justify-center pt-1">
          <Button
            size="sm"
            variant="outline"
            data-testid="safety-inbox-load-more"
            disabled={inboxQuery.isFetching || inboxQuery.isFetchingNextPage}
            onClick={handleLoadMore}
          >
            {inboxQuery.isFetchingNextPage
              ? t('safetyInbox.loadingMore')
              : t('safetyInbox.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
