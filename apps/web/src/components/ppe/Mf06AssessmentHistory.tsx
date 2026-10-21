import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient, useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
  type Mf06AssessmentResponse,
  type Mf06AssessmentPage,
} from '@smartsite/api-client';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import { Mf06AssessmentCaseCard } from './Mf06AssessmentCaseCard';
import { areUuidsEqual, type AssessmentTargetContext } from './mf06AssessmentDetailBinding';
import { IconClock, IconShield, IconAlertTriangle } from '../icons';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';

export interface Mf06AssessmentHistoryProps {
  token: string | null;
  siteId: string | null;
  credentialId: string;
  onUnauthorized?: () => void;
  apiUrl?: string;
  client?: SmartSiteManagementClient;
}

interface HardErrorLatch {
  token: string | null;
  siteId: string | null;
  credentialId: string;
  queryClient: QueryClient;
  apiUrl: string;
  client: SmartSiteManagementClient;
  status: 401 | 403 | 404;
  error: ApiError;
}

function getErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof ApiError && typeof error.status === 'number') {
    if (error.status === 401) {
      return t('mf06.detail.error.401');
    }
    if (error.status === 403) {
      return t('mf06.history.error.403');
    }
    if (error.status === 404) {
      return t('mf06.history.error.404');
    }
    if (error.status === 503) {
      return t('mf06.detail.error.503');
    }
  }
  return t('mf06.history.error.default');
}

const tokenIdentities = new WeakMap<QueryClient, Map<string, number>>();
const clientIdentities = new WeakMap<SmartSiteManagementClient, number>();
let nextIdentity = 1;

function getOpaqueTokenNonce(queryClient: QueryClient, token: string | null): number | 'none' {
  if (!token) return 'none';
  let tokens = tokenIdentities.get(queryClient);
  if (!tokens) {
    tokens = new Map();
    tokenIdentities.set(queryClient, tokens);
  }
  let id = tokens.get(token);
  if (id === undefined) {
    id = nextIdentity++;
    tokens.set(token, id);
  }
  return id;
}

function getClientNonce(client: SmartSiteManagementClient): number {
  let id = clientIdentities.get(client);
  if (id === undefined) {
    id = nextIdentity++;
    clientIdentities.set(client, id);
  }
  return id;
}

export function Mf06AssessmentHistory({
  token,
  siteId,
  credentialId,
  onUnauthorized,
  apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    'http://localhost:3000',
  client: injectedClient,
}: Mf06AssessmentHistoryProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const managementClient = useMemo(
    () => injectedClient ?? new SmartSiteManagementClient(apiUrl),
    [injectedClient, apiUrl],
  );

  const tokenNonce = useMemo(() => getOpaqueTokenNonce(queryClient, token), [queryClient, token]);
  const clientNonce = useMemo(() => getClientNonce(managementClient), [managementClient]);

  const isEnabled = Boolean(token && siteId);

  const currentQueryKey = useMemo(
    () => ['mf06-assessments', apiUrl, clientNonce, siteId, credentialId, tokenNonce],
    [apiUrl, clientNonce, siteId, credentialId, tokenNonce],
  );

  // Component-local hard-error latch scoped to exact token, apiUrl, client, and siteId
  const [hardErrorLatch, setHardErrorLatch] = useState<HardErrorLatch | null>(null);
  const [selectedAssessmentTarget, setSelectedAssessmentTarget] =
    useState<AssessmentTargetContext | null>(null);

  const [selectionScope, setSelectionScope] = useState({
    token,
    siteId,
    credentialId,
    apiUrl,
    client: managementClient,
  });
  if (
    selectionScope.token !== token ||
    selectionScope.siteId !== siteId ||
    selectionScope.credentialId !== credentialId ||
    selectionScope.apiUrl !== apiUrl ||
    selectionScope.client !== managementClient
  ) {
    setSelectionScope({ token, siteId, credentialId, apiUrl, client: managementClient });
    setSelectedAssessmentTarget(null);
  }
  const notified401KeyRef = useRef<string | null>(null);

  // Determine if the latched hard error matches the current active scope
  const isLatchMatchingCurrentScope = Boolean(
    hardErrorLatch &&
    hardErrorLatch.token === token &&
    hardErrorLatch.siteId === siteId &&
    hardErrorLatch.credentialId === credentialId &&
    hardErrorLatch.queryClient === queryClient &&
    hardErrorLatch.apiUrl === apiUrl &&
    hardErrorLatch.client === managementClient,
  );

  const activeHardError = isLatchMatchingCurrentScope ? hardErrorLatch : null;

  // Reset derived local state synchronously when its scope changes.
  if (hardErrorLatch && !isLatchMatchingCurrentScope) setHardErrorLatch(null);

  // While a hard-error is latched for this scope, keep query disabled to prevent silent refetch loops
  const isQueryEnabled = isEnabled && !activeHardError;

  // TanStack Query Infinite Query for paginated MF06 assessments
  // Token is mapped to an opaque nonce per client instance to prevent token leakage in query keys
  const {
    data,
    error,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery<Mf06AssessmentPage, Error>({
    queryKey: currentQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      if (!token || !siteId) {
        throw new Error('Authentication token and site scope required.');
      }
      if (activeHardError) {
        throw activeHardError.error;
      }
      const offset = typeof pageParam === 'number' ? pageParam : 0;
      // Let the settled error reach the observer before revoking this cache.
      // Canceling this same request inside its catch would erase its 401/403/404.
      return managementClient.listMf06Assessments(token, siteId, { offset, limit: 20 }, { signal });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage || !Array.isArray(lastPage.items) || lastPage.items.length === 0) {
        return undefined;
      }
      const nextOffset = lastPage.offset + lastPage.items.length;
      if (nextOffset >= lastPage.total) {
        return undefined;
      }
      return nextOffset;
    },
    enabled: isQueryEnabled,
    refetchOnMount: 'always',
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Effective error merges active hard error latch with query error
  const effectiveError = activeHardError ? activeHardError.error : error;
  const effectiveErrorStatus =
    effectiveError instanceof ApiError ? effectiveError.status : undefined;
  const isHardError =
    Boolean(activeHardError) ||
    effectiveErrorStatus === 401 ||
    effectiveErrorStatus === 403 ||
    effectiveErrorStatus === 404;

  // Use isFetchNextPageError for precise distinction:
  // Next-page transient failure preserves prior rows.
  // Base fetch or base refetch failures (and any hard errors) clear prior history.
  const isNextPageError = Boolean(isFetchNextPageError && error && !isHardError);
  const isBaseError = Boolean(effectiveError && !isNextPageError);

  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403 || error.status === 404) &&
    !isLatchMatchingCurrentScope
  ) {
    setHardErrorLatch({
      token,
      siteId,
      credentialId,
      queryClient,
      apiUrl,
      client: managementClient,
      status: error.status,
      error,
    });
  }

  const handleDetailAccessError = useCallback(
    (
      accessError: ApiError,
      errorScope: {
        token: string | null;
        siteId: string | null;
        credentialId: string;
        apiUrl: string;
      },
    ) => {
      // Late old-scope errors must not affect new scope
      if (
        errorScope.token !== token ||
        errorScope.siteId !== siteId ||
        errorScope.credentialId !== credentialId ||
        errorScope.apiUrl !== apiUrl
      ) {
        return;
      }

      const status = accessError.status;
      if (status !== 401 && status !== 403) {
        return;
      }

      // Parent latches using its exact current scope / currentQueryKey
      setHardErrorLatch({
        token,
        siteId,
        credentialId,
        queryClient,
        apiUrl,
        client: managementClient,
        status,
        error: accessError,
      });

      // Clears parent rows / cancels actual key, does not auto-refetch
      void queryClient.cancelQueries({ queryKey: currentQueryKey, exact: true });
      queryClient.removeQueries({ queryKey: currentQueryKey, exact: true });

      // Close open detail dialog / target
      setSelectedAssessmentTarget(null);

      // 401 single onUnauthorized via parent, 403 no signout
      if (status === 401) {
        const scopeKey = `${apiUrl}:${clientNonce}:${siteId}:${credentialId}:${tokenNonce}`;
        if (notified401KeyRef.current !== scopeKey) {
          notified401KeyRef.current = scopeKey;
          onUnauthorized?.();
        }
      }
    },
    [
      token,
      siteId,
      credentialId,
      apiUrl,
      queryClient,
      managementClient,
      currentQueryKey,
      clientNonce,
      tokenNonce,
      onUnauthorized,
    ],
  );

  // Synchronize latch and ensure exact query cache is canceled and removed on 401, 403, 404
  useEffect(() => {
    const errorToCheck = activeHardError?.error ?? error;
    const status = errorToCheck instanceof ApiError ? errorToCheck.status : undefined;
    if (status === 401 || status === 403 || status === 404) {
      queryClient.cancelQueries({ queryKey: currentQueryKey, exact: true });
      queryClient.removeQueries({ queryKey: currentQueryKey, exact: true });
    }
  }, [
    error,
    activeHardError,
    isLatchMatchingCurrentScope,
    queryClient,
    currentQueryKey,
    token,
    siteId,
    credentialId,
    apiUrl,
    managementClient,
  ]);

  // Read latest server total safely from the last fetched page
  const latestTotal = useMemo(() => {
    if (!data?.pages || data.pages.length === 0 || isBaseError || isHardError) return undefined;
    for (let i = data.pages.length - 1; i >= 0; i--) {
      const page = data.pages[i];
      if (page && typeof page.total === 'number') return page.total;
    }
    return undefined;
  }, [data, isBaseError, isHardError]);

  // Invoke onUnauthorized callback exactly once per 401 error event within scope
  useEffect(() => {
    if (effectiveErrorStatus === 401) {
      const scopeKey = `${apiUrl}:${clientNonce}:${siteId}:${credentialId}:${tokenNonce}`;
      if (notified401KeyRef.current !== scopeKey) {
        notified401KeyRef.current = scopeKey;
        onUnauthorized?.();
      }
    } else if (effectiveErrorStatus !== undefined && effectiveErrorStatus !== null) {
      notified401KeyRef.current = null;
    }
  }, [effectiveErrorStatus, apiUrl, clientNonce, siteId, credentialId, tokenNonce, onUnauthorized]);

  // Aggregate items with deduplication across pages
  // Clears/hides all items on base errors or hard 401/403/404 errors
  const items = useMemo(() => {
    if (!token || !siteId || isBaseError || isHardError) return [];
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const result: Mf06AssessmentResponse[] = [];
    for (const page of data.pages) {
      if (!page?.items) continue;
      for (const item of page.items) {
        if (!areUuidsEqual(item.siteId, siteId)) continue;
        const key = item.assessmentId.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
    }
    return result;
  }, [token, siteId, isBaseError, isHardError, data]);

  if (
    selectedAssessmentTarget !== null &&
    (isBaseError ||
      isHardError ||
      !items.some(
        (item) =>
          areUuidsEqual(item.assessmentId, selectedAssessmentTarget.assessmentId) &&
          areUuidsEqual(item.requestId, selectedAssessmentTarget.requestId) &&
          areUuidsEqual(item.siteId, selectedAssessmentTarget.siteId) &&
          areUuidsEqual(item.siteId, siteId ?? ''),
      ))
  ) {
    setSelectedAssessmentTarget(null);
  }

  // State: No site or token selected
  if (!token || !siteId) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-zinc-500 ">
        <IconShield className="w-8 h-8 mx-auto mb-2 text-zinc-400" />
        <p className="text-sm font-medium">{t('mf06.history.noSite')}</p>
      </div>
    );
  }

  return (
    <section
      aria-label={t('mf06.history.sectionAria')}
      className="rounded-xl border border-zinc-200 bg-white shadow-xs p-4 sm:p-5 space-y-4"
    >
      {/* Header and Disclaimer */}
      <div className="border-b border-zinc-200/80 pb-3.5 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconShield className="w-5 h-5 text-zinc-700 shrink-0" />
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 ">
              {t('mf06.history.heading')}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isHardError && !isBaseError && (
              <button
                type="button"
                onClick={() => {
                  if (!isFetching) void refetch();
                }}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 "
              >
                <IconClock className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                {isFetching ? t('mf06.requests.refreshing') : t('mf06.requests.refresh')}
              </button>
            )}
            {latestTotal !== undefined && !isBaseError && !isHardError && (
              <span className="text-xs font-semibold tabular-nums px-2.5 py-0.5 rounded-full border border-zinc-200 bg-zinc-100 text-zinc-700 ">
                {t('mf06.history.total', { total: latestTotal })}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500 ">{t('mf06.history.disclaimer')}</p>
      </div>

      {/* Initial Loading or Busy-Empty Refresh/Retry State */}
      {(isLoading || (isFetching && items.length === 0 && !isHardError)) && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center justify-center py-10 space-x-2 text-sm text-zinc-500 "
        >
          <IconClock className="w-5 h-5 animate-spin" />
          <span>{isLoading ? t('mf06.history.loading') : t('mf06.requests.refreshing')}</span>
        </div>
      )}

      {/* Base Error State (or Hard Error State) */}
      {isBaseError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-rose-700 text-sm font-medium">
            <IconAlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{getErrorMessage(effectiveError, t)}</span>
          </div>
          {!isHardError && (
            <button
              type="button"
              onClick={() => {
                if (!isHardError && !isFetching) void refetch();
              }}
              disabled={isFetching}
              className="text-xs px-3 py-1.5 rounded-md font-medium bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 transition disabled:opacity-50"
            >
              {t('mf06.detail.retry')}
            </button>
          )}
        </div>
      )}

      {/* Settled Empty State */}
      {!isLoading &&
        !effectiveError &&
        items.length === 0 &&
        !isFetching &&
        !hasNextPage &&
        !isNextPageError && (
          <div
            role="status"
            aria-live="polite"
            className="py-10 text-center text-sm text-zinc-500 "
          >
            <p className="font-medium">{t('mf06.history.emptyTitle')}</p>
            <p className="text-xs mt-1 text-zinc-400">{t('mf06.history.emptyDesc')}</p>
          </div>
        )}

      {/* Assessment Records List & Pagination Controls */}
      {(items.length > 0 || (hasNextPage && !isBaseError) || isNextPageError) && (
        <div className="space-y-3.5">
          {items.length > 0 && (
            <ul role="list" aria-busy={isFetching} className="space-y-3.5">
              {items.map((assessment) => (
                <Mf06AssessmentCaseCard
                  key={assessment.assessmentId}
                  assessment={assessment}
                  referencesKey={`${apiUrl}:${clientNonce}:${siteId}:${credentialId}:${tokenNonce}`}
                  onViewAssessment={() =>
                    setSelectedAssessmentTarget({
                      assessmentId: assessment.assessmentId,
                      siteId: assessment.siteId,
                      requestId: assessment.requestId,
                      eventId: assessment.eventId,
                      cameraId: assessment.cameraId,
                      zoneId: assessment.zoneId,
                      capturedAt: assessment.capturedAt,
                      purpose: assessment.purpose,
                      outcome: assessment.outcome,
                      reasonCode: assessment.reasonCode,
                      evaluatorVersion: assessment.evaluatorVersion,
                      provenance: assessment.provenance,
                      assessedAt: assessment.assessedAt,
                    })
                  }
                />
              ))}
            </ul>
          )}

          {/* Transient Next Page Error */}
          {isNextPageError && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-xs text-rose-700 "
            >
              <span>{t('mf06.history.nextPageError')}</span>
              <button
                type="button"
                onClick={() => {
                  if (!isHardError && !isFetching && !isFetchingNextPage) {
                    void fetchNextPage({ cancelRefetch: false });
                  }
                }}
                disabled={isFetching || isFetchingNextPage}
                className="px-3 py-1 bg-rose-600 text-white rounded text-xs font-medium hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 transition disabled:opacity-50"
              >
                {t('mf06.history.retryNextPage')}
              </button>
            </div>
          )}

          {/* Explicit 20-row Load More */}
          {hasNextPage && !isNextPageError && !isBaseError && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!isHardError && !isFetching && !isFetchingNextPage) {
                    void fetchNextPage({ cancelRefetch: false });
                  }
                }}
                disabled={isFetching || isFetchingNextPage}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 transition disabled:opacity-50"
              >
                {isFetchingNextPage ? t('mf06.history.loadingMore') : t('mf06.history.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}

      <Mf06AssessmentDetailDialog
        open={Boolean(selectedAssessmentTarget)}
        onClose={() => setSelectedAssessmentTarget(null)}
        target={selectedAssessmentTarget}
        token={token}
        siteId={siteId}
        credentialId={credentialId}
        apiUrl={apiUrl}
        client={managementClient}
        onUnauthorized={onUnauthorized}
        onAccessError={handleDetailAccessError}
      />
    </section>
  );
}
