import React, { useId, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient, useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
  type Mf06RequestStatusResponse,
  type Mf06RequestStatusPage,
} from '@smartsite/api-client';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import type { AssessmentTargetContext } from './mf06AssessmentDetailBinding';
import { IconClock, IconShield, IconCheck, IconAlertTriangle } from '../icons';
import { useLocale, type Locale, type TranslationKey } from '../../i18n/ppe-locale';

export interface Mf06ZoneAssessmentPanelProps {
  token: string | null;
  siteId: string | null;
  credentialId: string;
  onUnauthorized?: () => void;
  apiUrl?: string;
  client?: SmartSiteManagementClient;
  initialTab?: 'assessments' | 'requests';
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

const JOB_STATUS_CONFIG: Record<
  Mf06RequestStatusResponse['jobStatus'],
  { labelKey: TranslationKey; badgeClass: string }
> = {
  NOT_QUEUED: {
    labelKey: 'mf06.requests.jobStatus.NOT_QUEUED',
    badgeClass:
      'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  },
  PENDING: {
    labelKey: 'mf06.requests.jobStatus.PENDING',
    badgeClass:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  },
  CLAIMED: {
    labelKey: 'mf06.requests.jobStatus.CLAIMED',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  },
  SUCCEEDED: {
    labelKey: 'mf06.requests.jobStatus.SUCCEEDED',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
  FAILED: {
    labelKey: 'mf06.requests.jobStatus.FAILED',
    badgeClass:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  },
  CANCELLED: {
    labelKey: 'mf06.requests.jobStatus.CANCELLED',
    badgeClass:
      'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
  },
};

const PURPOSE_KEYS: Record<Mf06RequestStatusResponse['purpose'], TranslationKey> = {
  INITIAL_OBSERVATION_ASSESSMENT: 'mf06.detail.purpose.INITIAL_OBSERVATION_ASSESSMENT',
  RETROSPECTIVE_REVIEW: 'mf06.detail.purpose.RETROSPECTIVE_REVIEW',
};

function formatTimestamp(isoString: string, locale: Locale): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
      timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

function getErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof ApiError && typeof error.status === 'number') {
    if (error.status === 401) {
      return t('mf06.detail.error.401');
    }
    if (error.status === 403) {
      return t('mf06.requests.error.403');
    }
    if (error.status === 404) {
      return t('mf06.requests.error.404');
    }
    if (error.status === 503) {
      return t('mf06.requests.error.503');
    }
  }
  return t('mf06.requests.error.default');
}

function resolveAiPausedFlag(): boolean {
  return import.meta.env.VITE_AI_WORK_PAUSED === 'true';
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

export function Mf06ZoneAssessmentPanel(props: Mf06ZoneAssessmentPanelProps) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<'assessments' | 'requests'>(
    props.initialTab ?? 'assessments',
  );

  const baseId = useId();
  const assessmentsTabId = `${baseId}-tab-assessments`;
  const assessmentsPanelId = `${baseId}-panel-assessments`;
  const requestsTabId = `${baseId}-tab-requests`;
  const requestsPanelId = `${baseId}-panel-requests`;

  const assessmentsTabRef = useRef<HTMLButtonElement>(null);
  const requestsTabRef = useRef<HTMLButtonElement>(null);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (activeTab === 'assessments') {
        setActiveTab('requests');
        requestsTabRef.current?.focus();
      } else {
        setActiveTab('assessments');
        assessmentsTabRef.current?.focus();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab('assessments');
      assessmentsTabRef.current?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab('requests');
      requestsTabRef.current?.focus();
    }
  };

  return (
    <section aria-label={t('mf06.panel.sectionAria')} className="space-y-4">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/80 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shrink-0">
              <IconShield className="w-4 h-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {t('mf06.panel.heading')}
            </h2>
          </div>

          <div
            role="tablist"
            aria-label={t('mf06.panel.tablistAria')}
            className="inline-flex items-center self-start sm:self-auto rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-zinc-100/90 dark:bg-zinc-800/80 p-1 gap-1"
          >
            <button
              ref={assessmentsTabRef}
              type="button"
              role="tab"
              id={assessmentsTabId}
              aria-controls={assessmentsPanelId}
              aria-selected={activeTab === 'assessments'}
              tabIndex={activeTab === 'assessments' ? 0 : -1}
              onClick={() => setActiveTab('assessments')}
              onKeyDown={handleTabKeyDown}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600 ${
                activeTab === 'assessments'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {t('mf06.panel.tabAssessments')}
            </button>
            <button
              ref={requestsTabRef}
              type="button"
              role="tab"
              id={requestsTabId}
              aria-controls={requestsPanelId}
              aria-selected={activeTab === 'requests'}
              tabIndex={activeTab === 'requests' ? 0 : -1}
              onClick={() => setActiveTab('requests')}
              onKeyDown={handleTabKeyDown}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600 ${
                activeTab === 'requests'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {t('mf06.panel.tabRequests')}
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {activeTab === 'assessments' ? (
            <div
              role="tabpanel"
              id={assessmentsPanelId}
              aria-labelledby={assessmentsTabId}
              tabIndex={0}
              className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            >
              <Mf06AssessmentHistory
                token={props.token}
                siteId={props.siteId}
                credentialId={props.credentialId}
                apiUrl={props.apiUrl}
                client={props.client}
                onUnauthorized={props.onUnauthorized}
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              id={requestsPanelId}
              aria-labelledby={requestsTabId}
              tabIndex={0}
              className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            >
              <Mf06RequestStatusList
                token={props.token}
                siteId={props.siteId}
                credentialId={props.credentialId}
                apiUrl={props.apiUrl}
                client={props.client}
                onUnauthorized={props.onUnauthorized}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Mf06RequestStatusList({
  token,
  siteId,
  credentialId,
  onUnauthorized,
  apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    'http://localhost:3000',
  client: injectedClient,
}: Mf06ZoneAssessmentPanelProps) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const managementClient = useMemo(
    () => injectedClient ?? new SmartSiteManagementClient(apiUrl),
    [injectedClient, apiUrl],
  );

  const tokenNonce = useMemo(() => getOpaqueTokenNonce(queryClient, token), [queryClient, token]);
  const clientNonce = useMemo(() => getClientNonce(managementClient), [managementClient]);

  const isEnabled = Boolean(token && siteId);

  const currentQueryKey = useMemo(
    () => ['mf06-requests', apiUrl, clientNonce, siteId, credentialId, tokenNonce],
    [apiUrl, clientNonce, siteId, credentialId, tokenNonce],
  );

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

  if (hardErrorLatch && !isLatchMatchingCurrentScope) setHardErrorLatch(null);

  const isQueryEnabled = isEnabled && !activeHardError;

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
  } = useInfiniteQuery<Mf06RequestStatusPage, Error>({
    queryKey: currentQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      if (!token || !siteId) {
        throw new Error('Authentication token and site scope required.');
      }
      if (activeHardError) {
        throw activeHardError.error;
      }
      const offset = typeof pageParam === 'number' ? pageParam : 0;
      return managementClient.listMf06RequestStatuses(
        token,
        siteId,
        { offset, limit: 20 },
        { signal },
      );
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
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const effectiveError = activeHardError ? activeHardError.error : error;
  const effectiveErrorStatus =
    effectiveError instanceof ApiError ? effectiveError.status : undefined;
  const isHardError =
    Boolean(activeHardError) ||
    effectiveErrorStatus === 401 ||
    effectiveErrorStatus === 403 ||
    effectiveErrorStatus === 404;

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

  const latestTotal = useMemo(() => {
    if (!data?.pages || data.pages.length === 0 || isBaseError || isHardError) return undefined;
    for (let i = data.pages.length - 1; i >= 0; i--) {
      const page = data.pages[i];
      if (page && typeof page.total === 'number') return page.total;
    }
    return undefined;
  }, [data, isBaseError, isHardError]);

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

  const items = useMemo(() => {
    if (!token || !siteId || isBaseError || isHardError) return [];
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const result: Mf06RequestStatusResponse[] = [];
    for (const page of data.pages) {
      if (!page?.items) continue;
      for (const item of page.items) {
        if (item.siteId !== siteId) continue;
        const key = item.requestId.toLowerCase();
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
          item.jobStatus === 'SUCCEEDED' &&
          item.assessmentId === selectedAssessmentTarget.assessmentId &&
          item.requestId === selectedAssessmentTarget.requestId &&
          item.siteId === selectedAssessmentTarget.siteId &&
          item.siteId === siteId,
      ))
  ) {
    setSelectedAssessmentTarget(null);
  }

  const handleRefresh = useCallback(() => {
    if (isHardError || isFetching) return;
    void refetch();
  }, [isHardError, isFetching, refetch]);

  const isFetchingAny = isFetching || isFetchingNextPage;
  const handleFetchNextPage = useCallback(() => {
    if (isFetchingAny || !hasNextPage) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [isFetchingAny, hasNextPage, fetchNextPage]);

  if (!token || !siteId) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center text-zinc-500 dark:text-zinc-400">
        <IconShield className="w-8 h-8 mx-auto mb-2 text-zinc-400" />
        <p className="text-sm font-medium">{t('mf06.requests.noSite')}</p>
      </div>
    );
  }

  const isAiWorkPaused = resolveAiPausedFlag();

  return (
    <div className="space-y-4">
      {/* Disclaimer and Technical State / AI-paused Banner */}
      <div className="rounded-xl border border-amber-200/90 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/25 px-4 py-3 space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2 font-semibold">
          <IconAlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            {isAiWorkPaused
              ? t('mf06.requests.bannerPausedTitle')
              : t('mf06.requests.bannerActiveTitle')}
          </span>
        </div>
        <p className="leading-relaxed text-[11px] text-amber-800 dark:text-amber-300">
          {isAiWorkPaused
            ? t('mf06.requests.bannerPausedBody')
            : t('mf06.requests.bannerActiveBody')}
        </p>
      </div>

      {/* Action bar with Manual Refresh and Totals */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {!isHardError && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition cursor-pointer disabled:opacity-50"
            >
              <IconClock className={`w-3.5 h-3.5 shrink-0 ${isFetching ? 'animate-spin' : ''}`} />
              <span>{isFetching ? t('mf06.requests.refreshing') : t('mf06.requests.refresh')}</span>
            </button>
          )}
        </div>
        {latestTotal !== undefined && !isBaseError && !isHardError && (
          <span className="text-xs font-semibold tabular-nums px-2.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
            {t('mf06.history.total', { total: latestTotal })}
          </span>
        )}
      </div>

      {/* Initial Loading */}
      {isLoading && !effectiveError && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center justify-center py-10 space-x-2 text-sm text-zinc-500 dark:text-zinc-400"
        >
          <IconClock className="w-5 h-5 animate-spin" />
          <span>{t('mf06.requests.loading')}</span>
        </div>
      )}

      {/* Base Error State */}
      {isBaseError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-2.5"
        >
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 text-sm font-medium">
            <IconAlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{getErrorMessage(effectiveError, t)}</span>
          </div>
          {!isHardError && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              className="text-xs px-3 py-1.5 rounded-md font-medium bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50"
            >
              {t('mf06.detail.retry')}
            </button>
          )}
        </div>
      )}

      {/* Settled Empty State */}
      {!isLoading && !effectiveError && items.length === 0 && !isFetching && (
        <div role="status" className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p className="font-medium">{t('mf06.requests.emptyTitle')}</p>
          <p className="text-xs mt-1 text-zinc-400">{t('mf06.requests.emptyDesc')}</p>
        </div>
      )}

      {/* Requests List */}
      {items.length > 0 && (
        <div className="space-y-3.5">
          <ul role="list" className="space-y-3.5">
            {items.map((request) => {
              const statusMeta =
                JOB_STATUS_CONFIG[request.jobStatus] ?? JOB_STATUS_CONFIG.NOT_QUEUED;
              const statusLabel = t(statusMeta.labelKey);
              const purposeKey = PURPOSE_KEYS[request.purpose];
              const purposeLabel = purposeKey ? t(purposeKey) : request.purpose;

              return (
                <li
                  key={request.requestId}
                  className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-800/25 p-4 space-y-3 transition hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-zinc-200/70 dark:border-zinc-800">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusMeta.badgeClass}`}
                      >
                        {statusLabel}
                      </span>
                      {request.deadlinePassed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
                          <IconAlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          {t('mf06.requests.deadlinePassed')}
                        </span>
                      )}
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                        {purposeLabel}
                      </span>
                    </div>

                    {request.attemptCount !== null && (
                      <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200/70 dark:border-zinc-700/70">
                        {t('mf06.requests.attempts', { count: request.attemptCount })}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/60 rounded-lg p-3 border border-zinc-200/70 dark:border-zinc-800">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.detail.field.captured')}
                      </span>{' '}
                      <time dateTime={request.capturedAt} className="font-mono tabular-nums">
                        {formatTimestamp(request.capturedAt, locale)}
                      </time>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:border-l sm:border-zinc-100 sm:dark:border-zinc-800 sm:pl-3">
                      <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.requests.fieldRequested')}
                      </span>{' '}
                      <time dateTime={request.requestedAt} className="font-mono tabular-nums">
                        {formatTimestamp(request.requestedAt, locale)}
                      </time>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:border-l sm:border-zinc-100 sm:dark:border-zinc-800 sm:pl-3">
                      <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.requests.fieldDeadline')}
                      </span>{' '}
                      {request.deadlineAt ? (
                        <time dateTime={request.deadlineAt} className="font-mono tabular-nums">
                          {formatTimestamp(request.deadlineAt, locale)}
                        </time>
                      ) : (
                        <span className="text-zinc-400">{t('mf06.requests.deadlineNone')}</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 pt-0.5 text-[11px] text-zinc-600 dark:text-zinc-300 font-mono tabular-nums">
                    <div className="break-all">
                      <span className="font-sans font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.detail.field.requestId')}
                      </span>{' '}
                      <span>{request.requestId}</span>
                    </div>
                    <div className="break-all">
                      <span className="font-sans font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.detail.field.eventId')}
                      </span>{' '}
                      <span>{request.eventId}</span>
                    </div>
                    <div className="break-all">
                      <span className="font-sans font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.history.fieldCamera')}
                      </span>{' '}
                      <span>{request.cameraId}</span>
                    </div>
                    <div className="break-all">
                      <span className="font-sans font-medium text-zinc-400 dark:text-zinc-500">
                        {t('mf06.history.fieldZone')}
                      </span>{' '}
                      <span>{request.zoneId}</span>
                    </div>
                  </div>

                  {request.jobStatus === 'SUCCEEDED' && request.assessmentId && (
                    <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/25 px-3 py-2 flex items-center justify-between gap-2.5 flex-wrap">
                      <div className="text-xs text-emerald-700 dark:text-emerald-400 font-mono tabular-nums flex items-center gap-1.5 break-all">
                        <IconCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {t('mf06.detail.field.assessmentId')} <span>{request.assessmentId}</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedAssessmentTarget({
                            assessmentId: request.assessmentId!,
                            requestId: request.requestId,
                            siteId: request.siteId,
                            eventId: request.eventId,
                            cameraId: request.cameraId,
                            zoneId: request.zoneId,
                            capturedAt: request.capturedAt,
                            purpose: request.purpose,
                          })
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 dark:text-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 border border-emerald-200/80 dark:border-emerald-800/60 rounded-lg transition cursor-pointer shrink-0"
                      >
                        {t('mf06.history.viewAssessment')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Transient Next Page Error */}
          {isNextPageError && (
            <div
              role="alert"
              className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center justify-between text-xs text-rose-700 dark:text-rose-300"
            >
              <span>{t('mf06.requests.nextPageError')}</span>
              <button
                type="button"
                onClick={handleFetchNextPage}
                disabled={isFetchingAny}
                className="px-3 py-1 bg-rose-600 text-white rounded text-xs font-medium hover:bg-rose-700 transition disabled:opacity-50"
              >
                {t('mf06.history.retryNextPage')}
              </button>
            </div>
          )}

          {/* Explicit 20-row Load More */}
          {hasNextPage && !isNextPageError && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleFetchNextPage}
                disabled={isFetchingAny}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
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
    </div>
  );
}
