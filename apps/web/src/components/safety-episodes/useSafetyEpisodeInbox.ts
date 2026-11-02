import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxOptions,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import {
  computeNextInboxOffset,
  deriveAuthorizedInboxCollection,
  INBOX_PAGE_LIMIT,
  isForbiddenError,
  type NormalizedSiteOption,
  type SafetyEpisodeInboxClient,
} from './safety-episode-inbox-state';

export interface UseSafetyEpisodeInboxParams {
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
}

export function useSafetyEpisodeInbox({
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
}: UseSafetyEpisodeInboxParams) {
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
    getNextPageParam: computeNextInboxOffset,
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

  const {
    authorizedItems,
    recipientIndexMap,
    groupedBySite,
    allowedSiteMap,
    rawReturnedCount,
    serverTotal,
    serverUnreadCount,
    hasMore,
  } = deriveAuthorizedInboxCollection({
    loadedPages,
    allowedSites,
    effectiveSiteKey,
    readStatus,
    acknowledgedReads,
    hasNextPage: inboxQuery.hasNextPage,
  });

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

  const toggleTechDetails = (recipientKey: string) => {
    setOpenTechById((prev) => ({
      ...prev,
      [recipientKey]: !prev[recipientKey],
    }));
  };

  const nextPageErrorMessage = isTransientNextPageError
    ? inboxQuery.error instanceof Error && inboxQuery.error.message.trim()
      ? inboxQuery.error.message
      : t('safetyInbox.nextPageError')
    : null;

  return {
    isHardForbidden,
    isInitialOrRetryLoading,
    isRetryableBaseError,
    isTransientNextPageError,
    isFetching: inboxQuery.isFetching,
    isFetchingNextPage: inboxQuery.isFetchingNextPage,
    authorizedItems,
    groupedBySite,
    rawReturnedCount,
    serverTotal,
    serverUnreadCount,
    hasMore,
    nextPageErrorMessage,
    pendingReadById,
    readErrorById,
    acknowledgedReads,
    openTechById,
    handleOpenAuthorizedEpisode,
    handleMarkRead,
    handleLoadMore,
    handleRetryBase: () => void inboxQuery.refetch(),
    toggleTechDetails,
  };
}
